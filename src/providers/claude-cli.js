import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { ProviderError } from './errors.js';
import { extractText, getDocumentProxy } from 'unpdf';

const TMP_DIR = path.join(DATA_DIR, 'tmp');
const TIMEOUT_MS = 180000;

// Materi rujukan: file yang ditaruh pengguna di data/materi dibaca Claude sebelum menjawab.
const MATERI_DIR = path.join(DATA_DIR, 'materi');
const MATERI_EXT = new Set(['.txt', '.md', '.pdf', '.png', '.jpg', '.jpeg']);
const MATERI_MAX_FILES = 10;
fs.mkdirSync(MATERI_DIR, { recursive: true });

function listMateri() {
  try {
    return fs.readdirSync(MATERI_DIR, { withFileTypes: true })
      .filter((d) => d.isFile() && MATERI_EXT.has(path.extname(d.name).toLowerCase()))
      .map((d) => path.join(MATERI_DIR, d.name))
      .sort()
      .slice(0, MATERI_MAX_FILES);
  } catch {
    return [];
  }
}

function run(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true
    }, (err, stdout, stderr) => {
      if (err && err.code === 'ENOENT') {
        return reject(new ProviderError('config',
          `Perintah "${command}" tidak ditemukan. Pastikan Claude Code terpasang dan bisa dijalankan dari PowerShell.`));
      }
      if (err && err.killed) {
        return reject(new ProviderError('error', `Claude CLI melewati batas waktu ${Math.round(timeoutMs / 60000)} menit.`));
      }
      resolve({ stdout: stdout || '', stderr: stderr || '', code: err ? err.code ?? 1 : 0 });
    });
  });
}

// Catatan ringkas materi: dibuat Claude satu kali, lalu dipakai ulang sampai isi folder materi berubah.
const RINGKASAN_DIR = path.join(DATA_DIR, 'ringkasan');
const RINGKASAN_FILE = path.join(RINGKASAN_DIR, 'catatan-materi.md');
const TANDA_FILE = path.join(RINGKASAN_DIR, 'tanda.txt');
const RINGKASAN_TIMEOUT_MS = 600000;
const TEKS_DIR = path.join(RINGKASAN_DIR, 'teks');
const PDF_MIN_CHARS = 200;

// Teks PDF diekstrak di backend, karena alat Read milik Claude CLI butuh poppler untuk membuka PDF.
// Mengembalikan daftar file yang dibaca Claude: PDF diganti versi .txt, file lain apa adanya.
async function siapkanTeks(materi) {
  fs.rmSync(TEKS_DIR, { recursive: true, force: true });
  fs.mkdirSync(TEKS_DIR, { recursive: true });
  const hasil = [];
  for (const f of materi) {
    if (path.extname(f).toLowerCase() !== '.pdf') { hasil.push(f); continue; }
    const nama = path.basename(f);
    let text;
    try {
      const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(f)));
      ({ text } = await extractText(pdf, { mergePages: true }));
    } catch (err) {
      throw new ProviderError('error', `PDF "${nama}" tidak bisa dibuka: ${String(err.message).slice(0, 150)}`);
    }
    if (!text || text.trim().length < PDF_MIN_CHARS) {
      throw new ProviderError('error',
        `PDF "${nama}" hampir tidak berisi teks (kemungkinan hasil scan/foto). Ganti dengan PDF berteks, atau simpan halamannya sebagai gambar .jpg/.png.`);
    }
    const out = path.join(TEKS_DIR, nama + '.txt');
    fs.writeFileSync(out, text, 'utf8');
    hasil.push(out);
  }
  return hasil;
}

// Tanda unik isi folder materi (nama, ukuran, waktu ubah). Berubah = catatan dibuat ulang.
function tandaMateri(files) {
  return 'v2\n' + files.map((f) => {
    const st = fs.statSync(f);
    return `${path.basename(f)}|${st.size}|${Math.floor(st.mtimeMs)}`;
  }).join('\n');
}

// Pola pesan yang berarti kuota/saldo habis, sehingga aplikasi pindah ke penyedia lain.
const QUOTA_PATTERN = /usage limit|rate limit|quota|limit reached|too many requests|credit balance|insufficient/i;

// Menjalankan Claude CLI dan mengembalikan JSON hasilnya, dengan penanganan error yang seragam.
async function callClaude(settings, prompt, dirs, timeoutMs) {
  // --allowedTools ditaruh paling akhir karena flag itu menerima banyak nilai.
  const args = ['-p', prompt, '--output-format', 'json'];
  for (const d of dirs) args.push('--add-dir', d);
  if (settings.claudeModel) args.push('--model', settings.claudeModel);
  args.push('--allowedTools', 'Read');

  const { stdout, stderr, code } = await run(settings.claudeCommand, args, timeoutMs);

  let data;
  try {
    data = JSON.parse(stdout.trim());
  } catch {
    const detail = (stderr || stdout || 'tidak ada output').trim().slice(0, 300);
    throw new ProviderError('error', 'Output Claude CLI tidak bisa dibaca: ' + detail);
  }

  if (data.is_error || data.subtype !== 'success' || code !== 0) {
    const msg = String(data.result || stderr || 'Claude CLI gagal.').trim();
    if (QUOTA_PATTERN.test(msg)) {
      throw new ProviderError('quota', 'Batas pemakaian Claude (langganan Pro) sudah tercapai untuk saat ini.');
    }
    throw new ProviderError('error', 'Claude CLI gagal: ' + msg.slice(0, 300));
  }

  const text = String(data.result || '').trim();
  if (!text) throw new ProviderError('error', 'Claude CLI tidak mengembalikan teks.');
  return { data, text };
}

// Mengembalikan true jika catatan materi tersedia. Membuat catatan baru hanya jika materi berubah.
async function siapkanRingkasan(settings, materi) {
  if (!materi.length) return { ada: false, baru: false };
  const tanda = tandaMateri(materi);
  try {
    if (fs.readFileSync(TANDA_FILE, 'utf8') === tanda && fs.statSync(RINGKASAN_FILE).size > 0) {
      return { ada: true, baru: false };
    }
  } catch { /* belum ada catatan: buat baru */ }

  const sumber = await siapkanTeks(materi);
  const prompt = [
    'Baca semua file materi berikut dengan alat Read:',
    ...sumber.map((f) => `- ${f}`),
    '',
    'Lalu tulis catatan belajar yang padat dalam Bahasa Indonesia, format Markdown.',
    'Pertahankan semua fakta penting: definisi, istilah, nama, angka, rumus, langkah, dan contoh kunci.',
    'Buang pengulangan dan basa-basi. Kelompokkan per topik dengan judul. Maksimal sekitar 2500 kata.',
    'Keluarkan hanya isi catatannya, tanpa kalimat pembuka atau penutup.'
  ].join('\n');

  const { text } = await callClaude(settings, prompt, [MATERI_DIR, TEKS_DIR], RINGKASAN_TIMEOUT_MS);
  fs.mkdirSync(RINGKASAN_DIR, { recursive: true });
  fs.writeFileSync(RINGKASAN_FILE, text, 'utf8');
  fs.writeFileSync(TANDA_FILE, tanda, 'utf8');
  return { ada: true, baru: true };
}

// Dipakai tombol "Cek AI" di dashboard. Hasilnya di-cache 60 detik.
let versionCache = { at: 0, command: null, value: null };
export async function checkClaude(command) {
  if (versionCache.command === command && Date.now() - versionCache.at < 60000) {
    return versionCache.value;
  }
  let value;
  try {
    const { stdout, code } = await run(command, ['--version'], 15000);
    value = code === 0 && stdout.trim()
      ? { available: true, version: stdout.trim().split('\n')[0] }
      : { available: false, error: 'Perintah ada, tetapi tidak merespons dengan benar.' };
  } catch (err) {
    value = { available: false, error: err.message };
  }
  versionCache = { at: Date.now(), command, value };
  return value;
}

export async function analyze({ base64, ext, instruction, settings }) {
  const materi = listMateri();
  const ringkasan = await siapkanRingkasan(settings, materi);

  fs.mkdirSync(TMP_DIR, { recursive: true });
  const file = path.join(TMP_DIR, `${crypto.randomUUID()}.${ext}`);
  fs.writeFileSync(file, Buffer.from(base64, 'base64'));

  try {
    const materiLines = ringkasan.ada
      ? [
          '',
          `Sebelum menjawab, baca juga catatan materi rujukan ini dengan alat Read: ${RINGKASAN_FILE}`,
          'Utamakan isi catatan itu saat menjawab. Jika jawabannya tidak ada di catatan, katakan itu,',
          'lalu jawab dengan pengetahuan umum.'
        ]
      : [];

    const prompt = [
      `Baca file gambar berikut dengan alat Read: ${file}`,
      ...materiLines,
      '',
      'Lalu jawab sesuai instruksi di bawah. Jawab dalam Bahasa Indonesia, ringkas,',
      'dan jangan mengarang isi layar yang tidak terlihat. Jika gambar hitam atau tidak jelas, katakan itu.',
      '',
      `Instruksi: ${instruction}`
    ].join('\n');

    const dirs = ringkasan.ada ? [TMP_DIR, RINGKASAN_DIR] : [TMP_DIR];
    const { data, text } = await callClaude(settings, prompt, dirs, TIMEOUT_MS);

    const u = data.usage || {};
    const input = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
    const output = u.output_tokens || 0;
    return {
      text,
      model: settings.claudeModel || 'default',
      usage: { inputTokens: input, outputTokens: output, totalTokens: input + output },
      costUsd: typeof data.total_cost_usd === 'number' ? data.total_cost_usd : null
    };
  } finally {
    fs.rmSync(file, { force: true });
  }
}

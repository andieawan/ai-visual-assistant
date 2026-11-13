import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { ProviderError } from './errors.js';

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
        return reject(new ProviderError('error', 'Claude CLI melewati batas waktu 3 menit.'));
      }
      resolve({ stdout: stdout || '', stderr: stderr || '', code: err ? err.code ?? 1 : 0 });
    });
  });
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

// Pola pesan yang berarti kuota/saldo habis, sehingga aplikasi pindah ke penyedia lain.
const QUOTA_PATTERN = /usage limit|rate limit|quota|limit reached|too many requests|credit balance|insufficient/i;

export async function analyze({ base64, ext, instruction, settings }) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const file = path.join(TMP_DIR, `${crypto.randomUUID()}.${ext}`);
  fs.writeFileSync(file, Buffer.from(base64, 'base64'));

  try {
    const materi = listMateri();
    const materiLines = materi.length
      ? [
          '',
          'Sebelum menjawab, baca juga file materi rujukan berikut dengan alat Read:',
          ...materi.map((f) => `- ${f}`),
          'Utamakan isi materi itu saat menjawab. Jika jawabannya tidak ada di materi, katakan itu,',
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

    // --allowedTools ditaruh paling akhir karena flag itu menerima banyak nilai.
    const args = ['-p', prompt, '--output-format', 'json', '--add-dir', TMP_DIR];
    if (materi.length) args.push('--add-dir', MATERI_DIR);
    if (settings.claudeModel) args.push('--model', settings.claudeModel);
    args.push('--allowedTools', 'Read');

    const { stdout, stderr, code } = await run(settings.claudeCommand, args, TIMEOUT_MS);

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
    if (!text) {
      throw new ProviderError('error', 'Claude CLI tidak mengembalikan teks.');
    }

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

// Uji Tahap 2 lewat terminal: npm run test:obs
import fs from 'node:fs';
import path from 'node:path';
import { connect, disconnect, listInputs, takeScreenshot } from '../src/obs.js';
import { getSettings, DATA_DIR } from '../src/config.js';

const ok = (m) => console.log('  [OK]  ' + m);
const fail = (m) => console.log('  [GAGAL] ' + m);

async function main() {
  const { host, port, sourceName } = getSettings().obs;
  console.log(`\n=== Uji koneksi OBS (ws://${host}:${port}) ===`);

  const s = await connect();
  ok(`Terhubung. OBS ${s.obsVersion}, obs-websocket ${s.wsVersion}, RPC ${s.rpcVersion}`);
  ok(`Format gambar didukung: ${s.imageFormats.join(', ')}`);

  console.log('\n=== Daftar source di OBS ===');
  const inputs = await listInputs();
  if (!inputs.length) fail('Tidak ada source.');
  for (const i of inputs) {
    const tag = i.isCapture ? ' <- capture card' : i.isLocalScreen ? ' <- layar komputer 2 (jangan dipakai)' : '';
    console.log(`  - ${i.name} [${i.kind}]${tag}`);
  }

  console.log(`\n=== Ambil screenshot (${sourceName || 'otomatis: capture card pertama'}) ===`);
  const shot = await takeScreenshot();
  const ext = shot.format === 'png' ? 'png' : 'jpg';
  const file = path.join(DATA_DIR, `test-screenshot.${ext}`);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, Buffer.from(shot.image.split(',')[1], 'base64'));
  ok(`Source: ${shot.source} [${shot.sourceKind}]`);
  ok(`Ukuran: ${(shot.bytes / 1024).toFixed(1)} KB, disimpan di ${file}`);
  shot.warnings.forEach((w) => console.log('  [PERINGATAN] ' + w));

  console.log('\nSelesai. Buka file screenshot di atas dan pastikan isinya layar KOMPUTER 1.\n');
}

main()
  .catch((err) => {
    fail(err.message);
    process.exitCode = 1;
  })
  .finally(() => disconnect());

# AI Visual Assistant — Tahap 2 (Integrasi OBS)

## Struktur
```
ai-visual-assistant/
├─ start.bat            # klik 2x untuk menjalankan
├─ package.json
├─ .env.example         # disalin otomatis menjadi .env
├─ src/
│  ├─ server.js         # backend Express (hanya 127.0.0.1:3000)
│  ├─ obs.js            # koneksi OBS WebSocket + screenshot
│  ├─ config.js         # baca/simpan pengaturan (data/settings.json)
│  └─ validate.js       # validasi input
├─ scripts/test-obs.js  # uji lewat terminal
└─ public/              # dashboard (index.html, style.css, app.js)
```

## Cara menjalankan
1. Ekstrak folder ke Komputer 2, misalnya `C:\ai-visual-assistant`.
2. Buka `.env.example`, isi `OBS_PASSWORD` dan `OBS_SOURCE` (nama source capture card), simpan sebagai `.env`.
   (Boleh juga dikosongkan lalu diatur dari halaman Pengaturan.)
3. Pastikan OBS terbuka dan WebSocket Server aktif.
4. Klik 2x `start.bat`. Browser terbuka otomatis ke http://127.0.0.1:3000

## Uji Tahap 2
Buka PowerShell di folder proyek:
```
npm install
npm run test:obs
```

## Indikator berhasil
- [ ] `npm run test:obs` menampilkan `[OK] Terhubung` dan versi OBS.
- [ ] Daftar source menandai capture card dengan `<- capture card`.
- [ ] File `data\test-screenshot.jpg` berisi tampilan **Komputer 1**.
- [ ] Di dashboard, badge **Connected** hijau.
- [ ] **Refresh Preview** menampilkan layar Komputer 1, beserta resolusi dan ukuran file.
- [ ] Tutup OBS → badge berubah **Disconnected** dengan pesan error dalam ±3 detik.
- [ ] Buka OBS lagi → tersambung ulang otomatis dalam ±5 detik.
- [ ] Password salah → muncul pesan "Password OBS WebSocket salah".

## Keamanan
- Server hanya mendengarkan di 127.0.0.1, tidak bisa dibuka dari komputer lain.
- Password OBS tidak pernah dikirim ke browser.
- Alamat OBS hanya boleh alamat lokal/jaringan privat.
- Disarankan: blokir port 4455 dari luar di Windows Firewall jika OBS dan aplikasi ada di komputer yang sama.

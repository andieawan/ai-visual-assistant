// Kesalahan dari penyedia AI.
// kind:
//   'quota'  -> kuota/batas pemakaian habis (boleh pindah ke penyedia lain)
//   'config' -> belum dikonfigurasi, atau kredensial salah (boleh pindah)
//   'error'  -> kesalahan lain (tidak pindah, langsung ditampilkan)
export class ProviderError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
  }
}

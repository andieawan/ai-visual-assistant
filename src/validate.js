// Validasi input dari halaman pengaturan.

const WIDTHS = [0, 640, 960, 1280, 1920];
const FORMATS = ['jpg', 'png'];
const PROVIDERS = ['gemini', 'claude'];

function parseIPv4(host) {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n >= 0 && n <= 255) ? parts : null;
}

// Hanya alamat lokal/jaringan privat: OBS tidak boleh diakses lewat internet.
export function isLocalOrPrivate(host) {
  if (host === 'localhost') return true;
  const ip = parseIPv4(host);
  if (!ip) return false;
  const [a, b] = ip;
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

export function isLoopback(host) {
  return host === 'localhost' || host.startsWith('127.');
}

export function validateObs(body, current) {
  const errors = [];
  const next = { ...current };

  if (body.host !== undefined) {
    const host = String(body.host).trim();
    if (!isLocalOrPrivate(host)) {
      errors.push('Alamat OBS harus lokal: 127.0.0.1, localhost, 192.168.x.x, 10.x.x.x, atau 172.16-31.x.x.');
    } else {
      next.host = host;
    }
  }

  if (body.port !== undefined) {
    const port = Number(body.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push('Port harus angka 1-65535.');
    } else {
      next.port = port;
    }
  }

  // Password: dikirim hanya jika diubah. clearPassword=true untuk mengosongkan.
  if (body.clearPassword === true) {
    next.password = '';
  } else if (typeof body.password === 'string' && body.password.length > 0) {
    if (body.password.length > 128) errors.push('Password terlalu panjang (maks. 128 karakter).');
    else next.password = body.password;
  }

  if (body.sourceName !== undefined) {
    const name = String(body.sourceName).trim();
    if (name.length > 256) errors.push('Nama source terlalu panjang.');
    else next.sourceName = name;
  }

  return { errors, next };
}

export function validateCapture(body, current) {
  const errors = [];
  const next = { ...current };

  if (body.width !== undefined) {
    const w = Number(body.width);
    if (!WIDTHS.includes(w)) errors.push('Pilihan resolusi tidak valid.');
    else next.width = w;
  }

  if (body.quality !== undefined) {
    const q = Number(body.quality);
    if (!Number.isInteger(q) || q < 30 || q > 100) errors.push('Kualitas harus 30-100.');
    else next.quality = q;
  }

  if (body.format !== undefined) {
    if (!FORMATS.includes(body.format)) errors.push('Format harus jpg atau png.');
    else next.format = body.format;
  }

  return { errors, next };
}

export function validateAi(body, current) {
  const errors = [];
  const next = { ...current };

  if (body.provider !== undefined) {
    if (!PROVIDERS.includes(body.provider)) errors.push('Penyedia AI harus gemini atau claude.');
    else next.provider = body.provider;
  }

  if (body.fallback !== undefined) {
    next.fallback = body.fallback === true || body.fallback === 'true';
  }

  if (body.geminiModel !== undefined) {
    const m = String(body.geminiModel).trim();
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(m)) errors.push('Nama model Gemini hanya boleh huruf, angka, titik, strip, atau garis bawah.');
    else next.geminiModel = m;
  }

  if (body.claudeModel !== undefined) {
    const m = String(body.claudeModel).trim();
    if (m && !/^[a-zA-Z0-9._-]{1,64}$/.test(m)) errors.push('Nama model Claude tidak valid.');
    else next.claudeModel = m;
  }

  if (body.claudeCommand !== undefined) {
    const c = String(body.claudeCommand).trim();
    if (!/^[^\r\n"]{1,260}$/.test(c)) errors.push('Perintah Claude tidak valid.');
    else next.claudeCommand = c;
  }

  return { errors, next };
}

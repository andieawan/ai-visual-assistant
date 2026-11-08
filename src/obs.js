import OBSWebSocket from 'obs-websocket-js';
import { execFile } from 'node:child_process';
import { getSettings } from './config.js';

const obs = new OBSWebSocket();
const RECONNECT_MS = 5000;

// Jenis source yang dianggap capture card (Video Capture Device).
const CAPTURE_KINDS = new Set(['dshow_input', 'av_capture_input', 'av_capture_input_v2', 'v4l2_input']);
// Jenis source yang menangkap layar komputer 2 sendiri (harus dihindari).
const LOCAL_SCREEN_KINDS = new Set(['monitor_capture', 'window_capture', 'game_capture', 'screen_capture', 'xshm_input']);

const state = {
  connected: false,
  connecting: false,
  obsVersion: null,
  wsVersion: null,
  rpcVersion: null,
  imageFormats: [],
  lastError: null,
  lastConnectedAt: null
};

let reconnectTimer = null;
let manualDisconnect = false;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isAuthError(err) {
  return err?.code === 4009 || /auth/i.test(String(err?.message || ''));
}

function describeError(err) {
  if (!err) return null;
  if (isAuthError(err)) return 'Password OBS WebSocket salah atau belum diisi.';
  const msg = String(err.message || err);
  if (/ECONNREFUSED/i.test(msg)) return 'OBS tidak merespons. Pastikan OBS terbuka dan WebSocket Server aktif.';
  if (/ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/i.test(msg)) return 'Alamat OBS tidak dapat dijangkau.';
  return msg || 'Koneksi OBS terputus.';
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    if (!state.connected && !state.connecting) connect().catch(() => {});
  }, RECONNECT_MS);
}

obs.on('ConnectionClosed', (err) => {
  if (state.connecting) return;
  const wasConnected = state.connected;
  state.connected = false;
  if (manualDisconnect) return;
  state.lastError = wasConnected ? 'Koneksi OBS terputus. Mencoba menyambung ulang...' : describeError(err);
  if (!isAuthError(err)) scheduleReconnect();
});

export function getState() {
  return { ...state };
}

export async function connect() {
  clearTimeout(reconnectTimer);
  state.connecting = true;
  manualDisconnect = true;
  try { await obs.disconnect(); } catch { /* belum terhubung */ }
  manualDisconnect = false;

  const { host, port, password } = getSettings().obs;
  try {
    const info = await obs.connect(`ws://${host}:${port}`, password || undefined, { rpcVersion: 1 });
    const v = await obs.call('GetVersion');
    Object.assign(state, {
      connected: true,
      obsVersion: v.obsVersion,
      wsVersion: v.obsWebSocketVersion,
      rpcVersion: info.negotiatedRpcVersion,
      imageFormats: v.supportedImageFormats || [],
      lastError: null,
      lastConnectedAt: new Date().toISOString()
    });
    return getState();
  } catch (err) {
    state.connected = false;
    state.lastError = describeError(err);
    if (!isAuthError(err)) scheduleReconnect();
    throw new HttpError(502, state.lastError);
  } finally {
    state.connecting = false;
  }
}

export async function disconnect() {
  clearTimeout(reconnectTimer);
  manualDisconnect = true;
  try { await obs.disconnect(); } catch { /* abaikan */ }
  state.connected = false;
}

function requireConnected() {
  if (!state.connected) throw new HttpError(503, state.lastError || 'OBS belum terhubung.');
}

export async function listInputs() {
  requireConnected();
  const { inputs } = await obs.call('GetInputList');
  return inputs.map((i) => ({
    name: i.inputName,
    kind: i.inputKind,
    isCapture: CAPTURE_KINDS.has(i.inputKind),
    isLocalScreen: LOCAL_SCREEN_KINDS.has(i.inputKind)
  }));
}

// Pilih source: dari pengaturan, atau otomatis capture card pertama.
export async function resolveSource() {
  const inputs = await listInputs();
  const wanted = getSettings().obs.sourceName;
  if (wanted) {
    const found = inputs.find((i) => i.name === wanted);
    if (!found) throw new HttpError(404, `Source "${wanted}" tidak ditemukan di OBS.`);
    return found;
  }
  const capture = inputs.find((i) => i.isCapture);
  if (!capture) throw new HttpError(404, 'Belum ada source Video Capture Device (capture card) di OBS.');
  return capture;
}

export async function takeScreenshot() {
  requireConnected();
  const { width, quality, format } = getSettings().capture;
  const source = await resolveSource();

  const warnings = [];
  if (source.isLocalScreen) {
    warnings.push('Source ini menangkap layar komputer 2, bukan capture card.');
  } else if (!source.isCapture) {
    warnings.push(`Source berjenis "${source.kind}", bukan capture card.`);
  }

  const active = await obs.call('GetSourceActive', { sourceName: source.name }).catch(() => null);
  if (active && !active.videoActive) {
    warnings.push('Source tidak aktif di OBS, gambar bisa hitam. Tampilkan source di scene yang sedang aktif.');
  }

  const imageFormat = format === 'png'
    ? 'png'
    : (state.imageFormats.includes('jpg') ? 'jpg' : 'jpeg');

  const req = { sourceName: source.name, imageFormat };
  if (width > 0) req.imageWidth = width;
  if (imageFormat !== 'png') req.imageCompressionQuality = quality;

  try {
    const { imageData } = await obs.call('GetSourceScreenshot', req);
    const base64 = imageData.split(',')[1] || '';
    return {
      image: imageData,
      bytes: Math.floor((base64.length * 3) / 4),
      source: source.name,
      sourceKind: source.kind,
      format: imageFormat,
      warnings,
      takenAt: new Date().toISOString()
    };
  } catch (err) {
    if (err.code === 600) throw new HttpError(404, `Source "${source.name}" tidak ditemukan di OBS.`);
    throw new HttpError(502, 'Gagal mengambil screenshot: ' + (err.message || err));
  }
}

// Cek proses obs64.exe (hanya Windows, hanya jika OBS di komputer ini).
let procCache = { at: 0, value: null };
export function isObsProcessRunning() {
  if (process.platform !== 'win32') return Promise.resolve(null);
  if (Date.now() - procCache.at < 5000) return Promise.resolve(procCache.value);
  return new Promise((resolve) => {
    execFile('tasklist', ['/FI', 'IMAGENAME eq obs64.exe', '/NH'], { windowsHide: true }, (err, out) => {
      const value = err ? null : /obs64\.exe/i.test(out);
      procCache = { at: Date.now(), value };
      resolve(value);
    });
  });
}

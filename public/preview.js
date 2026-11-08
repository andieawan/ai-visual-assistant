// Tahap 4: preview live dari OBS Virtual Camera dan mode monitor.
// Memakai helper dari app.js: $, show(), setBusy(). Dimuat setelah app.js.
// Analisis AI tidak terpengaruh: tombol Analisis tetap memakai snapshot dari OBS WebSocket.

const PREF_KEY = 'ava.preview';
const SIGNAL_TIMEOUT_MS = 3000;

const video = $('liveVideo');
const modeSel = $('previewMode');
const devSel = $('videoDevice');

let stream = null;
let signalTimer = null;
let lastFrameAt = 0;

// ---------- Preferensi (disimpan di browser ini saja) ----------
function loadPref() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch { return {}; }
}

function savePref() {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify({ mode: modeSel.value, device: devSel.value }));
  } catch { /* localStorage tidak tersedia: abaikan */ }
}

// ---------- Daftar kamera ----------
async function listDevices() {
  const all = await navigator.mediaDevices.enumerateDevices();
  const cams = all.filter((d) => d.kind === 'videoinput');
  const prev = devSel.value || loadPref().device || '';

  devSel.length = 1; // sisakan opsi "(pilih kamera)"
  cams.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || `Kamera ${i + 1}`;
    devSel.appendChild(opt);
  });

  if (cams.some((d) => d.deviceId === prev)) {
    devSel.value = prev;
  } else {
    // Otomatis pilih OBS Virtual Camera jika ada. Kamera lain tidak dipilih otomatis.
    const obs = cams.find((d) => /obs/i.test(d.label));
    devSel.value = obs ? obs.deviceId : '';
  }
  return cams;
}

// Label kamera baru terlihat setelah izin kamera diberikan sekali.
async function ensureLabels() {
  const cams = await listDevices();
  if (cams.length && cams.every((d) => !d.label)) {
    const tmp = await navigator.mediaDevices.getUserMedia({ video: true });
    tmp.getTracks().forEach((t) => t.stop());
    await listDevices();
  }
}

// ---------- UI sumber live ----------
function setLiveUi(on) {
  const img = $('previewImg');
  if (on) img.hidden = true;
  video.hidden = !on;
  $('previewEmpty').hidden = on || !img.hidden ? true : false;
  setBusy($('btnRefresh'), on, 'Preview live aktif');
  if (!on) $('noSignal').hidden = true;
}

function fallbackToSnapshot(msg) {
  stopLive();
  modeSel.value = 'snapshot';
  savePref();
  show($('warnBox'), msg, 'alert-warn');
}

function checkSignal() {
  if (!stream) return;
  const lost = performance.now() - lastFrameAt > SIGNAL_TIMEOUT_MS;
  $('noSignal').hidden = !lost;
}

// ---------- Mulai dan hentikan live ----------
async function startLive() {
  stopLive();

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return fallbackToSnapshot(
      'Browser ini tidak mengizinkan akses kamera. Buka dashboard lewat http://127.0.0.1:3000, bukan alamat IP lain.'
    );
  }

  try {
    await ensureLabels();
    const deviceId = devSel.value;
    if (!deviceId) {
      return fallbackToSnapshot(
        'OBS Virtual Camera belum terdeteksi. Di OBS, klik Tools → Start Virtual Camera, lalu pilih mode Live lagi.'
      );
    }

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: { exact: deviceId },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 }
      },
      audio: false
    });
  } catch (err) {
    stream = null;
    const reason = err.name === 'NotAllowedError' ? 'izin kamera ditolak' : err.message;
    return fallbackToSnapshot(`Kamera tidak bisa dibuka: ${reason}.`);
  }

  const track = stream.getVideoTracks()[0];
  const actual = track.getSettings().deviceId;
  if (actual && [...devSel.options].some((o) => o.value === actual)) devSel.value = actual;
  savePref();

  track.addEventListener('ended', () => {
    stopLive();
    modeSel.value = 'snapshot';
    show($('warnBox'), 'Sumber kamera terputus. Pastikan OBS Virtual Camera masih aktif.', 'alert-warn');
  });

  video.srcObject = stream;
  video.play().catch(() => { /* autoplay dibatasi: video tetap muncul saat diklik */ });

  lastFrameAt = performance.now();
  watchFrames();
  signalTimer = setInterval(checkSignal, 1000);
  setLiveUi(true);
  show($('warnBox'), '');
}

function stopLive() {
  if (signalTimer) { clearInterval(signalTimer); signalTimer = null; }
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  video.srcObject = null;
  setLiveUi(false);
}

// Catat waktu setiap frame untuk mendeteksi sinyal hilang.
video.addEventListener('timeupdate', () => { lastFrameAt = performance.now(); });

function watchFrames() {
  if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) return;
  const loop = () => {
    if (!stream) return;
    lastFrameAt = performance.now();
    video.requestVideoFrameCallback(loop);
  };
  video.requestVideoFrameCallback(loop);
}

// ---------- Mode monitor ----------
function enterMonitor() {
  document.body.classList.add('monitor-mode');
  const el = document.documentElement;
  if (el.requestFullscreen && !document.fullscreenElement) {
    el.requestFullscreen().catch(() => { /* fullscreen ditolak: mode monitor tetap aktif */ });
  }
}

function exitMonitor() {
  document.body.classList.remove('monitor-mode');
  if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
}

// ---------- Event ----------
modeSel.addEventListener('change', async () => {
  savePref();
  if (modeSel.value === 'live') await startLive();
  else stopLive();
});

devSel.addEventListener('change', async () => {
  savePref();
  if (modeSel.value === 'live') await startLive();
});

$('btnMonitor').addEventListener('click', enterMonitor);
$('btnExitMonitor').addEventListener('click', exitMonitor);

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) document.body.classList.remove('monitor-mode');
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('monitor-mode')) exitMonitor();
});

// ---------- Init ----------
(async () => {
  const pref = loadPref();
  if (pref.mode === 'live' || pref.mode === 'snapshot') modeSel.value = pref.mode;
  if (modeSel.value === 'live') await startLive();
})();

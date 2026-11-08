const $ = (id) => document.getElementById(id);

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function show(el, text, cls) {
  el.textContent = text;
  if (cls) el.className = 'alert ' + cls;
  el.hidden = !text;
}

function setBusy(btn, busy, label) {
  if (!btn.dataset.label) btn.dataset.label = btn.textContent;
  btn.disabled = busy;
  btn.textContent = busy ? label : btn.dataset.label;
}

// ---------- Status OBS ----------
async function refreshStatus() {
  try {
    const s = await api('/api/status');
    const badge = $('obsBadge');
    if (s.connected) {
      badge.textContent = 'Connected';
      badge.className = 'badge badge-on';
      $('infoObs').textContent = `OBS ${s.obsVersion} · WebSocket ${s.wsVersion}`;
      show($('obsError'), '');
    } else {
      badge.textContent = s.connecting ? 'Menghubungkan...' : 'Disconnected';
      badge.className = 'badge ' + (s.connecting ? 'badge-wait' : 'badge-off');
      $('infoObs').textContent = '-';
      let msg = s.lastError || 'OBS belum terhubung.';
      if (s.obsProcess === false) msg = 'OBS Studio tidak berjalan di komputer ini. Buka OBS terlebih dahulu.';
      show($('obsError'), msg, 'alert-error');
    }
  } catch {
    $('obsBadge').textContent = 'Server mati';
    $('obsBadge').className = 'badge badge-off';
    show($('obsError'), 'Backend tidak merespons. Jalankan start.bat.', 'alert-error');
  }
}

// ---------- Preview ----------
async function refreshPreview() {
  const btn = $('btnRefresh');
  setBusy(btn, true, 'Mengambil...');
  try {
    const shot = await api('/api/obs/screenshot');
    const img = $('previewImg');
    img.onload = () => {
      $('infoRes').textContent = `${img.naturalWidth} × ${img.naturalHeight} px (${shot.format.toUpperCase()})`;
    };
    img.src = shot.image;
    img.hidden = false;
    $('previewEmpty').hidden = true;
    $('infoSource').textContent = `${shot.source} [${shot.sourceKind}]`;
    $('infoSize').textContent = `${(shot.bytes / 1024).toFixed(1)} KB`;
    $('infoTime').textContent = new Date(shot.takenAt).toLocaleTimeString('id-ID');
    show($('warnBox'), shot.warnings.join(' '), 'alert-warn');
    show($('obsError'), '');
  } catch (err) {
    show($('obsError'), err.message, 'alert-error');
  } finally {
    setBusy(btn, false);
  }
}

async function testConnection() {
  const btn = $('btnTest');
  setBusy(btn, true, 'Menguji...');
  try {
    const s = await api('/api/obs/test', { method: 'POST' });
    show($('obsError'), '');
    show($('warnBox'), `Koneksi berhasil: OBS ${s.obsVersion}, WebSocket ${s.wsVersion}.`, 'alert-ok');
    await loadInputs();
  } catch (err) {
    show($('obsError'), err.message, 'alert-error');
  } finally {
    setBusy(btn, false);
    refreshStatus();
  }
}

// ---------- Pengaturan ----------
async function loadInputs() {
  const select = $('obsSource');
  const current = select.dataset.saved || '';
  try {
    const { inputs } = await api('/api/obs/inputs');
    select.length = 1; // sisakan opsi "Otomatis"
    for (const i of inputs) {
      const opt = document.createElement('option');
      opt.value = i.name;
      opt.textContent = i.name + (i.isCapture ? ' (capture card)' : i.isLocalScreen ? ' (layar komputer 2!)' : '');
      select.appendChild(opt);
    }
    if (current && !inputs.some((i) => i.name === current)) {
      const opt = document.createElement('option');
      opt.value = current;
      opt.textContent = current + ' (tidak ditemukan)';
      select.appendChild(opt);
    }
    select.value = current;
  } catch (err) {
    show($('settingsMsg'), err.message, 'alert-error');
  }
}

async function loadSettings() {
  const s = await api('/api/settings');
  $('obsHost').value = s.obs.host;
  $('obsPort').value = s.obs.port;
  $('obsPassword').placeholder = s.obs.hasPassword ? '(tersimpan, kosongkan jika tidak diubah)' : '(belum diatur)';
  $('obsSource').dataset.saved = s.obs.sourceName;
  $('capWidth').value = String(s.capture.width);
  $('capFormat').value = s.capture.format;
  $('capQuality').value = s.capture.quality;
  $('capQualityVal').textContent = s.capture.quality;
}

async function saveSettings(e) {
  e.preventDefault();
  const body = {
    obs: {
      host: $('obsHost').value.trim(),
      port: Number($('obsPort').value),
      sourceName: $('obsSource').value
    },
    capture: {
      width: Number($('capWidth').value),
      format: $('capFormat').value,
      quality: Number($('capQuality').value)
    }
  };
  if ($('obsClearPw').checked) body.obs.clearPassword = true;
  else if ($('obsPassword').value) body.obs.password = $('obsPassword').value;

  try {
    const r = await api('/api/settings', { method: 'POST', body: JSON.stringify(body) });
    $('obsPassword').value = '';
    $('obsClearPw').checked = false;
    await loadSettings();
    if (r.reconnectError) show($('settingsMsg'), 'Tersimpan, tetapi koneksi OBS gagal: ' + r.reconnectError, 'alert-warn');
    else show($('settingsMsg'), 'Pengaturan tersimpan.', 'alert-ok');
    refreshStatus();
  } catch (err) {
    show($('settingsMsg'), err.message, 'alert-error');
  }
}

// ---------- Init ----------
$('btnRefresh').addEventListener('click', refreshPreview);
$('btnTest').addEventListener('click', testConnection);
$('btnLoadInputs').addEventListener('click', loadInputs);
$('settingsForm').addEventListener('submit', saveSettings);
$('capQuality').addEventListener('input', (e) => { $('capQualityVal').textContent = e.target.value; });

(async () => {
  try { await loadSettings(); } catch { /* status akan menampilkan error */ }
  await refreshStatus();
  if ($('obsBadge').textContent === 'Connected') loadInputs();
  setInterval(refreshStatus, 3000);
})();

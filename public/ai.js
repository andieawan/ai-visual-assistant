// Logika Tahap 3: analisis AI, hasil, dan pengaturan AI.
// Memakai helper dari app.js: $, api(), show().

const LABELS = { gemini: 'Gemini API', claude: 'Claude CLI' };
let analyzing = false;
let lastResultText = '';

// ---------- Analisis ----------
function setAnalyzing(on) {
  const btn = $('btnAnalyze');
  btn.disabled = on;
  btn.textContent = on ? 'MENGANALISIS...' : 'ANALISIS TAMPILAN';
  $('analyzeProgress').hidden = !on;
}

async function runAnalysis() {
  if (analyzing) return;
  analyzing = true;
  show($('analyzeError'), '');
  show($('analyzeNote'), '');
  setAnalyzing(true);

  const started = Date.now();
  const stageText = () => {
    const sec = Math.floor((Date.now() - started) / 1000);
    return `Mengambil screenshot dan mengirim ke AI... ${sec} dtk`;
  };
  $('analyzeStage').textContent = stageText();
  const ticker = setInterval(() => { $('analyzeStage').textContent = stageText(); }, 1000);

  try {
    const instruction = $('instruction').value.trim();
    const r = await api('/api/analyze', {
      method: 'POST',
      body: JSON.stringify({ instruction })
    });
    renderResult(r);
  } catch (err) {
    show($('analyzeError'), err.message, 'alert-error');
  } finally {
    clearInterval(ticker);
    analyzing = false;
    setAnalyzing(false);
  }
}

function renderResult(r) {
  lastResultText = r.text;
  $('resultText').textContent = r.text;
  $('resultBox').hidden = false;
  $('resultEmpty').hidden = true;

  const parts = [`Dijawab oleh ${r.providerLabel}`, r.model];
  if (r.usage && r.usage.totalTokens != null) {
    parts.push(`${r.usage.totalTokens} token (masuk ${r.usage.inputTokens}, keluar ${r.usage.outputTokens})`);
  }
  if (r.costUsd != null) parts.push(`estimasi $${r.costUsd.toFixed(4)}`);
  parts.push(`${(r.durationMs / 1000).toFixed(1)} detik`);
  $('resultMeta').textContent = parts.join(' · ');
  $('providerChip').textContent = r.providerLabel;

  const notes = [];
  if (r.fallbackFrom) {
    notes.push(`${LABELS[r.fallbackFrom]} tidak bisa dipakai (${r.fallbackReason}). Otomatis pindah ke ${r.providerLabel}.`);
  }
  if (r.warnings && r.warnings.length) notes.push(r.warnings.join(' '));
  if (notes.length) show($('analyzeNote'), notes.join(' '), 'alert-warn');
}

// ---------- Status AI ----------
function setStatus(id, text, ok) {
  const el = $(id);
  el.textContent = text;
  el.className = 'status-line ' + (ok === true ? 'ok' : ok === false ? 'bad' : '');
}

async function checkAi() {
  const btn = $('btnCheckAi');
  btn.disabled = true;
  try {
    const s = await api('/api/ai/status');
    setStatus('geminiStatus',
      s.gemini.configured
        ? `Gemini: key tersimpan di .env · model ${s.gemini.model}`
        : 'Gemini: GEMINI_API_KEY belum diisi di file .env', s.gemini.configured);
    setStatus('claudeStatus',
      s.claude.available
        ? `Claude CLI: ${s.claude.version}`
        : `Claude CLI: tidak terdeteksi. ${s.claude.error}`, s.claude.available);
  } catch (err) {
    setStatus('geminiStatus', 'Gemini: gagal memeriksa status', false);
    setStatus('claudeStatus', 'Claude CLI: gagal memeriksa status', false);
  } finally {
    btn.disabled = false;
  }
}

// ---------- Pengaturan AI ----------
async function loadAiSettings() {
  const s = await api('/api/settings');
  $('aiProvider').value = s.ai.provider;
  $('aiFallback').checked = s.ai.fallback;
  setGeminiOption(s.ai.geminiModel);
  $('claudeModel').value = s.ai.claudeModel;
  $('claudeCommand').value = s.ai.claudeCommand;
  $('providerChip').textContent = LABELS[s.ai.provider];
}

async function saveAiSettings(e) {
  e.preventDefault();
  const body = {
    ai: {
      provider: $('aiProvider').value,
      fallback: $('aiFallback').checked,
      geminiModel: $('geminiModel').value.trim(),
      claudeModel: $('claudeModel').value.trim(),
      claudeCommand: $('claudeCommand').value.trim()
    }
  };
  try {
    await api('/api/settings', { method: 'POST', body: JSON.stringify(body) });
    await loadAiSettings();
    show($('aiMsg'), 'Pengaturan AI tersimpan.', 'alert-ok');
    checkAi();
  } catch (err) {
    show($('aiMsg'), err.message, 'alert-error');
  }
}

// ---------- Daftar model Gemini ----------
// Pastikan model yang tersimpan ada di dropdown, lalu pilih model itu.
function setGeminiOption(id) {
  const select = $('geminiModel');
  if (id && ![...select.options].some((o) => o.value === id)) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = id;
    select.insertBefore(opt, select.firstChild);
  }
  if (id) select.value = id;
}

async function loadModels() {
  const btn = $('btnLoadModels');
  btn.disabled = true;
  btn.textContent = 'Memuat...';
  $('modelsInfo').textContent = '';
  try {
    const { models } = await api('/api/ai/models');
    const select = $('geminiModel');
    const current = select.value;
    select.innerHTML = '';
    for (const m of models) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.displayName && m.displayName !== m.id ? `${m.id} (${m.displayName})` : m.id;
      select.appendChild(opt);
    }
    setGeminiOption(current);
    $('modelsInfo').textContent = `${models.length} model tersedia. Pilih dari daftar Model Gemini.`;
    $('modelsInfo').className = 'muted small';
  } catch (err) {
    $('modelsInfo').textContent = err.message;
    $('modelsInfo').className = 'small alert-error';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Muat daftar model';
  }
}

// ---------- Init ----------
$('btnLoadModels').addEventListener('click', loadModels);
$('btnAnalyze').addEventListener('click', runAnalysis);
$('btnCheckAi').addEventListener('click', checkAi);
$('aiForm').addEventListener('submit', saveAiSettings);

$('instruction').addEventListener('input', (e) => {
  $('instructionCount').textContent = `${e.target.value.length} / 2000`;
});
$('instruction').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.ctrlKey) {
    e.preventDefault();
    runAnalysis();
  }
});

$('btnCopy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(lastResultText);
    $('btnCopy').textContent = 'Tersalin';
    setTimeout(() => { $('btnCopy').textContent = 'Salin'; }, 1500);
  } catch {
    show($('analyzeError'), 'Gagal menyalin. Salin manual dari teks hasil.', 'alert-error');
  }
});

(async () => {
  try { await loadAiSettings(); } catch { /* ditampilkan oleh status */ }
  checkAi();
})();

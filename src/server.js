import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSettings, getGeminiKey, publicSettings, saveSettings } from './config.js';
import { validateObs, validateCapture, validateAi, isLoopback } from './validate.js';
import {
  connect, getState, listInputs, takeScreenshot, isObsProcessRunning, HttpError
} from './obs.js';
import { analyzeScreen } from './ai.js';
import { checkClaude } from './providers/claude-cli.js';
import { listModels } from './providers/gemini.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOST = '127.0.0.1'; // hanya bisa diakses dari komputer ini
const PORT = Number(process.env.APP_PORT) || 3000;
const MAX_INSTRUCTION = 2000;

const app = express();
app.disable('x-powered-by');

// Tolak akses dengan Host header asing (mencegah DNS rebinding).
app.use((req, res, next) => {
  const host = (req.headers.host || '').split(':')[0];
  if (host !== '127.0.0.1' && host !== 'localhost') return res.status(403).send('Forbidden');
  next();
});

app.use(express.json({ limit: '20kb' }));
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use(express.static(path.join(__dirname, '..', 'public')));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// ---------- Status ----------
app.get('/api/status', wrap(async (req, res) => {
  const s = getSettings();
  const obsProcess = isLoopback(s.obs.host) ? await isObsProcessRunning() : null;
  res.json({ ...getState(), obsProcess, host: s.obs.host, port: s.obs.port, sourceName: s.obs.sourceName });
}));

// ---------- OBS ----------
app.post('/api/obs/test', wrap(async (req, res) => {
  const state = await connect();
  res.json({ ok: true, ...state });
}));

app.get('/api/obs/inputs', wrap(async (req, res) => {
  res.json({ inputs: await listInputs() });
}));

app.get('/api/obs/screenshot', wrap(async (req, res) => {
  res.json(await takeScreenshot());
}));

// ---------- AI ----------
app.get('/api/ai/status', wrap(async (req, res) => {
  const ai = getSettings().ai;
  res.json({
    provider: ai.provider,
    fallback: ai.fallback,
    gemini: { configured: getGeminiKey().length > 0, model: ai.geminiModel },
    claude: await checkClaude(ai.claudeCommand)
  });
}));

app.get('/api/ai/models', wrap(async (req, res) => {
  try {
    res.json({ models: await listModels() });
  } catch (err) {
    throw new HttpError(502, err.message);
  }
}));

app.post('/api/analyze', wrap(async (req, res) => {
  const body = req.body || {};
  const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
  if (instruction.length > MAX_INSTRUCTION) {
    throw new HttpError(400, `Instruksi maksimal ${MAX_INSTRUCTION} karakter.`);
  }
  if (body.provider !== undefined && !['gemini', 'claude'].includes(body.provider)) {
    throw new HttpError(400, 'Penyedia AI tidak valid.');
  }
  res.json(await analyzeScreen({ instruction, provider: body.provider }));
}));

// ---------- Pengaturan ----------
app.get('/api/settings', (req, res) => {
  res.json(publicSettings());
});

app.post('/api/settings', wrap(async (req, res) => {
  const body = req.body || {};
  const current = getSettings();
  const obsResult = validateObs(body.obs || {}, current.obs);
  const capResult = validateCapture(body.capture || {}, current.capture);
  const aiResult = validateAi(body.ai || {}, current.ai);
  const errors = [...obsResult.errors, ...capResult.errors, ...aiResult.errors];
  if (errors.length) throw new HttpError(400, errors.join(' '));

  const connChanged = ['host', 'port', 'password'].some((k) => obsResult.next[k] !== current.obs[k]);
  saveSettings({ obs: obsResult.next, capture: capResult.next, ai: aiResult.next });

  let reconnectError = null;
  if (connChanged) {
    try { await connect(); } catch (err) { reconnectError = err.message; }
  }
  res.json({ ok: true, settings: publicSettings(), reconnectError });
}));

// ---------- Error handler ----------
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err.message);
  res.status(status).json({ error: err.message || 'Terjadi kesalahan di server.' });
});

app.listen(PORT, HOST, () => {
  console.log(`AI Visual Assistant berjalan di http://${HOST}:${PORT}`);
  const { host, port } = getSettings().obs;
  console.log(`Menghubungkan ke OBS ws://${host}:${port} ...`);
  connect()
    .then((s) => console.log(`OBS terhubung: OBS ${s.obsVersion}, WebSocket ${s.wsVersion}`))
    .catch((err) => console.log(`OBS belum terhubung: ${err.message}`));
});

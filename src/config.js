import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, '..', 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const defaults = {
  obs: {
    host: process.env.OBS_HOST || '127.0.0.1',
    port: Number(process.env.OBS_PORT) || 4455,
    password: process.env.OBS_PASSWORD || '',
    sourceName: process.env.OBS_SOURCE || ''
  },
  capture: {
    width: 1280,   // 0 = resolusi asli
    quality: 75,   // 30-100, khusus JPG
    format: 'jpg'  // jpg | png
  },
  ai: {
    provider: 'gemini',                 // gemini | claude
    fallback: true,                     // pindah ke penyedia lain jika kuota habis
    geminiModel: 'gemini-2.5-flash',
    claudeModel: '',                    // kosong = model default Claude Code
    claudeCommand: process.env.CLAUDE_COMMAND || 'claude'
  }
};

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return {
      obs: { ...defaults.obs, ...saved.obs },
      capture: { ...defaults.capture, ...saved.capture },
      ai: { ...defaults.ai, ...saved.ai }
    };
  } catch {
    return structuredClone(defaults);
  }
}

let settings = load();

export function getSettings() {
  return settings;
}

// API key Gemini hanya dibaca dari .env (atau environment), tidak pernah disimpan di settings.json.
export function getGeminiKey() {
  return (process.env.GEMINI_API_KEY || '').trim();
}

// Versi aman untuk frontend: password dan API key tidak pernah dikirim.
export function publicSettings() {
  const { password, ...obs } = settings.obs;
  return {
    obs: { ...obs, hasPassword: password.length > 0 },
    capture: { ...settings.capture },
    ai: { ...settings.ai, hasGeminiKey: getGeminiKey().length > 0 }
  };
}

export function saveSettings(next) {
  settings = next;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

import { getSettings } from './config.js';
import { HttpError, takeScreenshot } from './obs.js';
import { ProviderError } from './providers/errors.js';
import * as gemini from './providers/gemini.js';
import * as claude from './providers/claude-cli.js';

const PROVIDERS = { gemini, claude };
export const LABELS = { gemini: 'Gemini API', claude: 'Claude CLI' };
const DEFAULT_INSTRUCTION = 'Jelaskan apa yang sedang terjadi pada layar ini secara singkat dan jelas.';
const MIME = { jpg: 'image/jpeg', png: 'image/png' };

let busy = false; // satu analisis dalam satu waktu

// Urutan penyedia: penyedia utama dulu, lalu cadangan jika fallback aktif.
function providerOrder(primary, fallback) {
  if (!fallback) return [primary];
  return [primary, primary === 'gemini' ? 'claude' : 'gemini'];
}

export async function analyzeScreen({ instruction, provider } = {}) {
  if (busy) throw new HttpError(429, 'Analisis sebelumnya masih berjalan. Tunggu sampai selesai.');
  busy = true;
  const started = Date.now();

  try {
    const ai = getSettings().ai;
    const text = (instruction || '').trim() || DEFAULT_INSTRUCTION;

    // Screenshot diambil sekali, lalu dipakai untuk penyedia mana pun (tidak diambil ulang saat pindah).
    const shot = await takeScreenshot();
    const base64 = shot.image.split(',')[1] || '';
    const order = providerOrder(provider || ai.provider, ai.fallback);

    const failures = [];
    let fallbackFrom = null;
    let fallbackReason = null;

    for (const name of order) {
      try {
        const result = await PROVIDERS[name].analyze({
          base64,
          mimeType: MIME[shot.format] || 'image/jpeg',
          ext: shot.format === 'png' ? 'png' : 'jpg',
          instruction: text,
          settings: ai
        });

        return {
          text: result.text,
          provider: name,
          providerLabel: LABELS[name],
          model: result.model,
          usage: result.usage,
          costUsd: result.costUsd ?? null,
          fallbackFrom,
          fallbackReason,
          warnings: shot.warnings,
          source: shot.source,
          durationMs: Date.now() - started
        };
      } catch (err) {
        if (!(err instanceof ProviderError)) throw err;
        failures.push(`${LABELS[name]}: ${err.message}`);

        const canFallback = (err.kind === 'quota' || err.kind === 'config') && name !== order[order.length - 1];
        if (!canFallback) {
          throw new HttpError(502, failures.join(' | '));
        }
        fallbackFrom = name;
        fallbackReason = err.message;
      }
    }

    throw new HttpError(502, failures.join(' | '));
  } finally {
    busy = false;
  }
}

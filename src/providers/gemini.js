import { GoogleGenAI } from '@google/genai';
import { getGeminiKey } from '../config.js';
import { ProviderError } from './errors.js';

const SYSTEM_PROMPT = [
  'Kamu menganalisis SATU tangkapan layar yang baru diberikan.',
  'Jawab dalam Bahasa Indonesia, ringkas, dan sesuai instruksi pengguna.',
  'Jika gambar hitam, kabur, atau tidak jelas, katakan itu.',
  'Jangan mengarang isi layar yang tidak terlihat.'
].join(' ');

function classify(err) {
  const status = err?.status;
  const msg = String(err?.message || err);

  if (status === 429 || /RESOURCE_EXHAUSTED|quota|rate limit/i.test(msg)) {
    return new ProviderError('quota', 'Kuota Gemini habis atau terlalu banyak permintaan dalam waktu singkat.');
  }
  if (status === 401 || status === 403 || /API key not valid|API_KEY_INVALID/i.test(msg)) {
    return new ProviderError('config', 'API key Gemini tidak valid atau tidak punya akses.');
  }
  if (status === 404 || /not found/i.test(msg)) {
    return new ProviderError('error', 'Model Gemini tidak ditemukan. Periksa nama model di Pengaturan AI.');
  }
  return new ProviderError('error', 'Gagal menghubungi Gemini: ' + msg.slice(0, 300));
}

function createClient() {
  const apiKey = getGeminiKey();
  if (!apiKey) {
    throw new ProviderError('config', 'GEMINI_API_KEY belum diisi di file .env.');
  }
  const httpOptions = process.env.GEMINI_BASE_URL ? { baseUrl: process.env.GEMINI_BASE_URL } : undefined;
  return new GoogleGenAI({ apiKey, httpOptions });
}

// Daftar model yang bisa dipakai untuk generateContent (dipakai tombol "Muat daftar model").
export async function listModels() {
  const ai = createClient();
  try {
    const pager = await ai.models.list({ config: { pageSize: 100 } });
    const models = [];
    for await (const m of pager) {
      const actions = m.supportedActions || [];
      if (!actions.includes('generateContent')) continue;
      const id = String(m.name || '').replace(/^models\//, '');
      if (!id.startsWith('gemini')) continue;
      models.push({ id, displayName: m.displayName || id });
    }
    models.sort((a, b) => a.id.localeCompare(b.id));
    return models;
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw classify(err);
  }
}

export async function analyze({ base64, mimeType, instruction, settings }) {
  const ai = createClient();

  try {
    const res = await ai.models.generateContent({
      model: settings.geminiModel,
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: base64 } },
          { text: instruction }
        ]
      }],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        maxOutputTokens: 1024,
        temperature: 0.4
      }
    });

    const text = (res.text || '').trim();
    if (!text) {
      throw new ProviderError('error', 'Gemini tidak mengembalikan teks. Jawabannya mungkin diblokir filter keamanan.');
    }

    const u = res.usageMetadata || {};
    return {
      text,
      model: settings.geminiModel,
      usage: {
        inputTokens: u.promptTokenCount ?? null,
        outputTokens: u.candidatesTokenCount ?? null,
        totalTokens: u.totalTokenCount ?? null
      }
    };
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw classify(err);
  }
}

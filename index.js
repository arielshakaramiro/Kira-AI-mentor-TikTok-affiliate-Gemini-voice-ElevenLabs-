// index.js
// REST endpoint untuk chatbot Kira yang berinteraksi dengan Gemini AI.
// Express app + integrasi Gemini, auth/DB opsional, dan frontend statis /public.
//
// Catatan keamanan: endpoint chat dilindungi rate limit per IP. Untuk menutup
// celah pemakaian kuota Gemini oleh sembarang orang, set REQUIRE_AUTH=1 supaya
// hanya user login yang bisa memakai (lihat lib/auth.js -> chatAuthGuard).

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

import {
  validateChatBody, toGeminiContents, buildGenerationConfig, buildNicheHint,
  isRetryableError, isNetworkError,
} from './lib/chat-core.js';
import { logger, requestLogger, recordUsage, extractUsage, getUsageSnapshot } from './lib/logger.js';
import { attachUser, chatAuthGuard } from './lib/auth.js';
import { accountRouter } from './lib/routes-account.js';
import { logUsage } from './lib/sessions-repo.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

// --- Konfigurasi ElevenLabs (Text-to-Speech) ------------------------------
// Suara Kira pakai ElevenLabs supaya natural & human. Key HANYA dipakai di
// server (tidak pernah dikirim ke browser). Kalau key kosong, frontend otomatis
// fallback ke speechSynthesis bawaan browser, jadi app tetap jalan.
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
// Voice default: "Sarah" (perempuan, hangat & natural). Bisa diganti via env.
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL';
// Model multilingual v2 mendukung Bahasa Indonesia dengan baik.
const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';

// Pastikan API key tersedia sebelum server dijalankan.
if (!process.env.GEMINI_API_KEY) {
  logger.error('missing_api_key', { hint: 'Salin .env.example menjadi .env lalu isi GEMINI_API_KEY.' });
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// --- Inisialisasi Express -------------------------------------------------
const app = express();
app.use(cors());
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '8mb' }));
app.use(requestLogger);     // log tiap request (JSON terstruktur)
app.use(attachUser);        // lampirkan req.user bila ada token valid (opsional)
app.use(express.static(path.join(__dirname, 'public')));

// Rate limiter: batasi request chat per IP (lindungi kuota Gemini & cegah abuse).
const chatLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000,
  max: Number(process.env.RATE_LIMIT_MAX) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Wah, kebanyakan request nih bestie. Santai dulu sebentar ya, coba lagi nanti 🙏' },
});

// Endpoint auth + sesi (register/login/logout/me, CRUD sesi chat).
app.use('/api', accountRouter);

// --- Pemanggilan Gemini dengan retry + backoff ----------------------------
async function generateStreamWithRetry(params, { maxRetries = 3, baseDelayMs = 800 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await ai.models.generateContentStream(params);
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error) || attempt === maxRetries) break;
      const delay = baseDelayMs * 2 ** attempt;
      logger.warn('gemini_stream_retry', { attempt: attempt + 1, maxRetries, delayMs: delay, code: error?.status || error?.code || 'network' });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

async function generateWithRetry(params, { maxRetries = 3, baseDelayMs = 800 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await ai.models.generateContent(params);
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error) || attempt === maxRetries) break;
      const delay = baseDelayMs * 2 ** attempt;
      logger.warn('gemini_retry', { attempt: attempt + 1, maxRetries, delayMs: delay, code: error?.status || error?.code || 'network' });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

// Catat metrik token ke logger + DB (best-effort, tidak boleh menggagalkan chat).
function track(endpoint, response, userId) {
  try {
    const usage = extractUsage(response);
    recordUsage({ endpoint, model: GEMINI_MODEL, usage, userId });
    logUsage({ userId, endpoint, model: GEMINI_MODEL, usage });
  } catch (e) {
    logger.warn('usage_tracking_failed', { error: e.message });
  }
}


// --- Endpoint chat (non-streaming) ----------------------------------------
app.post('/api/chat', chatLimiter, chatAuthGuard, async (req, res) => {
  try {
    const { niche, persona, temperature, topP, topK, format, webSearch, urlContext } = req.body;

    const check = validateChatBody(req.body);
    if (!check.ok) return res.status(check.status).json({ error: check.error });
    const { conversation } = check;

    const nicheHint = buildNicheHint(niche);

    const response = await generateWithRetry({
      model: GEMINI_MODEL,
      contents: toGeminiContents(conversation),
      config: buildGenerationConfig({ temperature, topP, topK, persona, nicheHint, format, webSearch, urlContext }),
    });
    track('/api/chat', response, req.user?.id);

    const result = response.text;
    if (!result) return res.status(502).json({ error: 'Model tidak mengembalikan teks balasan.' });
    return res.json({ result });
  } catch (error) {
    logger.error('chat_failed', { error: error?.message, status: error?.status });
    let msg = 'Terjadi kesalahan saat memproses permintaan ke Gemini.';
    if (error?.status === 503 || error?.status === 429) {
      msg = 'Model Gemini lagi penuh nih bestie, coba kirim lagi sebentar lagi ya 🙏';
    } else if (isNetworkError(error)) {
      msg = 'Koneksi ke Gemini timeout/terputus. Cek internet kamu lalu coba lagi ya bestie 🌐';
    }
    return res.status(500).json({ error: msg });
  }
});

// --- Endpoint chat streaming (SSE) ----------------------------------------
app.post('/api/chat/stream', chatLimiter, chatAuthGuard, async (req, res) => {
  const { niche, persona, temperature, topP, topK, format, webSearch, urlContext } = req.body;

  const check = validateChatBody(req.body);
  if (!check.ok) return res.status(check.status).json({ error: check.error });
  const { conversation } = check;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sse = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const nicheHint = buildNicheHint(niche);

  try {
    const stream = await generateStreamWithRetry({
      model: GEMINI_MODEL,
      contents: toGeminiContents(conversation),
      config: buildGenerationConfig({ temperature, topP, topK, persona, nicheHint, format, webSearch, urlContext }),
    });

    let full = '';
    let lastChunk = null;
    for await (const chunk of stream) {
      lastChunk = chunk;
      const delta = chunk.text;
      if (delta) {
        full += delta;
        sse('chunk', { delta });
      }
    }
    track('/api/chat/stream', lastChunk, req.user?.id);

    if (!full) sse('error', { error: 'Model tidak mengembalikan teks balasan.' });
    else sse('done', { result: full });
  } catch (error) {
    logger.error('chat_stream_failed', { error: error?.message, status: error?.status });
    let msg = 'Terjadi kesalahan saat memproses permintaan ke Gemini.';
    if (error?.status === 503 || error?.status === 429) {
      msg = 'Model Gemini lagi penuh nih bestie, coba kirim lagi sebentar lagi ya 🙏';
    } else if (isNetworkError(error)) {
      msg = 'Koneksi ke Gemini timeout/terputus. Cek internet kamu lalu coba lagi ya bestie 🌐';
    }
    sse('error', { error: msg });
  } finally {
    res.end();
  }
});

// --- Endpoint Text-to-Speech (ElevenLabs) ---------------------------------
// Proxy ke ElevenLabs supaya API key tetap rahasia di server. Frontend kirim
// { text }, server balas audio mp3. Pakai rate limiter yang sama dengan chat
// untuk cegah abuse kuota TTS. Kalau key tidak diset, balas 503 supaya frontend
// fallback ke speechSynthesis browser.
app.post('/api/tts', chatLimiter, async (req, res) => {
  if (!ELEVENLABS_API_KEY) {
    return res.status(503).json({ error: 'TTS belum dikonfigurasi (ELEVENLABS_API_KEY kosong).' });
  }

  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text) return res.status(400).json({ error: 'Teks untuk diucapkan kosong.' });
  // Batasi panjang teks supaya tidak boros kuota & latency tetap rendah.
  if (text.length > 800) return res.status(400).json({ error: 'Teks TTS kepanjangan (maks 800 karakter).' });

  try {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}?output_format=mp3_44100_128`;
    const elRes = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_MODEL,
        // Setting suara: stability sedang + similarity tinggi = natural tapi stabil.
        voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.0, use_speaker_boost: true },
      }),
    });

    if (!elRes.ok) {
      let detail = '';
      try { detail = await elRes.text(); } catch { /* ignore */ }
      logger.error('tts_failed', { status: elRes.status, detail: detail.slice(0, 300) });
      // 401/402/429 dari ElevenLabs -> beri tahu frontend supaya fallback ke browser TTS.
      return res.status(502).json({ error: 'TTS sedang tidak tersedia, pakai suara browser dulu ya.' });
    }

    const audio = Buffer.from(await elRes.arrayBuffer());
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', String(audio.length));
    return res.end(audio);
  } catch (error) {
    logger.error('tts_error', { error: error?.message });
    return res.status(502).json({ error: 'TTS gagal diproses, pakai suara browser dulu ya.' });
  }
});

// --- Endpoint metrik (observability) --------------------------------------
// Ringkasan penggunaan token kumulatif sejak server hidup. Dilindungi dengan
// token sederhana lewat env METRICS_TOKEN (header x-metrics-token).
app.get('/api/metrics', (req, res) => {
  const expected = process.env.METRICS_TOKEN;
  if (expected && req.headers['x-metrics-token'] !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.json({ usage: getUsageSnapshot(), model: GEMINI_MODEL });
});

// --- Error handler ---------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Pesan kamu kepanjangan nih bestie, coba dipersingkat ya 🙏' });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Format request tidak valid (JSON rusak).' });
  }
  logger.error('unhandled_error', { error: err?.message });
  return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
});

app.listen(PORT, () => {
  logger.info('server_started', { port: PORT, model: GEMINI_MODEL, requireAuth: process.env.REQUIRE_AUTH === '1' });
});

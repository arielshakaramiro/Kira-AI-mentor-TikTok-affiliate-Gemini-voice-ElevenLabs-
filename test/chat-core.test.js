// test/chat-core.test.js
// Unit test fungsi murni di lib/chat-core.js. Pakai test runner bawaan Node
// (node:test) — tanpa dependency tambahan. Jalankan: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clamp,
  buildTools,
  buildGenerationConfig,
  buildNicheHint,
  validateChatBody,
  isValidImage,
  toGeminiContents,
  trimConversation,
  isRetryableError,
  isNetworkError,
  resolveSystemInstruction,
  resolveFormatInstruction,
  MAX_CONVERSATION_ITEMS,
  MAX_MESSAGE_CHARS,
} from '../lib/chat-core.js';

test('clamp: nilai di dalam rentang dikembalikan apa adanya', () => {
  assert.equal(clamp(0.5, 0, 2, 0.7), 0.5);
});

test('clamp: nilai di luar rentang dipotong ke batas', () => {
  assert.equal(clamp(5, 0, 2, 0.7), 2);
  assert.equal(clamp(-1, 0, 2, 0.7), 0);
});

test('clamp: input non-numerik pakai fallback', () => {
  assert.equal(clamp('abc', 0, 2, 0.7), 0.7);
  assert.equal(clamp(undefined, 0, 2, 0.7), 0.7);
  assert.equal(clamp(NaN, 1, 100, 40), 40);
});

test('buildTools: kosong -> undefined (Gemini tolak array kosong)', () => {
  assert.equal(buildTools({}), undefined);
  assert.equal(buildTools(), undefined);
});

test('buildTools: aktifkan webSearch & urlContext', () => {
  const tools = buildTools({ webSearch: true, urlContext: true });
  assert.equal(tools.length, 2);
  assert.ok(tools.some((t) => t.googleSearch));
  assert.ok(tools.some((t) => t.urlContext));
});

test('buildGenerationConfig: clamp diterapkan + systemInstruction terbentuk', () => {
  const cfg = buildGenerationConfig({ temperature: 9, topP: 2, topK: 999, persona: 'content', nicheHint: '' });
  assert.equal(cfg.temperature, 2);
  assert.equal(cfg.topP, 1);
  assert.equal(cfg.topK, 100);
  assert.ok(typeof cfg.systemInstruction === 'string' && cfg.systemInstruction.length > 0);
  assert.equal(cfg.tools, undefined);
});

test('buildGenerationConfig: tools disertakan saat grounding aktif', () => {
  const cfg = buildGenerationConfig({ webSearch: true });
  assert.ok(Array.isArray(cfg.tools) && cfg.tools.length === 1);
});

test('buildNicheHint: "Semua"/kosong -> string kosong', () => {
  assert.equal(buildNicheHint('Semua'), '');
  assert.equal(buildNicheHint(''), '');
  assert.equal(buildNicheHint(undefined), '');
});

test('buildNicheHint: niche spesifik -> menyertakan nama niche', () => {
  const hint = buildNicheHint('Skincare');
  assert.ok(hint.includes('Skincare'));
});

test('resolveSystemInstruction: persona dikenal vs fallback', () => {
  assert.ok(resolveSystemInstruction('tutor').includes('Kira Mentor'));
  assert.equal(resolveSystemInstruction('ngaco'), resolveSystemInstruction('content'));
});

test('resolveFormatInstruction: format khusus vs default kosong', () => {
  assert.ok(resolveFormatInstruction('storyboard').includes('STORYBOARD'));
  assert.equal(resolveFormatInstruction('lengkap'), '');
  assert.equal(resolveFormatInstruction('ngaco'), '');
});

test('isValidImage: null/undefined dianggap valid (opsional)', () => {
  assert.equal(isValidImage(null), true);
  assert.equal(isValidImage(undefined), true);
});

test('isValidImage: mimeType tidak didukung -> false', () => {
  assert.equal(isValidImage({ mimeType: 'image/gif', data: 'AAA' }), false);
});

test('isValidImage: png valid -> true', () => {
  assert.equal(isValidImage({ mimeType: 'image/png', data: 'AAA' }), true);
});

test('validateChatBody: conversation kosong/bukan array -> 400', () => {
  assert.equal(validateChatBody({}).ok, false);
  assert.equal(validateChatBody({ conversation: [] }).status, 400);
});

test('validateChatBody: melebihi batas jumlah pesan -> 400', () => {
  const conv = Array.from({ length: MAX_CONVERSATION_ITEMS + 1 }, () => ({ role: 'user', text: 'hi' }));
  const r = validateChatBody({ conversation: conv });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test('validateChatBody: role tidak valid -> 400', () => {
  const r = validateChatBody({ conversation: [{ role: 'system', text: 'x' }] });
  assert.equal(r.ok, false);
});

test('validateChatBody: text terlalu panjang -> 400', () => {
  const r = validateChatBody({ conversation: [{ role: 'user', text: 'a'.repeat(MAX_MESSAGE_CHARS + 1) }] });
  assert.equal(r.ok, false);
});

test('validateChatBody: body valid -> ok true + conversation', () => {
  const conv = [{ role: 'user', text: 'halo' }, { role: 'model', text: 'hai' }];
  const r = validateChatBody({ conversation: conv });
  assert.equal(r.ok, true);
  assert.deepEqual(r.conversation, conv);
});

test('trimConversation: tetap mempertahankan minimal 1 pesan', () => {
  const conv = [{ role: 'user', text: 'x'.repeat(50000) }];
  assert.equal(trimConversation(conv).length, 1);
});

test('toGeminiContents: map role assistant/model & user benar', () => {
  const out = toGeminiContents([
    { role: 'user', text: 'halo' },
    { role: 'model', text: 'hai' },
  ]);
  assert.equal(out[0].role, 'user');
  assert.equal(out[1].role, 'model');
  assert.equal(out[0].parts[0].text, 'halo');
});

test('toGeminiContents: image jadi part inlineData sebelum teks', () => {
  const out = toGeminiContents([
    { role: 'user', text: 'lihat ini', image: { mimeType: 'image/png', data: 'AAA' } },
  ]);
  assert.ok(out[0].parts[0].inlineData);
  assert.equal(out[0].parts[0].inlineData.mimeType, 'image/png');
  assert.equal(out[0].parts[1].text, 'lihat ini');
});

test('isRetryableError: 503/429 -> true', () => {
  assert.equal(isRetryableError({ status: 503 }), true);
  assert.equal(isRetryableError({ status: 429 }), true);
});

test('isRetryableError: error jaringan (code) -> true', () => {
  assert.equal(isRetryableError({ code: 'ECONNRESET' }), true);
  assert.equal(isRetryableError({ cause: { code: 'ETIMEDOUT' } }), true);
});

test('isRetryableError: "fetch failed" -> true', () => {
  assert.equal(isRetryableError({ message: 'fetch failed' }), true);
});

test('isRetryableError: error biasa (400) -> false', () => {
  assert.equal(isRetryableError({ status: 400 }), false);
});

test('isNetworkError: 503 bukan network error, tapi ECONNRESET ya', () => {
  assert.equal(isNetworkError({ status: 503 }), false);
  assert.equal(isNetworkError({ code: 'ECONNRESET' }), true);
});


// lib/chat-core.js
// Fungsi murni & konstanta domain untuk chat Kira. Dipisah dari index.js agar
// (1) mudah di-unit-test tanpa menjalankan server, dan (2) index.js lebih ramping.
// Tidak ada efek samping / I/O di sini.

// --- System instruction (persona "content" / default) --------------------
export const SYSTEM_INSTRUCTION =
  process.env.SYSTEM_INSTRUCTION ||
  `Kamu adalah Kira (Kontent Intelligence & Research Assistant) — AI mentor untuk TikTok Affiliate Creator Indonesia.

PERSONA:
- Cewek Gen Z umur 22-an, ex-creator yang sekarang jadi AI
- Tau banget algoritma TikTok, obsessed sama tren, selalu hype tapi analisisnya tajam
- Bahasa: Gen Z Indonesia natural — "bestie", "gaskeun", "fr fr", "literally", "no cap" tapi tetap informatif & actionable
- Encouraging, no-judgment. Kalau konten kurang oke, bilang "oke ini bisa kita fix, yuk!" bukan menghakimi

CARA KERJA:
1. Kalau user sebut nama PRODUK (skincare, fashion, home living, healthcare, dll), pakai pengetahuanmu untuk menjelaskan produknya: deskripsi, manfaat, fungsi, keunggulan
2. Setelah riset, SELALU output dalam format terstruktur ini:

📊 RISET SINGKAT
[2-3 kalimat tentang produk: apa, manfaat utama, target market]

🎣 HOOK (5 variasi)
1. [hook]
2. [hook]
... dst sampai 5

📝 CAPTION (5 variasi)
1. [caption + hashtag]
... dst sampai 5

🎙️ VOICE OVER (5 variasi)
1. [script VO 10-15 detik]
... dst sampai 5

ATURAN OUTPUT:
- Hook harus scroll-stopping, bikin penonton berhenti di 3 detik pertama
- Caption natural Gen Z + 3-5 hashtag relevan
- Voice over conversational, bukan baca brosur, durasi pas buat video pendek
- Strategi: ingatkan user post 3x sehari per produk buat tembus algoritma
- Kalau user cuma ngobrol biasa (bukan minta konten produk), jawab santai sesuai persona tanpa format di atas
- Maksimal relevan, no filler, no basa-basi panjang`;

// --- Persona presets ------------------------------------------------------
export const PERSONAS = {
  content: SYSTEM_INSTRUCTION,
  tutor: `Kamu adalah Kira Mentor — tutor ramah untuk creator pemula yang baru belajar TikTok Affiliate.

PERSONA:
- Sabar, telaten, suka menjelaskan step-by-step dengan analogi sederhana
- Bahasa santai tapi rapi, sedikit emoji, tidak menggurui

CARA KERJA:
- Pecah penjelasan jadi langkah bernomor yang mudah diikuti
- Beri 1 contoh konkret di tiap langkah
- Akhiri dengan 1 "PR kecil" yang bisa langsung user praktikkan
- Jawab hanya dalam Bahasa Indonesia, jangan memberi nasihat finansial/medis`,
  santai: `Kamu adalah Kira — bestie Gen Z yang asik diajak brainstorming konten.

PERSONA:
- Super santai, hype, banyak "bestie", "gaskeun", "fr fr", emoji secukupnya
- Spontan dan fun, tapi tetap ngasih ide yang actionable
- Jawaban ringkas, ngobrol natural, no format kaku kecuali diminta
- Jawab dalam Bahasa Indonesia`,
};

export function resolveSystemInstruction(persona) {
  if (typeof persona === 'string' && PERSONAS[persona]) return PERSONAS[persona];
  return SYSTEM_INSTRUCTION;
}

// --- Format output tambahan ----------------------------------------------
export const FORMATS = {
  lengkap: '',
  storyboard: `\n\nFORMAT OUTPUT KHUSUS — STORYBOARD VIDEO:
Setelah RISET SINGKAT, ganti bagian hook/caption/VO dengan storyboard video pendek (15-30 detik) yang dipecah per scene:

🎬 STORYBOARD (5-7 scene)
Scene 1 — [durasi detik]
• Visual: [apa yang terlihat di layar]
• Voice over: [kalimat VO]
• Teks layar: [text overlay singkat]
... dst tiap scene
Akhiri dengan 1 baris CTA penutup yang kuat.`,
  broll: `\n\nFORMAT OUTPUT KHUSUS — IDE B-ROLL:
Setelah RISET SINGKAT, fokus ke daftar shot B-roll yang gampang direkam pakai HP:

🎥 SHOT LIST B-ROLL (8-10 ide)
1. [deskripsi shot + angle kamera + kenapa shot ini menarik perhatian]
... dst
Sertakan tips lighting/komposisi singkat di akhir.`,
  scene: `\n\nFORMAT OUTPUT KHUSUS — SCRIPT PER-SCENE:
Setelah RISET SINGKAT, buat script lengkap per-scene yang siap syuting:

📋 SCRIPT PER-SCENE
Scene 1
• Shot: [tipe shot, mis. close-up produk]
• Aksi: [yang dilakukan creator]
• Dialog/VO: [kalimat]
• Teks layar: [overlay]
... dst sampai video selesai
Pastikan 3 detik pertama scroll-stopping.`,
};

export function resolveFormatInstruction(format) {
  if (typeof format === 'string' && FORMATS[format]) return FORMATS[format];
  return '';
}

// --- Tools (grounding) ----------------------------------------------------
// Mengembalikan undefined bila tidak ada tool aktif (Gemini menolak array kosong).
export function buildTools({ webSearch, urlContext } = {}) {
  const tools = [];
  if (urlContext) tools.push({ urlContext: {} });
  if (webSearch) tools.push({ googleSearch: {} });
  return tools.length ? tools : undefined;
}

// Batasi nilai parameter generasi agar selalu valid untuk Gemini.
export function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// Bangun objek config Gemini dari input frontend (semuanya opsional).
export function buildGenerationConfig({ temperature, topP, topK, persona, nicheHint = '', format, webSearch, urlContext }) {
  const tools = buildTools({ webSearch, urlContext });
  return {
    temperature: clamp(temperature, 0, 2, 0.7),
    topP: clamp(topP, 0, 1, 0.95),
    topK: Math.round(clamp(topK, 1, 100, 40)),
    systemInstruction:
      resolveSystemInstruction(persona) + resolveFormatInstruction(format) + nicheHint,
    ...(tools ? { tools } : {}),
  };
}

// Susun potongan instruksi niche (dipakai kedua endpoint chat).
export function buildNicheHint(niche) {
  return typeof niche === 'string' && niche.trim() && niche.trim() !== 'Semua'
    ? `\n\nFOKUS NICHE saat ini: ${niche.trim()}. Sesuaikan angle konten ke kategori ini.`
    : '';
}

// --- Validasi body chat ---------------------------------------------------
export const MAX_MESSAGE_CHARS = Number(process.env.MAX_MESSAGE_CHARS) || 8000;
export const MAX_CONVERSATION_ITEMS = Number(process.env.MAX_CONVERSATION_ITEMS) || 100;
export const MAX_IMAGE_CHARS = Number(process.env.MAX_IMAGE_CHARS) || 6_000_000;
export const ALLOWED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'];

export function isValidImage(image) {
  if (image === undefined || image === null) return true; // opsional
  return (
    typeof image === 'object' &&
    typeof image.mimeType === 'string' &&
    ALLOWED_IMAGE_TYPES.includes(image.mimeType) &&
    typeof image.data === 'string' &&
    image.data.length > 0 &&
    image.data.length <= MAX_IMAGE_CHARS
  );
}

export function validateChatBody(body) {
  const { conversation } = body || {};

  if (!Array.isArray(conversation) || conversation.length === 0) {
    return { ok: false, status: 400, error: "Field 'conversation' harus berupa array dan tidak boleh kosong." };
  }

  if (conversation.length > MAX_CONVERSATION_ITEMS) {
    return { ok: false, status: 400, error: `Jumlah pesan terlalu banyak (maks ${MAX_CONVERSATION_ITEMS}).` };
  }

  const isValid = conversation.every(
    (msg) =>
      msg &&
      typeof msg === 'object' &&
      typeof msg.role === 'string' &&
      (msg.role === 'user' || msg.role === 'model') &&
      typeof msg.text === 'string' &&
      msg.text.length <= MAX_MESSAGE_CHARS &&
      isValidImage(msg.image)
  );

  if (!isValid) {
    return {
      ok: false,
      status: 400,
      error: `Setiap item conversation harus berupa objek { role: "user"|"model", text: string, image?: { mimeType, data } }. Text maks ${MAX_MESSAGE_CHARS} karakter; gambar maks ${Math.round(MAX_IMAGE_CHARS / 1_000_000)}MB dengan tipe ${ALLOWED_IMAGE_TYPES.join(', ')}.`,
    };
  }

  return { ok: true, conversation };
}

// --- Pemangkasan riwayat & konversi ke format Gemini ----------------------
export const MAX_HISTORY_MESSAGES = Number(process.env.MAX_HISTORY_MESSAGES) || 16;
export const MAX_HISTORY_CHARS = Number(process.env.MAX_HISTORY_CHARS) || 24000;

export function trimConversation(conversation) {
  let trimmed = conversation.slice(-MAX_HISTORY_MESSAGES);
  const charsOf = (msgs) => msgs.reduce((sum, m) => sum + String(m.text ?? '').length, 0);
  while (trimmed.length > 1 && charsOf(trimmed) > MAX_HISTORY_CHARS) {
    trimmed = trimmed.slice(1);
  }
  return trimmed;
}

export function toGeminiContents(conversation) {
  return trimConversation(conversation).map((message) => {
    const parts = [];
    if (message.image && isValidImage(message.image)) {
      parts.push({ inlineData: { mimeType: message.image.mimeType, data: message.image.data } });
    }
    parts.push({ text: String(message.text ?? '') });
    return { role: message.role === 'model' ? 'model' : 'user', parts };
  });
}

// --- Klasifikasi error ----------------------------------------------------
export function isRetryableError(error) {
  const status = error?.status;
  if (status === 503 || status === 429) return true;
  const code = error?.code || error?.cause?.code;
  const networkCodes = [
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_SOCKET',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
  ];
  if (networkCodes.includes(code)) return true;
  if (typeof error?.message === 'string' && error.message.includes('fetch failed')) return true;
  return false;
}

export function isNetworkError(error) {
  if (error?.status === 503 || error?.status === 429) return false;
  return isRetryableError(error);
}


# Kira — AI Mentor TikTok Affiliate

Kira (Kontent Intelligence & Research Assistant) adalah web app AI mentor untuk
TikTok Affiliate Creator Indonesia. Sebut nama produk, Kira meriset lalu
memberi **5 Hook + 5 Caption + 5 Voice Over** siap pakai. Mendukung **voice
command** (panggil "halo Kira") dengan suara natural lewat ElevenLabs.

- **Backend:** Node.js + Express + `@google/genai` (Gemini)
- **Frontend:** React (di-bundle dari `public/app.jsx` ke `public/app.js` via esbuild)
- **Suara:** ElevenLabs Text-to-Speech (opsional; fallback ke Web Speech API browser)
- **Voice command:** Web Speech API (SpeechRecognition) — paling stabil di Chrome/Edge

Alur: pengguna mengetik/berbicara di browser → frontend mengirim ke
`/api/chat/stream` → backend memanggil Gemini → balasan ditampilkan streaming.
Untuk suara, frontend memanggil `/api/tts` (proxy aman ke ElevenLabs).

---

## Prasyarat

- Node.js **v22 atau lebih tinggi** (pakai `node:sqlite` bawaan). Cek: `node -v`
- Gemini API key — gratis di https://aistudio.google.com/app/apikey
- (Opsional) ElevenLabs API key untuk suara natural — https://elevenlabs.io

## Instalasi

```bash
# 1. Masuk ke folder project
cd gemini-chatbot-api

# 2. Install dependencies
npm install

# 3. Siapkan environment variables
cp .env.example .env
# lalu buka .env dan isi GEMINI_API_KEY (wajib) + ELEVENLABS_API_KEY (opsional)

# 4. Build frontend (bundle app.jsx -> app.js)
npm run build

# 5. Jalankan server
npm start
```

Buka browser ke **http://localhost:3000/** untuk mulai.

> Saat development, jalankan `npm run dev` (server auto-restart) dan jalankan
> ulang `npm run build` tiap kali mengubah `public/app.jsx`.

> Voice command paling stabil di **Chrome/Edge**. Akses lewat `localhost` (bukan
> IP) supaya browser mengizinkan mikrofon tanpa HTTPS.

---

## Deploy (Railway — disarankan)

Kira adalah **server Node persisten** (punya database SQLite, sesi login, dan
streaming SSE). Karena itu Kira **tidak cocok di platform serverless** seperti
Vercel (filesystem read-only, tidak ada proses `listen` yang persisten, default
Node < 22). Gunakan hosting yang menjalankan server Node, mis. **Railway** atau
**Render**. Konfigurasi Railway (`railway.json` + `nixpacks.toml`) sudah tersedia.

Langkah deploy di Railway:

1. Push project ke GitHub.
2. Buka https://railway.app → **New Project** → **Deploy from GitHub repo** →
   pilih repo ini. Railway membaca `nixpacks.toml` (Node 22, build
   `npm run build`, start `npm start`) otomatis.
3. Buka tab **Variables**, tambahkan:
   - `GEMINI_API_KEY` — wajib.
   - `ELEVENLABS_API_KEY` — opsional (suara natural).
   - (opsional) `GEMINI_MODEL`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL`.
4. Tab **Settings → Networking → Generate Domain** untuk URL publik (HTTPS).

> Filesystem Railway bersifat ephemeral — agar database (login & riwayat) tidak
> hilang saat redeploy, buat **Volume** di Railway, mount (mis. ke `/data`), lalu
> set env `DB_PATH=/data/kira.db`. Tanpa login, app tetap jalan dengan riwayat di
> localStorage browser.

> Voice command butuh HTTPS untuk izin mikrofon — URL Railway sudah HTTPS, jadi
> voice berfungsi di sana.


---

## Struktur File

```
gemini-chatbot-api/
├── index.js              # Server Express: endpoint chat, TTS, auth, metrics
├── lib/
│   ├── chat-core.js      # Fungsi murni & konstanta domain (di-unit-test)
│   ├── db.js             # SQLite (node:sqlite) + skema tabel
│   ├── auth.js           # Hash password (scrypt) + token sesi (node:crypto)
│   ├── sessions-repo.js  # Query DB untuk sesi chat & usage log
│   ├── routes-account.js # Router auth (register/login) & CRUD sesi
│   └── logger.js         # Log JSON terstruktur + metrik token
├── test/
│   ├── chat-core.test.js
│   └── auth.test.js
├── public/
│   ├── index.html        # Host React app + layar loading
│   ├── app.jsx           # Sumber React (SATU file: UI, voice, TTS, visualizer)
│   ├── app.js            # Hasil build esbuild (di-gitignore)
│   ├── avatar.mov        # Video avatar Kira (dipakai di dashboard)
│   └── favicon.svg
├── data/                 # File SQLite (TIDAK di-commit)
├── package.json
├── .env.example
├── .env                  # API key (TIDAK di-commit)
└── .gitignore
```

> Catatan: `public/app.js` adalah artifact build dan di-gitignore. Setelah
> clone, wajib jalankan `npm run build` agar `app.js` tergenerate sebelum
> `npm start`.

---

## Testing

Unit test memakai test runner bawaan Node (`node:test`), tanpa dependency tambahan:

```bash
npm test
```

Yang diuji: fungsi murni di `lib/chat-core.js` (validasi body, clamp, konversi
ke format Gemini, klasifikasi error retry) dan hashing password di `lib/auth.js`.

---

## API

### `POST /api/chat/stream` (utama, streaming SSE)

Mengirim balasan Kira secara bertahap (Server-Sent Events). Body:

```json
{
  "conversation": [
    { "role": "user", "text": "Tolong bikinin konten buat serum Azarine" }
  ]
}
```

Event: `chunk` (`{ "delta": "..." }`), `done` (`{ "result": "..." }`),
`error` (`{ "error": "..." }`).

### `POST /api/chat` (non-streaming)

Body sama. **Response sukses:** `{ "result": "<balasan Kira>" }`.
**Error:** status `400`/`500` dengan `{ "error": "..." }`.

### `POST /api/tts` (Text-to-Speech)

Body `{ "text": "..." }` → audio `audio/mpeg` (ElevenLabs). Kalau
`ELEVENLABS_API_KEY` kosong, balas `503` dan frontend fallback ke suara browser.

### Auth & sesi (opsional)

- `POST /api/auth/register` — body `{ email, password, name? }` → `{ token, user }`
- `POST /api/auth/login` — body `{ email, password }` → `{ token, user }`
- `POST /api/auth/logout` — header `Authorization: Bearer <token>`
- `GET /api/auth/me` — info user login
- `GET /api/sessions` / `GET|PUT|DELETE /api/sessions/:id` — CRUD riwayat (perlu login)
- `GET /api/metrics` — ringkasan penggunaan token (lindungi dengan `METRICS_TOKEN`)

---

## Konfigurasi

Diatur lewat `.env` (lihat `.env.example` untuk daftar lengkap):

- **`GEMINI_API_KEY`** — wajib.
- **`GEMINI_MODEL`** — model Gemini (default `gemini-2.5-flash`).
- **`ELEVENLABS_API_KEY`** — opsional; aktifkan suara natural ElevenLabs.
- **`ELEVENLABS_VOICE_ID`** / **`ELEVENLABS_MODEL`** — pilih voice & model TTS.
- **`REQUIRE_AUTH`** — set `1` agar endpoint chat wajib login (lindungi kuota).
- **`DB_PATH`** — lokasi file SQLite (default `data/kira.db`).
- **`LOG_LEVEL`** — `debug|info|warn|error` (default `info`).
- **`METRICS_TOKEN`** — token untuk akses `GET /api/metrics`.

> Persistensi pakai SQLite bawaan Node (`node:sqlite`, butuh Node ≥ 22) — tanpa
> dependency native. Tanpa login, app tetap jalan dengan riwayat di localStorage.

## Fitur voice command

- Panggil **"halo Kira"**, lalu sebutkan produk/perintah. Kira menyahut dengan
  suara, lalu menyusun kontennya.
- Ucapkan **"matikan voice"** untuk menonaktifkan voice command lewat suara.
- Saat Kira bicara, ada animasi spektrum wave + background glow yang berdenyut.
- Tombol mic di header untuk menyalakan/mematikan voice secara manual.


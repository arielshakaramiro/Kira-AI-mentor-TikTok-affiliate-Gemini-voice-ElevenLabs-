// lib/auth.js
// Autentikasi sederhana berbasis token, tanpa dependency eksternal.
// - Password di-hash pakai scrypt (node:crypto) + salt acak per user.
// - Sesi login = token acak (32 byte) yang disimpan di tabel auth_tokens.
// - Token dikirim klien lewat header "Authorization: Bearer <token>".

import crypto from 'node:crypto';
import { db } from './db.js';

const TOKEN_TTL_MS = Number(process.env.AUTH_TOKEN_TTL_MS) || 30 * 24 * 60 * 60 * 1000; // 30 hari
const SCRYPT_KEYLEN = 64;

// Hash password -> "salt:derivedKey" (hex). Salt acak 16 byte.
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${derived}`;
}

// Verifikasi password terhadap hash tersimpan. Pakai timingSafeEqual agar
// tahan terhadap timing attack.
export function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, key] = stored.split(':');
  const keyBuf = Buffer.from(key, 'hex');
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return keyBuf.length === derived.length && crypto.timingSafeEqual(keyBuf, derived);
}

const isValidEmail = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// Buat user baru. Mengembalikan { ok, user } atau { ok:false, status, error }.
export function createUser({ email, password, name }) {
  if (!isValidEmail(email)) return { ok: false, status: 400, error: 'Email tidak valid.' };
  if (typeof password !== 'string' || password.length < 8) {
    return { ok: false, status: 400, error: 'Password minimal 8 karakter.' };
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) return { ok: false, status: 409, error: 'Email sudah terdaftar.' };

  const id = crypto.randomUUID();
  db.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, email.toLowerCase(), name?.trim() || null, hashPassword(password), Date.now());
  return { ok: true, user: { id, email: email.toLowerCase(), name: name?.trim() || null } };
}

// Cek kredensial login. Mengembalikan { ok, user } atau { ok:false, ... }.
export function authenticate({ email, password }) {
  if (!isValidEmail(email) || typeof password !== 'string') {
    return { ok: false, status: 400, error: 'Email atau password tidak valid.' };
  }
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!row || !verifyPassword(password, row.password_hash)) {
    return { ok: false, status: 401, error: 'Email atau password salah.' };
  }
  return { ok: true, user: { id: row.id, email: row.email, name: row.name } };
}

// Terbitkan token sesi untuk user.
export function issueToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  db.prepare('INSERT INTO auth_tokens (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, userId, now, now + TOKEN_TTL_MS);
  return token;
}

export function revokeToken(token) {
  db.prepare('DELETE FROM auth_tokens WHERE token = ?').run(token);
}

// Ambil user dari token (null kalau tidak ada / kedaluwarsa).
export function userFromToken(token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, t.expires_at
       FROM auth_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.token = ?`
    )
    .get(token);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    revokeToken(token);
    return null;
  }
  return { id: row.id, email: row.email, name: row.name };
}

// Ekstrak token dari header Authorization: Bearer <token>.
function tokenFromReq(req) {
  const h = req.headers?.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

// Middleware: lampirkan req.user bila token valid. TIDAK menolak request tanpa
// token (auth opsional), supaya alur tamu (localStorage) tetap jalan.
export function attachUser(req, _res, next) {
  const token = tokenFromReq(req);
  req.authToken = token;
  req.user = token ? userFromToken(token) : null;
  next();
}

// Middleware: wajibkan login. Dipakai untuk endpoint sesi/riwayat.
export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Harus login dulu ya bestie 🙏' });
  next();
}

// Guard chat: hanya menolak kalau REQUIRE_AUTH=1 di-set. Default longgar agar
// tidak memecah pemakaian sekarang, tapi bisa diaktifkan untuk menutup celah
// pemakaian kuota Gemini oleh sembarang orang.
export function chatAuthGuard(req, res, next) {
  if (process.env.REQUIRE_AUTH === '1' && !req.user) {
    return res.status(401).json({ error: 'Login dulu untuk pakai Kira ya bestie 🙏' });
  }
  next();
}

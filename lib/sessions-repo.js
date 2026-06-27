// lib/sessions-repo.js
// Operasi DB untuk sesi chat & pesan milik user. Dipakai endpoint /api/sessions.

import crypto from 'node:crypto';
import { db } from './db.js';

// Daftar sesi milik user (terbaru dulu), dengan jumlah pesan.
export function listSessions(userId) {
  return db
    .prepare(
      `SELECT s.id, s.title, s.created_at AS createdAt, s.updated_at AS updatedAt,
              (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS messageCount
       FROM sessions s
       WHERE s.user_id = ?
       ORDER BY s.updated_at DESC`
    )
    .all(userId);
}

// Ambil satu sesi beserta pesannya (atau null kalau bukan milik user).
export function getSession(userId, sessionId) {
  const s = db
    .prepare('SELECT id, title, created_at AS createdAt, updated_at AS updatedAt FROM sessions WHERE id = ? AND user_id = ?')
    .get(sessionId, userId);
  if (!s) return null;
  const messages = db
    .prepare('SELECT role, content, created_at AS createdAt FROM messages WHERE session_id = ? ORDER BY id')
    .all(sessionId);
  return { ...s, messages };
}

// Simpan (upsert) sebuah sesi beserta seluruh pesannya. Dipakai untuk sinkron
// dari frontend: pesan ditulis ulang penuh agar sederhana & konsisten.
export function saveSession(userId, { id, title, messages }) {
  const sessionId = id || crypto.randomUUID();
  const now = Date.now();
  const existing = db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ?').get(sessionId, userId);

  try {
    db.exec('BEGIN');
    if (existing) {
      db.prepare('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .run(title || 'Chat baru', now, sessionId, userId);
      db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
    } else {
      db.prepare('INSERT INTO sessions (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(sessionId, userId, title || 'Chat baru', now, now);
    }
    const insert = db.prepare('INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)');
    for (const m of Array.isArray(messages) ? messages : []) {
      if (!m || typeof m.content !== 'string') continue;
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      insert.run(sessionId, role, m.content, now);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { id: sessionId };
}

export function deleteSession(userId, sessionId) {
  const info = db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(sessionId, userId);
  return info.changes > 0;
}

// Catat penggunaan token ke DB (dipanggil setelah respons Gemini).
export function logUsage({ userId, endpoint, model, usage }) {
  db.prepare(
    `INSERT INTO usage_log (user_id, endpoint, model, prompt_tokens, candidates_tokens, total_tokens, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId || null,
    endpoint || null,
    model || null,
    usage?.promptTokens ?? null,
    usage?.candidatesTokens ?? null,
    usage?.totalTokens ?? null,
    Date.now()
  );
}

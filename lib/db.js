// lib/db.js
// Persistensi pakai SQLite bawaan Node (node:sqlite, Node >= 22). Tanpa
// dependency native — gratis & tanpa kompilasi. Menyimpan user, token sesi
// auth, sesi chat, dan pesan. File DB default: data/kira.db (di-gitignore).

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'kira.db');

// Pastikan folder data ada sebelum membuka DB.
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

// WAL: lebih tahan terhadap akses bersamaan & lebih cepat untuk pola tulis kita.
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Skema. IF NOT EXISTS supaya idempotent saat startup berulang.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE NOT NULL,
    name          TEXT,
    password_hash TEXT NOT NULL,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS auth_tokens (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    title      TEXT NOT NULL DEFAULT 'Chat baru',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS usage_log (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id           TEXT,
    endpoint          TEXT,
    model             TEXT,
    prompt_tokens     INTEGER,
    candidates_tokens INTEGER,
    total_tokens      INTEGER,
    created_at        INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);
  CREATE INDEX IF NOT EXISTS idx_tokens_user ON auth_tokens(user_id);
`);

// Hapus token kedaluwarsa saat startup (housekeeping ringan).
db.prepare('DELETE FROM auth_tokens WHERE expires_at < ?').run(Date.now());

export default db;

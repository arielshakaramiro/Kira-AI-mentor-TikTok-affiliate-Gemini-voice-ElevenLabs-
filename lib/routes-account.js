// lib/routes-account.js
// Router Express untuk autentikasi & sinkronisasi sesi chat ke database.
// Dipasang di index.js sebagai app.use('/api', accountRouter).

import express from 'express';
import {
  createUser, authenticate, issueToken, revokeToken, requireAuth,
} from './auth.js';
import {
  listSessions, getSession, saveSession, deleteSession,
} from './sessions-repo.js';
import { logger } from './logger.js';

export const accountRouter = express.Router();

// Bentuk respons user yang aman dikirim ke klien (tanpa hash password).
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name });

// POST /api/auth/register
accountRouter.post('/auth/register', (req, res) => {
  const { email, password, name } = req.body || {};
  const result = createUser({ email, password, name });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  const token = issueToken(result.user.id);
  logger.info('user_register', { userId: result.user.id });
  res.status(201).json({ token, user: publicUser(result.user) });
});

// POST /api/auth/login
accountRouter.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const result = authenticate({ email, password });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  const token = issueToken(result.user.id);
  logger.info('user_login', { userId: result.user.id });
  res.json({ token, user: publicUser(result.user) });
});

// POST /api/auth/logout
accountRouter.post('/auth/logout', (req, res) => {
  if (req.authToken) revokeToken(req.authToken);
  res.json({ ok: true });
});

// GET /api/auth/me — info user yang sedang login.
accountRouter.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// GET /api/sessions — daftar sesi milik user.
accountRouter.get('/sessions', requireAuth, (req, res) => {
  res.json({ sessions: listSessions(req.user.id) });
});

// GET /api/sessions/:id — satu sesi + pesannya.
accountRouter.get('/sessions/:id', requireAuth, (req, res) => {
  const s = getSession(req.user.id, req.params.id);
  if (!s) return res.status(404).json({ error: 'Sesi tidak ditemukan.' });
  res.json({ session: s });
});

// PUT /api/sessions/:id — simpan/sinkron sesi (upsert).
accountRouter.put('/sessions/:id', requireAuth, (req, res) => {
  const { title, messages } = req.body || {};
  try {
    const r = saveSession(req.user.id, { id: req.params.id, title, messages });
    res.json({ ok: true, id: r.id });
  } catch (e) {
    logger.error('save_session_failed', { userId: req.user.id, error: e.message });
    res.status(500).json({ error: 'Gagal menyimpan sesi.' });
  }
});

// DELETE /api/sessions/:id
accountRouter.delete('/sessions/:id', requireAuth, (req, res) => {
  const ok = deleteSession(req.user.id, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Sesi tidak ditemukan.' });
  res.json({ ok: true });
});

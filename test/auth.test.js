// test/auth.test.js
// Unit test untuk hashing & verifikasi password (fungsi murni di lib/auth.js).
// Operasi DB (createUser, token) butuh DB nyata, jadi diuji terpisah/manual.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../lib/auth.js';

test('hashPassword: menghasilkan format salt:hash', () => {
  const h = hashPassword('rahasia123');
  assert.ok(h.includes(':'));
  const [salt, key] = h.split(':');
  assert.ok(salt.length > 0 && key.length > 0);
});

test('hashPassword: salt acak -> hash beda untuk password sama', () => {
  assert.notEqual(hashPassword('samepass'), hashPassword('samepass'));
});

test('verifyPassword: password benar -> true', () => {
  const h = hashPassword('rahasia123');
  assert.equal(verifyPassword('rahasia123', h), true);
});

test('verifyPassword: password salah -> false', () => {
  const h = hashPassword('rahasia123');
  assert.equal(verifyPassword('salahdong', h), false);
});

test('verifyPassword: hash rusak/format aneh -> false (tidak throw)', () => {
  assert.equal(verifyPassword('x', 'bukanformatvalid'), false);
  assert.equal(verifyPassword('x', ''), false);
  assert.equal(verifyPassword('x', null), false);
});

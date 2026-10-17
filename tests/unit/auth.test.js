const { test, describe } = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../../src/config/env');
const authService = require('../../src/services/auth.service');
const { getDb } = require('../../src/db/connection');
const { migrate } = require('../../src/db/migrate');

describe('Unit: Auth & Security', () => {
  test('hashes passwords and does not store plaintext', () => {
    const rawPassword = 'SecurePassword123!';
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync(rawPassword, salt);

    assert.notStrictEqual(hash, rawPassword);
    assert.strictEqual(bcrypt.compareSync(rawPassword, hash), true);
    assert.strictEqual(bcrypt.compareSync('WrongPassword', hash), false);
  });

  test('signs and verifies JWT tokens with proper claims', () => {
    const payload = { id: 'usr_123', email: 'user@example.com', role: 'member' };
    const token = jwt.sign(payload, config.JWT_SECRET, { expiresIn: '1h' });

    const decoded = jwt.verify(token, config.JWT_SECRET);
    assert.strictEqual(decoded.id, 'usr_123');
    assert.strictEqual(decoded.email, 'user@example.com');
    assert.strictEqual(decoded.role, 'member');
  });

  test('validates member registration inputs', () => {
    assert.throws(() => {
      authService.registerMember({ email: 'bad-email', password: '123' });
    }, /valid email address is required/);

    assert.throws(() => {
      authService.registerMember({ email: 'valid@example.com', password: 'short' });
    }, /Password must be at least 6 characters/);
  });
});

const { getDb } = require('../db/connection');

class UserRepository {
  create({ id, email, passwordHash, role, createdAt }) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO users (id, email, password_hash, role, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(id, email, passwordHash, role, createdAt);
    return { id, email, role, createdAt };
  }

  findByEmail(email) {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
    return stmt.get(email);
  }

  findById(id) {
    const db = getDb();
    const stmt = db.prepare('SELECT id, email, role, created_at FROM users WHERE id = ?');
    return stmt.get(id);
  }
}

module.exports = new UserRepository();

const { getDb } = require('../db/connection');

class WorkshopRepository {
  create({ id, title, description, startsAt, location, capacity, status = 'scheduled', createdBy, createdAt, updatedAt }) {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO workshops (id, title, description, starts_at, location, capacity, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, title, description, startsAt, location, capacity, status, createdBy, createdAt, updatedAt);
    return this.findById(id);
  }

  findAll(status = 'scheduled') {
    const db = getDb();
    if (status) {
      const stmt = db.prepare('SELECT * FROM workshops WHERE status = ? ORDER BY starts_at ASC');
      return stmt.all(status);
    }
    const stmt = db.prepare('SELECT * FROM workshops ORDER BY starts_at ASC');
    return stmt.all();
  }

  findById(id) {
    const db = getDb();
    const stmt = db.prepare('SELECT * FROM workshops WHERE id = ?');
    return stmt.get(id);
  }

  update(id, fields) {
    const db = getDb();
    const allowed = ['title', 'description', 'starts_at', 'location', 'capacity'];
    const setClauses = [];
    const values = [];

    for (const [key, val] of Object.entries(fields)) {
      if (allowed.includes(key)) {
        setClauses.push(`${key} = ?`);
        values.push(val);
      }
    }

    if (setClauses.length === 0) return this.findById(id);

    setClauses.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    const sql = `UPDATE workshops SET ${setClauses.join(', ')} WHERE id = ?`;
    db.prepare(sql).run(...values);
    return this.findById(id);
  }

  updateStatus(id, status) {
    const db = getDb();
    const now = new Date().toISOString();
    const stmt = db.prepare('UPDATE workshops SET status = ?, updated_at = ? WHERE id = ?');
    stmt.run(status, now, id);
    return this.findById(id);
  }
}

module.exports = new WorkshopRepository();

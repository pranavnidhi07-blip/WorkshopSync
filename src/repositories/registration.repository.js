const { getDb } = require('../db/connection');

class RegistrationRepository {
  create({ id, workshopId, memberId, createdAt }, customDb = null) {
    const db = customDb || getDb();
    const stmt = db.prepare(`
      INSERT INTO registrations (id, workshop_id, member_id, created_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(id, workshopId, memberId, createdAt);
    return { id, workshopId, memberId, createdAt };
  }

  findByWorkshopId(workshopId, customDb = null) {
    const db = customDb || getDb();
    const stmt = db.prepare(`
      SELECT r.id, r.workshop_id, r.member_id, r.created_at, u.email as member_email
      FROM registrations r
      JOIN users u ON r.member_id = u.id
      WHERE r.workshop_id = ?
      ORDER BY r.created_at ASC
    `);
    return stmt.all(workshopId);
  }

  findByMemberId(memberId, customDb = null) {
    const db = customDb || getDb();
    const stmt = db.prepare(`
      SELECT r.id, r.workshop_id, r.member_id, r.created_at,
             w.title as workshop_title, w.starts_at, w.location, w.status as workshop_status
      FROM registrations r
      JOIN workshops w ON r.workshop_id = w.id
      WHERE r.member_id = ?
      ORDER BY r.created_at DESC
    `);
    return stmt.all(memberId);
  }

  countByWorkshopId(workshopId, customDb = null) {
    const db = customDb || getDb();
    const stmt = db.prepare('SELECT COUNT(*) as count FROM registrations WHERE workshop_id = ?');
    const result = stmt.get(workshopId);
    return result ? result.count : 0;
  }

  findOne(workshopId, memberId, customDb = null) {
    const db = customDb || getDb();
    const stmt = db.prepare('SELECT * FROM registrations WHERE workshop_id = ? AND member_id = ?');
    return stmt.get(workshopId, memberId);
  }
}

module.exports = new RegistrationRepository();

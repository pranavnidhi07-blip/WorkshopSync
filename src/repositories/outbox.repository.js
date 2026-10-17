const { getDb } = require('../db/connection');

class OutboxRepository {
  createJob({ id, eventKey, eventType, recipientUserId, payloadJson, status = 'pending', attempts = 0, createdAt, updatedAt }, customDb = null) {
    const db = customDb || getDb();
    const stmt = db.prepare(`
      INSERT INTO notification_jobs (
        id, event_key, event_type, recipient_user_id, payload_json, status, attempts, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, eventKey, eventType, recipientUserId, payloadJson, status, attempts, createdAt, updatedAt);
    return this.findById(id, db);
  }

  findById(id, customDb = null) {
    const db = customDb || getDb();
    const stmt = db.prepare('SELECT * FROM notification_jobs WHERE id = ?');
    return stmt.get(id);
  }

  findByRecipient(recipientUserId, customDb = null) {
    const db = customDb || getDb();
    const stmt = db.prepare('SELECT * FROM notification_jobs WHERE recipient_user_id = ? ORDER BY created_at DESC');
    return stmt.all(recipientUserId);
  }

  claimNextJob(leaseSeconds = 30, customDb = null) {
    const db = customDb || getDb();
    const sql = `
      UPDATE notification_jobs
      SET status = 'processing',
          locked_until = datetime('now', '+' || ? || ' seconds'),
          updated_at = datetime('now')
      WHERE id = (
        SELECT id FROM notification_jobs
        WHERE (status = 'pending' OR status = 'retry_wait' OR (status = 'processing' AND locked_until <= datetime('now')))
          AND (next_attempt_at IS NULL OR next_attempt_at <= datetime('now'))
          AND (locked_until IS NULL OR locked_until <= datetime('now'))
        ORDER BY created_at ASC
        LIMIT 1
      )
      RETURNING *;
    `;
    const stmt = db.prepare(sql);
    return stmt.get(leaseSeconds);
  }

  markDelivered(id, customDb = null) {
    const db = customDb || getDb();
    const sql = `
      UPDATE notification_jobs
      SET status = 'delivered',
          delivered_at = datetime('now'),
          locked_until = NULL,
          updated_at = datetime('now')
      WHERE id = ?
      RETURNING *;
    `;
    return db.prepare(sql).get(id);
  }

  markRetry(id, attempts, nextAttemptAt, lastError, customDb = null) {
    const db = customDb || getDb();
    const sql = `
      UPDATE notification_jobs
      SET status = 'retry_wait',
          attempts = ?,
          next_attempt_at = ?,
          last_error = ?,
          locked_until = NULL,
          updated_at = datetime('now')
      WHERE id = ?
      RETURNING *;
    `;
    return db.prepare(sql).get(attempts, nextAttemptAt, lastError, id);
  }

  markDeadLetter(id, attempts, lastError, customDb = null) {
    const db = customDb || getDb();
    const sql = `
      UPDATE notification_jobs
      SET status = 'dead_letter',
          attempts = ?,
          last_error = ?,
          locked_until = NULL,
          updated_at = datetime('now')
      WHERE id = ?
      RETURNING *;
    `;
    return db.prepare(sql).get(attempts, lastError, id);
  }

  releaseLock(id, customDb = null) {
    const db = customDb || getDb();
    const sql = `
      UPDATE notification_jobs
      SET locked_until = NULL,
          updated_at = datetime('now')
      WHERE id = ?;
    `;
    return db.prepare(sql).run(id);
  }
}

module.exports = new OutboxRepository();

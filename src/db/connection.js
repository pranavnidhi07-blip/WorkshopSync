const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config/env');

let currentDb = null;
let currentDbPath = null;

function getDb(customPath = null) {
  const dbPath = customPath || config.DATABASE_PATH;

  if (currentDb && currentDbPath === dbPath) {
    return currentDb;
  }

  if (currentDb) {
    try {
      currentDb.close();
    } catch (_) {}
  }

  if (dbPath !== ':memory:') {
    const dir = path.dirname(path.resolve(dbPath));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(dbPath);
  
  // Enforce foreign keys and recommended pragmas
  db.exec('PRAGMA foreign_keys = ON;');
  if (dbPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  db.exec('PRAGMA busy_timeout = 5000;');

  currentDb = db;
  currentDbPath = dbPath;
  return currentDb;
}

function closeDb() {
  if (currentDb) {
    try {
      currentDb.close();
    } catch (_) {}
    currentDb = null;
    currentDbPath = null;
  }
}

/**
 * Executes a function inside an immediate SQLite transaction.
 * Automatically commits on success and rolls back on error.
 */
function runInTransaction(fn, customDb = null) {
  const db = customDb || getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch (_) {}
    throw error;
  }
}

module.exports = {
  getDb,
  closeDb,
  runInTransaction
};

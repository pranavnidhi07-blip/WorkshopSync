PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT CHECK(role IN ('organizer', 'member')) NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workshops (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  starts_at TEXT NOT NULL,
  location TEXT NOT NULL,
  capacity INTEGER,
  status TEXT CHECK(status IN ('scheduled', 'cancelled')) NOT NULL DEFAULT 'scheduled',
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS registrations (
  id TEXT PRIMARY KEY,
  workshop_id TEXT NOT NULL REFERENCES workshops(id),
  member_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE(workshop_id, member_id)
);

CREATE TABLE IF NOT EXISTS notification_jobs (
  id TEXT PRIMARY KEY,
  event_key TEXT UNIQUE NOT NULL,
  event_type TEXT CHECK(event_type IN ('registration_confirmation', 'workshop_cancellation')) NOT NULL,
  recipient_user_id TEXT NOT NULL REFERENCES users(id),
  payload_json TEXT NOT NULL,
  status TEXT CHECK(status IN ('pending', 'processing', 'delivered', 'retry_wait', 'dead_letter')) NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  locked_until TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  delivered_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_next_attempt ON notification_jobs(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_jobs_locked_until ON notification_jobs(locked_until);
CREATE INDEX IF NOT EXISTS idx_registrations_workshop ON registrations(workshop_id);
CREATE INDEX IF NOT EXISTS idx_registrations_member ON registrations(member_id);

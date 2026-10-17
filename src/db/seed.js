const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { getDb } = require('./connection');
const { migrate } = require('./migrate');

function seed(dbInstance = null) {
  const db = dbInstance || getDb();
  migrate(db);

  const existingOrganizer = db.prepare('SELECT id FROM users WHERE email = ?').get('organizer@workshop.local');
  if (existingOrganizer) {
    return existingOrganizer;
  }

  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync('OrganizerPassword123!', salt);
  const organizerId = 'usr_' + crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const insert = db.prepare(`
    INSERT INTO users (id, email, password_hash, role, created_at)
    VALUES (?, ?, ?, 'organizer', ?)
  `);

  insert.run(organizerId, 'organizer@workshop.local', passwordHash, createdAt);
  return { id: organizerId, email: 'organizer@workshop.local', role: 'organizer' };
}

if (require.main === module) {
  try {
    const org = seed();
    console.log(`Demo organizer seeded successfully: ${org.email} (ID: ${org.id})`);
    process.exit(0);
  } catch (err) {
    console.error('Seeding failed:', err);
    process.exit(1);
  }
}

module.exports = { seed };

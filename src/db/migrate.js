const fs = require('node:fs');
const path = require('node:path');
const { getDb } = require('./connection');

function migrate(dbInstance = null) {
  const db = dbInstance || getDb();
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  // Execute the schema statements
  db.exec(schemaSql);
  return true;
}

if (require.main === module) {
  try {
    migrate();
    console.log('Database migration completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

module.exports = { migrate };

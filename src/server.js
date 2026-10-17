const app = require('./app');
const config = require('./config/env');
const { getDb, closeDb } = require('./db/connection');
const { migrate } = require('./db/migrate');
const worker = require('./worker/notificationWorker');

// Initialize database
const db = getDb();
migrate(db);

const PORT = config.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`[API] WorkshopSync API Server running on port ${PORT}`);
  // Start background outbox notification worker
  worker.start();
});

async function gracefulShutdown(signal) {
  console.log(`\n[SYSTEM] Received ${signal}. Initiating graceful shutdown...`);

  // Stop worker from accepting new polling jobs
  worker.stop();

  try {
    // Wait for in-flight job to finish or timeout
    await worker.drain(4000);
  } catch (err) {
    console.error('[SYSTEM] Error draining worker:', err.message);
  }

  server.close(() => {
    console.log('[API] HTTP server closed.');
    closeDb();
    console.log('[DB] Database connection closed.');
    process.exit(0);
  });

  // Force exit if hanging
  setTimeout(() => {
    console.error('[SYSTEM] Forcefully terminating after timeout.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = { server, app };

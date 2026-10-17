const { app } = require('./app');
const config = require('../src/config/env');

const PORT = config.MOCK_PORT || 4000;

const server = app.listen(PORT, () => {
  console.log(`[MOCK SERVICE] Mock Notification Server running on port ${PORT}`);
});

process.on('SIGTERM', () => {
  server.close(() => {
    console.log('[MOCK SERVICE] Mock server stopped.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  server.close(() => {
    console.log('[MOCK SERVICE] Mock server stopped.');
    process.exit(0);
  });
});

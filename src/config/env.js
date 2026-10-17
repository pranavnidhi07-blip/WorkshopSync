const path = require('node:path');
const dotenv = require('dotenv');

// Load environment variables from .env
dotenv.config();

const NODE_ENV = process.env.NODE_ENV || 'development';

if (!process.env.JWT_SECRET && NODE_ENV !== 'test') {
  throw new Error('FATAL: JWT_SECRET environment variable is missing.');
}

module.exports = {
  NODE_ENV,
  PORT: parseInt(process.env.PORT, 10) || 3000,
  DATABASE_PATH: process.env.DATABASE_PATH || './data/workshopsync.sqlite',
  JWT_SECRET: process.env.JWT_SECRET || 'test-jwt-secret-for-testing-only-12345',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '1h',
  MOCK_NOTIFICATION_URL: process.env.MOCK_NOTIFICATION_URL || 'http://localhost:4000/mock/notifications',
  MOCK_PORT: parseInt(process.env.MOCK_PORT, 10) || 4000,
  WORKER_POLL_INTERVAL_MS: parseInt(process.env.WORKER_POLL_INTERVAL_MS, 10) || 1000,
  WORKER_HTTP_TIMEOUT_MS: parseInt(process.env.WORKER_HTTP_TIMEOUT_MS, 10) || 3000,
  MAX_NOTIFICATION_ATTEMPTS: parseInt(process.env.MAX_NOTIFICATION_ATTEMPTS, 10) || 8
};

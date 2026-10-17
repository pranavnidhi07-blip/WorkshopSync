const express = require('express');

const app = express();
app.use(express.json());

// In-memory state for mock service
let currentMode = 'success'; // 'success' | 'error' | 'timeout'
let errorStatusCode = 500;
let failNextCount = 0;
let deliveryLog = [];
let uniqueIdempotencyKeys = new Set();

app.get('/mock/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    mode: currentMode,
    failNextCount,
    deliveredCount: uniqueIdempotencyKeys.size
  });
});

app.post('/mock/mode', (req, res) => {
  const { mode, statusCode, failNext } = req.body;
  if (mode && !['success', 'error', 'timeout'].includes(mode)) {
    return res.status(400).json({ error: 'Mode must be one of: success, error, timeout' });
  }
  if (mode) currentMode = mode;
  if (statusCode) errorStatusCode = parseInt(statusCode, 10);
  if (failNext !== undefined) failNextCount = parseInt(failNext, 10);

  return res.status(200).json({ mode: currentMode, errorStatusCode, failNextCount });
});

app.get('/mock/deliveries', (req, res) => {
  res.status(200).json({
    totalCalls: deliveryLog.length,
    uniqueDeliveries: uniqueIdempotencyKeys.size,
    keys: Array.from(uniqueIdempotencyKeys),
    log: deliveryLog
  });
});

app.post('/mock/notifications', (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'] || req.body?.jobId || 'none';
  const timestamp = new Date().toISOString();

  deliveryLog.push({
    timestamp,
    mode: currentMode,
    idempotencyKey,
    payload: req.body
  });

  // Handle single-shot failure for isolation testing (T-09)
  if (failNextCount > 0) {
    failNextCount--;
    console.log(`[MOCK SERVICE] Fail-next triggered (${errorStatusCode}) for key: ${idempotencyKey}`);
    return res.status(errorStatusCode).json({
      error: 'Simulated single failure for isolation test',
      statusCode: errorStatusCode
    });
  }

  if (currentMode === 'error') {
    console.log(`[MOCK SERVICE] Simulating error (${errorStatusCode}) for key: ${idempotencyKey}`);
    return res.status(errorStatusCode).json({
      error: 'Simulated downstream notification failure',
      statusCode: errorStatusCode
    });
  }

  if (currentMode === 'timeout') {
    console.log(`[MOCK SERVICE] Simulating timeout (5000ms delay) for key: ${idempotencyKey}`);
    return setTimeout(() => {
      res.status(200).json({ status: 'delayed_success', idempotencyKey });
    }, 5000);
  }

  // Success mode: record idempotency key
  const isDuplicate = uniqueIdempotencyKeys.has(idempotencyKey);
  uniqueIdempotencyKeys.add(idempotencyKey);

  console.log(`[MOCK SERVICE] Delivery success for key: ${idempotencyKey} (Duplicate: ${isDuplicate})`);
  return res.status(200).json({
    status: 'delivered',
    idempotencyKey,
    isDuplicate,
    timestamp
  });
});

function resetMockState() {
  currentMode = 'success';
  errorStatusCode = 500;
  failNextCount = 0;
  deliveryLog = [];
  uniqueIdempotencyKeys.clear();
}

module.exports = {
  app,
  resetMockState
};

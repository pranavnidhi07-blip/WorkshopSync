const { test, describe } = require('node:test');
const assert = require('node:assert');
const retryPolicy = require('../../src/worker/retryPolicy');

describe('Unit: RetryPolicy', () => {
  test('calculates bounded exponential backoff with jitter', () => {
    const attempt1 = new Date(retryPolicy.calculateNextAttempt(1)).getTime();
    const now = Date.now();
    const diff1 = attempt1 - now;

    // Attempt 1 should be around 1s (+ up to 500ms jitter)
    assert.ok(diff1 >= 900 && diff1 <= 1700, `Expected ~1-1.5s delay, got ${diff1}ms`);

    const attempt2 = new Date(retryPolicy.calculateNextAttempt(2)).getTime();
    const diff2 = attempt2 - now;
    // Attempt 2 should be around 2s (+ up to 500ms jitter)
    assert.ok(diff2 >= 1900 && diff2 <= 2700, `Expected ~2-2.5s delay, got ${diff2}ms`);

    // High attempt capped at 30s (+ up to 500ms jitter)
    const attempt10 = new Date(retryPolicy.calculateNextAttempt(10)).getTime();
    const diff10 = attempt10 - now;
    assert.ok(diff10 >= 29900 && diff10 <= 31500, `Expected ~30s capped delay, got ${diff10}ms`);
  });

  test('correctly identifies retryable vs non-retryable conditions', () => {
    // 5xx and 429 are retryable
    assert.strictEqual(retryPolicy.isRetryable(null, 500), true);
    assert.strictEqual(retryPolicy.isRetryable(null, 502), true);
    assert.strictEqual(retryPolicy.isRetryable(null, 429), true);

    // 4xx errors are non-retryable
    assert.strictEqual(retryPolicy.isRetryable(null, 400), false);
    assert.strictEqual(retryPolicy.isRetryable(null, 403), false);
    assert.strictEqual(retryPolicy.isRetryable(null, 404), false);

    // Timeouts and network disconnects are retryable
    const timeoutErr = new Error('The operation was aborted due to timeout');
    timeoutErr.name = 'TimeoutError';
    assert.strictEqual(retryPolicy.isRetryable(timeoutErr), true);

    const abortErr = new Error('Abort error');
    abortErr.name = 'AbortError';
    assert.strictEqual(retryPolicy.isRetryable(abortErr), true);
  });

  test('checks maximum attempts threshold', () => {
    assert.strictEqual(retryPolicy.hasExceededMaxAttempts(1), false);
    assert.strictEqual(retryPolicy.hasExceededMaxAttempts(7), false);
    assert.strictEqual(retryPolicy.hasExceededMaxAttempts(8), true);
    assert.strictEqual(retryPolicy.hasExceededMaxAttempts(9), true);
  });
});

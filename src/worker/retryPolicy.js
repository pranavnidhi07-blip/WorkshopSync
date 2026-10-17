const config = require('../config/env');

class RetryPolicy {
  constructor({
    maxAttempts = config.MAX_NOTIFICATION_ATTEMPTS,
    baseSeconds = 1,
    capSeconds = 30
  } = {}) {
    this.maxAttempts = maxAttempts;
    this.baseSeconds = baseSeconds;
    this.capSeconds = capSeconds;
  }

  /**
   * Calculates next attempt timestamp using bounded exponential backoff with jitter.
   * delay = min(cap, base * 2^(attempts-1)) + jitter(0 to 500ms)
   */
  calculateNextAttempt(attemptNumber) {
    const exponent = Math.max(0, attemptNumber - 1);
    const exponentialBackoff = this.baseSeconds * Math.pow(2, exponent);
    const cappedBackoff = Math.min(this.capSeconds, exponentialBackoff);
    const jitterSeconds = Math.random() * 0.5; // up to 500ms jitter
    const totalDelayMs = Math.round((cappedBackoff + jitterSeconds) * 1000);

    return new Date(Date.now() + totalDelayMs).toISOString();
  }

  /**
   * Determines if a failure is transient and eligible for retry.
   */
  isRetryable(error, statusCode = null) {
    if (statusCode) {
      if (statusCode === 429) return true;
      if (statusCode >= 500 && statusCode < 600) return true;
      // Permanent client errors (400, 401, 403, 404, etc.) are non-retryable
      if (statusCode >= 400 && statusCode < 500) return false;
    }

    if (error) {
      const code = error.code || '';
      const name = error.name || '';
      const msg = error.message || '';

      if (
        name === 'AbortError' ||
        name === 'TimeoutError' ||
        code === 'ETIMEDOUT' ||
        code === 'ECONNRESET' ||
        code === 'ECONNREFUSED' ||
        code === 'UND_ERR_CONNECT_TIMEOUT' ||
        msg.includes('timeout')
      ) {
        return true;
      }
    }

    return true; // Default to retry for unexpected network errors
  }

  hasExceededMaxAttempts(attemptNumber) {
    return attemptNumber >= this.maxAttempts;
  }
}

module.exports = new RetryPolicy();

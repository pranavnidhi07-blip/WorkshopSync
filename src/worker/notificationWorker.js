const config = require('../config/env');
const outboxRepo = require('../repositories/outbox.repository');
const retryPolicy = require('./retryPolicy');

class NotificationWorker {
  constructor() {
    this.pollIntervalMs = config.WORKER_POLL_INTERVAL_MS || 1000;
    this.httpTimeoutMs = config.WORKER_HTTP_TIMEOUT_MS || 3000;
    this.mockUrl = config.MOCK_NOTIFICATION_URL;
    this.timer = null;
    this.isRunning = false;
    this.activeJobPromise = null;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[WORKER] Outbox notification worker started (polling every ${this.pollIntervalMs}ms)`);

    this.timer = setInterval(async () => {
      try {
        await this.processNextJob();
      } catch (err) {
        console.error('[WORKER] Unexpected error in polling tick:', err.message);
      }
    }, this.pollIntervalMs);
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[WORKER] Outbox worker polling stopped.');
  }

  async drain(timeoutMs = 5000) {
    if (this.activeJobPromise) {
      const timeout = new Promise((resolve) => setTimeout(resolve, timeoutMs));
      await Promise.race([this.activeJobPromise, timeout]);
    }
  }

  /**
   * Claims and processes a single pending or retry-due job.
   * Returns true if a job was found and processed, false otherwise.
   */
  async processNextJob() {
    // 1. Claim eligible job with 30s lease lock
    const job = outboxRepo.claimNextJob(30);
    if (!job) {
      return false; // No eligible jobs
    }

    // Wrap the active job processing for graceful drain support
    this.activeJobPromise = this._executeDelivery(job);
    try {
      await this.activeJobPromise;
    } finally {
      this.activeJobPromise = null;
    }

    return true;
  }

  async _executeDelivery(job) {
    const attemptCount = (job.attempts || 0) + 1;
    console.log(`[WORKER] Processing job ${job.id} (Attempt ${attemptCount}, Event: ${job.event_type})`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.httpTimeoutMs);

    let httpStatusCode = null;
    let deliverySuccess = false;
    let failureError = null;

    try {
      const response = await fetch(this.mockUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': job.id
        },
        body: job.payload_json,
        signal: controller.signal
      });

      httpStatusCode = response.status;

      if (response.ok) {
        deliverySuccess = true;
      } else {
        const errText = await response.text();
        failureError = new Error(`HTTP ${response.status}: ${errText.substring(0, 100)}`);
      }
    } catch (err) {
      failureError = err;
    } finally {
      clearTimeout(timeoutId);
    }

    // 2. Handle Delivery Outcome
    if (deliverySuccess) {
      outboxRepo.markDelivered(job.id);
      console.log(`[WORKER] Job ${job.id} successfully delivered.`);
      return;
    }

    // 3. Handle Failure and Retry Strategy
    const errorMessage = failureError ? failureError.message : `HTTP status ${httpStatusCode}`;
    const isRetryable = retryPolicy.isRetryable(failureError, httpStatusCode);
    const exceededMax = retryPolicy.hasExceededMaxAttempts(attemptCount);

    if (!isRetryable || exceededMax) {
      outboxRepo.markDeadLetter(job.id, attemptCount, errorMessage);
      console.warn(`[WORKER] Job ${job.id} marked as DEAD_LETTER. (Attempts: ${attemptCount}, Retryable: ${isRetryable}) Reason: ${errorMessage}`);
    } else {
      const nextAttemptAt = retryPolicy.calculateNextAttempt(attemptCount);
      outboxRepo.markRetry(job.id, attemptCount, nextAttemptAt, errorMessage);
      console.log(`[WORKER] Job ${job.id} scheduled for retry at ${nextAttemptAt}. Attempt: ${attemptCount}. Error: ${errorMessage}`);
    }
  }
}

module.exports = new NotificationWorker();

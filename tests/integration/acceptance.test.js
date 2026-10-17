const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');

// Set environment to test before loading config
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = './data/test_workshopsync.sqlite';
process.env.MOCK_PORT = '4001';
process.env.MOCK_NOTIFICATION_URL = 'http://127.0.0.1:4001/mock/notifications';
process.env.JWT_SECRET = 'acceptance-test-jwt-secret-very-secure';

const config = require('../../src/config/env');
const app = require('../../src/app');
const { app: mockApp, resetMockState } = require('../../mock-notification/app');
const { getDb, closeDb } = require('../../src/db/connection');
const { migrate } = require('../../src/db/migrate');
const { seed } = require('../../src/db/seed');
const worker = require('../../src/worker/notificationWorker');

describe('WorkshopSync Acceptance Tests (T-01 to T-14)', () => {
  let mockServer;
  let organizerToken;
  let memberToken;
  let memberId;
  let memberEmail = 'testmember@example.com';

  before(async () => {
    // Clean up old test db file
    const dbPath = path.resolve(config.DATABASE_PATH);
    if (fs.existsSync(dbPath)) {
      try { fs.unlinkSync(dbPath); } catch (_) {}
    }

    const db = getDb();
    migrate(db);
    seed(db);

    // Start mock notification server
    await new Promise((resolve) => {
      mockServer = mockApp.listen(config.MOCK_PORT, () => resolve());
    });

    // 1. Log in seeded demo organizer
    const orgLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'organizer@workshop.local', password: 'OrganizerPassword123!' });
    assert.strictEqual(orgLogin.status, 200);
    organizerToken = orgLogin.body.token;

    // 2. Register and log in a demo member
    const memberReg = await request(app)
      .post('/api/auth/register')
      .send({ email: memberEmail, password: 'MemberPassword123!' });
    assert.strictEqual(memberReg.status, 201);
    memberId = memberReg.body.id;

    const memberLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: memberEmail, password: 'MemberPassword123!' });
    assert.strictEqual(memberLogin.status, 200);
    memberToken = memberLogin.body.token;
  });

  beforeEach(() => {
    resetMockState();
    const db = getDb();
    // Clean test data between runs, keeping seeded users
    db.exec('DELETE FROM notification_jobs; DELETE FROM registrations; DELETE FROM workshops;');
  });

  after(async () => {
    worker.stop();
    closeDb();
    if (mockServer) {
      await new Promise((resolve) => mockServer.close(resolve));
    }
    const dbPath = path.resolve(config.DATABASE_PATH);
    if (fs.existsSync(dbPath)) {
      try { fs.unlinkSync(dbPath); } catch (_) {}
    }
  });

  // T-01: Organizer creates workshop
  test('T-01: Organizer creates workshop -> 201 response and workshop is persisted', async () => {
    const res = await request(app)
      .post('/api/workshops')
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({
        title: 'Node.js Microservices Workshop',
        description: 'Deep dive into event-driven patterns',
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        location: 'Virtual Room A',
        capacity: 50
      });

    assert.strictEqual(res.status, 201);
    assert.ok(res.body.id);
    assert.strictEqual(res.body.title, 'Node.js Microservices Workshop');
    assert.strictEqual(res.body.status, 'scheduled');

    const db = getDb();
    const stored = db.prepare('SELECT * FROM workshops WHERE id = ?').get(res.body.id);
    assert.ok(stored);
    assert.strictEqual(stored.title, 'Node.js Microservices Workshop');
  });

  // T-02: Member registers
  test('T-02: Member registers -> 201 response; registration and pending confirmation job both exist', async () => {
    const ws = await request(app)
      .post('/api/workshops')
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({
        title: 'Concurrency Patterns',
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        location: 'Hall B'
      });

    const res = await request(app)
      .post(`/api/workshops/${ws.body.id}/registrations`)
      .set('Authorization', `Bearer ${memberToken}`);

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.status, 'registered');
    assert.strictEqual(res.body.notification.status, 'pending');
    assert.ok(res.body.notification.jobId);

    const db = getDb();
    const reg = db.prepare('SELECT * FROM registrations WHERE id = ?').get(res.body.registrationId);
    assert.ok(reg);
    assert.strictEqual(reg.workshop_id, ws.body.id);
    assert.strictEqual(reg.member_id, memberId);

    const job = db.prepare('SELECT * FROM notification_jobs WHERE id = ?').get(res.body.notification.jobId);
    assert.ok(job);
    assert.strictEqual(job.status, 'pending');
    assert.strictEqual(job.event_type, 'registration_confirmation');
  });

  // T-03: Duplicate registration
  test('T-03: Duplicate registration -> 409 response; only one registration and one confirmation job exist', async () => {
    const ws = await request(app)
      .post('/api/workshops')
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({
        title: 'Distributed Systems',
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        location: 'Room 101'
      });

    // 1st Registration
    const firstRes = await request(app)
      .post(`/api/workshops/${ws.body.id}/registrations`)
      .set('Authorization', `Bearer ${memberToken}`);
    assert.strictEqual(firstRes.status, 201);

    // 2nd Registration Attempt (Duplicate)
    const secondRes = await request(app)
      .post(`/api/workshops/${ws.body.id}/registrations`)
      .set('Authorization', `Bearer ${memberToken}`);

    assert.strictEqual(secondRes.status, 409);
    assert.strictEqual(secondRes.body.error.code, 'DUPLICATE_REGISTRATION');

    const db = getDb();
    const regCount = db.prepare('SELECT COUNT(*) as c FROM registrations WHERE workshop_id = ? AND member_id = ?')
      .get(ws.body.id, memberId).c;
    assert.strictEqual(regCount, 1);

    const jobCount = db.prepare('SELECT COUNT(*) as c FROM notification_jobs WHERE event_key = ?')
      .get(`reg_confirm_${ws.body.id}_${memberId}`).c;
    assert.strictEqual(jobCount, 1);
  });

  // T-04: Invalid workshop registration
  test('T-04: Invalid workshop registration -> 4xx response; no registration or confirmation job is created', async () => {
    const nonExistentId = 'ws_non_existent_12345';
    const res = await request(app)
      .post(`/api/workshops/${nonExistentId}/registrations`)
      .set('Authorization', `Bearer ${memberToken}`);

    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.error.code, 'WORKSHOP_NOT_FOUND');

    const db = getDb();
    const reg = db.prepare('SELECT * FROM registrations WHERE workshop_id = ?').get(nonExistentId);
    assert.strictEqual(reg, undefined);

    const jobs = db.prepare('SELECT COUNT(*) as c FROM notification_jobs').get().c;
    assert.strictEqual(jobs, 0);
  });

  // T-05: Async response responsiveness
  test('T-05: Async response -> Registration completes immediately even when mock delivery is in timeout mode', async () => {
    await request(mockApp).post('/mock/mode').send({ mode: 'timeout' });

    const ws = await request(app)
      .post('/api/workshops')
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({
        title: 'Async Responsiveness Test',
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        location: 'Virtual'
      });

    const startTime = Date.now();
    const res = await request(app)
      .post(`/api/workshops/${ws.body.id}/registrations`)
      .set('Authorization', `Bearer ${memberToken}`);
    const duration = Date.now() - startTime;

    assert.strictEqual(res.status, 201);
    assert.ok(duration < 1000, `Registration endpoint took ${duration}ms, expected < 1000ms`);
  });

  // T-06: Notification service returns 500
  test('T-06: Notification service returns 500 -> Job is scheduled for retry; registration remains saved', async () => {
    await request(mockApp).post('/mock/mode').send({ mode: 'error', statusCode: 500 });

    const ws = await request(app)
      .post('/api/workshops')
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({
        title: 'Fault Handling Workshop',
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        location: 'Online'
      });

    const res = await request(app)
      .post(`/api/workshops/${ws.body.id}/registrations`)
      .set('Authorization', `Bearer ${memberToken}`);
    assert.strictEqual(res.status, 201);

    const jobId = res.body.notification.jobId;

    // Trigger worker processing
    await worker.processNextJob();

    // Check DB status
    const db = getDb();
    const job = db.prepare('SELECT * FROM notification_jobs WHERE id = ?').get(jobId);
    assert.strictEqual(job.status, 'retry_wait');
    assert.strictEqual(job.attempts, 1);
    assert.ok(job.next_attempt_at);
    assert.ok(job.last_error.includes('500'));

    // Registration remains saved
    const reg = db.prepare('SELECT * FROM registrations WHERE id = ?').get(res.body.registrationId);
    assert.ok(reg);
  });

  // T-07: Mock service timeout
  test('T-07: Mock service timeout -> Worker records failure and retries without crashing', async () => {
    await request(mockApp).post('/mock/mode').send({ mode: 'timeout' });
    worker.httpTimeoutMs = 100;

    const ws = await request(app)
      .post('/api/workshops')
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({
        title: 'Timeout Resilience Workshop',
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        location: 'Online'
      });

    const res = await request(app)
      .post(`/api/workshops/${ws.body.id}/registrations`)
      .set('Authorization', `Bearer ${memberToken}`);

    const jobId = res.body.notification.jobId;

    await worker.processNextJob();

    const db = getDb();
    const job = db.prepare('SELECT * FROM notification_jobs WHERE id = ?').get(jobId);
    assert.strictEqual(job.status, 'retry_wait');
    assert.strictEqual(job.attempts, 1);
    assert.ok(job.last_error.toLowerCase().includes('abort') || job.last_error.toLowerCase().includes('timeout'));

    worker.httpTimeoutMs = config.WORKER_HTTP_TIMEOUT_MS;
  });

  // T-08: Backend restart with pending job
  test('T-08: Backend restart with pending job -> Job remains in SQLite and is processed after restart', async () => {
    const db = getDb();
    const crashedJobId = 'job_crashed_123';
    db.prepare(`
      INSERT INTO notification_jobs (
        id, event_key, event_type, recipient_user_id, payload_json, status, attempts, locked_until, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'processing', 0, datetime('now', '-10 seconds'), datetime('now'), datetime('now'))
    `).run(crashedJobId, 'crash_test_key', 'registration_confirmation', memberId, JSON.stringify({ test: true }));

    await request(mockApp).post('/mock/mode').send({ mode: 'success' });

    // Worker claims and processes the reclaimed job
    const processed = await worker.processNextJob();
    assert.strictEqual(processed, true);

    const updatedJob = db.prepare('SELECT * FROM notification_jobs WHERE id = ?').get(crashedJobId);
    assert.strictEqual(updatedJob.status, 'delivered');
    assert.ok(updatedJob.delivered_at);
  });

  // T-09: One recipient fails
  test('T-09: One recipient fails -> Other recipients jobs continue to be processed', async () => {
    const db = getDb();
    const now = new Date().toISOString();

    const jobAId = 'job_failing_A';
    const jobBId = 'job_success_B';

    // Job A created earlier than Job B
    db.prepare(`
      INSERT INTO notification_jobs (id, event_key, event_type, recipient_user_id, payload_json, status, attempts, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', 0, datetime('now', '-5 seconds'), datetime('now', '-5 seconds'))
    `).run(jobAId, 'key_A', 'registration_confirmation', memberId, JSON.stringify({ id: 'A' }));

    db.prepare(`
      INSERT INTO notification_jobs (id, event_key, event_type, recipient_user_id, payload_json, status, attempts, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', 0, datetime('now'), datetime('now'))
    `).run(jobBId, 'key_B', 'registration_confirmation', memberId, JSON.stringify({ id: 'B' }));

    // Configure mock to fail the next single request, then succeed
    await request(mockApp).post('/mock/mode').send({ mode: 'success', failNext: 1 });

    // 1. Process Job A -> fails with 500, transitions to retry_wait
    await worker.processNextJob();
    // 2. Process Job B -> succeeds with 200, transitions to delivered
    await worker.processNextJob();

    const jobA = db.prepare('SELECT * FROM notification_jobs WHERE id = ?').get(jobAId);
    const jobB = db.prepare('SELECT * FROM notification_jobs WHERE id = ?').get(jobBId);

    assert.strictEqual(jobA.status, 'retry_wait');
    assert.strictEqual(jobB.status, 'delivered');
  });

  // T-10 & T-11: Workshop cancellation fan-out and repeated cancellation
  test('T-10 & T-11: Workshop cancellation -> Fans out 1 job per member; repeated request returns 409', async () => {
    const ws = await request(app)
      .post('/api/workshops')
      .set('Authorization', `Bearer ${organizerToken}`)
      .send({
        title: 'Cancel Fan-Out Test Workshop',
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        location: 'Virtual Hall'
      });

    // Register member 1
    await request(app)
      .post(`/api/workshops/${ws.body.id}/registrations`)
      .set('Authorization', `Bearer ${memberToken}`);

    // Register member 2
    const mem2Email = 'member2@example.com';
    await request(app)
      .post('/api/auth/register')
      .send({ email: mem2Email, password: 'Password123!' });
    const mem2Login = await request(app)
      .post('/api/auth/login')
      .send({ email: mem2Email, password: 'Password123!' });
    await request(app)
      .post(`/api/workshops/${ws.body.id}/registrations`)
      .set('Authorization', `Bearer ${mem2Login.body.token}`);

    // 4. Organizer cancels workshop (T-10)
    const cancelRes = await request(app)
      .post(`/api/workshops/${ws.body.id}/cancel`)
      .set('Authorization', `Bearer ${organizerToken}`);

    assert.strictEqual(cancelRes.status, 200);
    assert.strictEqual(cancelRes.body.status, 'cancelled');
    assert.strictEqual(cancelRes.body.affectedMembers, 2);

    const db = getDb();
    const cancelJobs = db.prepare(`
      SELECT * FROM notification_jobs
      WHERE event_type = 'workshop_cancellation' AND payload_json LIKE ?
    `).all(`%${ws.body.id}%`);
    assert.strictEqual(cancelJobs.length, 2);

    // 5. Repeated cancellation request (T-11)
    const repeatCancel = await request(app)
      .post(`/api/workshops/${ws.body.id}/cancel`)
      .set('Authorization', `Bearer ${organizerToken}`);
    assert.strictEqual(repeatCancel.status, 409);
    assert.strictEqual(repeatCancel.body.error.code, 'ALREADY_CANCELLED');

    const cancelJobsAfter = db.prepare(`
      SELECT * FROM notification_jobs
      WHERE event_type = 'workshop_cancellation' AND payload_json LIKE ?
    `).all(`%${ws.body.id}%`);
    assert.strictEqual(cancelJobsAfter.length, 2);
  });

  // T-12: Role enforcement
  test('T-12: Role enforcement -> Member receives 403 for organizer-only operations', async () => {
    const res = await request(app)
      .post('/api/workshops')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({
        title: 'Unauthorized Workshop Attempt',
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        location: 'Virtual'
      });

    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.error.code, 'FORBIDDEN');
  });

  // T-13: Password storage
  test('T-13: Password storage -> Database contains a bcrypt hash, not submitted plaintext', async () => {
    const db = getDb();
    const user = db.prepare('SELECT password_hash FROM users WHERE email = ?').get(memberEmail);
    assert.ok(user);
    assert.notStrictEqual(user.password_hash, 'MemberPassword123!');
    assert.ok(user.password_hash.startsWith('$2'));
  });

  // T-14: Idempotency
  test('T-14: Idempotency -> Repeated job delivery attempts with same key are counted as one delivery', async () => {
    await request(mockApp).post('/mock/mode').send({ mode: 'success' });

    const key = 'job_idempotent_test_key_1';

    const res1 = await request(mockApp)
      .post('/mock/notifications')
      .set('Idempotency-Key', key)
      .send({ test: 1 });
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.body.isDuplicate, false);

    const res2 = await request(mockApp)
      .post('/mock/notifications')
      .set('Idempotency-Key', key)
      .send({ test: 1 });
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.body.isDuplicate, true);

    const stats = await request(mockApp).get('/mock/deliveries');
    assert.strictEqual(stats.body.uniqueDeliveries, 1);
  });
});

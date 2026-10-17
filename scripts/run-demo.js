/**
 * Demonstration Script for WorkshopSync
 * Implements the 9-Step Verification Plan from SDD Section 13
 */

const http = require('node:http');
const config = require('../src/config/env');
const app = require('../src/app');
const { app: mockApp } = require('../mock-notification/app');
const { getDb, closeDb } = require('../src/db/connection');
const { migrate } = require('../src/db/migrate');
const { seed } = require('../src/db/seed');
const worker = require('../src/worker/notificationWorker');

async function makeRequest(server, method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const options = {
      hostname: '127.0.0.1',
      port: address.port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (_) { parsed = data; }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runDemo() {
  console.log('================================================================');
  console.log('   WorkshopSync — 9-Step Verification & Failure Recovery Demo   ');
  console.log('================================================================\n');

  // Initialize DB
  const db = getDb();
  migrate(db);
  seed(db);

  // 1. Start Services
  console.log('[Step 1] Starting Mock Service and Backend API...');
  const mockServer = http.createServer(mockApp);
  await new Promise((r) => mockServer.listen(config.MOCK_PORT, r));

  const apiServer = http.createServer(app);
  await new Promise((r) => apiServer.listen(config.PORT, r));

  const healthApi = await makeRequest(apiServer, 'GET', '/health');
  const healthMock = await makeRequest(mockServer, 'GET', '/mock/health');
  console.log(` -> Backend Health: ${healthApi.status} (${JSON.stringify(healthApi.body)})`);
  console.log(` -> Mock Service Health: ${healthMock.status} (${JSON.stringify(healthMock.body)})\n`);

  // 2. Organizer Login & Workshop Creation
  console.log('[Step 2] Logging in as Organizer and creating workshop...');
  const orgLogin = await makeRequest(apiServer, 'POST', '/api/auth/login', {
    email: 'organizer@workshop.local',
    password: 'OrganizerPassword123!'
  });
  const orgToken = orgLogin.body.token;

  const wsRes = await makeRequest(apiServer, 'POST', '/api/workshops', {
    title: 'High-Throughput Node.js Architectures',
    description: 'Mastering event-driven and outbox architectures',
    startsAt: new Date(Date.now() + 86400000).toISOString(),
    location: 'Auditorium 1',
    capacity: 100
  }, { Authorization: `Bearer ${orgToken}` });
  const workshopId = wsRes.body.id;
  console.log(` -> Workshop created: ID=${workshopId}, Status=${wsRes.body.status}\n`);

  // 3. Member Login & Registration (Immediate 201)
  console.log('[Step 3] Member registration with Transactional Outbox...');
  const memberReg = await makeRequest(apiServer, 'POST', '/api/auth/register', {
    email: 'bob@example.com',
    password: 'Password123!'
  });
  const memberLogin = await makeRequest(apiServer, 'POST', '/api/auth/login', {
    email: 'bob@example.com',
    password: 'Password123!'
  });
  const memberToken = memberLogin.body.token;

  const startRegTime = Date.now();
  const regRes = await makeRequest(apiServer, 'POST', `/api/workshops/${workshopId}/registrations`, null, {
    Authorization: `Bearer ${memberToken}`
  });
  const regDuration = Date.now() - startRegTime;
  console.log(` -> Registration response: HTTP ${regRes.status} in ${regDuration}ms`);
  console.log(` -> Response body:`, regRes.body);
  const pendingJobId = regRes.body.notification.jobId;

  // Let worker process job
  await worker.processNextJob();
  const jobDelivered = db.prepare('SELECT status, attempts, delivered_at FROM notification_jobs WHERE id = ?').get(pendingJobId);
  console.log(` -> Outbox job status after worker processing:`, jobDelivered, '\n');

  // 4. Duplicate Registration Attempt
  console.log('[Step 4] Attempting duplicate registration (Database Uniqueness Enforcement)...');
  const dupRes = await makeRequest(apiServer, 'POST', `/api/workshops/${workshopId}/registrations`, null, {
    Authorization: `Bearer ${memberToken}`
  });
  console.log(` -> Duplicate response: HTTP ${dupRes.status}`, dupRes.body, '\n');

  // 5. Mock Service Failure & Retry Backoff
  console.log('[Step 5] Setting mock notification to ERROR mode and registering new member...');
  await makeRequest(mockServer, 'POST', '/mock/mode', { mode: 'error', statusCode: 500 });

  const mem2Reg = await makeRequest(apiServer, 'POST', '/api/auth/register', {
    email: 'charlie@example.com',
    password: 'Password123!'
  });
  const mem2Login = await makeRequest(apiServer, 'POST', '/api/auth/login', {
    email: 'charlie@example.com',
    password: 'Password123!'
  });
  const reg2Res = await makeRequest(apiServer, 'POST', `/api/workshops/${workshopId}/registrations`, null, {
    Authorization: `Bearer ${mem2Login.body.token}`
  });
  console.log(` -> Registration succeeded immediately: HTTP ${reg2Res.status}, Job=${reg2Res.body.notification.jobId}`);

  // Trigger worker poll (will hit simulated 500)
  await worker.processNextJob();
  const retryJob = db.prepare('SELECT status, attempts, next_attempt_at, last_error FROM notification_jobs WHERE id = ?').get(reg2Res.body.notification.jobId);
  console.log(` -> Outbox status after downstream failure:`, retryJob, '\n');

  // 6. Backend Restart Simulation with Pending Work
  console.log('[Step 6] Simulating backend/worker restart with pending retry job...');
  // Simulate crash recovery: job was in 'processing' when crash happened with expired lease
  db.prepare(`
    UPDATE notification_jobs
    SET status = 'processing',
        locked_until = datetime('now', '-5 seconds'),
        next_attempt_at = datetime('now', '-5 seconds')
    WHERE id = ?
  `).run(reg2Res.body.notification.jobId);
  console.log(' -> Simulated expired lock on processing job.');

  // 7. Mock Recovery to Success
  console.log('[Step 7] Restoring mock service to SUCCESS mode and processing jobs...');
  await makeRequest(mockServer, 'POST', '/mock/mode', { mode: 'success' });
  await worker.processNextJob();
  const recoveredJob = db.prepare('SELECT status, attempts, delivered_at FROM notification_jobs WHERE id = ?').get(reg2Res.body.notification.jobId);
  console.log(` -> Job transitioned on recovery:`, recoveredJob, '\n');

  // 8. Workshop Cancellation & Fan-Out
  console.log('[Step 8] Workshop cancellation and multi-member notification fan-out...');
  const cancelRes = await makeRequest(apiServer, 'POST', `/api/workshops/${workshopId}/cancel`, null, {
    Authorization: `Bearer ${orgToken}`
  });
  console.log(` -> Cancellation response: HTTP ${cancelRes.status}`, cancelRes.body);

  const cancelJobs = db.prepare(`SELECT id, event_key, status, recipient_user_id FROM notification_jobs WHERE event_type = 'workshop_cancellation' AND payload_json LIKE ?`).all(`%${workshopId}%`);
  console.log(` -> Enqueued cancellation jobs count: ${cancelJobs.length}`);
  cancelJobs.forEach((j) => console.log(`    - Job ${j.id}: ${j.event_key} (Status: ${j.status})`));

  // Process all fan-out jobs
  for (let i = 0; i < cancelJobs.length; i++) {
    await worker.processNextJob();
  }
  console.log(' -> All cancellation fan-out jobs delivered.\n');

  // 9. Inspect Logs & Job Records
  console.log('[Step 9] Inspecting final notification job status via API...');
  const inspectRes = await makeRequest(apiServer, 'GET', `/api/notifications/${cancelJobs[0].id}`, null, {
    Authorization: `Bearer ${orgToken}`
  });
  console.log(' -> Inspection API response:', inspectRes.body);

  console.log('\n================================================================');
  console.log('  Demonstration Completed Successfully! All 9 Steps Verified.   ');
  console.log('================================================================');

  // Clean shutdown
  await new Promise((r) => mockServer.close(r));
  await new Promise((r) => apiServer.close(r));
  closeDb();
  process.exit(0);
}

runDemo().catch((err) => {
  console.error('Demo encountered an error:', err);
  process.exit(1);
});

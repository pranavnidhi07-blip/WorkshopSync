# WorkshopSync — Reliable Workshop Registration and Notification System

WorkshopSync is a high-reliability backend service built with Node.js, Express, and SQLite. It demonstrates the **Transactional Outbox Pattern** to guarantee that member registrations and their pending notifications are committed atomically, then delivered asynchronously with bounded exponential backoff retries and receiver-side idempotency.

---

## 1. System Architecture & Design Principles

WorkshopSync solves the **dual-write failure problem** across network boundaries:
1. **Transactional Outbox**: Business mutations (member registration or workshop cancellation) and corresponding notification jobs are written in a **single SQLite immediate transaction**. Either both succeed or neither does.
2. **Asynchronous Polling Worker**: An outbox worker periodically queries pending jobs, claims them with a 30-second lease lock (`locked_until`), and delivers them to a downstream mock notification service outside the HTTP request path.
3. **At-Least-Once Delivery & Receiver Idempotency**: Network delivery cannot guarantee exactly-once execution over HTTP without receiver coordination. WorkshopSync sends stable `Idempotency-Key` headers (`job_<uuid>`), allowing the downstream service to deduplicate retried deliveries.
4. **Failure Recovery & Lease Reclamation**: If the worker crashes mid-delivery, the lease expires. Upon restart, the worker reclaims the stale `processing` job and safely retries.
5. **Bounded Exponential Backoff with Jitter**: Transient errors (HTTP 5xx, 429, timeouts) back off exponentially ($1\text{s}, 2\text{s}, 4\text{s}, \dots$) up to a 30s cap with jitter. After 8 attempts, jobs transition to `dead_letter` for operator inspection.

---

## 2. Prerequisites

- **Node.js**: `v20.x` or later (Tested on `v24.20.0`)
- **npm**: `v10.x` or later (Tested on `v11.19.0`)
- **Git**

---

## 3. Quickstart & Installation (Clean Checkout)

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Default configuration (`.env`):
```ini
PORT=3000
DATABASE_PATH=./data/workshopsync.sqlite
JWT_SECRET=replace-with-a-long-random-local-secret
JWT_EXPIRES_IN=1h
MOCK_NOTIFICATION_URL=http://localhost:4000/mock/notifications
MOCK_PORT=4000
WORKER_POLL_INTERVAL_MS=1000
WORKER_HTTP_TIMEOUT_MS=3000
MAX_NOTIFICATION_ATTEMPTS=8
```

### Step 3: Initialize Database & Seed Demo Organizer
```bash
npm run db:migrate
npm run seed
```
**Seeded Demo Credentials**:
- **Role**: `organizer`
- **Email**: `organizer@workshop.local`
- **Password**: `OrganizerPassword123!`

---

## 4. Running the Services

Open two separate terminals:

### Terminal 1 — Start the Mock Notification Service
```bash
npm run mock
```
*Listens on port 4000, accepts `POST /mock/notifications`, records delivery keys, and simulates failure modes.*

### Terminal 2 — Start the API Backend and Background Worker
```bash
npm run dev
```
*Listens on port 3000, handles HTTP requests, and polls the SQLite outbox table every 1000ms.*

---

## 5. Automated Verification & Testing

### Run All Unit & Acceptance Tests (T-01 to T-14)
```bash
npm test
```
The test suite validates:
- **T-01**: Organizer creates workshop (201 response, DB persisted)
- **T-02**: Member registers (201 response, atomic registration + pending outbox job)
- **T-03**: Duplicate registration (409 conflict, database uniqueness constraint)
- **T-04**: Invalid registration (4xx, 0 jobs created)
- **T-05**: Non-blocking async response (HTTP 201 returns immediately)
- **T-06**: Notification service returns 500 (Job transitions to `retry_wait`, reg saved)
- **T-07**: Mock service timeout (Worker records failure and retries without crashing)
- **T-08**: Backend restart recovery (Expired lease job reclaimed and delivered)
- **T-09**: Fault isolation (One recipient's failure does not block peer jobs)
- **T-10 & T-11**: Workshop cancellation fan-out (Atomic 1-job-per-member, repeated request returns 409)
- **T-12**: Role-based access control (Members receive 403 on organizer routes)
- **T-13**: Password security (Bcrypt hashed, no plaintext)
- **T-14**: Receiver idempotency (Duplicate delivery attempts with same key counted once)

### Run the Interactive 9-Step Verification Demo
```bash
node scripts/run-demo.js
```
Executes the complete live failure-and-recovery lifecycle end-to-end.

---

## 6. REST API Reference

All protected endpoints require `Authorization: Bearer <token>`.

### Authentication
- `POST /api/auth/register` — Public: Register a new member.
- `POST /api/auth/login` — Public: Login with email/password; returns signed JWT.

### Workshops
- `POST /api/workshops` — Organizer: Create workshop (`{ title, description, startsAt, location, capacity }`). Returns 201.
- `GET /api/workshops` — Member/Organizer: List scheduled workshops.
- `GET /api/workshops/:id` — Member/Organizer: View workshop details.
- `PATCH /api/workshops/:id` — Organizer: Update workshop fields.
- `POST /api/workshops/:id/cancel` — Organizer: Cancel workshop and atomically fan out cancellation jobs to all registered members.

### Registrations
- `POST /api/workshops/:id/registrations` — Member: Atomically registers and enqueues outbox job. Returns HTTP 201:
  ```json
  {
    "registrationId": "reg_123",
    "workshopId": "ws_456",
    "status": "registered",
    "notification": {
      "status": "pending",
      "jobId": "job_789"
    }
  }
  ```
- `GET /api/me/registrations` — Member: List own registrations and workshop statuses.
- `GET /api/workshops/:id/registrations` — Organizer: List attendee members for managed workshop.

### Outbox & Observability
- `GET /api/notifications/:id` — Organizer or recipient: Inspect job status, attempt count, and last error.
- `GET /health` — Public: API service health.
- `GET /mock/health` — Internal: Mock notification service status.
- `POST /mock/mode` — Internal: Switch mock behavior (`{ "mode": "success" | "error" | "timeout", "statusCode": 500 }`).

---

## 7. Postman Collection

Import `workshopsync.postman_collection.json` into Postman. It includes pre-configured folders and variables:
1. `01 - Health Checks`
2. `02 - Authentication` (Organizer & Member)
3. `03 - Workshop Management`
4. `04 - Member Registration`
5. `05 - Notification & Outbox Inspection`
6. `06 - Mock Control`

---

## 8. Out-of-Scope Items & Design Trade-Offs

- **No Real SMS/Email Providers**: Delivery is represented by the local HTTP mock service.
- **SQLite Concurrency**: SQLite permits one writer at a time. All write transactions are kept sub-millisecond, and the outbox worker never holds a write transaction open during HTTP calls. For high write throughput, the data layer can be migrated to PostgreSQL without changing service contracts.
- **At-Least-Once Delivery**: Downstream services must support idempotency using the provided `Idempotency-Key` header.

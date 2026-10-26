# ASDC Attendance Management System

MERN + Google Sign-In + rotating dynamic-QR attendance. Built from the Phase 1 requirements in `docs/phase1/` using the confirmed defaults:
session 90 min, QR refresh 20 s, backend grace 10 s, late threshold 10 min, LATE weight 0.5, EXCUSED excluded, Google Sign-In strictly pre-registered.
All defaults are environment variables (`backend/.env.example`).

```
backend/    Express + Mongoose API (modules/auth|users|courses|batches|enrollments|attendance|reports|audit)
frontend/   React (Vite) SPA: login, presenter QR dashboard, student scanner, admin management, reports, public course pages
docs/       Phase 1 specs, architecture + Mermaid diagrams, formula, Google OAuth setup, operations
backend/docs/openapi.yaml, ASDC.postman_collection.json   (regenerate: npm run docs:generate)
```

## Requirements
- Node.js 18+ (20 recommended)
- MongoDB: a normal local MongoDB (`mongodb://127.0.0.1:27017/asdc`) **or** MongoDB Atlas. No replica set needed.
- A Google OAuth Web client ID (`docs/GOOGLE_OAUTH_SETUP.md`)

## Run it (development)
```
npm run install:all
cp backend/.env.example backend/.env      # set MONGO_URI, ADMIN_EMAIL, GOOGLE_CLIENT_ID, and strong secrets
cp frontend/.env.example frontend/.env    # set VITE_GOOGLE_CLIENT_ID (same value)
npm run dev:backend                       # terminal 1 -> http://localhost:5000
npm run dev:frontend                      # terminal 2 -> http://localhost:5173
```
Generate secrets: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

## Run it (production, single process)
```
npm run install:all && npm run build      # builds frontend/dist
NODE_ENV=production npm start             # API + built web app on PORT (default 5000)
```
Set `NODE_ENV=production`, `SITE_URL`, `CLIENT_ORIGINS` to your public https URL. Put it behind your host's TLS (needed for phone cameras).
The app starts from a blank database. On startup it creates or updates the single admin account for `ADMIN_EMAIL`; no dummy users or seed accounts are created.
If old dummy course data is still in the database, run `npm run reset-db -- --dummy --yes` from `backend/` to remove it.
For test data, run `npm run reset-db -- --dummy --yes` from `backend/`.

### Daily attendance rules and existing data
Attendance is recorded once per student enrollment per calendar day, and there is one session per course batch per day. Sessions are assigned to their start date in `TIMEZONE` (default `Asia/Kolkata`) and are automatically closed by that day's end. A closed session can be reopened on the same day; only system-generated absent records are removed.

Before deploying these daily uniqueness constraints to a database with existing sessions, run this migration from `backend/` while the API is stopped:
```
npm run merge-same-day-sessions                 # dry run; no writes
npm run merge-same-day-sessions -- --yes         # merge data and create daily unique indexes
```
Review the dry-run counts and take a database backup before applying. The migration keeps the earliest non-cancelled session per batch/day, preserves the best record per enrollment, and discards attendance from cancelled sessions.

## Removing dummy data
Run these commands from `backend/`:
```
npm run reset-db                                            # dry run
npm run reset-db -- --dummy --yes                           # delete only dummy data
npm run reset-db -- --dummy --yes --email=<address>         # also delete that user
npm run reset-db -- --all --keep-admin --yes                # wipe everything, keep the admin
```
`--all` is destructive. Check the printed database name before confirming a deletion.

## Tests
```
npm test   # or: cd backend && npm test        # Jest + Supertest on a throw-away in-memory MongoDB (mongodb-memory-server)
# offline / custom binary: MONGOMS_SYSTEM_BINARY=/path/to/mongod npm test
npm run test:replset --prefix backend   # same tests on a replica set (transaction path)
```
Covers all 15 acceptance criteria: Google link/reject (verifyIdToken mocked), RBAC, grace-window boundaries, expired/forged tokens, cross-batch replay, proxy attempts, 6 concurrent scans -> 1 record, close -> ABSENT bulk, transfers keep history, corrections + immutable audit, secrets never in responses.

## Key design points
- Identity for check-in comes only from the JWT; `studentId` in the body is rejected (strict zod schema).
- QR token `ASDC1.<sessionId>.<version>.<HMAC>`: version N valid R+G s after rotation, N-1 only G s; rotation updates metadata only.
- Unique indexes: `{sessionId, enrollmentId}` and `{enrollmentId, sessionDate}` on records, `{batchId, sessionDate}` for SCHEDULED/OPEN/CLOSED sessions (one session per course per day), active `{batchId, studentId}` enrollments, sparse unique `googleId`.
- Multi-step operations (session close + ABSENT generation, enrollment transfer, manual correction + audit) use a MongoDB transaction automatically when the server supports it (replica set/Atlas); on a plain MongoDB they use atomic gates, idempotent upserts and rollback on failure. Both paths are tested.
- Auto-close of expired sessions runs every 30 s in the API process.
- Access token lives in memory only; refresh token is an httpOnly cookie with rotation + reuse detection.

## Known limits / next steps
- QR relay (a present student streaming the code to a remote one) cannot be fully prevented; use headcount reconciliation. No GPS/biometrics collected.
- Socket.IO needs sticky sessions or a Redis adapter when scaling to several API replicas.
- Optional extras not built: scheduled (future) sessions UI, MFA, IP-anomaly flags, email notifications.

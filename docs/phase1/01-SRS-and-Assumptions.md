# 1. Software Requirements Specification (SRS)

## 1.1 Purpose
Provide a secure, auditable attendance system for all ASDC courses, batches, students, trainers and administrators, using rotating QR codes scanned by authenticated students.

## 1.2 Scope
In scope: auth (local + Google), RBAC, courses/batches, enrollments and transfers, trainer assignment, QR attendance sessions, check-in, auto-absent, manual corrections, reports/export, audit log, live dashboard, public course catalog (SEO).
Out of scope (v1): GPS/biometrics, payments, LMS/content, native mobile apps, parent portals, email/SMS notifications.

## 1.3 Stakeholders and roles
SUPER_ADMIN, ADMIN, TRAINER, STUDENT (strict RBAC, enforced server-side).

## 1.4 Technology constraints
MongoDB (standalone or Atlas; transactions used automatically when available), Node.js, Express, React (Vite), Mongoose, JavaScript ES6+, Socket.IO (polling fallback), `google-auth-library` + `@react-oauth/google`, JWT access + rotating httpOnly refresh cookie, `qrcode.react` / `html5-qrcode`, Zod/Joi validation. Monorepo: `frontend/`, `backend/`.

## 1.5 Functional requirements (summary)
| ID | Requirement |
|---|---|
| FR-AUTH-1 | Email/password login (Argon2id or bcrypt cost >= 12) |
| FR-AUTH-2 | Google Sign-In; ID token verified server-side (signature, `aud`, `iss`, `email_verified`) |
| FR-AUTH-3 | Only pre-registered users can sign in via Google; first login links immutable `sub` as `googleId` |
| FR-AUTH-4 | 15-min access JWT; rotating refresh token, hashed in DB, revocable |
| FR-RBAC-1 | Every endpoint checks role and resource scope (batch assignment, own records) server-side |
| FR-ORG-1 | Courses, batches, enrollment lifecycle (ACTIVE, TRANSFERRED, COMPLETED, DROPPED), trainer assignments |
| FR-ORG-2 | Batch transfer is atomic and preserves history under the original enrollment |
| FR-SES-1 | Authorized Admin/Trainer starts a session (OPEN) for an active batch; one open session per batch per scheduled slot |
| FR-SES-2 | QR token rotation updates token metadata only; never creates sessions |
| FR-SES-3 | Closing a session blocks check-ins and bulk-creates ABSENT records for unrecorded ACTIVE enrollments |
| FR-SES-4 | Sessions can be CANCELLED with reason; excluded from percentages |
| FR-CHK-1 | Student check-in derives identity from JWT only; payload IDs ignored/rejected |
| FR-CHK-2 | Status PRESENT or LATE by server time vs. late threshold; duplicates return 409, no overwrite |
| FR-COR-1 | Only Admin/Super Admin correct records; mandatory reason; immutable AuditLog entry in same transaction |
| FR-REP-1 | Student history/percentage per enrollment; staff reports, summaries, CSV/JSON export |
| FR-LIVE-1 | Live check-in feed and counts for authorized presenters (Socket.IO, polling fallback) |
| FR-AUD-1 | Audit log for Google linking, session lifecycle, corrections, transfers, role changes |
| FR-SEO-1 | Public course pages indexable; all authenticated/API routes noindex |

## 1.6 Non-functional requirements
- Security: OWASP ASVS L2 aligned; NoSQL-injection sanitisation; rate limiting; strict CORS; helmet with `COOP: same-origin-allow-popups`; no secrets/hashes in responses or logs.
- Performance: check-in p95 < 500 ms at 300 concurrent scans per batch; live dashboard updates < 2 s.
- Integrity: unique `{sessionId, enrollmentId}`; unique `{batchId, studentId}` for active enrollments; transactions for multi-document operations.
- Availability: health endpoints; graceful shutdown; stateless API nodes (Socket.IO needs sticky sessions or Redis adapter if scaled).
- Time: all validation uses server UTC time; presented in ASDC's configured timezone.
- Privacy: no GPS or biometrics; QR payload carries no personal data.
- Accessibility/UX: mobile-first student UI; high-contrast projector QR.

## 1.7 Core assumptions
1. Greenfield build; single organisation (ASDC), single timezone (configurable).
2. Admins pre-register all users with official emails; no public self-signup.
3. Students have smartphones with a camera and HTTPS access in production.
4. MongoDB may be standalone or a replica set; multi-step writes are transactional when supported and otherwise use ordered writes with rollback.
5. One QR session = one class meeting for one batch.
6. Presenters (Admin/Trainer) are physically present and project the QR.
7. Classroom network reaches the server (latency up to ~5 s tolerated by the grace window).
8. Trainers can start sessions only when explicitly authorised on the assignment (`canManageSessions`).
9. A student may hold multiple ACTIVE enrollments across different batches, but only one per batch.
10. Retention: attendance and audit data kept for the configured period (default: indefinite, pending confirmation).

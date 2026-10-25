# 4. Business Rules

## 4.1 Google OAuth provisioning and linking
- BR-G1: No auto-registration by default. Only users pre-registered by an Admin may sign in with Google (optional domain-restricted auto-registration is a decision for you, see 06).
- BR-G2: Backend verifies with `OAuth2Client.verifyIdToken`: signature, `aud == GOOGLE_CLIENT_ID`, `iss` in {accounts.google.com, https://accounts.google.com}, `exp`, and `email_verified === true`. Client-decoded payloads are never trusted.
- BR-G3: Matching order: (1) `googleId == sub`; (2) else lowercase `email` of a pre-registered user with no `googleId`.
- BR-G4: First link stores `sub` permanently (immutable once set; changing requires Super Admin action with audit), adds `GOOGLE` to `authProviders`, writes AuditLog `GOOGLE_LINKED`.
- BR-G5: A `sub` already bound to a different user, or a mismatch with the stored `googleId`, is rejected (403) and audited.
- BR-G6: User status must be ACTIVE; INACTIVE/SUSPENDED users are rejected on every login and refresh.
- BR-G7: Google-only users have no `passwordHash`; hybrid login allowed if both providers are enabled by an Admin.
- BR-G8: Unregistered account -> 403 `ACCOUNT_NOT_REGISTERED`; nothing is created.

## 4.2 QR rotation vs grace window (precise semantics)
- BR-Q1: Each session holds `currentTokenVersion`, `lastRotatedAt`, `refreshIntervalSeconds` (R, default 20) and `gracePeriodSeconds` (G, default 10).
- BR-Q2: Rotation (`POST .../qr-token`) increments `currentTokenVersion`, sets `lastRotatedAt = now`, and returns a signed token `{sessionId, version, iat}` (HMAC-SHA256 or JWT, secret server-only). No new session is created. The presenter UI requests the next token on its R-second cycle.
- BR-Q3: Validation at time `now`: signature valid; `sessionId` matches; AND either `version == current` OR (`version == current-1` AND `now - lastRotatedAt <= G`). Anything older -> `QR_EXPIRED`.
- BR-Q4: Therefore a displayed code stays scannable for at most R + G seconds (default 30 s). R is a display cadence; G is the latency tolerance. These are independent settings.
- BR-Q5: Rotation requests are idempotent against double-fire: a rotation within 2 s of the last returns the current token instead of bumping the version (prevents burn-through).
- BR-Q6: Token payload contains no student, personal, or permanent data. Closing the session invalidates all tokens (status check first).
- BR-Q7: Trade-off documented in Phase 2 (stateless signed token vs stateful stored token); Phase 1 default is a signed stateless token plus the version stored on the session (one session read per scan, no per-token DB writes).

## 4.3 Session lifecycle
- BR-S1: States: SCHEDULED -> OPEN -> CLOSED; SCHEDULED/OPEN -> CANCELLED (reason required). CLOSED and CANCELLED are terminal.
- BR-S2: Only one OPEN session per batch at a time (enforced by partial unique index).
- BR-S3: Start requires: batch ACTIVE, actor is Admin/Super Admin or Trainer assigned with `canManageSessions`.
- BR-S4: Default duration 90 min; auto-close at scheduled end via a server job; manual close allowed any time.
- BR-S5: Check-ins accepted only while OPEN.

## 4.4 Late arrival
- BR-L1: `PRESENT` if `serverNow <= actualStartTime + lateThresholdMinutes`; `LATE` if later and session still OPEN. Default threshold 10 min (configurable per session at start).
- BR-L2: Status is decided solely by server UTC time; client clock ignored.

## 4.5 Check-in and duplicates
- BR-C1: Identity from JWT only. Student must have an ACTIVE enrollment in the session's batch.
- BR-C2: Unique `{sessionId, enrollmentId}`; E11000 -> 409 `ALREADY_CHECKED_IN`. Scans never overwrite existing records (including ABSENT/EXCUSED set by staff).
- BR-C3: Rate limits on check-in and token rotation per user/IP.

## 4.6 Automatic ABSENT on close
- BR-A1: On close, in one transaction: set status CLOSED, `actualEndTime`, `closedBy`; then `bulkWrite` upserts (`$setOnInsert`, `upsert: true`, filter `{sessionId, enrollmentId}`) of ABSENT records, `recordedMethod = SYSTEM_AUTO_ABSENT`, for every ACTIVE enrollment of the batch (enrolled before session start) lacking a record. Existing records are untouched; operation is idempotent.
- BR-A2: Cancelled sessions generate no records.
- BR-A3: Closing writes AuditLog `SESSION_CLOSED` with counts.

## 4.7 Manual corrections
- BR-M1: Only ADMIN/SUPER_ADMIN. Trainers and students cannot modify records.
- BR-M2: `reason` mandatory (trimmed, min length 5, max 500).
- BR-M3: Record update and AuditLog insert are one transaction; failure rolls both back.
- BR-M4: AuditLog is append-only (no update/delete endpoints; model hooks block mutation).
- BR-M5: Correction sets `recordedMethod`/`lastModifiedBy`/`correctionReason`; the original `recordedBy` is preserved.
- BR-M6: Corrections on CANCELLED sessions are rejected.

## 4.8 Enrollment and transfer
- BR-E1: Transfer: old enrollment -> TRANSFERRED (`endedAt`), new ACTIVE enrollment in target batch (same course or Admin-approved other), audit entry; all in one transaction.
- BR-E2: Historical records stay linked to the old `enrollmentId`/`batchId`.
- BR-E3: DROPPED/COMPLETED enrollments cannot check in; no further ABSENT records.

## 4.9 Access
- BR-X1: Trainers see only assigned batches. Students see only their own data. Role/ID/batch from the client are never trusted.
- BR-X2: Suspending a user revokes all refresh tokens.

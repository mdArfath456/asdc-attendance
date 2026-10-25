# 2. User Stories and Acceptance Criteria

Format: Given / When / Then.

## Authentication
**US-AUTH-1 (All) Local login.** As a user I log in with email/password.
- Given valid credentials and status ACTIVE, then I receive an access token and refresh cookie.
- Given wrong credentials, then 401 with a generic message (no user enumeration).
- Given status INACTIVE/SUSPENDED, then 403.
- Given 5+ failed attempts within the window, then 429.

**US-AUTH-2 (Pre-registered user) Google Sign-In.** As a pre-registered user I sign in with Google.
- Given a valid Google ID token with `email_verified=true`, correct `aud`/`iss`, and an email matching a pre-registered ACTIVE user, then I get ASDC tokens.
- Given my first Google login, then my `sub` is stored as `googleId`, `GOOGLE` is added to `authProviders`, and an AuditLog entry `GOOGLE_LINKED` is written.
- Given later logins, then matching is by `googleId` first, so email changes at Google do not break access.

**US-AUTH-3 (Security) Reject unregistered Google accounts.**
- Given a valid token for an unregistered email, then 403 "Account not registered with ASDC" and no user is created.
- Given `email_verified=false`, a bad signature, wrong audience, or expired token, then 401.
- Given a `googleId` already linked to another user, or a user whose stored `googleId` differs from the token `sub`, then 403 and an audit event.
- Given a client-supplied email/profile without a verifiable token, then it is never trusted.

**US-AUTH-4 Session lifecycle.** Refresh rotates the token; reuse of a rotated refresh token revokes the token family; logout revokes the current token.

## Super Admin
**US-SA-1** Manage all courses, batches, admins, trainers, students. AC: CRUD allowed organisation-wide; role changes audited.
**US-SA-2** View org-wide attendance, reports, audit logs. AC: filters by course/batch/date/actor; audit entries are read-only.
**US-SA-3** Approve/perform corrections. AC: same as US-AD-6.

## Admin
**US-AD-1 Provision users.** AC: Admin creates STUDENT/TRAINER users with email (local or Google-enabled); duplicate email -> 409; Admin cannot create SUPER_ADMIN.
**US-AD-2 Courses and batches.** AC: unique course code/slug; batch has course, schedule, status (ACTIVE/COMPLETED/ARCHIVED); archived batches cannot start sessions.
**US-AD-3 Enrollment and transfer.** AC: enrolling an already ACTIVE student in the same batch -> 409; transfer atomically sets old enrollment TRANSFERRED and creates a new ACTIVE one with an audit entry; if any step fails nothing changes.
**US-AD-4 Assign trainers.** AC: assignment records `canManageSessions`; removal immediately revokes access.
**US-AD-5 Run a session.** AC: start session -> status OPEN, QR displayed, token rotates every configured interval, live counts shown; end session -> confirmation, status CLOSED, ABSENT records created.
**US-AD-6 Correct attendance.** AC: `reason` required (non-empty after trim) else 400; record updated and AuditLog written in one transaction (actor, previous, new, reason, timestamp); audit entry cannot be edited or deleted.
**US-AD-7 Reports.** AC: filter and export CSV/JSON; exports respect scope.

## Trainer
**US-TR-1** View only assigned batches and their students. AC: unassigned batch -> 403/404.
**US-TR-2** Start/manage sessions only if authorised. AC: assigned without `canManageSessions` -> 403 on start/rotate/close.
**US-TR-3** View permitted attendance and reports. AC: read-only; no corrections.

## Student
**US-ST-1 Log in** via Google or credentials (US-AUTH-1/2).
**US-ST-2 Scan and check in.**
- Given an OPEN session, valid token within TTL/grace, and my ACTIVE enrollment in that batch, then record created as PRESENT, or LATE if after the threshold.
- Given an expired token -> `QR_EXPIRED`; invalid signature/unknown -> `QR_INVALID`; closed/cancelled/not-open session -> `SESSION_NOT_OPEN`; not enrolled or enrollment not ACTIVE -> `ENROLLMENT_INELIGIBLE`/`BATCH_MISMATCH` (403); already recorded -> 409 `ALREADY_CHECKED_IN`.
- Given a body containing `studentId`, then it is ignored or rejected; identity comes from `req.user`.
- Given two concurrent scans, then exactly one record exists and the other receives 409.
**US-ST-3 Camera handling.** AC: clear guidance on permission denial, front/rear switching, HTTPS requirement.
**US-ST-4 My attendance.** AC: grouped by enrollment/batch, per-session statuses, percentage per US formula; no access to other students' data (403).

## Public visitor
**US-PUB-1** Browse public courses with SEO metadata. AC: no student/batch/attendance data exposed; `/api/*` and private routes noindex.

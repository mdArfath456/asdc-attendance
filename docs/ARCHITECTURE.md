# Architecture, QR design and threat model

## System
```mermaid
flowchart LR
  S[Student phone<br/>React + html5-qrcode] -->|HTTPS REST| API
  P[Presenter screen<br/>React + qrcode.react] -->|REST + Socket.IO| API
  G[Google Identity Services] -->|ID token| S
  API[Express API<br/>modular monolith] -->|google-auth-library verifyIdToken| G
  API --> DB[(MongoDB)]
```

## Google sign-in and account linking
```mermaid
sequenceDiagram
  participant U as User
  participant FE as React
  participant G as Google
  participant BE as API
  U->>FE: Click "Sign in with Google"
  FE->>G: Popup (COOP same-origin-allow-popups)
  G-->>FE: ID token (credential)
  FE->>BE: POST /auth/google {idToken}
  BE->>G: verifyIdToken (signature, aud, iss, exp)
  BE->>BE: email_verified? find by googleId, else by pre-registered email
  alt not registered
    BE-->>FE: 403 ACCOUNT_NOT_REGISTERED (nothing created)
  else first login
    BE->>BE: store googleId (sub), add GOOGLE provider, AuditLog GOOGLE_LINKED
    BE-->>FE: access JWT + httpOnly refresh cookie
  end
```

## QR check-in
```mermaid
sequenceDiagram
  participant P as Presenter
  participant BE as API
  participant S as Student
  P->>BE: POST /batches/:id/attendance-sessions
  BE-->>P: session OPEN + token v1
  loop every 20s
    P->>BE: POST /attendance-sessions/:id/qr-token
    BE-->>P: token v(n+1) (metadata update only)
  end
  S->>BE: POST /attendance/check-in {token} (JWT identifies student)
  BE->>BE: verify HMAC, session OPEN, version/grace, ACTIVE enrollment in session batch
  BE->>BE: PRESENT/LATE by server time, insert (unique sessionId+enrollmentId)
  BE-->>S: 201 / 409 ALREADY_CHECKED_IN / specific error code
  BE-->>P: Socket.IO attendance:checkin
  P->>BE: POST .../close  (CLOSED gate + bulkWrite ABSENT + AuditLog)
```

## Data model (MongoDB)
```mermaid
erDiagram
  USER ||--o{ ENROLLMENT : has
  COURSE ||--o{ BATCH : offers
  BATCH ||--o{ ENROLLMENT : contains
  BATCH ||--o{ TRAINER_ASSIGNMENT : staffed_by
  BATCH ||--o{ ATTENDANCE_SESSION : holds
  ATTENDANCE_SESSION ||--o{ ATTENDANCE_RECORD : produces
  ENROLLMENT ||--o{ ATTENDANCE_RECORD : owns
  USER ||--o{ REFRESH_TOKEN : owns
  USER ||--o{ AUDIT_LOG : acts
```
Key indexes: `User.email` unique, `User.googleId` unique sparse, `AttendanceRecord{sessionId,enrollmentId}` unique, `Enrollment{batchId,studentId}` unique where `status=ACTIVE`, `AttendanceSession{batchId}` unique where `status=OPEN`.

## QR token trade-offs
| | Stateless signed (implemented) | Stateful server tokens |
|---|---|---|
| DB load per scan | one session read | token lookup + possible writes per rotation |
| Revocation | close/cancel session or bump version | delete token |
| Grace window | version N-1 for `QR_GRACE_SECONDS` | keep previous row until TTL |
| Replay | bounded by R+G seconds | same, plus single-use possible |
Token = `ASDC1.<sessionId>.<version>.<HMAC-SHA256>`; contains no personal data. Version N is valid for R+G seconds after its rotation (also if the presenter stops rotating); N-1 only for G seconds.

## RBAC matrix (server-enforced)
| Capability | Super Admin | Admin | Trainer (assigned) | Student |
|---|---|---|---|---|
| Users / courses / batches / enrollments | yes (admins only SA) | yes (no admin creation) | read assigned batches | - |
| Start / rotate / close session | yes | yes | only with `canManageSessions` | - |
| View session records / reports | all | all | assigned only | - |
| Manual correction | yes | yes | no | no |
| Check in / own history | - | - | - | own only |
| Audit logs / export | yes | yes | no | no |

## Threat model highlights
Proxy attendance via shared logins (identity only from JWT, SSO, refresh rotation), QR relay (short TTL; cannot be fully prevented - use headcount reconciliation), token forgery (HMAC), duplicate/concurrent scans (unique index + E11000 -> 409), IDOR (batch scope checks in services), NoSQL injection (sanitise + zod strict schemas), brute force (rate limits), CSV formula injection (cell escaping), refresh theft (rotation + family revocation), clickjacking/XSS (helmet; no tokens in localStorage - access token in memory only).
No GPS or biometrics are collected. Optional IP-subnet anomaly flags would need your approval (privacy impact).

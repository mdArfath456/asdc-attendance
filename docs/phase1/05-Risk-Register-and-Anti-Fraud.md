# 5. Risk Register and Anti-Fraud Controls

Scale: Likelihood (L) / Impact (I): Low, Med, High.

| ID | Risk | L | I | Mitigation |
|---|---|---|---|---|
| R1 | Remote QR sharing (photo/stream sent to absent friend) | High | High | 30 s lifetime, headcount comparison, optional controls below; residual risk accepted and documented |
| R2 | Proxy attendance (friend scans with another's login) | Med | High | Identity from JWT only; Google SSO; no shared sessions; refresh rotation; user education |
| R3 | Unauthorised Google account access | Low | High | Pre-registration only, full ID-token verification, `sub` linking, audit |
| R4 | Account takeover of staff | Low | High | Argon2id/bcrypt, rate limits, short JWT, cookie flags, optional MFA (future) |
| R5 | Duplicate/concurrent scans | High | Med | Unique compound index, E11000 handling, concurrency tests |
| R6 | Network latency causes valid scans to fail | Med | Med | Grace window G, clear error codes, retry guidance |
| R7 | Clock skew | Low | Med | Server time only |
| R8 | NoSQL injection / mass assignment | Med | High | Sanitisation, Zod, primitive casting, whitelisted fields |
| R9 | Token secret leakage | Low | High | Env validation, rotation procedure, never logged |
| R10 | Plain MongoDB has no multi-document transactions | Med | High | Transaction auto-detection; atomic gates, idempotent upserts, rollback, repair job |
| R11 | Data loss on transfers/corrections | Low | High | Transactions, immutable audit, backups |
| R12 | Google popup blocked (COOP) | Med | Low | `same-origin-allow-popups` via helmet |
| R13 | Socket.IO scaling/leaks across batches | Low | Med | Auth on connect, rooms per authorised session, Redis adapter if scaled |
| R14 | Privacy complaints (tracking) | Low | Med | No GPS/biometrics by default; minimal data; retention policy |
| R15 | Camera/HTTPS unsupported on student devices | Med | Med | Instructions, fallback manual code entry (to confirm, see 06) |
| R16 | Presenter forgets to close session | Med | Med | Auto-close at end time, idle warnings |
| R17 | Scope creep | Med | Med | Phase gates and approvals |

## Anti-fraud operational controls (and limits)
Honest statement: rotating QR codes reduce replay and casual sharing but cannot stop a classroom student streaming the live code to a remote peer. This system is fraud-resistant, not fraud-proof.

| Control | How | Limitation |
|---|---|---|
| Short TTL + rotation | 20 s display, 10 s grace | Live streaming still works |
| Live headcount reconciliation | Presenter compares on-screen check-in count with people physically present; can invalidate and re-run | Manual, depends on presenter |
| Session locking | Presenter locks check-ins once class has started/settled | Late genuine arrivals need manual marking |
| Rotation on demand | Presenter can force-rotate during the class | Does not prevent real-time sharing |
| IP/subnet anomaly flag (optional, needs approval) | Flag check-ins from IPs outside the classroom network range | Mobile data/VPN false positives; privacy considerations |
| Rate limits and duplicate rejection | Per user/IP | Not a fraud control for sharing |
| Device/session anomaly logging | Log multiple logins/users from the same IP in short time | Shared NAT creates noise |
| Audit review | Admin reports on odd patterns (always last-second scans, same IP bursts) | After-the-fact |

Not implemented by default (need your explicit approval, with privacy impact): GPS geofencing (location data collection, spoofable), face/biometric checks (sensitive biometric data, legal consent), device fingerprinting (tracking concerns).

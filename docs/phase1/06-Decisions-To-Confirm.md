# 6. Default Parameters — Please Confirm or Adjust

| # | Parameter | Proposed default | Notes |
|---|---|---|---|
| 1 | Session duration | 90 minutes | auto-close at end |
| 2 | QR visual refresh interval (R) | 20 seconds | |
| 3 | Backend grace period (G) | 10 seconds (token valid R+G = 30 s) | accepts version N and N-1 |
| 4 | Late threshold | 10 minutes after start | per-session override |
| 5 | Weights | PRESENT 1.0, LATE 0.5 | alternatives: LATE 0.75 or 1.0 |
| 6 | EXCUSED treatment | Excluded from denominator | alternative: full credit |
| 7 | Minimum attendance threshold flag | 75% (display only) | |
| 8 | Google Sign-In mode | Strictly pre-registered | alternative: domain-restricted auto-registration (e.g. @yourdomain), then which role and domain? |
| 9 | Trainer session control | Needs `canManageSessions` on assignment | |
| 10 | Manual code fallback if camera fails | Not included | optional short typed code (weaker security) |
| 11 | Data retention | Indefinite until you specify | |
| 12 | Timezone | Asia/Kolkata | |
| 13 | Anomaly flag on IP/subnet | Off | needs approval |

Reply "approved" (or list changes) to proceed to Phase 2 (System Design).

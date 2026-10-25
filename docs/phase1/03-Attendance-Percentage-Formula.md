# 3. Attendance Percentage Formula

## 3.1 Definitions (per enrollment E)
- Eligible session: a session of E's batch with status CLOSED that has an AttendanceRecord for E. (CANCELLED and SCHEDULED/OPEN sessions are excluded; OPEN sessions are not counted until closed.)
- Counts over eligible sessions of E: P = PRESENT, L = LATE, A = ABSENT, X = EXCUSED.
- Configurable weights (defaults): wP = 1.0, wL = 0.5, wX = excluded.

## 3.2 Formula (default policy: EXCUSED excluded)
```
Denominator D = P + L + A
Numerator   N = (wP * P) + (wL * L)
Percentage  = (N / D) * 100        rounded to 2 decimals (half up)
If D = 0     -> percentage = null ("N/A"), not 0
```
Alternative policy (selectable at batch level): EXCUSED counts as full credit -> D = P + L + A + X, N += X.

## 3.3 Worked example
20 sessions held, 2 CANCELLED -> 18 eligible. P=12, L=3, A=2, X=1.
D = 12+3+2 = 17; N = 12 + 1.5 = 13.5; Percentage = 79.41%.
With "EXCUSED = full credit": D = 18, N = 14.5 -> 80.56%.

## 3.4 Rules
1. CANCELLED sessions never enter numerator or denominator.
2. Sessions before enrollment start, or after a transfer/drop, produce no records for E and therefore do not count.
3. Transfers: each enrollment is calculated independently (Batch A enrollment keeps its history). The student's overall figure is `sum(N) / sum(D)` across all their enrollments in the same course, shown separately from per-enrollment values.
4. Corrections (e.g. ABSENT -> EXCUSED) change the figure immediately on next calculation; percentages are computed at read time (not stored) to avoid drift.
5. A student who enrolls after a session starts is not given an ABSENT record for it (enrollment `enrolledAt` must be <= session `actualStartTime`).
6. Optional institutional threshold (e.g. 75%) is display-only in v1: flag "below threshold".

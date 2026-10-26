# Attendance percentage formula (implemented in `backend/src/utils/percentage.js`)

Per **enrollment**, over the single session per course batch per day with status `CLOSED` (CANCELLED/OPEN/SCHEDULED never count). A session is assigned to the calendar day when it started in the configured `TIMEZONE`; it closes no later than that local day’s end. Reopening a closed session on the same day removes only system-generated absences so eligible students can scan.

```
D = PRESENT + LATE + ABSENT            (+ EXCUSED when EXCUSED_POLICY=FULL_CREDIT)
N = PRESENT + LATE_WEIGHT * LATE       (+ EXCUSED when EXCUSED_POLICY=FULL_CREDIT)
percentage = N / D * 100  (2 decimals)     null when D = 0
```
Defaults: `LATE_WEIGHT=0.5`, `EXCUSED_POLICY=EXCLUDE`, display threshold `ATTENDANCE_THRESHOLD=75`.
Example: P=12, L=3, A=2, X=1 -> D=17, N=13.5 -> **79.41%**.
Transfers: each enrollment is calculated on its own; the student's overall value is `sum(N)/sum(D)`.
Students enrolled after a session started get no ABSENT record for it. Covered by `tests/unit/percentage.test.js`.

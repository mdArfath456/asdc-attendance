# Operations
## MongoDB
Any MongoDB 5+ works: local standalone (`MONGO_URI=mongodb://127.0.0.1:27017/asdc`) or Atlas (`mongodb+srv://user:pass@cluster/asdc`). A replica set is optional: when present the API uses real transactions, otherwise ordered writes with rollback (see `src/utils/transaction.js`). A crashed session close is repaired automatically by the 30 s background job (`absentGeneratedAt`).
## Backup / restore
`mongodump --uri "$MONGO_URI" --gzip --archive=asdc-$(date +%F).gz` ; `mongorestore --uri "$MONGO_URI" --gzip --archive=asdc-2026-01-01.gz --drop`
Keep the `auditlogs` collection in every backup. Test restores regularly.
## Index migrations
Indexes are declared in the models and built at startup (`Model.init()`). To change a unique/partial index: deploy the new definition, drop the old index with `db.<collection>.dropIndex(name)` (names: `unique_active_enrollment`, `one_open_session_per_batch`), restart the API.
## Secrets rotation
Rotating `QR_SIGNING_SECRET` invalidates currently displayed QR codes (presenters refresh within 20 s). Rotating `JWT_ACCESS_SECRET` forces refresh (users stay logged in via refresh cookies).
## Scaling
Socket.IO needs sticky sessions or the Redis adapter when running several API replicas. The auto-close job is idempotent and safe on multiple replicas.
## SEO
Public: `/courses`, `/courses/:slug` (react-helmet-async metadata + Course JSON-LD), `/sitemap.xml` and `/robots.txt` served by the API . `/api`, `/admin`, `/trainer`, `/student` send `X-Robots-Tag: noindex, nofollow`.

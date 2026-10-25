# Google Cloud Console setup
1. Google Cloud Console -> APIs & Services -> OAuth consent screen: choose *Internal* (Workspace) or *External*, add app name and support email.
2. Credentials -> Create credentials -> OAuth client ID -> **Web application**.
3. **Authorized JavaScript origins**: `http://localhost:5173` (dev), your production origin, e.g. `https://attendance.asdc.org`.
4. Redirect URIs are not needed (Google Identity Services popup/ID-token flow); add none.
5. Put the client ID in `backend/.env` as `GOOGLE_CLIENT_ID` and in `frontend/.env` as `VITE_GOOGLE_CLIENT_ID` (same value).
6. Pre-register users (Admin -> Manage -> Users) with their official Google email; they link on first sign-in.
7. Set `CLIENT_ORIGINS` to the exact frontend origin(s). Credentialed CORS and refresh/logout Origin checks use this allowlist.
Troubleshooting: "origin_mismatch" = origin missing in step 3. Popup blocked / COOP console errors = the API must keep `Cross-Origin-Opener-Policy: same-origin-allow-popups` (already set via helmet; also set it on any reverse proxy serving the SPA).

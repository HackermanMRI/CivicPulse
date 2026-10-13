# Verification checklist

Tick each line on your laptop after `docker compose up -d --build` and `seed-demo`. Send me any line that fails,
with the output of `docker compose logs --tail 80 api worker`.

## Stack
- [ ] `docker compose ps`: db, redis, api (healthy), worker, scheduler, nginx all running.
- [ ] `curl.exe http://127.0.0.1:8000/api/health` → `"database": true`, `"migration": "0001"`, `"tables": 36`, `"categories": 7`.
- [ ] `docker compose logs worker` shows `Listening on civicpulse`.
- [ ] https://localhost opens the login page with no certificate warning.
- [ ] Tests: 93 passed (RUN.md §8).

## Accounts (as a new user, on a phone)
- [ ] Sign-up: phone → 6-digit code shown on screen (DEV_MODE) → name + password → 3 permissions → areas → lands on the module picker.
- [ ] A second sign-up on the same phone is refused ("one account per device"); the admin Alerts tab shows a device violation.
- [ ] Reload the page: still logged in. Log out, log in again.
- [ ] Forgot password works with a new code.

## Radix + Motion (B5, B11)
- [ ] `docker compose up -d --build` finishes (the frontend image installs @radix-ui/* and motion; first build after this change needs internet).
- [ ] Pop-ups (report, "How reputation works") fade and rise in, close with Esc, outside click and the X; Tab stays inside while open.
- [ ] Selects open a list; arrow keys and typing a letter move through it; Esc closes it.
- [ ] Alerts tabs switch with ← →; the active pill slides. The bottom-bar pill slides between pages.
- [ ] Toasts appear at the bottom, can be swiped down or closed with ×, and are read out by a screen reader.
- [ ] Dashboard map buttons show a label on hover and on keyboard focus. Tapping a DEMO badge on a card explains it.
- [ ] With "Reduce motion" on in the OS, nothing slides; short fades only.

## Green Guard (log in as 01700000001)
- [ ] Feed matches the mockup: "Pinned Reports" bar on top; unvoted cards show the reporter's name, a locked "Reputation after vote" pill, the category band, text, photo and three buttons (Verify on spot / nearby / from far away).
- [ ] Open an unvoted card: no status, scores or reputation. Tap "Verify from far away" → "Issue confirmed" → "Send vote": the card now shows credibility/uncertainty bars, the status chip, reputation and the On spot / Nearby / Far away ✓✕ tiles.
- [ ] "Why this score?" lists the 7 components with explanations; text/photo say "DEMO synthetic score".
- [ ] Pin a card; the count on the "Pinned Reports" bar goes up and the card is listed there.
- [ ] Report an issue in 5 steps: category → location (GPS ± m and detected ward) → camera → photo and text (retake counter) → review → "Report sent" pulse. A second report the same day is refused.
- [ ] The new report gets a status within a minute (worker). Its text/image are "unavailable" until models are installed.
- [ ] On a second phone (01700000003) the "new report in your locality" alert appears without reloading (live SSE).
- [ ] On-the-spot vote: GPS + camera; the photo shows under "On-the-spot photos" after voting.

## Dashboard
- [ ] Filter bar (7 days / 30 days / This year, Category, Status, Ward, Show resolved) changes the KPIs, map, charts and ward table. KPIs filled, DEMO banner visible.
- [ ] Map shows markers (and the base map if `tiles/pilot.pmtiles` exists); heatmap toggle works; 3D shows columns.
- [ ] Hotspots list has entries; "Show" moves the map; Emerging issues lists a waterlogging alert in Chashara.
- [ ] Time-lapse plays and stops.

## Price Patrol (01700000002)
- [ ] Market prices show verified prices, sparklines and 7-day changes (▲ red / ▼ green); price alerts box lists the onion rise.
- [ ] A product opens history (verified vs raw median), market comparison and the last-7-days reports with "Unusual price" flags.
- [ ] Report a price at a DEMO market; it appears in Profile → Prices with "Counts toward verified price: Yes/No".
- [ ] Watch a product; Alerts shows price alerts for watched products.

## Admin (after `create-admin`)
- [ ] Login asks for a code every time.
- [ ] Dark sidebar with badges (Collusion alerts, Report review). Report review: list on the left, detail on the right with the Displayed / Judging component tables and the scoring history.
- [ ] Hide without a reason is impossible; hide with a reason works and appears in the Audit log; restore works.
- [ ] Alerts: open the pair-agreement alert, mark it solved with a note.
- [ ] Accounts: suspend a DEMO user → that user can no longer log in; reinstate.

## DEMO separation
- [ ] `docker compose exec api python -m app.cli reset-demo --yes` removes all DEMO data; your own new test account and its
      reports remain. `seed-demo` loads it again.

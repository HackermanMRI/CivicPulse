# CivicPulse feature checklist

Statuses: NOT_STARTED · IN_PROGRESS · IMPLEMENTED · TESTED · BLOCKED.
TESTED = verified end to end in the build environment (browser → API → PostgreSQL/PostGIS → back) and/or by the automated
API tests, but **not yet on your Windows laptop with Docker** (the build environment cannot run Docker).
Last updated: Sun 11 Oct 2026, 4:00 PM (Asia/Dhaka), after batch 4.

## Findings that need a decision
| ID | Finding | Evidence | Options |
|---|---|---|---|
| F-1 | DECIDED 11 Oct 2026: weighted votes count directly as evidence (`evidence.community_mode: direct`). | E5 simulation | done |
| F-2 | Collusion signals (b) and (c) are percentiles; with few pairs, ties can make many pairs "top 5 %". | code review; one DEMO run flagged 2 pairs although only 1 ring was planted | keep (alerts only, no penalty) and note in the thesis |
| F-3 | A fake report with normal-looking content rarely reaches Not Supported (needs c < 0.30). The DEMO "low credibility" example needed 1 km GPS accuracy, unrelated text and photo, a slow capture and 6 on-the-spot disagreements. | E5; DEMO scenario S2 | (a) keep and report; (b) reporter Δβ when Uncertain because of conflict. Not changed. |
| F-4 | NEW. The spec says a reused photo hides "the report". For an on-the-spot **verification** photo that would let anyone hide someone else's report by uploading a copy of its photo as a "verification". Implemented instead: the vote drops to what GPS proves, the photo is not shown, an audit entry is written. | `routers/votes.py` | confirm this reading, or choose another rule |
| F-5 | NEW. Two pumped prices in a 4-report cell can set the verified price (median of 3 eligible = a pumped value) and, below 8 reports, the 25 % rule (F26) does not flag them because the median itself moves. Seen once in an early DEMO run with random pumping. | `verified_prices` query in the build log | expected behaviour of F23/F26 (E4 "price pumping"); report it, or require ≥ 4 eligible reports |
| F-6 | NEW. The dashboard has no status filter: a status filter on markers would reveal statuses of reports the viewer has not voted on (X1). Counts per status stay aggregate. | `routers/insights.py` | keep (recommended) |

## Library changes from the UI decisions (same behaviour, fewer dependencies)
| Decision | Built with | Why |
|---|---|---|
| B11 Radix primitives | native `<dialog>`, `<select>`, `<details>`, own tabs/toasts | no extra JS on the feed route; accessible by default |
| B5 Motion for React | CSS animations + View Transitions API, all disabled under reduced motion | 0 KB; the 4 signature moments still exist (pulse, vote bars, live ripple, time-lapse) |
| Router | 60-line history router | no dependency |
| Charts | hand-written SVG | no chart library |
| Card→pop-up shared photo transition | not built | View Transitions on the dialog is a stretch goal |

## 0. Housekeeping
| ID | Feature | Status |
|---|---|---|
| H-1 | Update the spec with the UI-phase rule changes and F-1/F-4 | NOT_STARTED |
| H-2 | This checklist in the repo | IMPLEMENTED |

## 1. Infrastructure
| ID | Feature | Where | Status |
|---|---|---|---|
| INF-1 | Compose: nginx, api, worker, scheduler, db, redis (+ `tools` profile, GPU override) | `docker-compose*.yml` | IMPLEMENTED (written, not run: no Docker here) |
| INF-2 | nginx: mkcert HTTPS, `/api` proxy, SSE unbuffered, 10 MB body, rate limit, CSP and headers, no query strings in logs | `docker/nginx/nginx.conf` | IMPLEMENTED (not run) |
| INF-3 | One config file, safe_load, strict validation, hash stored per run | `config/civicpulse.yaml` | TESTED |
| INF-4 | Alembic 0001 as frozen SQL (no longer depends on the models); downgrade; `alembic check` = no drift | `backend/alembic/` | TESTED (upgrade, downgrade, re-upgrade on PostGIS 3.4) |
| INF-5 | `.env.example` with every variable explained; no secrets in code | repo root | IMPLEMENTED |
| INF-6 | `DEVICE=cuda|cpu`, CPU wheels by default, GPU build arg | `Dockerfile.worker` | IMPLEMENTED (not run) |
| INF-7 | Health endpoint | `routers/health.py` | TESTED |
| INF-8 | Non-root containers, pinned Python/npm versions | Dockerfiles, `package.json` | IMPLEMENTED; `pip-audit` / `npm audit` NOT_STARTED (needs your laptop) |
| INF-9 | Self-hosted Anek Bangla (Latin + Bengali subsets, OFL); PMTiles base map | `frontend/public/fonts`, `tiles/` | TESTED (fonts); base map BLOCKED on you making the extract (docs/MAPS.md) |
| INF-10 | CLI: seed-config, create-admin, seed-demo, reset-demo, export-for-labelling, import-labels, import-final-labels, label-agreement, export-eval, import-reference | `app/cli.py` | TESTED (except create-admin's password prompt) |
| INF-11 | Worker jobs (JSON serializer only) + scheduler loop; lost jobs re-queued every 5 min | `app/worker/` | TESTED inline (`JOBS_INLINE`); RQ worker path IMPLEMENTED (not run) |

## 2. Database
| ID | Tables | Status |
|---|---|---|
| DB-1 … DB-9 | all 34 spec tables, indexes, `is_seed` / `is_demo` markers, audit trigger + limited app role | TESTED |

## 3. Accounts and security
| ID | Feature | Status |
|---|---|---|
| AUTH-1 | Sign-up with mock OTP (hashed, 5 min, 5 tries, rate-limited, shown only in DEV_MODE) | TESTED |
| AUTH-2 | argon2id | TESTED |
| AUTH-3 | One login error message; failed logins audited | TESTED |
| AUTH-4 | JWT 15 min; rotating refresh, reuse revokes family; HttpOnly SameSite=Strict cookie; 30 days | TESTED |
| AUTH-5 | Logout | TESTED |
| AUTH-6 | Forgot password | IMPLEMENTED (UI written; API path shares tested OTP code) |
| AUTH-7 | One account per device; `device_violation` alert | TESTED |
| AUTH-8 | Three consents required, stored with version | TESTED |
| AUTH-9 | Unlimited wards or "outside pilot area" | TESTED |
| AUTH-10 | Account deletion anonymises | IMPLEMENTED |
| AUTH-11 | Admin checks, admin OTP every login, admins can't report/vote, suspension | TESTED |
| AUTH-12 | Object-level checks (notifications, addresses, photos, hidden reports) | TESTED |
| SEC-1 | Strict bodies, bound SQL, React escaping, map popups use textContent | TESTED |
| SEC-2 | Rate limits: OTP, login, votes 10/min, capture tokens 10/min, abuse 5/h, nginx per IP | TESTED (API); nginx not run |
| SEC-3 | Audit in the same transaction, append-only | TESTED |
| SEC-4 | Security tests: 16 of 17 automated (all except "failing audit write rolls back the action") | TESTED |

## 4. Photo capture
| ID | Feature | Status |
|---|---|---|
| CAP-1 | Single-use 10-min tokens tied to user/purpose/report | TESTED |
| CAP-2 | Fixed capture time, renewal keeps it, retake limit 5 | IMPLEMENTED (renewal path not covered by a test) |
| CAP-3 | Magic bytes, 8 MB, pixel limit, Pillow re-encode, random names | TESTED |
| CAP-4 | Authorised photo route (comments only after voting, receipts only for the reporter) | TESTED |
| CAP-5 | SHA-256 + pHash reuse check → suspicious + hidden | TESTED |
| CAP-6 | Camera only (getUserMedia + canvas) | TESTED (Playwright fake camera) |

## 5. Reports
| ID | Feature | Status |
|---|---|---|
| REP-1 | Civic report form (4 steps), GPS required, 2,000 characters | TESTED |
| REP-2 | 1 civic report per day | TESTED |
| REP-3 | Ward lookup: polygon, else fallback radius for wards without polygon | TESTED |
| REP-4 | Same event 50 m / 72 h: duplicate vs corroboration | TESTED (DEMO scenarios) |
| REP-5 | Price report (≤ 7 days back, no future, optional GPS/photo/receipt, 1 per cell per day) | TESTED |
| REP-6 | `process_report` writes 1 run + 7 rows per view | TESTED |

## 6. Scoring engine
| ID | Feature | Status |
|---|---|---|
| SC-1 … SC-13 | F0–F22, statuses, gate, displayed vs judging, leave-one-out | TESTED (unit tests + DB pipeline) |
| SC-3/SC-4 | Real text and CLIP scores | IMPLEMENTED; BLOCKED until you run `fetch_models` (until then "unavailable", never faked) |
| SC-14 | Flags; hourly auto-hide job | TESTED (job runs; rule rarely fires, known limitation) |
| SC-15 | Explanations and model version per component | TESTED |

## 7. Reputation
| ID | Feature | Status |
|---|---|---|
| RP-1 … RP-4 | Increments, one current result (superseded on upgrade), decay at read, k = 3 on-spot rewards | TESTED (DEMO S1 produces voter rewards) |

## 8. Voting and feed
| ID | Feature | Status |
|---|---|---|
| VOTE-1 | Blind voting enforced by the API | TESTED |
| VOTE-2 | Server-checked vote types (moved down to what GPS/photo prove) | TESTED |
| VOTE-3 | Confirm / Disagree / Fixed now (on the spot only) | TESTED |
| VOTE-4 | On-the-spot photo comments | TESTED |
| VOTE-5 | One active vote, upgrade only, burst limit | TESTED |
| VOTE-6 | Resolved after 3 Fixed-now votes | TESTED (DEMO S4) |
| VOTE-7 | `rescore_report` job | TESTED |
| FEED-1 | Ward feed, keyset pagination, category and voted / to-verify filters | TESTED |
| FEED-2 | Pin / unpin, pinned list | TESTED |
| FEED-3 | Before/after-vote cards, pop-up, verification photos | TESTED |
| FEED-4 | Report abuse → admin queue | TESTED |

## 9. Notifications
| ID | Feature | Status |
|---|---|---|
| NOT-1 | New report in your ward | TESTED |
| NOT-2 | Status changes on own and pinned reports | TESTED |
| NOT-3 | Emerging-issue alerts for your wards | TESTED |
| NOT-4 | SSE over fetch (closes at token expiry), tabs, unread counts, mark all read; polling fallback | IMPLEMENTED (tabs/unread TESTED; live push not checked with two browsers yet) |

## 10. Price Patrol
| ID | Feature | Status |
|---|---|---|
| PP-1 / PP-2 | Verified price F23, outliers F24–F26 | TESTED |
| PP-3 | Dashboard cards: verified price, 7-day % change with dates, sparkline, today's eligible count | TESTED |
| PP-4 | Market comparison, 30-day history (verified vs raw median) | TESTED |
| PP-5 | ±10 % alerts for watched products (notifications + alerts box) | TESTED |
| PP-6 | "Counts toward verified price" | TESTED |
| PP-7 | TCB/DAM reference band (import command + chart band) | IMPLEMENTED; data BLOCKED on you |
| PP-8 | Raw reports older than 7 days hidden | TESTED |
| PP-9 | Explore Prices | IMPLEMENTED |

## 11. Analytics and dashboard
| ID | Feature | Status |
|---|---|---|
| AN-1 | Hotspots daily job | TESTED (6 DEMO hotspots) |
| AN-2 | Emerging alerts daily job | TESTED (DEMO alert) |
| AN-3 | Collusion scan | TESTED (DEMO ring flagged) |
| DASH-1 | Filters: 7/30/90 days and category | IMPLEMENTED; ward filter API-only; "this year", "show resolved", "near me", status filter (see F-6) NOT_STARTED |
| DASH-2 | KPI strip | TESTED |
| DASH-3 | MapLibre markers, clusters, heatmap, hotspot outlines, button controls | TESTED; severity-weighted heatmap NOT_STARTED |
| DASH-4 | Grid endpoint (250 m cells in EPSG:3857) | TESTED |
| DASH-5 | 3D columns with tilt; WebGL2 fallback message | TESTED |
| DASH-6 | Time-lapse; live ripple | IMPLEMENTED (time-lapse TESTED) |
| DASH-7 | Hotspots, emerging issues, per category, per day | TESTED; ward comparison NOT_STARTED |

## 12. Admin portal
| ID | Feature | Status |
|---|---|---|
| ADM-1 | Alerts queue, solve with outcome + note | TESTED |
| ADM-2 | Report review: both component views, runs, votes, abuse; hide/restore with reason | TESTED |
| ADM-3 | Account page, suspend/reinstate with reason | TESTED |
| ADM-4 | Audit log with filters | TESTED |

## 13. Models, data and evaluation
| ID | Feature | Status |
|---|---|---|
| ML-1 | Local safetensors loading, `models_ready()` | IMPLEMENTED; run BLOCKED on you (`fetch_models`) |
| ML-2 | Prototypes and CLIP prompts | BLOCKED on Member B's review |
| ML-3 | E7 script | IMPLEMENTED; BLOCKED on the 50 samples |
| ML-4 | Profile B fit (+ `evaluate.py fit-profile-b`) | IMPLEMENTED; BLOCKED on labels |
| ML-5 | Metrics; `evaluate.py report / ablation / tune-tau` | IMPLEMENTED (report/ablation not yet run on labelled data) |
| ML-5a | E4, E5, E10 synthetic | TESTED |
| ML-5b | E1–E3, E6–E9, E11, E12 | BLOCKED on pilot data and labels |
| ML-6 | Labelling export/import, κ, final labels, eval export with split | TESTED |
| DATA-1 | Real ward polygons, markets, commodities | BLOCKED on Member B's field data (no import command yet) |
| DEMO-1 | DEMO seed, idempotent, reset keeps real data, strict separation | TESTED |

## 14. Frontend
| ID | Feature | Status |
|---|---|---|
| FE-1 | Vite + React 19 + Tailwind v4 tokens, Anek Bangla | TESTED (built here with esbuild + Tailwind CLI; `vite build` not run here) |
| FE-2 | Login, sign-up (4 steps), forgot password, module picker/switch | TESTED (forgot-password UI IMPLEMENTED) |
| FE-3 | Feed, pop-up, vote flow with camera, pinned, report form, alerts, profile | TESTED |
| FE-4 | Dashboard 2D/3D, lazy MapLibre | TESTED |
| FE-5 | Price Patrol screens | TESTED |
| FE-6 | Admin portal (lazy) | TESTED |
| FE-7 | Motion (see library changes) | IMPLEMENTED |
| FE-8 | Loading, empty, error, offline states | IMPLEMENTED |
| FE-9 | ×100 scores, English UI + Bangla names, 12-hour times | TESTED |
| FE-10 | WCAG 2.2 AA audit, Lighthouse + web-vitals | NOT_STARTED (feed route JS = 70 KB gz, budget 180 KB) |

## 15. Tests
| ID | Feature | Status |
|---|---|---|
| T-1 | Formula unit tests | TESTED (54) |
| T-2 | API + security tests on PostGIS | TESTED (32) |
| T-3 | Browser walk-through (Playwright: citizen + admin) | TESTED here (script not in repo) |
| T-4 | Phone end-to-end on the real network | NOT_STARTED (your laptop + phones) |
| T-5 | Final audit (`pip-audit`, `npm audit`) | NOT_STARTED |

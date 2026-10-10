# CivicPulse feature checklist

Statuses: NOT_STARTED · IN_PROGRESS · IMPLEMENTED · TESTED · BLOCKED. TESTED means it works end to end (UI → API → DB → back), not just unit tests.
Sources: final spec, UI decisions, repo audit of 43e50b0. Last updated: Sun 11 Oct 2026, 6:45 AM (Asia/Dhaka), after batch 2.

## Findings that need a decision
| ID | Finding | Evidence | Options |
|---|---|---|---|
| F-1 | With profile A, votes can move a report by **at most one evidence unit** (F16 squeezes every vote into one community score with weight 1), while plausible text, photo, GPS and timing add about 3.7 units. A fake report that *looks* normal therefore stays Supported even when on-the-spot voters disagree, and it can almost never reach Not Supported (needs c < 0.30). Reporters who post such fakes never lose reputation. | E5 simulation: exploiters keep reputation ≈ 0.93 after turning fake; 96% of their fakes are still shown as Supported. Raising the community weight to 5 only lowers that to 77%. | (a) Keep the rule and report it as a limitation. (b) Count weighted votes directly as evidence (α += A, β += D), the textbook Beta-reputation form. (c) Let profile B decide (results chapter only). Not changed: this is an approved rule. |
| F-2 | Collusion signals (b) and (c) are percentiles. With few voter pairs, ties make many pairs count as "top 5%", so the admin queue may get false alarms in the pilot. | Code review | Keep as approved (alerts only, no penalty) and note it in the thesis |

## 0. Housekeeping
| ID | Feature | Status |
|---|---|---|
| H-1 | Update the spec with the UI-phase rule changes | NOT_STARTED |
| H-2 | Keep this checklist in the repo (`docs/FEATURE_CHECKLIST.md`) | IMPLEMENTED |

## 1. Infrastructure
| ID | Feature | Where | Status |
|---|---|---|---|
| INF-1 | Docker Compose: nginx, api, worker, scheduler, db (PostGIS), redis | `docker-compose.yml` | NOT_STARTED |
| INF-2 | nginx: mkcert HTTPS, `/api` proxy, SSE without buffering, upload limit, rate limit, CSP and headers | `nginx/` | NOT_STARTED |
| INF-3 | One config file, `yaml.safe_load`, strict validation, config hash | `config/civicpulse.yaml`, `app/scoring/params.py` | IN_PROGRESS: loader and validation unit-tested; storing the hash with runs needs the DB |
| INF-4 | Alembic migration from the Day 1 schema | `backend/alembic/` | NOT_STARTED |
| INF-5 | `.env` + `.env.example`, no secrets in code | repo root | NOT_STARTED |
| INF-6 | `DEVICE=cuda|cpu` with CPU fallback | `app/ml/inference.py` | IMPLEMENTED (not run: needs laptop) |
| INF-7 | Health endpoint with PostGIS version | `routers/health.py` | IMPLEMENTED (Day 1, not re-verified) |
| INF-8 | Non-root containers, pinned versions, audits | Dockerfiles | NOT_STARTED |
| INF-9 | Self-hosted PMTiles and Anek Bangla fonts | `nginx/static/` | NOT_STARTED |
| INF-10 | CLI: create-admin, import-labels, export-for-labelling, load-demo-seed | `app/cli.py` | NOT_STARTED |
| INF-11 | Scheduler for daily and hourly jobs | `worker/` | NOT_STARTED |

## 2. Database
| ID | Tables | Status |
|---|---|---|
| DB-1 | users, user_addresses, devices, otp_codes, refresh_tokens, consents | NOT_STARTED |
| DB-2 | wards, markets, categories, commodities | NOT_STARTED |
| DB-3 | capture_tokens (fixed capture time), events, reports, price_details, evidence | NOT_STARTED |
| DB-4 | scoring_runs, trust_scores (row per component and view) | NOT_STARTED |
| DB-5 | votes, saved_posts, reputation_events | NOT_STARTED |
| DB-6 | verified_prices, reference_prices, hotspots, alerts, live_days, notifications, price_alert_watch | NOT_STARTED |
| DB-7 | voter_pairs, collusion_alerts, audit_log (+ trigger), abuse_reports | NOT_STARTED |
| DB-8 | label_import_batches, labels, label_final | NOT_STARTED |
| DB-9 | Spec indexes | NOT_STARTED |

## 3. Accounts and security
| ID | Feature | Status |
|---|---|---|
| AUTH-1 | Sign-up with mock OTP (6 digits, hashed, 5 min, 5 tries, rate-limited, shown only in DEV_MODE) | NOT_STARTED |
| AUTH-2 | argon2id passwords | NOT_STARTED |
| AUTH-3 | Login with one error message for both failure cases; failed logins audited | NOT_STARTED |
| AUTH-4 | JWT 15 min; refresh rotation with family revoke; HttpOnly cookie; stay logged in 30 days | NOT_STARTED |
| AUTH-5 | Logout | NOT_STARTED |
| AUTH-6 | Forgot password (OTP) | NOT_STARTED |
| AUTH-7 | One account per device and phone; `device_violation` alert | NOT_STARTED |
| AUTH-8 | Consents (all three required) with version and time | NOT_STARTED |
| AUTH-9 | Unlimited wards or "outside pilot area" | NOT_STARTED |
| AUTH-10 | Account deletion anonymises | NOT_STARTED |
| AUTH-11 | Admin role checks; admins can't report or vote; suspension | NOT_STARTED |
| AUTH-12 | Object-level checks (no IDOR) | NOT_STARTED |
| SEC-1 | Strict request bodies, parameterised SQL, no raw HTML | NOT_STARTED |
| SEC-2 | Rate limits (IP, OTP, votes 10/min, capture tokens 10/min) | NOT_STARTED |
| SEC-3 | Audit log in the same transaction | NOT_STARTED |
| SEC-4 | The 17 security tests | NOT_STARTED |

## 4. Photo capture
| ID | Feature | Status |
|---|---|---|
| CAP-1 | Single-use capture tokens (10 min) | NOT_STARTED |
| CAP-2 | Fixed capture time, silent renewal, spent only on save, retake limit 5 | NOT_STARTED |
| CAP-3 | Magic bytes, size, pixels, Pillow re-encode, random names | NOT_STARTED |
| CAP-4 | Authorised photo route | NOT_STARTED |
| CAP-5 | SHA-256 + pHash reuse check → suspicious + hidden | NOT_STARTED |
| CAP-6 | Camera required, getUserMedia only | NOT_STARTED |

## 5. Reports
| ID | Feature | Status |
|---|---|---|
| REP-1 | Civic report in 5 steps, GPS gate, 2,000 characters, no editing | NOT_STARTED |
| REP-2 | 1 civic report per day | NOT_STARTED |
| REP-3 | Ward lookup with fallback radius | NOT_STARTED |
| REP-4 | Same event (50 m, 72 h): duplicate vs corroboration | NOT_STARTED |
| REP-5 | Price report (≤ 7 days back, optional GPS and photos, 1 per cell per day) | NOT_STARTED |
| REP-6 | `process_report` job writes 1 run + 7 rows per view | NOT_STARTED |

## 6. Scoring engine
All of this is pure maths in `backend/app/scoring/`, unit-tested here (52 tests pass). It becomes TESTED once the worker and DB use it.
| ID | Feature | Status |
|---|---|---|
| SC-1 | Beta fusion F0–F4 (matches the spec's worked example to 3 decimals) | IMPLEMENTED |
| SC-2 | Chance-anchored rescale F6 | IMPLEMENTED |
| SC-3 | Text component F5–F6 | IMPLEMENTED (maths); encoder runs on laptop |
| SC-4 | Image component F7 + `category_mismatch` | IMPLEMENTED (maths); CLIP runs on laptop |
| SC-5 | GPS F8–F10 (price GPS optional) | IMPLEMENTED |
| SC-6 | Metadata F11 from the capture-to-post gap | IMPLEMENTED |
| SC-7 | Reputation component F12 | IMPLEMENTED |
| SC-8 | Community civic F13–F16 | IMPLEMENTED |
| SC-9 | Community price F17 | IMPLEMENTED |
| SC-10 | History F18–F19 | IMPLEMENTED |
| SC-11 | Conflict F20 | IMPLEMENTED |
| SC-12 | Status rules + gate (gate switch kept for baseline B4) | IMPLEMENTED |
| SC-13 | Displayed vs judging, leave-one-out | IMPLEMENTED |
| SC-14 | Flags and auto-hide rule | IMPLEMENTED (rule); hourly job NOT_STARTED |
| SC-15 | Explanations and model version per component | IN_PROGRESS: produced, not yet stored |

## 7. Reputation
| ID | Feature | Status |
|---|---|---|
| RP-1 | Event increments (P9) | IMPLEMENTED |
| RP-2 | One current result per report and vote (`superseded_at`) | NOT_STARTED (DB) |
| RP-3 | Decay at read F21–F22 (spec example reproduced) | IMPLEMENTED |
| RP-4 | k = 3 and on-spot-only voter rewards | IMPLEMENTED |

## 8. Voting and feed
| ID | Feature | Status |
|---|---|---|
| VOTE-1 | Blind voting in the API | NOT_STARTED |
| VOTE-2 | Server-checked vote types | NOT_STARTED |
| VOTE-3 | Confirm / Disagree / Fixed now | NOT_STARTED |
| VOTE-4 | On-spot photo comments | NOT_STARTED |
| VOTE-5 | One active vote, upgrade only, burst limit | NOT_STARTED |
| VOTE-6 | Resolved after 3 Fixed-now votes | NOT_STARTED |
| VOTE-7 | `rescore_report` job | NOT_STARTED |
| FEED-1 | Ward feed with keyset pagination | NOT_STARTED |
| FEED-2 | Pin / unpin, pinned list | NOT_STARTED |
| FEED-3 | Before/after-vote cards, pop-up, image verifications | NOT_STARTED |
| FEED-4 | Report abuse → admin queue | NOT_STARTED |

## 9. Notifications
| ID | Feature | Status |
|---|---|---|
| NOT-1 | New report in your ward | NOT_STARTED |
| NOT-2 | Status changes on own and pinned reports | NOT_STARTED |
| NOT-3 | Emerging-issue alerts for your wards | NOT_STARTED |
| NOT-4 | SSE (fetch stream), tabs, unread, mark all read | NOT_STARTED |

## 10. Price Patrol
| ID | Feature | Status |
|---|---|---|
| PP-1 | Verified price F23 | IMPLEMENTED (maths) |
| PP-2 | Outlier flags F24–F26 | IMPLEMENTED (maths) |
| PP-3 | Dashboard cards with 7-day % change and dates | IN_PROGRESS: change maths done |
| PP-4 | Market comparison, history chart | NOT_STARTED |
| PP-5 | ±10% rise/drop alerts for watched products | IN_PROGRESS: alert rule done |
| PP-6 | "Counts toward verified price" | IN_PROGRESS: rule done |
| PP-7 | TCB/DAM reference band | NOT_STARTED |
| PP-8 | Hide raw reports older than 7 days | NOT_STARTED |
| PP-9 | Explore Prices page | NOT_STARTED |

## 11. Analytics and dashboard
| ID | Feature | Status |
|---|---|---|
| AN-1 | Hotspots (dedupe, unweighted DBSCAN, validate, F28) | IN_PROGRESS: pipeline unit-tested; daily job pending |
| AN-2 | Emerging alerts (C-test, guard band, Bonferroni, NB switch) | IN_PROGRESS: unit-tested; daily job pending |
| AN-3 | Collusion scan (2 of 3 signals) | IN_PROGRESS: unit-tested; daily job pending |
| DASH-1 | Filters: 7 / 30 days / this year, category, status, ward, show resolved, reset | NOT_STARTED |
| DASH-2 | D1 KPI strip | NOT_STARTED |
| DASH-3 | MapLibre: markers, clusters, heatmap, hotspot outlines, weight by severity, near me, button controls | NOT_STARTED |
| DASH-4 | Grid aggregation endpoint (ST_SnapToGrid) | NOT_STARTED |
| DASH-5 | 3D view (fill-extrusion, ~50° tilt, WebGL2 fallback) | NOT_STARTED |
| DASH-6 | Time-lapse; live ripple for new credible reports | NOT_STARTED |
| DASH-7 | Top hotspots, emerging issues, by category, per day, ward comparison | NOT_STARTED |

## 12. Admin portal
| ID | Feature | Status |
|---|---|---|
| ADM-1 | Alerts queue (pair agreement, device violation): solve with outcome + note | NOT_STARTED |
| ADM-2 | Report review (flagged, hidden, abuse): 7 component scores, hide/restore with reason | NOT_STARTED |
| ADM-3 | Account page: activity, devices, suspend/reinstate with reason | NOT_STARTED |
| ADM-4 | Audit log viewer (actor, entity, date filters) | NOT_STARTED |

## 13. Models and evaluation
| ID | Feature | Status |
|---|---|---|
| ML-1 | CLIP + text encoder from local safetensors (`app/ml/inference.py`, `scripts/fetch_models.py`) | IMPLEMENTED; not run yet (needs laptop internet + GPU/CPU) |
| ML-2 | Category prototypes and CLIP prompts | IN_PROGRESS: drafts in the config, marked `review_status: draft`; BLOCKED on Member B's review |
| ML-3 | E7 encoder selection (`scripts/e7_encoder_selection.py`) | IMPLEMENTED (logic unit-tested); run BLOCKED on Member B's 50 samples |
| ML-4 | Profile B fit F30 (`app/ml/profile_b.py`) | IMPLEMENTED (tested on synthetic data); run BLOCKED on labels |
| ML-5 | Metrics (macro-F1, ECE, Brier, risk–coverage, κ, MAE/MAPE, Kendall τ, top-k) | IMPLEMENTED |
| ML-5a | E4 attacks, E5 feedback loop, E10 false alarms (`scripts/run_simulations.py`) | TESTED (run on synthetic data; results in `eval_results/`) |
| ML-5b | E1–E3, E6–E9, E11, E12 runs | BLOCKED on pilot data and labels |
| ML-6 | Labelling export/import | NOT_STARTED |
| DATA-1 | Ward polygons, market list, commodity list | BLOCKED on Member B's field data |

## 14. Frontend
| ID | Feature | Status |
|---|---|---|
| FE-1 | Vite + React + Tailwind v4, design tokens, self-hosted Anek Bangla (Day 1 app was never pushed) | NOT_STARTED |
| FE-2 | Login (30 days), sign-up (5 steps), forgot password, module picker and switch | NOT_STARTED |
| FE-3 | Green Guard: feed, pop-up, vote flow with camera, pinned list, report form, alerts, profile | NOT_STARTED |
| FE-4 | Dashboard 2D/3D (MapLibre, lazy-loaded) | NOT_STARTED |
| FE-5 | Price Patrol: dashboard, explore, report a price, alerts, profile | NOT_STARTED |
| FE-6 | Admin portal (lazy route) | NOT_STARTED |
| FE-7 | Motion (LazyMotion, View Transitions, 4 signature moments, reduced motion) | NOT_STARTED |
| FE-8 | Loading, empty, error, offline states | NOT_STARTED |
| FE-9 | Scores ×100, English UI + Bangla names, 12-hour times | NOT_STARTED |
| FE-10 | WCAG 2.2 AA checks; Lighthouse + web-vitals budget | NOT_STARTED |

## 15. Tests
| ID | Feature | Status |
|---|---|---|
| T-1 | Formula unit tests | IN_PROGRESS: 52 pass |
| T-2 … T-5 | API, security, phone E2E, final audit | NOT_STARTED |

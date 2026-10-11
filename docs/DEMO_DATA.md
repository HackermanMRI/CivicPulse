# DEMO seed data (spec D12, N13)

The pilot is too small to show some features (voter rewards need 4+ on-the-spot voters, hotspots need 3 reports from 2
people, alerts need 7 live days). The DEMO dataset fills the system so every screen shows meaningful data at the
pre-defence. **It is synthetic and is never used for training, validation, testing or any reported metric.**

## Load, reload, remove

| Task | Command (PowerShell, project folder) |
|---|---|
| Load (does nothing if already loaded) | `docker compose exec api python -m app.cli seed-demo` |
| Remove everything DEMO, keep real data | `docker compose exec api python -m app.cli reset-demo --yes` |
| Remove and load fresh (dates move to "now") | `docker compose exec api python -m app.cli seed-demo --reset` |

`DEMO_PASSWORD` must be set in `.env`. Loading takes about 1–3 minutes and runs in one transaction: if it fails,
nothing is kept and the photos it wrote are deleted. Dates are relative to the moment you load it, so reload
it on the morning of the defence.

## How it is built

The seed does not write finished scores. It feeds reports, votes and price reports **through the real pipeline in
time order** (the same code as live reports), so every status, flag, reputation event, event group, verified
price, hotspot and alert is what CivicPulse itself computes. Only two inputs are synthetic:

| Synthetic input | How it is labelled |
|---|---|
| Text and image model probabilities | stored with `model_version = "DEMO-synthetic"` and the explanation "DEMO synthetic score" |
| Photos | generated abstract drawings stamped "DEMO · SYNTHETIC IMAGE – not a real photo" (no real or licensed photos are used) |

## What is inside

| Area | Content |
|---|---|
| Geography | 5 DEMO wards (4 synthetic square boundaries around Bashundhara and Narayanganj, 1 with no polygon to show the 300 m fallback), 3 DEMO markets. Boundaries are **not** official ward maps (C13). |
| Products | 9 commodity/variant/unit rows (rice coarse/medium/fine, onion local/imported, potato, eggs per dozen, soybean oil per litre, lentil). Existing real rows with the same name/variant/unit are reused, not duplicated. |
| People | 3 DEMO login accounts, 15 civic reporters, 10 price volunteers, 1 brand-new account. All named "(DEMO)" or "Demo Citizen". Non-login accounts have no phone and no password. |
| Civic reports | about 78 over 35 days in all 7 categories: corroborated pairs, single reports, weak (near-chance) reports, unverified reports, a resolved event (3 × "Fixed now"), a duplicate, a reused photo (auto-hidden), an admin-hidden report, two conflict cases ("Needs more verification"), one low-credibility report with an image-mismatch flag, a waterlogging build-up in Chashara (emerging-issue alert) and three hotspot clusters. |
| Votes | about 135: on the spot (with verification photos), nearby and far away; a two-account vote ring for the collusion check. |
| Prices | about 1,050 reports in about 330 product × market × day cells over 28 days, with GPS near / far / missing, product photos, a few receipts, controlled outliers ("Unusual price"), "Insufficient Evidence" days, an onion price rise and an egg price drop (price alerts). |
| Analytics | live days, emerging-issue alerts for the last 7 days, hotspots, the collusion scan, a device-violation alert, an abuse report. |
| For the DEMO accounts | addresses, saved (pinned) posts, price watch list, notifications, own reports and votes. |

## DEMO logins

| Phone | Areas | Good for showing |
|---|---|---|
| 01700000001 | Chashara (home), Bashundhara west (work) | feed, blind voting, alerts, profile with reputation |
| 01700000002 | Tanbazar (home), Chashara | Price Patrol, price alerts |
| 01700000003 | Bashundhara east (home), Bashundhara west | a second phone for live notifications |

Password: the `DEMO_PASSWORD` from `.env`.

## How DEMO data is kept apart from real research data

| Rule | Where it is enforced |
|---|---|
| Every DEMO report and user has `is_seed = true`; DEMO wards, markets and commodities have `is_demo = true` | database columns; the UI shows a red **DEMO** badge and the dashboard shows a banner |
| Anything a DEMO account posts is DEMO data | `POST /api/reports/*` copies `is_seed` from the account |
| DEMO accounts can vote only on DEMO reports | `POST /api/reports/{id}/votes` (403) |
| DEMO and real price reports never share a price cell | DEMO markets accept DEMO accounts only, real markets real accounts only |
| DEMO reports use DEMO wards, real reports real wards; events, corroboration and history never mix the two | `app/services/pipeline.py` |
| Labelling, label import and evaluation export refuse DEMO data | `app/research.py` (`is_seed` filter; `DEMO-synthetic` model scores are rejected) |
| Removal keeps real records | `reset-demo` deletes only DEMO-linked rows. A real user who voted on DEMO reports keeps the account; a real address in a DEMO ward becomes "outside the pilot area". DEMO accounts named in the append-only audit log are anonymised, not deleted. |

A real (non-DEMO) report is never placed in a DEMO ward, so until the real pilot wards are added it shows as "outside
the pilot area". Real users *can* see DEMO reports in the feed if they pick a DEMO ward, and can vote on them; those votes and any
reputation they earned from DEMO reports are removed by `reset-demo`.

## Known limits of the demo

- The auto-hide rule (u ≥ 0.80 after 7 days) has no example: with GPS and timing evidence it almost never fires, which
  the spec already lists as a known limitation.
- Hotspot score bands (low/medium/high) are provisional (open parameter B4).

# CivicPulse handoff report

Written: Wed 4 Nov 2026, 3:00 AM (Asia/Dhaka). Owner: Mrinmoy Dewan ("Hackerman"), Member A. Repo: github.com/HackermanMRI/civicpulse, branch `feat/scoring-engine` (last commit seen: `04c6962` "Keep Alerts and Profile inside the module you opened them from").

Use this file to start a new session: paste the "Starter prompt" at the bottom, or tell the new session to read this doc first.

How to read it. "Confirmed" = the user showed output or a screenshot. "Suggested" = I gave steps and the user did not report the result. "From earlier summary" = facts carried from an earlier part of this long session that I could not re-check.

---

## 1. Project in one paragraph

CivicPulse is a final-year project (CSE, Jagannath University). Two modules share one `reports` table: **Green Guard** (civic reports with photo, GPS, votes, hotspots) and **Price Patrol** (market prices, median "verified price", outlier flags). Core idea: each report gets a **credibility** and an **uncertainty** from one Beta(α, β) model, seven evidence components (text, image, GPS, metadata, reputation, community, history), four statuses (Strongly Supported / Supported / Uncertain / Not Supported) and separate flags. The system never says "true" or "false".

Stack: FastAPI + SQLAlchemy/GeoAlchemy2 + PostgreSQL 16/PostGIS, Redis + RQ worker and scheduler, React 19 + Vite 7 + Tailwind v4, MapLibre GL JS 5.24.0 + PMTiles, nginx (HTTPS with mkcert), everything in Docker Compose (6 services). Pilot area: Narayanganj and Bashundhara. Team: Member A (code) and Member B (research, field data, labels, documents).

Full rules and formulas: `claude/CivicPulse_Final_System_Specification.md`. Feature status: `claude/CivicPulse_Feature_Checklist.md` (last updated 11 Oct 2026) and `docs/FEATURE_CHECKLIST.md` in the repo.

## 2. How the user wants help (standing rules)

- Beginner. Easy words. Don't overexplain. Be his teacher.
- He types code by hand: guide line by line, with a short explanation after every code block.
- A table for every comparison. Search many sources for answers.
- Times in 12-hour format. Ask before big direction changes.
- For presentations, prepare questions and answers together.
- Be honest. Say what is unverified. Don't call things "novel" without evidence.

## 3. What is built (state at the last repo check)

From the repo checklist (written 11 Oct, before laptop runs):
- Backend: auth (mock OTP, argon2id, JWT with rotating refresh), device rule, consents, capture tokens, photo checks (magic bytes, re-encode, SHA-256 + pHash), reports, voting (blind voting enforced by API), reputation (Beta, decay), scoring pipeline (F0 to F22), hotspots, emerging alerts, collusion scan, Price Patrol (F23 to F26), admin portal API, audit log.
- Tests: 54 unit tests + 39 API/security tests = 93 passed (shown on slide 19).
- Frontend: Green Guard feed, vote flow with camera, report form, alerts, profile, dashboard 2D/3D (markers, clusters, heatmap, hotspots, 3D columns, time-lapse), Price Patrol screens, lazy admin portal.
- Infra: Docker stack with nginx CSP (`connect-src 'self'`), demo seed data (`seed-demo`), research CLI tools.
- Not done per checklist: Lighthouse/WCAG audit, phone end-to-end test on real network, `pip-audit`/`npm audit` (npm audit now run, see section 5), real ward polygons and markets (Member B), TCB/DAM reference prices.

## 4. Work done in this long session

### 4.1 Evaluation and model choices (from earlier summary)
- **E7 text encoder (closed).** Winner: `kazalbrur/bangla-embed-e5-small-banglish` (input prefix `query: `). D5 first test (50 sentences): kazalbrur 37, LaBSE 28, e5-base 21, MiniLM 21. D5b fresh test: 35 / 34 / 28 / 23, a **tie** with LaBSE. Honest wording: "best of the four we tried".
- **E8-lite CLIP check.** Zero-shot `openai/clip-vit-base-patch32`, 7 category prompts + 1 "ordinary scene" prompt: 19/28 correct (68%, Wilson 95% about 49 to 82%). Per category: damaged road 4/4, deforestation 4/4, drainage 4/4, water pollution 3/4, waterlogging 2/4, streetlight 2/4, garbage 0/4 (all called drainage). Preliminary: labels chosen by the photographer, one draft prompt each, run once. Open: 28 rows scored vs 30 counted; check streetlight photos for daytime.
- Repo config note: `config/civicpulse.yaml` text_encoder was still `intfloat/multilingual-e5-base` when I last read it. The user said he would commit the change to the selected encoder himself (also `requirements-ml.txt`). Confirm it is committed.

### 4.2 Thesis and documents (from earlier summary)
- Thesis rewritten to the professor's template (LaTeX, about 140 pages) with yellow placeholder boxes for facts only the user knows. Delivered as an Overleaf package. Added: encoder selection section, E8-lite section, list of publications appendix, new reference for the chosen encoder.
- `CivicPulse_Fill_These.md`: 43 fields (IDs, supervisor, pilot wards and dates, hashes, laptop specs, ethics, review steps). The user said he fills blanks himself in Overleaf.
- Reference check: 35 of 39 DOIs confirmed; 4 unverified; 31 have no DOI.
- Files lived in the earlier session's scratch folder. If they are gone, ask the user for the Overleaf project and rebuild from there.

### 4.3 Frontend nav bar (suggested, result not reported)
- Root cause: `DesktopBar` in `frontend/src/components/Shell.jsx` (line 57) had no `sticky`/`fixed`, so it scrolled away. Phone top bar (`sticky top-0 z-30`) and bottom bar (`fixed`) were fine.
- Fix suggested: wrap in `<div className="sticky top-0 z-30 hidden bg-bg/95 backdrop-blur md:block">` with an inner `max-w-[1360px]` div, plus one more closing `</div>`. Ask the user if it works.

### 4.4 Running the project on the laptop (suggested)
- Copied the whole folder from the desktop. Still needed: install Docker Desktop (WSL2), Git, mkcert; new mkcert certificate for the laptop IP (`docker\certs\cert.pem` and `key.pem`); edit `.env` `FRONTEND_ORIGIN` to include the laptop IP; check `DEVICE`/`TORCH_INDEX` (CPU if no NVIDIA GPU); `docker compose up -d --build`; `seed-demo`; `create-admin`. Database data does not move with the folder (Docker volume).
- Possible trap: `docker/db/01_app_role.sh` with Windows line endings (CRLF) can break the db container.

### 4.5 Presentation (slides 18 to 20 rewritten in easy words)
- Slide 18 Research Contributions, slide 19 Model and test results, slide 20 Limitations and Future Work. Claims unchanged, words simplified, "paired" removed from slide 20 (5 limits vs 4 steps).
- **Open problem on slide 19:** chart bars show LaBSE 36, E5 26, Kazalbrur 43, but the caption says LaBSE 28/50 and each alternative 21/50, and my records of D5 are 37 / 28 / 21 / 21. Chart and caption must be made to agree. Also fix typos "LbSE" and "wasn'ttested", and say which test (D5 or D5b).
- Slide 20: "develop dynamic trust-decay" may draw a question, because reputation already decays with a 90-day half-life (F21). The user must say what is new.
- Still to do: examiner questions and answers for the deck (user asked for this style earlier); an 8-slide methodology deck vs a full 15-slide pre-defence deck was asked and not answered.

### 4.6 Map visualization (this session; the user typed the edits)
Library: MapLibre GL JS 5.24.0 draws the map; PMTiles stores the base map (a cut of OpenStreetMap data made by Protomaps); both already in `frontend/package.json`. The older spec says Leaflet, but the code uses MapLibre (trust the code).

Confirmed working:
1. `npm install` OK. `npm audit --omit=dev` reports **1 critical: maplibre-gl <= 6.4.0, GHSA-jrc7-96c5-q579** (XSS in `DOM.sanitize()` used by the attribution control). **Not reachable in this app:** `attributionControl: false`, attribution is a fixed string, no `setHTML`/`Popup`/`innerHTML` on map data. Decision: keep 5.24.0 until after the presentation; later test `npm install maplibre-gl@6.4.1 --save-exact` on a branch (v6 is a major upgrade, release notes not read). Never run `npm audit fix --force`. The esbuild "allow-scripts" warning: try `npm run dev` first; `npm approve-scripts esbuild` if needed.
2. Dev map showed no base map because Vite had no `/tiles` route: the fallback returned `index.html` with status 200, so `tilesAvailable()` said yes. Fixes the user applied: `frontend/vite.config.js` proxy `"/tiles": { target: "https://localhost", secure: false }` (needs Docker nginx running) and in `MapView.jsx` `return r.ok && !(r.headers.get("content-type") || "").includes("text/html");`.
3. `tiles/pilot.pmtiles` was missing (only `README.txt`). The user made it with `pmtiles extract ... --bbox=90.38,23.58,90.56,23.86 --maxzoom=15` (see `docs/MAPS.md`). Roads and water now show; Network shows 206 range requests.
4. Place names: copied `Noto Sans Regular` and `Noto Sans Medium` from protomaps/basemaps-assets into `frontend/public/map-fonts/`; added `glyphs: ${window.location.origin}/map-fonts/{fontstack}/{range}.pbf` to `baseStyle` and a `place-labels` symbol layer (English `name:en`, fallback `name`). Screenshot confirmed names such as Dhaka, Narayanganj, Block P. Fonts are self-hosted because nginx CSP is `connect-src 'self'` and the map must work offline.

Suggested, result not confirmed:
- `road-labels` layer (zoom 13+, only roads with `name:en`, `symbol-placement: line`, Noto Sans Regular).
- Updating the old comments in `MapView.jsx` (lines 2 to 3 and 83) and `docs/MAPS.md` (Limits section, new "Fonts for the labels" section).
- Smaller legend: option A in `Dashboard.jsx` line 301 (`bottom-3 left-3 max-w-[230px] p-2.5 text-[13px]`); optional shorter text; option C (collapsible legend) offered.

Explained to the user: the "© OpenStreetMap contributors" credit is required by the OpenStreetMap ODbL licence because the map data comes from OpenStreetMap; MapLibre itself needs no credit.

Known map limits: Bangla labels are untested (glyph coverage of the font files unconfirmed); many Bangladeshi roads have no `name:en`, so only some roads are labelled; production needs `docker compose up -d --build nginx` so the fonts are in the image.

## 5. Open items, in priority order

1. Slide 19 numbers (chart vs caption); typos; mention D5b tie.
2. Confirm which commits exist: encoder config change; map work (`vite.config.js`, `MapView.jsx`, `frontend/public/map-fonts`, `docs/MAPS.md`, nav bar fix). Check `git status`. Do not commit `tiles/pilot.pmtiles` (gitignored).
3. Rebuild nginx image so the map fonts and the new build work on `https://localhost`; test on phones (needs mkcert root CA on each phone).
4. Examiner Q&A for the deck; decide the deck size.
5. Overleaf blanks (Fill_These list); remaining reference checks; 28 vs 30 photos; streetlight photo check.
6. Model work: the user asked for a step-by-step model training guide (zero-shot first; fine-tuning CLIP on civic photos is an optional experiment). Nothing was started in my records. Needs: photo dataset, labels, validation split.
7. Real data: Member B's ward polygons, markets, TCB/DAM prices; pilot collection; labelling; Price Patrol field survey.
8. Checklist gaps: WCAG/Lighthouse audit, phone end-to-end test, `pip-audit`, SSE test with two devices, update the spec for the UI-phase rule changes (H-1).
9. Decisions waiting from the user: findings F-3, F-4, F-5 in the feature checklist (fake reports rarely reach Not Supported, reused verification photo rule, price pumping below 8 reports).
10. The defence date was not stated in this part of the session. Pre-defence was planned for 14 Oct 2026, with the defence 10 to 15 days later. Confirm the current schedule.

## 6. Key facts to keep

- Dev PC: Ryzen 5 5600, 16 GB RAM, GTX 1660 Super, Windows 11, Docker Desktop. The laptop's specs are not known.
- Spec decision IDs (like C1, P9, L2) are listed in the spec's Appendix A. Spec wins over code comments until the team approves a change.
- Never claim a report is true; a "verified price" means the median of at least 3 eligible reports.
- The model files folder `models/`, data folder `data/`, `exports/`, `.env`, certificates and `tiles/*.pmtiles` are gitignored and must be copied or rebuilt on each machine.

## 7. Starter prompt for a new session

"Read `claude/CivicPulse_Handoff_Report_2026-11-04.md` in the CivicPulse project. I am Mrinmoy (Member A). Follow my standing rules: easy words, guide me line by line (I type the code), a short explanation after each code block, tables for comparisons, 12-hour times. Start with open item number __ and ask me one question if anything is unclear."

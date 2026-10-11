# Datasets, models, labelling and evaluation (your part)

You manage the data and run every model step on your own laptop. Nothing in the repository is a trained model, a
model weight file or a real dataset. Read this once fully before the pilot.

## 0. What "training" means in this project

The spec (§5) uses two **pretrained** neural models **zero-shot**: no neural network is trained or fine-tuned.
The things you actually fit or choose are small and all happen on the **validation split**:

| Step | What is learned / chosen | Script | When |
|---|---|---|---|
| Model preparation | download CLIP + text encoders, convert to safetensors | `scripts/fetch_models.py` | once, needs internet |
| E7 encoder selection | which of 3 text encoders to use (top-1 on 50 samples) | `scripts/e7_encoder_selection.py` | before the pilot |
| B6 temperature τ | text softmax temperature | `scripts/evaluate.py tune-tau` | after labelling, validation split |
| B2 / Q7 thresholds | θ_c and (only if needed) status cut-offs | by hand from `evaluate.py report --split validation` | validation split only |
| F30 profile B | 7 non-negative evidence weights | `scripts/evaluate.py fit-profile-b` | results chapter only |
| B1 pHash threshold, B3 DBSCAN eps | open parameters | measured on pilot photos / reports | pilot week |

The test split is used **once**, at the end.

## 1. Folders (all gitignored)

| Folder | Holds | Mounted in |
|---|---|---|
| `models/` | model weights (`*.safetensors`), one sub-folder per model | worker (read-only), tools (read-write) |
| `data/` | your private datasets: E7 samples, field price survey, reference prices, label files | tools (read-only, as `/data/research`) |
| `exports/` | files the system writes for you: labelling packs, evaluation tables | api and tools (as `/data/exports`) |

Never put real data or weights outside these folders, and never `git add -f` them. Before every push run
`git status` and check that nothing from these folders appears.

## 2. Prepare the models (once)

```powershell
docker compose build worker
docker compose run --rm tools python -m scripts.fetch_models          # CLIP + the configured text encoder
docker compose run --rm tools python -m scripts.fetch_models --all    # plus every E7 candidate (for step 3)
```
This downloads from Hugging Face with `trust_remote_code=False`, converts CLIP's `.bin` with
`torch.load(weights_only=True)` (torch 2.6), and saves safetensors under `models/<org>__<name>/`. It prints the
weight hash of each model; the same hash appears in `trust_scores.model_version` for every score.

Then restart the worker so it loads them: `docker compose restart worker`. New reports now get real text and image
scores. Before this, those two components are stored as "unavailable" (never faked) and reports are scored on the
other five.

GPU: see RUN.md §9. Measure real memory with `nvidia-smi` while the worker scores a report.

## 3. E7: choose the text encoder (D5, P13)

1. Member B writes exactly 50 samples **before any other use of the data**: `data/e7_samples.csv` with columns
   `text,category,style` (`category` = one of the 7 codes in `config/civicpulse.yaml`, `style` = bangla / english /
   banglish). Balance categories and styles. Freeze the file (note its SHA-256 in the thesis).
2. Run:
   ```powershell
   docker compose run --rm tools python -m scripts.e7_encoder_selection /data/research/e7_samples.csv
   ```
   It reports raw counts and percentages, overall and per style, for every candidate.
3. Put the winner in `config/civicpulse.yaml` (`ml.text_encoder` and `ml.text_query_prefix`), commit the config change,
   rebuild and restart: `docker compose up -d --build api worker scheduler`. The config hash changes, which is
   recorded with every later scoring run.
4. These 50 samples are never used again (L9).

## 4. Prototypes and CLIP prompts (D6, B7)

The 7 categories in `config/civicpulse.yaml` carry **draft** text prototypes and prompts (`review_status: draft`).
Member B rewrites them (5–10 prototypes per category in Bangla, English and Banglish; 1–3 English prompts), sets
`review_status: reviewed`, then restart the stack. `seed-config` reloads categories on every API start.

## 5. Reference data for the pilot (D7–D10)

| Data | How it gets in |
|---|---|
| Pilot ward polygons | Insert real wards (`is_demo = false`) with `geom` from QGIS/geojson.io, or `ref_point` + fallback radius when no reliable polygon exists. A small import command is not written yet; insert with SQL (see the `wards` table) or ask for one. |
| Markets | Same, into `markets` (location, radius, `source = field`, `verified = true` after the visit). |
| Commodities | Into `commodities` (name, variant, unit). |
| TCB / DAM reference bands | `data/tcb.csv` with `source,commodity_id,market_id,date,min_bdt,max_bdt` (empty `market_id` = regional), then `docker compose exec api python -m app.cli import-reference /data/exports/tcb.csv` (copy the file into `exports/` first). Shown as information only, never evidence (Q26). |
| Field price survey (D11) | Keep as a CSV in `data/`. It is the ground truth for E6 and is never loaded into scoring. |

Real accounts can only report at real markets, DEMO accounts only at DEMO markets.

## 6. Labelling (D4, W6, W9)

1. Export the sample (real data only, no scores, statuses or votes):
   ```powershell
   docker compose exec api python -m app.cli export-for-labelling --out /data/exports/labelling-01
   ```
   You get `exports/labelling-01/reports.csv`, `photos/`, `labels_template.csv` and a README. The folder must not exist yet.
2. Write and freeze the rubric first. Each annotator fills a copy of `labels_template.csv`
   (`report_id,label,issue_present`; label = strongly_supported / supported / uncertain / not_supported;
   issue_present = yes / no / cant_tell) without seeing the other's file.
3. Import each file (all rows or none, never overwrites, the same file cannot be imported twice):
   ```powershell
   docker compose exec api python -m app.cli import-labels --annotator member_b /data/exports/member_b.csv
   docker compose exec api python -m app.cli import-labels --annotator independent /data/exports/independent.csv
   ```
4. Cohen's κ **before** any discussion: `docker compose exec api python -m app.cli label-agreement`
5. Agree the final labels and import them (`report_id,label,issue_present,adjudicated` with adjudicated = yes/no):
   `docker compose exec api python -m app.cli import-final-labels /data/exports/final.csv`

DEMO reports are refused at every step.

## 7. Evaluation (§4)

1. Freeze the code and config (commit), then export the evaluation table with the stratified split
   (40 % validation / 60 % test by default, fixed seed):
   ```powershell
   docker compose exec api python -m app.cli export-eval --out /data/exports/eval-v1.csv
   ```
   One row per labelled real report: status, c, u, κ, α, β, flags, the seven component scores and availabilities,
   model versions, vote counts, final label, split, config hash. It refuses any report scored with DEMO-synthetic
   values. Exports are never overwritten: use a new name each time.
2. Tune on the validation split only:
   ```powershell
   docker compose run --rm tools python -m scripts.evaluate report --data /data/exports/eval-v1.csv --split validation
   docker compose run --rm tools python -m scripts.evaluate tune-tau --data /data/exports/eval-v1.csv
   docker compose run --rm tools python -m scripts.evaluate fit-profile-b --data /data/exports/eval-v1.csv
   ```
   Write any tuned value into `config/civicpulse.yaml` (`ml.text_temperature`, `status.conflict_threshold`,
   `evidence.weights_b`), commit, restart, and re-score if needed (§8). Keep `weight_profile: A`
   for the demo; profile B is only for the comparison chapter.
3. Test once:
   ```powershell
   docker compose run --rm tools python -m scripts.evaluate report --data /data/exports/eval-v1.csv --split test --out /data/exports/results-test.json
   docker compose run --rm tools python -m scripts.evaluate ablation --data /data/exports/eval-v1.csv --split test
   ```
   `report` gives E1 (macro-F1, per class, confusion matrix, baselines B0–B3) and E2 (ECE, Brier, risk–coverage).
   B4 (no gate) needs a re-score with `status.gate_enabled: false` in a copy of the config. `ablation` is a
   simplified E3 (rebuilt from stored component scores without gate and conflict) and says so in its output.
   Use `--target issue` for "issue present = yes" as the binary target (open parameter B9).
4. Synthetic experiments E4, E5, E10 (attacks, feedback loop, false alarms) never touch pilot data:
   `docker compose run --rm tools python -m scripts.run_simulations` (writes `eval_results/`, gitignored).
   Report them separately from pilot results.

## 8. Connecting the artifacts

| Artifact | Where it goes | How the system picks it up |
|---|---|---|
| Model weights | `models/<org>__<name>/*.safetensors` | worker restart; `models_ready()` checks both models; hash stored per score |
| Chosen encoder, τ, θ_c, profile B weights | `config/civicpulse.yaml` | API/worker restart; config hash stored per scoring run |
| Reviewed prototypes/prompts | `config/civicpulse.yaml` | API restart (`seed-config`) and worker restart |
| Labels | database (`labels`, `label_final`) via the import commands | only read by `export-eval`; labels never feed scoring (R38) |

To re-score existing real reports after a config change, queue them from the API container:
```powershell
docker compose exec api python -c "from app.database import SessionLocal; from app.models import Report; from app.worker.queue import enqueue; db=SessionLocal(); [enqueue('rescore_report', str(i), 'recompute') for (i,) in db.query(Report.id).filter(Report.is_seed.is_(False), Report.status!='pending')]"
```
Note: re-scoring reuses the stored text and image scores (they are computed once per report). To score old reports with
a newly installed model, they have to be processed again; ask before doing that on pilot data.

## 9. Never do this

- Use DEMO data, the 50 E7 samples, or the test split for tuning.
- Commit `models/`, `data/`, `exports/`, `.env`, or certificates.
- Change thresholds after looking at test results (Q7).

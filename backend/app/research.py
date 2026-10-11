"""Research data tools (W6, W9, spec §4–§6). Every function here works on REAL pilot data only:
DEMO records (`is_seed`) are always excluded, and scores made from DEMO-synthetic model outputs are refused.

    export-for-labelling  photos + text for the two annotators, with NO scores, status or votes (W6)
    import-labels         one annotator's CSV: validated, all rows or none, never overwrites (W9)
    import-final-labels   the agreed final labels after the κ discussion (Q34)
    label-agreement       Cohen's κ on the two independent label sets, before discussion
    export-eval           frozen evaluation table: components, statuses, labels, stratified split
    import-reference      TCB / DAM / field reference price bands (information only, never evidence, Q26)
"""
from __future__ import annotations

import csv
import hashlib
import random
import shutil
from collections import defaultdict
from pathlib import Path

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.audit import audit
from app.core.timeutil import DHAKA
from app.models import (
    Category, Commodity, ReferencePrice, Evidence, Label, LabelFinal, LabelImportBatch, Market, PriceDetail, Report, ScoringRun,
    TrustScore, Vote,
)
from app.services import photos
from app.services.views import latlon_map

STATUSES = ("strongly_supported", "supported", "uncertain", "not_supported")
ISSUE = ("yes", "no", "cant_tell")
COMPONENTS = ("text", "image", "gps", "metadata", "reputation", "community", "history")
LABEL_HEADER = ["report_id", "label", "issue_present"]


class ResearchError(ValueError):
    pass


def real_reports(db: Session, include_hidden: bool = True):
    q = db.query(Report).filter(Report.is_seed.is_(False), Report.status != "pending")
    if not include_hidden:
        q = q.filter(Report.visibility == "visible")
    return q.order_by(Report.submitted_at)


# ---------------- export for labelling (W6) ----------------

def export_for_labelling(db: Session, out_dir: Path, include_hidden: bool = True) -> int:
    out_dir.mkdir(parents=True, exist_ok=False)          # never overwrite an earlier export
    (out_dir / "photos").mkdir()
    reports = real_reports(db, include_hidden).all()
    coords = latlon_map(db, [r.id for r in reports])
    cats = {c.id: c for c in db.query(Category).all()}
    coms = {c.id: c for c in db.query(Commodity).all()}
    mkts = {m.id: m for m in db.query(Market).all()}
    rows = []
    for r in reports:
        files = []
        evs = db.query(Evidence).filter(Evidence.report_id == r.id, Evidence.kind.in_(("report_photo", "product_photo"))).all()
        evs += (db.query(Evidence).join(Vote, Vote.id == Evidence.vote_id)
                .filter(Vote.report_id == r.id, Vote.replaced_at.is_(None), Vote.mode_verified == "on_spot").all())
        for ev in evs:
            name = f"{r.id}_{ev.kind}_{ev.id.hex[:8]}.jpg"
            shutil.copyfile(photos.abs_path(ev.file_path), out_dir / "photos" / name)
            files.append(name)
        row = {"report_id": str(r.id), "module": "green_guard" if r.report_type == "civic" else "price_patrol",
               "submitted_at_dhaka": r.submitted_at.astimezone(DHAKA).strftime("%Y-%m-%d %I:%M %p"),
               "lat": coords.get(r.id, (None, None))[0], "lon": coords.get(r.id, (None, None))[1],
               "category": cats[r.category_id].name_en if r.category_id else "", "description": r.description or "",
               "commodity": "", "market": "", "price_bdt": "", "photos": ";".join(files)}
        if r.report_type == "price":
            d = db.get(PriceDetail, r.id)
            c = coms[d.commodity_id]
            row.update(commodity=f"{c.name_en} ({c.variant}, per {c.unit})", market=mkts[d.market_id].name_en,
                       price_bdt=str(d.price_bdt))
        rows.append(row)
    with (out_dir / "reports.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()) if rows else ["report_id"])
        w.writeheader()
        w.writerows(rows)
    with (out_dir / "labels_template.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(LABEL_HEADER)
        for row in rows:
            w.writerow([row["report_id"], "", ""])
    (out_dir / "README.txt").write_text(
        "Label every report with one of: " + ", ".join(STATUSES) + "\n"
        "issue_present: yes, no or cant_tell\n"
        "Do not look at the other annotator's file. Scores, statuses and votes are left out on purpose (W6).\n",
        encoding="utf-8")
    return len(rows)


# ---------------- label import (W9) ----------------

def _read_labels(path: Path, extra: tuple[str, ...] = ()) -> tuple[list[dict], str]:
    raw = path.read_bytes()
    sha = hashlib.sha256(raw).hexdigest()
    reader = csv.DictReader(raw.decode("utf-8-sig").splitlines())
    want = LABEL_HEADER + list(extra)
    if reader.fieldnames != want:
        raise ResearchError(f"header must be exactly {','.join(want)}")
    rows = list(reader)
    if not rows:
        raise ResearchError("the file has no rows")
    return rows, sha


def _validate(db: Session, rows: list[dict]) -> list[str]:
    errors, seen = [], set()
    for n, row in enumerate(rows, start=2):
        rid, label, issue = row["report_id"].strip(), row["label"].strip(), row["issue_present"].strip()
        if rid in seen:
            errors.append(f"line {n}: report {rid} appears twice")
        seen.add(rid)
        if label not in STATUSES:
            errors.append(f"line {n}: label {label!r} is not one of {STATUSES}")
        if issue not in ISSUE:
            errors.append(f"line {n}: issue_present {issue!r} is not one of {ISSUE}")
        try:
            r = db.get(Report, rid)
        except Exception:  # noqa: BLE001 - bad UUID text
            r = None
        if r is None:
            errors.append(f"line {n}: unknown report {rid}")
        elif r.is_seed:
            errors.append(f"line {n}: report {rid} is DEMO data and can never be labelled (N13)")
    return errors


def import_labels(db: Session, annotator: str, path: Path, imported_by: str) -> int:
    if annotator not in ("member_b", "independent"):
        raise ResearchError("annotator must be member_b or independent")
    rows, sha = _read_labels(path)
    if db.query(LabelImportBatch.id).filter_by(file_sha256=sha).first():
        raise ResearchError("this exact file was already imported")
    errors = _validate(db, rows)
    existing = {str(r) for r, in db.query(Label.report_id).filter_by(annotator=annotator).all()}
    errors += [f"report {row['report_id']} already has a {annotator} label (no overwrites)"
               for row in rows if row["report_id"].strip() in existing]
    if errors:
        raise ResearchError("nothing imported:\n  " + "\n  ".join(errors[:50]))
    batch = LabelImportBatch(annotator=annotator, file_sha256=sha, row_count=len(rows), imported_by=imported_by)
    db.add(batch)
    db.flush()
    for row in rows:
        db.add(Label(report_id=row["report_id"].strip(), annotator=annotator, batch_id=batch.id,
                     label=row["label"].strip(), issue_present=row["issue_present"].strip()))
    audit(db, actor_id=None, action="labels.import", entity="label_batch", entity_id=batch.id,
          after={"annotator": annotator, "rows": len(rows), "sha256": sha[:16]}, reason=f"imported by {imported_by}")
    db.commit()
    return len(rows)


def import_final_labels(db: Session, path: Path, imported_by: str) -> int:
    """Final labels after discussion; `adjudicated` = yes when the two annotators first disagreed."""
    rows, sha = _read_labels(path, ("adjudicated",))
    errors = _validate(db, rows)
    existing = {str(r) for r, in db.query(LabelFinal.report_id).all()}
    errors += [f"report {row['report_id']} already has a final label" for row in rows if row["report_id"].strip() in existing]
    errors += [f"report {row['report_id']}: adjudicated must be yes or no" for row in rows
               if row["adjudicated"].strip() not in ("yes", "no")]
    if errors:
        raise ResearchError("nothing imported:\n  " + "\n  ".join(errors[:50]))
    for row in rows:
        db.add(LabelFinal(report_id=row["report_id"].strip(), label=row["label"].strip(),
                          issue_present=row["issue_present"].strip(), adjudicated=row["adjudicated"].strip() == "yes"))
    audit(db, actor_id=None, action="labels.import_final", entity="label_final", entity_id=sha[:16],
          after={"rows": len(rows)}, reason=f"imported by {imported_by}")
    db.commit()
    return len(rows)


def label_agreement(db: Session) -> dict:
    from app.ml.metrics import cohen_kappa

    by = defaultdict(dict)
    for lab in db.query(Label).all():
        by[lab.report_id][lab.annotator] = lab
    both = [v for v in by.values() if "member_b" in v and "independent" in v]
    if not both:
        return {"n": 0, "kappa_status": None, "kappa_issue": None}
    return {"n": len(both),
            "kappa_status": cohen_kappa([v["member_b"].label for v in both], [v["independent"].label for v in both]),
            "kappa_issue": cohen_kappa([v["member_b"].issue_present for v in both],
                                       [v["independent"].issue_present for v in both]),
            "raw_agreement_status": sum(v["member_b"].label == v["independent"].label for v in both) / len(both)}


# ---------------- frozen evaluation table ----------------

def export_eval(db: Session, out_path: Path, val_fraction: float = 0.4, seed: int = 20261010) -> dict:
    """One row per labelled real report: the latest scoring run (text, image, GPS and metadata never change after
    the first run; community and history show the final state) and the current status.
    Split: stratified by module and final label with a fixed seed (open parameter B8)."""
    if out_path.exists():
        raise ResearchError(f"{out_path} exists; exports are frozen, choose a new name")
    finals = {f.report_id: f for f in db.query(LabelFinal).all()}
    cats = {c.id: c for c in db.query(Category).all()}
    rows = []
    for r in real_reports(db).filter(Report.id.in_(list(finals) or [None])).all():
        run = db.query(ScoringRun).filter_by(report_id=r.id).order_by(ScoringRun.id.desc()).first()
        comps = {t.component: t for t in db.query(TrustScore).filter_by(run_id=run.id, view="displayed").all()}
        if any((t.model_version or "").startswith("DEMO") for t in comps.values()):
            raise ResearchError(f"report {r.id} has DEMO-synthetic model scores; it cannot be evaluated")
        f = finals[r.id]
        votes = dict(db.query(Vote.decision, func.count()).filter(Vote.report_id == r.id, Vote.replaced_at.is_(None))
                     .group_by(Vote.decision).all())
        row = {"report_id": str(r.id), "module": r.report_type,
               "category": cats[r.category_id].code if r.category_id else "", "description": r.description or "",
               "votes_confirm": votes.get("confirm", 0), "votes_disagree": votes.get("disagree", 0),
               "status": r.status, "judging_status": r.judging_status,
               "credibility": r.credibility, "uncertainty": r.uncertainty, "conflict": r.conflict,
               "alpha": r.alpha, "beta": r.beta, "flags": ";".join(r.flags or []), "visibility": r.visibility,
               "final_label": f.label, "issue_present": f.issue_present, "config_hash": run.config_hash,
               "scoring_version": run.scoring_version}
        for k in COMPONENTS:
            t = comps.get(k)
            row[f"{k}_score"] = "" if t is None or t.score is None else t.score
            row[f"{k}_availability"] = t.availability if t else "unavailable"
            if k in ("text", "image"):
                row[f"{k}_model"] = (t.model_version or "") if t else ""
        rows.append(row)
    rng = random.Random(seed)
    strata = defaultdict(list)
    for row in rows:
        strata[(row["module"], row["final_label"])].append(row)
    for group in strata.values():
        rng.shuffle(group)
        n_val = round(len(group) * val_fraction)
        for i, row in enumerate(group):
            row["split"] = "validation" if i < n_val else "test"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", newline="", encoding="utf-8") as fh:
        if rows:
            w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
    return {"rows": len(rows), "validation": sum(r["split"] == "validation" for r in rows),
            "test": sum(r["split"] == "test" for r in rows)}


# ---------------- reference prices (D10, D11) ----------------

REF_HEADER = ["source", "commodity_id", "market_id", "date", "min_bdt", "max_bdt"]


def import_reference(db: Session, path: Path) -> int:
    """CSV with columns source (TCB|DAM|field), commodity_id, market_id (empty = regional), date (YYYY-MM-DD),
    min_bdt, max_bdt. Validated; all rows or none."""
    from datetime import date as _date
    from decimal import Decimal, InvalidOperation

    reader = csv.DictReader(path.read_text(encoding="utf-8-sig").splitlines())
    if reader.fieldnames != REF_HEADER:
        raise ResearchError(f"header must be exactly {','.join(REF_HEADER)}")
    coms = {c for c, in db.query(Commodity.id).all()}
    mkts = {m for m, in db.query(Market.id).all()}
    rows, errors = [], []
    for n, row in enumerate(reader, start=2):
        try:
            src = row["source"].strip()
            com = int(row["commodity_id"])
            mkt = int(row["market_id"]) if row["market_id"].strip() else None
            day = _date.fromisoformat(row["date"].strip())
            lo, hi = Decimal(row["min_bdt"]), Decimal(row["max_bdt"])
        except (ValueError, InvalidOperation):
            errors.append(f"line {n}: bad number or date")
            continue
        if src not in ("TCB", "DAM", "field"):
            errors.append(f"line {n}: source must be TCB, DAM or field")
        if com not in coms or (mkt is not None and mkt not in mkts):
            errors.append(f"line {n}: unknown commodity or market id")
        if not (0 < lo <= hi):
            errors.append(f"line {n}: need 0 < min_bdt <= max_bdt")
        rows.append(ReferencePrice(source=src, commodity_id=com, market_id=mkt, date=day, min_bdt=lo, max_bdt=hi))
    if errors or not rows:
        raise ResearchError("nothing imported:\n  " + "\n  ".join(errors[:50] or ["the file has no rows"]))
    db.add_all(rows)
    audit(db, actor_id=None, action="reference.import", entity="reference_prices", after={"rows": len(rows)})
    db.commit()
    return len(rows)

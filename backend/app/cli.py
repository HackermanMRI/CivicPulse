"""Command-line tools that run inside the api container (spec §2).

    python -m app.cli seed-config          # load the 7 categories from config/civicpulse.yaml
    python -m app.cli create-admin --phone +8801XXXXXXXXX --name "Member A"
    python -m app.cli seed-demo            # load the labelled DEMO dataset (needs DEMO_PASSWORD); no-op if loaded
    python -m app.cli reset-demo --yes     # delete every DEMO record, keep every real record

Research data (real pilot data only; DEMO data is always refused, spec N13):
    python -m app.cli export-for-labelling --out /data/exports/labelling-01
    python -m app.cli import-labels --annotator member_b /data/exports/member_b.csv
    python -m app.cli label-agreement
    python -m app.cli import-final-labels /data/exports/final.csv
    python -m app.cli export-eval --out /data/exports/eval-v1.csv
    python -m app.cli import-reference /data/exports/tcb_prices.csv
"""
from __future__ import annotations

import argparse
import getpass
import os
import sys

from sqlalchemy.dialects.postgresql import insert

from app.database import SessionLocal
from app.models import AuditLog, Category, User
from app.scoring.params import load_params


def seed_config() -> int:
    params = load_params()
    with SessionLocal() as db:
        for cat in params.categories:
            values = dict(code=cat.code, name_en=cat.name_en, name_bn=cat.name_bn, impact=cat.impact,
                          extent=cat.extent, urgency=cat.urgency, text_prototypes=cat.text_prototypes,
                          clip_prompts=cat.clip_prompts, active=True)
            stmt = insert(Category).values(**values)
            stmt = stmt.on_conflict_do_update(index_elements=[Category.code],
                                              set_={k: v for k, v in values.items() if k != "code"})
            db.execute(stmt)
        db.commit()
    print(f"seed-config: {len(params.categories)} categories loaded (config {params.config_hash[:12]})")
    return 0


def create_admin(phone: str, name: str) -> int:
    from app.security.passwords import hash_password, validate_password
    from app.security.phone import normalize_phone

    phone = normalize_phone(phone)
    password = getpass.getpass("Admin password: ")
    if password != getpass.getpass("Repeat password: "):
        print("passwords do not match", file=sys.stderr)
        return 1
    problem = validate_password(password)
    if problem:
        print(problem, file=sys.stderr)
        return 1
    with SessionLocal() as db:
        if db.query(User).filter_by(phone=phone).first():
            print("an account with this phone already exists", file=sys.stderr)
            return 1
        user = User(phone=phone, phone_verified=True, display_name=name, pass_hash=hash_password(password), role="admin")
        db.add(user)
        db.flush()
        db.add(AuditLog(actor_id=None, action="user.create_admin", entity="user", entity_id=str(user.id),
                        after={"role": "admin"}, reason="created with create-admin CLI"))
        db.commit()
    print(f"admin created for {phone}")
    return 0


def seed_demo_cmd(reset_first: bool) -> int:
    import os
    import time

    from app.demo.reset import reset_demo
    from app.demo.seed import SeedError, seed_demo

    password = os.environ.get("DEMO_PASSWORD", "")
    if not password:
        print("Set DEMO_PASSWORD in .env first: it becomes the password of the three DEMO login accounts.", file=sys.stderr)
        return 1
    with SessionLocal() as db:
        if reset_first:
            print("reset-demo:", reset_demo(db))
        started = time.monotonic()
        try:
            counts = seed_demo(db, password)
        except SeedError as exc:
            print(f"seed-demo failed: {exc}", file=sys.stderr)
            return 1
    if counts is None:
        print("seed-demo: DEMO data is already loaded (nothing changed). Use reset-demo first to reload it.")
        return 0
    print(f"seed-demo: done in {time.monotonic() - started:.0f} s")
    for k, v in counts.items():
        print(f"  {k}: {v}")
    print("  DEMO logins: +8801700000001, +8801700000002, +8801700000003 (password = DEMO_PASSWORD)")
    return 0


def reset_demo_cmd(confirmed: bool) -> int:
    from app.demo.reset import reset_demo

    if not confirmed:
        print("This deletes every DEMO record (real records are kept). Run again with --yes to confirm.")
        return 1
    with SessionLocal() as db:
        out = reset_demo(db)
    print("reset-demo:", out)
    return 0


def research_cmd(args) -> int:
    import getpass as _gp
    import json
    from pathlib import Path

    from app import research

    who = os.environ.get("USER") or _gp.getuser() or "cli"
    with SessionLocal() as db:
        try:
            if args.cmd == "export-for-labelling":
                n = research.export_for_labelling(db, Path(args.out), include_hidden=not args.visible_only)
                print(f"exported {n} real reports to {args.out} (no scores, statuses or votes)")
            elif args.cmd == "import-labels":
                print(f"imported {research.import_labels(db, args.annotator, Path(args.file), who)} labels")
            elif args.cmd == "import-final-labels":
                print(f"imported {research.import_final_labels(db, Path(args.file), who)} final labels")
            elif args.cmd == "label-agreement":
                print(json.dumps(research.label_agreement(db), indent=2))
            elif args.cmd == "import-reference":
                print(f"imported {research.import_reference(db, Path(args.file))} reference price rows")
            elif args.cmd == "export-eval":
                print(json.dumps(research.export_eval(db, Path(args.out), args.val_fraction, args.seed), indent=2))
        except research.ResearchError as exc:
            print(str(exc), file=sys.stderr)
            return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m app.cli")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("seed-config")
    adm = sub.add_parser("create-admin")
    adm.add_argument("--phone", required=True)
    adm.add_argument("--name", required=True)
    sd = sub.add_parser("seed-demo")
    sd.add_argument("--reset", action="store_true", help="remove existing DEMO data first")
    rd = sub.add_parser("reset-demo")
    rd.add_argument("--yes", action="store_true")
    ex = sub.add_parser("export-for-labelling")
    ex.add_argument("--out", required=True)
    ex.add_argument("--visible-only", action="store_true")
    il = sub.add_parser("import-labels")
    il.add_argument("--annotator", required=True, choices=["member_b", "independent"])
    il.add_argument("file")
    fl = sub.add_parser("import-final-labels")
    fl.add_argument("file")
    sub.add_parser("label-agreement")
    ir = sub.add_parser("import-reference")
    ir.add_argument("file")
    ee = sub.add_parser("export-eval")
    ee.add_argument("--out", required=True)
    ee.add_argument("--val-fraction", type=float, default=0.4)
    ee.add_argument("--seed", type=int, default=20261010)
    args = ap.parse_args(argv)
    if args.cmd in ("export-for-labelling", "import-labels", "import-final-labels", "label-agreement", "export-eval",
                    "import-reference"):
        return research_cmd(args)
    if args.cmd == "seed-demo":
        return seed_demo_cmd(args.reset)
    if args.cmd == "reset-demo":
        return reset_demo_cmd(args.yes)
    if args.cmd == "seed-config":
        return seed_config()
    if args.cmd == "create-admin":
        return create_admin(args.phone, args.name)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())

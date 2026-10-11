"""Command-line tools that run inside the api container (spec §2).

    python -m app.cli seed-config          # load the 7 categories from config/civicpulse.yaml
    python -m app.cli create-admin --phone +8801XXXXXXXXX --name "Member A"
"""
from __future__ import annotations

import argparse
import getpass
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


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m app.cli")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("seed-config")
    adm = sub.add_parser("create-admin")
    adm.add_argument("--phone", required=True)
    adm.add_argument("--name", required=True)
    args = ap.parse_args(argv)
    if args.cmd == "seed-config":
        return seed_config()
    if args.cmd == "create-admin":
        return create_admin(args.phone, args.name)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())

"""Append-only audit writer. The row joins the caller's transaction, so a failing audit write rolls
back the action itself (spec §8)."""
from __future__ import annotations

import hashlib
import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.config import settings
from app.models import AuditLog


def ip_hash(ip: str | None) -> str | None:
    if not ip:
        return None
    return hashlib.sha256((settings.IP_HASH_SALT + ip).encode()).hexdigest()


def audit(db: Session, *, actor_id: uuid.UUID | None, action: str, entity: str, entity_id: Any = None,
          before: dict | None = None, after: dict | None = None, reason: str | None = None,
          ip: str | None = None) -> None:
    db.add(AuditLog(actor_id=actor_id, action=action, entity=entity,
                    entity_id=str(entity_id) if entity_id is not None else None,
                    before=before, after=after, reason=reason, ip_hash=ip_hash(ip)))

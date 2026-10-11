"""Single-use capture tokens (K3, P6, U20).

A token is asked for when the in-app camera opens. `captured_at` is fixed at that moment and copied,
never reset, when the token is renewed; a retake starts a new chain (at most `retakes_per_report`).
"""
from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.core import ratelimit
from app.core.deps import device_hash, get_db, require_citizen, require_device
from app.core.params import get_params
from app.core.timeutil import now_utc
from app.models import CaptureToken, Report, User

router = APIRouter(prefix="/api/capture-tokens", tags=["Capture"])


class TokenIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    purpose: Literal["report", "verification", "price_photo"]
    report_id: uuid.UUID | None = None        # required for "verification"
    renew_token_id: uuid.UUID | None = None   # keep captured_at of this chain (U20)
    retake_of: uuid.UUID | None = None        # start a new chain after this one


def check_token(db: Session, token_id: uuid.UUID | None, user: User, purpose: str,
                report_id: uuid.UUID | None = None) -> CaptureToken:
    """Valid = exists, owned by this user, right purpose (and report), unused and not expired."""
    if token_id is None:
        raise HTTPException(status_code=422, detail="Missing capture token. Open the camera again.")
    tok = db.get(CaptureToken, token_id, with_for_update=True)
    if tok is None or tok.user_id != user.id or tok.purpose != purpose:
        raise HTTPException(status_code=422, detail="Invalid capture token. Retake the photo.")
    if purpose == "verification" and tok.report_id != report_id:
        raise HTTPException(status_code=422, detail="This photo was taken for another report. Retake it.")
    if tok.used_at is not None:
        raise HTTPException(status_code=422, detail="This photo was already used. Retake it.")
    if tok.expires_at <= now_utc():
        raise HTTPException(status_code=422, detail="The photo is too old (10 minute limit). Retake it.")
    return tok


@router.post("", status_code=201)
def issue(body: TokenIn, user: User = Depends(require_citizen), db: Session = Depends(get_db),
          dev_hash: str | None = Depends(device_hash)):
    params = get_params()
    require_device(db, user, dev_hash)
    ratelimit.enforce(f"capture:{user.id}", params.limits.capture_tokens_per_minute, 60,
                      "Too many camera requests. Wait a minute.")
    now = now_utc()
    if body.purpose == "verification":
        report = db.get(Report, body.report_id) if body.report_id else None
        if report is None or report.report_type != "civic" or report.visibility != "visible":
            raise HTTPException(status_code=404, detail="Report not found")
        if report.user_id == user.id:
            raise HTTPException(status_code=403, detail="You cannot verify your own report.")
    elif body.report_id is not None:
        raise HTTPException(status_code=422, detail="report_id is only for verification photos")

    captured_at, retake, renewed_from = now, 1, None
    if body.renew_token_id and body.retake_of:
        raise HTTPException(status_code=422, detail="Choose renew or retake, not both")
    prev_id = body.renew_token_id or body.retake_of
    if prev_id:
        prev = db.get(CaptureToken, prev_id)
        if prev is None or prev.user_id != user.id or prev.purpose != body.purpose or prev.report_id != body.report_id:
            raise HTTPException(status_code=422, detail="Invalid earlier token")
        if prev.used_at is not None and body.renew_token_id:
            raise HTTPException(status_code=422, detail="This photo was already used. Retake it.")
        if body.renew_token_id:
            captured_at, retake, renewed_from = prev.captured_at, prev.retake_index, prev.id
        else:
            retake = prev.retake_index + 1
            if retake > params.limits.retakes_per_report:
                raise HTTPException(status_code=429, detail="Retake limit reached. Start the report again.")
        if prev.used_at is None:
            prev.used_at = now          # only one live token per chain
    tok = CaptureToken(user_id=user.id, purpose=body.purpose, report_id=body.report_id, captured_at=captured_at,
                       renewed_from_id=renewed_from, retake_index=retake, issued_at=now,
                       expires_at=now + timedelta(minutes=params.metadata.capture_token_minutes))
    db.add(tok)
    db.commit()
    return {"token": str(tok.id), "captured_at": tok.captured_at.isoformat(), "expires_at": tok.expires_at.isoformat(),
            "retake_index": tok.retake_index, "retakes_left": params.limits.retakes_per_report - tok.retake_index}

"""Load and validate config/civicpulse.yaml (spec §1 "Configuration file").

The scoring package depends only on this module, never on app.config, so the
maths can be tested without a database or web server.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

COMPONENTS = ("text", "image", "gps", "metadata", "reputation", "community", "history")


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


Unit = Field(ge=0.0, le=1.0)


class Band(_Strict):
    min_credibility: float = Unit
    max_uncertainty: float = Unit


class GateRep(_Strict):
    min_rep: float = Unit
    max_uncertainty: float = Unit


class StatusCfg(_Strict):
    strongly_supported: Band
    supported: Band
    not_supported_max_credibility: float = Unit
    conflict_threshold: float = Unit
    gate_reputation: GateRep
    gate_enabled: bool = True


class EvidenceCfg(_Strict):
    weight_profile: Literal["A", "B"]
    weights_a: dict[str, float]
    weights_b: dict[str, float] | None = None

    @model_validator(mode="after")
    def _check(self) -> "EvidenceCfg":
        for name, weights in (("weights_a", self.weights_a), ("weights_b", self.weights_b)):
            if weights is None:
                continue
            if set(weights) != set(COMPONENTS):
                raise ValueError(f"{name} must have exactly the 7 components {COMPONENTS}")
            if any(w < 0 for w in weights.values()):
                raise ValueError(f"{name} weights must be non-negative")
        if self.weight_profile == "B" and self.weights_b is None:
            raise ValueError("weight_profile B needs weights_b (run the profile-B fit first)")
        return self

    def weights(self) -> dict[str, float]:
        return dict(self.weights_b if self.weight_profile == "B" else self.weights_a)


class GpsCfg(_Strict):
    accuracy_limit_m: float = Field(gt=0)
    market_radius_default_m: float = Field(gt=0)
    ward_fallback_radius_m: float = Field(gt=0)


class MetadataCfg(_Strict):
    capture_token_minutes: float = Field(gt=0)


class HistoryCfg(_Strict):
    radius_m: float = Field(gt=0)
    window_days: float = Field(gt=0)
    half_life_days: float = Field(gt=0)


class EventsCfg(_Strict):
    radius_m: float = Field(gt=0)
    window_hours: float = Field(gt=0)


class VotesCfg(_Strict):
    on_spot_radius_m: float = Field(gt=0)
    mode_weights: dict[Literal["on_spot", "same_ward", "far_away"], float]
    consensus_k: int = Field(ge=1)
    fixed_now_to_resolve: int = Field(ge=1)
    burst_per_minute: int = Field(ge=1)


class Delta(_Strict):
    d_alpha: float = Field(ge=0)
    d_beta: float = Field(ge=0)


class ReputationCfg(_Strict):
    half_life_days: float = Field(gt=0)
    report_positive: Delta
    report_negative: Delta
    duplicate: Delta
    vote_agree: Delta
    vote_disagree: Delta


class FlagsCfg(_Strict):
    needs_verification_ratio: float = Field(gt=0)
    auto_hide_uncertainty: float = Unit
    auto_hide_after_days: float = Field(gt=0)
    image_mismatch_threshold: float = Unit


class PricesCfg(_Strict):
    min_eligible_reports: int = Field(ge=1)
    outlier_z: float = Field(gt=0)
    small_n_threshold: float = Field(gt=0)
    small_n_switch: int = Field(ge=2)
    mad_floor_bdt: float = Field(ge=0)
    mad_floor_fraction: float = Field(ge=0)
    agreement_tolerance: float = Field(gt=0)
    raw_display_days: int = Field(ge=1)
    max_days_back: int = Field(ge=0)
    change_window_days: int = Field(ge=2)
    alert_change_percent: float = Field(gt=0)


class SeverityWeights(_Strict):
    impact: float = Unit
    extent: float = Unit
    urgency: float = Unit


class HotspotsCfg(_Strict):
    window_days: float = Field(gt=0)
    half_life_days: float = Field(gt=0)
    t_ref: float = Field(gt=0)
    min_samples: int = Field(ge=2)
    eps_m: float = Field(gt=0)
    min_reports: int = Field(ge=1)
    min_users: int = Field(ge=1)
    severity_weights: SeverityWeights


class AlertsCfg(_Strict):
    baseline_days: int = Field(ge=1)
    guard_days: int = Field(ge=0)
    min_live_days: int = Field(ge=1)
    min_count: int = Field(ge=1)
    alpha: float = Field(gt=0, lt=1)
    overdispersion_switch: float = Field(gt=1)


class CollusionCfg(_Strict):
    n_min: int = Field(ge=1)
    agreement: float = Unit
    percentile: float = Field(gt=0, lt=100)
    down_weighting_enabled: bool


class LimitsCfg(_Strict):
    civic_per_day: int = Field(ge=1)
    price_per_cell_per_day: int = Field(ge=1)
    capture_tokens_per_minute: int = Field(ge=1)
    retakes_per_report: int = Field(ge=1)
    description_max_chars: int = Field(ge=1)


class SessionsCfg(_Strict):
    access_minutes: int = Field(ge=1)
    refresh_days: int = Field(ge=1)
    admin_refresh_days: int = Field(ge=1)


class OtpCfg(_Strict):
    digits: int = Field(ge=4, le=10)
    expiry_minutes: int = Field(ge=1)
    max_attempts: int = Field(ge=1)


class UploadsCfg(_Strict):
    max_bytes: int = Field(gt=0)
    max_side_px: int = Field(gt=0)
    max_pixels: int = Field(gt=0)


class Category(_Strict):
    code: str = Field(pattern=r"^[a-z_]+$")
    name_en: str
    name_bn: str
    impact: float = Unit
    extent: float = Unit
    urgency: float = Unit
    review_status: Literal["draft", "reviewed"]
    clip_prompts: list[str] = Field(min_length=1)
    text_prototypes: list[str] = Field(min_length=1)


class EncoderCandidate(_Strict):
    name: str
    query_prefix: str = ""


class MlCfg(_Strict):
    clip_model: str
    text_encoder: str
    text_query_prefix: str = ""
    text_temperature: float = Field(gt=0)
    encoder_candidates: list[EncoderCandidate] = Field(min_length=1)


class Params(_Strict):
    status: StatusCfg
    evidence: EvidenceCfg
    gps: GpsCfg
    metadata: MetadataCfg
    history: HistoryCfg
    events: EventsCfg
    votes: VotesCfg
    reputation: ReputationCfg
    flags: FlagsCfg
    prices: PricesCfg
    hotspots: HotspotsCfg
    alerts: AlertsCfg
    collusion: CollusionCfg
    limits: LimitsCfg
    sessions: SessionsCfg
    otp: OtpCfg
    uploads: UploadsCfg
    categories: list[Category] = Field(min_length=2)
    clip_unrelated_prompt: str
    ml: MlCfg
    config_hash: str = ""

    @model_validator(mode="after")
    def _unique_codes(self) -> "Params":
        codes = [c.code for c in self.categories]
        if len(codes) != len(set(codes)):
            raise ValueError("category codes must be unique")
        return self

    def severity(self, code: str) -> float:
        """F27: Severity = 0.5·Impact + 0.3·Extent + 0.2·Urgency."""
        w = self.hotspots.severity_weights
        cat = self.category(code)
        return w.impact * cat.impact + w.extent * cat.extent + w.urgency * cat.urgency

    def category(self, code: str) -> Category:
        for cat in self.categories:
            if cat.code == code:
                return cat
        raise KeyError(f"unknown category {code!r}")


def default_config_path() -> Path:
    return Path(__file__).resolve().parents[3] / "config" / "civicpulse.yaml"


def load_params(path: str | Path | None = None) -> Params:
    """Read the YAML with safe_load (never yaml.load) and validate every value."""
    path = Path(path) if path else default_config_path()
    raw_bytes = path.read_bytes()
    data = yaml.safe_load(raw_bytes)
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a mapping")
    data["config_hash"] = hashlib.sha256(raw_bytes).hexdigest()
    return Params.model_validate(data)

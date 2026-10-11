"""Import every model so Base.metadata knows all tables (Alembic and create_all rely on this)."""
from app.models.user import Consent, Device, OtpCode, RefreshToken, User, UserAddress
from app.models.geo import Category, Commodity, Market, Ward
from app.models.report import AbuseReport, CaptureToken, Event, Evidence, PriceDetail, Report, SavedPost, Vote
from app.models.scoring import ReputationEvent, ScoringRun, TrustScore
from app.models.intelligence import Alert, Hotspot, LiveDay, Notification, PriceWatch, ReferencePrice, VerifiedPrice
from app.models.admin import AuditLog, CollusionAlert, Label, LabelFinal, LabelImportBatch, VoterPair

__all__ = [
    "Consent", "Device", "OtpCode", "RefreshToken", "User", "UserAddress",
    "Category", "Commodity", "Market", "Ward",
    "AbuseReport", "CaptureToken", "Event", "Evidence", "PriceDetail", "Report", "SavedPost", "Vote",
    "ReputationEvent", "ScoringRun", "TrustScore",
    "Alert", "Hotspot", "LiveDay", "Notification", "PriceWatch", "ReferencePrice", "VerifiedPrice",
    "AuditLog", "CollusionAlert", "Label", "LabelFinal", "LabelImportBatch", "VoterPair",
]

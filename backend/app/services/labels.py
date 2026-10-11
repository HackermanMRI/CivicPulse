"""User-facing words for statuses and flags (UI decisions). Never "true", "false" or "fake" (Q2)."""

STATUS_LABEL = {
    "pending": "Checking…",
    "strongly_supported": "Highly credible",
    "supported": "Credible",
    "uncertain": "Needs more verification",
    "not_supported": "Low credibility",
}

FLAG_LABEL = {
    "duplicate": "Duplicate report",
    "suspicious": "Reused photo",
    "category_mismatch": "Image may not match the category",
    "requires_more_verification": "Needs more verification",
    "price_outlier": "Unusual price",
}


def status_label(status: str | None) -> str:
    return STATUS_LABEL.get(status or "pending", "Checking…")

"""Bangladesh mobile numbers in E.164 form (+8801XXXXXXXXX)."""
import re

_BD_MOBILE = re.compile(r"^\+8801[3-9]\d{8}$")


def normalize_phone(raw: str) -> str:
    digits = re.sub(r"[\s\-()]", "", raw or "")
    if digits.startswith("00880"):
        digits = "+" + digits[2:]
    elif digits.startswith("880"):
        digits = "+" + digits
    elif digits.startswith("01"):
        digits = "+88" + digits
    elif digits.startswith("1") and len(digits) == 10:
        digits = "+880" + digits
    if not _BD_MOBILE.match(digits):
        raise ValueError("Enter a Bangladeshi mobile number, for example 01712345678.")
    return digits

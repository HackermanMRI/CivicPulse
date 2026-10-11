"""argon2id password hashing at or above the OWASP minimum (19 MiB, 2 iterations, parallelism 1)."""
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

_hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)
# Used to spend the same time when the phone number is unknown, so login timing reveals nothing.
_DUMMY_HASH = _hasher.hash("timing-equaliser-not-a-real-password")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, encoded: str | None) -> bool:
    try:
        return _hasher.verify(encoded or _DUMMY_HASH, password) and encoded is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(encoded: str) -> bool:
    return _hasher.check_needs_rehash(encoded)


def validate_password(password: str) -> str | None:
    """Return a plain-language problem, or None if the password is acceptable."""
    if len(password) < 8:
        return "Use at least 8 characters."
    if len(password) > 128:
        return "Use at most 128 characters."
    if password.isdigit():
        return "Don't use only numbers."
    return None

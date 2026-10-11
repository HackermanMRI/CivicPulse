"""One validated copy of config/civicpulse.yaml per process."""
from functools import lru_cache

from app.config import settings
from app.scoring.params import Params, load_params


@lru_cache(maxsize=1)
def get_params() -> Params:
    return load_params(settings.CONFIG_PATH)

"""Profile B weights (F30): non-negative logistic regression on the validation split.

x_k = (2·s_k − 1)·avail_k,  P(y=1) = σ(w0 + Σ w_k x_k),  w_k ≥ 0.
scikit-learn's LogisticRegression has no non-negativity option, so this uses
scipy.optimize.minimize with L-BFGS-B and bounds (0, ∞) on each weight.
Used only for the results chapter (C3); the build and demo use profile A.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Sequence

import numpy as np
from scipy.optimize import minimize
from scipy.special import expit

from app.scoring.params import COMPONENTS


@dataclass(frozen=True)
class ProfileB:
    intercept: float
    weights: dict[str, float]
    log_loss: float
    n_samples: int
    converged: bool


def design_matrix(rows: Sequence[Mapping[str, float | None]]) -> np.ndarray:
    """One row per report: component score or None when unavailable (avail_k = 0)."""
    x = np.zeros((len(rows), len(COMPONENTS)))
    for i, row in enumerate(rows):
        for j, name in enumerate(COMPONENTS):
            s = row.get(name)
            if s is not None:
                if not 0.0 <= s <= 1.0:
                    raise ValueError(f"score for {name} out of range: {s}")
                x[i, j] = 2.0 * s - 1.0
    return x


def fit_profile_b(rows: Sequence[Mapping[str, float | None]], labels: Sequence[int]) -> ProfileB:
    y = np.asarray(labels, dtype=float)
    if y.ndim != 1 or len(y) != len(rows):
        raise ValueError("labels must match rows")
    if set(np.unique(y)) - {0.0, 1.0}:
        raise ValueError("labels must be 0 or 1")
    if len(np.unique(y)) < 2:
        raise ValueError("both classes are needed to fit weights")
    x = design_matrix(rows)

    def loss_and_grad(theta: np.ndarray) -> tuple[float, np.ndarray]:
        z = theta[0] + x @ theta[1:]
        p = np.clip(expit(z), 1e-12, 1 - 1e-12)
        loss = -np.mean(y * np.log(p) + (1 - y) * np.log(1 - p))
        err = (p - y) / len(y)
        return float(loss), np.concatenate([[err.sum()], x.T @ err])

    theta0 = np.concatenate([[0.0], np.ones(len(COMPONENTS))])
    bounds = [(None, None)] + [(0.0, None)] * len(COMPONENTS)
    res = minimize(loss_and_grad, theta0, jac=True, method="L-BFGS-B", bounds=bounds)
    weights = {name: float(w) for name, w in zip(COMPONENTS, res.x[1:])}
    return ProfileB(float(res.x[0]), weights, float(res.fun), len(y), bool(res.success))

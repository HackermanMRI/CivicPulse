"""Evaluation metrics used in E1–E11 (spec §4 "Metrics")."""
from __future__ import annotations

from typing import Sequence

import numpy as np
from scipy import stats

STATUSES = ("strongly_supported", "supported", "uncertain", "not_supported")


def confusion(y_true: Sequence[str], y_pred: Sequence[str], labels: Sequence[str] = STATUSES) -> np.ndarray:
    idx = {l: i for i, l in enumerate(labels)}
    m = np.zeros((len(labels), len(labels)), dtype=int)
    for t, p in zip(y_true, y_pred, strict=True):
        m[idx[t], idx[p]] += 1
    return m


def per_class(y_true, y_pred, labels=STATUSES) -> dict[str, dict[str, float]]:
    m = confusion(y_true, y_pred, labels)
    out = {}
    for i, l in enumerate(labels):
        tp = m[i, i]
        prec = tp / m[:, i].sum() if m[:, i].sum() else 0.0
        rec = tp / m[i, :].sum() if m[i, :].sum() else 0.0
        f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
        out[l] = {"precision": float(prec), "recall": float(rec), "f1": float(f1), "support": int(m[i, :].sum())}
    return out


def macro_f1(y_true, y_pred, labels=STATUSES) -> float:
    """Mean of per-class F1 over all four statuses (each class counts equally)."""
    return float(np.mean([v["f1"] for v in per_class(y_true, y_pred, labels).values()]))


def ece(confidence: Sequence[float], correct: Sequence[int], bins: int = 10) -> float:
    """Expected calibration error over equal-width credibility bins."""
    c = np.asarray(confidence, dtype=float)
    y = np.asarray(correct, dtype=float)
    edges = np.linspace(0, 1, bins + 1)
    total = 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        mask = (c >= lo) & ((c < hi) if hi < 1 else (c <= hi))
        if mask.any():
            total += mask.mean() * abs(y[mask].mean() - c[mask].mean())
    return float(total)


def brier(confidence: Sequence[float], correct: Sequence[int]) -> float:
    c = np.asarray(confidence, dtype=float)
    y = np.asarray(correct, dtype=float)
    return float(np.mean((c - y) ** 2))


def risk_coverage(uncertainty: Sequence[float], correct: Sequence[int]) -> list[tuple[float, float]]:
    """Sort from least to most uncertain; return (coverage, accuracy of the covered set)."""
    order = np.argsort(np.asarray(uncertainty, dtype=float), kind="stable")
    y = np.asarray(correct, dtype=float)[order]
    n = len(y)
    acc = np.cumsum(y) / np.arange(1, n + 1)
    return [(float((i + 1) / n), float(acc[i])) for i in range(n)]


def cohen_kappa(a: Sequence[str], b: Sequence[str]) -> float:
    labels = sorted(set(a) | set(b))
    m = confusion(a, b, labels).astype(float)
    n = m.sum()
    po = np.trace(m) / n
    pe = float((m.sum(0) * m.sum(1)).sum()) / (n * n)
    return float((po - pe) / (1 - pe)) if pe < 1 else 1.0


def mae_mape(pred: Sequence[float], truth: Sequence[float]) -> tuple[float, float]:
    p = np.asarray(pred, dtype=float)
    t = np.asarray(truth, dtype=float)
    return float(np.mean(np.abs(p - t))), float(100 * np.mean(np.abs(p - t) / t))


def kendall_tau(rank_a: Sequence[str], rank_b: Sequence[str]) -> float:
    common = [x for x in rank_a if x in set(rank_b)]
    if len(common) < 2:
        return float("nan")
    pos_b = {x: i for i, x in enumerate(rank_b)}
    return float(stats.kendalltau(range(len(common)), [pos_b[x] for x in common]).statistic)


def top_k_overlap(rank_a: Sequence[str], rank_b: Sequence[str], k: int) -> float:
    return len(set(rank_a[:k]) & set(rank_b[:k])) / k

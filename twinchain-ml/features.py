"""Features de Fase I para INFERENCIA (RF017: solo el historial propio del vendedor).

Es una copia textual de `base_features_from_weeks` y de las constantes de `training/features.py`, sin
pandas: el servicio no lo necesita y cargarlo agrega ~100 MB de memoria y segundos de arranque. Que las dos
versiones calculen lo mismo lo garantiza `tests/test_parity.py`; si se toca una, se toca la otra.
"""
import numpy as np

PHASE1_N_WEEKS = 4
OUTLIER_ABS_DAYS = 60


def base_features_from_weeks(margin_means, n_items):
    """Las 7 features de la guía a partir de las semanas de Fase I (margin_mean y n_items por semana)."""
    wm = np.asarray(margin_means, dtype=float)
    ni = np.asarray(n_items, dtype=float)
    return {
        "phase1_mean": wm.mean(),
        "phase1_std": wm.std(ddof=0),
        "phase1_min": wm.min(),
        "phase1_max": wm.max(),
        "phase1_mean_items_per_week": ni.mean(),
        "phase1_total_items": ni.sum(),
        "phase1_n_weeks": float(len(wm)),
    }

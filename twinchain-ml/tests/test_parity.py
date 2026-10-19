"""Las features de inferencia (sin pandas) deben calcular EXACTAMENTE lo mismo que las de entrenamiento."""
import importlib.util
from pathlib import Path

import numpy as np
import pytest

import features as inferencia

TRAINING = Path(__file__).parents[1] / "training" / "features.py"


@pytest.fixture(scope="module")
def entrenamiento():
    pytest.importorskip("pandas")
    spec = importlib.util.spec_from_file_location("training_features", TRAINING)
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


def test_constantes_iguales(entrenamiento):
    assert inferencia.PHASE1_N_WEEKS == entrenamiento.PHASE1_N_WEEKS
    assert inferencia.OUTLIER_ABS_DAYS == entrenamiento.OUTLIER_ABS_DAYS


def test_features_identicas_con_entradas_al_azar(entrenamiento):
    rng = np.random.RandomState(0)
    for _ in range(500):
        margen = rng.uniform(-30, 30, 4)
        items = rng.randint(1, 200, 4)
        a, b = inferencia.base_features_from_weeks(margen, items), entrenamiento.base_features_from_weeks(margen, items)
        assert a.keys() == b.keys()
        assert all(a[k] == b[k] for k in a)

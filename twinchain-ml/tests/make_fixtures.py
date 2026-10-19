"""Genera tests/fixtures/golden_sellers.json con vendedores REALES de Olist que el modelo nunca vio.

Se corre una sola vez, con el entorno de entrenamiento (necesita pandas y los CSV de Olist, que no se
versionan por tamaño):

    cd "~/Desktop/training model" && PYTHONPATH=. venv/bin/python <repo>/twinchain-ml/tests/make_fixtures.py

Las predicciones esperadas se calculan acá con el código ORIGINAL de entrenamiento y los modelos del bundle,
de forma independiente del servicio: si el servicio dice otra cosa, es el servicio el que está mal.
"""
import json
import sys
from pathlib import Path

import joblib
import numpy as np

import features as F  # el de entrenamiento (pandas), no el del servicio

OUT = Path(__file__).parent / "fixtures" / "golden_sellers.json"
BUNDLE = Path(__file__).parents[1] / "model" / "baseline_model_bundle_v2.joblib"
N_SELLERS = 24


def split(df, seed):  # idéntico al del notebook v2
    rng = np.random.RandomState(seed)
    idx = df.index.to_numpy().copy()
    rng.shuffle(idx)
    n = len(idx)
    a, b = int(n * 0.6), int(n * 0.2)
    return df.loc[idx[:a]].reset_index(drop=True), df.loc[idx[a:a + b]].reset_index(drop=True), df.loc[idx[a + b:]].reset_index(drop=True)


items = F.load_items("data")
feat, phase2 = F.build_seller_table(items)
weekly = F.weekly_from_items(items)
bundle = joblib.load(BUNDLE)
models, Q, QW, cols = bundle["quantile_models"], bundle["cqr_adjustment_Q_days"], bundle["cqr_adjustment_Q_weekly_days"], bundle["feature_columns"]

_, _, test = split(feat, 42)  # partición de test: vendedores que el modelo no vio al entrenar ni al calibrar
test = test[test["phase2_n_weeks"] >= 4].sample(N_SELLERS, random_state=7)

sellers = []
for sid in test["seller_id"]:
    g = weekly[weekly["seller_id"] == sid]
    f = F.base_features_from_weeks(g["margin_mean"].iloc[:4], g["n_items"].iloc[:4])
    x = np.array([[f[c] for c in cols]])
    lo, med, hi = (float(models[q].predict(x)[0]) for q in (0.1, 0.5, 0.9))
    sellers.append({
        "seller": sid[:8],
        "fase1": [{"margin_mean": float(m), "n_items": int(n)} for m, n in zip(g["margin_mean"].iloc[:4], g["n_items"].iloc[:4])],
        "fase2_margin_mean": [float(v) for v in phase2[sid]],
        "esperado": {
            "linea_base": med, "banda_inferior": lo - Q, "banda_superior": hi + Q,
            "banda_semanal_inferior": lo - QW, "banda_semanal_superior": hi + QW,
        },
    })

OUT.write_text(json.dumps({"bundle_sha256_origen": BUNDLE.with_suffix(".joblib.sha256").read_text().strip(), "sellers": sellers}, indent=1))
print(f"{len(sellers)} vendedores -> {OUT}")

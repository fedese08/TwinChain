"""Arma src/data/olist-vendedores.json: una muestra de vendedores REALES de Olist para la pantalla "Modelo".

Se corre con el entorno de entrenamiento (necesita pandas y los CSV de Olist, que no se versionan por tamaño):

    cd "~/Desktop/training model" && PYTHONPATH=. venv/bin/python <repo>/twinchain-ml/training/build_olist_sample.py

Solo entran vendedores de la partición de TEST (semilla 42): el modelo no los vio ni al entrenar ni al
calibrar, así que la pantalla no muestra al modelo prediciendo datos que memorizó.
"""
import json
from pathlib import Path

import numpy as np

import features as F

OUT = Path(__file__).parents[2] / "src" / "data" / "olist-vendedores.json"
MIN_WEEKS = 12      # 4 de Fase I + al menos 8 de Fase II
MAX_WEEKS = 30
MAX_SELLERS = 40
SEED_SPLIT, SEED_SAMPLE = 42, 11

items = F.load_items("data")
feat, _ = F.build_seller_table(items)
weekly = F.weekly_from_items(items)

rng = np.random.RandomState(SEED_SPLIT)  # misma partición que el notebook v2
idx = feat.index.to_numpy().copy()
rng.shuffle(idx)
n = len(idx)
a, b = int(n * 0.6), int(n * 0.2)
test_ids = set(feat.loc[idx[a + b:], "seller_id"])

by_seller = {sid: g for sid, g in weekly.groupby("seller_id") if sid in test_ids and len(g) >= MIN_WEEKS}
chosen = sorted(by_seller)
if len(chosen) > MAX_SELLERS:
    pick = np.random.RandomState(SEED_SAMPLE).choice(len(chosen), MAX_SELLERS, replace=False)
    chosen = sorted(chosen[i] for i in pick)

vendedores = []
for sid in chosen:
    g = by_seller[sid].iloc[:MAX_WEEKS]
    vendedores.append({
        "id": sid,
        "semanas": [
            {"inicio": r.week.date().isoformat(), "margen": round(float(r.margin_mean), 4), "items": int(r.n_items)}
            for r in g.itertuples()
        ],
    })

OUT.write_text(json.dumps({
    "meta": {
        "fuente": "Olist Brazilian E-Commerce Public Dataset (Kaggle)",
        "licencia": "CC BY-NC-SA 4.0",
        "unidad": "días de margen (margin_days = shipping_limit_date - order_delivered_carrier_date)",
        "particion": "test (semilla 42): vendedores que el modelo no vio al entrenar ni al calibrar",
        "criterio": f"al menos {MIN_WEEKS} semanas con actividad; hasta {MAX_WEEKS} semanas por vendedor",
        "muestra": f"{len(vendedores)} de {len([s for s in by_seller])} elegibles",
    },
    "vendedores": vendedores,
}, separators=(",", ":")))
print(f"{len(vendedores)} vendedores -> {OUT} ({OUT.stat().st_size / 1024:.0f} KB)")

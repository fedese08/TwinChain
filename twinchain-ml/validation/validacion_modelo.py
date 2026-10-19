"""Validación del modelo de línea base (bloques A y D de la devolución académica).

Reproduce el pipeline de la guía (Pasos 2-11) SIN depender de features.py ni del notebook, para que las
cifras sean verificables de forma independiente. No modifica ningún archivo del sistema; solo escribe CSVs en
scripts_validacion/resultados/.

Uso:  ./venv/bin/python scripts_validacion/validacion_modelo.py
"""
import os
import sys
import warnings

import joblib
import numpy as np
import pandas as pd
from scipy import stats
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LinearRegression, Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

warnings.filterwarnings("ignore")
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "scripts_validacion", "resultados")
os.makedirs(OUT, exist_ok=True)

FEATURE_COLS = [
    "phase1_mean", "phase1_std", "phase1_min", "phase1_max",
    "phase1_mean_items_per_week", "phase1_total_items", "phase1_n_weeks",
]
PHASE1_N_WEEKS, MIN_PHASE1_WEEKS, MIN_PHASE2_WEEKS = 4, 4, 2
HP = dict(n_estimators=150, max_depth=3, learning_rate=0.05, subsample=0.8)
SEEDS = [42, 1, 2, 3, 4, 5, 6, 7, 8, 9]  # 42 = semilla de referencia de la guía


def p(*a):
    print(*a, flush=True)


# --------------------------------------------------------------------------------------------
# Pasos 2-7 de la guía, parametrizados por el umbral de anomalía (Paso 4)
# --------------------------------------------------------------------------------------------
_orders = pd.read_csv(
    os.path.join(ROOT, "data/olist_orders_dataset.csv"),
    parse_dates=["order_purchase_timestamp", "order_approved_at", "order_delivered_carrier_date",
                 "order_delivered_customer_date", "order_estimated_delivery_date"],
)
_items = pd.read_csv(os.path.join(ROOT, "data/olist_order_items_dataset.csv"), parse_dates=["shipping_limit_date"])


def build_pipeline(threshold):
    delivered = _orders[(_orders["order_status"] == "delivered") & _orders["order_delivered_carrier_date"].notna()]
    merged = _items.merge(delivered[["order_id", "order_delivered_carrier_date"]], on="order_id", how="inner")
    merged["margin_days"] = (merged["shipping_limit_date"] - merged["order_delivered_carrier_date"]).dt.total_seconds() / 86400.0
    n_before = len(merged)
    if threshold is not None:
        merged = merged[merged["margin_days"].abs() <= threshold].copy()
    n_dropped = n_before - len(merged)

    merged["week"] = merged["order_delivered_carrier_date"].dt.to_period("W").dt.start_time
    weekly = merged.groupby(["seller_id", "week"])["margin_days"].agg(["mean", "count"]).reset_index()
    weekly.columns = ["seller_id", "week", "margin_mean", "n_items"]
    weekly = weekly.sort_values(["seller_id", "week"]).reset_index(drop=True)

    rows, short_p1, no_p2 = [], 0, 0
    for seller_id, g in weekly.groupby("seller_id"):
        g = g.sort_values("week").reset_index(drop=True)
        if len(g) < MIN_PHASE1_WEEKS:
            short_p1 += 1
            continue
        ph1, ph2 = g.iloc[:PHASE1_N_WEEKS], g.iloc[PHASE1_N_WEEKS:]
        if len(ph1) < MIN_PHASE1_WEEKS or len(ph2) < MIN_PHASE2_WEEKS:
            no_p2 += 1
            continue
        rows.append({
            "seller_id": seller_id,
            "phase1_mean": ph1["margin_mean"].mean(),
            "phase1_std": ph1["margin_mean"].std(ddof=0),
            "phase1_min": ph1["margin_mean"].min(),
            "phase1_max": ph1["margin_mean"].max(),
            "phase1_mean_items_per_week": ph1["n_items"].mean(),
            "phase1_total_items": ph1["n_items"].sum(),
            "phase1_n_weeks": len(ph1),
            "phase2_mean": ph2["margin_mean"].mean(),
            "phase2_n_weeks": len(ph2),
        })
    feat = pd.DataFrame(rows)
    feat["phase1_std"] = feat["phase1_std"].fillna(0.0)
    counts = {
        "umbral_abs_dias": threshold, "items_despachados_antes_del_filtro": n_before,
        "filas_descartadas_por_umbral": n_dropped, "vendedores_con_actividad": weekly["seller_id"].nunique(),
        "descartados_fase1_corta": short_p1, "descartados_sin_fase2": no_p2, "vendedores_usables": len(feat),
    }
    return feat, counts


def split(feat, seed):
    rng = np.random.RandomState(seed)
    idx = feat.index.to_numpy().copy()
    rng.shuffle(idx)
    n = len(idx)
    n_train, n_calib = int(n * 0.6), int(n * 0.2)
    return (feat.loc[idx[:n_train]].reset_index(drop=True),
            feat.loc[idx[n_train:n_train + n_calib]].reset_index(drop=True),
            feat.loc[idx[n_train + n_calib:]].reset_index(drop=True))


def fit_quantiles(train, seed):
    X, y = train[FEATURE_COLS].to_numpy(), train["phase2_mean"].to_numpy()
    return {q: GradientBoostingRegressor(loss="quantile", alpha=q, random_state=seed, **HP).fit(X, y) for q in (0.1, 0.5, 0.9)}


def conformal_Q(models, calib):
    X, y = calib[FEATURE_COLS].to_numpy(), calib["phase2_mean"].to_numpy()
    scores = np.maximum(models[0.1].predict(X) - y, y - models[0.9].predict(X))
    n = len(scores)
    return np.quantile(scores, min(np.ceil((n + 1) * 0.8) / n, 1.0), method="higher")


def evaluate(models, Q, test):
    X, y = test[FEATURE_COLS].to_numpy(), test["phase2_mean"].to_numpy()
    med, lo, hi = models[0.5].predict(X), models[0.1].predict(X), models[0.9].predict(X)
    return {
        "mae_modelo": np.mean(np.abs(y - med)),
        "mae_ingenuo": np.mean(np.abs(y - test["phase1_mean"].to_numpy())),
        "cobertura_sin_cqr": np.mean((y >= lo) & (y <= hi)),
        "cobertura_con_cqr": np.mean((y >= lo - Q) & (y <= hi + Q)),
        "Q": Q, "n_test": len(y),
    }


def mean_std(df):
    out = pd.DataFrame({"media": df.mean(numeric_only=True), "desvio_std(ddof=1)": df.std(numeric_only=True, ddof=1)})
    return out


# --------------------------------------------------------------------------------------------
p("=" * 100, "\nA1 — Cantidades del pipeline (umbral 60 días, como la guía)")
feat, c60 = build_pipeline(60)
tr, ca, te = split(feat, 42)
a1 = {**c60, "train": len(tr), "calibracion": len(ca), "test": len(te)}
for k, v in a1.items():
    p(f"  {k}: {v}")
pd.Series(a1).to_csv(os.path.join(OUT, "A1_cantidades_pipeline.csv"), header=["valor"])

# --------------------------------------------------------------------------------------------
p("=" * 100, "\nA2 — 10 semillas (la misma semilla fija partición y modelo)")
rows = []
splits = {}
for s in SEEDS:
    tr, ca, te = split(feat, s)
    splits[s] = (tr, ca, te)
    models = fit_quantiles(tr, s)
    Q = conformal_Q(models, ca)
    r = evaluate(models, Q, te)
    rows.append({"semilla": s, **r})
a2 = pd.DataFrame(rows)
a2.to_csv(os.path.join(OUT, "A2_diez_semillas.csv"), index=False)
p(a2.drop(columns="n_test").round(4).to_string(index=False))
ms = mean_std(a2.drop(columns=["semilla", "n_test"]))
ms.to_csv(os.path.join(OUT, "A2_media_desvio.csv"))
p("\n", ms.round(4).to_string())
n_test = int(a2["n_test"].iloc[0])
p(f"\n  Test binomial de cobertura con CQR vs 80% por semilla (n_test={n_test}):")
for _, r in a2.iterrows():
    pv = stats.binomtest(int(round(r["cobertura_con_cqr"] * n_test)), n_test, 0.8).pvalue
    pv_raw = stats.binomtest(int(round(r["cobertura_sin_cqr"] * n_test)), n_test, 0.8).pvalue
    p(f"    semilla {int(r['semilla']):>2}: con CQR {r['cobertura_con_cqr']:.3f} (p={pv:.3f}) | sin CQR {r['cobertura_sin_cqr']:.3f} (p={pv_raw:.4f})")

# --------------------------------------------------------------------------------------------
p("=" * 100, "\nA3 — ¿El bundle se entrenó con la partición de semilla 42 o con todos los datos?")
for name in ["baseline_model_bundle.joblib", "baseline_model_bundle_v2.joblib"]:
    b = joblib.load(os.path.join(ROOT, name))
    tr, ca, te = splits[42]
    X_all = feat[FEATURE_COLS].to_numpy()
    # candidatos: (a) entrenado solo con train de semilla 42; (b) entrenado con TODOS los vendedores usables
    cand_a = fit_quantiles(tr, 42)
    cand_b = fit_quantiles(feat, 42)
    pb = b["quantile_models"][0.5].predict(X_all)
    da = np.max(np.abs(pb - cand_a[0.5].predict(X_all)))
    db_ = np.max(np.abs(pb - cand_b[0.5].predict(X_all)))
    p(f"  {name}: claves={sorted(b.keys())[:6]}...")
    p(f"    max|pred_bundle - pred_train60%_seed42| = {da:.3e}   |   max|pred_bundle - pred_todos_los_datos| = {db_:.3e}")
    p(f"    Q del bundle = {b['cqr_adjustment_Q_days']:.6f}  | Q recalculado con calib seed42 = {conformal_Q(cand_a, ca):.6f}")
    p("    =>", "ENTRENADO CON EL 60% (seed 42)" if da < 1e-9 else ("ENTRENADO CON TODOS LOS DATOS" if db_ < 1e-9 else "no coincide con ninguno"))

# --------------------------------------------------------------------------------------------
p("=" * 100, "\nA4 — Comparación con otros algoritmos (MAE de la línea base en test, mismas 10 particiones)")
def zoo(seed):
    return {
        "GBR cuantil 0.5 (guía)": None,
        "Regresión lineal": make_pipeline(StandardScaler(), LinearRegression()),
        "Ridge (alpha=1)": make_pipeline(StandardScaler(), Ridge(alpha=1.0)),
        "Random Forest (300 árboles, hoja>=5)": RandomForestRegressor(n_estimators=300, min_samples_leaf=5, random_state=seed, n_jobs=-1),
        "GBR pérdida cuadrática (mismos HP)": GradientBoostingRegressor(random_state=seed, **HP),
    }
rows = []
for s in SEEDS:
    tr, ca, te = splits[s]
    Xtr, ytr, Xte, yte = tr[FEATURE_COLS].to_numpy(), tr["phase2_mean"].to_numpy(), te[FEATURE_COLS].to_numpy(), te["phase2_mean"].to_numpy()
    r = {"semilla": s}
    r["Ingenuo: media Fase I"] = np.mean(np.abs(yte - te["phase1_mean"]))
    r["Constante: mediana de Fase II en train"] = np.mean(np.abs(yte - np.median(ytr)))
    for name, m in zoo(s).items():
        if m is None:
            m = fit_quantiles(tr, s)[0.5]
        else:
            m.fit(Xtr, ytr)
        r[name] = np.mean(np.abs(yte - m.predict(Xte)))
    rows.append(r)
a4 = pd.DataFrame(rows)
a4.to_csv(os.path.join(OUT, "A4_comparacion_algoritmos.csv"), index=False)
t = mean_std(a4.drop(columns="semilla")).sort_values("media")
t.to_csv(os.path.join(OUT, "A4_media_desvio.csv"))
p(t.round(4).to_string())

# --------------------------------------------------------------------------------------------
p("=" * 100, "\nA5 — Sensibilidad al umbral de anomalías (30/45/60/90 y sin filtro), 10 semillas cada uno")
rows = []
for th in [30, 45, 60, 90, None]:
    f_, c = build_pipeline(th)
    res = []
    for s in SEEDS:
        tr_, ca_, te_ = split(f_, s)
        m = fit_quantiles(tr_, s)
        res.append(evaluate(m, conformal_Q(m, ca_), te_))
    r = pd.DataFrame(res)
    rows.append({
        "umbral": "sin filtro" if th is None else th, "filas_descartadas": c["filas_descartadas_por_umbral"],
        "vendedores_usables": c["vendedores_usables"],
        "mae_modelo": r["mae_modelo"].mean(), "mae_ingenuo": r["mae_ingenuo"].mean(),
        "cobertura_con_cqr": r["cobertura_con_cqr"].mean(), "Q": r["Q"].mean(),
    })
a5 = pd.DataFrame(rows)
a5.to_csv(os.path.join(OUT, "A5_sensibilidad_umbral.csv"), index=False)
p(a5.round(4).to_string(index=False))

# --------------------------------------------------------------------------------------------
p("=" * 100, "\nD1 — Permutation importance (modelo de la mediana, test, scoring MAE, n_repeats=30)")
rows = []
for s in SEEDS:
    tr, ca, te = splits[s]
    med = fit_quantiles(tr, s)[0.5]
    pi = permutation_importance(med, te[FEATURE_COLS].to_numpy(), te["phase2_mean"].to_numpy(),
                                scoring="neg_mean_absolute_error", n_repeats=30, random_state=s)
    for i, f in enumerate(FEATURE_COLS):
        rows.append({"semilla": s, "variable": f, "aumento_MAE_medio_dias": pi.importances_mean[i], "desvio_30_repeticiones": pi.importances_std[i]})
d1 = pd.DataFrame(rows)
d1.to_csv(os.path.join(OUT, "D1_permutation_importance_por_semilla.csv"), index=False)
g = d1.groupby("variable").agg(aumento_MAE_medio=("aumento_MAE_medio_dias", "mean"),
                               desvio_entre_semillas=("aumento_MAE_medio_dias", "std"),
                               semillas_con_importancia_positiva=("aumento_MAE_medio_dias", lambda x: int((x > 0).sum())))
g["ranking_medio"] = d1.assign(rk=d1.groupby("semilla")["aumento_MAE_medio_dias"].rank(ascending=False)).groupby("variable")["rk"].mean()
g = g.sort_values("aumento_MAE_medio", ascending=False)
g.to_csv(os.path.join(OUT, "D1_permutation_importance_resumen.csv"))
p(g.round(4).to_string())
try:
    import shap  # noqa: F401
    p("\n  shap DISPONIBLE")
except ImportError:
    p("\n  shap NO está instalado en el venv (no se instaló nada nuevo); SHAP no se calculó.")

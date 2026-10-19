"""Construcción de datos y features de Fase I (RF017: solo historial propio del vendedor).

Lo usan el notebook de entrenamiento, los experimentos y la API, para que el cálculo
de features sea idéntico en todos lados.
"""
import numpy as np
import pandas as pd

PHASE1_N_WEEKS = 4
MIN_PHASE1_WEEKS = 4
MIN_PHASE2_WEEKS = 2
OUTLIER_ABS_DAYS = 60

# Las 7 de la guía original (phase1_n_weeks es constante = 4; se conserva solo para comparar).
BASE_FEATURES = [
    'phase1_mean', 'phase1_std', 'phase1_min', 'phase1_max',
    'phase1_mean_items_per_week', 'phase1_total_items', 'phase1_n_weeks',
]

# Features extendidas: siguen siendo estadísticos de la Fase I propia del vendedor
# (desempeño y volumen). Nada de región, categoría, ni fecha/estacionalidad.
EXT_FEATURES = [
    # semanales (como la guía, sin la constante phase1_n_weeks)
    'phase1_mean', 'phase1_std', 'phase1_min', 'phase1_max', 'phase1_median',
    'phase1_mean_items_per_week', 'phase1_total_items',
    # tendencia dentro de la Fase I
    'phase1_last', 'phase1_slope',
    # nivel ítem (cada despacho individual de la Fase I)
    'phase1_item_mean', 'phase1_item_median', 'phase1_item_std',
    'phase1_item_p10', 'phase1_item_p90', 'phase1_frac_late', 'phase1_frac_lt1',
    # tiempo de preparación propio: aprobación -> entrega al transportista
    'phase1_prep_median',
]


def load_items(data_dir='data'):
    """Ítems despachados con margin_days, sin anomalías (pasos 2-4 de la guía)."""
    orders = pd.read_csv(
        f'{data_dir}/olist_orders_dataset.csv',
        parse_dates=['order_approved_at', 'order_delivered_carrier_date'],
    )
    items = pd.read_csv(
        f'{data_dir}/olist_order_items_dataset.csv', parse_dates=['shipping_limit_date'],
    )
    delivered = orders[
        (orders['order_status'] == 'delivered')
        & orders['order_delivered_carrier_date'].notna()
    ]
    merged = items.merge(
        delivered[['order_id', 'order_approved_at', 'order_delivered_carrier_date']],
        on='order_id', how='inner',
    )
    merged['margin_days'] = (
        merged['shipping_limit_date'] - merged['order_delivered_carrier_date']
    ).dt.total_seconds() / 86400.0
    merged['prep_days'] = (
        merged['order_delivered_carrier_date'] - merged['order_approved_at']
    ).dt.total_seconds() / 86400.0
    merged = merged[merged['margin_days'].abs() <= OUTLIER_ABS_DAYS].copy()
    merged['week'] = merged['order_delivered_carrier_date'].dt.to_period('W').dt.start_time
    return merged


def weekly_from_items(items):
    weekly = (
        items.groupby(['seller_id', 'week'])['margin_days']
        .agg(['mean', 'count']).reset_index()
    )
    weekly.columns = ['seller_id', 'week', 'margin_mean', 'n_items']
    return weekly.sort_values(['seller_id', 'week']).reset_index(drop=True)


def base_features_from_weeks(margin_means, n_items):
    """Las 7 features de la guía a partir de las semanas de Fase I (margin_mean y n_items por semana)."""
    wm = np.asarray(margin_means, dtype=float)
    ni = np.asarray(n_items, dtype=float)
    return {
        'phase1_mean': wm.mean(),
        'phase1_std': wm.std(ddof=0),
        'phase1_min': wm.min(),
        'phase1_max': wm.max(),
        'phase1_mean_items_per_week': ni.mean(),
        'phase1_total_items': ni.sum(),
        'phase1_n_weeks': float(len(wm)),
    }


def phase1_features(phase1_weekly, phase1_items):
    """Features a partir de las 4 semanas de Fase I (DataFrame semanal + sus ítems).

    phase1_weekly: columnas margin_mean, n_items (ordenado por semana).
    phase1_items:  columnas margin_days y, opcionalmente, prep_days.
    """
    wm = phase1_weekly['margin_mean'].to_numpy(dtype=float)
    ni = phase1_weekly['n_items'].to_numpy(dtype=float)
    m = phase1_items['margin_days'].to_numpy(dtype=float)
    prep = phase1_items['prep_days'].dropna().to_numpy(dtype=float) \
        if 'prep_days' in phase1_items else np.array([])
    return {
        'phase1_mean': wm.mean(),
        'phase1_std': wm.std(ddof=0),
        'phase1_min': wm.min(),
        'phase1_max': wm.max(),
        'phase1_median': np.median(wm),
        'phase1_mean_items_per_week': ni.mean(),
        'phase1_total_items': ni.sum(),
        'phase1_n_weeks': float(len(wm)),
        'phase1_last': wm[-1],
        'phase1_slope': np.polyfit(np.arange(len(wm)), wm, 1)[0] if len(wm) > 1 else 0.0,
        'phase1_item_mean': m.mean(),
        'phase1_item_median': np.median(m),
        'phase1_item_std': m.std(ddof=0),
        'phase1_item_p10': np.quantile(m, 0.1),
        'phase1_item_p90': np.quantile(m, 0.9),
        'phase1_frac_late': np.mean(m < 0),
        'phase1_frac_lt1': np.mean(m < 1),
        'phase1_prep_median': np.median(prep) if len(prep) else np.nan,
    }


def build_seller_table(items):
    """Una fila por vendedor usable (pasos 5-6): features de Fase I + target de Fase II.

    Devuelve (feat, phase2_weeks) donde phase2_weeks[seller_id] es el array de
    margin_mean semanales de su Fase II (para evaluar/calibrar la banda semanal).
    """
    weekly = weekly_from_items(items)
    items_by_seller = dict(tuple(items.groupby('seller_id')))
    rows, phase2_weeks = [], {}
    for seller_id, g in weekly.groupby('seller_id'):
        if len(g) < MIN_PHASE1_WEEKS + MIN_PHASE2_WEEKS:
            continue
        phase1, phase2 = g.iloc[:PHASE1_N_WEEKS], g.iloc[PHASE1_N_WEEKS:]
        it = items_by_seller[seller_id]
        it1 = it[it['week'].isin(phase1['week'])]
        row = {'seller_id': seller_id, **phase1_features(phase1, it1)}
        row['phase2_mean'] = phase2['margin_mean'].mean()
        row['phase2_n_weeks'] = len(phase2)
        row['phase1_end_week'] = phase1['week'].max()
        rows.append(row)
        phase2_weeks[seller_id] = phase2['margin_mean'].to_numpy()
    feat = pd.DataFrame(rows)
    feat['phase1_prep_median'] = feat['phase1_prep_median'].fillna(feat['phase1_prep_median'].median())
    return feat, phase2_weeks

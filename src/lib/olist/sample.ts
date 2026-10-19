// Muestra de vendedores REALES de Olist (src/data/olist-vendedores.json, generada con
// twinchain-ml/training/build_olist_sample.py). Solo vendedores del conjunto de TEST del modelo: no los vio
// ni al entrenar ni al calibrar. Unidad: días de `margin_days`.
import raw from "@/data/olist-vendedores.json";
import type { PoolSeller } from "@/lib/domain/vendedor/assign";
import type { RealWeek } from "@/lib/domain/vendedor/history";

export { PHASE1_WEEKS } from "@/lib/domain/vendedor/baseline";

export interface OlistWeek {
  /** Lunes de la semana calendario en que el vendedor tuvo actividad. */
  inicio: string;
  /** Promedio de margin_days de los ítems que despachó esa semana. */
  margen: number;
  items: number;
}

export interface OlistSeller {
  id: string;
  semanas: OlistWeek[];
}

export interface OlistSampleMeta {
  fuente: string;
  licencia: string;
  unidad: string;
  particion: string;
  criterio: string;
  muestra: string;
}


const sellers = raw.vendedores as OlistSeller[];
export const OLIST_META = raw.meta as OlistSampleMeta;

export const shortId = (id: string) => id.slice(0, 8);

export function getSeller(id: string): OlistSeller | undefined {
  return sellers.find((s) => s.id === id);
}

export interface SellerListItem {
  id: string;
  shortId: string;
  weeks: number;
}

export function listSellers(): SellerListItem[] {
  return sellers.map((s) => ({ id: s.id, shortId: shortId(s.id), weeks: s.semanas.length }));
}

/** El historial de un vendedor del pool en el formato del dominio, o `undefined` si no está. */
export function getSellerWeeks(id: string): RealWeek[] | undefined {
  return getSeller(id)?.semanas.map((w) => ({ margen: w.margen, items: w.items }));
}

/** Los vendedores del pool y cuántas semanas tiene cada uno, para asignarlos a nodos. */
export function poolSellers(): PoolSeller[] {
  return sellers.map((s) => ({ id: s.id, weeks: s.semanas.length }));
}

import { hashSeed } from "@/lib/domain/rng";

export interface PoolSeller {
  id: string;
  /** Semanas con actividad que tiene el vendedor en el pool. */
  weeks: number;
}

/**
 * Asigna a cada nodo Vendedor un vendedor real del pool. Es determinístico (función del id del nodo) y evita
 * repetir un vendedor dentro de la misma cadena (`used`) mientras queden libres; si se agotan, se repite en vez
 * de fallar. Solo entran vendedores con al menos `minWeeks` semanas, para poder cargar el historial completo.
 */
export function assignSellers(nodeIds: string[], pool: PoolSeller[], used: ReadonlySet<string>, minWeeks: number): Map<string, string> {
  const eligible = pool.filter((s) => s.weeks >= minWeeks).map((s) => s.id).sort();
  if (eligible.length === 0) throw new RangeError(`No hay vendedores con al menos ${minWeeks} semanas en el pool`);

  const taken = new Set(used);
  const assignment = new Map<string, string>();
  for (const nodeId of nodeIds) {
    const start = hashSeed(`seller:${nodeId}`) % eligible.length;
    let chosen = eligible[start]; // si no queda ninguno libre, se repite el que le tocaba
    for (let i = 0; i < eligible.length; i++) {
      const candidate = eligible[(start + i) % eligible.length];
      if (!taken.has(candidate)) {
        chosen = candidate;
        break;
      }
    }
    taken.add(chosen);
    assignment.set(nodeId, chosen);
  }
  return assignment;
}

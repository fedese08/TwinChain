// Mide cómo se comporta el modelo de ML y el CUSUM sobre los nodos con sensor simulado, donde la línea base verdadera SÍ
// se conoce (es el nivel del perfil):
//   - ¿acierta la línea base? (error, sesgo, cobertura de la banda del promedio sobre las semanas normales);
//   - ¿cuántas falsas alarmas da el CUSUM y cuánto tarda en detectar una caída, según la sensibilidad elegida (f)?
//
// Uso (con el servicio de ML andando):
//   ML_SERVICE_URL=http://127.0.0.1:8001 ML_API_KEY=... npx tsx scripts/measure-sensor-model.ts [nodosPorTipo]
import { randomUUID } from "node:crypto";
import { thresholdForCost, FALSE_ALARM_COST_CHOICES } from "../src/lib/domain/cusum-config";
import { runCusum } from "../src/lib/domain/degradation";
import { historyWeekStarts, sensorPhase1, sensorWeeks } from "../src/lib/domain/synthetic";
import { profileForNode } from "../src/lib/domain/synthetic/node-profiles";
import type { NodeType } from "../src/lib/domain/types";
import { baselineFromModel } from "../src/lib/domain/vendedor/baseline";
import { mlClient } from "../src/lib/ml-client";

const TYPES: NodeType[] = ["Proveedor", "Fabrica", "Almacen", "Vendedor", "Cliente"];
const perType = Number(process.argv[2] ?? 120);
const weekStarts = historyWeekStarts("2026-10-12");
const DROPS = [1, 2, 3]; // en márgenes de la línea base
const EPISODE_START = 12; // semanas de monitoreo normal antes de inyectar la caída

const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
const median = (x: number[]) => [...x].sort((a, b) => a - b)[Math.floor(x.length / 2)];
const pct = (n: number, d: number) => `${((100 * n) / d).toFixed(1)} %`;

async function main() {
  const rows: { type: NodeType; level: number; naive: number; baseline: number; lower: number; upper: number; values: number[] }[] = [];
  for (const type of TYPES) {
    for (let i = 0; i < perType; i++) {
      const id = randomUUID();
      const phase1 = sensorPhase1({ id, type }, weekStarts);
      const b = baselineFromModel(await mlClient.predict({ phase1: phase1.map((w) => ({ margin_mean: w.margen, n_items: w.items })) }));
      const values = sensorWeeks({ nodeId: id, nodeType: type, weekStarts }).map((w) => w.actualValue);
      rows.push({ type, level: profileForNode(id, type, "dias").level, naive: mean(phase1.map((w) => w.margen)), baseline: b.baseline, lower: b.lower, upper: b.upper, values });
    }
  }

  console.log(`Nodos por tipo: ${perType}. Historial de ${weekStarts.length} semanas; monitoreo = semanas 5 a ${weekStarts.length}, sin incidentes.\n`);
  console.log("Línea base del modelo");
  console.log("tipo       | error modelo | error ingenuo | sesgo | semanas dentro de la banda del promedio");
  for (const key of [...TYPES, "todos"] as const) {
    const group = rows.filter((r) => key === "todos" || r.type === key);
    const inside = group.flatMap((r) => r.values.slice(4).map((v) => v >= r.lower && v <= r.upper));
    console.log(
      `${key.padEnd(10)} | ${mean(group.map((r) => Math.abs(r.baseline - r.level))).toFixed(2).padStart(9)} d | ${mean(group.map((r) => Math.abs(r.naive - r.level))).toFixed(2).padStart(10)} d | ${mean(group.map((r) => r.baseline - r.level)).toFixed(2).padStart(5)} | ${pct(inside.filter(Boolean).length, inside.length)}`,
    );
  }

  console.log("\nCUSUM según la sensibilidad (costo de una falsa alarma f; umbral h en múltiplos del margen)");
  console.log("f | h*   | falsas alarmas / 26 sem | demora mediana y % detectado, caída de 1 | 2 | 3 márgenes");
  for (const f of FALSE_ALARM_COST_CHOICES) {
    const h = thresholdForCost(f);
    let confirmations = 0;
    let exposure = 0;
    const delays: Record<number, number[]> = { 1: [], 2: [], 3: [] };
    for (const r of rows) {
      const margin = Math.max(r.baseline - r.lower, 0.05);
      const make = (drop: number) =>
        r.values.slice(4).map((v, k) => ({ weekStart: weekStarts[k + 4], actualValue: k >= EPISODE_START ? v - drop * margin : v, baseline: r.baseline, baselineLowerBand: r.lower }));
      const clean = make(0);
      confirmations += runCusum(clean, h).episodes.length;
      exposure += clean.length;
      for (const drop of DROPS) {
        const injected = make(drop);
        const first = runCusum(injected, h).episodes.find((e) => injected.findIndex((x) => x.weekStart === e.confirmedWeek) >= EPISODE_START);
        if (first) delays[drop].push(injected.findIndex((x) => x.weekStart === first.confirmedWeek) - EPISODE_START + 1);
      }
    }
    const cell = (d: number[]) => `${d.length ? median(d) : "—"} sem (${pct(d.length, rows.length)})`;
    console.log(`${f} | ${h.toFixed(2).padStart(4)} | ${((confirmations / exposure) * 26).toFixed(2).padStart(23)} | ${cell(delays[1])} | ${cell(delays[2])} | ${cell(delays[3])}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

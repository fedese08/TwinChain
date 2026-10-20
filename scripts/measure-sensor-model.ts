// Mide cómo se comporta el modelo de ML sobre los nodos con sensor simulado: ¿acierta la línea base verdadera
// (el nivel del perfil, que acá SÍ se conoce), cubre la banda, y cuántas falsas alarmas da la regla de la banda semanal?
//
// Uso (con el servicio de ML andando):
//   ML_SERVICE_URL=http://127.0.0.1:8001 ML_API_KEY=... npx tsx scripts/measure-sensor-model.ts [nodosPorTipo]
import { randomUUID } from "node:crypto";
import { generateSeries, historyWeekStarts, sensorPhase1 } from "../src/lib/domain/synthetic";
import { profileForNode } from "../src/lib/domain/synthetic/node-profiles";
import type { NodeType } from "../src/lib/domain/types";
import { BAND_ATTENTION_COUNT, BAND_CRITICAL_COUNT } from "../src/lib/domain/monitoring";
import { mlClient } from "../src/lib/ml-client";

const TYPES: NodeType[] = ["Proveedor", "Fabrica", "Almacen", "Vendedor", "Cliente"];
const perType = Number(process.argv[2] ?? 120);
const weekStarts = historyWeekStarts("2026-10-12");

const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
const pct = (n: number, d: number) => `${((100 * n) / d).toFixed(1)} %`;

async function main() {
  const acc = new Map<NodeType | "todos", { n: number; errModel: number; errNaive: number; bias: number; covered: number; weeks: number; below: number; windows: number; attention: number; critical: number; lvlShrink: number[]; avgIn: number; weeklyIn: number }>();
  const get = (k: NodeType | "todos") => {
    if (!acc.has(k)) acc.set(k, { n: 0, errModel: 0, errNaive: 0, bias: 0, covered: 0, weeks: 0, below: 0, windows: 0, attention: 0, critical: 0, lvlShrink: [], avgIn: 0, weeklyIn: 0 });
    return acc.get(k)!;
  };

  for (const type of TYPES) {
    for (let i = 0; i < perType; i++) {
      const id = randomUUID();
      const phase1 = sensorPhase1({ id, type }, weekStarts);
      const prediction = await mlClient.predict({ phase1: phase1.map((w) => ({ margin_mean: w.margen, n_items: w.items })) });
      const level = profileForNode(id, type, "dias").level;
      const values = generateSeries({ nodeId: id, nodeType: type, weekStarts, unit: "dias" });
      const naive = mean(phase1.map((w) => w.margen));
      for (const key of [type, "todos"] as const) {
        const a = get(key);
        a.n++;
        a.errModel += Math.abs(prediction.linea_base - level);
        a.errNaive += Math.abs(naive - level);
        a.bias += prediction.linea_base - level;
        if (level >= prediction.banda_inferior && level <= prediction.banda_superior) a.covered++;
        // Monitoreo: de la semana 5 en adelante, estable (sin incidentes inyectados).
        const flags = values.map((v, w) => w >= 4 && v < prediction.banda_semanal_inferior);
        for (let w = 4; w < values.length; w++) {
          if (values[w] >= prediction.banda_inferior && values[w] <= prediction.banda_superior) a.avgIn++;
          if (values[w] >= prediction.banda_semanal_inferior && values[w] <= prediction.banda_semanal_superior) a.weeklyIn++;
        }
        for (let w = 4; w < values.length; w++) {
          a.weeks++;
          if (flags[w]) a.below++;
          if (w >= 6) {
            a.windows++;
            const k = [flags[w], flags[w - 1], flags[w - 2]].filter(Boolean).length;
            if (k >= BAND_ATTENTION_COUNT) a.attention++;
            if (k >= BAND_CRITICAL_COUNT) a.critical++;
          }
        }
      }
    }
  }

  // Potencia: una caída sostenida de `drop` días desde la semana 25. ¿Cuántos nodos llegan a "atención" / "crítico"
  // dentro de las 8 semanas siguientes con la regla de la banda semanal?
  const drops = [1, 2, 3, 4];
  const power = new Map(drops.map((d) => [d, { n: 0, attention: 0, critical: 0 }]));
  for (const type of TYPES) {
    for (let i = 0; i < Math.min(perType, 60); i++) {
      const id = randomUUID();
      const phase1 = sensorPhase1({ id, type }, weekStarts);
      const prediction = await mlClient.predict({ phase1: phase1.map((w) => ({ margin_mean: w.margen, n_items: w.items })) });
      const values = generateSeries({ nodeId: id, nodeType: type, weekStarts, unit: "dias" });
      for (const drop of drops) {
        const shifted = values.map((v, w) => (w >= 24 ? v - drop : v));
        let attention = false;
        let critical = false;
        for (let w = 24; w < shifted.length; w++) {
          const k = [w, w - 1, w - 2].filter((x) => shifted[x] < prediction.banda_semanal_inferior).length;
          if (k >= BAND_ATTENTION_COUNT) attention = true;
          if (k >= BAND_CRITICAL_COUNT) critical = true;
        }
        const cell = power.get(drop)!;
        cell.n++;
        if (attention) cell.attention++;
        if (critical) cell.critical++;
      }
    }
  }

  console.log(`Nodos por tipo: ${perType}. Historial de ${weekStarts.length} semanas; monitoreo = semanas 5 a ${weekStarts.length}, sin incidentes.\n`);
  console.log("tipo       | MAE modelo | MAE ingenuo | sesgo  | banda cubre nivel | semana < banda | atención | crítico");
  for (const key of [...TYPES, "todos"] as const) {
    const a = acc.get(key)!;
    console.log(
      `${key.padEnd(10)} | ${(a.errModel / a.n).toFixed(2).padStart(8)} d | ${(a.errNaive / a.n).toFixed(2).padStart(9)} d | ${(a.bias / a.n).toFixed(2).padStart(5)} | ${pct(a.covered, a.n).padStart(17)} | ${pct(a.below, a.weeks).padStart(14)} | ${pct(a.attention, a.windows).padStart(8)} | ${pct(a.critical, a.windows).padStart(7)}`,
    );
  }
  console.log("\nCobertura de las bandas sobre semanas normales (semanas 5 a 28, no vistas por el modelo):");
  console.log("tipo       | banda del promedio | banda semanal   (nominal 80 %)");
  for (const key of [...TYPES, "todos"] as const) {
    const a = acc.get(key)!;
    console.log(`${key.padEnd(10)} | ${pct(a.avgIn, a.weeks).padStart(18)} | ${pct(a.weeklyIn, a.weeks).padStart(14)}`);
  }
  console.log("\nDetección de una caída sostenida (desde la semana 25, 4 semanas de margen para reaccionar):");
  console.log("caída    | llega a atención | llega a crítico");
  for (const [drop, c] of power) console.log(`-${drop} días  | ${pct(c.attention, c.n).padStart(16)} | ${pct(c.critical, c.n).padStart(15)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

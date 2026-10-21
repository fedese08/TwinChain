// Calibración del umbral del CUSUM (RF019, RF020): un paso APARTE del entrenamiento, sobre el modelo ya entrenado.
//
//   ML_SERVICE_URL=http://127.0.0.1:8001 ML_API_KEY=... npx tsx scripts/calibrate-cusum.ts
//
// De dónde salen los episodios de degradación con los que se calibra: se INYECTAN sobre series REALES de vendedores de
// Olist que el modelo no vio ni al entrenar ni al calibrar. Para cada vendedor con historia suficiente:
//   1. el modelo estima su línea base y su banda con sus 4 primeras semanas con actividad (fase I);
//   2. el tramo normal son las semanas siguientes, salvo las últimas EPISODE_WEEKS: se supone sin degradación sostenida,
//      así que toda confirmación ahí cuenta como falsa alarma (supuesto conservador: las series reales tienen sus
//      propios cambios de nivel);
//   3. el episodio son las últimas EPISODE_WEEKS semanas con una caída inyectada de 1, 2 o 3 márgenes de la línea base.
// Con eso se evalúa cada umbral h y se calcula h*(f) = argmin C(h) = retardo + f · falsas alarmas (ver
// src/lib/domain/cusum-calibration.ts). No se calibra por una tasa objetivo de falsas alarmas.
//
// Escribe src/data/cusum-calibracion.json, que usa la app para fijar el umbral según el costo f de una falsa alarma.
import { writeFileSync } from "node:fs";
import path from "node:path";
import { evaluateThresholds, thresholdByCost, type CalibrationTrial } from "../src/lib/domain/cusum-calibration";
import type { CusumRow } from "../src/lib/domain/degradation";
import { baselineFromModel, PHASE1_WEEKS } from "../src/lib/domain/vendedor/baseline";
import { mlClient } from "../src/lib/ml-client";
import { getSeller } from "../src/lib/olist/sample";
import { addWeeksIso } from "../src/lib/domain/synthetic/weeks";
import { poolSellers } from "../src/lib/olist/sample";

const EPISODE_WEEKS = 12;
const MIN_CLEAN_WEEKS = 12;
const DROP_MARGINS = [1, 2, 3];
// 0,25 a 6 de a 0,25 (donde se mueve h* para f entre 0 y k) y de ahí hasta 25 de a 0,5.
const H_GRID = [...Array.from({ length: 24 }, (_, i) => 0.25 + i * 0.25), ...Array.from({ length: 39 }, (_, i) => 6.5 + i * 0.5)];
const F_GRID = [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 5, 8, 13, 21, 34, 55, 89];
const ANCHOR = "2017-01-02"; // lunes: las semanas con actividad se numeran de corrido; solo importa el orden

async function main() {
  const health = await mlClient.health();
  const trials: CalibrationTrial[] = [];
  let sellersUsed = 0;

  for (const { id, weeks } of poolSellers()) {
    if (weeks < PHASE1_WEEKS + MIN_CLEAN_WEEKS + EPISODE_WEEKS) continue;
    const seller = getSeller(id)!;
    const phase1 = seller.semanas.slice(0, PHASE1_WEEKS);
    const prediction = await mlClient.predict({ phase1: phase1.map((w) => ({ margin_mean: w.margen, n_items: w.items })) });
    const baseline = baselineFromModel(prediction);
    const margin = Math.max(baseline.baseline - baseline.lower, 0.05);

    const after = seller.semanas.slice(PHASE1_WEEKS);
    const cleanWeeks = after.length - EPISODE_WEEKS;
    sellersUsed++;
    for (const drop of DROP_MARGINS) {
      const rows: CusumRow[] = after.map((w, i) => ({
        weekStart: addWeeksIso(ANCHOR, i),
        actualValue: w.margen - (i >= cleanWeeks ? drop * margin : 0),
        baseline: baseline.baseline,
        baselineLowerBand: baseline.lower,
      }));
      trials.push({ rows, episodeStart: cleanWeeks, episodeWeeks: EPISODE_WEEKS });
    }
  }

  const points = evaluateThresholds(trials, H_GRID);
  const { table, fStable } = thresholdByCost(points, F_GRID);

  const output = {
    meta: {
      fecha: new Date().toISOString().slice(0, 10),
      modelo: { version: health.version, sha256: health.bundle_sha256 },
      fuente: "Vendedores reales de Olist (partición de test del modelo), episodios inyectados",
      vendedores: sellersUsed,
      ensayos: trials.length,
      semanasEpisodio: EPISODE_WEEKS,
      semanasNormalesMinimas: MIN_CLEAN_WEEKS,
      caidasEnMargenes: DROP_MARGINS,
      unidadUmbral: "múltiplos del margen de la línea base (h · K, con K = línea base − límite inferior de la banda)",
      unidadFalsasAlarmas: "confirmaciones por cada 26 semanas de operación normal",
      fStable,
    },
    table: table.map((r) => ({ f: r.f, h: r.h, retardo: round(r.delay), falsasAlarmas: round(r.falseAlarms), detectados: round(r.detected), costo: round(r.cost) })),
    curve: points.map((p) => ({ h: p.h, retardo: round(p.delay), falsasAlarmas: round(p.falseAlarms), detectados: round(p.detected) })),
  };
  const file = path.join(process.cwd(), "src", "data", "cusum-calibracion.json");
  writeFileSync(file, JSON.stringify(output, null, 2) + "\n");

  console.log(`Vendedores: ${sellersUsed} · ensayos: ${trials.length} · modelo ${health.version} (${health.bundle_sha256.slice(0, 12)}…)`);
  console.log("\n   f |  h* | retardo (sem) | falsas alarmas / 26 sem | detectados | costo");
  for (const r of output.table) {
    console.log(`${String(r.f).padStart(4)} | ${String(r.h).padStart(4)} | ${String(r.retardo).padStart(13)} | ${String(r.falsasAlarmas).padStart(23)} | ${String(r.detectados).padStart(10)} | ${r.costo}`);
  }
  console.log(`\nh* deja de moverse a partir de f = ${fStable ?? "(no se estabiliza en la grilla)"}`);
  console.log(`Escrito: ${file}`);
}

const round = (v: number) => Math.round(v * 1000) / 1000;

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

export const mean = (values: number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length;

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Desvío estándar muestral (n − 1). */
export function stdDev(values: number[]): number {
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1));
}

/** Media recortada: descarta la fracción `trim` más baja y más alta antes de promediar. */
export function trimmedMean(values: number[], trim: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const cut = Math.floor(sorted.length * trim);
  return mean(sorted.slice(cut, sorted.length - cut));
}

/** Cuantil 0,95 de la t de Student (intervalo bilateral del 90 %), grados de libertad 1 a 30. */
const T_95 = [
  6.314, 2.92, 2.353, 2.132, 2.015, 1.943, 1.895, 1.86, 1.833, 1.812, 1.796, 1.782, 1.771, 1.761, 1.753, 1.746, 1.74,
  1.734, 1.729, 1.725, 1.721, 1.717, 1.714, 1.711, 1.708, 1.706, 1.703, 1.701, 1.699, 1.697,
];

export function tCritical90(degreesOfFreedom: number): number {
  if (degreesOfFreedom < 1) throw new RangeError("Hacen falta al menos 2 observaciones");
  return degreesOfFreedom <= T_95.length ? T_95[degreesOfFreedom - 1] : 1.645;
}

/** Normal estándar por Box–Muller a partir de dos uniformes en (0, 1). */
export function gaussian(u1: number, u2: number): number {
  return Math.sqrt(-2 * Math.log(Math.max(u1, Number.EPSILON))) * Math.cos(2 * Math.PI * u2);
}

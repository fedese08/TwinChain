// Parámetros de la ingesta sintética (RF009). Todo lo que se pueda querer ajustar vive acá.

/** Semanas de historial que se generan al cargar un nodo. */
export const HISTORY_WEEKS = 28;

/**
 * Semanas iniciales con las que se estima la línea base y se valida la estabilidad (C24). Las
 * semanas restantes son de monitoreo: ahí la línea base ya está congelada.
 *
 * 24 y no menos: con 16 semanas no se puede tener a la vez una tasa baja de falsas alarmas y
 * detectar un cambio de nivel (simulación de Monte Carlo, ver cusum.test.ts). Es un límite
 * estadístico de la ventana, no del detector.
 */
export const TRAINING_WEEKS = 24;

/** Mínimo de semanas para estimar una línea base con sentido. */
export const MIN_BASELINE_WEEKS = 8;

/** Semanas de arranque que se descartan para que el proceso AR(1) llegue a su régimen estacionario. */
export const BURN_IN_WEEKS = 8;

/** Tope de semanas que se pueden avanzar en una sola llamada del monitoreo vivo. */
export const MAX_ADVANCE_WEEKS = 8;

/**
 * Tope de semanas guardadas por nodo (historial + avance). Cada avance suma una fila por nodo y el
 * snapshot las carga todas, así que sin tope la tabla crece sin límite. "Reiniciar" vuelve al historial
 * original (y como la serie es determinista, repetir el avance da exactamente lo mismo).
 */
export const MAX_WEEKS_PER_NODE = 156;

/** Tamaño del cambio de nivel que inyecta el interruptor "historial con cambio estructural", en σ del nodo. */
export const LEVEL_SHIFT_SIGMAS = -4;

/** Fracción de los nodos que sufre el cambio de nivel (al menos uno). */
export const LEVEL_SHIFT_NODE_FRACTION = 0.3;

/** Dónde ocurre el cambio de nivel, como fracción de la ventana de entrenamiento. */
export const LEVEL_SHIFT_AT_FRACTION = 0.6;

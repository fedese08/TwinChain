// Estado de una corrida en segundo plano que se puede consultar sin traer el motor (lo usa también el snapshot).

/** Una corrida `corriendo` más vieja que esto se da por perdida (la función murió antes de terminarla): `maxDuration` es 300 s. */
export const RUN_STALE_MS = 6 * 60 * 1000;

export const isStale = (createdAt: Date | string, now = Date.now()) => now - new Date(createdAt).getTime() > RUN_STALE_MS;

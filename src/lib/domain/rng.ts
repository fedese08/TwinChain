// Generador pseudoaleatorio determinístico (mulberry32) para que los datos mock
// sean reproducibles entre recargas — importa para poder discutir resultados en la defensa.
export function createRng(seed: number) {
  let state = seed >>> 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deriva una semilla numérica estable a partir de un id (FNV-1a). Permite que una corrida
 * guardada se pueda volver a reproducir exactamente a partir de su propio id — RF030 exige
 * conservar cada corrida, y conservarla sin poder repetirla no sirve para defenderla.
 */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

"use client";

import { useEffect } from "react";
import { useMockDbStore } from "@/stores/mock-db-store";

/**
 * Rehidrata el store del mock desde sessionStorage al montar.
 *
 * No se hidrata durante el render porque el servidor no tiene sessionStorage: si el estado
 * persistido se leyera en el render inicial, el HTML del servidor no coincidiría con el del
 * cliente. Por eso el store usa `skipHydration` y la rehidratación se dispara acá, en un efecto.
 */
export function StoreHydration() {
  useEffect(() => {
    void useMockDbStore.persist.rehydrate();
  }, []);

  return null;
}

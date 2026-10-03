"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { AppSnapshot } from "@/lib/data/snapshot-types";
import { useAppStore } from "@/stores/app-store";

/**
 * Carga en el store lo que el servidor leyó de la base y recién entonces muestra la app.
 *
 * Se hace en un efecto y NO durante el render a propósito: el store es un módulo global, y en el
 * servidor un módulo global se comparte entre requests. Escribirle datos de un usuario en pleno
 * render de servidor podría filtrárselos a otro. En el cliente no hay ese riesgo (una pestaña,
 * un usuario). Por eso los hijos no se pintan hasta la primera sincronización.
 *
 * Cuando el servidor vuelve a mandar un snapshot (recarga completa o `router.refresh()`), se
 * re-sincroniza sin desmontar nada.
 */
export function StoreSync({ snapshot, children }: { snapshot: AppSnapshot; children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    useAppStore.getState().hydrate(snapshot);
    setReady(true);
  }, [snapshot]);

  return ready ? <>{children}</> : null;
}

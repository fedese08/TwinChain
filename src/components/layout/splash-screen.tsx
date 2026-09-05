"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

/** Cuánto se muestra la marca antes de empezar a desvanecerse. */
const HOLD_MS = 950;
/** Duración del fundido de salida — tiene que coincidir con la clase `duration-*` de abajo. */
const FADE_MS = 400;

/**
 * Pantalla de carga inicial: logo y nombre centrados mientras arranca la app.
 *
 * Se monta desde AppShell, que vive en el layout raíz. En el App Router ese layout **no se
 * vuelve a montar** al navegar entre páginas del cliente, así que este componente corre una
 * sola vez por carga real de documento — justo lo que se busca: aparece al abrir o refrescar,
 * y no al moverse por el menú.
 *
 * Se renderiza visible también en el servidor, para que el HTML inicial ya traiga el splash y
 * no se vea un destello de la app antes de que hidrate.
 */
export function SplashScreen() {
  const [leaving, setLeaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const toFade = setTimeout(() => setLeaving(true), HOLD_MS);
    const toRemove = setTimeout(() => setDone(true), HOLD_MS + FADE_MS);
    return () => {
      clearTimeout(toFade);
      clearTimeout(toRemove);
    };
  }, []);

  if (done) return null;

  return (
    <div
      // `aria-hidden` + sin foco: es decorativa, no debe interceptar lectores de pantalla ni
      // el tabulado. `pointer-events-none` mientras se va, para no bloquear clicks al final.
      aria-hidden
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-background transition-opacity duration-[400ms] ${
        leaving ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      <Image
        src="/logo.png"
        alt=""
        width={116}
        height={116}
        priority
        className="splash-logo h-[116px] w-[116px]"
      />

      <div className="splash-text flex flex-col items-center gap-3.5">
        {/* Mismo logotipo que la barra lateral: Sora, con el acento en "Chain". */}
        <span className="font-display text-[34px] leading-none tracking-tight">
          <span className="font-semibold text-foreground/60">Twin</span>
          <span className="font-bold text-foreground">Chain</span>
        </span>

        {/* Barra indeterminada — el gesto que lo hace leer como pantalla de carga. */}
        <div className="h-[3px] w-[132px] overflow-hidden rounded-full bg-border">
          <div className="splash-sweep h-full w-[45%] rounded-full bg-primary" />
        </div>
      </div>
    </div>
  );
}

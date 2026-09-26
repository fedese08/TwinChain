"use client";

import { useEffect, useState } from "react";
import { NODE_TYPE_COLOR, SEVERITY_COLOR } from "@/lib/mock/node-visuals";

type NodeType = "Proveedor" | "Fabrica" | "Almacen" | "Vendedor" | "Cliente";
type Severity = keyof typeof SEVERITY_COLOR;

const CARD_W = 104;
const CARD_H = 40;

const NODES = [
  { id: "p1", x: 90, y: 110, type: "Proveedor", label: "Proveedor" },
  { id: "p2", x: 90, y: 250, type: "Proveedor", label: "Proveedor" },
  { id: "f1", x: 260, y: 180, type: "Fabrica", label: "Fábrica" },
  { id: "a1", x: 430, y: 100, type: "Almacen", label: "Almacén" },
  { id: "a2", x: 430, y: 260, type: "Almacen", label: "Almacén" },
  { id: "v1", x: 590, y: 180, type: "Vendedor", label: "Vendedor" },
  { id: "c1", x: 750, y: 110, type: "Cliente", label: "Cliente" },
  { id: "c2", x: 750, y: 250, type: "Cliente", label: "Cliente" },
] satisfies { id: string; x: number; y: number; type: NodeType; label: string }[];

const EDGES: [string, string][] = [
  ["p1", "f1"],
  ["p2", "f1"],
  ["f1", "a1"],
  ["f1", "a2"],
  ["a1", "v1"],
  ["a2", "v1"],
  ["v1", "c1"],
  ["v1", "c2"],
];

/**
 * Cada frame acumula: un nodo ya afectado queda en rojo para siempre (no vuelve a bajar a
 * amarillo), y el amarillo marca únicamente al próximo tramo que está por recibir el golpe — así
 * se lee de un vistazo qué ya pasó y qué está por pasar. Misma idea que `spreadEvents` en
 * simulate.ts: el evento nace en un nodo y avanza aguas abajo por las aristas.
 */
const FRAMES: { hit: string[]; next: string[]; caption: string; holdMs: number }[] = [
  { hit: [], next: [], caption: "Tu cadena, funcionando normal", holdMs: 2400 },
  { hit: ["p1"], next: ["f1"], caption: "Se corta el suministro en un proveedor", holdMs: 1300 },
  { hit: ["p1", "f1"], next: ["a1", "a2"], caption: "El impacto llega a la fábrica", holdMs: 1300 },
  {
    hit: ["p1", "f1", "a1", "a2"],
    next: ["v1"],
    caption: "Sigue camino a los almacenes",
    holdMs: 1300,
  },
  {
    hit: ["p1", "f1", "a1", "a2", "v1"],
    next: ["c1", "c2"],
    caption: "Y afecta al vendedor",
    holdMs: 1300,
  },
  {
    hit: ["p1", "f1", "a1", "a2", "v1", "c1", "c2"],
    next: [],
    caption: "Termina impactando a los clientes",
    holdMs: 2400,
  },
];

const TRANSITION = "fill 550ms ease, stroke 550ms ease";

/**
 * Ilustración de la landing: red simple y prolija con un loop que muestra cómo una disrupción
 * nacida en un proveedor se propaga en cascada hasta el cliente. Lo ya afectado queda rojo, lo
 * próximo a afectarse se anticipa en amarillo.
 */
export function NetworkIllustration() {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const timer = setTimeout(
      () => setFrameIndex((i) => (i + 1) % FRAMES.length),
      FRAMES[frameIndex].holdMs,
    );
    return () => clearTimeout(timer);
  }, [frameIndex]);

  const frame = FRAMES[frameIndex];
  const byId = Object.fromEntries(NODES.map((n) => [n.id, n]));
  const severityOf = (id: string): Severity =>
    frame.hit.includes(id) ? "severe" : frame.next.includes(id) ? "moderate" : "none";

  return (
    <div className="flex flex-col items-center gap-4">
      <svg
        viewBox="0 0 840 320"
        className="h-auto w-full"
        role="img"
        aria-label="Animación de una red de cadena de suministro donde una disrupción se origina en un proveedor y se propaga en cascada hasta el cliente"
      >
        <defs>
          <filter id="node-shadow" x="-60%" y="-60%" width="220%" height="220%">
            <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#0f1a33" floodOpacity="0.12" />
          </filter>
        </defs>

        {EDGES.map(([from, to], i) => {
          const a = byId[from];
          const b = byId[to];
          const sev = severityOf(to);
          const affected = sev !== "none";
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={affected ? SEVERITY_COLOR[sev].stroke : "#3b82f6"}
              strokeOpacity={affected ? 0.9 : 0.4}
              strokeWidth={sev === "severe" ? 2.5 : 2}
              strokeDasharray={affected ? undefined : "5 5"}
              style={{ transition: TRANSITION }}
            />
          );
        })}

        {NODES.map((n) => {
          const typeColor = NODE_TYPE_COLOR[n.type];
          const sev = severityOf(n.id);
          const palette = SEVERITY_COLOR[sev];
          const stroke = sev === "none" ? typeColor : palette.border;
          const fill = sev === "none" ? "#ffffff" : palette.fill;
          const left = n.x - CARD_W / 2;
          const top = n.y - CARD_H / 2;
          return (
            <g key={n.id} filter="url(#node-shadow)">
              <rect
                x={left}
                y={top}
                width={CARD_W}
                height={CARD_H}
                rx={12}
                fill={fill}
                stroke={stroke}
                strokeWidth={sev === "severe" ? 2.5 : 2}
                style={{ transition: TRANSITION }}
              />
              {/* Punto y texto alineados a la izquierda con padding fijo: nunca se superponen,
                  sin importar cuánto mida la etiqueta. */}
              <circle cx={left + 15} cy={n.y} r={4.5} fill={typeColor} />
              <text
                x={left + 27}
                y={n.y + 4}
                textAnchor="start"
                fontSize="12"
                fontWeight={600}
                fill="#151a23"
                fontFamily="var(--font-sans)"
              >
                {n.label}
              </text>
              {sev === "moderate" && (
                <circle
                  cx={left + CARD_W - 11}
                  cy={top + 11}
                  r={4.5}
                  fill={palette.stroke}
                  className="pulse-dot"
                  style={{ transformBox: "fill-box", transformOrigin: "center" }}
                />
              )}
            </g>
          );
        })}
      </svg>

      <div key={frameIndex} className="illustration-caption flex items-center gap-2 text-[13px] text-muted-foreground">
        <span
          className={`h-1.5 w-1.5 flex-none rounded-full ${
            frame.hit.length > 0 ? "bg-destructive" : "bg-success"
          }`}
        />
        {frame.caption}
      </div>
    </div>
  );
}

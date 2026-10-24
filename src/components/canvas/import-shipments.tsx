"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatWeekLabel } from "@/lib/domain/dates";
import { addWeeksIso } from "@/lib/domain/synthetic/weeks";
import type { SupplyChainNode } from "@/lib/domain/types";
import { parseShipmentsCsv, shipmentsTemplate, summarizeShipments, type ParsedShipments } from "@/lib/ingestion/shipments-csv";
import { useAppStore } from "@/stores/app-store";

const ERROR_BY_CODE: Record<string, string> = {
  stale_week: "El archivo trae envíos de semanas que el nodo ya tiene registradas. Cargá solo semanas posteriores a la última.",
  unit_mismatch: "Este nodo mide en escala 0-100 y no recibe envíos en días.",
  no_history: "El nodo todavía no tiene historial con línea base.",
  max_weeks: "El nodo llegó al máximo de semanas que se pueden registrar.",
};

/**
 * Botón "Cargar CSV" del nodo: importa los envíos de una fuente real (un archivo con una fila por envío: fecha y margen en días).
 * Es la misma ingesta que usa el simulador de sensores (RF009 y RF010): el servidor agrega los envíos por semana, con la línea
 * base congelada del nodo, y a partir de ahí la detección, las alertas y la simulación funcionan igual.
 */
export function ImportShipments({ node, lastWeek }: { node: SupplyChainNode; lastWeek: string | null }) {
  const ingestShipments = useAppStore((s) => s.ingestShipments);
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<ParsedShipments | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Solo los nodos que miden en días (los que tienen línea base del modelo o provisoria) reciben envíos.
  const acceptsShipments = Boolean(node.baselineSource || node.olistSellerId);
  const summary = useMemo(() => (parsed && parsed.envios.length > 0 ? summarizeShipments(parsed.envios, lastWeek) : null), [parsed, lastWeek]);
  const hasProblems = !parsed || parsed.badRows > 0 || !summary || summary.staleShipments > 0;

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setServerError(null);
    setFileName(file.name);
    setParsed(parseShipmentsCsv(await file.text()));
    setOpen(true);
    // Permite volver a elegir el mismo archivo después de corregirlo.
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleImport() {
    if (!parsed || hasProblems) return;
    setBusy(true);
    setServerError(null);
    const result = await ingestShipments(node.chainId, node.id, parsed.envios);
    setBusy(false);
    if (!result.ok) {
      setServerError((result.code && ERROR_BY_CODE[result.code]) || result.error);
      return;
    }
    toast.success(`${parsed.envios.length} envíos cargados en ${node.label}: ${result.newWeeks} ${result.newWeeks === 1 ? "semana nueva" : "semanas nuevas"}.`);
    setOpen(false);
    setParsed(null);
  }

  function downloadTemplate() {
    const next = lastWeek ? addWeeksIso(lastWeek, 1) : new Date().toISOString().slice(0, 10);
    const url = URL.createObjectURL(new Blob([shipmentsTemplate(next)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `envios-${node.label}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <input ref={inputRef} type="file" accept=".csv,text/csv,text/plain" className="hidden" aria-label="Archivo CSV de envíos" onChange={(e) => void handleFile(e.target.files?.[0])} />
      <button
        type="button"
        disabled={!acceptsShipments}
        onClick={() => inputRef.current?.click()}
        title={acceptsShipments ? "Importar los envíos del nodo desde un archivo CSV (fecha y margen en días)" : "Este nodo mide en escala 0-100 y no recibe envíos en días"}
        className="ml-auto flex flex-none items-center gap-1 whitespace-nowrap rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Upload size={12} />
        Cargar CSV
      </button>

      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cargar envíos de {node.label}</DialogTitle>
            <DialogDescription>
              Un envío por fila, con su fecha y su margen de despacho en días (positivo = antes de su plazo). Se agrupan por semana y se suman al desempeño del nodo.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 text-[12.5px]">
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
              <div className="font-mono text-[11px] text-muted-foreground">{fileName}</div>
              {summary && parsed ? (
                <div className="mt-1">
                  <strong>{parsed.envios.length}</strong> {parsed.envios.length === 1 ? "envío" : "envíos"} del {formatWeekLabel(summary.from)} al {formatWeekLabel(summary.to)}, en{" "}
                  <strong>{summary.weeks.length}</strong> {summary.weeks.length === 1 ? "semana" : "semanas"}.
                </div>
              ) : null}
            </div>

            {summary && summary.staleShipments === 0 && parsed && parsed.badRows === 0 && (
              <div className="max-h-[132px] overflow-auto rounded-lg border border-border">
                <table className="w-full text-[11.5px]">
                  <thead className="bg-muted/40 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="px-2.5 py-1.5">Semana</th>
                      <th className="px-2.5 py-1.5">Envíos</th>
                      <th className="px-2.5 py-1.5">Margen medio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.weeks.map((w) => (
                      <tr key={w.weekStart} className="border-t border-border">
                        <td className="px-2.5 py-1">{formatWeekLabel(w.weekStart)}</td>
                        <td className="px-2.5 py-1">{w.items}</td>
                        <td className="px-2.5 py-1">{w.mean.toFixed(1).replace(".", ",")} d</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {parsed && parsed.badRows > 0 && (
              <div className="rounded-lg bg-destructive/10 px-3 py-2 text-destructive">
                <div className="font-medium">
                  {parsed.badRows} {parsed.badRows === 1 ? "problema" : "problemas"} en el archivo:
                </div>
                <ul className="mt-1 list-disc pl-4">
                  {parsed.errors.map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                </ul>
              </div>
            )}

            {summary && summary.staleShipments > 0 && lastWeek && (
              <div className="rounded-lg bg-destructive/10 px-3 py-2 text-destructive">
                {summary.staleShipments} {summary.staleShipments === 1 ? "envío es" : "envíos son"} de semanas que el nodo ya tiene registradas (hasta la semana del {formatWeekLabel(lastWeek)}). Cargá solo semanas posteriores.
              </div>
            )}

            {serverError && <div className="rounded-lg bg-destructive/10 px-3 py-2 text-destructive">{serverError}</div>}

            <button type="button" onClick={downloadTemplate} className="flex w-fit items-center gap-1.5 text-primary hover:underline">
              <Download size={12} />
              Descargar una plantilla de ejemplo
            </button>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={() => void handleImport()} disabled={busy || hasProblems}>
              {busy ? "Cargando…" : "Cargar envíos"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

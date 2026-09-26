"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WeeklyPerformanceChart } from "@/components/charts/weekly-performance-chart";
import { NODE_TYPE_CODE, NODE_TYPE_COLOR } from "@/lib/mock/node-visuals";
import { useMockDbStore } from "@/stores/mock-db-store";
import type { SupplyChainNode } from "@/lib/mock/types";

/** Campos numéricos editables de un Nodo — los atributos propios por tipo del modelo de datos. */
type NumericField = "supplyCapacity" | "productionCapacity" | "storageCapacity" | "currentStockLevel";

interface AttributeField {
  field: NumericField;
  label: string;
  placeholder: string;
  /** Aclaración al pie, para los campos que no son lo que parecen. */
  note?: string;
}

/**
 * Atributos propios por tipo de nodo (docs/modelo-datos.md). Vendedor y Cliente no tienen: se
 * agregan cuando haga falta, no se inventan.
 */
const ATTRIBUTES_BY_TYPE: Record<string, AttributeField[]> = {
  Proveedor: [{ field: "supplyCapacity", label: "Capacidad sum.", placeholder: "u/sem" }],
  Fabrica: [{ field: "productionCapacity", label: "Capacidad prod.", placeholder: "u/sem" }],
  Almacen: [
    { field: "storageCapacity", label: "Capacidad almac.", placeholder: "u" },
    {
      field: "currentStockLevel",
      label: "Stock actual",
      placeholder: "u",
      note: "Dato de contexto: no entra en el cálculo de la simulación.",
    },
  ],
  Vendedor: [],
  Cliente: [],
};

const TYPE_NOTE: Record<string, string> = {
  Proveedor: "capacidad_suministro es el único atributo propio de este tipo — conceptual, no validado con datos reales.",
  Fabrica: "capacidad_produccion es el único atributo propio de este tipo.",
  Almacen: "capacidad_almacenamiento y nivel_stock_actual son sus atributos propios.",
  Vendedor: "Corresponde al seller_id de Olist — el único nodo con desempeño real medido.",
  Cliente: "Sin atributos propios identificados todavía.",
};

export function NodeInspector({ node, onClose }: { node: SupplyChainNode; onClose: () => void }) {
  const edges = useMockDbStore((s) => s.edges);
  const nodes = useMockDbStore((s) => s.nodes);
  const weeklyPerformance = useMockDbStore((s) => s.weeklyPerformance);
  const removeNode = useMockDbStore((s) => s.removeNode);
  const removeNodeWithEdges = useMockDbStore((s) => s.removeNodeWithEdges);
  const updateNode = useMockDbStore((s) => s.updateNode);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [label, setLabel] = useState(node.label);
  const [numericDraft, setNumericDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    setConfirmingDelete(false);
    setLabel(node.label);
    setNumericDraft({});
  }, [node.id, node.label]);

  const connections = edges
    .filter((e) => e.sourceNodeId === node.id || e.targetNodeId === node.id)
    .map((e) => {
      const outgoing = e.sourceNodeId === node.id;
      const otherId = outgoing ? e.targetNodeId : e.sourceNodeId;
      const other = nodes.find((n) => n.id === otherId);
      return { edgeId: e.id, dir: outgoing ? "→" : "←", label: other?.label ?? "?", transitTimeDays: e.transitTimeDays };
    });

  const history = weeklyPerformance
    .filter((w) => w.nodeId === node.id)
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  function handleLabelChange(value: string) {
    setLabel(value);
    const trimmed = value.trim();
    if (trimmed) updateNode(node.id, { label: trimmed });
  }

  function commitNumeric(field: NumericField, value: string) {
    // El borrador se guarda tal cual para no pelearse con lo que el usuario está tipeando
    // (un campo vacío o a medio escribir no debe volver a rellenarse solo).
    setNumericDraft((current) => ({ ...current, [field]: value }));
    const parsed = value === "" ? undefined : Number(value);
    if (parsed !== undefined && Number.isNaN(parsed)) return;
    updateNode(node.id, { [field]: parsed });
  }

  function numericValue(field: NumericField): string {
    return numericDraft[field] ?? String(node[field] ?? "");
  }

  function handleDelete() {
    // Con conexiones el borrado directo se rechaza (una arista no puede quedar apuntando a un
    // nodo que ya no existe), así que se pide confirmación para llevarse también las aristas.
    if (connections.length > 0) {
      setConfirmingDelete(true);
      return;
    }
    const result = removeNode(node.id);
    if (!result.ok) {
      toast.error(result.reason);
      return;
    }
    onClose();
  }

  function handleDeleteWithEdges() {
    const removed = connections.length;
    removeNodeWithEdges(node.id);
    toast.success(
      `${node.label} eliminado junto con ${removed} ${removed === 1 ? "conexión" : "conexiones"}.`,
    );
    setConfirmingDelete(false);
    onClose();
  }

  return (
    <div className="flex w-[300px] flex-none flex-col overflow-auto border-l border-border bg-card">
      <div className="flex items-center gap-2.5 border-b border-border px-3.5 py-3">
        <span className="h-2.5 w-2.5 flex-none rounded-sm" style={{ background: NODE_TYPE_COLOR[node.nodeType] }} />
        <Input
          value={label}
          onChange={(e) => handleLabelChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="h-7 border-transparent bg-transparent px-1 font-mono text-[15px] font-medium shadow-none hover:border-input focus-visible:border-input"
        />
        <span className="ml-auto flex-none font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground">
          {NODE_TYPE_CODE[node.nodeType]}
        </span>
      </div>

      <div className="flex flex-col gap-3.5 p-3.5">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-border bg-muted/40 p-2.5">
            <div className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">Tipo</div>
            <div className="mt-0.5 font-mono text-[15px]">{node.nodeType}</div>
          </div>
          {(ATTRIBUTES_BY_TYPE[node.nodeType] ?? []).map((attr) => (
            <div key={attr.field} className="rounded-lg border border-border bg-muted/40 p-2.5">
              <Label className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                {attr.label}
              </Label>
              <Input
                type="number"
                min={0}
                value={numericValue(attr.field)}
                onChange={(e) => commitNumeric(attr.field, e.target.value)}
                placeholder={attr.placeholder}
                title={attr.note}
                className="mt-0.5 h-6 border-none bg-transparent p-0 font-mono text-[15px] shadow-none focus-visible:ring-0"
              />
              {attr.note && (
                <div className="mt-0.5 text-[9px] leading-tight text-muted-foreground">{attr.note}</div>
              )}
            </div>
          ))}
        </div>
        <div className="text-[11px] leading-relaxed text-muted-foreground">{TYPE_NOTE[node.nodeType]}</div>

        <div>
          <div className="mb-2 font-mono text-[9.5px] font-medium uppercase tracking-wider text-muted-foreground">
            Desempeño semanal
          </div>
          {history.length > 0 ? (
            <div className="rounded-lg border border-border bg-muted/20 p-1">
              <WeeklyPerformanceChart data={history} />
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-3 text-center text-[11.5px] text-muted-foreground">
              Sin registros de desempeño todavía.
            </div>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[9.5px] font-medium uppercase tracking-wider text-muted-foreground">
              Aristas conectadas
            </span>
            <span className="font-mono text-[10.5px] text-muted-foreground">{connections.length}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {connections.map((c) => (
              <div key={c.edgeId} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-2 text-[12px]">
                <span className="font-mono text-muted-foreground">{c.dir}</span>
                <span className="font-mono font-medium">{c.label}</span>
                <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">{c.transitTimeDays}d</span>
              </div>
            ))}
            {connections.length === 0 && (
              <div className="rounded-md border border-dashed border-border px-2.5 py-2 text-center text-[11.5px] text-muted-foreground">
                Sin conexiones
              </div>
            )}
          </div>
        </div>

        {confirmingDelete ? (
          <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <div className="text-[12px] leading-relaxed">
              <span className="font-medium">{node.label}</span> tiene{" "}
              {connections.length === 1 ? "1 conexión" : `${connections.length} conexiones`}. Al eliminarlo se
              borran también.
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={handleDeleteWithEdges}
              >
                Eliminar igual
              </Button>
              <Button variant="outline" size="sm" className="flex-1" onClick={() => setConfirmingDelete(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" className="text-destructive hover:text-destructive" onClick={handleDelete}>
            <Trash2 className="mr-1.5" size={13} />
            Eliminar nodo
          </Button>
        )}
      </div>
    </div>
  );
}

import { NODE_TYPES } from "@/lib/domain/types";
import { NODE_TYPE_CODE, NODE_TYPE_COLOR } from "@/lib/domain/node-visuals";
import { CHAIN_TEMPLATES, CHAIN_TEMPLATE_LABELS } from "@/lib/domain/templates";

const NODE_TYPE_FIELDS: Record<string, { k: string; v: string }[]> = {
  Proveedor: [{ k: "atributos propios", v: "ninguno todavía" }],
  Fabrica: [{ k: "capacidad_produccion", v: "float" }],
  Almacen: [{ k: "capacidad_almacenamiento", v: "float" }],
  Vendedor: [{ k: "atributos propios", v: "ninguno todavía" }, { k: "fuente de datos", v: "seller_id (Olist)" }],
  Cliente: [{ k: "atributos propios", v: "ninguno todavía" }],
};

export default function LibraryPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto bg-background">
      <div className="flex-none px-5 pt-5 pb-3.5">
        <div className="text-[21px] font-semibold tracking-tight">Plantillas y nodos</div>
      </div>

      <div className="flex flex-col gap-5.5 px-5 pb-7">
        <div>
          <div className="mb-3 font-mono text-[9.5px] font-medium uppercase tracking-wider text-muted-foreground">
            Tipos de nodo · {NODE_TYPES.length}
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
            {NODE_TYPES.map((type) => (
              <div key={type} className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3.5">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: NODE_TYPE_COLOR[type] }} />
                  <span className="text-[14px] font-medium">{type}</span>
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">{NODE_TYPE_CODE[type]}</span>
                </div>
                <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/30 p-2">
                  {NODE_TYPE_FIELDS[type].map((f) => (
                    <div key={f.k} className="flex justify-between font-mono text-[10.5px]">
                      <span className="text-muted-foreground">{f.k}</span>
                      <span>{f.v}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3.5">
              <div className="flex items-center gap-2">
                <span className="h-[3px] w-4 rounded-sm bg-muted-foreground" />
                <span className="text-[14px] font-medium">Arista</span>
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">edge</span>
              </div>
              <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/30 p-2">
                <div className="flex justify-between font-mono text-[10.5px]">
                  <span className="text-muted-foreground">tiempo_transito</span>
                  <span>float (días)</span>
                </div>
              </div>
              <div className="text-[11.5px] leading-relaxed text-muted-foreground">
                El tránsito no es un nodo. Vive en la arista y no tiene costo asociado — no hay magnitudes monetarias
                en ningún punto del sistema.
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="mb-3 font-mono text-[9.5px] font-medium uppercase tracking-wider text-muted-foreground">
            Plantillas predefinidas · {CHAIN_TEMPLATES.length - 1}
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
            {CHAIN_TEMPLATES.filter((t) => t !== "blank").map((templateId) => {
              const label = CHAIN_TEMPLATE_LABELS[templateId];
              return (
                <div key={templateId} className="rounded-xl border border-border bg-card p-3.5">
                  <div className="text-[13.5px] font-medium">{label.name}</div>
                  <div className="mt-1 text-[11.5px] text-muted-foreground">{label.note}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

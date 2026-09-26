"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { chainFormSchema, type ChainFormValues } from "@/lib/validators/chain";
import { CHAIN_TEMPLATES, CHAIN_TEMPLATE_LABELS } from "@/lib/mock/templates";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useMockDbStore } from "@/stores/mock-db-store";

export default function NewChainPage() {
  const router = useRouter();
  const createChain = useMockDbStore((s) => s.createChain);
  const organization = useMockDbStore((s) => s.organization);

  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ChainFormValues>({
    resolver: zodResolver(chainFormSchema),
    defaultValues: { name: "", visibility: "shared", template: "blank" },
  });

  const name = watch("name");

  function onSubmit(values: ChainFormValues) {
    const chainId = createChain(values.name, values.visibility, values.template);
    router.push(`/cadenas/${chainId}`);
  }

  return (
    <div className="relative flex flex-1 items-center justify-center bg-[radial-gradient(#dbe1ea_1.1px,transparent_1.1px)] bg-[length:26px_26px] bg-muted/20">
      <div className="absolute inset-x-0 top-0 flex h-[52px] items-center gap-3 border-b border-border bg-card px-3.5">
        <Link href="/cadenas" className="flex items-center gap-2 text-[12.5px] text-muted-foreground hover:text-foreground">
          <span className="font-mono text-[13px]">‹</span>Cadenas
        </Link>
        <div className="h-5 w-px bg-border" />
        <div className="text-[14.5px] font-medium text-muted-foreground">{name || "Cadena sin título"}</div>
        <div className="flex-1" />
        <div className="font-mono text-[11px] text-muted-foreground">{organization.name}</div>
      </div>

      <form
        onSubmit={handleSubmit(onSubmit)}
        className="flex w-[452px] flex-col gap-4.5 rounded-2xl border border-border bg-card p-6 shadow-2xl"
      >
        <div className="flex flex-col gap-1.5">
          <div className="text-[19px] font-semibold tracking-tight">Crear una cadena</div>
          <div className="text-[12.5px] leading-relaxed text-muted-foreground">
            La cadena pertenece a la organización. Máximo 50 nodos.
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground">Nombre</Label>
          <Input placeholder="Cadena Sur — empaque" autoFocus {...register("name")} />
          {errors.name && <span className="text-[11px] text-destructive">{errors.name.message}</span>}
        </div>

        <div className="flex flex-col gap-2">
          <Label className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground">Visibilidad</Label>
          <Controller
            control={control}
            name="visibility"
            render={({ field }) => (
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => field.onChange("shared")}
                  className={cn(
                    "flex flex-1 flex-col gap-0.5 rounded-lg border px-3 py-2.5 text-left",
                    field.value === "shared" ? "border-primary/50 bg-accent" : "border-border hover:border-primary/30",
                  )}
                >
                  <span className={cn("text-[12.5px]", field.value === "shared" && "text-accent-foreground")}>Compartida</span>
                  <span className="text-[10.5px] text-muted-foreground">toda la organización</span>
                </button>
                <button
                  type="button"
                  onClick={() => field.onChange("private")}
                  className={cn(
                    "flex flex-1 flex-col gap-0.5 rounded-lg border px-3 py-2.5 text-left",
                    field.value === "private" ? "border-primary/50 bg-accent" : "border-border hover:border-primary/30",
                  )}
                >
                  <span className={cn("text-[12.5px]", field.value === "private" && "text-accent-foreground")}>Privada</span>
                  <span className="text-[10.5px] text-muted-foreground">solo yo</span>
                </button>
              </div>
            )}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label className="font-mono text-[9.5px] uppercase tracking-wider text-muted-foreground">Punto de partida</Label>
          <Controller
            control={control}
            name="template"
            render={({ field }) => (
              <div className="flex flex-col gap-1.5">
                {CHAIN_TEMPLATES.map((templateId) => {
                  const label = CHAIN_TEMPLATE_LABELS[templateId];
                  const active = field.value === templateId;
                  return (
                    <button
                      type="button"
                      key={templateId}
                      onClick={() => field.onChange(templateId)}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left",
                        active ? "border-primary/50 bg-accent" : "border-border hover:border-primary/30",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-6.5 w-6.5 flex-none items-center justify-center rounded-md border font-mono text-[12px]",
                          active ? "border-primary/50 bg-card text-primary" : "border-border text-muted-foreground",
                        )}
                      >
                        {templateId === "blank" ? "◻" : templateId === "linear" ? "▧" : templateId === "forked" ? "⑃" : "⌗"}
                      </span>
                      <span className="flex flex-col leading-tight">
                        <span className="text-[13px]">{label.name}</span>
                        <span className="text-[11px] text-muted-foreground">{label.note}</span>
                      </span>
                      {active && <span className="ml-auto text-[12px] text-primary">✓</span>}
                    </button>
                  );
                })}
              </div>
            )}
          />
        </div>

        <div className="flex gap-2.5">
          <Link
            href="/cadenas"
            className="flex-none rounded-lg border border-border px-3.5 py-2.5 text-[12.5px] hover:bg-muted"
          >
            Cancelar
          </Link>
          <Button type="submit" disabled={isSubmitting} className="flex-1 bg-foreground text-background hover:bg-foreground/85">
            Crear y abrir canvas
          </Button>
        </div>
      </form>
    </div>
  );
}

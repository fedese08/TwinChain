"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, BellRing, FlaskConical, MoreHorizontal, Trash2 } from "lucide-react";
import { DeleteChainDialog } from "@/components/canvas/delete-chain-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FALSE_ALARM_COST_CHOICES, thresholdForCost } from "@/lib/domain/cusum-config";
import { useAppStore } from "@/stores/app-store";

const SENSITIVITY_LABELS: Record<number, string> = { 0: "Máxima", 1: "Alta", 2: "Media", 3: "Baja" };

/**
 * Menú "Opciones" de la barra de la cadena: junta lo que no se usa a cada rato (la sensibilidad de la alerta, la
 * comparación de nodos, las simulaciones y eliminar la cadena) para que la barra entre en cualquier ancho de pantalla.
 * La sensibilidad es cuánto cuesta una falsa alarma, en semanas de operar degradado (RF019, HU1): con "Máxima" el
 * detector avisa antes pero con más falsas alarmas; con "Baja" avisa solo cuando la degradación está bien establecida.
 */
export function ChainOptionsMenu({
  chainId,
  chainName,
  mode,
  canWrite,
}: {
  chainId: string;
  chainName: string;
  mode: "design" | "simulate";
  canWrite: boolean;
}) {
  const router = useRouter();
  const cost = useAppStore((s) => s.chains.find((c) => c.id === chainId)?.falseAlarmCost);
  const setFalseAlarmCost = useAppStore((s) => s.setFalseAlarmCost);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Opciones de la cadena"
          title="Opciones de la cadena"
          className="flex flex-none items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-card px-2.5 py-1.5 text-[12.5px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-muted"
        >
          <MoreHorizontal size={14} />
          <span className="hidden lg:inline">Opciones</span>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" sideOffset={6} className="w-[268px]">
          {mode === "design" ? (
            <DropdownMenuItem onClick={() => router.push(`/cadenas/${chainId}/comparar-nodos`)}>
              <BarChart3 />
              Comparar nodos
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => router.push(`/cadenas/${chainId}/escenarios`)}>
              <FlaskConical />
              Ver simulaciones
            </DropdownMenuItem>
          )}

          {canWrite && cost !== undefined && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <BellRing />
                <span className="flex-1">Sensibilidad de alertas</span>
                <span className="font-mono text-[10.5px] text-muted-foreground">{SENSITIVITY_LABELS[cost] ?? cost}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-[250px]">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="px-2 py-1.5 text-[11px] font-normal leading-snug">
                    Cuánto cuesta una falsa alarma. Con más sensibilidad avisa antes, pero se equivoca más seguido.
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuRadioGroup value={String(cost)} onValueChange={(value) => void setFalseAlarmCost(chainId, Number(value))}>
                  {FALSE_ALARM_COST_CHOICES.map((value) => (
                    <DropdownMenuRadioItem key={value} value={String(value)}>
                      <span className="flex-1">{SENSITIVITY_LABELS[value]}</span>
                      <span className="mr-4 font-mono text-[10.5px] text-muted-foreground">umbral {thresholdForCost(value).toFixed(2)}×</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}

          {canWrite && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2 />
                Eliminar cadena
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {canWrite && <DeleteChainDialog chainId={chainId} chainName={chainName} open={deleteOpen} onOpenChange={setDeleteOpen} />}
    </>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppStore } from "@/stores/app-store";

/** Diálogo de confirmación para eliminar la cadena. Lo abre quien lo controla (hoy, el menú de opciones de la cadena). */
export function DeleteChainDialog({
  chainId,
  chainName,
  open,
  onOpenChange: setOpen,
}: {
  chainId: string;
  chainName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const deleteChain = useAppStore((s) => s.deleteChain);
  const nodes = useAppStore((s) => s.nodes);
  const scenarios = useAppStore((s) => s.scenarios);

  const [deleting, setDeleting] = useState(false);

  const nodeCount = nodes.filter((n) => n.chainId === chainId).length;
  const scenarioCount = scenarios.filter((s) => s.chainId === chainId).length;

  async function confirmDelete() {
    setDeleting(true);
    const result = await deleteChain(chainId);
    if (!result.ok) {
      setDeleting(false);
      toast.error(result.error);
      return;
    }
    toast.success(`Cadena «${chainName}» eliminada.`);
    // Se va antes de cerrar: si el diálogo se cerrara primero, la pantalla mostraría por un
    // instante "Cadena no encontrada".
    router.push("/cadenas");
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !deleting && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar «{chainName}»</DialogTitle>
            <DialogDescription>
              Se elimina la cadena con sus {nodeCount} {nodeCount === 1 ? "nodo" : "nodos"}, sus conexiones, su
              historial de desempeño y {scenarioCount === 0 ? "sus simulaciones" : `sus ${scenarioCount} ${scenarioCount === 1 ? "simulación" : "simulaciones"}`}{" "}
              con todos sus resultados. No se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={deleting}>
              Cancelar
            </Button>
            <Button
              onClick={confirmDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Eliminando…" : "Eliminar cadena"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

"use client";

import { useState } from "react";
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

interface DeleteScenarioDialogProps {
  scenario: { id: string; name: string } | null;
  onClose: () => void;
  /** Se llama una vez que el servidor confirmó el borrado (por ejemplo, para salir de la pantalla del escenario). */
  onDeleted?: () => void;
}

export function DeleteScenarioDialog({ scenario, onClose, onDeleted }: DeleteScenarioDialogProps) {
  const deleteScenario = useAppStore((s) => s.deleteScenario);
  const runCount = useAppStore((s) => s.results.filter((r) => r.scenarioId === scenario?.id).length);
  const [deleting, setDeleting] = useState(false);

  async function confirmDelete() {
    if (!scenario) return;
    setDeleting(true);
    // Se navega antes de sacar el escenario del store: si primero desapareciera, la pantalla de
    // resultado mostraría por un instante "Escenario no encontrado".
    const result = await deleteScenario(scenario.id, onDeleted);
    setDeleting(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`Simulación «${scenario.name}» eliminada.`);
    onClose();
  }

  return (
    <Dialog open={scenario !== null} onOpenChange={(open) => !open && !deleting && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Eliminar «{scenario?.name}»</DialogTitle>
          <DialogDescription>
            Se elimina la simulación con sus eventos y {runCount === 1 ? "su única corrida" : `sus ${runCount} corridas`}
            {" "}guardadas. Las demás simulaciones y la cadena no se tocan. No se puede deshacer.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={deleting}>
            Cancelar
          </Button>
          <Button
            onClick={confirmDelete}
            disabled={deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? "Eliminando…" : "Eliminar simulación"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

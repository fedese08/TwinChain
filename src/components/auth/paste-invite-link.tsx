"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Acepta el link completo o solo el token: se queda con el último tramo de la ruta. */
function extractToken(value: string): string {
  const trimmed = value.trim().split(/[?#]/)[0].replace(/\/+$/, "");
  return trimmed.split("/").pop() ?? "";
}

export function PasteInviteLink() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function go() {
    const token = extractToken(value);
    if (token.length < 20) {
      setError("Ese link no parece una invitación");
      return;
    }
    router.push(`/invitacion/${encodeURIComponent(token)}`);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Pegá acá el link de invitación"
          aria-invalid={!!error}
        />
        <Button onClick={go} disabled={!value.trim()}>
          Abrir
        </Button>
      </div>
      {error && <p className="text-[12px] text-destructive">{error}</p>}
    </div>
  );
}

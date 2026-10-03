"use client";

import { LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";

export function SignOutButton({ className, label = "Cerrar sesión" }: { className?: string; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: "/" })}
      className={cn("flex items-center gap-2 text-[12.5px] text-muted-foreground hover:text-foreground", className)}
    >
      <LogOut size={13} />
      {label}
    </button>
  );
}

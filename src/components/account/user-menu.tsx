"use client";

import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { ChevronsUpDown, CreditCard, LogOut, UserRound, Users } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PLAN_DEFINITIONS } from "@/lib/plans";
import { useAppStore } from "@/stores/app-store";

export interface UserMenuAccount {
  userName: string;
  userEmail: string;
  organizationName: string;
  roleName: string;
}

const initialsOf = (text: string, max: number) =>
  text
    .split(" ")
    .filter(Boolean)
    .slice(0, max)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

/** Menú de la cuenta (abajo de la barra lateral): perfil, plan activo, organización y cierre de sesión. */
export function UserMenu({ account }: { account: UserMenuAccount }) {
  const router = useRouter();
  const plan = useAppStore((s) => s.plan);
  const planName = PLAN_DEFINITIONS[plan].name;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-2.5 rounded-lg border-t border-sidebar-border px-2 pb-1.5 pt-3 text-left outline-none hover:bg-sidebar-accent/50 focus-visible:ring-2 focus-visible:ring-sidebar-primary"
        aria-label="Abrir el menú de la cuenta"
      >
        <span className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full border border-sidebar-border bg-sidebar-accent font-mono text-[10px] text-sidebar-foreground/80">
          {initialsOf(account.userName, 2)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[12.5px]">{account.userName}</span>
          <span className="truncate text-[10.5px] text-sidebar-foreground/60">
            {account.roleName} · {planName}
          </span>
        </span>
        <ChevronsUpDown size={13} className="flex-none text-sidebar-foreground/50" />
      </DropdownMenuTrigger>

      <DropdownMenuContent side="top" align="start" sideOffset={6} className="w-[216px]">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-0.5 px-2 py-1.5">
            <span className="truncate text-[12.5px] font-medium text-foreground">{account.userName}</span>
            <span className="truncate text-[11px] font-normal">{account.userEmail}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/cuenta")}>
          <UserRound />
          Mi perfil
        </DropdownMenuItem>
        <DropdownMenuItem aria-label={`Plan y suscripción (${planName})`} onClick={() => router.push("/cuenta#plan")}>
          <CreditCard />
          <span className="flex-1">Plan y suscripción</span>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{planName}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/organizacion")}>
          <Users />
          Organización
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => signOut({ callbackUrl: "/" })}>
          <LogOut />
          Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

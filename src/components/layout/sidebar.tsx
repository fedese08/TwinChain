"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Boxes, GitCompare, LibraryBig, Users } from "lucide-react";
import { UserMenu } from "@/components/account/user-menu";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

export interface SidebarAccount {
  userName: string;
  userEmail: string;
  organizationName: string;
  roleName: string;
}

const NAV_ITEMS = [
  { href: "/cadenas", label: "Cadenas", icon: Boxes },
  { href: "/comparar", label: "Comparar escenarios", icon: GitCompare },
  { href: "/modelo", label: "Modelo de línea base", icon: Activity },
  { href: "/biblioteca", label: "Plantillas y nodos", icon: LibraryBig },
  { href: "/organizacion", label: "Organización", icon: Users },
] as const;

const initialsOf = (text: string, max: number) =>
  text
    .split(" ")
    .filter(Boolean)
    .slice(0, max)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

export function Sidebar({ account }: { account: SidebarAccount }) {
  const pathname = usePathname();
  // Los contadores siguen saliendo del mock hasta migrar cadenas y escenarios a la base.
  const chainCount = useAppStore((s) => s.chains.length);
  const scenarioCount = useAppStore((s) => s.scenarios.length);

  const initials = initialsOf(account.organizationName, 2);

  return (
    <div className="flex w-[236px] flex-none flex-col gap-4 border-r border-sidebar-border bg-sidebar p-3 text-sidebar-foreground">
      {/* Logotipo (isotipo + nombre): ocupa el ancho útil de la barra. El SVG trae su propio margen interno. */}
      <div className="-mx-1 -my-1">
        <Image src="/brand/logotipo.svg" alt="TwinChain" width={532} height={160} priority unoptimized className="h-auto w-[200px]" />
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/40 px-2.5 py-2">
        <span className="flex h-5 w-5 flex-none items-center justify-center rounded-[5px] border border-sidebar-primary bg-sidebar-primary font-mono text-[8.5px] font-semibold text-sidebar-primary-foreground">
          {initials}
        </span>
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-[12.5px] font-medium">{account.organizationName}</span>
          <span className="font-mono text-[9.5px] text-sidebar-foreground/60">organización</span>
        </div>
      </div>

      <nav className="flex flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;
            const count = item.href === "/cadenas" ? chainCount : item.href === "/comparar" ? scenarioCount : null;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] transition-colors hover:bg-sidebar-accent",
                  active
                    ? "bg-sidebar-primary/20 font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/80",
                )}
              >
                <Icon size={14} strokeWidth={2} className={active ? "text-sidebar-primary" : "text-sidebar-foreground/50"} />
                {item.label}
                {count !== null && (
                  <span className="ml-auto font-mono text-[10.5px] text-sidebar-foreground/50">{count}</span>
                )}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="mt-auto pt-2">
        <UserMenu account={account} />
      </div>
    </div>
  );
}

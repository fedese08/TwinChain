import type { ReactNode } from "react";
import { Sidebar, type SidebarAccount } from "@/components/layout/sidebar";
import { SplashScreen } from "@/components/layout/splash-screen";
import { StoreSync } from "@/components/layout/store-sync";
import type { AppSnapshot } from "@/lib/data/snapshot-types";

export function AppShell({
  children,
  account,
  snapshot,
}: {
  children: ReactNode;
  account: SidebarAccount;
  snapshot: AppSnapshot;
}) {
  return (
    <div className="flex h-screen min-h-[640px] overflow-hidden bg-background text-foreground">
      <SplashScreen />
      <StoreSync snapshot={snapshot}>
        <Sidebar account={account} />
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </StoreSync>
    </div>
  );
}

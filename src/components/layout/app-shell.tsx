import type { ReactNode } from "react";
import { Sidebar, type SidebarAccount } from "@/components/layout/sidebar";
import { SplashScreen } from "@/components/layout/splash-screen";
import { StoreHydration } from "@/components/layout/store-hydration";

export function AppShell({ children, account }: { children: ReactNode; account: SidebarAccount }) {
  return (
    <div className="flex h-screen min-h-[640px] overflow-hidden bg-background text-foreground">
      <SplashScreen />
      <StoreHydration />
      <Sidebar account={account} />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

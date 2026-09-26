import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 py-10">
      <Link href="/" className="flex items-center gap-2.5">
        <Image src="/logo.png" alt="" width={40} height={40} priority className="h-10 w-10" />
        <span className="font-display text-[26px] leading-none tracking-tight">
          <span className="font-semibold text-foreground/60">Twin</span>
          <span className="font-bold">Chain</span>
        </span>
      </Link>
      <div className="w-full max-w-[420px] rounded-3xl border border-border bg-card p-7 shadow-sm">{children}</div>
    </div>
  );
}

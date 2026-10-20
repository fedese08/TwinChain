import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 py-10">
      <Link href="/" aria-label="TwinChain, ir al inicio" className="-my-4">
        <Image src="/brand/logotipo.svg" alt="TwinChain" width={532} height={160} priority unoptimized className="h-auto w-[220px]" />
      </Link>
      <div className="w-full max-w-[420px] rounded-3xl border border-border bg-card p-7 shadow-sm">{children}</div>
    </div>
  );
}

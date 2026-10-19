import { NextResponse } from "next/server";
import { requireApiMember } from "@/lib/auth/session";
import { mlClient, mlConfig, MlServiceError, type ModelHealth, type ModelInfo } from "@/lib/ml-client";

export type MlStatus =
  | { status: "no_configurado" }
  | { status: "sin_respuesta"; message: string }
  | { status: "clave_invalida"; message: string }
  | { status: "error"; message: string }
  | { status: "ok"; health: ModelHealth; info: ModelInfo };

// El health check es corto, pero /info puede tocar un servicio que estaba dormido (Render gratis).
export const maxDuration = 90;

/** Estado del microservicio de línea base. Lo puede ver cualquier miembro de la organización. */
export async function GET() {
  const access = await requireApiMember();
  if (!access.ok) return access.response;

  if (!mlConfig()) return NextResponse.json<MlStatus>({ status: "no_configurado" });

  try {
    const health = await mlClient.health();
    const info = await mlClient.info();
    return NextResponse.json<MlStatus>({ status: "ok", health, info });
  } catch (error) {
    if (error instanceof MlServiceError) {
      if (error.code === "timeout" || error.code === "unreachable") {
        return NextResponse.json<MlStatus>({ status: "sin_respuesta", message: error.message });
      }
      if (error.code === "unauthorized") return NextResponse.json<MlStatus>({ status: "clave_invalida", message: error.message });
      return NextResponse.json<MlStatus>({ status: "error", message: error.message });
    }
    throw error;
  }
}

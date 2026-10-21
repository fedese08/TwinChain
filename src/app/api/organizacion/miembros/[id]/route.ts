import { NextResponse } from "next/server";
import { z } from "zod";
import { isUuid, notFound, readJson } from "@/lib/api/http";
import { requireApiMember } from "@/lib/auth/session";
import { changeMemberRole, removeMember } from "@/lib/data/members";
import { getDb } from "@/lib/db";
import { ensureRoles } from "@/lib/db/roles";
import { INVITE_ROLES } from "@/lib/validators/auth";

const changeRoleSchema = z.object({ rol: z.enum(INVITE_ROLES) });

/** Cambia el rol de otra persona de la organización (Administrador u Operador). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApiMember("organization:manage");
  if (!access.ok) return access.response;
  const { id } = await params;
  if (!isUuid(id)) return notFound("Integrante no encontrado");

  const body = await readJson(request, changeRoleSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const roles = await ensureRoles(db);
  // La organización sale de la sesión, nunca del pedido.
  const result = await changeMemberRole(db, access.user.organizacionId, access.user.id, id, roles[body.data.rol]);
  if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: result.status });
  return NextResponse.json({ ok: true });
}

/** Saca a una persona de la organización. Su cuenta sigue existiendo, sin organización. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApiMember("organization:manage");
  if (!access.ok) return access.response;
  const { id } = await params;
  if (!isUuid(id)) return notFound("Integrante no encontrado");

  const result = await removeMember(getDb(), access.user.organizacionId, access.user.id, id);
  if (!result.ok) return NextResponse.json({ error: result.message, code: result.code }, { status: result.status });
  return NextResponse.json({ ok: true });
}

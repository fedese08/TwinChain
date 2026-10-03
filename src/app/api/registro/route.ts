import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { getDb, organizaciones, usuarios } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db/errors";
import { ensureRoles } from "@/lib/db/roles";
import { registerSchema } from "@/lib/validators/auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", fields: z.flattenError(parsed.error).fieldErrors },
      { status: 400 },
    );
  }
  const data = parsed.data;

  const db = getDb();
  const passwordHash = await bcrypt.hash(data.password, 12);

  try {
    if (data.tipo === "organizacion") {
      const roles = await ensureRoles(db);
      // Organización y su primer usuario van juntos: si falla uno no queda una organización huérfana.
      await db.transaction(async (tx) => {
        const [org] = await tx
          .insert(organizaciones)
          .values({ nombre: data.nombreOrganizacion! })
          .returning({ id: organizaciones.id });
        await tx.insert(usuarios).values({
          nombre: data.nombre,
          email: data.email,
          contrasena: passwordHash,
          rolId: roles.admin,
          organizacionId: org.id,
        });
      });
    } else {
      // Empleado: queda sin organización hasta aceptar una invitación (que exige el token del link).
      await db.insert(usuarios).values({ nombre: data.nombre, email: data.email, contrasena: passwordHash });
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: "Ese email ya está registrado", fields: { email: ["Ese email ya está registrado"] } },
        { status: 409 },
      );
    }
    throw error;
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

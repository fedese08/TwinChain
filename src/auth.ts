import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { getDb, usuarios } from "@/lib/db";
import { loginSchema } from "@/lib/validators/auth";

// Hash descartable: cuando el email no existe igual se corre bcrypt.compare, para que responder
// "no existe" no sea más rápido que responder "contraseña incorrecta" (enumeración por timing).
const DUMMY_HASH = bcrypt.hashSync(randomUUID(), 12);

/**
 * La sesión (JWT) guarda solo la identidad del usuario. Organización y rol NO viajan en el token:
 * se leen de la base en cada request (ver lib/auth/session.ts), así una invitación aceptada o un
 * cambio de rol se reflejan al instante y no hay claims viejos que revocar.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 14 },
  pages: { signIn: "/login" },
  trustHost: true,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(raw) {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const [user] = await getDb()
          .select()
          .from(usuarios)
          .where(sql`lower(${usuarios.email}) = ${email}`)
          .limit(1);

        const valid = await bcrypt.compare(password, user?.contrasena ?? DUMMY_HASH);
        if (!user || !user.contrasena || !valid) return null;

        return { id: user.id, name: user.nombre, email: user.email };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (session.user && token.sub) session.user.id = token.sub;
      return session;
    },
  },
});

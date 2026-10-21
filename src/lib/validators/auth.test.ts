import { describe, expect, it } from "vitest";
import { CONSENT_REQUIRED_MESSAGE } from "@/lib/legal/consent";
import { registerSchema } from "@/lib/validators/auth";

const base = { tipo: "organizacion", nombre: "Ada Admin", email: "ada@empresa.com", password: "password-123", nombreOrganizacion: "Empresa" };

describe("registro: consentimiento (Ley 25.326)", () => {
  it("acepta el registro cuando se aceptó el tratamiento de los datos", () => {
    expect(registerSchema.safeParse({ ...base, aceptaTratamiento: true }).success).toBe(true);
  });

  it("rechaza el registro sin aceptación, con un mensaje claro, tanto si falta como si es falso", () => {
    for (const body of [base, { ...base, aceptaTratamiento: false }]) {
      const parsed = registerSchema.safeParse(body);
      expect(parsed.success).toBe(false);
      expect(JSON.stringify(parsed.error?.issues)).toContain(CONSENT_REQUIRED_MESSAGE);
    }
  });
});

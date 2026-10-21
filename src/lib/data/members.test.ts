import { describe, expect, it } from "vitest";
import { checkMemberChange } from "@/lib/data/members";

const members = ["admin-1", "op-1", "op-2"];

describe("gestión de integrantes", () => {
  it("una administradora puede cambiar el rol o quitar a otra persona de su organización", () => {
    expect(checkMemberChange(members, "admin-1", "op-1", "role")).toEqual({ ok: true });
    expect(checkMemberChange(members, "admin-1", "op-2", "remove")).toEqual({ ok: true });
  });

  it("no puede tocarse a sí misma (así la organización nunca queda sin administradora)", () => {
    const role = checkMemberChange(members, "admin-1", "admin-1", "role");
    const remove = checkMemberChange(members, "admin-1", "admin-1", "remove");
    expect(role).toMatchObject({ ok: false, status: 409, code: "self" });
    expect(remove).toMatchObject({ ok: false, status: 409, code: "self" });
  });

  it("una persona que no es de la organización responde como inexistente", () => {
    expect(checkMemberChange(members, "admin-1", "otra-org", "remove")).toMatchObject({ ok: false, status: 404, code: "not_found" });
  });
});

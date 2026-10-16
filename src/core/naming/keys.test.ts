import { describe, expect, it } from "vitest";
import { createAttribute } from "../model/factory";
import { attributeLogicalName, foreignKeyDefaultName, uniqueName } from "./keys";

describe("schémas de nommage des clés (override O-13)", () => {
  it.each([
    ["<table>_id", "user_id"],
    ["<column>", "id_user"],
    ["<table>_<column>", "user_id_user"],
    ["<column>_<table>", "id_user_user"],
  ] as const)("clé étrangère %s → %s", (mask, expected) => {
    expect(foreignKeyDefaultName(mask, "user", "id_user", true)).toBe(expected);
  });

  it("clé référencée composée : <table>_id retombe sur la colonne", () => {
    expect(foreignKeyDefaultName("<table>_id", "salle", "num_salle", false)).toBe("num_salle");
  });

  it.each([
    ["id_<table>", "id_user"],
    ["<table>_id", "user_id"],
    ["<name>", "code user"],
  ] as const)("clé primaire %s → %s", (mask, expected) => {
    const auto = createAttribute("code user", { identifier: true, autoKey: true });
    expect(attributeLogicalName(auto, "user", { typology: "conceptual", stripAccents: false }, mask)).toBe(expected);
  });

  it("le schéma de clé primaire ne touche ni les identifiants manuels ni un nom logique saisi", () => {
    const naming = { typology: "conceptual", stripAccents: false } as const;
    expect(attributeLogicalName(createAttribute("numero", { identifier: true }), "user", naming, "id_<table>")).toBe(
      "numero",
    );
    expect(
      attributeLogicalName(createAttribute("code", { autoKey: true, logicalName: "pk" }), "user", naming, "id_<table>"),
    ).toBe("pk");
  });

  it("suffixes _2, _3", () => {
    expect(uniqueName("user_id", new Set())).toBe("user_id");
    expect(uniqueName("user_id", new Set(["user_id"]))).toBe("user_id_2");
    expect(uniqueName("user_id", new Set(["user_id", "user_id_2"]))).toBe("user_id_3");
  });
});

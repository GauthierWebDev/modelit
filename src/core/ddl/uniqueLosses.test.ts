import { describe, expect, it } from "vitest";
import type { Dbms } from "../dbms/dbms";
import type { LogicalModel } from "../mld/logical";
import { toLogicalModel } from "../mld/transform";
import { emptyDocument } from "../model/factory";
import { reverseEngineer } from "../reverse/build";
import { MSG } from "../validation/messages";
import { generateDdl } from "./generate";

/**
 * Rapport de pertes des contraintes UNIQUE selon la version de la cible (O-39, O-42) :
 * chaque perte est signalée une fois, et seulement si elle est réelle pour cette version.
 */

/** UNIQUE composite Oracle dont toutes les colonnes sont facultatives. */
const ORACLE = `CREATE TABLE t (
  id NUMBER(10) PRIMARY KEY,
  a VARCHAR2(10),
  b VARCHAR2(10),
  CONSTRAINT uq_ab UNIQUE (a, b)
);`;

function model(): LogicalModel {
  const { doc } = reverseEngineer(ORACLE, emptyDocument());
  return toLogicalModel(doc);
}

function losses(m: LogicalModel, dbms: Dbms, version: string) {
  const result = generateDdl(m, { dbms, version });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.losses.map((l) => l.message);
}

describe("UNIQUE composite Oracle, colonnes toutes facultatives", () => {
  it("le modèle porte la sémantique Oracle des NULL", () => {
    expect(model().tables[0]!.uniques[0]).toMatchObject({ name: "uq_ab", nulls: "oracle" });
  });

  it("PostgreSQL 15+ : NULLS NOT DISTINCT, lignes entièrement NULL signalées", () => {
    const messages = losses(model(), "postgresql", "15");
    expect(messages).toContain(MSG.lossNullsAllNull("uq_ab"));
    expect(messages).not.toContain(MSG.lossNullsNotDistinct("uq_ab"));
  });

  it("PostgreSQL < 15 : NULLS NOT DISTINCT indisponible, signalé seul (les lignes entièrement NULL restent admises)", () => {
    const messages = losses(model(), "postgresql", "14");
    expect(messages).toContain(MSG.lossNullsNotDistinct("uq_ab"));
    expect(messages).not.toContain(MSG.lossNullsAllNull("uq_ab"));
  });

  it("SQL Server : NULL égaux nativement, lignes entièrement NULL signalées", () => {
    const messages = losses(model(), "sqlserver", "2022");
    expect(messages).toContain(MSG.lossNullsAllNull("uq_ab"));
    expect(messages).not.toContain(MSG.lossNullsNotDistinct("uq_ab"));
  });
});

describe("UNIQUE avec INCLUDE", () => {
  function withInclude(): LogicalModel {
    const m = model();
    m.tables[0]!.uniques[0]!.include = ["id"];
    return m;
  }
  const count = (messages: string[], message: string) => messages.filter((m) => m === message).length;

  it("PostgreSQL 11+ : INCLUDE conservé, rien de signalé", () => {
    const result = generateDdl(withInclude(), { dbms: "postgresql", version: "11" });
    expect(result.ok && result.sql).toContain("INCLUDE (id)");
    expect(count(losses(withInclude(), "postgresql", "11"), MSG.lossInclude("uq_ab"))).toBe(0);
  });

  it("PostgreSQL < 11 : INCLUDE abandonné, signalé une seule fois", () => {
    expect(count(losses(withInclude(), "postgresql", "10"), MSG.lossInclude("uq_ab"))).toBe(1);
  });

  it("SGBD sans INCLUDE sur UNIQUE : signalé une seule fois", () => {
    expect(count(losses(withInclude(), "mysql", "8.4"), MSG.lossInclude("uq_ab"))).toBe(1);
  });
});

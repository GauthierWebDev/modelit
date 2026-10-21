import type { LogicalTable } from "../mld/logical";
import type { CheckConstraint, SqlDialect } from "../model/physical";
import { sqlTypeToDataType } from "../reverse/types";
import { MSG } from "../validation/messages";
import type { Context } from "./context";
import { enforcesCheck, sameDialect } from "./dialects";
import {
  type Condition,
  likeToRegex,
  type Operand,
  parseCondition,
  renderCondition,
  type TypeFamily,
  typeConflict,
} from "./expressions";
import { effectiveCollationClass, icuCollations } from "./typeCollations";
import { freeTypeFallback } from "./typeEquivalents";

/** CHECK écrit pour la cible, ou `null` (non traduisible ou incompatible : commentaire + perte). */
export function check(ctx: Context, table: LogicalTable, constraint: CheckConstraint, column?: string): string | null {
  let expression: string | null = null;
  if (sameDialect(constraint.dialect, ctx.target.dbms) || constraint.dialect === "generic") {
    expression =
      constraint.dialect === "generic"
        ? (renderStructured(ctx, table, constraint.expression) ?? constraint.expression)
        : constraint.expression;
  } else {
    expression = renderStructured(ctx, table, constraint.expression, constraint.dialect);
  }
  if (expression === null) {
    ctx.report.add("check", table.name, MSG.lossCheck(constraint.expression), column);
    return null;
  }
  // Typage strict (PostgreSQL, DB2) : un CHECK qui compare des familles de types différentes
  // après conversion (ex. YEAR devenu texte) ferait échouer le script (O-35).
  if (ctx.dialect.constraints.strictCheckTyping) {
    const condition = parseCondition(constraint.expression);
    const conflict = condition && typeConflict(condition, (name) => familyOf(ctx, table, name));
    if (conflict) {
      ctx.report.add("check", table.name, MSG.lossCheckTypes(constraint.expression, conflict), column);
      return null;
    }
  }
  if (!enforcesCheck(ctx.target)) {
    ctx.report.add("check", table.name, MSG.lossCheckNotEnforced(expression), column);
  }
  return expression;
}

/** Réécrit une condition CHECK structurée pour la cible (`null` si hors du sous-ensemble). */
export function renderStructured(
  ctx: Context,
  table: LogicalTable,
  expression: string,
  dialect?: SqlDialect,
): string | null {
  const condition = parseCondition(expression);
  if (!condition) {
    return null;
  }
  const caseSensitive = (name: string) => Boolean(table.columns.find((c) => c.name === name)?.caseSensitive);
  const translated =
    dialect === "sqlserver"
      ? sqlServerLikes(ctx, booleanLiterals(condition, table), table)
      : booleanLiterals(condition, table);
  return translated && renderCondition(translated, ctx.target, caseSensitive);
}

/**
 * LIKE SQL Server à classes ([A-Z], [^A-Z]) → expression rationnelle ancrée (O-42) : ~* sous collation
 * insensible à la casse ; COLLATE "C" si la colonne a une collation non déterministe (PostgreSQL n'y
 * applique pas les expressions rationnelles). Ailleurs qu'en PostgreSQL : `null` (non traduit).
 */
function sqlServerLikes(ctx: Context, c: Condition, table: LogicalTable): Condition | null {
  switch (c.kind) {
    case "and":
    case "or": {
      const items = c.items.map((item) => sqlServerLikes(ctx, item, table));
      return items.every((i): i is Condition => i !== null) ? { ...c, items } : null;
    }
    case "not": {
      const item = sqlServerLikes(ctx, c.item, table);
      return item && { ...c, item };
    }
    case "like": {
      const regex = c.pattern.kind === "string" ? likeToRegex(c.pattern.value) : null;
      if (!regex) {
        return c;
      }
      if (!ctx.dialect.constraints.regex) {
        return null;
      }
      const column =
        c.operand.kind === "column"
          ? table.columns.find((col) => col.name.toLowerCase() === (c.operand as { name: string }).name.toLowerCase())
          : undefined;
      const klass = column ? effectiveCollationClass(ctx, column) : undefined;
      const insensitive = klass === "ci" || klass === "ai_ci";
      const nondeterministic = insensitive && icuCollations(ctx);
      return {
        kind: "regex",
        operand: c.operand,
        pattern: regex,
        negated: c.negated,
        insensitive,
        ...(nondeterministic ? { collateC: true } : {}),
      };
    }
    default:
      return c;
  }
}

/** Colonne booléenne comparée à 0 / 1 (BIT SQL Server, TINYINT(1) MySQL) : FALSE / TRUE (O-41). */
function booleanLiterals(c: Condition, table: LogicalTable): Condition {
  const isBoolean = (o: Operand) =>
    o.kind === "column" &&
    table.columns.find((col) => col.name.toLowerCase() === o.name.toLowerCase())?.type?.kind === "boolean";
  const literal = (o: Operand): Operand =>
    o.kind === "number" && (o.value === "0" || o.value === "1") ? { kind: "boolean", value: o.value === "1" } : o;
  switch (c.kind) {
    case "and":
    case "or":
      return { ...c, items: c.items.map((item) => booleanLiterals(item, table)) };
    case "not":
      return { ...c, item: booleanLiterals(c.item, table) };
    case "compare":
      return isBoolean(c.left)
        ? { ...c, right: literal(c.right) }
        : isBoolean(c.right)
          ? { ...c, left: literal(c.left) }
          : c;
    case "in":
      return isBoolean(c.operand) ? { ...c, values: c.values.map(literal) } : c;
    default:
      return c;
  }
}

/** Famille du type d'une colonne pour la cible (cohérence des CHECK, O-35). */
function familyOf(ctx: Context, table: LogicalTable, name: string): TypeFamily | undefined {
  const { dbms } = ctx.target;
  const column = table.columns.find((c) => c.name.toLowerCase() === name.toLowerCase());
  const type = column?.type;
  if (!type) {
    return undefined;
  }
  if (column.domain) {
    return "text";
  }
  if (column.sourceType && sameDialect(column.sourceType.dialect, dbms)) {
    return undefined;
  }
  switch (type.kind) {
    case "integer":
    case "decimal":
    case "real":
    case "money":
    case "counter":
      return "number";
    case "text":
      return type.encoding === "binary" ? undefined : "text";
    case "date":
    case "time":
    case "datetime":
      return "temporal";
    case "boolean":
      return "boolean";
    case "free": {
      // Type libre réémis tel quel ou remplacé par du texte : famille d'après sa conversion.
      const fallback = column.sourceType ? freeTypeFallback(ctx, type.sql).sql : type.sql;
      const parsed = sqlTypeToDataType(fallback, false, dbms);
      return parsed && parsed.kind !== "free"
        ? familyOf(ctx, { ...table, columns: [{ ...column, type: parsed, sourceType: undefined }] }, name)
        : undefined;
    }
    default:
      return undefined;
  }
}

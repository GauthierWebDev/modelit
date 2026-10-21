import { isAtLeast } from "../dbms/versions";
import { dateFunction, hasBooleanLiterals, quoteIdentifier, specialFunction, type Target } from "./dialects";
import type { Condition, Operand } from "./expressions";

const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** Opérande écrit pour la cible ; `null` si la cible n'a pas d'équivalent. */
export function renderOperand(
  o: Operand,
  target: Target,
  columnCase: (name: string) => boolean = () => false,
): string | null {
  switch (o.kind) {
    case "column":
      return quoteIdentifier(target, o.name, o.quoted || columnCase(o.name));
    case "number":
      return o.value;
    case "string":
      return sqlString(o.value);
    case "null":
      return "NULL";
    case "boolean":
      return hasBooleanLiterals(target) ? (o.value ? "TRUE" : "FALSE") : o.value ? "1" : "0";
    case "date":
      return dateFunction(target, o.fn);
    case "function":
      return specialFunction(target, o.fn);
    case "length": {
      const arg = renderOperand(o.arg, target, columnCase);
      const fn = {
        postgresql: "char_length",
        sqlserver: "LEN",
        sybase: "LEN",
        mysql: "CHAR_LENGTH",
        mariadb: "CHAR_LENGTH",
        oracle: "LENGTH",
        db2: "LENGTH",
        sqlite: "length",
        access: "Len",
      }[target.dbms];
      return arg && `${fn}(${arg})`;
    }
  }
}

export function renderCondition(c: Condition, target: Target, columnCase?: (name: string) => boolean): string | null {
  const op = (o: Operand) => renderOperand(o, target, columnCase);
  const all = (parts: (string | null)[]) => (parts.every((p) => p !== null) ? (parts as string[]) : null);
  const not = (negated: boolean) => (negated ? "NOT " : "");
  switch (c.kind) {
    case "and":
    case "or": {
      const parts = all(
        c.items.map((item) => {
          const text = renderCondition(item, target, columnCase);
          return text && (item.kind === "and" || item.kind === "or") ? `(${text})` : text;
        }),
      );
      return parts?.join(` ${c.kind.toUpperCase()} `) ?? null;
    }
    case "not": {
      const inner = renderCondition(c.item, target, columnCase);
      return inner && `NOT (${inner})`;
    }
    case "compare": {
      const parts = all([op(c.left), op(c.right)]);
      return parts && `${parts[0]} ${c.op} ${parts[1]}`;
    }
    case "in": {
      const parts = all([op(c.operand), ...c.values.map(op)]);
      return parts && `${parts[0]} ${not(c.negated)}IN (${parts.slice(1).join(", ")})`;
    }
    case "between": {
      const parts = all([op(c.operand), op(c.low), op(c.high)]);
      return parts && `${parts[0]} ${not(c.negated)}BETWEEN ${parts[1]} AND ${parts[2]}`;
    }
    case "isNull": {
      const operandText = op(c.operand);
      return operandText && `${operandText} IS ${not(c.negated)}NULL`;
    }
    case "like": {
      const parts = all([op(c.operand), op(c.pattern)]);
      return parts && `${parts[0]} ${not(c.negated)}LIKE ${parts[1]}`;
    }
    case "regex": {
      if (target.dbms !== "postgresql") {
        return null;
      }
      const operandText = op(c.operand);
      return (
        operandText &&
        `${operandText}${c.collateC ? ' COLLATE "C"' : ""} ${c.negated ? "!" : ""}~${c.insensitive ? "*" : ""} ${sqlString(c.pattern)}`
      );
    }
    case "isJson": {
      const operandText = op(c.operand);
      if (!operandText) {
        return null;
      }
      switch (target.dbms) {
        case "postgresql":
          return isAtLeast("postgresql", target.version, "16") ? `${operandText} IS ${not(c.negated)}JSON` : null;
        case "oracle":
          return `${operandText} IS ${not(c.negated)}JSON`;
        case "sqlserver":
          return `ISJSON(${operandText}) = ${c.negated ? 0 : 1}`;
        case "mysql":
        case "mariadb":
          return `JSON_VALID(${operandText}) = ${c.negated ? 0 : 1}`;
        case "sqlite":
          return `json_valid(${operandText}) = ${c.negated ? 0 : 1}`;
        default:
          return null;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Cohérence des types (override O-35)

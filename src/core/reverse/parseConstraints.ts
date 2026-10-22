import type { ConstraintState, ReferentialAction } from "../model/physical";
import { type Cursor, isName, isPunct, isWord } from "../sql/cursor";
import type { ParsedForeignKey, ParsedTable } from "./parse";
import { columnList } from "./parseKeys";

function readAction(c: Cursor): ReferentialAction | undefined {
  for (const words of [["cascade"], ["set", "null"], ["set", "default"], ["restrict"], ["no", "action"]]) {
    if (c.accept(...words)) {
      return words.join(" ") as ReferentialAction;
    }
  }
  c.next();
  return undefined;
}

/**
 * État d'une contrainte, après sa définition (O-39) : [NOT] DEFERRABLE, INITIALLY DEFERRED |
 * IMMEDIATE, ENABLE | DISABLE, VALIDATE | NOVALIDATE, NOT VALID (PostgreSQL), RELY… ;
 * `USING INDEX …` (Oracle) est noté comme clause de stockage de la table.
 */
export function constraintState(c: Cursor, table?: ParsedTable): ConstraintState | undefined {
  const state: ConstraintState = {};
  const timing = { deferrable: false, deferred: false };
  while (!c.done()) {
    if (!(stateWord(c, state, timing) || indexClause(c, table))) {
      break;
    }
  }
  if (timing.deferrable) {
    state.deferrable = timing.deferred ? "deferred" : "immediate";
  }
  return Object.values(state).some((v) => v !== undefined)
    ? Object.fromEntries(Object.entries(state).filter(([, v]) => v !== undefined))
    : undefined;
}

/** [NOT] DEFERRABLE, INITIALLY …, ENABLE / DISABLE, [NO]VALIDATE, NOT VALID. */
function stateWord(c: Cursor, state: ConstraintState, timing: { deferrable: boolean; deferred: boolean }): boolean {
  if (c.accept("not", "deferrable")) {
    timing.deferrable = false;
  } else if (c.accept("deferrable")) {
    timing.deferrable = true;
  } else if (c.accept("initially", "deferred")) {
    timing.deferred = true;
  } else if (c.accept("initially", "immediate")) {
    timing.deferred = false;
  } else if (c.accept("disable")) {
    state.disabled = true;
  } else if (c.accept("enable")) {
    state.disabled = undefined;
  } else if (c.accept("novalidate") || c.accept("not", "valid")) {
    state.notValidated = true;
  } else if (c.accept("validate")) {
    state.notValidated = undefined;
  } else {
    return false;
  }
  return true;
}

/** RELY / NORELY / NO INHERIT, options de l'index de la contrainte, USING INDEX. */
function indexClause(c: Cursor, table: ParsedTable | undefined): boolean {
  if (isWord(c.peek(), "rely", "norely", "no") && !isWord(c.peek(1), "action")) {
    c.next();
    if (isWord(c.peek(), "inherit")) {
      c.next();
    }
    return true;
  }
  if (isWord(c.peek(), "with") && isPunct(c.peek(1), "(")) {
    // SQL Server : WITH (PAD_INDEX = OFF, …) — options de l'index de la contrainte (O-41).
    c.next();
    c.skipGroup();
    noteStorage(table, "WITH (options d'index)");
    return true;
  }
  if (isWord(c.peek(), "on") && isName(c.peek(1)) && !isWord(c.peek(1), "delete", "update")) {
    // SQL Server : ON [PRIMARY] — groupe de fichiers.
    c.next();
    c.qualifiedName();
    noteStorage(table, "ON [groupe de fichiers]");
    return true;
  }
  if (c.accept("using", "index")) {
    noteStorage(table, "USING INDEX");
    skipUsingIndex(c);
    return true;
  }
  return false;
}

function noteStorage(table: ParsedTable | undefined, label: string) {
  if (table && !table.storage.includes(label)) {
    table.storage.push(label);
  }
}

/** USING INDEX [nom | (CREATE INDEX …)] [TABLESPACE t] [PCTFREE n]… : jusqu'au mot d'état suivant. */
function skipUsingIndex(c: Cursor) {
  while (
    !(
      c.done() ||
      isWord(
        c.peek(),
        "deferrable",
        "not",
        "initially",
        "enable",
        "disable",
        "validate",
        "novalidate",
        "rely",
        "norely",
      )
    )
  ) {
    if (isPunct(c.peek(), "(")) {
      c.skipGroup();
    } else {
      c.next();
    }
  }
}

/** Actions référentielles (toutes conservées) et état de la contrainte. */
function referentialActions(c: Cursor, fk: ParsedForeignKey, table?: ParsedTable) {
  while (!c.done()) {
    if (c.accept("on", "delete")) {
      fk.onDelete = readAction(c);
    } else if (c.accept("on", "update")) {
      fk.onUpdate = readAction(c);
    } else if (c.accept("match")) {
      c.next();
    } else if (isWord(c.peek(), "for", "replication")) {
      c.next();
    } else {
      const state = constraintState(c, table);
      if (!state) {
        break;
      }
      fk.state = { ...fk.state, ...state };
    }
  }
}

export function references(c: Cursor, columns: string[], name?: string, owner?: ParsedTable): ParsedForeignKey | null {
  const table = c.qualifiedName();
  if (!table) {
    return null;
  }
  const fk: ParsedForeignKey = { name, columns, table, referencedColumns: columnList(c.group()) };
  referentialActions(c, fk, owner);
  return fk;
}

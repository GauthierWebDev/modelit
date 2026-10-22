import type { SqlDialect } from "../model/physical";
import { Lexer } from "./lexer";

/**
 * Découpage lexical d'un script SQL, tous dialectes confondus (override O-28).
 *
 * Reconnaît : identifiants entre "…", `…` ou […] ; chaînes '…' (avec '' ou \' doublés), N'…',
 * E'…', $tag$…$tag$ (PostgreSQL) ; commentaires --, # et /* *\/ ; séparateurs d'instructions `;`,
 * `GO` seul sur sa ligne (SQL Server), `/` seul sur sa ligne (Oracle) et `DELIMITER` (MySQL).
 */

export type TokenType = "word" | "quoted" | "string" | "number" | "punct" | "end";

export interface Token {
  type: TokenType;
  /** Texte utile : identifiant sans guillemets, contenu d'une chaîne, ponctuation… */
  value: string;
  /** Texte d'origine (pour reconstituer une expression telle qu'écrite). */
  raw: string;
  /** Position dans le script (pour en extraire un passage tel qu'écrit : corps de déclencheur…). */
  pos?: number;
}

export interface TokenizeOptions {
  /**
   * Dialecte source (O-41) : commentaires /* *\/ imbriqués (SQL Server, PostgreSQL) ou fermés au
   * premier *\/ (MySQL, Oracle, SQLite…) ; commandes SQL*Plus (Oracle, ou dialecte inconnu).
   */
  dialect?: SqlDialect;
  /** Avertissements de lecture (ex. *\/ orphelin), complétés au fil du découpage. */
  warnings?: string[];
}

export function tokenize(sql: string, options: TokenizeOptions = {}): Token[] {
  const lexer = new Lexer(sql, options);
  while (!lexer.done) {
    lexer.step();
  }
  return lexer.tokens;
}

/** Instructions : suites de lexèmes séparées par les fins d'instruction. */
export function splitStatements(tokens: Token[]): Token[][] {
  const statements: Token[][] = [];
  let current: Token[] = [];
  for (const token of tokens) {
    if (token.type === "end") {
      if (current.length > 0) {
        statements.push(current);
      }
      current = [];
    } else {
      current.push(token);
    }
  }
  if (current.length > 0) {
    statements.push(current);
  }
  return statements;
}

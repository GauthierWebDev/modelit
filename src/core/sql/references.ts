import { tokenize } from "./tokenize";

/** Mots-clés des expressions simples (CHECK, DEFAULT) : jamais des noms de colonnes. */
export const KEYWORDS = new Set(["and", "or", "not", "in", "between", "is", "null", "like", "true", "false"]);

/** Colonnes citées par une expression (pour rattacher un CHECK à une colonne). */
export function referencedColumns(expression: string): string[] {
  const tokens = tokenize(expression);
  const names = new Set<string>();
  tokens.forEach((t, i) => {
    if (t.type === "quoted") {
      names.add(t.value);
    } else if (t.type === "word" && !KEYWORDS.has(t.value.toLowerCase()) && tokens[i + 1]?.value !== "(") {
      names.add(t.value);
    }
  });
  return [...names];
}

import type { Token } from "./tokenize";

export const isWord = (t: Token | undefined, ...words: string[]) =>
  t?.type === "word" && words.includes(t.value.toLowerCase());

export const isPunct = (t: Token | undefined, value: string) => t?.type === "punct" && t.value === value;

export const isName = (t: Token | undefined) => t?.type === "word" || t?.type === "quoted";

export class Cursor {
  readonly tokens: Token[];
  i: number;
  constructor(tokens: Token[], i = 0) {
    this.tokens = tokens;
    this.i = i;
  }
  peek(offset = 0) {
    return this.tokens[this.i + offset];
  }
  next() {
    const token = this.tokens[this.i];
    this.i += 1;
    return token;
  }
  done() {
    return this.i >= this.tokens.length;
  }
  /** Consomme les mots donnés s'ils se suivent ; renvoie vrai si c'est le cas. */
  accept(...words: string[]) {
    for (let k = 0; k < words.length; k += 1) {
      if (!isWord(this.peek(k), words[k]!)) {
        return false;
      }
    }
    this.i += words.length;
    return true;
  }
  /** Nom éventuellement qualifié (schema.table) : renvoie la dernière partie. */
  qualifiedName(): string | null {
    return this.qualified()?.name ?? null;
  }
  /** Idem, en indiquant si la dernière partie était entre guillemets, et le schéma (avant-dernière partie) (O-42). */
  qualified(): { name: string; quoted: boolean; schema?: string } | null {
    if (!isName(this.peek())) {
      return null;
    }
    const parts = [this.next()!];
    while (isPunct(this.peek(), ".") && isName(this.peek(1))) {
      this.i += 1;
      parts.push(this.next()!);
    }
    const token = parts.at(-1)!;
    return {
      name: token.value,
      quoted: token.type === "quoted",
      ...(parts.length > 1 ? { schema: parts.at(-2)!.value } : {}),
    };
  }
  /** Groupe entre parenthèses commençant ici : renvoie son contenu (sans les parenthèses). */
  group(): Token[] | null {
    if (!isPunct(this.peek(), "(")) {
      return null;
    }
    let depth = 0;
    const start = this.i;
    while (!this.done()) {
      const t = this.next()!;
      if (isPunct(t, "(")) {
        depth += 1;
      } else if (isPunct(t, ")")) {
        depth -= 1;
        if (depth === 0) {
          return this.tokens.slice(start + 1, this.i - 1);
        }
      }
    }
    return this.tokens.slice(start + 1);
  }
  skipGroup() {
    this.group();
  }
}

/** Découpe une liste aux virgules de premier niveau. */
export function splitCommas(tokens: Token[]): Token[][] {
  const parts: Token[][] = [];
  let current: Token[] = [];
  let depth = 0;
  for (const t of tokens) {
    if (isPunct(t, "(")) {
      depth += 1;
    }
    if (isPunct(t, ")")) {
      depth -= 1;
    }
    if (depth === 0 && isPunct(t, ",")) {
      parts.push(current);
      current = [];
    } else {
      current.push(t);
    }
  }
  if (current.length > 0) {
    parts.push(current);
  }
  return parts;
}

/** Texte SQL reconstitué à partir des lexèmes. */
export function joinRaw(tokens: Token[]): string {
  let out = "";
  tokens.forEach((t, k) => {
    const previous = tokens[k - 1];
    // Moins unaire collé au nombre : NUMBER(12,-3), BETWEEN -3 AND 20 (O-39).
    const before = tokens[k - 2];
    const unary =
      t.type === "number" &&
      isPunct(previous, "-") &&
      (k === 1 ||
        (before?.type === "punct" && before.value !== ")") ||
        isWord(
          before,
          "between",
          "and",
          "or",
          "not",
          "in",
          "then",
          "else",
          "when",
          "default",
          "by",
          "with",
          "values",
          "is",
          "like",
          "return",
        ));
    const tight =
      k === 0 ||
      unary ||
      isPunct(t, ")") ||
      isPunct(t, ",") ||
      isPunct(t, "(") ||
      isPunct(previous, "(") ||
      isPunct(t, ".") ||
      isPunct(previous, ".") ||
      isPunct(t, "::") ||
      isPunct(previous, "::");
    out +=
      (tight && !(isPunct(t, "(") && previous?.type === "word" && isWord(previous, "in", "and", "or", "not"))
        ? ""
        : " ") + t.raw;
  });
  return out.trim();
}

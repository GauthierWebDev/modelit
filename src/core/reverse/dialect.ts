import type { SqlDialect } from "../model/physical";

/**
 * Dialecte probable d'un script SQL (override O-29), d'après des indices propres à chaque SGBD.
 * Sert à dater les expressions et types d'origine : un CHECK ou un type n'est réémis tel quel
 * que vers le même dialecte. À défaut d'indice, `generic`.
 */
const HINTS: { dialect: SqlDialect; patterns: RegExp[] }[] = [
  { dialect: "sqlite", patterns: [/\bautoincrement\b/i, /\bpragma\b/i, /\bwithout\s+rowid\b/i, /\bstrict\s*;/i] },
  { dialect: "mysql", patterns: [/`/, /\bauto_increment\b/i, /\bengine\s*=/i, /\bunsigned\b/i, /\bdelimiter\b/i] },
  {
    dialect: "sqlserver",
    patterns: [/\[[^\]\n]+\]/, /\bidentity\s*\(/i, /^\s*go\s*$/im, /\bnvarchar\s*\(\s*max\s*\)/i, /\bgetdate\s*\(/i],
  },
  { dialect: "oracle", patterns: [/\bvarchar2\b/i, /\bnumber\s*\(/i, /\bsysdate\b/i, /^\s*\/\s*$/m, /\bclob\b/i] },
  {
    dialect: "postgresql",
    patterns: [/\bserial\b/i, /::/, /\bnextval\s*\(/i, /\$\$/, /\btimestamptz\b/i, /\bbytea\b/i],
  },
  { dialect: "db2", patterns: [/\bvargraphic\b/i, /\bdbclob\b/i] },
  { dialect: "access", patterns: [/\bcounter\b/i, /\blongbinary\b/i] },
];

export function detectDialect(sql: string): SqlDialect {
  let best: { dialect: SqlDialect; score: number } = { dialect: "generic", score: 0 };
  for (const { dialect, patterns } of HINTS) {
    const score = patterns.filter((p) => p.test(sql)).length;
    if (score > best.score) best = { dialect, score };
  }
  return best.dialect;
}

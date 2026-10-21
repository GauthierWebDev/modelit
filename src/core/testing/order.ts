/**
 * Ordre du tri par défaut de `Array.prototype.sort` pour des chaînes (unités de code UTF-16),
 * écrit explicitement : les attentes des tests sont rédigées dans cet ordre.
 */
export const byCodeUnit = (a: string, b: string) => (a < b ? -1 : Number(a > b));

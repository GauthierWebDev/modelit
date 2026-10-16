import { type Dialect, standard } from "./dialect";

export const sybase = (): Dialect => ({ ...standard, dbms: "sybase", generated: null });

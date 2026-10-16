import { standard, type Dialect } from "./dialect";

export const sybase = (): Dialect => ({ ...standard, dbms: "sybase", generated: null });

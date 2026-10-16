export type Dbms = "access" | "db2" | "mariadb" | "mysql" | "oracle" | "postgresql" | "sqlserver" | "sqlite" | "sybase";

/** Ordre d'affichage. Le SGBD « Personnalisé » viendra en L9. */
export const DBMS_LIST: { id: Dbms; label: string }[] = [
  { id: "access", label: "Access" },
  { id: "db2", label: "DB2" },
  { id: "mariadb", label: "MariaDB" },
  { id: "mysql", label: "MySQL" },
  { id: "oracle", label: "Oracle" },
  { id: "postgresql", label: "PostgreSQL" },
  { id: "sqlserver", label: "SQL Server" },
  { id: "sqlite", label: "SQLite" },
  { id: "sybase", label: "Sybase" },
];

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toLogicalModel } from "../mld/transform";
import { emptyDocument } from "../model/factory";
import { reverseEngineer } from "../reverse/build";
import { AERO, docker, HOPITAL, MEDIATHEQUE, running, script } from "../testing/sgbdHarness";
import { generateDdl } from "./generate";

/** Client psql du conteneur PostgreSQL 18 et base recréée à vide. */
function postgres() {
  const psql = (input: string, db = "postgres") =>
    docker(
      ["exec", "-i", "merise-postgres", "psql", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"],
      input,
    );
  const fresh = (db: string) => psql(`DROP DATABASE IF EXISTS ${db};\nCREATE DATABASE ${db};`);
  return { psql, fresh };
}

/**
 * PostgreSQL 18 réel (override O-35, exécuté en CI) : les scripts générés passent, la sortie
 * d'avant ces travaux (fixtures/mediatheque_pg_v1.sql) échoue.
 */
describe.runIf(process.env.SGBD_DOCKER)("PostgreSQL 18 (Docker)", () => {
  const { psql, fresh } = postgres();

  it.runIf(running("merise-postgres"))("version 18", () => {
    expect(psql("SHOW server_version;").trim()).toMatch(/^18\./);
  });

  it.runIf(running("merise-postgres"))("médiathèque (MySQL → PostgreSQL 18) : s'exécute", () => {
    fresh("mediatheque");
    psql(script("postgresql", "18", MEDIATHEQUE), "mediatheque");
    const tables = psql("SELECT count(*) FROM pg_tables WHERE schemaname = 'public';", "mediatheque").trim();
    expect(tables).toBe("5");
    // Colonne virtuelle (PostgreSQL 18) et index unique sur préfixe présents.
    expect(
      psql(
        "SELECT attgenerated FROM pg_attribute WHERE attrelid = 'emprunt'::regclass AND attname = 'date_retour_prevue';",
        "mediatheque",
      ).trim(),
    ).toBe("v");
    expect(psql("SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_email_prefixe';", "mediatheque")).toMatch(
      /left"?\(\(email\)::text, 100\)/,
    );
  });
});

describe.runIf(process.env.SGBD_DOCKER)("PostgreSQL 18 (Docker)", () => {
  const { psql, fresh } = postgres();

  it.runIf(running("merise-postgres"))(
    "collations _ci / _ai → ICU non déterministe : comportement de MySQL (O-37, O-38)",
    () => {
      fresh("mediatheque_ci");
      psql(script("postgresql", "18", MEDIATHEQUE), "mediatheque_ci");
      // Définition effective : TEXT[] COLLATE merise_ai_ci, et num_carte sous la même collation.
      expect(
        psql(
          "SELECT a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || c.collname FROM pg_attribute a JOIN pg_collation c ON c.oid = a.attcollation WHERE a.attrelid = 'adherent'::regclass AND a.attname IN ('centres_interet', 'num_carte') ORDER BY a.attname;",
          "mediatheque_ci",
        )
          .trim()
          .split("\n"),
      ).toEqual(["centres_interet:text[]:merise_ai_ci", "num_carte:character(10):merise_ai_ci"]);
      // 'ABC123' puis 'abc123' : la seconde est rejetée (UNIQUE insensible à la casse).
      psql(
        "INSERT INTO adherent (num_carte, nom, email) VALUES ('ABC123', 'Zoé', 'Zoe@Exemple.fr');",
        "mediatheque_ci",
      );
      expect(() =>
        psql(
          "INSERT INTO adherent (num_carte, nom, email) VALUES ('abc123', 'Autre', 'autre@x.fr');",
          "mediatheque_ci",
        ),
      ).toThrow(/duplicate key.*num_carte/s);
      // CHECK <@ sur TEXT[] COLLATE merise_ai_ci : casse différente acceptée, valeur hors domaine refusée.
      psql("UPDATE adherent SET centres_interet = '{roman,BD}' WHERE num_carte = 'ABC123';", "mediatheque_ci");
      expect(() =>
        psql("UPDATE adherent SET centres_interet = '{roman,polar}' WHERE num_carte = 'ABC123';", "mediatheque_ci"),
      ).toThrow(/check constraint/);
      // Recherche insensible à la casse et aux accents, LIKE (PostgreSQL 18).
      expect(
        psql(
          "SELECT count(*) FROM adherent WHERE email = 'zoe@exemple.fr' AND nom = 'ZOE' AND nom LIKE 'zo%';",
          "mediatheque_ci",
        ).trim(),
      ).toBe("1");
    },
  );
});

describe.runIf(process.env.SGBD_DOCKER)("PostgreSQL 18 (Docker)", () => {
  const { psql, fresh } = postgres();

  it.runIf(running("merise-postgres"))(
    "hôpital (Oracle → PostgreSQL 18) : s'exécute, séquence, unicités, états des contraintes (O-39)",
    () => {
      fresh("hopital");
      psql(script("postgresql", "18", HOPITAL), "hopital");
      const run = (sql: string) => psql(sql, "hopital").trim();
      run(`INSERT INTO service (code_service, libelle) VALUES ('CHIR', 'Chirurgie');
         INSERT INTO personnel (nom, fonction, code_service, email) VALUES ('Durand', 'MEDECIN', 'CHIR', 'A.Durand@chu.fr');
         INSERT INTO "Patient" (nir, nom, date_naissance) VALUES ('123456789012345', 'Zoé', '1980-01-01');`);
      // INSERT dans sejour sans sejour_id : identifiant tiré de seq_sejour.
      expect(
        run(
          `INSERT INTO sejour (patient_id, code_service, date_entree, duree_prevue) SELECT id, 'CHIR', '2026-10-14 10:00', INTERVAL '2 days' FROM "Patient" RETURNING sejour_id, date_sortie_prevue;`,
        ).split("\n")[0],
      ).toBe("1|2026-10-16 10:00:00");
      // Unicité conditionnelle (un seul séjour en cours par patient), sur expression (e-mail sans casse).
      expect(() =>
        run(
          `INSERT INTO sejour (patient_id, code_service, date_entree) SELECT id, 'CHIR', '2026-10-15' FROM "Patient";`,
        ),
      ).toThrow(/ux_sejour_en_cours/);
      expect(() =>
        run(
          "INSERT INTO personnel (nom, fonction, code_service, email) VALUES ('B', 'ADMIN', 'CHIR', 'a.durand@CHU.fr');",
        ),
      ).toThrow(/ux_personnel_email/);
      // NULLS NOT DISTINCT, chaîne vide refusée sur NOT NULL, échelle négative.
      expect(() => run("INSERT INTO service (code_service, libelle) VALUES ('X', 'Chirurgie');")).toThrow(
        /uq_service_libelle/,
      );
      expect(() => run("INSERT INTO service (code_service, libelle) VALUES ('Y', '');")).toThrow(/check constraint/);
      expect(
        run("UPDATE service SET budget = 1234567 WHERE code_service = 'CHIR' RETURNING budget;").split("\n")[0],
      ).toBe("1235000");
      // États : ck_intervenir_super NOT VALID, ck_intervenir_cout absente (DISABLE), fk_service_chef différée.
      expect(
        run(
          "SELECT conname || ':' || convalidated FROM pg_constraint WHERE conname LIKE 'ck_intervenir%' ORDER BY 1;",
        ).split("\n"),
      ).toEqual(["ck_intervenir_super:false", "ck_intervenir_type:true"]);
      expect(
        run("SELECT condeferrable::text || condeferred::text FROM pg_constraint WHERE conname = 'fk_service_chef';"),
      ).toBe("truetrue");
      expect(
        run(
          "SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'sejour'::regclass AND attname IN ('sejour_id', 'patient_id', 'date_entree', 'duree_prevue') ORDER BY attnum;",
        ).split("\n"),
      ).toEqual(["bigint", "uuid", "timestamp(0) without time zone", "interval day to second(0)"]);
    },
  );
});

describe.runIf(process.env.SGBD_DOCKER)("PostgreSQL 18 (Docker)", () => {
  const { psql, fresh } = postgres();

  it.runIf(running("merise-postgres"))(
    "aérien (SQL Server → PostgreSQL 18) sans PostGIS (option de repli) : s'exécute, CI_AS, DEFAULT (O-41, O-42)",
    () => {
      fresh("aero");
      const result = generateDdl(
        toLogicalModel(reverseEngineer(AERO, emptyDocument()).doc),
        { dbms: "postgresql", version: "18" },
        { spatial: "wkb" },
      );
      if (!result.ok) {
        throw new Error(result.error);
      }
      psql(result.sql, "aero");
      const run = (sql: string) => psql(sql, "aero").trim();
      run(`INSERT INTO ref.aeroport (code_iata, code_oaci, nom, ville, pays) VALUES ('CDG', 'LFPG', 'Roissy', 'Paris', 'FR'), ('ORY', NULL, 'Orly', 'Paris', 'FR');
         INSERT INTO passager (nom, email) VALUES ('A', 'a@x.fr');`);
      // Hypothèse CI_AS : 'cdg' rejeté si 'CDG' existe ; recherche insensible à la casse ; CHECK à classes.
      expect(() =>
        run(
          "INSERT INTO ref.aeroport (code_iata, code_oaci, nom, ville, pays) VALUES ('cdg', 'LFPX', 'X', 'Paris', 'FR');",
        ),
      ).toThrow(/pk_aeroport/);
      expect(run("SELECT count(*) FROM ref.aeroport WHERE ville = 'PARIS';")).toBe("2");
      expect(() =>
        run(
          "INSERT INTO ref.aeroport (code_iata, code_oaci, nom, ville, pays) VALUES ('C1G', 'LFPY', 'X', 'X', 'FR');",
        ),
      ).toThrow(/ck_aeroport_iata/);
      run(
        "INSERT INTO ref.aeroport (code_iata, code_oaci, nom, ville, pays) VALUES ('bva', 'LFOB', 'Beauvais', 'Tillé', 'FR');",
      ); // minuscules admises (CI)
      // Un seul NULL admis (SQL Server), conservé.
      expect(() =>
        run("INSERT INTO ref.aeroport (code_iata, nom, ville, pays) VALUES ('LIL', 'Lille', 'Lille', 'FR');"),
      ).toThrow(/uq_aeroport_oaci/);
      expect(
        run(
          "INSERT INTO vol (numero, depart, arrivee, heure_depart, heure_arrivee) VALUES ('AF1', 'CDG', 'ORY', now(), now() + interval '1 hour'), ('AF2', 'ORY', 'cdg', now(), now() + interval '2 hours') RETURNING id_vol;",
        ).split("\n"),
      ).toEqual(["100", "110"]);
      run("UPDATE vol SET vol_retour = 110 WHERE id_vol = 100;");
      expect(() => run("UPDATE vol SET vol_retour = 110 WHERE id_vol = 110;")).toThrow(/ux_vol_retour/);
      expect(run("SELECT num_client FROM passager;")).toBe("10000");
      // INSERT dans reservation sans reserve_le : DEFAULT (heure UTC) appliqué.
      expect(
        run(
          "INSERT INTO reservation (id_vol, id_passager, prix) SELECT 100, id_passager, 200 FROM passager RETURNING reserve_le IS NOT NULL, prix_ttc;",
        ),
      ).toBe("t|220.000000");
    },
  );
});

describe.runIf(process.env.SGBD_DOCKER)("PostgreSQL 18 (Docker)", () => {
  it.runIf(running("merise-postgis"))(
    "aérien avec PostGIS (option par défaut) : CREATE EXTENSION postgis, GEOGRAPHY (O-42)",
    () => {
      const postgis = (input: string, db = "postgres") =>
        docker(
          [
            "exec",
            "-i",
            "merise-postgis",
            "psql",
            "-U",
            "postgres",
            "-d",
            db,
            "-v",
            "ON_ERROR_STOP=1",
            "-q",
            "-t",
            "-A",
          ],
          input,
        );
      postgis("DROP DATABASE IF EXISTS aero;\nCREATE DATABASE aero;");
      postgis(script("postgresql", "18", AERO), "aero");
      postgis(
        "INSERT INTO ref.aeroport (code_iata, code_oaci, nom, ville, pays, position) VALUES ('CDG', 'LFPG', 'Roissy', 'Paris', 'FR', 'SRID=4326;POINT(2.55 49.0097)');",
        "aero",
      );
      expect(
        postgis(
          "SELECT round(ST_Distance(position, 'SRID=4326;POINT(2.3522 48.8566)'::geography) / 1000) FROM ref.aeroport;",
          "aero",
        ).trim(),
      ).toBe("22");
    },
  );
});

describe.runIf(process.env.SGBD_DOCKER)("PostgreSQL 18 (Docker)", () => {
  const { psql, fresh } = postgres();

  it.runIf(running("merise-postgres"))("option sans ICU : collation déterministe, le script s'exécute (O-38)", () => {
    fresh("mediatheque_det");
    const result = generateDdl(
      toLogicalModel(reverseEngineer(MEDIATHEQUE, emptyDocument()).doc),
      { dbms: "postgresql", version: "18" },
      { collations: "deterministic" },
    );
    if (!result.ok) {
      throw new Error(result.error);
    }
    psql(result.sql, "mediatheque_det");
    psql(
      "INSERT INTO adherent (num_carte, nom, email) VALUES ('ABC123', 'A', 'a@x'), ('abc123', 'B', 'b@x');",
      "mediatheque_det",
    );
    expect(psql("SELECT count(*) FROM adherent;", "mediatheque_det").trim()).toBe("2"); // sensible à la casse : annoncé au rapport
  });

  it.runIf(running("merise-postgres"))("témoin négatif : la v1 échoue sur PostgreSQL 18", () => {
    fresh("mediatheque_v1");
    expect(() => psql(readFileSync("fixtures/mediatheque_pg_v1.sql", "utf8"), "mediatheque_v1")).toThrow(
      /boolean but default expression is of type integer/,
    );
  });

  it.runIf(running("merise-postgres"))("laboratoire (SQLite → PostgreSQL 18) : s'exécute (non-régression)", () => {
    fresh("labo");
    psql(script("postgresql", "18"), "labo");
    expect(psql("SELECT count(*) FROM pg_constraint WHERE contype = 'f';", "labo").trim()).toBe("11");
  });
});

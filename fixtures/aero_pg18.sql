-- Rapport de conversion vers PostgreSQL 18 : 13 élément(s) abandonné(s) ou dégradé(s)
--   • hypothèse : collation par défaut de la base SQL Server Latin1_General_CI_AS (absente du script), appliquée aux textes sans collation déclarée
--   • avion.version — ROWVERSION → BYTEA : sans équivalent, colonne ordinaire (plus mise à jour automatiquement)
--   • vol.id_vol — NOT FOR REPLICATION (option SQL Server) : sans équivalent, abandonnée
--   • DATETIMEOFFSET → TIMESTAMPTZ(0) : le décalage horaire d'origine est perdu (valeur ramenée à l'UTC) : vol.heure_depart, vol.heure_arrivee
--   • vol.duree — colonne calculée (DATEDIFF(MINUTE, heure_depart, heure_arrivee)) non traduite : colonne ordinaire
--   • passager.id_passager — ROWGUIDCOL (option SQL Server) : sans équivalent, abandonnée
--   • passager — contrainte ck_passager_remise désactivée (NOCHECK CONSTRAINT) dans la source : émise en commentaire, non appliquée
--   • passager.cree_le — DATETIME → TIMESTAMP(3) : arrondi d'origine au 1/300 s (.000, .003, .007) ; ici, à la milliseconde
--   • reservation — déclencheur trg_resa_vol_annule non traduit (code propre au SGBD d'origine)
--   • clauses de stockage (WITH (options d'index), ON [groupe de fichiers], CLUSTERED, TEXTIMAGE_ON) abandonnées : sans effet sur les données : aeroport, avion, passager

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE COLLATION IF NOT EXISTS merise_ci (provider = icu, locale = 'und-u-ks-level2', deterministic = false);

CREATE SCHEMA IF NOT EXISTS ref;

CREATE SEQUENCE ref.seq_client AS INTEGER START WITH 10000 INCREMENT BY 1 CACHE 1;

CREATE TABLE ref.aeroport(
   code_iata CHAR(3) COLLATE merise_ci CONSTRAINT ck_aeroport_iata CHECK (char_length(code_iata) = 3 AND code_iata COLLATE "C" !~* '^.*[^A-Z].*$'),
   code_oaci CHAR(4) COLLATE merise_ci,
   nom VARCHAR(120) COLLATE merise_ci NOT NULL,
   ville VARCHAR(80) COLLATE merise_ci NOT NULL,
   pays CHAR(2) COLLATE merise_ci NOT NULL,
   fuseau VARCHAR(40) COLLATE merise_ci,
   altitude_ft SMALLINT,
   position GEOGRAPHY,
   CONSTRAINT pk_aeroport PRIMARY KEY(code_iata),
   CONSTRAINT uq_aeroport_oaci UNIQUE NULLS NOT DISTINCT(code_oaci)
);

CREATE TABLE avion(
   immatriculation VARCHAR(10) COLLATE merise_ci,
   modele VARCHAR(60) COLLATE merise_ci NOT NULL,
   nb_sieges SMALLINT CHECK (nb_sieges > 0),
   date_mise_service DATE,
   hub CHAR(3) COLLATE merise_ci,
   en_service BOOLEAN DEFAULT TRUE NOT NULL,
   version BYTEA,
   fiche_technique XML,
   photo BYTEA,
   CONSTRAINT pk_avion PRIMARY KEY(immatriculation),
   CONSTRAINT fk_avion_hub FOREIGN KEY(hub) REFERENCES ref.aeroport(code_iata) ON DELETE SET NULL
);

CREATE TABLE vol(
   id_vol INTEGER GENERATED ALWAYS AS IDENTITY (START WITH 100 INCREMENT BY 10),
   numero VARCHAR(7) NOT NULL,
   depart CHAR(3) COLLATE merise_ci NOT NULL,
   arrivee CHAR(3) COLLATE merise_ci NOT NULL,
   heure_depart TIMESTAMPTZ(0) NOT NULL,
   heure_arrivee TIMESTAMPTZ(0) NOT NULL,
   duree INTEGER,
   avion VARCHAR(10) COLLATE merise_ci,
   vol_retour INTEGER,
   "Statut" VARCHAR(12) COLLATE merise_ci DEFAULT 'prevu' NOT NULL CONSTRAINT ck_vol_statut CHECK ("Statut" IN ('prevu', 'embarque', 'parti', 'annule')),
   CONSTRAINT pk_vol PRIMARY KEY(id_vol),
   CONSTRAINT uq_vol_numero_depart UNIQUE(numero, heure_depart),
   CONSTRAINT ux_vol_retour UNIQUE(vol_retour),
   CONSTRAINT ck_vol_trajet CHECK (depart <> arrivee),
   CONSTRAINT fk_vol_depart FOREIGN KEY(depart) REFERENCES ref.aeroport(code_iata),
   CONSTRAINT fk_vol_arrivee FOREIGN KEY(arrivee) REFERENCES ref.aeroport(code_iata),
   CONSTRAINT fk_vol_avion FOREIGN KEY(avion) REFERENCES avion(immatriculation) ON DELETE SET NULL ON UPDATE CASCADE,
   CONSTRAINT fk_vol_retour FOREIGN KEY(vol_retour) REFERENCES vol(id_vol)
);

CREATE TABLE passager(
   id_passager UUID DEFAULT uuidv7(),
   num_client INTEGER DEFAULT nextval('ref.seq_client') NOT NULL,
   nom VARCHAR(80) COLLATE merise_ci NOT NULL,
   prenom VARCHAR(80) COLLATE merise_ci,
   date_naissance DATE,
   email VARCHAR(254) COLLATE merise_ci,
   "Remise [%]" SMALLINT DEFAULT 0 NOT NULL CHECK ("Remise [%]" BETWEEN 0 AND 255),
   cree_le TIMESTAMP(3) DEFAULT LOCALTIMESTAMP NOT NULL,
   preferences TEXT COLLATE merise_ci CONSTRAINT ck_passager_json CHECK (preferences IS JSON),
   CONSTRAINT pk_passager PRIMARY KEY(id_passager),
   CONSTRAINT uq_passager_num UNIQUE(num_client),
   CONSTRAINT uq_passager_email UNIQUE NULLS NOT DISTINCT(email)
);
-- CONSTRAINT ck_passager_remise CHECK ("Remise [%]" <= 100) -- désactivée (NOCHECK CONSTRAINT) dans la source : non appliquée

CREATE TABLE reservation(
   id_vol INTEGER,
   id_passager UUID,
   siege VARCHAR(4) COLLATE merise_ci,
   classe CHAR(1) COLLATE merise_ci DEFAULT 'Y' NOT NULL CONSTRAINT ck_resa_classe CHECK (classe IN ('F', 'J', 'W', 'Y')),
   prix NUMERIC(19,4) NOT NULL,
   prix_ttc NUMERIC(23,6) GENERATED ALWAYS AS ((prix * 1.10)) STORED,
   reserve_le TIMESTAMP(3) DEFAULT (now() AT TIME ZONE 'UTC') NOT NULL,
   annule BOOLEAN DEFAULT FALSE NOT NULL,
   CONSTRAINT pk_reservation PRIMARY KEY(id_vol, id_passager),
   CONSTRAINT fk_resa_vol FOREIGN KEY(id_vol) REFERENCES vol(id_vol) ON DELETE CASCADE,
   CONSTRAINT fk_resa_passager FOREIGN KEY(id_passager) REFERENCES passager(id_passager) ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE vol ADD CONSTRAINT ck_vol_horaires CHECK (heure_arrivee > heure_depart) NOT VALID;

CREATE INDEX ix_aeroport_pays_ville ON ref.aeroport(pays, ville);

COMMENT ON TABLE vol IS 'Vols réguliers; un vol = un numéro + une heure de départ';

COMMENT ON COLUMN passager."Remise [%]" IS 'Remise en %; plafonnée à 100 -- cf. [CGV] /* art. 4 */';

CREATE UNIQUE INDEX ux_resa_siege ON reservation(id_vol, siege) INCLUDE (classe) WHERE siege IS NOT NULL AND annule = FALSE;

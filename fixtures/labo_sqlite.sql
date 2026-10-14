PRAGMA foreign_keys = ON;

/* =====================================================================
   Domaine : laboratoires de recherche, projets, phases, participations
   ===================================================================== */

-- T1 : réflexive (mentor), FK composite vers une table pas encore créée,
--      colonnes FK nommées différemment des colonnes référencées
CREATE TABLE IF NOT EXISTS chercheur (
    id_chercheur   INTEGER PRIMARY KEY AUTOINCREMENT,
    nom            VARCHAR(50)  NOT NULL,
    prenom         VARCHAR(50),
    email          VARCHAR(120) NOT NULL UNIQUE,
    grade          TEXT DEFAULT 'doctorant'
                   CHECK (grade IN ('doctorant', 'MCF', 'PR', 'DR')),
    date_embauche  DATE,
    id_mentor      INTEGER REFERENCES chercheur (id_chercheur) ON DELETE SET NULL,
    labo_code      CHAR(6),      -- ≠ code_labo
    labo_site      VARCHAR(30),  -- ≠ site
    CONSTRAINT fk_chercheur_labo
        FOREIGN KEY (labo_code, labo_site)
        REFERENCES "Laboratoire" (code_labo, site)
);

-- T2 : identifiant composite, nom de table entre guillemets,
--      FK NOT NULL + UNIQUE => association 1:1 (circulaire avec T1)
CREATE TABLE "Laboratoire" (
    code_labo     CHAR(6)       NOT NULL,
    site          VARCHAR(30)   NOT NULL,
    nom_labo      VARCHAR(100)  NOT NULL,
    budget        DECIMAL(12,2) CHECK (budget >= 0),
    id_directeur  INTEGER       NOT NULL UNIQUE,
    PRIMARY KEY (code_labo, site),
    FOREIGN KEY (id_directeur) REFERENCES chercheur (id_chercheur)
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- T3 : mots-clés en minuscules, toutes contraintes nommées au niveau table,
--      deux FK vers la même table (deux rôles), UNIQUE composite incluant une FK
create table projet (
    id_projet         integer      not null,
    titre             varchar(200) not null,
    acronyme          varchar(20),
    date_debut        date         not null,
    date_fin          date,
    code_labo         char(6)      not null,
    site              varchar(30)  not null,
    id_responsable    integer      not null,
    id_coresponsable  integer,
    constraint pk_projet          primary key (id_projet),
    constraint uq_projet_acronyme unique (acronyme, code_labo, site),
    constraint ck_projet_dates    check (date_fin is null or date_fin > date_debut),
    constraint ck_resp_distincts  check (id_coresponsable <> id_responsable),
    constraint fk_projet_labo     foreign key (code_labo, site)
                                  references "Laboratoire" (code_labo, site),
    constraint fk_projet_resp     foreign key (id_responsable)
                                  references chercheur (id_chercheur),
    constraint fk_projet_coresp   foreign key (id_coresponsable)
                                  references chercheur (id_chercheur)
);

-- T4 : entité faible (identification relative à PROJET),
--      REFERENCES sans liste de colonnes (PK implicite),
--      réflexive composite partageant une colonne avec la PK
CREATE TABLE phase (
    id_projet             INTEGER  NOT NULL REFERENCES projet ON DELETE CASCADE,
    num_phase             SMALLINT NOT NULL CHECK (num_phase > 0),
    libelle               VARCHAR(80) NOT NULL,
    duree_semaines        INTEGER,
    num_phase_precedente  SMALLINT,
    PRIMARY KEY (id_projet, num_phase),
    FOREIGN KEY (id_projet, num_phase_precedente)
        REFERENCES phase (id_projet, num_phase)
);

-- T5 : table d'association porteuse d'attributs, PK = FK simple + FK composite,
--      FK composite supplémentaire HORS de la PK, colonne au nom réservé quotée
CREATE TABLE participer (
    id_chercheur      INTEGER     NOT NULL,
    id_projet         INTEGER     NOT NULL,
    num_phase         SMALLINT    NOT NULL,
    code_labo         CHAR(6)     NOT NULL,
    site              VARCHAR(30) NOT NULL,
    "role"            VARCHAR(30) DEFAULT 'contributeur',
    taux_implication  REAL CHECK (taux_implication > 0 AND taux_implication <= 1),
    date_affectation  DATE DEFAULT CURRENT_DATE,
    PRIMARY KEY (id_chercheur, id_projet, num_phase),
    FOREIGN KEY (id_chercheur) REFERENCES chercheur (id_chercheur) ON DELETE CASCADE,
    FOREIGN KEY (id_projet, num_phase) REFERENCES phase (id_projet, num_phase) ON DELETE CASCADE,
    FOREIGN KEY (code_labo, site) REFERENCES "Laboratoire" (code_labo, site)
);

-- Bruit : index non unique, que le parser doit ignorer sans planter
CREATE INDEX ix_participer_labo ON participer (code_labo, site);

-- =====================================================================
--  Compagnie aérienne : cible SQL Server 2016+ (SSMS / sqlcmd)
-- =====================================================================
SET ANSI_NULLS ON
GO
SET QUOTED_IDENTIFIER ON
GO
IF DB_ID(N'aero') IS NULL CREATE DATABASE aero;
GO
USE aero;
GO

DROP TABLE IF EXISTS dbo.reservation, dbo.passager, dbo.vol, dbo.avion, ref.aeroport;
DROP SEQUENCE IF EXISTS ref.seq_client;
GO

/* Ancienne version /* commentaire imbriqué */
   CREATE TABLE fantome (id int);   -- ne doit PAS être parsée
*/

-- Schéma créé par SQL dynamique : CREATE SCHEMA doit être seul dans son lot
IF SCHEMA_ID(N'ref') IS NULL EXEC (N'CREATE SCHEMA ref AUTHORIZATION dbo');
GO

CREATE SEQUENCE ref.seq_client AS INT START WITH 10000 INCREMENT BY 1 NO CACHE;
GO

-- T1 : style SSMS (types entre crochets, options d'index, ON [PRIMARY]),
--      PK NONCLUSTERED + index CLUSTERED ailleurs, UNIQUE sur colonne nullable
--      (un seul NULL admis), type spatial
CREATE TABLE [ref].[aeroport](
    [code_iata]   [char](3)       NOT NULL,
    [code_oaci]   [char](4)       NULL,
    [nom]         [nvarchar](120) NOT NULL,
    [ville]       [nvarchar](80)  NOT NULL,
    [pays]        [char](2)       NOT NULL,
    [fuseau]      [varchar](40)   NULL,
    [altitude_ft] [smallint]      NULL,
    [position]    [geography]     NULL,
 CONSTRAINT [pk_aeroport] PRIMARY KEY NONCLUSTERED ([code_iata] ASC)
    WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF,
          ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY],
 CONSTRAINT [uq_aeroport_oaci] UNIQUE NONCLUSTERED ([code_oaci] ASC)
) ON [PRIMARY]
GO

ALTER TABLE [ref].[aeroport] WITH CHECK ADD CONSTRAINT [ck_aeroport_iata]
    CHECK ((len([code_iata])=(3) AND [code_iata] NOT LIKE '%[^A-Z]%'))
GO
ALTER TABLE [ref].[aeroport] CHECK CONSTRAINT [ck_aeroport_iata]
GO
CREATE CLUSTERED INDEX [ix_aeroport_pays_ville] ON [ref].[aeroport] ([pays] ASC, [ville] ASC)
GO

-- T2 : FK inline vers un autre schéma, BIT avec DEFAULT nommé ((1)),
--      ROWVERSION, XML, VARBINARY(MAX), TEXTIMAGE_ON
CREATE TABLE dbo.avion (
    immatriculation    VARCHAR(10)  NOT NULL CONSTRAINT pk_avion PRIMARY KEY,
    modele             NVARCHAR(60) NOT NULL,
    nb_sieges          SMALLINT     NULL CHECK (nb_sieges > 0),
    date_mise_service  DATE         NULL,
    hub                CHAR(3)      NULL CONSTRAINT fk_avion_hub
                       REFERENCES ref.aeroport (code_iata) ON DELETE SET NULL,
    en_service         BIT          NOT NULL CONSTRAINT df_avion_en_service DEFAULT ((1)),
    version            ROWVERSION,
    fiche_technique    XML          NULL,
    photo              VARBINARY(MAX) NULL
) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY];
GO

-- T3 : IDENTITY(100,10) NOT FOR REPLICATION, deux rôles vers aeroport,
--      DATETIMEOFFSET, colonne calculée NON persistée (DATEDIFF), identifiant
--      entre guillemets doubles, collation explicite, réflexive en NO ACTION
--      (SQL Server interdit les cascades sur une auto-référence)
CREATE TABLE dbo.vol (
    id_vol         INT IDENTITY(100, 10) NOT FOR REPLICATION NOT NULL,
    numero         VARCHAR(7) COLLATE Latin1_General_CS_AS NOT NULL,
    depart         CHAR(3) NOT NULL,
    arrivee        CHAR(3) NOT NULL,
    heure_depart   DATETIMEOFFSET(0) NOT NULL,
    heure_arrivee  DATETIMEOFFSET(0) NOT NULL,
    duree          AS DATEDIFF(MINUTE, heure_depart, heure_arrivee),
    avion          VARCHAR(10) NULL,
    vol_retour     INT NULL,
    "Statut"       VARCHAR(12) NOT NULL CONSTRAINT df_vol_statut DEFAULT 'prevu',
    CONSTRAINT pk_vol PRIMARY KEY CLUSTERED (id_vol),
    CONSTRAINT uq_vol_numero_depart UNIQUE (numero, heure_depart),
    CONSTRAINT ck_vol_trajet CHECK (depart <> arrivee),
    CONSTRAINT ck_vol_statut CHECK ("Statut" IN ('prevu', 'embarque', 'parti', 'annule')),
    CONSTRAINT fk_vol_depart  FOREIGN KEY (depart)  REFERENCES ref.aeroport (code_iata),
    CONSTRAINT fk_vol_arrivee FOREIGN KEY (arrivee) REFERENCES ref.aeroport (code_iata),
    CONSTRAINT fk_vol_avion   FOREIGN KEY (avion)   REFERENCES dbo.avion (immatriculation)
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT fk_vol_retour  FOREIGN KEY (vol_retour) REFERENCES dbo.vol (id_vol)
);
GO

-- Index filtré : idiome SQL Server pour « UNIQUE avec plusieurs NULL »
-- (ici : un vol a au plus un vol retour, et réciproquement → 1:1 réflexive)
CREATE UNIQUE NONCLUSTERED INDEX ux_vol_retour ON dbo.vol (vol_retour)
    WHERE vol_retour IS NOT NULL;
GO

-- Contrainte ajoutée sans vérifier l'existant (non « trusted »)
ALTER TABLE dbo.vol WITH NOCHECK ADD CONSTRAINT ck_vol_horaires
    CHECK (heure_arrivee > heure_depart);
GO

-- T4 : UNIQUEIDENTIFIER + NEWSEQUENTIALID + ROWGUIDCOL, PK NONCLUSTERED,
--      DEFAULT sur séquence, UNIQUE nullable (un seul NULL), nom de colonne
--      avec crochet échappé, TINYINT (0–255), DATETIME, JSON via ISJSON
CREATE TABLE dbo.passager (
    id_passager     UNIQUEIDENTIFIER ROWGUIDCOL NOT NULL
                    CONSTRAINT df_passager_id DEFAULT NEWSEQUENTIALID(),
    num_client      INT NOT NULL
                    CONSTRAINT df_passager_num DEFAULT (NEXT VALUE FOR ref.seq_client),
    nom             NVARCHAR(80) NOT NULL,
    prenom          NVARCHAR(80) NULL,
    date_naissance  DATE NULL,
    email           VARCHAR(254) NULL,
    [Remise [%]]]   TINYINT NOT NULL CONSTRAINT df_passager_remise DEFAULT 0,
    cree_le         DATETIME NOT NULL CONSTRAINT df_passager_cree DEFAULT GETDATE(),
    preferences     NVARCHAR(MAX) NULL,
    CONSTRAINT pk_passager PRIMARY KEY NONCLUSTERED (id_passager),
    CONSTRAINT uq_passager_num UNIQUE CLUSTERED (num_client),
    CONSTRAINT uq_passager_email UNIQUE (email),
    CONSTRAINT ck_passager_remise CHECK ([Remise [%]]] <= 100),
    CONSTRAINT ck_passager_json CHECK (ISJSON(preferences) = 1)
);
GO

-- Contrainte DÉSACTIVÉE (équivalent du DISABLE Oracle)
ALTER TABLE dbo.passager NOCHECK CONSTRAINT ck_passager_remise;
GO

-- T5 : association pure (PK = 2 FK), MONEY, colonne calculée PERSISTED,
--      DEFAULT ajouté par ALTER ... FOR, index filtré avec INCLUDE et prédicat sur BIT
CREATE TABLE dbo.reservation (
    id_vol       INT NOT NULL,
    id_passager  UNIQUEIDENTIFIER NOT NULL,
    siege        VARCHAR(4) NULL,
    classe       CHAR(1) NOT NULL CONSTRAINT df_resa_classe DEFAULT 'Y',
    prix         MONEY NOT NULL,
    prix_ttc     AS (prix * 1.10) PERSISTED,
    reserve_le   DATETIME2(3) NOT NULL,
    annule       BIT NOT NULL CONSTRAINT df_resa_annule DEFAULT 0,
    CONSTRAINT pk_reservation PRIMARY KEY CLUSTERED (id_vol, id_passager),
    CONSTRAINT ck_resa_classe CHECK (classe IN ('F', 'J', 'W', 'Y')),
    CONSTRAINT fk_resa_vol FOREIGN KEY (id_vol) REFERENCES dbo.vol (id_vol)
        ON DELETE CASCADE,
    CONSTRAINT fk_resa_passager FOREIGN KEY (id_passager) REFERENCES dbo.passager (id_passager)
        ON DELETE CASCADE ON UPDATE CASCADE
);
GO

ALTER TABLE dbo.reservation ADD CONSTRAINT df_resa_date DEFAULT SYSUTCDATETIME() FOR reserve_le;
GO

CREATE UNIQUE NONCLUSTERED INDEX ux_resa_siege ON dbo.reservation (id_vol, siege)
    INCLUDE (classe)
    WHERE siege IS NOT NULL AND annule = 0;
GO

-- Trigger T-SQL (doit être seul dans son lot)
CREATE TRIGGER dbo.trg_resa_vol_annule ON dbo.reservation AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM inserted i
               JOIN dbo.vol v ON v.id_vol = i.id_vol
               WHERE v."Statut" = N'annule')
    BEGIN
        RAISERROR (N'Vol annulé; réservation impossible', 16, 1);
        ROLLBACK TRANSACTION;
        RETURN;
    END
END;
GO

-- Commentaires : propriétés étendues MS_Description
EXEC sys.sp_addextendedproperty @name = N'MS_Description',
     @value = N'Vols réguliers; un vol = un numéro + une heure de départ',
     @level0type = N'SCHEMA', @level0name = N'dbo',
     @level1type = N'TABLE',  @level1name = N'vol';
GO
EXEC sys.sp_addextendedproperty @name = N'MS_Description',
     @value = N'Remise en %; plafonnée à 100 -- cf. [CGV] /* art. 4 */',
     @level0type = N'SCHEMA', @level0name = N'dbo',
     @level1type = N'TABLE',  @level1name = N'passager',
     @level2type = N'COLUMN', @level2name = N'Remise [%]';
GO

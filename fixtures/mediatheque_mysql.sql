-- =====================================================================
--  Médiathèque : cible MySQL 8.0.16+ / MariaDB 10.5+
-- =====================================================================
/*!40101 SET NAMES utf8mb4 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;

CREATE DATABASE IF NOT EXISTS `mediatheque`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `mediatheque`;

DROP TABLE IF EXISTS `emprunt`, `Exemplaire`, `adherent_premium`, `oeuvre`, `adherent`;

/* Ancienne version, à NE PAS parser :
   CREATE TABLE fantome (id INT PRIMARY KEY); */

# T1 : REFERENCES inline, ENUM, SET (multivalué), TIMESTAMP auto, UNIQUE sur préfixe
CREATE TABLE `adherent` (
  `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `num_carte`        CHAR(10) NOT NULL UNIQUE,
  `nom`              VARCHAR(100) NOT NULL,
  `email`            VARCHAR(255) NOT NULL,
  `parrain_id`       INT UNSIGNED NULL REFERENCES `adherent` (`id`) ON DELETE SET NULL,
  `statut`           ENUM('actif','suspendu','radié') NOT NULL DEFAULT 'actif',
  `centres_interet`  SET('roman','bd','jeunesse','sf','essai'),
  `est_mineur`       TINYINT(1) NOT NULL DEFAULT 0,
  `cree_le`          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `maj_le`           TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`) USING BTREE,
  UNIQUE KEY `uq_email_prefixe` (`email`(100)),
  KEY `ix_parrain` (`parrain_id`)
) ENGINE=InnoDB AUTO_INCREMENT=1000 DEFAULT CHARSET=utf8mb4
  COMMENT='Adhérents; parrain_id porte un REFERENCES « inline »';

# T2 : FK vers une table pas encore créée (permis par FOREIGN_KEY_CHECKS=0),
#      réflexive vers un identifiant ALTERNATIF, colonne calculée, charset de colonne,
#      chaînes piégées dans les COMMENT
CREATE TABLE oeuvre (
  id_oeuvre        INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  isbn             CHAR(13) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  titre            VARCHAR(255) NOT NULL,
  `type`           ENUM('livre','bd','dvd','cd') NOT NULL,
  annee            YEAR,
  prix_ht          DECIMAL(8,2) UNSIGNED
                   COMMENT 'Prix HT -- hors remise; voir /* règle 3 */ l''ancien barème',
  prix_ttc         DECIMAL(8,2) GENERATED ALWAYS AS (ROUND(prix_ht * 1.055, 2)) STORED,
  isbn_originale   CHAR(13) CHARACTER SET ascii COLLATE ascii_bin NULL
                   COMMENT "Traduction de l'œuvre (\"VO\")",
  `desc`           TEXT,
  recommandee_par  INT UNSIGNED,
  CONSTRAINT uq_isbn UNIQUE INDEX (isbn),
  FULLTEXT KEY ft_titre (titre),
  CONSTRAINT fk_oeuvre_vo   FOREIGN KEY (isbn_originale) REFERENCES oeuvre (isbn)
                            ON DELETE SET NULL,
  CONSTRAINT fk_oeuvre_reco FOREIGN KEY (recommandee_par)
                            REFERENCES adherent_premium (adherent_id) ON DELETE SET NULL,
  CONSTRAINT ck_annee CHECK (annee IS NULL OR annee >= 1901)
) ENGINE = InnoDB;

# T3 : PK = FK (spécialisation ou 1:1 ?), cycle avec oeuvre fermé par ALTER plus bas
CREATE TABLE adherent_premium (
  adherent_id        INT UNSIGNED NOT NULL,
  niveau             TINYINT UNSIGNED NOT NULL DEFAULT 1,
  date_souscription  DATE NOT NULL,
  cotisation         DECIMAL(6,2) NOT NULL,
  oeuvre_favorite    INT UNSIGNED DEFAULT NULL,
  PRIMARY KEY (adherent_id),
  CONSTRAINT fk_premium_adherent FOREIGN KEY (adherent_id) REFERENCES adherent (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT ck_niveau CHECK (niveau BETWEEN 1 AND 3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

# T4 : entité faible, nom de table avec majuscule, référence qualifiée par la base,
#      nom d'index dans la clause FOREIGN KEY, USING HASH
CREATE TABLE `Exemplaire` (
  `id_oeuvre`         INT UNSIGNED NOT NULL,
  `num_ex`            SMALLINT UNSIGNED NOT NULL,
  `code_barre`        VARCHAR(20) NOT NULL,
  `etat`              ENUM('neuf','bon','abîmé','pilonné') DEFAULT 'neuf',
  `date_acquisition`  DATE,
  PRIMARY KEY (`id_oeuvre`, `num_ex`),
  UNIQUE INDEX `uq_code_barre` USING HASH (`code_barre`),
  CONSTRAINT `fk_ex_oeuvre` FOREIGN KEY `ix_ex_oeuvre` (`id_oeuvre`)
    REFERENCES `mediatheque`.`oeuvre` (`id_oeuvre`) ON DELETE CASCADE
) ENGINE=InnoDB;

# T5 : PK = FK simple + FK composite + colonne NON-FK (date), colonne VIRTUAL, JSON
CREATE TABLE emprunt (
  adherent_id         INT UNSIGNED NOT NULL,
  id_oeuvre           INT UNSIGNED NOT NULL,
  num_ex              SMALLINT UNSIGNED NOT NULL,
  date_emprunt        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  date_retour_prevue  DATE AS (DATE(date_emprunt) + INTERVAL 21 DAY) VIRTUAL,
  date_retour         DATETIME NULL,
  penalite            DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  details             JSON,
  remarque            VARCHAR(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  PRIMARY KEY (adherent_id, id_oeuvre, num_ex, date_emprunt),
  KEY ix_emprunt_ex (id_oeuvre, num_ex, date_retour),
  CONSTRAINT fk_emprunt_adherent FOREIGN KEY (adherent_id) REFERENCES adherent (id),
  CONSTRAINT fk_emprunt_ex FOREIGN KEY (id_oeuvre, num_ex)
    REFERENCES `Exemplaire` (id_oeuvre, num_ex) ON UPDATE CASCADE,
  CONSTRAINT ck_retour   CHECK (date_retour IS NULL OR date_retour >= date_emprunt),
  CONSTRAINT ck_penalite CHECK (penalite >= 0)
) ENGINE=InnoDB;

-- Fermeture du cycle oeuvre <-> adherent_premium, ALTER multi-clauses
ALTER TABLE adherent_premium
  ADD CONSTRAINT fk_premium_favori FOREIGN KEY (oeuvre_favorite)
      REFERENCES oeuvre (id_oeuvre) ON DELETE SET NULL,
  ADD INDEX ix_favori (oeuvre_favorite);

# Trigger : corps contenant des « ; », d'où le DELIMITER (commande client, pas SQL)
DELIMITER $$
CREATE TRIGGER trg_emprunt_statut
BEFORE INSERT ON emprunt
FOR EACH ROW
BEGIN
  DECLARE v_statut VARCHAR(10);
  SELECT statut INTO v_statut FROM adherent WHERE id = NEW.adherent_id;
  IF v_statut <> 'actif' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Adhérent non actif; emprunt refusé';
  END IF;
END$$
DELIMITER ;

/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;

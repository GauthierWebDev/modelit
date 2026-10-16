# ModelIt

**ModelIt** est un logiciel de modélisation de bases de données selon la méthode **Merise**. On
dessine le modèle conceptuel (MCD : entités, associations, cardinalités, héritages) ; ModelIt en
déduit en temps réel le modèle logique (MLD), le modèle physique pour le SGBD choisi (MPD) et le
script SQL de création des tables.

- **Neuf SGBD cibles** : PostgreSQL, MySQL, MariaDB, SQL Server, Oracle, SQLite, DB2, Sybase,
  Access, avec leur version.
- **Rétroconception** : un script SQL existant, de n'importe lequel de ces SGBD, redevient un MCD.
- **Trois vues** d'un même modèle (MCD, MLD, MPD), placement automatique lisible, export d'image.
- Application **native** pour macOS, Windows et Linux, en français et en anglais, avec mises à
  jour automatiques. Libre et gratuite (GPL-3.0).

## Installation

### Depuis les releases (recommandé)

Télécharger l'installeur de son système sur la
[dernière release](https://github.com/GauthierWebDev/modelit/releases/latest) :

| Système | Fichier |
|---|---|
| macOS ≥ 13.3 (Apple Silicon et Intel) | `ModelIt_<version>_universal.dmg` |
| Windows (x64) | `ModelIt_<version>_x64-setup.exe` (ou `…_x64_en-US.msi`) |
| Linux (x86-64) | `ModelIt_<version>_amd64.AppImage`, `…_amd64.deb` ou `ModelIt-<version>-1.x86_64.rpm` |

Les fichiers `.sig`, `latest.json` et `.app.tar.gz` servent aux mises à jour automatiques.

Les binaires ne sont pas signés par Apple ni par Microsoft :

- **macOS** : après avoir glissé ModelIt dans Applications, Gatekeeper le dit « endommagé » tant
  que l'attribut de quarantaine n'est pas retiré : `xattr -cr /Applications/ModelIt.app`.
- **Windows** : SmartScreen avertit ; « Informations complémentaires » → « Exécuter quand même ».

Une fois installé, ModelIt cherche les nouvelles versions à chaque lancement (désactivable dans les
options générales) et les installe sur accord.

### Depuis le code source

Prérequis : Node.js ≥ 20 et pnpm ; pour l'application native, Rust via [rustup](https://rustup.rs)
et, sous macOS, les Xcode Command Line Tools (`xcode-select --install`).

```sh
git clone https://github.com/GauthierWebDev/modelit.git
cd modelit
pnpm install
pnpm tauri dev      # lance l'application native
pnpm tauri build    # ou produit l'installeur du système courant (src-tauri/target/…/bundle)
```

`pnpm dev` lance l'interface seule dans le navigateur (http://localhost:1420), sans les fonctions
natives (fichiers, fenêtres flottantes, session collaborative). Une copie construite ainsi ne se
met pas à jour automatiquement : seules les releases le font.

## Prise en main

- **⌘/Ctrl + 1, 2, 3** : vues MCD, MLD, MPD.
- **E** / **A** / **H** / **L** / **V** : outils Entité, Association, Héritage, Lien, Sélection. Entité et
  Lien marchent aussi dans le MLD et le MPD (relier deux tables crée l'association) ; Association et
  Héritage sont réservés au MCD.
  Clic droit : abandon de la création en cours et retour à la Sélection.
- Cliquer dans le vide pour créer une entité ou une association.
- Outil Lien : cliquer (ou glisser) d'une entité à une autre crée l'association entre elles ;
  d'une association à une entité, ajoute une patte.
- Héritage : créer le triangle, le relier aux entités avec l'outil Lien, choisir l'entité cible
  et la contrainte (X, T, XT) dans le panneau de droite.
- **Rétroconception** (menu ≡ de la barre d'outils) : coller ou ouvrir un script SQL de n'importe
  quel SGBD (dialecte détecté ou imposé) pour reconstruire le MCD. CHECK, DEFAULT, UNIQUE, index,
  noms de contraintes, actions ON DELETE / ON UPDATE et types d'origine sont conservés en
  annotations physiques et réappliqués au script ; vues, fonctions… sont ignorées.
- **Rapport de pertes** : ce que le SGBD cible ne sait pas exprimer est listé au-dessus du script
  (onglet Script LDD) et en commentaire en tête de celui-ci, une ligne par perte identique. Options
  du script (FK en ALTER TABLE, index, ordre des colonnes, noms des contraintes, non-signés, ENUM,
  SET, collations, DATE Oracle, chaîne vide Oracle, fidélité stricte des plages, types spatiaux, collation SQL Server supposée, schéma dbo) : paramètres du modèle, section « Script SQL ».
- **Section Rubriques** : liste compacte des rubriques de l'objet sélectionné (Entrée pour enchaîner
  les saisies, Alt + ↑ / ↓ ou glisser pour réordonner, Suppr pour supprimer) et détail de la rubrique
  choisie.
- **Blocs « Avancé »** (repliables, dans les Propriétés et le détail d'une rubrique) : DEFAULT, CHECK,
  type d'origine, casse, index et identifiants alternatifs.
- **⌘/Ctrl + E** : exporter l'image (SVG, PNG, JPG, WEBP ; fond transparent ou uni).
- **⌘/Ctrl + ,** : options générales (thème, langue FR / EN, lissage des cassures, réglages des
  nouveaux modèles, sauvegarde automatique).
- **Placement auto.** (barre d'outils, et après une rétroconception) : range tout le MCD sur une
  grille sans traits qui se croisent ni traversent un objet, en dégageant les cardinalités ;
  disposition commune au MCD, au MLD et au MPD ; calcul en ≈ 0,2 s, en parallèle.
- **⌘/Ctrl + C, X, V, D** : copier, couper, coller, dupliquer la sélection, dans les trois vues (noms
  suffixés « _2 », copies décalées ; presse-papiers du système, entre onglets et fenêtres).
- **Menu ≡** (barre d'outils) : fichier, export d'image, rétroconception, sections affichées, thème,
  options et à propos, avec leurs raccourcis.
- **Barre d'état** : sélection, problèmes (clic : section Problèmes), zoom, et SGBD cible et version
  (boîte « Cible »).
- Les sections de droite éditent l'objet sélectionné (Propriétés, Rubriques) et les paramètres du
  document (Modèle).
- Le MLD textuel, le script SQL et les problèmes se mettent à jour en temps réel.
- ⌘/Ctrl + Z, ⇧⌘/Ctrl + Z, ⌘/Ctrl + S, ⌘/Ctrl + O, ⌘/Ctrl + N, Suppr, ⌘/Ctrl + A, ⌘/Ctrl + I.
- Molette : défilement ; ⌘/Ctrl + molette ou pincement : zoom ; ⇧F : ajuster à la fenêtre.

## Développement

### Prérequis

- Node.js ≥ 20 et pnpm
- Pour l'application native : Rust via [rustup](https://rustup.rs)
  (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)
  et, sous macOS, les Xcode Command Line Tools (`xcode-select --install`).

### Commandes

| Commande | Effet |
|---|---|
| `pnpm install` | Installe les dépendances |
| `pnpm tauri dev` | Lance l'application native avec rechargement à chaud |
| `pnpm tauri build` | Produit l'installeur de la plateforme courante |
| `pnpm dev` | Lance l'interface seule dans le navigateur (http://localhost:1420) |
| `pnpm test` | Tests du cœur métier (Vitest) |
| `pnpm typecheck` | Vérification TypeScript |
| `scripts/sgbd.sh up` puis `wait` | Démarre PostgreSQL 18 (et PostGIS), MySQL, Oracle et SQL Server dans Docker (facultatif ; ex. `up postgres postgis mysql`) |
| `pnpm test:sgbd` | Exécute réellement les scripts générés sur ces SGBD (`scripts/sgbd.sh down` ensuite) |

### Intégration continue et release

`.github/workflows/ci.yml` : tests sur Linux, Windows et macOS, scripts SQL exécutés sur
PostgreSQL et MySQL (Docker), puis build de l'application native sur les trois OS. Sur `main` et
les pull requests, les installeurs sont joints au run (artefacts, 7 jours).

La version est définie dans `package.json` uniquement (Tauri la lit). Pour publier :

1. passer `version` de `package.json` à la nouvelle version (ex. 0.2.0) ;
2. ajouter en tête de `CHANGELOG.md` la section `## 0.2.0 — AAAA-MM-JJ` (obligatoire : vérifiée
   par les tests). Elle devient le texte de la release GitHub, les notes proposées par la mise à
   jour, et s'affiche dans l'application (À propos → Nouveautés, ouvert une fois après la mise à jour) ;
3. committer, puis `git tag v0.2.0 && git push origin v0.2.0`.

Le tag produit une release GitHub en brouillon : macOS (universel Apple Silicon + Intel,
macOS ≥ 13.3), Windows (MSI, NSIS), Linux (deb, rpm, AppImage), avec `latest.json` et les
signatures de mise à jour. Une fois la release publiée, les applications installées la proposent
(à chaque lancement, ou via Options → Rechercher maintenant).

**Clé de signature des mises à jour** : la clé publique est dans `src-tauri/tauri.conf.json`, la
clé privée dans le secret GitHub `TAURI_SIGNING_PRIVATE_KEY` (et son mot de passe éventuel dans
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`). Sans elle, plus aucune mise à jour ne peut être publiée
pour les versions installées : la conserver hors du dépôt, en lieu sûr.

Les binaires ne sont pas signés par Apple ni par Microsoft : sous macOS, Gatekeeper bloque
l'application (« endommagée ») tant que l'attribut de quarantaine n'est pas retiré
(`xattr -cr /Applications/ModelIt.app`) ; sous Windows, SmartScreen avertit (« Informations
complémentaires » → « Exécuter quand même »). Les mises à jour, téléchargées par l'application,
ne sont pas concernées.

## Licence

© 2026 Gauthier DANIELS — [GPL-3.0-or-later](LICENSE). ModelIt est un logiciel libre : vous pouvez
le redistribuer et le modifier selon les termes de la licence publique générale GNU, version 3 ou
ultérieure. Toute version modifiée et redistribuée doit rester sous cette licence, avec son code
source et les mentions de copyright d'origine.

Police Inter : SIL Open Font License 1.1.

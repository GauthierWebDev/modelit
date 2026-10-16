# ModelIt

Outil de modélisation de données Merise (MCD → MLD → SQL), natif sur macOS, Linux et Windows.

## Prérequis

- Node.js ≥ 20 et pnpm
- Pour l'application native : Rust via [rustup](https://rustup.rs)
  (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)
  et, sous macOS, les Xcode Command Line Tools (`xcode-select --install`).

## Commandes

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

## Intégration continue et release

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
(au lancement, au plus une fois par jour, ou via Options → Rechercher maintenant).

**Clé de signature des mises à jour** : la clé publique est dans `src-tauri/tauri.conf.json`, la
clé privée dans le secret GitHub `TAURI_SIGNING_PRIVATE_KEY` (et son mot de passe éventuel dans
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`). Sans elle, plus aucune mise à jour ne peut être publiée
pour les versions installées : la conserver hors du dépôt, en lieu sûr.

Les binaires ne sont pas signés par Apple ni par Microsoft : sous macOS, Gatekeeper bloque
l'application (« endommagée ») tant que l'attribut de quarantaine n'est pas retiré
(`xattr -cr /Applications/ModelIt.app`) ; sous Windows, SmartScreen avertit (« Informations
complémentaires » → « Exécuter quand même »). Les mises à jour, téléchargées par l'application,
ne sont pas concernées.

## Utilisation rapide

- **⌘/Ctrl + 1, 2, 3** : vues MCD, MLD, MPD.
- **E** / **A** / **H** / **L** / **V** : outils Entité, Association, Héritage, Lien, Sélection (vue MCD).
  Clic droit : abandon de la création en cours et retour à la Sélection.
- Cliquer dans le vide pour créer une entité ou une association.
- Outil Lien : cliquer (ou glisser) d'une entité à une autre crée l'association entre elles ;
  d'une association à une entité, ajoute une patte.
- Héritage : créer le triangle, le relier aux entités avec l'outil Lien, choisir l'entité cible
  et la contrainte (X, T, XT) dans le panneau de droite.
- **Rétroconception** (bouton de la barre d'outils) : coller ou ouvrir un script SQL de n'importe
  quel SGBD (dialecte détecté ou imposé) pour reconstruire le MCD. CHECK, DEFAULT, UNIQUE, index,
  noms de contraintes, actions ON DELETE / ON UPDATE et types d'origine sont conservés en
  annotations physiques et réappliqués au script ; vues, fonctions… sont ignorées.
- **Rapport de pertes** : ce que le SGBD cible ne sait pas exprimer est listé au-dessus du script
  (onglet Script LDD) et en commentaire en tête de celui-ci, une ligne par perte identique. Options
  du script (FK en ALTER TABLE, index, ordre des colonnes, noms des contraintes, non-signés, ENUM,
  SET, collations, DATE Oracle, chaîne vide Oracle, fidélité stricte des plages, types spatiaux, collation SQL Server supposée, schéma dbo) : paramètres du modèle, section « Script SQL ».
- **Vue avancée** (case en haut de l'inspecteur) : DEFAULT, CHECK, type d'origine, casse, index et
  identifiants alternatifs de l'objet sélectionné.
- **⌘/Ctrl + E** : exporter l'image (SVG, PNG, JPG, WEBP ; fond transparent ou uni).
- **⌘/Ctrl + ,** : options générales (thème, langue FR / EN, lissage des cassures, réglages des
  nouveaux modèles, sauvegarde automatique).
- **Placement auto.** (barre d'outils, et après une rétroconception) : range tout le MCD sur une
  grille sans traits qui se croisent ni traversent un objet, en dégageant les cardinalités ;
  disposition commune au MCD, au MLD et au MPD ; calcul en ≈ 0,2 s, en parallèle.
- SGBD cible et version : bouton à droite de la barre d'état (boîte « Cible ») ; thème : barre d'outils.
- Le panneau de droite édite l'objet sélectionné (ou les paramètres du document).
- Le MLD textuel, le script SQL et les problèmes se mettent à jour en temps réel.
- ⌘/Ctrl + Z, ⇧⌘/Ctrl + Z, ⌘/Ctrl + S, ⌘/Ctrl + O, ⌘/Ctrl + N, Suppr, ⌘/Ctrl + A, ⌘/Ctrl + I.
- Molette : défilement ; ⌘/Ctrl + molette ou pincement : zoom ; ⇧F : ajuster à la fenêtre.

## Licence

© 2026 Gauthier DANIELS — [GPL-3.0-or-later](LICENSE). ModelIt est un logiciel libre : vous pouvez
le redistribuer et le modifier selon les termes de la licence publique générale GNU, version 3 ou
ultérieure. Toute version modifiée et redistribuée doit rester sous cette licence, avec son code
source et les mentions de copyright d'origine.

Police Inter : SIL Open Font License 1.1.

# Notes de version

Une section `## X.Y.Z — AAAA-MM-JJ` par version, la plus récente en haut. La section de la version
taguée devient le texte de la release GitHub et les notes proposées par la mise à jour ; tout
l'historique est affiché dans l'application (À propos → Nouveautés).

## 0.2.0 — 2026-10-15

### Nouveautés

- Onglets : plusieurs modèles ouverts dans la même fenêtre (⌘/Ctrl + T, ⌘/Ctrl + W, Ctrl + Tab), chacun avec sa vue, sa sélection et son historique d'annulation.
- Barre d'outils ancrée ou flottante : elle peut se détacher, sortir de la fenêtre et se ranger n'importe où sur l'écran.
- Sections ancrables ou flottantes : Propriétés, Modèle, MLD, SQL et Problèmes se regroupent en onglets, à droite, en bas ou dans des fenêtres flottantes ; la disposition est retenue.
- Assistants IA (MCP) : un assistant compatible, comme Claude Code, peut lire et modifier le modèle ouvert ; chaque modification s'annule d'un seul ⌘/Ctrl + Z. Désactivé par défaut (Options générales).
- Sauvegarde automatique par onglet : après un arrêt brutal, tous les modèles modifiés sont proposés à la récupération.

### Améliorations

- Déplacer un objet ne recalcule plus le MLD ni le script SQL : l'édition reste fluide sur les grands modèles.
- La rétroconception ouvre son résultat dans un nouvel onglet, sans remplacer le modèle affiché.
- Le placement automatique aboutit toujours, même quand la fenêtre est en arrière-plan.

### À savoir

- Nouveau format de fichier (version 3) : les fichiers des versions précédentes s'ouvrent et sont convertis automatiquement, mais un fichier enregistré avec cette version ne s'ouvre plus correctement dans ModelIt 0.1.

## 0.1.0 — 2026-10-15

### Nouveautés

- Modélisation Merise : entités, associations, héritages, contraintes inter-associations, CIF et règles.
- Passage automatique du MCD au MLD et au MPD, avec le MLD textuel mis à jour en temps réel.
- Génération du script SQL pour PostgreSQL, MySQL, MariaDB, SQLite, Oracle, SQL Server, DB2, Sybase et Access, avec un rapport des pertes propres au SGBD cible.
- Rétroconception : reconstruction du MCD à partir d'un script SQL, dialecte détecté automatiquement.
- Placement automatique du schéma, sans chevauchement ni croisement de liens.
- Export du schéma en SVG, PNG, JPG et WEBP, fond transparent ou uni.
- Sauvegarde automatique et récupération après un arrêt brutal.
- Interface en français et en anglais, thèmes clair et sombre.
- Mise à jour de l'application depuis l'application, avec ces notes de version.

# Notes de version

Une section `## X.Y.Z — AAAA-MM-JJ` par version, la plus récente en haut. La section de la version
taguée devient le texte de la release GitHub et les notes proposées par la mise à jour ; tout
l'historique est affiché dans l'application (À propos → Nouveautés).

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

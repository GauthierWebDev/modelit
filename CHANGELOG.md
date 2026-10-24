# Notes de version

Une section `## X.Y.Z — AAAA-MM-JJ` par version, la plus récente en haut. La section de la version
taguée devient le texte de la release GitHub et les notes proposées par la mise à jour ; tout
l'historique est affiché dans l'application (À propos → Nouveautés).

## 0.8.0 — 2026-10-24

### Nouveautés

- Recherche dans le schéma (⌘/Ctrl + F) : un champ s'ouvre en haut à droite ; les entités et associations (MCD) ou les tables (MLD, MPD) trouvées sont entourées, par leur nom ou leur nom logique, sans tenir compte de la casse ni des accents. Entrée et Maj + Entrée passent d'un résultat à l'autre, la vue suit.
- Export d'image : choix de la zone — ce qui est affiché à l'écran (cadrage et zoom, par défaut), la sélection, ou le schéma complet ; couleurs « comme l'écran ».
- Fichiers récents : les 5 derniers modèles ouverts ou enregistrés, dans le menu ≡.
- Glisser-déposer : un ou plusieurs fichiers .mcd déposés sur la fenêtre s'ouvrent chacun dans un onglet.
- « Rouvrir sans sauvegarder » (menu ≡, ou clic droit sur un onglet) : recharge le fichier depuis le disque, par exemple après l'avoir modifié dans un autre programme.
- Ligne de commande : « Installer la commande modelit » dans les options générales ; « modelit » ouvre ModelIt depuis un terminal, « modelit fichier.mcd » ouvre ce modèle, dans l'application déjà ouverte s'il y en a une.
- Double-cliquer sur un fichier .mcd l'ouvre dans ModelIt.
- Placement automatique : un second clic sur le bouton annule un placement en cours.
- Rubriques : le commentaire et le complément SQL se modifient dans le détail de la rubrique.
- Assistants IA : ils lisent et modifient désormais tout ce que l'interface permet — noms logiques des tables et des colonnes, annotations SQL (DEFAULT, CHECK, index, identifiants alternatifs, clé primaire nommée), rôles et actions des clés étrangères, héritages, paramètres du modèle, SGBD personnalisé.

### Corrections

- Placement automatique : l'application ne se fige plus pendant le calcul (⌘Q compris), et les clics répétés sur le bouton ne relancent plus le calcul.
- Placement automatique nettement plus rapide sur les grands schémas (environ cinq fois), avec exactement la même disposition.
- Les cardinalités, rôles et libellés des liens restent lisibles dans un SVG exporté ouvert dans un autre logiciel (ils pouvaient apparaître noir sur noir).
- Assistants IA : remplacer les rubriques d'un objet ne fait plus perdre leurs noms logiques, valeurs par défaut, contraintes et index ; changer de SGBD garde le SGBD personnalisé.

### À savoir

- La commande modelit demande le mot de passe administrateur sous macOS ; sous Linux, elle s'installe dans ~/.local/bin, qui doit être dans votre PATH.

## 0.7.0 — 2026-10-23

### Nouveautés

- Session collaborative : les objets sélectionnés par les autres participants sont entourés de leur couleur.
- « Suivre » un participant : bouton œil sur sa ligne, dans la section Session ; votre vue et votre cadrage suivent les siens, le canevas est bordé de sa couleur. Le suivi s'arrête dès que vous déplacez la vue, changez de vue, modifiez le modèle ou appuyez sur Échap. La liste des participants indique qui vous suit.

### Corrections

- Un fichier abîmé ou enregistré par une version plus récente (SGBD inconnu) est refusé avec un message clair, au lieu d'une erreur technique.
- Session collaborative : l'hôte libère les ressources de chaque invité parti.
- Sécurité : les fenêtres détachées n'ont plus accès aux commandes de session, d'assistant IA et de mise à jour, ni au micro.

### À savoir

- Avec un participant encore en version 0.6, « Suivre » reprend sa vue mais pas son cadrage.
- Les fondations de l'application ont été consolidées (architecture, nombreux tests ajoutés), sans changement visible.

## 0.6.0 — 2026-10-22

### Nouveautés

- Nom logique des rubriques : dans le détail d'une rubrique, le champ « Nom logique » donne le nom de la colonne dans le MLD, le MPD et le script SQL ; le MCD garde le nom conceptuel. Laissé vide, le nom est dérivé du nom conceptuel selon les paramètres du modèle.

### Corrections

- Les cardinalités ne sont plus masquées par une entité quand la patte arrive en biais près d'un coin ou d'un bord : elles s'écartent le long du trait jusqu'à être entièrement visibles.

## 0.5.0 — 2026-10-22

### Nouveautés

- Vocal pendant une session collaborative : « Rejoindre l'audio » dans la section « Session ». Personne n'y est par défaut et le micro ne s'ouvre jamais sans votre action.
- Pendant le vocal : couper ou ouvrir son micro (⌘/Ctrl + Maj + M), régler le volume de chaque participant de 0 à 200 % (seulement ce que vous entendez), voir qui parle dans la liste et sur son curseur.
- Sans accès au micro, vous rejoignez l'audio en écoute seule, avec un message qui explique comment l'autoriser.

### Améliorations

- Une association créée à l'outil Lien (réflexive, ou entre deux entités) prend la première place libre dans les trois vues, à la taille de sa plus grande boîte : elle ne chevauche plus les tables du MLD et du MPD, et rien d'autre ne bouge.

### Corrections

- Rapport de pertes du script SQL : une perte sur une contrainte UNIQUE n'est plus annoncée deux fois (INCLUDE abandonné avant PostgreSQL 11), ni annoncée à tort (lignes entièrement vides avant PostgreSQL 15).

### À savoir

- Sous macOS, le vocal demande macOS 14 ou plus récent. Il n'a pas encore été éprouvé sur tous les systèmes (Windows, Linux, sans casque) : vos retours sont les bienvenus.
- Les échanges du vocal sont chiffrés comme le reste de la session ; rien n'est envoyé pendant les silences.

## 0.4.0 — 2026-10-16

### Nouveautés

- Copier, couper, coller et dupliquer (⌘/Ctrl + C, X, V, D) dans les trois vues, entre onglets et entre fenêtres : les copies sont renommées (« Client_2 ») et décalées.
- Menus au clic droit selon ce qui est sous le pointeur (vide, entité, association, patte…), et bouton « ⋯ » d'actions rapides sur l'objet sélectionné : ajouter une rubrique, copier, dupliquer, supprimer.
- Renommer sur place par double-clic : entités, associations et rubriques dans le MCD ; titres de tables, colonnes et clés étrangères dans le MLD et le MPD.
- Créer une entité et relier des tables directement depuis le MLD et le MPD : le MCD suit.
- Aligner (gauche, centre, droite, haut, milieu, bas) et répartir plusieurs objets ; déplacer la sélection aux flèches (Maj : dix pas).
- Sélection de plusieurs tables dans le MLD et le MPD : Maj + clic, rectangle tracé dans le vide, glisser groupé.
- SGBD personnalisés : redéfinissez le type SQL de chaque type (Compteur → BIGSERIAL…) à partir d'un SGBD et d'une version, enregistrez-les dans « Mes SGBD » pour les réutiliser. Un modèle personnalisé l'indique partout : barre d'état, script (« basé sur PostgreSQL 18 »).
- Dans le MPD, double-clic sur le type d'une colonne pour le fixer pour ce SGBD.
- Section « Rubriques » : liste compacte (type, identifiant, NOT NULL, UNIQUE), saisie à la chaîne avec Entrée, réordonnancement au clavier ou à la souris, et détail de la rubrique choisie.

### Améliorations

- Barre d'outils allégée : fichiers, export, rétroconception, options et thème passent dans le menu ≡ ; la barre tient sur une petite fenêtre.
- Barre d'état enrichie : sélection, problèmes (un clic ouvre la section), zoom, et SGBD cible avec ce que sa version permet.
- Paramètres du modèle dans une boîte à onglets (⌥⌘/Ctrl + Alt + ,) : nommage et clés, script SQL, conversions regroupées par SGBD source, types SQL. Les réglages d'affichage passent dans le menu « Affichage » (œil) de la barre d'outils.
- Blocs « Avancé », clés étrangères et commentaire repliables ; leur état est retenu.
- Le MPD affiche le type réellement émis dans le script.
- La recherche de mise à jour a lieu à chaque lancement.

### À savoir

- La section « Modèle » est remplacée par la boîte « Paramètres du modèle » ; une disposition enregistrée qui la contenait est réparée automatiquement.
- Dans le MLD et le MPD, glisser dans le vide trace désormais un rectangle de sélection, comme dans le MCD : la vue se déplace à la molette, au pavé tactile ou au bouton du milieu.

## 0.3.1 — 2026-10-16

### Corrections

- Linux : les paquets de la version 0.3.0 (AppImage, .deb, .rpm) n'avaient pas pu être construits ; ils sont de nouveau disponibles, avec la session collaborative.

## 0.3.0 — 2026-10-16

### Nouveautés

- Session collaborative : partagez l'onglet actif (bouton « Partager » de la barre d'outils) et modélisez à plusieurs en direct, sans compte ni serveur. Les participants rejoignent par un lien, en édition ou en lecture seule ; un mot de passe peut protéger la session.
- Curseurs des autres participants, à leur couleur et avec leur nom, sur la même vue que vous.
- Section « Session » : liste des participants avec leur rôle et leur vue, et chat intégré (messages non lus signalés sur l'onglet de la section).
- Chacun n'annule que ses propres modifications (⌘/Ctrl + Z).
- À la fin d'une session, l'invité garde une copie du modèle dans un onglet « Sans titre ».
- Votre nom et votre couleur de participant se règlent dans les Options générales ; sans nom saisi, un nom aléatoire est utilisé (« Castor curieux »).
- Assistants IA des invités : l'hôte les autorise ou les interdit ; en lecture seule, ils peuvent seulement lire le modèle.

### À savoir

- La session s'arrête quand l'hôte l'arrête, ferme l'onglet partagé ou quitte ModelIt. Un invité dont la connexion tombe passe en lecture seule et se reconnecte pendant 30 secondes.
- Les échanges sont chiffrés de bout en bout ; quand une connexion directe est impossible, ils passent par des relais publics qui ne voient que des données chiffrées.
- Une session compte 20 participants au plus, pour un modèle de 5 Mo au plus.

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

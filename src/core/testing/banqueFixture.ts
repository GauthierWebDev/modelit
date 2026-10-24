import type { GridEdge, GridNode } from "../layout/grid";

/**
 * MCD d'une banque, de grande taille (63 entités, 108 associations dont 2 ternaires et 2 réflexives, un héritage
 * à 3 sous-types) : mesure du placement automatique sur un gros schéma (override O-31, `pnpm test:perf`).
 * Domaine inventé pour ce test. Dimensions : MCD ≈ 130 px de large, MPD 330 à 520 px, hauteurs selon le
 * nombre de rubriques (relevés de l'interface pour le laboratoire, voir grid.test.ts).
 */

/** Entités : « nom:rubriques ». */
const ENTITIES = `
Client:9 Particulier:6 Entreprise:7 Professionnel:5 Adresse:7 Pays:3 Ville:4 PieceIdentite:5 Contact:4
Conseiller:6 Agence:7 Region:3 Direction:4 Employe:8 Poste:3 Service:4 Compte:9 TypeCompte:4 Devise:4
TauxChange:4 Releve:5 Operation:8 TypeOperation:3 Virement:7 Prelevement:6 MandatSepa:6 Beneficiaire:6
Cheque:5 Chequier:4 Carte:8 TypeCarte:4 Terminal:5 Commercant:6 PaiementCarte:7 Opposition:4 Plafond:4
Pret:9 TypePret:4 Echeance:6 Garantie:5 Bien:6 Assurance:5 ContratAssurance:7 Sinistre:6 DossierCredit:8
Simulation:6 Livret:5 Produit:6 Portefeuille:4 Titre:6 OrdreBourse:8 Marche:3 Cotation:4 AlerteFraude:6
ControleKyc:6 ScoreRisque:4 Reclamation:7 RendezVous:5 Canal:3 Notification:5 Frais:5 GrilleTarifaire:4
TauxInteret:4
`;

/** Associations : « nom:entité,entité[,entité] » (une entité répétée : réflexive). */
const ASSOCIATIONS = `
resider:Client,Adresse situer:Adresse,Ville appartenirPays:Ville,Pays justifier:Client,PieceIdentite
joindre:Client,Contact suivre:Conseiller,Client rattacher:Conseiller,Agence couvrir:Agence,Region
piloter:Direction,Region employer:Agence,Employe occuper:Employe,Poste composer:Service,Employe
diriger:Direction,Employe encadrer:Employe,Employe detenir:Client,Compte typer:Compte,TypeCompte
libeller:Compte,Devise coter:Devise,TauxChange domicilier:Compte,Agence editer:Compte,Releve
mouvementer:Compte,Operation classer:Operation,TypeOperation recapituler:Releve,Operation
emettre:Compte,Virement crediter:Virement,Beneficiaire convertir:Virement,TauxChange enregistrer:Client,Beneficiaire
autoriser:Compte,MandatSepa signer:Client,MandatSepa executer:MandatSepa,Prelevement debiter:Prelevement,Compte
imputerPrelevement:Prelevement,Operation delivrer:Compte,Chequier contenir:Chequier,Cheque encaisser:Cheque,Compte
porterCheque:Cheque,Operation adosser:Carte,Compte typerCarte:Carte,TypeCarte titulaire:Client,Carte
plafonner:Carte,Plafond equiper:Commercant,Terminal regler:Carte,PaiementCarte accepter:Terminal,PaiementCarte
imputerCarte:PaiementCarte,Operation bloquer:Carte,Opposition declarer:Client,Opposition domicilierCommercant:Commercant,Compte
emprunter:Client,Pret typerPret:Pret,TypePret echelonner:Pret,Echeance prelever:Echeance,Compte
garantir:Pret,Garantie hypothequer:Garantie,Bien posseder:Client,Bien couvrirPret:Pret,Assurance
souscrire:Client,ContratAssurance assurer:ContratAssurance,Assurance declarerSinistre:ContratAssurance,Sinistre
indemniser:Sinistre,Compte instruire:DossierCredit,Conseiller aboutir:DossierCredit,Pret deposer:Client,DossierCredit
simuler:Client,Simulation proposer:Simulation,TypePret ouvrirLivret:Client,Livret remunerer:Livret,TauxInteret
alimenter:Compte,Livret commercialiser:Produit,Agence investir:Client,Produit gerer:Client,Portefeuille
composerPf:Portefeuille,Titre negocier:Titre,Marche coterTitre:Titre,Cotation passer:Portefeuille,OrdreBourse
viser:OrdreBourse,Titre reglerOrdre:OrdreBourse,Compte transmettre:OrdreBourse,Marche signaler:Operation,AlerteFraude
analyser:Employe,AlerteFraude controler:Client,ControleKyc valider:ControleKyc,Employe noter:Client,ScoreRisque
calculer:ControleKyc,ScoreRisque reclamer:Client,Reclamation traiter:Reclamation,Employe concerner:Reclamation,Operation
recevoir:Reclamation,Canal planifier:Client,RendezVous animer:Conseiller,RendezVous accueillir:Agence,RendezVous
notifier:Client,Notification diffuser:Notification,Canal declencher:AlerteFraude,Notification
facturer:Compte,Frais tarifer:Frais,GrilleTarifaire appliquer:TypeCompte,GrilleTarifaire indexer:Pret,TauxInteret
devisePret:Pret,Devise risquer:DossierCredit,ScoreRisque assurerEmprunteur:Pret,ContratAssurance
parrainer:Client,Client mandater:Particulier,Entreprise representer:Entreprise,Contact
affecter:Conseiller,Employe gererAgence:Agence,Direction
cautionner:Client,Pret,Garantie arbitrer:Portefeuille,Produit,Compte realiserBien:Bien,Sinistre
`;

/** Héritage : surtype puis sous-types. */
const INHERITANCE = ["Client", "Particulier", "Entreprise", "Professionnel"] as const;

const entityNode = (name: string, attributes: number): GridNode => ({
  id: name,
  width: 330 + ((name.length * 37) % 190),
  height: 54 + 18 * attributes,
  mcdWidth: 110 + ((name.length * 13) % 40),
  mcdHeight: 36 + 18 * attributes,
});

/** Graphe du placement : entités, associations et héritage, avec leurs pattes. */
export function banqueGraph(): { nodes: GridNode[]; edges: GridEdge[] } {
  const nodes: GridNode[] = [];
  const edges: GridEdge[] = [];
  for (const item of ENTITIES.trim().split(/\s+/)) {
    const [name, attributes] = item.split(":");
    nodes.push(entityNode(name!, Number(attributes)));
  }
  for (const item of ASSOCIATIONS.trim().split(/\s+/)) {
    const [name, legs] = item.split(":");
    const id = `assoc:${name}`;
    nodes.push({ id, width: 40 + 7.5 * name!.length, height: 36 });
    for (const entity of legs!.split(",")) {
      edges.push({ a: id, b: entity });
    }
  }
  const [parent, ...children] = INHERITANCE;
  nodes.push({ id: "heritage:Client", width: 36, height: 30 });
  for (const entity of [parent, ...children]) {
    edges.push({ a: "heritage:Client", b: entity });
  }
  return { nodes, edges };
}

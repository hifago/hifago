---
id: refonte-cdc-admin
titre: "Cahier des charges — back-office admin (aujourd'hui /admin)"
theme: cadrage
statut: brouillon
maj: 2026-09-22
resume: >
  Comportement métier cible du back-office de pilotage, dérivé du comportement réel actuel et
  challengé section par section avec Jérôme avant reprise dans la refonte.
mots_cles: [cahier des charges, admin, back-office, pilotage, 2fa, catalogue]
repond_a:
  - "Que doit faire le back-office admin (apps/admin) dans la refonte ?"
---

# Cahier des charges — back-office admin

## Écarts connus (alimenté par les specs qui révisent ce cahier — voir leur champ `revise:`)

Relevés par la relecture intégrale du 2026-09-07. Les sections ci-dessous ne sont pas réécrites —
ces lignes en tiennent lieu.

- **L'« acceptation de contrat par rôle » a été ABANDONNÉE** (décisions Jérôme des 2026-08-19 et
  2026-08-20, migrations `20260819230000_partner_capabilities_remove_onboarding_status.sql` puis
  `20260820010000_partner_capabilities_active_by_default.sql`, récit complet en
  `02-cahier-des-charges-socio.md` §3a). Une capacité est **active dès sa création**, quel qu'en
  soit le chemin — les trois sont déjà un geste admin. Trois passages de ce cahier reposent encore
  sur la prémisse inverse et sont donc périmés :
  - **§3d, « Décision (2026-08-11) — visibilité sur l'acceptation de contrat »** : il n'y a plus
    d'état accepté/en attente à afficher. Seul subsiste le statut technique (active / suspendue).
  - **§3g**, « le versement d'un dû à un bénéficiaire est bloqué si son identité n'a pas encore
    accepté le contrat de son rôle » : ce verrou n'existe pas. Le versement lui-même a par ailleurs
    changé de nature — voir la ligne Mercado Pago ci-dessous.
  - **§3f**, « Ne concerne pas les audiences partenaires (relation contractuelle déjà établie, cf.
    acceptation de contrat par rôle) » : la conclusion (le rappel Habeas Data vise les audiences
    clients) reste valable, mais sa justification ne tient plus.
- **§3g, virement au bénéficiaire — révisé par
  `docs/specs/19-paiement-mercadopago-acompte-ledger.md`** (statut `partiel`) : le règlement du
  référent et la compensation établissement passent par Mercado Pago, déclenchés **par API** une
  fois la prestation réalisée — plus un geste manuel admin avec dépôt de justificatif. Le moteur
  17/10/7 et la règle A3 (non-remboursement, redistribution des 10 % vers le prestataire) sont
  cités comme prémisses par cette spec : ils ne changent pas.
- **§3c, « Hébergement adossé à un PMS : lecture seule pour l'admin » — trop large depuis
  `docs/specs/24-modele-hebergement-et-surface-lobbypms.md`.** La frontière exacte y est posée :
  **Lobby fait foi sur la DISPONIBILITÉ** (relue à chaud, jamais copiée en base) ; **sur tout le
  reste — nom, description, photos, capacité, prix — hifago fait foi**, Lobby ne faisant que
  *proposer* une valeur au moment de la liaison. L'admin édite donc bien un produit PMS-backed, et
  deux gestes lui sont même réservés (`Desvincular`/`Actualizar`, import des photos Lobby via
  `POST /api/pms/import-room-photos`, admin-only). Ce qui reste vrai : pas de second calendrier —
  un logement PMS-backed n'a pas de calendrier de cupos interne, `create_order` saute verrou et
  décrément pour ces lignes. Même remarque pour §6/A10.
- **§2 et §3g, « date **et** créneau choisis par le client » — granularité périmée**, contredite
  par `docs/specs/18-creneaux-horaires-reservables.md` : le créneau n'est plus le binaire
  matin/après-midi mais un créneau horaire arbitraire issu de `product_slot_rules`. Le principe
  (l'admin voit la date ET le créneau) est inchangé. Détail dans l'en-tête « Écarts connus » de
  `01-cahier-des-charges-client.md`.
- **§2, « notifications proactives pour l'admin » — livrées par
  `docs/specs/23-notifications-email-transactionnelles.md`**, par email (Resend) : nouvelle
  proposition à modérer et nouvelle exception de réconciliation sont branchées. Le troisième
  déclencheur listé ici, « demande d'ouverture prestataire en attente », ne l'est pas — il dépend
  d'un parcours self-service jamais construit (constat explicite de la spec 23).
- **§3a, file de réconciliation — élargie aux exceptions de PAIEMENT** : depuis
  `docs/specs/19-paiement-mercadopago-acompte-ledger.md` une seconde file existe
  (`payment_reconciliation_entries`, webhook Mercado Pago en échec), mais l'écran
  `/admin/reconciliation` ne montrait que le PMS jusqu'au **2026-09-20** (incident HFG-000013 :
  l'e-mail d'alerte envoyait vers une page qui n'affichait pas l'entrée annoncée). Depuis ce jour,
  l'écran porte deux sections « Pagos » / « PMS » ; une entrée de paiement `kind = 'refund_required'`
  signifie « argent encaissé chez Mercado Pago sans prestation à honorer » — l'admin la résout avec
  une note (réhonorage manuel) ou clique **« Reembolsar »** (livré le 2026-09-22, spec 39 D3) : la
  demande est mise en file et exécutée par le job `payments-reconcile`, jamais par l'admin lui-même
  (aucun token Mercado Pago dans `apps/admin`). Le job et son chien de garde n'ont pas encore
  d'écran : l'admin apprend un arrêt par e-mail (`admin_job_stalled`).
- **§7, point ouvert n°2 (« l'email groupé nécessite-t-il un vrai service d'envoi ? ») — tranché à
  moitié.** Le service d'envoi existe et est choisi (Resend, spec 23), avec sa file et son journal ;
  ce qui reste ouvert est le **groupé** : audiences, désabonnements, cadence. La question n'est plus
  « faut-il un service » mais « que fait-on de celui qu'on a ».
- **§3d, « Décision — administration du multi-utilisateurs » (voir les membres d'une organisation,
  retirer un membre, réassigner le propriétaire) — toujours valide, toujours non construit.** Aucun
  mécanisme d'invitation de coéquipier n'existe (cf. `02-cahier-des-charges-socio.md` §3b, point
  ouvert non levé), et les niveaux d'accès différenciés restent un arbitrage Jérôme
  (`CLAUDE.md` §10, `docs/backlog.md`).

Ajouté par la réécriture du §2 du cahier client le 2026-09-07 :

- **§3g, bloc « Décision 2026-08-13 — modification vs annulation *client* » — un mot périmé.** La
  modification partielle depuis le compte client a été retirée du premier périmètre le 2026-09-07
  (`01-cahier-des-charges-client.md` §2c, portée au backlog) : côté client, le seul geste
  self-service sur une commande existante est l'**annulation entière**. La modification par lignes
  reste un geste **admin/socio** (`modify_order_line`, déjà construite). Tout le corps du bloc reste
  valide — définition des deux gestes, snapshots figés, reconstruction des lignes remplacées — et
  l'exigence « l'admin doit voir clairement lequel des deux gestes a eu lieu » vaut désormais en
  identifiant l'**auteur réel** du geste, qui n'est plus jamais le client.
- **Passe de maintenance des §0 — 2026-09-28, sans écart nouveau.** Les §0 des specs qui révisent
  ce cahier ont été remises en phase avec le code (chemins déplacés, signatures changées par une
  spec ultérieure) : aucune décision modifiée, aucune section de ce cahier à réécrire. Specs
  touchées : 18, 19.

> Méthode : une section = une unité de validation avec Jérôme. Statut par section :
> `brouillon` → `en relecture` → `✅ validé par Jérôme le AAAA-MM-JJ`.
> Sources principales : `docs/2-reference/03-app-admin.md`, `docs/2-reference/05-data-model.md`.

> **Cadrage hérité des cahiers des charges client et socio** — ne pas répéter ici : marketplace
> global, identité unifiée (client/socio/admin = rôles composables sur un même compte, plus de
> mot de passe partagé), cycle de vie de commande unifié, synchronisation PMS sur tâche planifiée,
> connecteur PMS optionnel/généralisé par propriété, tags de catégorisation, multi-établissements
> et multi-utilisateurs par organisation partenaire, système multilingue transverse.

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 1 | Périmètre et vision | ✅ validé 2026-08-11 |
| 2 | Parcours utilisateurs | ✅ validé 2026-08-11 |
| 3a | Réconciliation PMS et exceptions | ✅ validé 2026-08-11 |
| 3b | Modération des propositions partenaires | ✅ corrigé 2026-08-13 |
| 3c | Gestion directe du catalogue | ✅ corrigé 2026-08-13 |
| 3d | Registre des identités partenaires | ✅ corrigé 2026-08-13 |
| 3e | CRM (prospection, clients, prestataires) et carte | ✅ validé 2026-08-11 |
| 3f | Communication (audiences, campagnes) | ✅ validé 2026-08-11 |
| 3g | Commandes et ledger | ✅ corrigé 2026-08-13 |
| 4 | Entités de données touchées | ✅ validé 2026-08-11 |
| 5 | Cas limites | ✅ validé 2026-08-11 |
| 6 | Lacunes connues, challengées une à une | ✅ validé 2026-08-11 |
| 7 | Annexe — traçabilité code→règle | ✅ validé 2026-08-11 |

---

## 1. Périmètre et vision

**Statut : ✅ validé par Jérôme le 2026-08-11.**

Le back-office est l'outil de **pilotage** de la plateforme : source de vérité du catalogue
(prix, visibilité, réservabilité, ordre d'affichage), modération de tout ce qu'un partenaire
propose, résolution des synchronisations PMS en échec, CRM (partenaires, clients, prestataires),
communication groupée, et gestion des commandes/du ledger financier.

**Décision (2026-08-11) — l'admin devient un rôle, pas un système à part** (cf. cahiers des
charges client §1/§4 et socio §1) : fini le mot de passe unique partagé — chaque action est
désormais attribuée à une **identité nominative** porteuse du rôle admin sur la base
d'utilisateurs unifiée. Ça résout de facto la lacune connue actuelle (aucune action attribuable
à une personne).

**Frontières avec les autres portails :**
- **Portail client** : l'admin est la seule source d'écriture du catalogue public (sauf les deux
  exceptions déjà actées côté socio : calendrier et galerie déjà publiée, en écriture directe
  pour le prestataire propriétaire).
- **Portail socio** : l'admin est le seul chemin de publication d'une proposition partenaire
  (fiche, camp, evento, grille tarifaire, photo) — rien n'atteint le catalogue public sans passer
  par une décision admin explicite (approbation ou rejet motivé). L'admin décide aussi des
  capacités, de leur statut, et du rattachement établissement↔partenaire.

**Décision (2026-08-11)** : le rôle admin peut être accordé à **plusieurs identités** (plusieurs
emails), pas seulement Jérôme — mais **sans permissions différenciées entre elles** : tout compte
porteur du rôle admin a exactement le même accès complet. La nominativité sert la traçabilité
(qui a fait quoi), pas un contrôle d'accès à granularité fine — pas de rôle "modérateur limité"
séparé d'un rôle "admin financier" pour ce premier périmètre.

**Décision (2026-08-11) — 2FA obligatoire pour le rôle admin.** Cohérent avec l'accès total :
un compte admin compromis expose tout le système, pas un seul profil — le niveau de sécurité de
connexion doit être supérieur à celui d'un compte client/socio ordinaire, pas identique.

**Précision (2026-08-12) — point d'articulation avec l'identité unifiée.** Puisque client, socio
et admin partagent une seule identité de connexion (client §1) : le 2FA se déclenche **à la
connexion elle-même**, dès qu'une identité porte le rôle admin — pas seulement au moment d'une
action admin précise. Cohérent avec l'invariant déjà posé (chaque action sensible revalide la
capacité côté serveur à chaque appel, socio §3a) : le 2FA en est le premier verrou, pas un
remplacement des suivants. Un compte purement client/socio (sans rôle admin) garde le niveau de
friction minimal déjà décidé pour lui (§1/§2) — le 2FA ne s'applique jamais par défaut à tout le
monde, seulement à qui porte le rôle qui le justifie.

**Implémenté le 2026-08-15 (Feature 31)** : TOTP via Supabase Auth MFA (`auth.mfa.totp`),
enrôlement forcé au premier accès puis vérification à chaque nouvelle session — `is_admin()`
exige désormais l'AAL2 (chokepoint centralisé, toute la checklist RLS/RPC-only en bénéficie sans
retouche individuelle). Pas de codes de secours natifs côté Supabase — perte de l'authenticator
traitée comme une procédure opérationnelle (intervention `service_role` d'un autre admin/dev), pas
une fonctionnalité self-service (cf. `docs/specs/07-connexion-inscription-complete.md` §9).

*Traçabilité : `docs/2-reference/03-app-admin.md` § Rôle, § Structure du dashboard ;
`docs/specs/07-connexion-inscription-complete.md`.*

---

## 2. Parcours utilisateurs

**Statut : ✅ validé par Jérôme le 2026-08-11.**

> Décrit les grands parcours fonctionnels de l'admin, pas la disposition en onglets actuelle
> (qui sera redessinée). Un parcours décrit ici doit survivre au changement de front.

**Réconciliation et suivi général :**
- Consulter une vue d'ensemble (volumes, commissions générées/dues/payées, réservations
  récentes) — le point d'entrée quotidien.
- Suivre la synchronisation PMS (désormais automatique, cf. client §5) et **traiter les
  exceptions** qu'elle ne peut pas résoudre seule — la file de réconciliation avec sortie
  explicite déjà décidée (client §3f).

**Décision (2026-08-11) — suivi analytique, pas seulement des totaux figés** : aujourd'hui, le
pilotage n'affiche que des **totaux à l'instant présent** (KPIs, tableaux) — aucune vue de
**tendance dans le temps**. La cible ajoute des graphiques d'évolution sur tous les aspects du
pilotage : ventes, commissions générées/payées, performance par partenaire/établissement, santé
du catalogue (produits publiés/en attente/refusés). *À trancher au chiffrage* : quels indicateurs
précisément, quelles périodes de comparaison — le principe (voir une évolution, pas seulement un
instantané) est acté, le détail ne l'est pas encore.

**Modération de l'offre partenaire :**
- Traiter la **file d'approbation** des propositions (nouvelle fiche, modification, camp, evento,
  grille tarifaire, photo seule) — examiner, corriger si besoin avant publication, approuver ou
  rejeter avec un motif explicite rendu au partenaire.
- Traiter les **demandes d'ouverture prestataire** qui n'ont pas été accordées automatiquement
  (hors zone couverte, cf. socio §3b) — une liste à rappeler, pas une décision à prendre dans
  l'outil lui-même.

**Gestion directe du catalogue :**
- Créer, modifier, dépublier ou supprimer une fiche (produit, hébergement, camp, evento).
- Définir l'**ordre d'affichage** du catalogue public.
- Gérer le calendrier/les cupos d'un produit (les mêmes règles et le même service que le
  prestataire en écriture directe, cf. socio §3d — un seul garde-fou anti-survente, jamais deux),
  y compris les **ressources de disponibilité partagées** : l'admin peut voir qu'un blocage de
  plusieurs activités provient d'une réservation de camp ou d'evento et quelle période/commande en est
  la cause.
- Consulter en lecture les hébergements adossés à un PMS (l'admin n'y écrit jamais — le PMS fait
  foi, cf. client §5).

**Registre des identités partenaires :**
- Accorder une capacité (référent et/ou prestataire), changer son statut (active / suspendue —
  active dès la création, décision Jérôme 2026-08-20).
- Rattacher (ou transférer) un établissement à une identité partenaire.

**Décision (2026-08-11) — accès total et gestion de tous les comptes** : l'admin peut **éditer
n'importe quelle donnée** du système (pas seulement approuver/rejeter en file d'attente), et
doit pouvoir **voir exactement ce qu'une organisation partenaire voit** dans son propre portail —
une vue miroir, utile pour le support sans dépendre d'un compte de test séparé. **Précision
(2026-08-11) : cette vue miroir est en lecture seule** — l'admin regarde ce que voit le
partenaire, mais n'agit jamais directement « à sa place » sous son identité ; toute action reste
attribuée à l'admin lui-même, jamais confondue avec une action du partenaire (intégrité de
l'audit). L'admin gère aussi **tous les comptes** du système (client, socio, admin)
directement : création, modification, désactivation — pas seulement les capacités
référent/prestataire.

**Décision (2026-08-11) — notifications proactives pour l'admin, symétriques du socio (§2 socio
§1)** : nouvelle proposition à modérer, nouvelle exception de réconciliation, demande d'ouverture
prestataire en attente — l'admin ne doit pas dépendre de se connecter pour le découvrir.

**Décision (2026-08-11) — recherche globale** : dès que le catalogue/les partenaires se comptent
en dizaines voire centaines (marketplace global), une recherche unique retrouvant n'importe quel
partenaire, commande ou produit devient nécessaire — pas seulement une recherche propre à chaque
écran.

**CRM et relation partenaires/clients/prestataires :**
- Consulter une fiche unifiée d'une identité (vue 360°), quel que soit l'endroit par lequel on y
  entre.
- Localiser des partenaires sur une carte, préparer un itinéraire de visite.
- Suivre les clients finaux (arrivées/séjours à venir/passés, demandes).

**Communication groupée :**
- Choisir une audience (clients, référents, prestataires, ou toute combinaison), filtrer,
  consulter/répondre à une conversation individuelle.
- Lancer une campagne groupée sur un modèle de message, suivre sa progression, la reprendre si
  interrompue.
- **Décision (2026-08-11) — deux canaux, pas un seul** : aujourd'hui, l'envoi ne se fait que par
  WhatsApp (lien `wa.me` cliqué à la main). La cible ajoute l'**email** comme second canal, avec
  la même flexibilité pour les deux : envoi **groupé** (campagne sur une audience) ou **individuel**
  (une personne en particulier), au choix de l'admin selon le contexte.

*Point à trancher au chiffrage* : l'email groupé peut-il rester aussi manuel que WhatsApp
aujourd'hui (modèles pré-approuvés, envoi assisté), ou nécessite-t-il un vrai service d'envoi
(SMTP transactionnel/marketing, gestion des désabonnements) dès ce premier périmètre ?

**Commandes et ledger :**
- Consulter/rechercher les commandes, effectuer une transition manuelle de statut quand
  nécessaire (réalisée / absence / annulée), suivre les montants dus et payés par bénéficiaire.

*Traçabilité : `docs/2-reference/03-app-admin.md` (l'ensemble du document — 10 onglets sources
de ce découpage fonctionnel).*

**Implémenté le 2026-08-15 — sidebar de navigation et page d'accueil** (Feature 27) : couvre le
volet « vue d'ensemble... point d'entrée quotidien » et les graphiques d'évolution ci-dessus (4
graphiques Recharts, indicateurs tranchés dans la spec). Spec détaillée, table de champs et
décisions produit dans `docs/specs/02-admin-accueil-et-navigation.md`. Le volet « commissions
dues/payées » ci-dessus reste hors périmètre de cette feature précise — aucun ledger n'existe
encore côté hifago (constat de la spec), reporté à une spec ultérieure dédiée.

---

## 3a. Réconciliation PMS et exceptions

**Statut : ✅ validé par Jérôme le 2026-08-11.**

**Aujourd'hui** : la synchronisation avec le PMS se fait par **import manuel** d'un export du
PMS — l'admin doit le déclencher lui-même, en général périodiquement. Chaque import produit un
résultat détaillé (nombre de réservations confirmées / annulées / rapprochées / ignorées /
en erreur).

**Décision (déjà actée côté client §5)** : dans la cible, cette synchronisation tourne sur une
**tâche planifiée automatique** — l'admin n'a plus à s'en souvenir. Ce que l'admin garde/gagne :
- un **journal des synchronisations** passées (quand, combien traité, combien en erreur) — pas
  seulement le résultat de la dernière ;
- un déclenchement **manuel à la demande**, en complément de l'automatique, pour forcer une
  synchronisation immédiate sans attendre le prochain cycle planifié.

**File de réconciliation (déjà actée côté client §3f)** : quand une nuit/activité censée être
reflétée dans un PMS ne l'a pas été, une entrée s'ouvre plutôt que de faire échouer la commande.
L'admin :
- consulte les entrées **ouvertes**, avec le contexte nécessaire pour agir (quelle commande,
  quel établissement, quelle tentative automatique a déjà eu lieu) ;
- peut **résoudre manuellement** une entrée (avec une note qui explique l'action prise) ;
- voit distinctement les entrées passées en **échec permanent** (retries automatiques épuisés)
  de celles encore en cours de nouvelle tentative.

**Décision (2026-08-11)** : l'automatisation est la priorité — l'appel API direct devient le
chemin normal de la synchronisation planifiée. L'import manuel actuel ne disparaît pas
complètement : il reste comme **solution de secours** (API du PMS indisponible, rattrapage
ponctuel), jamais comme chemin principal.

*Traçabilité : `docs/2-reference/03-app-admin.md` § 1. Import CSV ; cahier des charges client
§3f, §5.*

---

## 3b. Modération des propositions partenaires

**Statut : ✅ validé par Jérôme le 2026-08-11.**

Contrepartie directe des 3 propriétés de sûreté déjà actées côté socio (§3e) : rien n'atteint le
catalogue public sans passer par cet écran.

**Ce que l'admin voit** : la file des propositions en attente (nouvelle fiche, modification,
camp, evento, grille tarifaire, photo seule), avec pour une modification la comparaison explicite
entre la valeur **actuelle** et la valeur **proposée**, champ par champ.

**Ce que l'admin peut corriger avant publication** :
- le **contenu** proposé par le partenaire (texte, prix, cupos...) — l'admin peut l'ajuster
  avant d'approuver ;
- les champs que le partenaire **ne peut jamais proposer lui-même** (socio §3e) — taux de
  commission, visibilité, mapping PMS et éventuels paramètres réservés à l'admin. La remise par
  quantité/personnes reste limitée aux **produits hors nuits** ; l'ancien discount client lié au
  code partenaire est désactivé et ne doit pas réapparaître dans cet écran.

**Invariant à conserver** : **ce qui est publié est exactement ce que montre l'écran de
modération au moment d'approuver** — pas nécessairement ce que le partenaire avait initialement
envoyé, si l'admin a corrigé quelque chose entretemps. Aucune divergence entre l'écran vu par
l'admin et le résultat publié.

**Camp et Evento — parcours de modération distincts (socio §3e)** : ils ne sont pas fusionnés en
un même type fonctionnel. Pour chacun, approuver une proposition qui **corrige** une occurrence
publiée met à jour la ligne existante ; approuver une proposition qui **annonce une autre date** en
crée une nouvelle. Un camp est un produit multi-jours réservable ; un evento naît en vitrine et sa
réservabilité en ligne reste une activation admin séparée. Lorsqu'il devient réservable, sa durée
consomme la ressource de disponibilité du prestataire comme le camp.

**Photos seules** : l'approbation **n'ajoute que les images** — aucun autre champ du produit
n'est touché, même si l'écran affiche d'autres valeurs par erreur. Protection contre un
écrasement accidentel du prix/nom d'une fiche déjà en ligne à l'occasion d'un simple ajout photo.

**Refus** : toujours accompagné d'un motif, transmis au partenaire — jamais un rejet silencieux.
Aucun produit n'est créé.

**Prestataire attributaire obligatoire** : une proposition sans établissement clairement désigné
ne peut pas être approuvée.

*Traçabilité : `docs/2-reference/03-app-admin.md` § File d'approbation des fiches proposées.*

---

## 3c. Gestion directe du catalogue

**Statut : ✅ validé par Jérôme le 2026-08-11.**

**CRUD complet** sur toute fiche (produit, hébergement, camp, evento) — création, modification,
dépublication, suppression. **Une fiche déjà commandée ne se supprime jamais** (elle se
dépublie — `sellable = non` — pour ne jamais casser l'historique d'une commande existante) ; une
fiche appartenant à un camp ou à un evento se supprime depuis sa propre gestion, pas depuis la liste
générale, pour ne pas laisser un calendrier ou des médias orphelins.

**Photos** : même service de rangement/couverture que celui ouvert au prestataire (socio §3f) —
un classement fait d'un côté est vu de l'autre, une seule vérité sur l'ordre d'une galerie.

**Décision (2026-08-11) — présentation d'un établissement entièrement éditable, sans
déploiement** : aujourd'hui, la présentation d'un établissement (bannière, accroche, cadrage)
vit dans un fichier de configuration versionné — la changer exige un déploiement, alors que son
**ordre d'affichage seul** est déjà pilotable depuis l'admin. Cohérent avec l'audit du modèle de
données (`hifago/docs/00-modele-de-donnees.md`, champs description/géo/tags à ajouter en base) :
dans la cible, **toute** la présentation d'un établissement s'édite depuis l'admin — plus aucun
champ de présentation ne doit nécessiter un déploiement pour changer.

**Tags de catégorisation** (remplacent les 6 familles fixes, cf. client §2/§3a) : l'admin peut
créer, corriger ou retirer les tags d'une fiche — y compris ceux qu'un prestataire a proposés.

**Ordre d'affichage** : classement par petites flèches, **liste complète réécrite en une seule
opération** (jamais un déplacement partiel) — un classement n'est jamais à moitié appliqué. Le
classement se fait **à l'intérieur d'un même regroupement** (même tag, même établissement) ; un
tri par colonne suspend temporairement ce classement sans l'effacer.

**Grille tarifaire d'un logement entier** : éditable directement par l'admin ; le prix affiché
« à partir de » est **toujours recalculé** à partir du palier le moins cher, jamais saisi
séparément (pas de double vérité possible sur ce prix). Quand un prestataire a proposé sa propre
grille, l'admin voit la grille **en ligne** et la grille **proposée** côte à côte pour trancher
(§3b) — corriger une grille se fait ici, pas dans la file de modération elle-même.

**Hébergement adossé à un PMS** : lecture seule pour l'admin — le PMS fait foi, un second
calendrier serait faux dès la première réservation prise directement dans le PMS (cf. client §5).

**Décision 2026-08-13 — calendrier partagé des camps et eventos réservables** : l'admin configure/voit
la ressource de disponibilité du prestataire utilisée par chaque offre. Un camp de plusieurs jours
n'est réservable que si toute sa durée est libre. À la confirmation, la période est bloquée
automatiquement sur cette ressource et rend indisponibles les autres activités liées ; l'admin
peut toujours voir la **cause du blocage** (commande, camp ou evento, dates), plutôt que des fermetures
de produits sans provenance.

**Décision (2026-08-11) — plus aucun contenu codé en dur** : les vitrines actuellement figées
dans le front (escapades WhatsApp, texte de transport) deviennent des fiches à part entière,
gérées comme des fiches de camp ou d'evento — avec date, prix (ou libellé de prix), photo, description — plutôt
que du texte codé en dur. Un contenu vitrine reste **non réservable en ligne** (client §6) — **précision (2026-08-11)** :
pas de paiement sur la plateforme pour un evento pour l'instant, seulement un **lien de
réservation externe** (WhatsApp aujourd'hui, mais un champ lien générique, pas figé à WhatsApp
seul) que l'admin renseigne par fiche. Sa présentation est désormais éditable depuis l'admin
comme n'importe quelle autre fiche : plus aucune exception qui nécessite un déploiement pour
changer une photo, un texte, ou ce lien.

**Décision (2026-08-11) — occurrence et durée d'un evento** : un evento (comme un camp) doit
pouvoir être **ponctuel** (une seule date) ou **récurrent** (tous les N jours) — pas seulement
une date unique comme aujourd'hui. Il porte aussi une **durée** propre (pas seulement une date de
début/fin en jours entiers — une heure de début et une longueur, pour un évènement d'une soirée
par exemple). *À trancher au chiffrage* : jusqu'où va la récurrence (fréquence libre en jours,
ou motifs prédéfinis type hebdomadaire/mensuel) et sa condition de fin (jusqu'à une date, un
nombre d'occurrences, ou indéfiniment tant que l'admin ne l'arrête pas) ?

*Répercussion sur le modèle de données* : à ajouter dans `hifago/docs/00-modele-de-donnees.md`
§4 (Camp et Evento distincts) — champs occurrence (ponctuel/récurrent + fréquence) et durée, absents
aujourd'hui du schéma (`start_date`/`end_date` seuls).

*Traçabilité : `docs/2-reference/03-app-admin.md` § 8. Catalogue, Camps, Événements & Commandes,
§ Ordre d'affichage du catalogue.*

---

## 3d. Registre des identités partenaires

**Statut : ✅ validé par Jérôme le 2026-08-11.**

**Demandes d'ouverture prestataire** : une liste des demandes déjà tranchées automatiquement
(accordées si la zone est couverte, en liste d'attente sinon, cf. socio §3b) — l'admin la consulte
pour relancer, il ne re-décide pas ce que le serveur a déjà tranché.

**Gestion des capacités** : accorder une capacité (référent et/ou prestataire), changer son
statut (active / suspendue) — pour **les deux** capacités
symétriquement (socio §3a, la suspension du référent existe aussi dans la cible). Accorder la
capacité prestataire accorde toujours la capacité référent avec (invariant à conserver).

**Décision (2026-08-11) — visibilité sur l'acceptation de contrat** : puisqu'une capacité ne
devient pleinement active qu'après acceptation du contrat de rôle (socio §3a), l'admin doit voir
**cet état** (accepté / en attente) pour chaque capacité d'une identité — pas seulement son
statut technique.

**Décision 2026-08-13 — codes partenaires d'attribution** : l'admin gère leur activation et les
conditions de commission. Le code, le QR et le lien sont trois représentations du **même mécanisme
d'attribution**. L'ancien avantage client de 10 % sur l'hébergement est désactivé : aucun réglage
de remise liée au code n'est actif dans le périmètre actuel. La capacité technique d'un incentive
client futur peut rester dormante, mais ne doit jamais conditionner l'attribution du référent.

**Rattachement d'établissement, généralisé au multi-établissements (§1 socio)** : l'admin
rattache un ou plusieurs établissements à une identité, ou les transfère d'une identité à une
autre (toujours avec confirmation explicite — un transfert retire l'établissement du portail de
l'ancien partenaire). Le sélecteur propose **tous** les établissements du registre, pas
seulement ceux encore libres — choisir un établissement déjà rattaché déclenche un transfert,
jamais un rattachement silencieux en double.

**Décision (2026-08-11) — administration du multi-utilisateurs** : l'admin voit les membres
d'une organisation partenaire et peut, en dernier recours, **retirer un membre ou réassigner le
propriétaire** (socio §1) — un filet de sécurité si l'organisation elle-même est bloquée (ex. le
propriétaire a perdu l'accès à son compte).

**Décision (2026-08-11) — procédure minimale de départ d'un partenaire.** Un établissement qui
quitte la plateforme suit un ordre précis, jamais une coupure brutale :
1. **Dépublier** l'offre (plus aucune nouvelle vente), sans toucher aux réservations déjà prises.
2. **Honorer** les réservations futures déjà payées par des clients — elles suivent leur cycle de
   vie normal jusqu'au bout, la dépublication n'annule rien rétroactivement.
3. **Régler les paiements dus** au partenaire avant de clore définitivement sa capacité.
4. Seulement alors, retirer la capacité — jamais avant que les deux étapes précédentes soient
   complètes.

*À trancher au chiffrage* : que faire si le partenaire lui-même refuse d'honorer une réservation
déjà prise avant son départ (litige) — hors périmètre de ce document, relève d'une politique de
résolution de litige déjà notée comme cible future (`hifago/README.md`).

**Implémenté le 2026-08-14 — création directe d'un partenaire par l'admin** (Feature 26), en
complément des chemins `/newp`/`/newr` déjà existants : spec détaillée, table de champs et
décisions produit dans `docs/specs/01-admin-creation-partenaire.md`. Couvre le volet « création »
de la décision ci-dessus (§1, « L'admin gère aussi tous les comptes du système... directement :
création, modification, désactivation ») ; modification et désactivation directes d'un compte
restent hors périmètre de cette feature précise.

*Traçabilité : `docs/2-reference/03-app-admin.md` § 9. Partenaires · Registre ;
`docs/specs/01-admin-creation-partenaire.md`.*

---

## 3e. CRM (prospection, clients, prestataires) et carte

**Statut : ✅ validé par Jérôme le 2026-08-11.**

**Décision (2026-08-11) — fiche unifiée, simplifiée par l'identité unique** : aujourd'hui, une
même identité vit fragmentée dans plusieurs magasins séparés (compte, fiche commerciale, fiche
prestataire, conversation) — un même numéro de téléphone peut exister en plusieurs exemplaires,
sans savoir lequel fait foi. Avec l'identité unifiée déjà décidée (§1, client §1/§4, socio §1),
ce problème disparaît structurellement : **une identité, une fiche, un seul jeu de coordonnées**
— plus besoin de dire "lequel a parlé", il n'y en a qu'un.

**Ce que l'admin fait sur une fiche** (partenaire, client final, ou prestataire) :
- suivi commercial : tags, statut, notes, dernier contact, prochain rendez-vous ;
- localisation sur une **carte** (géocodage automatique à partir de l'adresse, réutilisant
  l'infrastructure déjà décidée pour les établissements — `hifago/docs/00-modele-de-donnees.md`
  § Google Maps —, avec correction manuelle possible si le géocodage se trompe) ;
- préparation d'un **itinéraire de visite** (sélection de plusieurs identités à visiter, trajet
  calculé, ordre optimisable) ;
- pour un prestataire : performance agrégée (volume, commission financée/à financer), catalogue
  qui lui est rattaché, dernières réservations.

**Décision (2026-08-11) — établissements opérés directement vs partenaires indépendants** :
avec la généralisation multi-établissements, la distinction actuelle (Casa Kayam = « interne »,
tout le reste = prestataire externe) devient une distinction générale à conserver sous une forme
neutre : un établissement peut être **opéré directement par la plateforme** (comme Casa Kayam
aujourd'hui) ou **par un partenaire indépendant** — exclu des KPIs de performance externe dans le
premier cas, inclus dans le second. Plus un statut spécial à un seul nom, mais un attribut
générique de l'établissement.

**Suivi des demandes/prospects** : listes de suivi opérationnelles (sans contact depuis N jours,
rendez-vous à venir, montants à encaisser) — pour prioriser l'action, pas seulement consulter.

**Décision (2026-08-11) — outil minimal pour une demande Habeas Data.** Sans construire un vrai
self-service (noté cible future côté socio), l'admin doit disposer d'un moyen de **retrouver
toutes les données d'une identité** à travers le système et de les **exporter ou supprimer
manuellement** si une demande légale l'exige — un minimum de conformité, pas une automatisation
complète.

*Traçabilité : `docs/2-reference/03-app-admin.md` § 4. CRM Partenaires, § 5. Carte et
itinéraires, § 7. Prestataires, § Fiche partenaire 360.*

---

## 3f. Communication (audiences, campagnes)

**Statut : ✅ validé par Jérôme le 2026-08-11.**

**Décision (2026-08-11) — une identité, une conversation, gratuitement** : avec l'identité
unifiée (§1), la déduplication des fils de conversation par identité n'est plus une migration à
maintenir (comme aujourd'hui, où plusieurs clés historiques pointent vers la même personne) —
c'est une propriété structurelle dès le départ. Rien à concevoir de plus que « une conversation
par identité ».

**Audiences** — cinq regroupements, calculés côté serveur (jamais par l'interface) :
Clients, Référents (capacité référent active, sans capacité prestataire active), Prestataires
(capacité prestataire active), Partenaires (référents ∪ prestataires), Tous. Deux invariants à
conserver : une identité multi-codes ne reçoit **jamais** deux fois le même message ; Référents
et Prestataires sont mutuellement exclusifs (un prestataire n'est jamais compté aussi comme
simple référent).

**Joignable ≠ membre de l'audience** : une identité sans contact valide (téléphone ou email
selon le canal) reste comptée et listée à part comme injoignable — jamais silencieusement omise
du décompte.

**Identités pas encore pleinement actives** : une case explicite permet de les inclure quand
même dans une audience (marquées comme telles), décochée par défaut — jamais une audience qui
varie en silence selon un statut de capacité invisible à l'écran.

**Décision (2026-08-11) — contrainte de canal, pas symétrique entre WhatsApp et email** :
WhatsApp reste soumis à des **modèles pré-approuvés** (contrainte de la plateforme de
messagerie, pas un choix produit) — jamais de texte libre en dehors d'une conversation déjà
ouverte de moins de 24h. L'**email n'a pas cette contrainte** : texte libre possible, en plus des
modèles. Les deux canaux partagent malgré tout le même mécanisme de file d'envoi et de journal.

**File d'envoi reprenable** : la position dans une campagne se conserve côté serveur, pas dans
le navigateur — fermer l'onglet, revenir plus tard, une campagne interrompue se reprend où elle
en était.

**Cadre légal (Habeas Data, Colombie)** : un envoi commercial groupé touchant des clients finaux
requiert une autorisation préalable — rappelée explicitement dès qu'une audience inclut des
clients. Ne concerne pas les audiences partenaires (relation contractuelle déjà établie, cf.
acceptation de contrat par rôle, socio §3a).

*Traçabilité : `docs/2-reference/03-app-admin.md` § 6. Onglet Messages.*

---

## 3g. Commandes et ledger

**Statut : ✅ validé par Jérôme le 2026-08-11.**

**Consultation/recherche** des commandes et de leurs lignes, avec la vue opérationnelle
nécessaire à la préparation (date **et** créneau choisis par le client — pas seulement la date).

**Transitions manuelles** : quand le cycle automatique ne suffit pas, l'admin peut faire passer
une ligne à un état terminal (réalisée / absence / annulée) — chaque transition écrit le ledger
et l'audit, jamais l'un sans l'autre.

**Décision 2026-08-13 — modification vs annulation client** : une **modification** d'une réservation
peut toucher seulement certaines lignes (annuler une activité, en ajouter une, remplacer une ligne
pour changer date/quantité) ; l'historique financier des anciennes lignes reste figé. Une
**annulation de réservation** est une action de niveau commande qui annule toutes les lignes encore
actives. L'admin doit voir clairement lequel des deux gestes a eu lieu et pouvoir reconstruire les
lignes ajoutées/remplacées.

**Déjà cohérent avec une décision précédente** : le versement d'un dû à un bénéficiaire est
bloqué si son identité n'a pas encore accepté le contrat de son rôle (socio §3a) — la commission
reste acquise, seul le versement est retenu. Rien à changer, la règle existante anticipe déjà
cette décision.

**Décision (2026-08-11) — ajustement manuel exceptionnel, avec motif obligatoire.** Le service
client réel déborde toujours du cadre structuré (politique d'annulation, règles de commission) :
l'admin doit pouvoir ajuster un montant ou une commission **hors de ces règles standards**, mais
jamais silencieusement — une note obligatoire explique pourquoi, tracée comme n'importe quelle
autre écriture (§4). Une échappatoire visible et tracée, pas un contournement discret.

**Décision (2026-08-11) — export comptable/fiscal basique.** Les données du ledger
(commissions générées, dues, payées, par bénéficiaire et par période) doivent être exportables
dans un format exploitable par un comptable — pas un module de comptabilité complet, juste de
quoi nourrir un usage externe sans ressaisie manuelle.

**Décision (2026-08-11), radicalement simplifiée le 2026-08-12 — règle fixe, plus de délai
configurable par le prestataire.** Après clarification du modèle de paiement (l'app ne mobilise
jamais que l'acompte, jamais le total), la politique n'est plus un réglage par produit/
établissement : **aucune annulation ou absence côté client ne donne jamais lieu à un
remboursement**, quel que soit le délai avant la date. Le seul cas où l'argent retourne au
client est une annulation **par le prestataire lui-même** (il ne peut pas honorer la
réservation) — alors, plus aucune commission n'est due sur la ligne.

**Ce qui change côté commission, sur une ligne annulée/no-show côté client** (l'acompte reste
encaissé) : la part app (7 % ou 17 % en direct) reste inchangée ; la part référent
(10 %, cas référent externe uniquement) n'est **pas** versée au référent — elle est **redirigée
vers le prestataire**, en compensation du créneau bloqué pour rien. Détail complet en
`hifago/docs/01-cahier-des-charges-client.md` §7/A3.

**Abandon des champs dormants `cancel_free_days`/`noshow_reversal_pct`** : repérés dans l'audit du
modèle de données comme schéma dormant à brancher, ils ne servent finalement à rien pour cet
usage — la règle est désormais fixe et universelle, pas configurable par produit. Rien à afficher
au client comme « politique » variable : juste le fait, simple et fixe, qu'une annulation
client n'est jamais remboursée (affiché avant paiement, client §2).

*Traçabilité : `docs/2-reference/03-app-admin.md` § 8. Catalogue... § Pedidos ; `src/services/ledgerService.js`.*

---

## 4. Entités de données touchées

**Statut : ✅ validé par Jérôme le 2026-08-11.**

Contrairement aux portails client et socio (périmètre restreint à ce qui les concerne), l'admin
touche **potentiellement toute** entité du système (§1 — accès total, gestion de tous les
comptes) : catalogue, établissements, comptes, codes partenaires d'attribution, commandes/ledger, CRM, conversations,
campagnes. Voir `hifago/docs/00-modele-de-donnees.md` pour l'audit champ par champ — rien à
dupliquer ici.

**Invariant transverse propre à ce rôle** : toute écriture admin est **auditée**, attribuée à
l'identité nominative qui l'a faite (§1) — un journal complet des créations, modifications de
prix/statut/capacité, transitions, résultats de synchronisation. C'est ce qui rend l'accès total
du rôle admin acceptable : rien n'est anonyme, tout est reconstituable.

**Entités propres à ce rôle, sans équivalent côté client/socio** : campagnes de communication et
leur file d'envoi, journal d'audit lui-même, fiche CRM commerciale (suivi partenaires/clients/
prestataires, distincte du profil de compte).

*Traçabilité : `docs/2-reference/05-data-model.md` § tables `audit_log`, `comm_campaigns`,
`comm_campaign_targets`.*

---

## 5. Cas limites

**Statut : ✅ validé par Jérôme le 2026-08-11.**

- **Un justificatif de paiement exige une commande existante** : le rattacher à une commande
  inconnue échoue proprement, sans laisser de fichier orphelin sur le disque.
- **Une campagne revalide toujours l'audience au moment de l'envoi, jamais seulement à sa
  préparation** : le serveur réconcilie chaque destinataire avec l'audience réelle au moment
  d'agir — une identité qui a changé de statut entre la préparation et l'envoi (suspendue,
  retirée) ne reçoit jamais un message qu'elle n'aurait plus dû recevoir.
- **Un code partenaire déjà utilisé/attribué ne se renomme pas librement** : renommer casserait
  la traçabilité de l'attribution passée. Un code jamais utilisé reste renommable.
- **Nouveau, suite à la décision multi-admin (§1)** : deux comptes admin peuvent agir sur le
  même élément en même temps (ex. approuver la même proposition). La cible doit refuser
  proprement la seconde action concurrente (« déjà traité par X ») plutôt que de la traiter deux
  fois ou de produire un résultat incohérent.

*Traçabilité : `docs/2-reference/03-app-admin.md` § 3. Comprobantes, § 6.5 Backend (campagnes),
§ 4. CRM Partenaires (renommage de code).*

---

## 6. Lacunes connues, challengées une à une

**Statut : ✅ validé par Jérôme le 2026-08-11.**

Filtré depuis `docs/2-reference/08-known-gaps.md` sur ce qui touche le back-office.

**Déjà résolues par des décisions précédentes** :

| Lacune | Traitement retenu |
|---|---|
| G14 — mot de passe unique, action non attribuable | §1 : admin nominatif, plusieurs comptes possibles. |
| A10 — calendrier Casa Kayam en lecture seule côté admin | Confirmé, cf. client §5 : le PMS fait foi, jamais de second calendrier. |

**Nouvelles décisions à prendre pour ce document :**

- **G5 — décision (2026-08-11) : jamais de PII dans le dépôt de code.** Un justificatif de
  paiement s'est retrouvé dans l'historique git du système actuel. Dans la cible, ce risque doit
  être **structurellement écarté** : les fichiers utilisateur (justificatifs, médias) vivent
  uniquement sur le stockage de données, jamais dans le dépôt versionné — une règle
  d'hygiène de développement à documenter, pas seulement à espérer.
- **A5 — décision (2026-08-11) : durcissement à prévoir.** La protection CSP est aujourd'hui
  désactivée pour accommoder des scripts en ligne et des CDN. La cible doit viser une CSP active
  par défaut — *à trancher au chiffrage* : self-host de tout ce qui le permet, exceptions
  documentées pour ce qui ne le permet pas (ex. un SDK tiers imposant son propre chargement).
- **G13 — décision (2026-08-11) : conversations en base, pas en fichier JSON réécrit entier.**
  Même raisonnement déjà appliqué aux campagnes (migration vers SQL, cf. admin §3f) : un fichier
  JSON réécrit intégralement à chaque message ne tient pas à l'échelle visée (plusieurs villes,
  plus de partenaires). Les conversations suivent la même trajectoire.
- **G15 — décision (2026-08-11) : pagination côté serveur.** La liste des destinataires/contacts
  doit être paginée dès la cible, pas ajoutée quand elle deviendra visiblement lente.

**Hors périmètre ou obsolète** :
- **A1** (chemins de diagnostic legacy, données simulées) — n'a pas lieu d'être repris, propre à
  l'ancien connecteur.
- **A16** (fils de conversation legacy non résolus) — n'existe que parce que le système actuel a
  fragmenté les identités au fil du temps ; avec l'identité unifiée dès le départ (§1), ce
  problème n'a pas d'équivalent à construire. Une éventuelle migration de données réelles reste
  un sujet à part (cf. plan de bascule, `hifago/README.md`), pas une règle métier de la cible.
- **G3** (PDF partenaires obsolète) — un sujet de contenu/documentation, pas une lacune du
  produit à reprendre ici.

*Traçabilité : `docs/2-reference/08-known-gaps.md` (G3, G5, G13, G14, G15, A1, A5, A10, A16).*

---

## 7. Annexe — traçabilité code→règle

**Statut : ✅ validé par Jérôme le 2026-08-11.**

### Fichiers sources par section

| Section | Fichiers sources principaux |
|---|---|
| §1 Périmètre et vision | `docs/2-reference/03-app-admin.md` (§ Rôle, § Structure du dashboard) |
| §2 Parcours utilisateurs | `docs/2-reference/03-app-admin.md` (l'ensemble, 10 onglets) |
| §3a Réconciliation PMS | `docs/2-reference/03-app-admin.md` (§ 1. Import CSV), cahier des charges client §3f/§5 |
| §3b Modération des propositions | `docs/2-reference/03-app-admin.md` (§ File d'approbation des fiches proposées) |
| §3c Gestion directe du catalogue | `docs/2-reference/03-app-admin.md` (§ 8. Catalogue, Camps, Événements & Commandes) |
| §3d Registre des identités | `docs/2-reference/03-app-admin.md` (§ 9. Partenaires · Registre) |
| §3e CRM et carte | `docs/2-reference/03-app-admin.md` (§ 4, § 5, § 7, § Fiche partenaire 360) |
| §3f Communication | `docs/2-reference/03-app-admin.md` (§ 6. Onglet Messages) |
| §3g Commandes et ledger | `docs/2-reference/03-app-admin.md` (§ 8 § Pedidos), `src/services/ledgerService.js` |
| §4 Entités de données | `docs/2-reference/05-data-model.md`, `hifago/docs/00-modele-de-donnees.md` |
| §5 Cas limites | `docs/2-reference/03-app-admin.md` (§ 3, § 6.5, § 4) |
| §6 Lacunes connues | `docs/2-reference/08-known-gaps.md` (G3, G5, G13, G14, G15, A1, A5, A10, A16) |

### Points explicitement laissés ouverts pour le chiffrage technique

1. **§2** — indicateurs précis et périodes de comparaison pour le suivi analytique (graphiques
   de tendance).
2. **§2/§3f** — l'email groupé reste-t-il aussi manuel que WhatsApp, ou nécessite-t-il un vrai
   service d'envoi (SMTP transactionnel, désabonnements) ?
3. **§3c** — granularité de la récurrence d'un evento (fréquence libre ou motifs prédéfinis) et
   sa condition de fin.
4. **§3d** — que faire si un partenaire en partance refuse d'honorer une réservation déjà prise
   (renvoie vers la résolution de litige, cible future) ?
5. **§6 (A5)** — self-host complet vs exceptions documentées pour durcir la CSP.

### Cibles futures importantes (hors périmètre immédiat)

Consolidées dans `hifago/README.md`. Voir aussi `hifago/docs/00-modele-de-donnees.md` pour
l'audit champ par champ des entités partagées, et les champs d'occurrence/durée d'un evento
(§3c). La politique d'annulation (§3g) est finalement une règle fixe, pas un champ de données par
produit — les colonnes dormantes envisagées pour elle sont abandonnées, cf. §3g.
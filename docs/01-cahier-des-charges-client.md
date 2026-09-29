---
id: refonte-cdc-client
titre: "Cahier des charges — portail client (marketplace global, Guatapé = première localisation)"
theme: cadrage
statut: brouillon
maj: 2026-09-22
resume: >
  Comportement métier cible du portail de réservation client, dérivé du comportement réel actuel
  et challengé section par section avec Jérôme avant reprise dans la refonte.
mots_cles: [cahier des charges, client, portail client, reservation, marketplace, guatape]
repond_a:
  - "Que doit faire le portail client (apps/web) dans la refonte ?"
---

# Cahier des charges — portail client

## Écarts connus (alimenté par les specs qui révisent ce cahier — voir leur champ `revise:`)

- **Paiement en ligne, statut « hors périmètre v1 »** (l.845, l.904 « Cibles futures importantes ») —
  rouvert explicitement par `docs/specs/19-paiement-mercadopago-acompte-ledger.md` (statut
  `partiel`) : Mercado Pago remplace Wompi comme gateway cible, l'acompte devient obligatoire en
  ligne (moteur 17/10/7). La règle de non-remboursement/redistribution A3 (l.821-847) reste
  inchangée — la spec la cite comme prémisse, elle ne la modifie pas. Sections ci-dessous non
  réécrites — cette ligne en tient lieu. Deux endroits précis de ce cahier sont concernés au-delà
  des lignes citées : §1 « Hors périmètre de ce portail : paiement en ligne (paiement à l'arrivée
  uniquement) », et §3f décision 4 (« des statuts de paiement ne seront introduits que lorsque le
  paiement en ligne sera réellement implémenté ») — la condition est remplie, ces statuts existent.
  **Précisé le 2026-09-20** (`docs/specs/39-garantie-confirmation-paiement.md`, arbitrage en
  attente) : la confirmation d'un paiement dont le client NE REVIENT PAS sur le site n'est **pas
  encore garantie** — elle tient par le webhook seul, et l'expiration à 30 min (§3f) n'interroge
  jamais Mercado Pago. Depuis ce jour, un paiement approuvé après expiration ou annulation ne
  confirme plus une commande morte (l'admin est prévenu, `kind = 'refund_required'`), mais rien ne
  rembourse ni ne réhonore, et le client n'a aucun signal — trois décisions de Jérôme (D1/D2/D3).
  **Tranché et livré en local le 2026-09-22** (spec 39 §C) : un job interroge Mercado Pago toutes
  les 2 min et confirme sans retour du client ; l'expiration à 30 min (§3f) rend désormais les
  places ; un paiement en attente (PSE) est toléré 2 h ; un paiement arrivé trop tard vaut un
  e-mail immédiat au client (« recibimos tu pago… te contactamos ») et un remboursement à un clic
  côté admin. Le « paiement jamais remboursé » de §7/A3 reste vrai pour une annulation ou une
  absence du client — il ne s'applique pas à un paiement que hifago n'a rien à honorer.

- **§2b.9 contrainte (a) — PÉRIMÉE le 2026-09-10**, révisée par
  `docs/specs/33-resultat-paiement-et-fermeture-du-tunnel.md` (statut `implemente`). Elle affirme que
  « la policy `orders_select` **exclut l'invité de toute lecture** ». C'était vrai le 2026-09-07 ; ça
  ne l'est plus depuis la spec 31, livrée trois jours après : `orders_select` vaut
  `is_admin() or account_id = (select auth.uid())`, et `orders.account_id` est désormais **NOT NULL**
  et porte l'identité **anonyme** du visiteur. Un invité **peut** donc lire sa propre commande, sur
  son propre appareil. **La décision ne change pas** — l'adresse porte bien un jeton — mais sa RAISON
  change : le jeton ne contourne pas une policy qui exclurait l'invité, il sert à rouvrir le lien
  **depuis l'email, des mois plus tard, sur un autre appareil, ou après purge de la session**. C'est
  aussi ce qui justifie qu'il n'expire jamais. La contrainte (b) (ajouter l'adresse à `robots.ts`),
  elle, tient : elle est appliquée.
- **§2b.9 « numéro de réservation » — précisé le 2026-09-10** (même spec) : le numéro que le client
  garde est `orders.reference`, de forme `HFG-000042`, **distinct du secret d'accès**
  (`orders.access_token`). Le cahier ne disait pas lequel des deux était lequel ; les fusionner
  aurait rendu impossible d'afficher ou de dicter un numéro sans donner du même geste accès aux
  données personnelles du client.
- **§2f « rattachement d'une commande passée en invité » — REFERMÉ le 2026-09-10** (même spec) : le
  mécanisme existe, c'est la RPC `attach_orders_to_account`, appelée après vérification de l'email.
  ⚠️ Elle ne rattache **que** des commandes appartenant encore à une identité anonyme — sans quoi un
  compte réel ayant saisi l'email d'un tiers perdrait sa commande le jour où ce tiers s'inscrit
  (arbitré par Jérôme le 2026-09-10).

Ajoutés par la relecture intégrale du 2026-09-07 :

- **§3a (l.275 `schedule`), §3d (l.431 « produit à créneaux ») et §3e (l.499 `'slot'`) — contredits
  par `docs/specs/18-creneaux-horaires-reservables.md`** (statut `implemente`, livrée le
  2026-08-18). Un créneau n'est plus le binaire matin/après-midi hérité du legacy :
  `product_slot_rules` définit des créneaux horaires arbitraires (jours de semaine, plage, durée,
  capacité par règle), `product_slot_availability` porte leurs cupos, et `create_order` verrouille
  par `(product_id, slot_date, slot_start_time)`. Deux conséquences sur le texte ci-dessous : la
  phrase « une date n'est fermée que si ses **deux** créneaux sont pleins » n'a plus de sens (il y
  en a autant que la règle en produit), et la colonne `product_calendar.closed_slot` qu'elle
  décrivait a été droppée (spec 17 T0, migration `20260817160000`). `products.schedule` survit en
  base mais son `'slot'` est mort : la spec 17 §10 a retenu `product_slot_rules` comme unique
  mécanisme de créneau. La spec 18 avait explicitement renvoyé ces trois sections à une relecture
  ultérieure (« Out : mise à jour des 3 cahiers des charges — référencés, pas réécrits »).
- **§3a, « Périmètre — décision 2026-08-13 » (la remise par quantité/personnes « ne s'applique
  jamais aux chambres, dortoirs ou logements entiers ») — contredit dans sa forme par
  `docs/specs/12-admin-alojamiento-house.md`.** `price_tiers`/`min_qty`/`max_qty` y ont été
  réutilisés tels quels pour `type='lodging'`, `qty` valant le nombre de personnes. La nuance qui
  sauve l'intention : `price_tiers` est un **prix absolu par tranche**, pas un « seuil + pourcentage
  de remise » — le mécanisme de *remise* décrit ici n'a jamais été construit, pour aucun type de
  produit (cf. `00-modele-de-donnees.md` §3, ligne « Prix par palier de quantité/personnes »). Ce
  qui est faux, c'est l'idée qu'un hébergement n'aurait aucune tarification par nombre de personnes.
- **§3a, `qty` sur une ligne `lodging` — sémantique RENVERSÉE le 2026-09-16**, révisée par
  `docs/specs/12-admin-alojamiento-house.md` (§ « Modèle de données », migration
  `20260916120000_fix_lodging_price_missing_qty`). La puce précédente dit « `qty` valant le nombre
  de personnes » : c'était vrai le 2026-08-16, ça ne l'est plus. `qty` désigne désormais des
  **unités facturables** — un lit pour `lodging_kind='dorm'`, une chambre pour `'private'`,
  toujours 1 pour `'whole_house'` — jamais des occupants ; `price_tiers[].price_cop` est donc un
  prix **par unité et par nuit**, multiplié par `qty` comme dans toute autre branche de
  `create_order`. Ce n'était plus le cas depuis la fusion des branches `room_type_id`/lodging du
  2026-08-27 (régression silencieuse de trois semaines). Conséquence pour §3a l.529 (« Maison/
  logement entier : prix par palier de nombre de personnes ») : lire « par palier d'unités
  facturables ». Sections ci-dessous non réécrites — cette ligne en tient lieu.
- **§3a, « remise optionnelle par quantité/nombre de personnes » — construite, pour `camp`
  uniquement (2026-09-14).** `docs/specs/36-remise-remplissage-camp.md` referme l'écart signalé par
  la puce précédente : `products.group_discount_threshold_qty`/`group_discount_pct` existent
  désormais, mais portent sur le remplissage **cumulé** d'une session de camp
  (`product_availability.booked`), pas la quantité d'une seule ligne — une lecture plus étroite que
  ce §3a envisageait (activité/transport/camp/evento). L'extension aux autres types reste un
  chantier distinct, non décidé.
- **§4, renvoi au « gap critique » du modèle de données — périmé.** Fermé par
  `docs/specs/24-modele-hebergement-et-surface-lobbypms.md` (T3, 2026-08-27) : une chambre est
  désormais un produit `lodging` avec son `product_availability` et son `product_date_rates`. Voir
  l'en-tête « Écarts connus » de `00-modele-de-donnees.md`.
- **§5, dernier point des « Limites connues » (l'identifiant d'un type de chambre PMS-backed « EST
  directement » l'identifiant de catégorie côté PMS) — périmé, même spec 24.** L'identifiant interne
  est `products.id` ; le lien vers Lobby est une colonne à part, `products.lobby_category_id`.
  L'invariant que ce paragraphe demandait « à construire » est donc acquis. Reste vrai, et posé par
  la même spec : Lobby fait foi sur la **disponibilité** seule, hifago sur tout le reste (nom,
  description, photos, capacité, prix), Lobby ne faisant que **proposer** une valeur à la liaison.
- **§7, dernière lacune (« un prix par personne multiplié automatiquement ? La convention actuelle
  suppose la première ») — TRANCHÉE le 2026-09-16**, même spec 12 et même migration
  `20260916120000`. La réponse retenue pour `lodging` est : le prix saisi est un prix par **unité
  facturable**, et `create_order` le multiplie par `qty`. La convention que ce paragraphe disait
  « supposée » est donc devenue explicite, vérifiée par un test de parcours réel
  (`apps/web/e2e/reserve-lodging-range.spec.ts`, scénario `qty > 1`) en plus du pgTAP.
- **§7/A11 et §8 « Cibles futures importantes », mention « tarif week-end différencié » — périmé
  pour l'hébergement.** Livré par `docs/specs/12-admin-alojamiento-house.md` (majoration week-end
  dans `products.stay_rates`, nouveauté assumée face à la v1). Séjour minimum et délai de préavis
  minimum, eux, restent bien à construire.
- **§3e, « le modèle de la ligne de panier reste à concevoir » (et « rend le réordonnancement
  littéralement inécrivable ») — périmé, `docs/specs/32-panier-en-base.md`.** Cette spec a livré ce
  modèle le 2026-09-10 : `cart_items.product_id` se joint à `products.type`, ce qui a exactement
  débloqué le réordonnancement (spec 28 Tranche 3, livrée le 2026-09-13). Le corps de §3e n'est pas
  réécrit — cette puce en tient lieu.

Ajoutés par la réécriture du §2 le 2026-09-07 — **contradictions internes à ce document**, que
`npm run docs:check` ne sait pas détecter (il ne vérifie que le couplage spec↔cahier) :

- **§3e contredit frontalement §2b.6 sur la durée de vie du panier.** §3e écrit que le panier
  « n'est pas persisté au-delà de la session en cours (perdu si l'onglet est fermé) » ; §2b.6,
  réécrit le 2026-09-07, écrit qu'il « survit à un rechargement **et** à la fermeture de l'onglet ».
  §3e n'a pas été réécrit — une section est une unité de validation avec Jérôme — mais son statut
  passe à « à rouvrir » dans le sommaire, et il ne doit plus être lu comme opposable sur ce point.
  ⚠️ **Propagé hors des cahiers** : `apps/web/lib/cart/CartContext.tsx` cite nommément §3e pour
  interdire toute persistance. Le commentaire n'est pas encore faux (§3e reste la version validée) ;
  il le deviendra à la seconde où Jérôme revalidera §2b.6, et devra être corrigé dans le même geste.
- **§4 décrit encore la modification partielle d'une réservation comme une écriture du portail
  client**, sous le titre « Écrit par le portail », alors que §2c l'a retirée du premier périmètre
  le 2026-09-07. Le mécanisme décrit y reste exact — annuler puis recréer, jamais recalculer une
  ligne en place, snapshots préservés — mais il vaut désormais côté **socio/admin**
  (`modify_order_line`), pas côté client, dont le seul geste self-service sur une commande
  existante est l'annulation entière.
- **§2c gagne déconnexion et suppression de compte — 2026-09-11**, ajoutées par
  `docs/specs/35-compte-profil.md` (statut `implemente`) : deux gestes absents du cahier jusqu'ici,
  pas une révision d'un point déjà tranché. La suppression **anonymise** le compte
  (`partner_accounts.full_name`/`.phone` effacés, `auth.users` neutralisé) et ne touche **jamais**
  les commandes déjà passées — la PII et les commissions y sont dénormalisées, indépendantes du
  compte. Bloquée pour tout compte porteur d'une capacité professionnelle (référent, opérateur,
  admin). Le §2c ci-dessus porte directement les deux nouveaux points, pas seulement cette ligne.
- **Passe de maintenance des §0 — 2026-09-28, sans écart nouveau.** Les §0 des specs qui révisent
  ce cahier ont été remises en phase avec le code (chemins déplacés, signatures changées par une
  spec ultérieure — ex. `create_order` sans `p_lines` depuis la spec 32) : aucune décision
  modifiée, aucune section de ce cahier à réécrire. Specs touchées : 18, 19, 32, 33.

> Méthode : une section = une unité de validation avec Jérôme. Statut par section :
> `brouillon` → `en relecture` → `✅ validé par Jérôme le AAAA-MM-JJ`.
> Sources principales : `docs/2-reference/04-app-reservar.md`, `docs/1-manuels/10-client.md`,
> `src/services/pricingService.js`, `src/services/portalService.js`.

> **Décision (2026-08-11)** : ce document ne parle plus de « `/guatape` » comme identité du
> produit. La cible est un **marketplace global**, pas un site scopé à une ville — Guatapé n'est
> plus qu'une **localisation/tag** parmi d'autres (cohérent avec la recherche géographique et les
> tags de catégorie du §2). Les sources ci-dessus, issues du système actuel, restent scopées
> Guatapé/Casa Kayam ; ce document en extrait le comportement métier généralisable, pas le nom.

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 1 | Périmètre et vision | ✅ validé 2026-08-11 |
| 2 | Parcours utilisateurs | ✅ réécrit et validé 2026-09-07 |
| 3a | Catalogue et tarification produits | ✅ corrigé 2026-08-13 |
| 3b | Moteur de commission (17/10/7) | ✅ validé 2026-08-11 |
| 3c | Code partenaire / attribution référent | ✅ corrigé 2026-08-13 |
| 3d | Disponibilité, cupos, calendrier | ✅ corrigé 2026-08-13 |
| 3e | Règles de panier | ✅ réécrit et validé 2026-09-07 |
| 3f | Cycle de vie de la commande | ✅ validé 2026-08-11 |
| 4 | Entités de données touchées | ✅ corrigé 2026-08-13, amendé 2026-09-07 (§2c) |
| 5 | Intégration LobbyPMS | ✅ validé 2026-08-11 |
| 6 | Cas limites | ✅ validé 2026-08-11 |
| 7 | Lacunes connues, challengées une à une | ✅ validé 2026-08-11 |
| 8 | Annexe — traçabilité code→règle | à rédiger |

---

## 1. Périmètre et vision

**Statut : ✅ validé par Jérôme le 2026-08-11** (revalidé après réouverture pour le compte client).

Le portail client est le point de vente direct au visiteur final. Il permet de composer et payer
(à l'arrivée) une réservation combinant, dans une seule commande :

- une ou plusieurs **nuits** (dortoir/chambre d'un hôtel/hostel, ou maison entière d'un
  logement complet — deux patterns génériques, cf. §3a ; Casa Kayam et Bania ne sont que les
  instances actuelles de ces patterns, pas des cas particuliers du produit) ;
- des **activités** (musique/studio, arts et culture, bien-être, nautique, adrénaline,
  gastronomie) ;
- du **transport** (un ou plusieurs prestataires) ;
- des **camps** (escapades multi-jours vendables, avec une durée et une capacité propres) ;
- des **eventos** (événements éditoriaux/ponctuels ou récurrents, distincts des camps dans le
  parcours client ; un evento n'est réservable en ligne que si l'admin l'a explicitement activé).

Une commande **sans nuit** (prestations seules) est autorisée. Le mécanisme historiquement nommé
« code promo » est désormais un **code partenaire d'attribution** : il sert à rattacher la commande
au référent et à calculer les commissions, au même titre que le QR/lien attribué. **Aucune remise
client liée à ce code n'est active dans le périmètre actuel** ; l'ancien 10 % sur l'hébergement est
abandonné. La capacité technique d'un avantage client futur reste dormante et découplée de
l'attribution (§3c).

**Nouvelle règle décidée (2026-08-11) — compte client** : contrairement à ce qui était validé
initialement (portail « sans compte »), la cible inclut un **compte client** — connexion,
consultation de ses informations, historique de ses réservations (détaillé en §2). *Recommandation
à confirmer* : ce compte reste **optionnel** — réserver en tant qu'invité, sans jamais se
connecter, doit rester possible (c'est la norme dans les apps de réservation : forcer un compte
avant achat fait perdre des ventes) ; le compte n'apporte qu'un confort en plus, jamais une
obligation pour réserver.

**Décision (2026-08-11, précisée dans le cahier des charges socio §1)** : ce compte client n'est
pas un système à part — c'est la **même base d'utilisateurs** que celle des portails socio et
admin, avec des **rôles composables** (client / référent / prestataire / admin) sur une seule
identité. Une personne qui réserve ET réfère des clients n'a qu'un seul compte.

**Frontières avec les autres portails :**
- **`/partner`** (socio) : configure son offre (produits, calendrier, tarifs maison entière),
  reçoit ses commissions. Le portail client ne fait que **consommer en lecture** le catalogue
  qu'un socio a fait approuver côté admin — aucune logique de configuration ici.
- **`/admin`** : source de vérité du catalogue (prix, visibilité, réservabilité, ordre
  d'affichage). Le portail client n'écrit jamais dans le catalogue, seulement dans les commandes.
- **LobbyPMS** : connecteur **optionnel, par propriété** — pas une dépendance globale. Une
  propriété avec PMS (aujourd'hui Casa Kayam) y lit sa disponibilité/tarifs de nuits et y crée le
  booking ; une propriété sans PMS (aujourd'hui Bania) gère sa disponibilité et ses tarifs dans
  le catalogue interne. Ce pattern doit rester généralisable : d'autres hébergements pourront
  s'ajouter avec un PMS différent ou sans PMS du tout.

**Nouvelle règle décidée (2026-08-11) — pages légales/institutionnelles** : le site doit porter
les pages classiques d'un site marchand — mentions légales, politique de confidentialité
(pertinent en Colombie pour le cadre Habeas Data, déjà mentionné pour le CRM interne), page de
contact, une page d'aide/FAQ, et probablement des conditions générales de vente/utilisation
(incluant la politique d'annulation générale, cf. §2). Leur **contenu** reste à rédiger plus tard
(pas une règle métier à extraire du code actuel, qui n'en a pas aujourd'hui) — seule leur
présence est actée ici comme un pré-requis du site.

**Hors périmètre de ce portail** :
- paiement en ligne (paiement à l'arrivée uniquement — MercadoPago/Stripe évoqués comme cible
  future, non tranché) ;
- toute action de configuration du catalogue ou des tarifs.

---

## 2. Parcours utilisateurs

**Statut : ✅ validé par Jérôme le 2026-09-07** — section entièrement réécrite le même jour.
Version précédente (✅ validée le 2026-08-11) : `git show e5d3959:docs/01-cahier-des-charges-client.md`.
Cette réécriture est issue d'une **interview étape par étape** menée avec Jérôme le 2026-09-07,
avant l'ouverture du chantier front de `apps/web` — les quatre axes du parcours avaient changé.
Ce qui n'est pas daté du 2026-09-07 ci-dessous est **inchangé** depuis la validation du 2026-08-11.

> Décrit les étapes fonctionnelles du parcours (ce que le client fait, dans quel ordre, ce qui
> est obligatoire vs optionnel) — pas l'implémentation d'interface actuelle (carrousels,
> animations, mise en page), qui sera entièrement redessinée (cf. cadrage général). Une étape
> décrite ici doit survivre au changement de front ; un détail d'interaction ne le doit pas.

### 2a. Accueil et découverte

**Décidé le 2026-08-11, précisé et modifié le 2026-09-07.** N'existe pas dans le portail actuel,
qui ouvre directement sur le parcours de réservation sans page de découverte.

- **L'accueil et l'écran de résultats de recherche sont la même page** (2026-09-07) : en-tête,
  bloc de recherche, une section par type d'offre, pied de page. Une recherche ne change pas
  d'écran, elle change les critères.
- **Une section par type d'offre** : activités, hébergements, transports, **camps**, **eventos**.
  Camps et eventos ne sont **jamais fusionnés** dans un même parcours ni dans une même catégorie
  générique. Ordre décidé le 2026-09-07 : **activités d'abord**, puis hébergements, transports,
  camps, eventos.
- Chaque section montre **au plus huit offres** et un lien « voir plus » vers sa page de listing
  (2026-09-07). **Une section vide n'est pas affichée.**
- **L'algorithme de mise en avant au sein d'une section reste hors périmètre** (confirmé le
  2026-09-07). La contrainte d'architecture est conservée : le classement d'une section doit
  rester un **point d'extension isolé**, jamais une règle éparpillée dans l'affichage, pour qu'on
  puisse en changer — et faire tourner des variantes en A/B testing — sans rouvrir un écran.
- **Barre de recherche généraliste** (périmètre arrêté le 2026-09-07) : on cherche par **tag**,
  par **nom**, par **type d'offre** et par **établissement** ; on filtre par **nombre de
  personnes** et par **dates**. Les résultats restent **groupés par section**, les sections vides
  masquées.
- **Sens exact des deux filtres, arrêté le 2026-09-07** — c'est ce qui les rend testables :
  - **Nombre de personnes = capacité déclarée**, jamais les places réellement restantes. Taper 3
    montre ce qui *peut accueillir* 3 personnes ; une chambre pour 4 sort même si elle est déjà
    occupée. **Conséquence voulue** : le filtre ne consulte aucune disponibilité, donc il fonctionne
    sans dates et n'interroge jamais un PMS externe pendant une recherche.
  - **Dates = chevauchement**, jamais inclusion. Une ou deux dates ; une offre remonte dès que sa
    période **croise** la plage demandée, et elle peut donc **déborder avant et après** — un camp du
    10 au 15 sort pour une recherche du 12 au 13.
  - Un produit **sans date requise** reste visible même quand des dates sont saisies : rien ne
    permet de l'exclure.
- Le **bloc de recherche reste présent sur toutes les pages qui affichent des listes**, et les
  critères saisis **se conservent d'un écran à l'autre** (2026-09-07).
- **Où vivent ces critères, décidé le 2026-09-07** : dans **l'adresse des pages qui affichent des
  résultats** (accueil et listings), qui en ont besoin pour filtrer côté serveur et dont l'URL
  devient ainsi partageable ; **dans la mémoire du navigateur ailleurs**. Une fiche produit ou
  établissement garde donc une **adresse propre et unique**, et son calendrier se pré-remplit quand
  même avec les dates cherchées. **Conséquence assumée et voulue** : les fiches restent cacheables,
  seules les listes sont rendues à chaque requête.
- **Pages de listing dédiées, navigables et indexables** — pas seulement atteignables par une
  recherche active (2026-08-11), avec une structure arrêtée le 2026-09-07 :
  - la page des **activités** est un **index de sous-catégories** (les tags : jet ski, buceo,
    kayak…), sans produit ; on y clique pour atteindre la liste des offres d'un tag. **Seuls les
    tags portant au moins une offre publiée y figurent** (2026-09-07) — un tag vide produirait une
    page vide que Google indexerait ;
  - les quatre autres types **listent directement leurs offres**.
- **Granularité par tags** (2026-08-11, inchangé) : plutôt qu'une liste de familles figée dans le
  code, la cible utilise des **tags** saisis par le prestataire/gérant de l'offre ou par l'admin.
  Reste à détailler : tags libres ou choisis dans une liste gérée, modération éventuelle, lien
  avec les six familles actuelles.
- **Marketplace global** : « Activités à Guatapé » n'est qu'un exemple de page de tag ; Guatapé est
  une localisation parmi d'autres, pas l'identité de la plateforme.

### 2b. Parcours principal — composer et valider une réservation

Réécrit le 2026-09-07. Les invariants métier (§3d anti-survente, §3b commission figée) sont
inchangés ; c'est l'enchaînement des écrans qui change. ⚠️ **Une exception : §3e est révisé sur un
point — la persistance du panier (§2b.6) — et ses plafonds restent à revoir (§2f).** §3e n'a pas
été réécrit, il est marqué à rouvrir.

1. **Arrivée** — sur l'accueil, ou directement sur une fiche par lien profond, QR ou lien attribué
   portant un code partenaire en arrière-plan (§3c). *Inchangé.*
2. **Découverte** — accueil, recherche, ou page de listing (§2a).
3. **Consultation d'une fiche.** Pour tout ce qui n'est pas un hébergement : photos, titre,
   description, prix, une section présentant l'**établissement**, et le **calendrier de sélection
   de date**. Les parcours Camp et Evento restent distincts ; ils ne sont pas présentés comme deux
   variantes d'un même produit. *(Structure d'écran arrêtée le 2026-09-07.)*
4. **Hébergement — parcours propre** (2026-09-07) : on passe par la **fiche de l'établissement**,
   qui présente ses couchages en cartes ; on ouvre un couchage, on voit sa fiche et son calendrier.
   Dans les listes, un établissement apparaît comme **une seule offre dès qu'il propose deux
   couchages ou plus** ; un logement isolé reste une offre à lui seul. Choisir un hébergement
   reste **optionnel** : une commande peut n'avoir aucune nuit (§3e). *Cohérent avec la spec 24 :
   l'hôtel est l'établissement, le couchage est un produit.*
   **Prix affiché sur une carte groupée (décidé le 2026-09-07)** : « **desde** X COP », où X est le
   **prix minimum** de ses couchages, porté par une colonne dédiée sur l'établissement et
   **recalculée à chaque ajout, édition ou suppression** d'un produit. ⚠️ C'est une dénormalisation :
   elle doit être maintenue **dans la même transaction** que la modification du produit, sinon elle
   dérive en silence — la spec devra porter la règle et son test.
5. **Ajout au panier, puis retour à la découverte** (2026-09-07) — **ceci ferme le point laissé
   ouvert le 2026-08-11 sur le placement des suggestions complémentaires** : elles ont lieu
   **après chaque ajout**, et non à l'étape de paiement. Après un ajout, le client revient à
   l'accueil, **ses critères de recherche conservés** et **les sections réordonnées selon ce qu'il
   a déjà au panier**. **Règle exacte, arrêtée le 2026-09-07** : les types **absents** du panier
   passent devant, dans leur ordre habituel ; les types **déjà présents** tombent à la fin, dans le
   leur. Le client voit donc toujours d'abord ce qu'il n'a pas encore. Choisie contre la variante
   « suivre le dernier ajout » parce que l'ordre ne saute pas à chaque clic. C'est une proposition,
   jamais un blocage. **Le plafond de huit par section vaut aussi sous recherche** (2026-09-07) ;
   une section à zéro résultat n'est pas affichée ; et **aucun ordre particulier n'est retenu** à
   l'intérieur d'une section pour l'instant, cohérent avec le classement laissé hors périmètre.
   L'ajout de prestations reste **optionnel et cumulable** ; chacune peut exiger une date, ou une
   date et un créneau, selon sa nature (§3a/§3d).
   ⚠️ **Sixième renversement, acté le 2026-09-07** : la promesse « le client voit en temps réel les
   places restantes quand elles se raréfient », portée par la version du 2026-08-11 et héritée du
   portail actuel, est **retirée**. Aucun compteur de places restantes n'est affiché au client, à
   aucun seuil. L'anti-survente (§3d) reste évidemment entier — c'est l'affichage qui disparaît, pas
   la règle.
6. **Panier** (2026-09-07) — un écran à lui. Le panier **survit à un rechargement et à la fermeture
   de l'onglet**. Conséquence assumée : il peut porter des lignes vieilles de plusieurs jours, donc
   **la disponibilité est revérifiée** à la reprise. *Le prix, lui, ne bouge pas (décision du
   2026-09-07) — et même s'il bougeait, `create_order` calcule tous les montants **côté serveur**,
   le navigateur n'en envoyant jamais aucun : un panier ancien ne peut pas faire payer un ancien
   prix.* Une ligne devenue indisponible est
   **signalée en place**, avec le moyen de la retirer ; les autres lignes et le total sont
   conservés ; **jamais de retrait automatique** (invariant §3d).
7. **Coordonnées du client** : nom, WhatsApp et email (**tous trois obligatoires depuis le
   2026-08-17**, cf. §3e) ; document/commentaire restent optionnels. Pré-remplis si le client est
   connecté. **Aucun champ de code promo/code partenaire n'est affiché au client final** (§3c).
   La **connexion est proposée à cette étape, jamais imposée** (2026-09-07) — et au retour de la
   connexion, **ce sont les informations du compte qui font foi** : elles remplacent ce que le
   visiteur avait éventuellement déjà tapé. Le panier n'est jamais perdu par ce détour.
8. **Paiement** : **un seul paiement, à la fin**, pour toute la commande — même si elle combine
   plusieurs établissements/prestataires (§3e), la **facturation interne restant divisée par
   ligne/prestataire** (§3b/§4). La **condition d'annulation** est affichée ici, avant de payer
   (§2d). Le paiement en ligne est effectif depuis la spec 19 (Mercado Pago, acompte obligatoire) ;
   il **fait sortir du site** et le client revient ensuite sur le portail.
9. **Résultat** (2026-09-07) — un écran **avec une adresse propre à la commande**, rechargeable et
   réouvrable plus tard.
   **Accès, décidé le 2026-09-07** : l'adresse porte un **code secret impossible à deviner** et
   reste valable **sans limite de temps** ; elle part aussi dans l'email de confirmation, ce qui la
   rend retrouvable des mois plus tard. Tradeoff assumé : qui détient le lien voit le nom, le
   téléphone et l'email du client.
   **Créer un compte depuis cet écran rattache les commandes par adresse email** (2026-09-07) —
   l'email étant déjà vérifié à l'inscription, c'est ce qui rend le rattachement sûr. Ce mécanisme
   n'existe pas encore : RPC à écrire.
   ⚠️ **Deux contraintes vérifiées le 2026-09-07, à traiter dans la spec** : (a) la policy
   `orders_select` **exclut l'invité de toute lecture** — « l'invité n'a justement aucune session
   pour prouver la propriété de sa commande » (migration `20260818200000_payments.sql`) — donc cet
   écran, conçu d'abord pour lui, exige un jeton porté par l'URL ou une lecture `service_role` dans
   un Route Handler, jamais une lecture directe ; (b) cette adresse porte le nom, le téléphone et
   l'email d'un client : `robots.ts` ne bloque aujourd'hui que `/{locale}/r/`, `/auth/` et `/api/`,
   elle doit donc y être ajoutée. Il porte le ou les **numéros de réservation**, le **récapitulatif** et les
   **totaux**, et propose au client **de créer un compte** pour retrouver sa réservation.
   En cas d'échec de paiement, la réservation est **conservée** et le client se voit proposer de
   **réessayer** — jamais un retour silencieux au panier.
   ⚠️ **Changement assumé le 2026-09-07, maintenu après vérification** : cet écran ne porte
   **plus** de contact WhatsApp pré-rempli, alors que le portail actuel en production en porte un.
   Le canal de suivi d'un client sans compte devient **l'email de confirmation** (Resend, spec 23,
   envoi réel vérifié le 2026-08-31) et cet écran lui-même, réouvrable à son adresse.
   *La première rédaction de ce paragraphe justifiait le retrait par « le pied de page porte un
   contact WhatsApp sur toutes les pages » — c'était faux à deux titres et la justification est
   retirée : `SiteFooter` n'est monté dans aucune route à ce jour, et l'architecture de coquilles
   retenue le place dans la zone vitrine, pas dans la zone tunnel où vit cet écran.*

### 2c. Compte client

Décidé le 2026-08-11 (cf. §1), révisé le 2026-09-07.

- Le client peut **créer un compte / se connecter à tout moment** du parcours — avant, pendant ou
  après une réservation — **jamais une obligation pour réserver** (§1). *Inchangé.*
- Une réservation faite **sans être connecté** reste possible et complète. *Inchangé.*
- **Deux mécanismes** : email/mot de passe **et** connexion Google. Un compte reste identifié par
  un email unique quel que soit le mode utilisé. *Inchangé.* S'y ajoutent **mot de passe oublié et
  réinitialisation** (2026-09-07), qui n'existent aujourd'hui que côté `apps/admin`.
- **Ce que le compte donne** (arrêté le 2026-09-07) : l'**historique des réservations** passées et
  en cours ; le **profil** (ses informations, source du pré-remplissage) ; **l'annulation d'une
  commande entière** ; et le moyen de **contacter l'établissement ou Hifago**, par un contact
  WhatsApp **par réservation**, avec le numéro de réservation dans le message.
- **Se déconnecter** et **supprimer son compte** — absents de ce cahier jusqu'au 2026-09-11,
  ajoutés par la spec 35 (`docs/specs/35-compte-profil.md` §3) après entretien : la suppression
  **anonymise** le compte (nom et téléphone effacés de `partner_accounts`, email et mot de passe
  neutralisés côté connexion, l'ancien email redevenant utilisable) mais ne touche **jamais** les
  commandes déjà passées — elles portent leur propre copie de nom/email/téléphone, indépendante du
  compte, précisément pour que l'établissement garde de quoi honorer une réservation à venir même
  après suppression. Confirmation forte (l'email retapé), définitive, sans délai de grâce. Bloquée
  pour tout compte porteur d'une capacité professionnelle (référent, opérateur, admin), pour éviter
  d'en détruire un par erreur depuis l'écran client.
- ⚠️ **Modification partielle d'une réservation : retirée du premier périmètre** (2026-09-07).
  Cela renverse la décision du 2026-08-13 (« depuis son compte, un client peut modifier une
  réservation sans annuler l'ensemble »). Reste une **cible future**, portée au backlog ; le
  mécanisme voulu ne change pas quand elle reviendra — une ligne financière déjà créée n'est jamais
  recalculée sur place : un remplacement se fait par annulation puis création d'une nouvelle ligne,
  pour préserver les snapshots de prix/commission (§3b). La RPC `modify_order_line` existe déjà et
  reste utilisée côté socio/admin.
- **Annuler la réservation** signifie annuler **toute la commande** et toutes ses lignes
  (hébergements, activités, transports, camps et eventos). Une annulation côté client n'est
  **jamais remboursée** (§7/A3). *Inchangé.*
- **Attribution partenaire persistante** : sauvegardée durablement en base pour tout client
  **disposant d'une identité**, ce qui inclut depuis le 2026-09-07 l'invité muni d'une **session
  anonyme** (§3e) — et non plus seulement le titulaire d'un compte enregistré. Un invité peut réserver via un QR/lien attribué sans que ce
  rattachement devienne une préférence durable (§3c). *Inchangé.*
- **Voucher/e-ticket, recommandation toujours à confirmer** : l'écran de résultat adressable
  (§2b.9) en pose la fondation — le justificatif présentable sur place et sa forme (QR, PDF)
  restent à trancher.

*État d'implémentation, corrigé le 2026-09-07, complété le 2026-09-11 : Google OAuth et
l'inscription email/mot de passe avec vérification ont été construits le 2026-08-15 (feature 31) en
back-end générique. Côté `apps/web`, **`/entrar`, `/registro` et `/verificar-email` existent**
(feature 32) en email/mot de passe — et **l'entrée Google y a été ajoutée le 2026-09-11**
(`components/molecules/GoogleButton.tsx`, montée sur les deux premiers écrans). Le back-end
n'avait besoin de rien : provider activé, `/auth/callback` traitant déjà la branche `code`,
`additional_redirect_urls` déjà pourvues — seul l'écran manquait, et il n'était suivi nulle part.
Ce qui reste à construire sur la vitrine : **mot de passe oublié / réinitialisation**, qui n'existe
aujourd'hui que sur `apps/admin`. Spec : `docs/specs/07-connexion-inscription-complete.md`.*

### 2d. Condition d'annulation affichée avant réservation

Décidé le 2026-08-11, simplifié le 2026-08-12, **localisé le 2026-09-07** : la mention qu'une
annulation ou une absence n'est **jamais remboursée** (§7/A3) est affichée **sur l'écran de
paiement, avant que le client ne valide et paie** — et pas ailleurs. C'est une règle fixe et
universelle, pas une politique qui varie par produit ou par établissement. Un client ne doit
jamais découvrir ça après coup, en cas de litige.

### 2e. Parcours secondaires

- **Consultation sans engagement** : le client peut consulter le détail d'une activité, d'un camp
  ou d'un evento sans jamais entamer de réservation.
- **Fiche vitrine, non réservable en ligne** : certaines offres renvoient vers un contact direct
  plutôt que vers une réservation (§6). Le client doit pouvoir **distinguer les deux au premier
  regard** — forme arrêtée le 2026-09-07 : la fiche est identique aux autres, mais **le calendrier
  de réservation laisse la place à un bouton de contact**. La différence se voit à l'endroit exact
  où le client la cherche, sans bandeau ni texte explicatif.
  **Précision du 2026-09-07 : ce n'est pas réservé aux eventos** — un transport, une activité ou
  tout autre type peut être en vitrine. Et ce n'est **jamais** `sellable = false`, qui rend le
  produit totalement invisible au public : le mécanisme est celui déjà posé par la migration
  `20260814190000` — le produit reste **publié** (`sellable = true`) et porte
  **`external_booking_url`**, colonne volontairement générique (« plus jamais figé WhatsApp seul »),
  éventuellement avec `price_label` plutôt qu'un prix réel. Deux conséquences pour la mise en
  œuvre : le front doit brancher sur **la présence de `external_booking_url`** et non sur le type
  `evento` comme aujourd'hui ; et la contrainte `products_price_cop_required_unless_evento`
  n'exempte que les eventos, donc une vitrine d'un autre type devra porter un prix — à revoir si
  Jérôme veut une vitrine sans prix sur un transport.
- **Réservation refusée en cours de route** : si une place/nuit devient indisponible entre
  l'affichage et la validation, le client en est informé **explicitement** et ajuste lui-même sa
  sélection — jamais une réservation silencieusement dégradée ou partiellement honorée
  (invariant §3d). Écran correspondant : §2b.6.
- **Après la réservation, sans compte** : le client garde son **numéro de réservation**, l'**email
  de confirmation** (spec 23) et l'écran de résultat, réouvrable à son adresse (§2b.9). *Corrigé le
  2026-09-07 : ce paragraphe invoquait un contact WhatsApp « du pied de page, disponible sur tout le
  site » qui n'existe dans aucune route à ce jour, et que l'architecture de coquilles ne posera pas
  dans la zone tunnel.*
- **Après la réservation, avec compte** : la réservation apparaît dans l'historique, avec son
  contact WhatsApp dédié (§2c).

### 2f. Points encore à trancher

- **Recherche par localisation — différée, pas abandonnée** (tranché le 2026-09-07) : le rayon de
  20 km autour d'un point, validé le 2026-08-11, ne fait **pas partie du premier lot**. Le périmètre
  livré d'abord est tag, nom, type, établissement, personnes, dates. La cible « marketplace global »
  du §1 continue de s'y adosser, donc la fonction de recherche doit être conçue pour **accueillir le
  filtre géographique sans être réécrite** — les coordonnées existent déjà sur les produits comme
  sur les établissements.
- ~~Plafonds du panier (§3e)~~ — **retiré le 2026-09-10, trouvé périmé** : §3e (juste en dessous)
  avait déjà tranché ce point le 2026-09-07 même, en même temps que cette section était écrite —
  plafond **global**, valeurs relevées à 12/36/40/20. Le vrai point ouvert n'est pas la forme mais
  la valeur : jamais codée dans `create_order`, qui porte toujours 4/12/20 (`docs/specs/32-panier-en-base.md` §10).
- **Voucher/e-ticket** : forme du justificatif (QR, PDF, autre).
- **Disponibilité d'un hébergement adossé à un PMS dans une recherche datée** : décision différée
  le 2026-09-07 — il apparaît, sans garantie de disponibilité.
- **Rattachement d'une commande passée en invité à un compte créé après coup** : la règle est
  tranchée — **par adresse email** (§2b.9, 2026-09-07) — mais **le mécanisme n'existe pas** :
  RPC à écrire, périmètre à part entière. Ce n'est donc plus un arbitrage en attente, c'est du
  travail à chiffrer.
- **Source du contact d'un établissement** : la décision du 2026-09-07 est prise — le contact d'un
  établissement devient public — mais **la colonne à publier reste à trancher**. Vérification du
  2026-09-07 : le téléphone que le partenaire saisit lui-même vit dans `partner_accounts.phone`,
  pas dans `partners.phone`, et la migration `20260819100000` dit pourquoi — `partners` est
  *l'organisation*, partageable entre plusieurs comptes, « un écran de compte personnel ne doit
  jamais écraser ce que voit un collègue du même partenaire ». Publier `partners.phone` publierait
  donc une colonne que le partenaire ne remplit jamais. Trois issues à départager : publier
  `partner_accounts.phone` du compte propriétaire, ajouter un champ de contact public sur
  `establishments`, ou n'exposer que le canal Hifago. Dans tous les cas, exposition **étroite** —
  jamais la table d'identité entière, qui contient aussi des référents particuliers.

*Traçabilité : `docs/2-reference/04-app-reservar.md` § « Front (`reservar.js`) — structure »,
`docs/1-manuels/10-client.md` pour le portail actuel. Sections sans équivalent dans le code
actuel : accueil/recherche, pages de listing, suggestions, compte client, écran de résultat
adressable.*

---

## 3. Règles métier

### 3a. Catalogue et tarification produits

**Statut : ✅ validé par Jérôme le 2026-08-11, corrigé le 2026-08-13.**

Le catalogue (admin) est la **source unique** de prix, visibilité, réservabilité et ordre
d'affichage de tout ce qui est vendu sur le portail client. Le portail ne fait que projeter ce
catalogue — aucune logique de prix ou de règle métier propre au front.

**Ce que porte un produit vendable** : identifiant interne, prix (COP), `schedule` (`date` /
`slot` / `none` — gouverne si une date, ou une date + un créneau matin/après-midi, est requise
pour le réserver), unité de quantité (libellé affiché au stepper, ex. « Horas », « Cant. » —
🌐 texte libre, donc multilingue comme le reste du contenu de fiche, cf. §4/traçabilité modèle de
données), description, photos, prestataire propriétaire, **tags de catégorisation** et
**coordonnées géographiques** (les deux décidés en §2, complétés ici pour que cette définition
canonique reste à jour avec le reste du document).

**Tarification aujourd'hui** — deux patterns génériques d'hébergement, indépendants du nom de
l'établissement (Casa Kayam et Bania ne sont que les deux instances actuelles, pas des cas
spéciaux câblés en dur — un hôtel/hostel comme un autre pourra suivre l'un ou l'autre demain) :
- **Hôtel/hostel à chambres/dortoirs** : plusieurs types de couchage, chacun avec sa capacité et
  son unité de réservation (ex. 1 lit = 1 personne, 1 tente = 2 personnes). Prix par personne/unité
  — pas un prix par chambre entière. Optionnellement adossé à un PMS (cf. §5) pour la disponibilité
  et le prix ; sinon, disponibilité et prix viennent du catalogue interne.
- **Maison/logement entier** : prix par palier de nombre de personnes, majoré en haute saison,
  arrondi nuit par nuit puis sommé. **Aucune remise liée au code partenaire** n'est appliquée dans
  le périmètre actuel. Jamais adossé à un PMS.
- **Activité / transport** : prix unitaire fixe. Total de ligne = prix unitaire × quantité, sans
  palier ni dégressivité hors règle optionnelle ci-dessous.
- **Camp** : produit multi-jours avec prix/cupos/durée propres ; sa tarification reste distincte de
  l'evento et peut utiliser la remise quantité/personnes uniquement si ce mécanisme a un sens pour
  sa quantité vendue.
- **Evento** : fiche distincte ; s'il est rendu réservable en ligne, sa tarification suit sa propre
  configuration, sans jamais être confondue avec celle d'un camp.

**Gates de vente** (ce qui rend un produit effectivement réservable, indépendamment de son prix) :
un produit doit être marqué vendable ; un camp doit être publié ; un evento doit être publié
**et** explicitement marqué réservable en ligne. Ces gates sont vérifiés à la fois côté catalogue
(ce qui est montré au client) et côté serveur au moment de la réservation — un front périmé ne
peut jamais forcer la vente d'un produit retiré ou non publié.

**Fraîcheur du catalogue** : le catalogue vu par le client est mis en cache côté serveur (durée
courte) et **doit être invalidé immédiatement par toute écriture admin** — un changement de prix
ou de visibilité ne doit jamais rester visible avec l'ancienne valeur au-delà d'une fenêtre
courte et connue.

---

**Nouvelle règle décidée (2026-08-11)** — remise optionnelle par quantité/nombre de personnes,
sur une activité ou un autre produit (n'existe pas dans le système actuel : aujourd'hui le total
est toujours prix unitaire × quantité, sans palier, hors maison entière) :

- **Qui la configure** : l'admin **et** le prestataire propriétaire du produit — les deux
  peuvent la poser, comme pour le reste du catalogue.
- **Mécanisme** : un palier **librement défini par celui qui configure** — seuil de
  quantité/personnes ET pourcentage de remise associés sont tous les deux à sa main, pas des
  valeurs imposées par le système. Reste optionnel : un produit sans palier configuré garde son
  prix unitaire fixe.
- **Périmètre — décision 2026-08-13** : ce mécanisme s'applique **uniquement aux produits hors
  nuits** (activités, transport, camps et, s'il est réservable et pertinent, evento). Il ne
  s'applique **jamais** aux chambres, dortoirs ou logements entiers, qui conservent leurs mécanismes
  tarifaires propres.

### 3b. Moteur de commission (17/10/7) — priorité n°1

**Statut : ✅ validé par Jérôme le 2026-08-11.**

Chaque **ligne** de commande (une nuit, une prestation) porte son propre calcul de commission,
déterminé à la création de la commande et **jamais recalculé après coup** — même si les taux
changent plus tard, une commande déjà passée garde ses pourcentages d'origine (invariant : le
calcul est figé/snapshoté sur la ligne, pas recalculé dynamiquement à la lecture).

**Trois cas possibles pour une ligne**, selon qui a référé le client et qui touche la commission :

| Cas | Qui a référé | Acompte (part app à l'arrivée) | Commission référent | Part app |
|---|---|---|---|---|
| **Référent externe** | un partenaire différent du prestataire qui encaisse | 17 % (= 10+7) | 10 % | 7 % |
| **Auto-référence** | le prestataire s'est référé lui-même (même identité des deux côtés) | 7 % (= 0+7) | 0 % | 7 % |
| **Direct** | aucun référent attribué | 17 % (= 0+17) | 0 % | 17 % |

**Composition** : l'acompte est toujours la somme de deux briques — la part référent (**10 %**,
seulement s'il y a un référent externe) et la part app (**7 %** dès qu'il y a un référent
quelconque, référent externe ou auto-référence ; **17 %** s'il n'y a aucun référent, l'app
absorbant alors la part qui serait allée au référent). Il n'y a **aucun plancher** d'acompte —
ces pourcentages s'appliquent tels quels, sans minimum.
- Toute remise commerciale active en amont — dans le périmètre actuel, uniquement la remise
  optionnelle par quantité/personnes sur les **produits hors nuits** (§3a) — est incluse dans
  `total_cop` **avant** ce calcul : la commission se calcule toujours sur le montant net déjà
  remisé, jamais sur un prix plein théorique. L'ancien avantage client de 10 % lié au code
  partenaire est désactivé (§3c).
- Un **payeur inconnu** (le prestataire qui encaisse n'a pas d'identité liée dans le système)
  compte comme **différent** du référent → traité comme cas « référent externe », pas auto-référence.
- Ce moteur remplace un ancien calcul (acompte fixe 15 %, commission fixe 10 % si code valide)
  qui reste utilisé pour lire l'historique des commandes déjà passées sous l'ancien barème — une
  commande ancienne n'est jamais recalculée avec les nouveaux taux.

**Décision (2026-08-11) :** le cahier des charges — et donc la refonte — ne documente/implémente
que le barème cible **17/10/7**. L'ancien barème (15 % / 10 %) n'est pas repris comme règle
vivante ; l'historique des commandes déjà passées sous l'ancien calcul sera géré côté migration
de données (montants déjà calculés préservés tels quels), pas comme une formule à maintenir dans
le nouveau système.

*Traçabilité : `src/services/pricingService.js` (`priceLine()`), invariant R5 du registre interne.*

### 3c. Code partenaire / attribution référent (ancien « code promo »)

**Statut : ✅ corrigé et validé par Jérôme le 2026-08-13.** Cette décision remplace le système
précédent de code promo donnant une remise client, ainsi que la mémorisation multi-codes côté
navigateur.

**Rôle actuel** : le code est un **identifiant d'attribution partenaire**. Il rattache une commande
à un référent afin que le moteur 17/10/7 (§3b) puisse calculer les commissions. Le QR et le lien
attribué sont les moyens principaux de diffusion ; ils transportent ce code en arrière-plan. Le
code lui-même reste un mécanisme secondaire de la même chaîne d'attribution — il ne constitue plus
un avantage commercial pour le client.

**Aucune saisie dans l'interface client** : le champ « code promo » disparaît entièrement du
parcours public. Le client final ne voit pas de champ lui permettant d'entrer, vérifier ou choisir
un code. Un code invalide transporté par un lien/QR n'empêche jamais la réservation ; la commande
continue simplement sans référent attribué.

**Aucune remise active liée au code** : l'ancien comportement accordant 10 % de réduction sur
l'hébergement est **désactivé**. Dans le périmètre actuel, un code partenaire ne change jamais le
prix payé par le client et n'impose donc aucun discount au prestataire. La capacité technique
d'associer plus tard un avantage client à une attribution reste présente dans le code/modèle, mais
elle est **dormante et désactivée par défaut**, strictement découplée du calcul d'attribution.

**Résolution unique de l'attribution pour une commande** : lorsqu'un QR/lien/code partenaire valide
est présent dans le contexte de réservation, son référent est résolu une seule fois et appliqué à
toutes les lignes éligibles de la commande (nuits, activités, transport, camps, eventos). Le payeur
de la commission reste déterminé **par ligne** selon le prestataire propriétaire du produit (§3b).

**Persistance — décision 2026-08-13** :
- pour un **client invité**, l'attribution vaut pour la réservation en cours mais n'est pas
  sauvegardée comme préférence durable à partir de son WhatsApp/email ;
- pour un **client avec compte enregistré**, le dernier code partenaire valide rencontré peut être
  sauvegardé sur son compte et réutilisé lors d'une réservation ultérieure ;
- si ce client revient ensuite par un **nouveau** QR/lien/code valide, **le dernier code présenté
  prime** pour la nouvelle réservation et remplace l'attribution partenaire précédemment mémorisée ;
- il n'existe plus de liste multi-codes à présenter au client ni de choix manuel entre plusieurs
  codes mémorisés.

**Traçabilité** : chaque commande conserve le code/référent effectivement utilisé au moment de sa
création, même si le compte client reçoit plus tard un autre code. Une commande passée n'est jamais
réattribuée rétroactivement.

*Traçabilité état actuel : `src/services/orderService.js`, `src/services/portalService.js` et
`src/services/pricingService.js` contiennent encore l'ancien vocabulaire/chemin de remise ; la
refonte doit conserver l'attribution et désactiver la réduction client sans supprimer la capacité
future.*

### 3d. Disponibilité, cupos, calendrier

**Statut : ✅ validé par Jérôme le 2026-08-11, corrigé le 2026-08-13.**

**Disponibilité des nuits** — dépend du pattern d'hébergement (cf. §3a) :
- hôtel/hostel PMS-backed : la disponibilité vient d'une lecture **fraîche** du PMS à chaque
  vérification (jamais mise en cache au moment de réserver) ;
- hôtel/hostel ou logement entier non PMS-backed : la disponibilité vient d'un **calendrier
  interne**, tenu par le prestataire lui-même. **Révisé le 2026-09-13 (décision Jérôme,
  `docs/journal/2026-09.md`)** : **ouvert par défaut** dès la création (fenêtre glissante de 6 mois,
  `products.default_capacity` amorce `product_availability`, cf. `docs/05-reference-technique.md`
  si besoin du détail technique) — c'est désormais le prestataire qui vient **fermer** les jours
  déjà pris (hors du système), l'inverse de la polarité d'origine (validée le 2026-08-11, corrigée
  le 2026-08-13). Un logement rattaché à un PMS reste géré exclusivement par ce PMS, jamais par ce
  mécanisme.

**Disponibilité des prestations** (activités, transport, camps, eventos) — calendrier interne
par produit, avec deux niveaux de fermeture :
- une **date entière** peut être fermée par l'admin/prestataire, ou pleine (plus de places) ;
- pour un produit à **créneaux** (matin/après-midi), la capacité s'entend **par créneau** — une
  date n'est fermée que si ses **deux** créneaux sont pleins ou fermés. Un produit à **journée
  entière** ne peut pas être réservé sur une demi-journée fermée : une demi-journée fermée ferme
  toute la date pour ce type de produit.
- pour un **camp** et pour tout **evento rendu réservable en ligne**, l'absence d'ouverture
  explicite vaut **fermé**. Camps et eventos restent néanmoins deux parcours/fiches distincts.
- **Décision 2026-08-13 — calendrier partagé du prestataire / anti-double-booking** : un camp (et
  un evento réservable) est relié à la **ressource de disponibilité du prestataire qui l'organise**,
  partagée avec les autres activités qui consomment le même temps de travail/ressource. Un camp de
  N jours n'est proposé à une date de départ que si **toute sa période** est disponible. Exemple :
  si UFit a ouvert ses dates du 1 au 6 et que le camp dure 5 jours, le départ du 1 est réservable
  dès lors que les 5 jours nécessaires sont libres.
- **Blocage automatique à la première réservation** : quand une réservation de camp ou d'evento est
  confirmée, toute la période consommée est bloquée **atomiquement** sur la ressource partagée ;
  les autres activités liées deviennent immédiatement indisponibles sur ces dates. Ce blocage ne
  dépend d'aucune confirmation humaine postérieure : c'est le garde-fou contre le double booking.
  Le prestataire reçoit ensuite une notification indiquant le camp ou l'evento réservé, la période
  bloquée et les autres offres rendues indisponibles.
- la fenêtre de consultation du calendrier est **bornée dans le temps** (aujourd'hui 180 jours) —
  pas de réservation à horizon illimité.

**Invariant anti-survente (à ne jamais casser dans la refonte)** : l'affichage du calendrier peut
s'appuyer sur un cache court pour la fluidité, mais la validation finale au moment de la
réservation **relit toujours l'état frais** et est vérifiée **dans la même opération atomique**
qui crée la commande — deux clients ne peuvent jamais obtenir la même place/nuit, même si
l'interface affichée était périmée. Le refus (place déjà prise) est un échec dur de la
réservation, jamais une survente silencieuse.

**Comportement de panne** : si le service de calendrier/disponibilité est indisponible, le
système **bloque** la réservation concernée plutôt que de la laisser passer sans vérification
(échec fermé — on préfère refuser une réservation valide par excès de prudence que risquer une
survente).

*Traçabilité : `src/services/inventoryService.js` (`isPerSlot`, `assertCanReserve`,
`assertCanReserveStay`), `src/controllers/portalController.js` (`/service-calendar`,
`/availability`, `/stay-availability`, `/stay-calendar`).*

### 3e. Règles de panier

**Statut : ✅ validé par Jérôme le 2026-09-07** — section réécrite le même jour.
Validée une première fois le 2026-08-11 ; rouverte par la réécriture du §2 (persistance du panier),
puis corrigée sur trois points périmés — plafonds dimensionnés pour un seul établissement, créneau
binaire matin/après-midi, et la promesse que les nuits resteraient réservables si le catalogue
tombait. Le reste de la section est inchangé.

**Composition d'une commande** — une commande peut combiner librement, dans un seul panier :
- des **nuits en dortoir/chambre**, dans un ou plusieurs hôtels/hostels (plusieurs lignes
  possibles, bornées en nombre et en quantité totale — cf. « Plafonds » ci-dessous) ;
- une ou plusieurs **maisons/logements entiers** ;
- des **prestations** (activités, transport, camps, eventos), bornées elles aussi sur **deux**
  dimensions, pas une seule — nombre de lignes **et** quantité par ligne (cf. « Plafonds ») ;
- une commande **sans aucune nuit** (prestations seules) est valide.

**Nouvelle règle décidée (2026-08-11)** : une commande doit pouvoir combiner des nuits dans
**plusieurs hébergements différents** — plusieurs hôtels/hostels et/ou plusieurs maisons entières
en même temps, pas un seul établissement à la fois. Ça généralise la restriction actuelle du
système (aujourd'hui : un seul hébergement à chambres OU une seule maison entière par commande,
jamais plusieurs établissements combinés).

**Plafonds — tranché le 2026-09-07, remplace le point laissé ouvert le 2026-08-11.**

Ce ne sont **pas des règles métier** : personne ne réserve légitimement deux cents lignes. Ce sont
des garde-fous techniques, et c'est ce qui fixe leur niveau. Trois raisons, dans l'ordre :

1. **Une commande immobilise des places, et n'importe qui peut en créer une.** Réserver n'exige pas
   de compte : un visiteur anonyme appelle `create_order`, qui décrémente la disponibilité de chaque
   ligne. Sans plafond, une commande scriptée bloque l'inventaire sans jamais payer. Le plafond
   borne le pire cas ; la limite de débit par IP le complète.
2. **C'est une seule transaction, avec un verrou par ligne** (`SELECT … FOR UPDATE`, §3d). Une
   commande de plusieurs centaines de lignes tient autant de verrous pendant qu'elle s'exécute : les
   autres clients attendent, et le risque d'interblocage monte.
3. **Un défaut d'interface reste borné** — un compteur qui s'emballe ne devient jamais un défaut de
   données.

**Forme retenue : un plafond GLOBAL sur toute la commande**, pas un plafond répété par
établissement — une seule règle à tenir et à tester, et elle protège tout aussi bien. Les valeurs
sont **relevées**, parce que les précédentes avaient été posées quand une commande ne pouvait
toucher qu'un seul établissement :

| Borne | Avant (un seul établissement) | Retenu le 2026-09-07 |
|---|---|---|
| Lignes de nuits par commande | 4 | **12** |
| Unités de nuits par commande | 12 | **36** |
| Lignes de prestations par commande | 20 | **40** |
| Quantité par ligne de prestation | 20 | **20** (inchangé — autre garde-fou) |

⚠️ **Ces bornes sont codées en dur dans `create_order`** (`v_lodging_lines > 4 or v_lodging_units >
12`, `v_prestation_lines > 20`) : les changer demande une **migration**, pas seulement une mise à
jour de ce texte.

**Persistance — révisé le 2026-09-07 (§2b.6), renverse le 2026-08-11.** Le panier **survit** à un
rechargement et à la fermeture de l'onglet ; il peut donc porter des lignes vieilles de plusieurs
jours.

**Où il vit — décidé le 2026-09-07 : en base, rattaché à l'identité du visiteur** (anonyme ou
réelle, cf. l'attribution ci-dessous), et non dans le navigateur. Quatre conséquences voulues :
il persiste réellement ; il **suit l'appareil** (commencé sur téléphone, terminé sur ordinateur) ;
le **serveur peut le lire**, ce qui rend faisable le réordonnancement des sections de l'accueil
(§2b.5) sans code client ; et la conversion d'un invité en client enregistré **garde son panier**
sans rien migrer, puisque l'identifiant ne change pas. Prix payé, assumé : une table et ses
policies, et un aller-retour réseau à chaque ajout au lieu d'un simple état React.
⚠️ **Le modèle de la ligne de panier reste à concevoir** : la structure actuelle
(`apps/web/lib/cart/CartContext.tsx`) ne porte ni le **type** de l'offre — ce qui rend le
réordonnancement littéralement inécrivable — ni son **slug**, ni son établissement, ni sa photo.
Spec dédiée, qui vient **après** celle de l'identité anonyme dont elle dépend. Il n'est **jamais** un stock réservé : rien n'est immobilisé tant que la commande n'est pas
créée (§3d). La disponibilité est **revérifiée à la reprise**, et une ligne devenue indisponible est
signalée en place avec le moyen de la retirer — jamais de retrait automatique. Le prix, lui, ne
bouge pas ; et de toute façon `create_order` calcule tous les montants côté serveur, le navigateur
n'en envoyant aucun : un panier ancien ne peut pas faire payer un ancien prix.
*(L'ancienne rédaction disait « non persisté au-delà de la session en cours — sauf demande
contraire » ; la demande contraire est arrivée.)*

**L'attribution d'un invité survit elle aussi — décidé le 2026-09-07, et par un moyen qui change
l'architecture.** Le problème est né du panier persistant : le cookie d'attribution d'un invité est
volontairement perdu à la fermeture de l'onglet, si bien qu'un invité revenant le lendemain
retrouvait son panier **sans** son attribution — et la commission de son référent avec.

La réponse retenue n'est pas d'allonger la durée du cookie, mais de **donner une identité à
l'invité** : une **session anonyme Supabase**, ouverte **au premier geste engageant** — un ajout au
panier, ou une arrivée par un lien attribué (`?ref=`). Un visiteur qui ne fait que regarder n'en
reçoit aucune : robots, crawlers et curieux ne créent rien. L'attribution vit alors **en base**,
comme celle d'un compte enregistré, et non plus dans un cookie.

Deux conséquences heureuses, hors du problème posé : la commande d'un invité devient **lisible par
son propre auteur** (`orders_select` cesse de l'exclure — sur le même navigateur ; un lien ouvert
depuis un email sur un autre appareil réclame toujours le code secret de §2b.9) ; et le
**rattachement à un compte cesse d'être un rattachement** — Supabase convertit l'identité anonyme
en identité réelle en lui liant un email **sans changer son identifiant**, donc les commandes
suivent d'elles-mêmes, sans RPC de rapprochement et sans le risque du « qui crée un compte avec cet
email récupère ces commandes ».

⚠️ **Ampleur mesurée le 2026-09-07, à traiter dans une spec dédiée** : 79 fichiers de migration
accordent des droits à `authenticated`, 67 policies existent, et **`is_anonymous` n'apparaît nulle
part** dans le projet. Aujourd'hui `authenticated` signifie « une personne réelle ayant vérifié son
email » ; demain il signifiera aussi « n'importe quel visiteur ». Chaque droit et chaque policy doit
être relu avant, pas après. Le trigger `handle_new_auth_user` crée par ailleurs une ligne
`partner_accounts` à chaque nouvel utilisateur — à revoir pour ne pas remplir la table d'identité de
visiteurs.

**Ce qu'exige une ligne de prestation** — *corrigé le 2026-09-07* :
- **produit à créneaux** (`product_slot_rules`) : une date **et** une heure de début de créneau ;
- **produit à date** : une date, sans créneau ;
- **produit sans date** : aucune date requise.

*L'ancienne rédaction parlait de `schedule='slot'` et d'« un créneau (matin/après-midi) » : c'est le
mécanisme binaire du portail legacy, mort depuis la spec 18. `product_slot_rules` produit autant de
créneaux que la règle en définit, et `create_order` verrouille par `(product_id, slot_date,
slot_start_time)`. Écart déjà signalé dans l'en-tête « Écarts connus », corrigé ici puisque la
section était rouverte.*

> **Révisé le 2026-08-17** (décision Jérôme, cf. `hifago/docs/specs/17-calendrier-disponibilite-refonte.md`) :
> l'email passe d'optionnel à **requis**, au même titre que le nom et le WhatsApp — un client a
> désormais obligatoirement au moins une adresse email valide, qu'il réserve en invité ou depuis un
> compte. Aucun des deux champs déjà requis n'est retiré : l'email s'ajoute au WhatsApp, il ne le
> remplace pas.

**Informations du client, requises pour valider le panier** :
- nom : requis ;
- WhatsApp : **requis**, normalisé (un numéro colombien local est complété avec l'indicatif
  pays automatiquement) ;
- email : **requis**, doit être valide ;
- document d'identité, commentaire : optionnels, texte assaini (longueur bornée, caractères de
  contrôle retirés) ;
- **case de consentement marketing (Habeas Data), ajoutée le 2026-08-12** : une case explicite au
  moment de la réservation, distincte de l'acceptation des CGV — c'est elle qui donne une preuve
  vérifiable à l'obligation que l'admin s'impose avant tout envoi commercial groupé touchant des
  clients (admin §3f). Sans elle, ce rappel légal n'a aucune donnée à vérifier derrière.

**Robustesse** : si le catalogue est indisponible au moment de composer le panier, aucune liste
fictive n'est proposée — l'ajout et la validation sont bloqués. *Corrigé le 2026-09-07 : la phrase
disait « mais les nuits restent réservables indépendamment (elles ne dépendent pas du même
service) ». C'était vrai du portail legacy, où les prestations venaient de SQLite et les nuits de
LobbyPMS. Ça ne l'est plus : depuis la spec 24, **une chambre est un produit du catalogue** comme
une activité, avec son `product_availability`. Si le catalogue tombe, plus rien n'est réservable —
et c'est cohérent avec la règle d'échec fermé (§3d).*

*Traçabilité : `src/services/portalService.js` (`reserve()`, validation/bornage synchrone en
tête de fonction).*

### 3f. Cycle de vie de la commande

**Statut : ✅ validé par Jérôme le 2026-08-11** (décisions confiées à Claude selon les pratiques
usuelles d'une app de réservation, cf. décisions ci-dessous).

**Ce qui existe aujourd'hui** (vérifié dans le code, pas seulement dans la doc) :

- Une commande est créée **confirmée** immédiatement (paiement à l'arrivée, pas de statut
  intermédiaire « en attente » réellement utilisé). Chaque ligne démarre **active**
  (« réservée »).
- Une ligne active évolue ensuite vers un état terminal : **réalisée** (prestation/nuit
  effectivement consommée), **absence** (`no_show`), **annulée par le client**, **annulée par le
  prestataire**, ou **expirée**.
- **Correction (2026-08-12, vérifiée dans le code — la version précédente était fausse)** :
  dans le registre qui porte réellement le moteur de commission 17/10/7 (les lignes de commande,
  §3b), **cette transition vers un état terminal ne se produit jamais automatiquement, PMS-backed
  ou pas** — elle exige toujours une action manuelle admin (une seule fonction y fait avancer une
  ligne, appelée uniquement depuis l'écran admin, jamais depuis l'import PMS). L'import périodique
  du PMS ne touche pas ce registre : il alimente un **miroir historique séparé** (l'ancien calcul
  de commission, à 15 %, cf. §3b) avec son propre cycle réalisée/annulée/expirée sur cette base
  précise. Autrement dit : **le contraste « PMS = automatique / sans PMS = manuel » n'existe pas
  aujourd'hui pour le moteur cible** — c'est manuel dans les deux cas. Ce constat renforce, plutôt
  qu'il n'affaiblit, la décision cible n°1 ci-dessous : le besoin d'un cycle réellement automatisé
  ne se limite pas aux commandes sans PMS, il concerne toute commande.
- Si une nuit/activité censée être reflétée dans le PMS ne l'est pas (échec technique), la
  commande passe dans un état d'**exception** dédié et une entrée est ouverte dans une file de
  réconciliation, plutôt que d'échouer purement et simplement — le client garde sa réservation,
  mais elle nécessite un contrôle manuel.

**Décisions cibles (2026-08-11)** — Jérôme a demandé de trancher ces 4 points selon ce qui se
pratique usuellement dans une app de réservation, plutôt que de reproduire l'état actuel :

1. **Cycle de vie unique, indépendant du PMS** (résout le point 3 du constat) : dans la cible,
   toute commande — avec ou sans nuit adossée à un PMS — suit **le même** cycle métier :
   réservée → réalisée / absence / annulée (client ou prestataire) / expirée. La synchronisation
   avec un PMS externe devient un **statut séparé et secondaire** par ligne (« à synchroniser » /
   « synchronisée » / « échec de synchronisation »), qui n'empêche jamais la commande de vivre son
   cycle métier normal — c'est la séparation standard entre l'état métier d'une réservation et
   l'état d'intégration avec un système externe.
2. **File de réconciliation avec un vrai flux de sortie** (résout le point 1) : une entrée
   d'échec de synchronisation passe par des états explicites — ouverte → en re-tentative
   automatique (quelques essais espacés) → **résolue manuellement** (avec une note, par un admin)
   ou **signalée en échec permanent** si les re-tentatives échouent toutes. Un écran admin liste
   les entrées ouvertes et permet de les clore explicitement — fini l'intervention en base pour
   sortir une commande de l'état d'exception.
3. **Expiration sur tâche planifiée, pas sur un import** (résout le point 2) : le passage à
   « expirée » d'une réservation jamais confirmée après sa date + délai de grâce tourne sur une
   tâche planifiée récurrente (ex. une fois par jour), indépendante de toute action admin — une
   commande expire au bon moment même si personne ne déclenche d'import ce jour-là.
4. **Statuts minimaux, ajoutés seulement quand un vrai chemin de code les atteint** (résout le
   point 4) : la cible ne définit que les statuts effectivement produits par un flux réel
   (réservée / réalisée / absence / annulée / expirée, + les statuts d'intégration PMS ci-dessus).
   Des statuts de paiement (en attente / payé) ne seront introduits que lorsque le paiement en
   ligne (§ paiement, cf. cadrage général) sera réellement implémenté — pas avant, pour éviter un
   schéma qui affiche des états qu'aucun code ne produit jamais.

*Traçabilité : `src/services/orderService.js` (`LINE_TRANSITIONS`, `transitionLine` — seule
fonction qui fait avancer une ligne, appelée uniquement depuis `ordersController.js`, jamais
depuis l'import PMS ; `markMirrorFailed`), `src/services/storageService.js` (`expireStale`,
`upsertFromPortal` — le miroir historique séparé), `src/services/commission.js` (`deriveStatus`),
`src/services/ledgerService.js` (`openException`, `onLineTransition`), `src/controllers/lobbyController.js`
(`importFromLobby` — n'écrit que le miroir historique, jamais `order_lines`).*

## 4. Entités de données touchées

**Statut : ✅ validé par Jérôme le 2026-08-11.**

Le portail client ne touche qu'une partie du modèle de données global. Voici uniquement ce qu'il
**lit** ou **écrit** — le reste (comptes socios, CRM, campagnes de messages...) est hors
périmètre de ce document, propre à `/partner` et `/admin`. Voir `hifago/docs/00-modele-de-donnees.md`
pour l'audit champ par champ des entités partagées (établissement, chambre, produit) — notamment
le **gap critique** : aucun mécanisme de prix/disponibilité pour un établissement à chambres
multiples sans PMS, alors que la recherche/le catalogue (§2/§3a) doivent traiter tout
établissement de façon générique, PMS ou non.

**Lu par le portail (jamais écrit)** :
- **Catalogue** : produits vendables (prix, `schedule`, unité de quantité, capacité, prestataire
  propriétaire), calendrier d'ouverture/fermeture par date (et par créneau si applicable),
  **tags de catégorisation** (saisis par le prestataire/gérant ou l'admin — cf. §2, remplacent la
  liste fixe actuelle de 6 familles), ordre d'affichage, photos.
- **Propriétés/hébergements** : présentation (nom, photos, cadrage), grille tarifaire d'un
  logement entier, ordre d'affichage des cartes.
- **Camps** et **eventos** : deux familles distinctes, avec leurs propres fiches/gates ; pour les
  offres réservables, lecture de la ressource de disponibilité partagée du prestataire et des
  blocages multi-jours.
- **Codes partenaires / attribution** — uniquement le nécessaire pour résoudre le référent : code
  actif, identité référente correspondante et éventuel lien avec le compte client enregistré.
  **Aucun taux de remise client n'est lu dans le périmètre actuel** ; la capacité d'incentive futur
  reste dormante (§3c).
- **Coordonnées géographiques** des fiches (hébergement et prestation) — nouveau, requis par la
  recherche par localisation/rayon décidée en §2.

**Lu ET écrit par le portail (nouveau, compte client — §2)** :
- **Compte utilisateur** (base unifiée client/socio/admin, cf. cahier des charges socio §1) :
  identifiants de connexion, rôle(s) actif(s) sur cette identité, informations de profil, et le
  lien vers les commandes passées par ce compte (historique).

**Écrit par le portail** :
- **Commande** : une commande et ses lignes, avec pour chaque ligne les snapshots figés de prix
  et de commission (§3b), la date/le créneau retenus (§3d), et — désormais séparé du statut
  métier de la ligne (décision §3f) — un **statut d'intégration PMS** propre à la ligne quand
  l'hébergement/l'activité concerné est PMS-backed. **Simplifié le 2026-08-12** : la règle
  d'annulation étant désormais fixe et universelle (§7/A3 — jamais de reversement côté client,
  quel que soit le produit/établissement), aucun snapshot de politique n'est nécessaire par
  ligne ; seule la **qui a annulé** (client ou prestataire) compte, déjà portée par le statut
  métier de la ligne lui-même.
- **File de réconciliation** : une entrée quand une synchronisation PMS attendue échoue (§3f),
  rattachée à la commande concernée.
- **Attribution partenaire/marketing** : le code partenaire effectivement résolu et la source
  (QR, lien attribué, autre contexte technique) sont snapshotés avec la commande. Pour un compte
  client enregistré, le dernier code valide peut en plus devenir l'attribution persistante active
  du compte (§3c).
- **Consentement Habeas Data** : la case cochée (ou non) à la réservation (§3e), horodatée —
  ajouté le 2026-08-12.
- **Modifications post-création — décision 2026-08-13** : une **modification** agit sur une ou
  plusieurs lignes choisies (ajout, annulation d'une activité précise, remplacement d'une ligne),
  tandis que **l'annulation de la réservation** annule la commande entière et toutes ses lignes.
  Une ligne remplacée conserve son historique financier ; la nouvelle ligne reçoit ses propres
  snapshots.

**Écarté du périmètre client, propre à `/partner`/`/admin`** : comptes et authentification
partenaire, capacités referrer/operator, contrats, propositions de fiches, CRM, conversations,
campagnes de messages, fiches de suivi prestataires.

**Point à challenger (repéré en lisant le modèle actuel)** : aujourd'hui, le miroir PMS d'une
activité (l'attacher au booking de nuit) ne fonctionne que pour un seul prestataire nommé en dur
dans le code, même si d'autres prestataires ont le connecteur PMS activé sur leur fiche — un
reliquat direct de l'époque où Casa Kayam était le seul établissement. Puisqu'on généralise à
plusieurs hôtels/hostels (cf. §1, §3a), cette limitation doit tomber : *tout* prestataire avec le
connecteur PMS activé doit pouvoir voir ses activités attachées à un booking, pas seulement un nom
particulier. Détaillé en §5.

*Traçabilité : `docs/2-reference/05-data-model.md` (modèle complet), en particulier les tables
`products`, `product_calendar`, `orders`, `order_lines`, `exceptions_queue`, `partner_codes`,
`providers.lobby_connector`.*

## 5. Intégration LobbyPMS

**Statut : ✅ validé par Jérôme le 2026-08-11.**

**Rôle** : un connecteur PMS est **optionnel, activable par propriété** (cf. §1/§3a) — pas une
dépendance globale du portail. Une propriété qui l'active délègue à son PMS externe la
disponibilité et le prix des nuits, et la création du booking ; une propriété qui ne l'active pas
gère tout ça dans le catalogue/calendrier interne. Dans la cible, ce rôle doit être pensé comme un
**contrat générique** (disponibilité+prix par nuit, création de booking, rattachement d'une
prestation à un booking, lecture d'occupation) — LobbyPMS en est la première implémentation, pas
la seule possible : une autre propriété pourra demain brancher un PMS différent sur le même
contrat, sans toucher au reste du portail.

**Ce que fait LobbyPMS aujourd'hui pour une propriété qui l'active** :
- disponibilité et prix des nuits, relus **à chaud** à chaque étape qui compte réellement (jamais
  depuis un cache au moment de valider la réservation — un cache court n'est acceptable que pour
  l'affichage, cf. §3d) ;
- création du booking de nuit au moment de la réservation ;
- rattachement (« miroir ») d'une activité vendue dans la même commande, quand cette activité
  appartient à un prestataire dont le connecteur PMS est actif — voir généralisation ci-dessous ;
- lecture d'occupation côté back-office (hors périmètre client).

**Généralisation nécessaire (2026-08-11)** — deux limitations actuelles à lever dans la cible :
1. **Le rattachement d'activité à un booking ne fonctionne aujourd'hui que pour un seul
   prestataire nommé en dur dans le code**, même si d'autres prestataires ont leur connecteur PMS
   activé. Dans la cible, la règle doit être générique : *toute* activité d'un prestataire dont le
   connecteur est actif se rattache au booking de nuit de **sa propre propriété**, dès qu'un tel
   booking existe dans la commande et que le mapping produit↔PMS est renseigné — plus aucun nom
   de prestataire en dur.
2. **Une commande peut désormais contenir des nuits dans plusieurs propriétés** (décision §3e),
   dont certaines PMS-backed et d'autres non. La chaîne d'écriture doit donc traiter **chaque
   propriété PMS-backed indépendamment** — sa propre disponibilité, son propre booking, ses
   propres activités rattachées — plutôt que de supposer un unique « booking principal » pour
   toute la commande.

**Gestion d'échec** : si une nuit ou une activité censée être reflétée dans un PMS ne l'est pas
(panne technique), on suit la règle générale du §3f (statut d'intégration séparé du statut
métier, file de réconciliation avec sortie explicite) — jamais un blocage de la réservation
elle-même.

**Limites connues du connecteur LobbyPMS aujourd'hui** (vérifiées dans l'API elle-même, pas
seulement dans notre usage) — à conserver ou à absorber dans le contrat générique plutôt qu'à
laisser fuiter dans le reste du portail :
- **Groupes** : Lobby a bien une notion de booking lié à un groupe côté modèle de données, mais
  les bookings qu'on crée via l'API n'exploitent pas ce lien — le rattachement de plusieurs
  bookings d'une même commande se fait aujourd'hui par les informations du client (nom,
  WhatsApp), pas par un identifiant commun exposé par Lobby.
- **Prix** : le tarif d'une nuit est **un prix fixe pour l'ensemble de l'unité réservée**, jamais
  multiplié par le nombre de personnes par Lobby lui-même — la quantité doit être encodée dans le
  prix envoyé, pas dans un champ « nombre de personnes » séparé.
- **Remises** : Lobby a son propre mécanisme de remise, mais on ne l'utilise pas — la remise
  (§3c) est calculée et injectée par l'app directement dans le prix net envoyé. Choix à
  **conserver dans la cible** : garder la maîtrise du calcul de remise côté app, le PMS ne servant
  qu'à l'inventaire et à l'enregistrement du booking, jamais au calcul du prix.
- **Pas de webhook** : uniquement de l'import périodique déclaré manuellement (§3f) — aucune
  notification en temps réel des changements côté PMS (annulation, modification faite par le
  staff de l'hébergement directement dans son logiciel PMS).
- **Comportements à gérer avec robustesse, pas à supposer fiables** : certaines catégories de
  chambres du PMS ne sont pas réservables via l'API (erreur explicite à anticiper, pas un cas
  limite rare) ; annuler un booking par API ne fonctionne que s'il a été créé par API et si aucune
  prestation n'y a encore été ajoutée ; un changement de chambre fait par le staff PMS peut créer
  un nouveau booking **sans référence à l'ancien**, cassant le suivi si on ne s'en protège pas ; la
  forme réelle de la réponse à la création d'un booking peut différer de ce que documente le PMS —
  parser défensivement, ne jamais supposer un format garanti.
- Les identifiants internes (`products.id`) sont ce que le front envoie ; les identifiants propres
  au PMS ne sortent jamais de la couche connecteur — **objectif pour la cible, pas encore acquis
  aujourd'hui pour toute entité (corrigé le 2026-08-12)** : pour une activité classique c'est déjà
  le cas, mais pour un type de chambre d'un établissement PMS-backed, l'identifiant utilisé
  aujourd'hui **est directement** l'identifiant de catégorie côté PMS (cf.
  `hifago/docs/00-modele-de-donnees.md` §2 — « identifiant interne indépendant du PMS » listé comme
  gap à construire). À traiter comme un invariant à **construire** pour ce cas précis, pas à
  préserver — corollaire direct du gap critique établissement-sans-PMS (§4/modèle de données).

**Décision (2026-08-11)** : oui, dans la mesure du possible — la synchronisation PMS suit la même
logique que l'expiration (§3f) : un **poll régulier automatique** (tâche planifiée), pas une
dépendance à un import déclenché à la main, pour détecter le plus tôt possible une annulation ou
une modification faite côté PMS. L'import manuel reste possible en complément, mais ne doit plus
être la seule voie.

**Limites du calendrier interne, pour une propriété SANS PMS** (vérifiées, pas supposées) :
- La protection anti-survente du calendrier interne (§3d, fermé par défaut) est **manuelle et
  déclarative** : elle protège contre une survente **à l'intérieur du portail**, mais rien ne
  synchronise avec un canal de vente externe (Booking.com, Airbnb, autre) — si un prestataire
  vend aussi ailleurs et ne referme pas sa date sur le portail, aucun garde-fou ne l'empêche.
  Aucune synchronisation externe (type iCal) n'existe aujourd'hui.
- Pas de séjour minimum, pas de délai de préavis minimum, pas de tarif différencié semaine/week-end.
- Le dépôt affiché pour un logement entier n'est **qu'informatif** — jamais encaissé en ligne
  (cohérent avec l'absence de paiement en ligne, cf. cadrage général).
- Pas de facturation ni de gestion tarifaire dynamique par la demande (« yield management ») —
  absent, pas juste non documenté.

**⚠️ Décision (2026-08-11) — noté pour plus tard, ne pas perdre de vue** : le risque de survente
inter-canaux (un prestataire vend aussi sur Booking.com/Airbnb sans refermer sa date ici) devient
réel dès qu'on ouvre à plusieurs hôtels/maisons indépendants (§1, §3a). **Pas à implémenter dans
ce premier périmètre**, mais une synchronisation externe basique (au minimum iCal) pour les
propriétés sans PMS est une **cible future importante**, à ne pas oublier lors du chiffrage des
phases suivantes. Repris dans `hifago/README.md` pour rester visible au niveau du chantier entier,
pas seulement de ce document.

*Traçabilité : `docs/2-reference/04-app-reservar.md` § « `POST /reserve` », `docs/3-integrations/lobby_pms_api.md`,
`docs/3-integrations/lobby_pms_implementation.md`, `src/services/catalogService.js` (`isPmsBacked`),
`docs/2-reference/05-data-model.md` (`products.lobby_category_id`, `products.lobby_product_id`,
`providers.lobby_connector`), `docs/2-reference/08-known-gaps.md` (A4, A11-A13, Q5).*

## 6. Cas limites

**Statut : ✅ validé par Jérôme le 2026-08-11.**

- **Une commande doit contenir au moins une nuit OU une prestation** — jamais une commande vide.
- **Recherche géographique sans résultat dans le rayon, ajouté 2026-08-12** : la cible étant un
  marketplace qui s'étend ville par ville, c'est le cas normal pour toute nouvelle localisation
  avant qu'elle ait une masse critique d'offres — pas un cas rare à ignorer. **Recommandation** :
  élargir automatiquement la recherche au-delà du rayon choisi et l'afficher explicitement
  (« aucun résultat à 20 km, voici les plus proches à X km ») plutôt qu'un état vide sec — jamais
  laisser un visiteur sans aucune piste.
- **Arrondi cohérent front/back** : pour un logement entier, chaque nuit est arrondie
  séparément puis les nuits sont sommées — jamais un arrondi sur le total. Le front doit
  reproduire exactement la même règle, sinon le total affiché au client et le total facturé
  divergeraient d'un ou deux pesos.
- **Plafond de sélection d'un type de chambre** = le plus petit des deux : la capacité maximale du
  type de chambre, et la disponibilité réelle aux dates choisies. Le client ne peut jamais viser
  un plafond théorique qui dépasse la disponibilité réelle.
- **Vitrines non réservables en ligne** : certaines fiches du catalogue peuvent rester des
  vitrines (photo, description, CTA WhatsApp) sans être réservables en ligne — tant qu'aucun
  produit interne vendable ne les remplace. Un client voit la fiche mais est renvoyé vers WhatsApp
  pour réserver. Pattern à conserver dans la cible : toute fiche n'a pas vocation à être
  réservable en ligne dès le premier jour.

**Décision (2026-08-11) — tarification d'un produit PMS-backed** : le prix d'un lit/unité vient
**tel quel du PMS**, sans logique de réduction/ajustement selon le nombre de personnes ajoutée
par l'app — le PMS est autoritaire sur son propre prix par unité. Pas de règle supplémentaire à
construire côté app : on ne fait pas de tarification par tranche de personnes pour un produit
PMS-backed, on relaie le prix PMS.

**Décision (2026-08-11) — activité seule adossée à un PMS, sans nuit** : recommandation
appliquée — détecter ce cas en amont (aucune nuit, dans **la propriété du prestataire concerné**,
cf. généralisation multi-propriétés §5) et traiter la commande comme **complète sans intégration
PMS nécessaire**, sans ouvrir d'entrée de réconciliation qui ne correspond à aucune action
possible. Point sensible (argent réel en jeu) : la détection doit être scrupuleusement exacte —
elle ne doit jamais faussement conclure « pas de nuit » quand une nuit existe ailleurs dans une
commande multi-établissements, sous peine de perdre une vraie synchronisation PMS nécessaire.

*Traçabilité : `docs/2-reference/04-app-reservar.md` (barème dorms, arrondi maison entière,
tours statiques), `docs/2-reference/05-data-model.md` (`experiences.online_bookable`).*

## 7. Lacunes connues, challengées une à une

**Statut : ✅ validé par Jérôme le 2026-08-11.**

Filtré depuis `docs/2-reference/08-known-gaps.md` sur ce qui touche réellement le portail client
(le reste — identités, CRM, campagnes, sécurité back-office — relève des cahiers des charges
`/partner`/`/admin`, pas de celui-ci).

**Déjà traitées dans une section précédente de ce document** (pas de nouvelle décision ici) :

| Lacune | Traitement retenu |
|---|---|
| A2 — prix dortoir replié à 1 personne | §6 : le PMS reste autoritaire sur son prix, pas de tarification par tranche ajoutée côté app. |
| A4 — confirmation par import CSV, pas de poll | §5 : remplacé par un poll automatique régulier, au mieux possible. |
| A6 — catalogue indisponible bloque les prestations sans injecter de données fictives | §3e : confirmé, comportement à conserver. |
| A7 — attribution par code historique | §3c : le code devient un identifiant d'attribution transporté par QR/lien ; aucun champ de saisie client. Persistance uniquement sur compte enregistré, dernier code valide prioritaire. |
| A9 — maison entière non réservable en ligne | Déjà résolu en prod (2026-07-28), obsolète — le portail réserve les maisons entières (§3a). |
| A13 — un produit sans date ne décompte aucun cupo | Comportement logique, confirmé — sans date, rien à décompter. |
| G10, G11, G12 — plafonds de cupos et fenêtre de fermeture | Repris comme invariants validés en §3d/§6. |

**Nouvelles décisions à prendre pour ce document :**

- **A3 — décision (2026-08-11, simplifiée et précisée le 2026-08-12) : pas de reprise
  commission-vs-app, mais une REDISTRIBUTION entre référent et prestataire selon QUI annule.**
  Règle binaire sur le reversement lui-même : **aucune annulation ou absence côté client ne
  donne jamais lieu à un remboursement**, quel que soit le délai avant la date — l'acompte reste
  encaissé. **Seule une annulation par le prestataire lui-même** (il ne peut pas honorer la
  réservation) rend l'argent au client ; dans ce cas seulement, plus aucune commission n'est due
  sur la ligne (rien n'a été vendu).
  Sur une ligne **réalisée**, ou **annulée/no-show côté client** (l'acompte reste encaissé dans
  les deux cas), la répartition de l'acompte (§3b) change selon le cas :
  - la **part app** (7 %, ou 17 % en direct) reste **toujours identique**, réalisée
    ou pas ;
  - la **part référent** (10 %, cas référent externe uniquement) n'est due **que si la ligne est
    réalisée**. Sur une ligne annulée/no-show côté client, ces 10 % ne sont **pas** versés au
    référent — ils sont **redirigés vers le prestataire**, en compensation du créneau bloqué pour
    rien. Le référent n'a rien apporté de concret (le client n'est jamais venu) ; le prestataire,
    lui, a bloqué sa disponibilité pour cette réservation.
  - En auto-référence ou en direct, il n'y a de toute façon aucune part référent à
    redistribuer (déjà 0 % dans le cas normal, §3b) — rien ne change pour ces deux cas.
  **Simplification (2026-08-12)** : remplace la précédente version de cette règle (fenêtre
  d'annulation gratuite en jours, reversement no-show partiel configurable) — abandonnée après
  clarification du modèle de paiement. **Il n'y a plus de « politique d'annulation » à afficher
  comme un délai** : la règle à communiquer au client est simplement qu'une annulation ou une
  absence de sa part n'est jamais remboursée, sauf si c'est l'établissement qui annule.
  **Précision sur le montant concerné** : l'argent réellement mobilisé par la plateforme (une
  fois le paiement en ligne implémenté, cf. cadrage général — hors périmètre v1) n'est jamais le
  total de la réservation, seulement l'**acompte** — le reste se règle directement avec
  l'établissement.
- **A11 — décision (2026-08-11) : périmètre minimal reconduit pour ce premier lot.** Séjour
  minimum, délai de préavis minimum et tarif week-end différencié restent de **bonnes options à
  garder en tête**, mais pas à construire maintenant — notées comme cibles futures possibles
  (cf. `hifago/README.md`), pas comme un manque à combler dès la refonte.
- **A14 — décision (2026-08-11) : la limite est levée.** Un même produit pourra apparaître
  **plusieurs fois dans une même commande, à des dates différentes** — sous réserve, comme pour
  toute ligne, que chaque date choisie ait assez de places/chambres disponibles (règles de cupos
  du §3d, appliquées indépendamment à chaque ligne, y compris entre deux lignes du même produit à
  des dates différentes).
- **A12 — la grille tarifaire d'un logement proposé par un prestataire ne s'édite pas dans la
  file d'approbation admin.** Hors périmètre de ce document (concerne `/partner`/`/admin`, pas le
  parcours client) — à reprendre dans le cahier des charges du portail concerné, pas ici.

**Non tranchable ici, à vérifier empiriquement plus tard** :
- **Q1** — reste à confirmer sur une vraie réservation multi-lits payée : Lobby facture-t-il bien
  `rates_per_day` comme le tarif total de la chambre (quantité déjà encodée dans le prix), et non
  un prix par personne multiplié automatiquement ? La convention actuelle suppose la première
  lecture ; à reconfirmer avant de porter cette hypothèse dans un nouveau connecteur PMS.
- **Q5** — dépôt de logement entier encaissé en ligne : dépend de la décision paiement en ligne
  (MercadoPago/Stripe), déjà notée comme cible future non tranchée (cf. `hifago/README.md`).

## 8. Annexe — traçabilité code→règle

**Statut : en relecture — à valider avec Jérôme.**

### Fichiers sources par section

| Section | Fichiers sources principaux |
|---|---|
| §1 Périmètre et vision | `docs/2-reference/04-app-reservar.md` (§ Rôle), `docs/2-reference/01-architecture.md` |
| §3a Catalogue et tarification | `src/services/catalogService.js`, `src/services/portalService.js:594`, `docs/2-reference/04-app-reservar.md` (§ hébergements, § modèle Casa Kayam) |
| §3b Moteur de commission | `src/services/pricingService.js` (`priceLine()`), invariant R5 du registre interne |
| §3c Code partenaire / attribution | `src/services/orderService.js`, `src/services/portalService.js` (`discount_only`), `src/services/pricingService.js` |
| §3d Disponibilité, cupos, calendrier | `src/services/inventoryService.js` (`isPerSlot`, `assertCanReserve`, `assertCanReserveStay`), `src/controllers/portalController.js` |
| §3e Règles de panier | `src/services/portalService.js` (`reserve()`, validation/bornage synchrone) |
| §3f Cycle de vie de la commande | `src/services/orderService.js` (`LINE_TRANSITIONS`, `markMirrorFailed`), `src/services/storageService.js` (`expireStale`), `src/services/commission.js` (`deriveStatus`), `src/services/ledgerService.js` (`openException`), `src/controllers/lobbyController.js` |
| §4 Entités de données | `docs/2-reference/05-data-model.md` (tables `products`, `product_calendar`, `orders`, `order_lines`, `exceptions_queue`, `partner_codes`, `providers.lobby_connector`) |
| §5 Intégration LobbyPMS | `docs/2-reference/04-app-reservar.md` (§ `POST /reserve`), `docs/3-integrations/lobby_pms_api.md`, `docs/3-integrations/lobby_pms_implementation.md`, `src/services/catalogService.js` (`isPmsBacked`), `docs/2-reference/05-data-model.md`, `docs/2-reference/08-known-gaps.md` (A4, A11-A13, Q5) |
| §6 Cas limites | `docs/2-reference/04-app-reservar.md` (barème dorms, arrondi maison entière, tours statiques), `docs/2-reference/05-data-model.md` (`experiences.online_bookable`) |
| §7 Lacunes connues | `docs/2-reference/08-known-gaps.md` (A2, A3, A4, A6, A7, A9, A11-A14, G10-G12, Q1, Q5) |

### Points explicitement laissés ouverts pour le chiffrage technique

Consolidé depuis les sections ci-dessus — à trancher à l'ouverture du chiffrage, pas avant :

1. **§3e** — les plafonds de lignes/unités du panier (aujourd'hui pensés pour un seul
   établissement) : plafond global sur toute la commande une fois plusieurs établissements
   combinés, ou plafond répété par établissement ? *Rendu plus visible depuis que le panier survit
   plusieurs jours (§2b.6).*
2. **§2** — détail d'implémentation du voucher/e-ticket (QR, PDF, autre).

La liste vivante des points ouverts du parcours client est désormais le **§2f**, qui en porte six.
Celle-ci ne garde que ceux qui touchent d'autres sections que le §2.

**Point désormais tranché le 2026-09-07** : placement des suggestions complémentaires = **après
chaque ajout au panier**, par retour à l'accueil réordonnée (§2b.5) — jamais à l'étape de paiement.

**Points désormais tranchés le 2026-08-13** (⚠️ le troisième est amendé : la modification par
lignes est sortie du périmètre du portail **client** le 2026-09-07, §2c, et reste un geste
socio/admin) : remise par quantité = jamais sur les nuits ;
attribution persistante = compte enregistré uniquement et dernier code valide prioritaire ;
modification = lignes choisies, annulation = commande entière.

### Cibles futures importantes (hors périmètre immédiat, à ne pas perdre)

Consolidées dans `hifago/README.md` pour rester visibles au niveau de tout le chantier, pas
seulement de ce document : synchronisation externe (iCal) pour les propriétés sans PMS,
paiement en ligne (MercadoPago/Stripe), options de logement entier (séjour minimum, délai de
préavis, tarif week-end).

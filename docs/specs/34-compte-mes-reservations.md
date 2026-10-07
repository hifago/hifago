---
id: specs-compte-mes-reservations
titre: "Compte client : « Mis reservas », la liste et le détail"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: implemente
maj: 2026-09-11
revise: ["docs/01-cahier-des-charges-client.md#2c", "docs/01-cahier-des-charges-client.md#2d"]
resume: >
  Fait de /cuenta/reservas un vrai écran : une carte par commande, toutes ses prestations dépliées
  avec ce qui a été payé et ce qui reste dû, groupées en « Próximas » et « Pasadas ». L'annulation
  devient prestation par prestation (renverse le cahier §2c) et sa confirmation dit que l'acompte
  n'est pas remboursé (révise §2d). Le détail réutilise /reserva/<jeton>, enrichi du lien vers la
  fiche de l'établissement et de son contact WhatsApp. Un seul contrat SQL « commande vue par son
  client » sert désormais les deux écrans, et la dernière requête Supabase écrite dans une route de
  la zone compte disparaît.
mots_cles: [compte, mis reservas, annulation, cancel_order_line, list_my_orders, contrat commande, whatsapp, check-data-layer]
repond_a:
  - "Que voit un client dans « Mis reservas » ?"
  - "Comment un client annule-t-il une prestation sans annuler toute sa commande ?"
  - "Où vit le contrat « ce qu'un client peut voir d'une commande » ?"
---

# Compte client : « Mis reservas », la liste et le détail

> **Cible stack** : hifago. **Premier écran de la zone compte**, après la spec 33 qui a refermé le
> tunnel dessus (« Ver mis reservas » y mène déjà). S'appuie sur la spec 31 (identité anonyme), la
> spec 32 (panier en base) et la spec 33 (`get_order_by_token`, `orders.reference`).
>
> **Décisions prises en entretien avec Jérôme le 2026-09-11**, écran par écran. Les dix arbitrages
> sont au §3, chacun avec ce qui a été écarté et pourquoi.
>
> ⚠️ **Cette spec révise deux sections d'un cahier validé** : §2c (« annuler = annuler toute la
> commande ») et §2d (« le non-remboursement s'affiche sur l'écran de paiement, et pas ailleurs »).
> Les deux renversements sont de Jérôme, datés, et portés en §10.
>
> ⚠️ **Écrite pendant qu'un second agent construit `/cuenta/perfil` dans le même arbre.** Les
> fichiers partagés et les gestes qui ne m'appartiennent pas sont nommés en §2 « Frontières ».
>
> **✅ Validée par Jérôme le 2026-09-11**, après lecture des sept points que la rédaction avait
> tranchés seule (§10) — dont un qui s'écartait du périmètre annoncé (le namespace i18n).
>
> **✅ Implémentée le 2026-09-11** — les quatre tranches. Ce que le code a corrigé du texte est en
> §10bis : **deux défauts trouvés en regardant le rendu réel**, et un e2e qu'on a découvert mort.

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 0 | **Contrat compact** (pour coder — lire seul, sans le reste) | ✅ validé 2026-09-11 |
| 1 | Contexte et problème | ✅ validé 2026-09-11 |
| 2 | Portée, tranches et frontières | ✅ validé 2026-09-11 |
| 3 | Décisions retenues (entretien du 2026-09-11) | ✅ validé 2026-09-11 |
| 4 | Parcours cible | ✅ validé 2026-09-11 |
| 5 | Les écrans, bloc par bloc | ✅ validé 2026-09-11 |
| 7 | Contrat RPC — pourquoi une RPC, et pourquoi une seule | ✅ validé 2026-09-11 |
| 8 | Règles et invariants | ✅ validé 2026-09-11 |
| 9 | Cas limites | ✅ validé 2026-09-11 |
| 10 | Décisions tranchées / points ouverts | ✅ validé 2026-09-11 |
| 11 | Annexe — traçabilité | ✅ validé 2026-09-11 |
| 12 | Documents liés | ✅ validé 2026-09-11 |

---

## 0. Contrat compact (pour coder — lire seul, sans le reste)

### Ce que ça change, en une phrase

`/cuenta/reservas` devient une vraie liste — une carte par commande, toutes ses prestations
dépliées, groupées en « Próximas » / « Pasadas » — l'annulation passe de la commande entière à la
prestation, et le contrat SQL « commande vue par son client » devient **unique**, partagé avec
`/reserva/<jeton>`.

### Carte des routes

| URL | Fichier | Zone | État |
|---|---|---|---|
| `/[locale]/cuenta/reservas` | `(cuenta)/cuenta/reservas/page.tsx` | compte | **à refaire** |
| `/[locale]/reserva/[token]` | `(vitrine)/reserva/[token]/page.tsx` | vitrine | **enrichi** (③) |

Aucune route créée. Aucun `/cuenta/reservas/[id]` : le détail est `/reserva/<jeton>` (décision ③).

### Les quatre objets SQL

| Objet | État | Rôle |
|---|---|---|
| `order_for_client_jsonb(p_order public.orders) → jsonb` | **à créer** | **LE** contrat « commande vue par son client ». `stable`, `security definer`, `set search_path = ''`, `revoke all … from public, anon, authenticated` — jamais exposée, appelée seulement par les deux lecteurs ci-dessous |
| `get_order_by_token(p_token text) → jsonb` | **réécrite dessus** | Gardes inchangées (regex du jeton, `order_not_found` indistinct). Gagne `establishment_slug` + `establishment_contact_phone`, perd `order.status` |
| `list_my_orders() → jsonb` | **à créer** | `stable`, `security definer`, `search_path = ''`. `auth.uid()` obligatoire, **refus d'une session anonyme** (⑦). Rend `group` et l'ordre **depuis la base** |
| `cancel_order_line(p_line_id uuid) → jsonb` | **à créer** | Squelette de `cancel_order`, verrou `for update` sur **la ligne** |
| `cancel_order(p_order_id uuid)` | **supprimée en T4** | ⑩ — zéro appelant après T3 |

**Aucune table touchée. Aucune colonne ajoutée. Aucun index ajouté** —
`orders_account_id_created_at_idx` et `order_lines_order_id_idx` couvrent les deux accès, et le tri
porte sur quelques dizaines de lignes déjà agrégées.

### Le contrat partagé — ce qui sort, ce qui ne sort pas

Par commande : `id`, `reference`, `payment_status`, `created_at`, `holder_name`, `holder_phone`,
`holder_email`, `total_cop`, `acompte_cop` (sommes des lignes **vivantes** seulement), `lines[]`.

Par ligne : `id`, `product_name` (jsonb brut), `product_type`, `product_slug`,
`establishment_name` (jsonb brut), **`establishment_slug`**, **`establishment_contact_phone`**,
`date`, `end_date`, `slot_start_time`, `qty`, `price_cop`, `total_cop`, `acompte_cop`, `status`.

**Jamais** : `commission_case`, `acompte_pct`, `referrer_pct`, `app_pct`,
`referrer_commission_cop`, `app_commission_cop`, `referrer_partner_id`, `account_id`,
`access_token` (sauf ajout explicite par `list_my_orders`), `marketing_consent`,
`attribution_code`, `attribution_source`, `pms_booking_id`, **ni `orders.status`**.

`list_my_orders` ajoute par commande, et elle seule : `access_token` (pour lier vers le détail) et
`group` (`'upcoming'` | `'past'`).

### Le regroupement et l'ordre — décidés par la base

```
« upcoming »  ⟺  il existe au moins une ligne `reserved` dont
                 coalesce(end_date, date) >= today_in_bogota()
tri upcoming  :  min(date) filter (…) ASC          — la plus proche en haut
tri past      :  max(coalesce(end_date, date)) filter (status <> 'superseded') DESC
tiebreak      :  created_at DESC, id ASC
```

⚠️ **`end_date` compte** : un séjour commencé hier et fini demain est `upcoming`. C'est le même
prédicat que `list_clients` (cas `en_casa`), et c'est l'assertion qui rougit si on l'oublie.

### Invariants

1. Aucune requête Supabase dans un fichier de route : `page.tsx` n'appelle ni `.from(` ni
   `createClient`. **L'exemption de `scripts/check-data-layer.sh` est retirée dans le même commit.**
2. Il n'existe **qu'un** endroit où se décide ce qu'un client voit d'une commande :
   `order_for_client_jsonb`. Un champ ajouté pour un écran apparaît dans les deux.
3. Aucune colonne de commission ne sort du contrat — vérifié par une assertion pgTAP sur les clés
   du jsonb, pas par la relecture.
4. `orders.status` n'est ni affiché ni transmis : il n'est plus dans le payload.
5. Le groupe (`upcoming`/`past`) et l'ordre viennent de la base ; le TypeScript ne fait qu'un
   `filter`, jamais un second calcul de « à venir ».
6. Une prestation annulée reste **listée**, barrée, avec son statut — jamais masquée, jamais
   retirée d'un total qu'elle avait déjà quitté.
7. `cancel_order_line` n'annule **que** la ligne visée : les sœurs de la même commande restent
   intactes.
8. Une session anonyme est refusée par `list_my_orders` **et** par `cancel_order_line`, en base —
   jamais par la seule garde d'écran.
9. ⚠️ **Révisé le 2026-10-06** (`20261006192424_order_line_cancellations.sql`) : toute annulation
   et toute expiration **rendent** la place, la ressource partagée et le blocage d'agenda. A3 ne
   règle que l'argent, jamais l'inventaire ; un evento `rsvp`/`unlimited` ne rend rien (rien pris).
10. La confirmation d'annulation ne chiffre aucun montant : sa chaîne i18n ne porte **aucune**
    variable de prix.

### Cas limites

| Situation | Traitement |
|---|---|
| Client sans aucune commande | `EstadoVacio` (molecule existante), avec un lien vers l'accueil |
| Commande dont toutes les lignes sont mortes | groupe `past`, même si la date était future |
| Commande sans aucune ligne (défensif) | groupe `past`, repli de tri sur `created_at` |
| Établissement dépublié | le lien vers sa fiche répond `notFound()` — assumé, cf. §10 pt 4 |
| `establishments.contact_phone` nul | **aucun bouton de contact** — jamais un bouton mort |
| Ligne déjà annulée, expirée, réalisée | pas de bouton ; un appel direct rend `line_not_active` |
| Double-clic sur « Sí, anular » | `isPending` côté écran, `for update` + `where status = 'reserved'` côté base |
| Ligne d'un autre compte / inexistante | **la même** réponse `line_not_found` |
| Session anonyme | `list_my_orders` → `anonymous_session` ; l'écran redirige vers `/entrar` |
| RPC injoignable | erreur rendue **en ligne** (`SiteToaster` n'est monté nulle part), jamais une page vide |

### Fichiers touchés

**Créés** : `supabase/migrations/<ts>_contrat_commande_client.sql` ·
`supabase/migrations/<ts>_cancel_order_line.sql` · `supabase/migrations/<ts>_drop_cancel_order.sql` ·
`supabase/tests/database/{list_my_orders,cancel_order_line}.test.sql` ·
`apps/web/lib/orders/getMyOrders.ts` · `apps/web/lib/orders/orderState.ts` (+ `.test.ts`) ·
`apps/web/app/[locale]/(cuenta)/cuenta/reservas/{OrderCard,CancelLineButton}.tsx`
(+ `CancelLineButton.test.tsx`) · `apps/web/e2e/mis-reservas.spec.ts`.

**Modifiés** : `apps/web/app/[locale]/(cuenta)/cuenta/reservas/page.tsx` (réécrit) ·
`apps/web/lib/orders/getOrderByToken.ts` · `apps/web/app/[locale]/(vitrine)/reserva/[token]/OrderResult.tsx` ·
`apps/web/messages/{es,en}/AccountOrdersPage.json` · `apps/web/messages/{es,en}/OrderResultPage.json` ·
`supabase/tests/database/get_order_by_token.test.sql` · `supabase/tests/database/security_definer_exposure.test.sql` ·
`scripts/check-data-layer.sh` · `packages/supabase/src/database.types.ts` (régénéré) ·
`packages/supabase/src/identity.ts` (**commentaire seulement**).

**Supprimés** : `apps/web/app/[locale]/(cuenta)/cuenta/reservas/OrdersList.tsx` ·
`apps/web/e2e/cancel-order.spec.ts` · `supabase/tests/database/cancel_order.test.sql`.

**Jamais touchés** (chantier de l'autre agent) : `(cuenta)/layout.tsx` · `cuenta/perfil/**` ·
`components/organisms/SiteMenu.tsx` (supprimé par le plan 41, G5) · `CoquillaVitrine.tsx` · `messages/{es,en}/Chrome.json` ·
`apps/web/messages/index.ts`.

---

## 1. Contexte et problème

Trois faits, tous mesurés le 2026-09-11.

### L'écran existe, et il ne dit rien

`cuenta/reservas/page.tsx` porte son propre aveu en en-tête : *« minimal (pas la page compte
complète du cahier des charges), juste ce qu'il faut pour rendre l'annulation testable »*. Sa
requête est `select("id, holder_name, created_at, order_lines(id, status)")` — elle ne demande ni
la référence, ni le produit, ni la date de prestation, ni un montant. L'écran affiche donc le nom
du titulaire (que le client connaît), la date de création (dont il n'a rien à faire) et « 1 de 2
líneas activas ». **Rien n'est cliquable** : `OrdersList.tsx` ne contient ni `Link` ni `<a>`.

### La fin du tunnel pointe déjà ici

La spec 33, livrée la veille, fait dire à `/reserva/<jeton>` « **Ver mis reservas** » →
`/cuenta/reservas` pour un compte réel, et « Crear una cuenta » → `/registro?next=/cuenta/reservas`
pour un invité. La destination promise au client qui vient de payer est cet écran-là.

### C'est l'une des deux dernières exemptions du garde-fou

`scripts/check-data-layer.sh` interdit `.from(` et `createClient` dans tout fichier de route. Sa
liste d'exemptions est passée de cinq à quatre puis à deux, et le script écrit lui-même : *« cette
liste est de la DETTE VISIBLE, pas une permission (…) elle doit RÉTRÉCIR à chaque lot (…) une ligne
ajoutée ici est une régression »*. Les deux restantes sont `cuenta/reservas/page.tsx` et
`(tunnel)/pago/page.tsx`. **Ce lot fait tomber la première.**

### Et un piège propre à cet écran

Les colonnes de commission d'`order_lines` ne sont protégées par **aucun** grant ni restriction de
colonne : `order_lines_select` autorise `account_id = (select auth.uid())` sur **toutes** les
colonnes. Leur exclusion est aujourd'hui purement applicative — « on ne les demande pas dans le
`select` ». Le portail legacy fait exactement cette faute en production : `portalService.js:885,915`
renvoie `commission_estimee_cop` au front client. C'est la raison de fond pour laquelle cet écran
passe par une RPC à liste blanche plutôt que par une requête neuve (§7), même si cela ne referme pas
la porte en base (§10 pt 8).

---

## 2. Portée, tranches et frontières

### In

La liste `/cuenta/reservas` · le regroupement et l'ordre · l'annulation par prestation et sa
confirmation · l'enrichissement de `/reserva/<jeton>` (lien établissement + contact) · le contrat
SQL partagé · le retrait de l'exemption de `check-data-layer.sh` · la suppression de `cancel_order`.

### Out, explicitement

- **La modification d'une réservation** (changer une date, une quantité) : retirée du premier
  périmètre le 2026-09-07, reste au backlog. `modify_order_line` continue de servir socio/admin.
- **La remise en vente d'une place annulée** : *Trou (a)* du backlog, en attente d'arbitrage. Une
  annulation par prestation ne le change ni en bien ni en mal.
- **Le remboursement** : Tranche 2 de la spec 19, non commencée. Rien n'est remboursé (§7/A3).
- **La fermeture de la fuite des commissions en base** : §10 pt 8, arbitrage à part.
- **Le déménagement des libellés de statut** vers un namespace transverse : §10 pt 6.
- **La garde de zone pour `/cuenta/perfil`** : ce n'est pas mon fichier — « Frontières » ci-dessous.

### Tranches

| # | Contenu | Ce qu'elle prouve | État à la fin |
|---|---|---|---|
| **T1** | `order_for_client_jsonb`, `get_order_by_token` réécrite dessus, `list_my_orders`, tests pgTAP, types régénérés | Qu'il n'existe qu'**un** contrat ; que le groupe et l'ordre viennent de la base ; qu'aucune commission ne sort ; que ⑦ est refusée en base | Rien ne consomme encore `list_my_orders`. Les deux écrans actuels sont inchangés et verts |
| **T2** | `cancel_order_line` + son test pgTAP. `cancel_order` **toujours vivante** | Que les sœurs ne bougent pas ; que `booked` ne bouge pas ; que la file PMS n'enfile qu'au **dernier** `reserved` du booking | L'écran actuel marche encore |
| **T3** | `page.tsx` réécrit, `OrderCard`, `CancelLineButton`, `getMyOrders`, `orderState`, messages, e2e. **Chute de l'exemption** | Que `check-data-layer.sh` passe de **2 à 1** exemption ; qu'annuler une prestation sur deux laisse l'autre active, et que ça survit au rechargement | `cancel_order` n'a plus aucun appelant |
| **T4** | `/reserva/<jeton>` enrichi, `drop function cancel_order`, liste blanche allégée, commentaire d'`identity.ts` | Que la liste blanche du test de sécurité perd une entrée et n'en gagne aucune | Lot terminé |

**T3 avant le drop**, sans exception : l'inverse casserait l'écran existant au milieu du lot.

### Frontières — ce qui ne m'appartient pas

| Fichier | Pourquoi je n'y touche pas | Conséquence à porter à Jérôme |
|---|---|---|
| `(cuenta)/layout.tsx` | Chantier « profil » de l'autre agent | ⚠️ La décision ⑦ vaut pour **toute** la zone. Je ne peux la poser que dans mon `page.tsx`. **Sans son geste, `/cuenta/perfil` restera ouvert aux invités** pendant que les réservations leur seront fermées |
| `apps/web/messages/index.ts` | Dernier fichier i18n partagé ; il devra l'éditer s'il crée un namespace | D'où la décision de §10 pt 6 : **étendre `AccountOrdersPage`**, qui existe et est déjà branché, plutôt que créer un namespace |
| `packages/supabase/src/database.types.ts` | Sa régénération réécrit le fichier entier | ⚠️ **Le vrai risque de collision du lot.** À régénérer en fin de tranche, et à annoncer |
| `packages/supabase/src/identity.ts` | Fichier partagé par les deux apps | Son commentaire l. 30-32 devient faux (« `/cuenta/reservas` lui est accessible, gain voulu de la spec 31 »). **Commentaire seulement**, jamais le prédicat, et signalé avant |

---

## 3. Décisions retenues (entretien du 2026-09-11)

| # | Décision | Ce qui a été écarté, et pourquoi |
|---|---|---|
| ① | **Une carte par commande, toutes ses prestations dépliées dedans** | La carte résumée (« Kayak + 1 autre », détail au clic) : Jérôme — « si la personne prend 1 hôtel pour x jours plus des activités, ce serait peut-être mieux » tout déplié. La structure y est favorable : un hébergement de 5 nuits est **une** ligne (`date` + `end_date`), donc « 1 hôtel + 3 activités » = 4 lignes. La carte par prestation : deux cartes de la même commande sans que rien ne dise qu'elles sont liées |
| ② | **Deux groupes, « Próximas » puis « Pasadas »** | Le flux unique par date de commande — c'est le comportement actuel, et le seul tri déjà indexé : une réservation faite il y a trois mois pour demain finit en bas de liste. Le flux unique par date de prestation : pas de frontière visible entre ce qui est fait et ce qui vient |
| ③ | **Le détail réutilise `/reserva/<jeton>`**, enrichi du lien vers la fiche de l'établissement et de son contact | Un écran `/cuenta/reservas/<id>` dédié : deux écrans de détail pour le même client, qui divergeront — la divergence que ce projet passe son temps à refermer. Bénéfice non anticipé : **le client venu du lien de l'email gagne le contact lui aussi** |
| ④ | **Deux montants par prestation** — ce qui a été payé en ligne pour elle, et son prix total | Un acompte global au niveau de la commande. Trouvaille de l'entretien : avec ⑤, il **baisserait** à chaque annulation alors que rien n'est remboursé (§7/A3) — le client lirait « déjà payé : 30.000 » après en avoir versé 51.000. Les deux montants existent déjà figés par ligne (`acompte_cop`, `total_cop`) : **aucune migration** |
| ⑤ | **L'annulation se fait prestation par prestation**, jamais « toute la commande » | Le comportement actuel. ⚠️ **Renverse le cahier §2c** (« annuler la réservation signifie annuler toute la commande et toutes ses lignes », 2026-09-07) et rouvre le point « modification partielle » du backlog. Décision explicite de Jérôme : « l'annulation devrait être sur une activité ou hôtel, mais pas toutes les prestations » |
| ⑥ | **Le contact est celui de l'établissement** (`establishments.contact_phone`), message pré-rempli avec `orders.reference` | Le numéro Hifago unique — ce que fait la production (`573215764841` en dur dans `reservar.js`) : toute question d'horaire ou de logistique passerait par Jérôme avant d'atteindre l'établissement. Le repli Hifago : le client ne saurait pas à qui il écrit |
| ⑦ | **Un invité (session anonyme) est refusé** sur cet écran | Lui montrer ses commandes et lui proposer un compte. ⚠️ Revient sur un « gain voulu » nommé par la spec 31 — mais le recul est **théorique** : aucun chemin de l'interface n'y mène un invité (`SiteMenu` lui affiche « Iniciar sesión », `/reserva/<jeton>` « Crear una cuenta »). La décision aligne la garde sur ce que le chrome fait déjà depuis la spec 33 |
| ⑧ | **La confirmation dit que l'acompte n'est pas remboursé, sans le chiffrer** | Ne rien dire (un clic annule, aujourd'hui) ; ou chiffrer la perte. ⚠️ **Révise le cahier §2d**, qui veut cette mention sur l'écran de paiement « et pas ailleurs » — mais c'est ici que le client perd de l'argent, sans pouvoir défaire |
| ⑨ | **Un invité ne peut pas annuler**, en base non plus ; sur `/reserva/<jeton>`, **le contact de l'établissement est son chemin d'annulation** | Lui laisser `cancel_order_line` : une capacité que plus rien n'exercerait, ⑦ lui ayant retiré l'écran. Mettre « Anular » sur le lien du jeton : la spec 33 a posé la veille « le jeton ne donne aucun droit d'écriture destructif » — un lien qui circule par email, se transfère et se retrouve dans une boîte piratée ne doit pas pouvoir détruire une réservation non remboursable |
| ⑩ | **`cancel_order` est supprimée** en fin de lot | La garder « au cas où » : elle implémente la règle que ⑤ renverse, reste exécutable par tout compte connecté, et occupe une entrée dans la liste blanche du test de sécurité. Mesuré : **zéro appelant** hors `OrdersList.tsx` — ni dans `apps/admin`, ni dans `supabase/functions`, ni dans `packages/` |

### L'encadré ④ — la trouvaille qui a réconcilié deux réponses

Les deux demandes de Jérôme se percutaient. Il voulait « **voir ce que tu as payé** » sur le détail
(réponse 1) **et** l'annulation par prestation (réponse 2). Or `get_order_by_token` calcule
`acompte_cop` comme la somme des acomptes des lignes **vivantes** — une définition correcte tant que
l'annulation était totale (tout tombe à zéro d'un coup), et **fausse** dès qu'elle devient partielle :
le montant affiché baisserait alors que rien n'est remboursé.

Trois issues étaient possibles : lire le montant réellement encaissé dans `payments` (juste, mais une
migration et un champ de plus), garder l'acompte des lignes vivantes (faux), ou afficher les deux
(deux montants proches et différents sur le même écran). **Jérôme a tranché une quatrième** :
descendre l'information d'un étage. « Tu payes 17 % du prix ; on affiche ce que tu as payé / le prix
total de la presta. » Par prestation, `acompte_cop` **est** ce qui a été payé pour elle, et
`total_cop` son prix — les deux sont figés à la commande, la RPC les rend déjà. Une prestation
annulée garde son propre « payé, non remboursable » sans fausser quoi que ce soit, et aucun total
global n'a besoin de mentir.

⚠️ Corollaire à ne pas perdre : **le pourcentage n'est jamais écrit dans l'interface.**
`acompte_pct` est figé **par ligne** et peut varier ; « 17 % » en dur deviendrait faux sans que rien
ne le signale. On affiche des montants.

---

## 4. Parcours cible

1. Le client connecté ouvre `/es/cuenta/reservas` (menu du site, ou « Ver mis reservas » depuis
   `/reserva/<jeton>`).
2. `page.tsx` résout qui regarde. **Pas de compte réel → `/entrar`** (⑦).
3. `getMyOrders(locale)` appelle `list_my_orders()`. La base rend les commandes **déjà ordonnées**
   et **déjà groupées**.
4. L'écran rend « Próximas » puis « Pasadas ». Chaque commande est une carte : sa référence, son
   état de paiement, et toutes ses prestations — nom, établissement (lien vers sa fiche), date,
   quantité, statut, `payé / prix total`.
5. Le client clique « Anular » sur une prestation. Le bouton **cède la place à une confirmation**
   qui nomme la prestation, dit que l'acompte n'est pas remboursé (⑧), et — si c'est la dernière
   prestation active — prévient que toute la réservation sera annulée.
6. Il confirme. `cancel_order_line(id)` verrouille la ligne, la passe à `cancel_by_client`, et rend
   le nombre de prestations encore actives. L'écran se rafraîchit **depuis la base**
   (`router.refresh()`), jamais depuis un état optimiste.
7. La prestation reste affichée, barrée, avec son statut et son montant payé — non remboursable.
8. « Ver detalle » mène à `/reserva/<jeton>` : les trois totaux, les coordonnées, et par prestation
   le lien vers l'établissement et son contact WhatsApp.

**Parcours de l'invité** : il n'a pas cet écran (⑦). Depuis son lien email, il voit son détail et,
pour annuler, **écrit à l'établissement** (⑨).

---

## 5. Les écrans, bloc par bloc

### 5.1 `/cuenta/reservas` — la liste

```
(cuenta)/layout.tsx                 en-tête de zone + robots noindex   ⚠️ PAS MON FICHIER
│
└─ cuenta/reservas/page.tsx                          Server Component
   ├─ viewerIsRealAccount()                          garde ⑦ → redirect("/entrar")
   ├─ getMyOrders(locale)                            LA seule lecture
   └─ PageShell variant="narrow"                     pose l'unique <main>
      ├─ Title as="h1"                               « Mis reservas »
      ├─ EstadoVacio                                 si aucune commande
      ├─ <section> « Próximas »                      si le groupe n'est pas vide
      │  └─ OrderCard × n                            Server Component
      │     ├─ référence · état de paiement
      │     ├─ <ul> une <li> par prestation
      │     │  ├─ nom · Link vers /establecimientos/<slug>
      │     │  ├─ date (ou plage, ou créneau) · quantité
      │     │  ├─ statut de ligne
      │     │  ├─ Price payé / Price prix total       (④)
      │     │  └─ CancelLineButton                    "use client", si status = reserved
      │     └─ Link « Ver detalle » → /reserva/<jeton>
      └─ <section> « Pasadas »                       même rendu
```

**Une section vide n'est pas rendue** — même règle que les sections de l'accueil (spec 28).

`OrderCard` reste **Server Component** : il n'importe rien de `@hifago/ui`, seulement les atomes de
la vitrine, qui portent déjà `"use client"` quand il le faut. C'est le motif déjà en place dans
`(tunnel)/carrito/page.tsx`, qui importe `LinkButton` sans casser le build.

**Responsive** : la carte est une liste verticale à toutes les largeurs — rien à replier, rien à
masquer. Sous `md`, les deux montants d'une prestation passent sous son libellé plutôt qu'à sa
droite. Aucun `overflow-x`.

### 5.2 Le bloc d'annulation — deux temps, en place

Aucun `Modal` HeroUI n'est monté dans `apps/web` : la confirmation est **inline**, à la place du
bouton.

```
[ Anular ]
   ↓ clic
┌────────────────────────────────────────────────┐
│ ¿Anular « Kayak Guatapé » del 5 oct.?          │   role="alert"
│ El anticipo pagado no se devuelve.             │   ⑧ — aucun montant
│ Después de esto, toda la reserva queda anulada.│   seulement si c'est la dernière active
│              [ Sí, anular ]   [ No ]           │   focus posé sur « Sí, anular »
└────────────────────────────────────────────────┘
```

- `role="alert"` : le bloc est **annoncé** quand il apparaît.
- Le focus va sur « Sí, anular » ; « No » restaure le bouton et rend le focus.
- « Sí, anular » porte `isPending` (jamais `isDisabled` : la vitrine perd le focus avec).
- En cas d'échec, le message s'affiche **en ligne** (`role="alert"`) — `SiteToaster` n'est monté
  nulle part dans `apps/web`, dette connue.
- ⚠️ L'`error` de supabase-js est **lue**, contrairement à aujourd'hui : une panne réseau et un
  refus métier ne disent pas la même chose au client.

### 5.3 `/reserva/<jeton>` — ce qui s'ajoute

Par prestation, sous le libellé existant :

- le nom de l'établissement devient un `Link` vers `/establecimientos/<slug>` ;
- un lien de contact WhatsApp **quand `contact_phone` existe**, pré-rempli :
  `Hola, soy {nom}, reserva {reference}` — la forme exacte du portail en production
  (`reservar.js:321`), à ceci près que la référence porte déjà son préfixe `HFG-`.

Et, **pour un visiteur sans compte réel seulement** (⑨), une phrase sous le bloc de contact :
« Para anular o modificar esta reserva, escribe al establecimiento. »

⚠️ **L'URL `wa.me` est construite côté serveur**, dans `getOrderByToken.ts`. `OrderResult.tsx` est
`"use client"` : y importer `urlDeContacto` depuis `@/lib/catalog/establecimiento` embarquerait tout
le module catalogue — et `createPublicClient` — dans le bundle navigateur. C'est l'angle mort nommé
en tête de `check-data-layer.sh`, **déjà réalisé une fois** par `FichaEstablecimiento.tsx:11` : ne
pas en faire une seconde occurrence.

### 5.4 Les libellés

`AccountOrdersPage` est **étendu** (§10 pt 6), es et en.

| Clé | es | en |
|---|---|---|
| `title` | Mis reservas | My bookings |
| `metaTitle` | Mis reservas | My bookings |
| `groupUpcoming` | Próximas | Upcoming |
| `groupPast` | Pasadas | Past |
| `empty.titulo` | Aún no tienes reservas | No bookings yet |
| `empty.descripcion` | Cuando reserves algo, lo encontrarás aquí. | Once you book something, you'll find it here. |
| `emptyCta` | Descubrir Guatapé | Discover Guatapé |
| `viewDetail` | Ver detalle | View details |
| `linePaid` | Pagado | Paid |
| `lineTotal` | Precio total | Total price |
| `lineQty` | Cantidad: {count} | Quantity: {count} |
| `cancelLine` | Anular | Cancel |
| `cancelConfirmTitle` | ¿Anular « {product} » del {date}? | Cancel "{product}" on {date}? |
| `cancelConfirmNoRefund` | El anticipo pagado no se devuelve. | The deposit already paid is not refunded. |
| `cancelConfirmLastLine` | Después de esto, toda la reserva queda anulada. | After this, the whole booking is cancelled. |
| `cancelConfirmYes` | Sí, anular | Yes, cancel |
| `cancelConfirmNo` | No | No |
| `cancelling` | Anulando… | Cancelling… |
| `cancelError` | No se pudo anular. Inténtalo de nuevo. | Could not cancel. Please try again. |
| `loadError` | No pudimos cargar tus reservas. | We could not load your bookings. |

**Retirées** : `linesSummary` (« X de Y líneas activas ») et `cancel` (« Anular reserva » —
sémantique « toute la commande », renversée par ⑤).

`OrderResultPage` gagne : `viewEstablishment`, `contactWhatsApp` (« Escribir por WhatsApp » /
« Message on WhatsApp »), `contactMessage` (« Hola, soy {name}, reserva {reference} ») et
`guestCancelHint`.

Les **sept statuts de ligne** sont lus depuis `OrderResultPage.lineStatus.*`, jamais recopiés — deux
copies des mêmes sept mots divergeraient, et `parity.test.ts` ne voit pas les doublons.

---

## 7. Contrat RPC — pourquoi une RPC, et pourquoi une seule

### 7.1 Pourquoi pas une lecture RLS directe

La RLS autorise un client à lire ses commandes en direct (`orders_select`), et `getCartLines.ts` est
un précédent parfaitement légitime de lecture directe. Mais `cart_items` ne porte **aucune règle** —
la RLS *est* toute la règle. Ici, quatre règles sont en jeu, et **trois existent déjà en SQL** :

1. **Le regroupement « à venir / passée »** — `list_clients` le calcule déjà, mot pour mot
   (`coalesce(end_date, date)` contre `today_in_bogota()`), pour le tableau clients de l'admin.
   L'écrire en TypeScript en produirait une **seconde définition** que rien ne compare.
2. **« Aujourd'hui »** — `today_in_bogota()` est `revoke`d pour `anon` **et** `authenticated`
   (`20260828150000:62`). Une lecture TypeScript ne peut littéralement pas appeler la définition du
   jour de référence : elle devrait la re-dériver.
3. **Le tri par agrégat des lignes** — PostgREST ne sait pas trier un parent par un agrégat
   d'enfants. Il faudrait tout rapatrier et trier côté app.
4. **La liste blanche de colonnes** — et c'est là que se joue `CLAUDE.md` §11.20.

Avec une RPC, ceci est une assertion qui **rougit par mutation** :

```sql
select is(
  (select count(*)::int
     from jsonb_array_elements(<contrat> #> '{order,lines}') l,
          lateral jsonb_object_keys(l) k
    where k like '%commission%' or k like '%_pct' or k = 'referrer_partner_id'),
  0,
  'aucune colonne de commission ne sort du contrat « commande vue par son client »');
```

Avec un `.select("id, date, qty, …")` en TypeScript, **rien ne rougit** si quelqu'un allonge la
chaîne. C'est la définition exacte d'un souhait.

### 7.2 Pourquoi un seul contrat, partagé

`get_order_by_token` et la liste répondent à la même question — *que peut voir un client de sa
commande ?* — pour deux portes d'entrée différentes (un jeton, une identité). Deux
`jsonb_build_object` séparés auraient divergé **au premier champ ajouté**, et le premier champ
ajouté est celui de ce lot : `establishment_slug`.

```sql
create or replace function public.order_for_client_jsonb(p_order public.orders)
returns jsonb language sql stable security definer set search_path = ''
```

**Paramètre composite** (`public.orders`, pas un `uuid`) : `list_my_orders` l'appelle alors en une
passe (`select public.order_for_client_jsonb(o) from public.orders o where …`) sans re-sonder la
clé primaire une fois par commande, et une colonne ajoutée à `orders` ne casse pas la signature.

**`revoke all … from public, anon, authenticated`** : elle n'est pas une API, elle est un contrat
interne. Le `revoke` est obligatoire — PostgreSQL accorde `EXECUTE` à `PUBLIC` sur toute fonction
neuve, sens **inverse** des tables, piège re-mesuré le 2026-09-10 — et il la sort du filtre du cas 1
de `security_definer_exposure.test.sql`.

⚠️ **Réécrire `get_order_by_token` demande de repartir de sa définition vivante**
(`pg_get_functiondef`), pas de la retaper : `.claude/rules/supabase.md` §7 le prescrit, et c'est une
fonction de 90 lignes livrée la veille.

### 7.3 `list_my_orders()` — la forme

```sql
  if auth.uid() is null then          return … 'not_authenticated';  end if;
  if public.is_anonymous_session() then return … 'anonymous_session'; end if;   -- ⑦
```

Le second refus n'est pas décoratif : il satisfait **le cas 2** de
`security_definer_exposure.test.sql` (« toute RPC dont le seul garde est `auth.uid()` exclut
explicitement une session anonyme, ou figure nommément dans la liste blanche »). ⑦ devient donc une
règle **vérifiée en base**, au lieu de reposer sur une garde d'écran — ce qui est précisément ce que
je ne peux pas garantir, la garde de zone ne m'appartenant pas.

### 7.4 `cancel_order_line(p_line_id uuid)` — la forme

Squelette de `cancel_order`, granularité déplacée :

- `auth.uid()` obligatoire, puis refus d'une session anonyme (⑨) ;
- `select … from public.order_lines where id = p_line_id for update` — le verrou est sur **la
  ligne** : deux prestations de la même commande s'annulent indépendamment ; ce qu'on sérialise,
  c'est le double-clic sur la même ;
- ligne inexistante **ou** d'un autre compte → **la même** réponse `line_not_found` (discipline de
  non-divulgation partagée avec `cancel_order`, `create_payment_intent` et `get_order_by_token`) ;
- statut ≠ `reserved` → `line_not_active` ;
- `update … set status = 'cancelled_by_client' where id = … and status = 'reserved'` ;
- rend `{ok: true, order_id, remaining_active_lines}` — ce dernier champ **a un lecteur** : c'est
  lui qui fait basculer la carte sur « toute la réservation est annulée ».

⚠️ **Révisé le 2026-10-06** (`20261006192424_order_line_cancellations.sql`) : l'annulation **rend**
la place (cupos, créneau, ressource partagée, blocage d'agenda) sous les verrous `orders` → ligne →
capacité — c'est donc une opération de capacité (`CLAUDE.md` §4), prouvée sous concurrence réelle
(`tests/concurrency/cancel_order_line.concurrency.mjs`). A3 ne règle que l'argent, jamais
l'inventaire. Elle prend la place de `cancel_order`.

### 7.5 La propagation LobbyPMS suit — mais elle doit être prouvée

Le trigger de `20260827160000` est `after update on public.order_lines … for each statement`, et sa
garde est écrite **par booking, jamais par ligne** :

```sql
and not exists (select 1 from public.order_lines ol
                 where ol.pms_booking_id = nr.pms_booking_id and ol.status = 'reserved')
```

Comme les activités héritent du `pms_booking_id` de l'hébergement, annuler une activité
**n'annulera pas la nuit d'hôtel** tant qu'une ligne `reserved` partage le booking. Aucune ligne à
changer. ⚠️ **Mais ce chemin n'a jamais tourné** : avec `cancel_order`, toutes les lignes mouraient
dans la même instruction. Deux assertions pgTAP l'exigent (§8).

---

## 8. Règles et invariants

Les dix invariants sont en §0. Ce qui mérite sa justification :

**Invariant 2 (un seul contrat)** — c'est la réponse à la recommandation portée à l'ouverture du
lot : « deux contrats *détail de commande* pour le même client, c'est exactement la divergence que
ce projet passe son temps à refermer ». Elle est tenue au sens fort : non pas « les deux écrans
rendent la même forme », mais « les deux écrans appellent la même fonction ».

**Invariant 4 (`orders.status` n'est plus transmis)** — la colonne vaut `'confirmed'` sur toute
ligne, aucun `update` ne l'écrit nulle part, et la migration `20260814161500:9-13` l'assume par
écrit. La retirer du payload fait passer « ne pas l'afficher » d'une discipline à une
impossibilité. Aucune assertion existante n'y touche, et `getOrderByToken.ts` ne le portait déjà pas.

**Invariant 8 (refus anonyme en base)** — voir §7.3. C'est ce qui rend ⑦ vraie même si la garde de
zone, qui ne m'appartient pas, reste telle quelle.

### Ce qui doit être prouvé, et à quel palier

`.claude/rules/tests.md` — le palier le plus léger qui prouve le comportement.

**pgTAP — `list_my_orders.test.sql`**
1. Une identité `is_anonymous` propriétaire de commandes reçoit `anonymous_session` **et zéro
   commande**. *(⑦ prouvée en base — remplace un e2e coûteux.)*
2. Le compte A ne voit aucune commande du compte B. *(La RPC étant `security definer`, la RLS ne la
   protège plus : c'est `where account_id = auth.uid()` seul qui le fait.)*
3. Quatre commandes qui ne peuvent pas se confondre : prestation future `reserved` → `upcoming` ;
   séjour `date < today <= end_date` → **`upcoming`** ; prestation passée `fulfilled` → `past` ;
   toutes lignes annulées sur une date **future** → `past`.
4. L'ordre exact des `reference` rendues, en une assertion. *(Inverser `asc`/`desc` la fait rougir.)*
5. Aucune clé `%commission%` / `%_pct` / `referrer_partner_id` ; `access_token` présent ;
   `acompte_cop` **et** `total_cop` présents par ligne *(④ verrouillée en base)*.
6. Les grants, par `has_function_privilege` : `anon` faux, `authenticated` vrai.

**pgTAP — `cancel_order_line.test.sql`**
1. `authenticated` sans claims → `not_authenticated`.
2. Ligne d'un autre compte → `line_not_found` **et la ligne est inchangée** — un refus est aussi une
   absence d'écriture, ce que `cancel_order.test.sql` ne prouvait pas.
3. Ligne inexistante → **la même** raison.
4. **La sœur ne bouge pas** : deux lignes `reserved`, on en annule une → l'autre reste `reserved`,
   `remaining_active_lines = 1`. *C'est l'assertion qui incarne ⑤ ; elle rougit si quelqu'un
   réintroduit « toute la commande ».*
5. Dernière ligne active → `remaining_active_lines = 0`.
6. Ligne `fulfilled` → `line_not_active`, inchangée ; second appel → idem.
7. `product_availability.booked` **inchangé**.
8. Session anonyme propriétaire → `anonymous_session`, **ligne inchangée**.
9. **File PMS** : deux lignes partageant un `pms_booking_id` — après la 1ʳᵉ annulation, **0** entrée
   dans `pms_cancellation_queue` ; après la 2ᵉ, **exactement 1**. *Seule preuve que retirer une
   activité n'annule pas la nuit d'hôtel.*
10. Les grants.

**pgTAP — `get_order_by_token.test.sql`** : +5 assertions (slug présent, contact rendu quand il
existe et `null` sinon, `order.status` absent, clés de commission absentes). Les 26 existantes ne
bougent pas — c'est leur rôle. Elles sont toutes des extractions par chemin ou des `count(*)`,
aucune égalité d'objet entier : ajouter des clés n'en casse aucune.

**Vitest — deux endroits, pas plus**
- `lib/orders/orderState.test.ts` : les six états de commande et `DEAD_LINE_STATUSES`, extraits de
  `OrderResult.tsx` où ils vivent en ternaires non testés. Fonction pure. La liste et le détail
  doivent dire la même chose du même objet.
- `CancelLineButton.test.tsx` : **un seul** comportement — la confirmation annonce-t-elle « toute la
  réservation » quand c'est la dernière prestation active, et pas sinon. État dérivé d'une prop,
  invisible au typecheck, exigence explicite de ⑤. Le reste est de l'affichage : rien.

**E2E — un seul spec**, `mis-reservas.spec.ts`, qui remplace `cancel-order.spec.ts`. Setup par
`create_order` (dogfooding, comme l'actuel) avec **deux** prestations : la liste les montre toutes
les deux avec leurs deux montants ; la commande est sous « Próximas » ; annuler la première fait
apparaître la confirmation **sans montant** et **sans** la phrase « dernière prestation » ; après
confirmation la première est barrée et **la seconde reste active** ; le rechargement le confirme.
Les refus (`line_not_found`, `line_not_active`, anonyme) ne sont **pas** rejoués ici : ils sont
prouvés en base, où c'est plus fort et cent fois moins cher.

**Contrôles mécaniques** : `check-data-layer.sh` (doit tomber à **une** exemption),
`check-i18n-links.sh`, `check-design-system.sh`, `check-timezone.sh`, `check-tokens.sh`,
`messages/parity.test.ts`, et `npm run build` d'`apps/web` — le seul endroit où le piège du barrel
RSC se voit.

---

## 9. Cas limites

Le tableau sec est en §0. Trois méritent leur raison :

**Une commande dont toutes les lignes sont mortes va dans « Pasadas », même si la date était
future.** Plus rien n'arrivera : c'est ce que « passée » veut dire ici. Conséquence assumée — une
annulation datée du mois prochain apparaît en tête des passées.

**Un établissement dépublié donne un lien mort.** La RPC étant `security definer`, elle rend le slug
sans appliquer `establishments_select_public` (qui exige `status = 'active'` et au moins un produit
`sellable`) : `/establecimientos/<slug>` répondra `notFound()`. Le cas est rare et le remède —
recopier le prédicat de la policy dans la RPC — est précisément la duplication qui a produit le
défaut corrigé par `20260827270000`. **Le téléphone, lui, est rendu inconditionnellement** : c'est
justement quand un établissement quitte la vitrine que le client a besoin de le joindre au sujet
d'une réservation déjà payée.

**`contact_phone` nul → aucun bouton.** Jamais un bouton qui ne fait rien. La colonne est nullable
depuis `20260908202000`, et la fiche établissement applique déjà cette règle.

---

## 10. Décisions tranchées / points ouverts

### Ce que la rédaction a décidé seule (à valider avec Jérôme)

1. **Le contact WhatsApp vit sur le détail seulement.** La liste porte le nom de l'établissement en
   lien vers sa fiche — c'est gratuit et utile — mais pas un bouton d'action par prestation : une
   commande à quatre prestations chez trois établissements afficherait trois boutons de contact dans
   la même carte. ③ dit « le détail ».
2. **La carte affiche l'état de paiement de la commande.** ⑧ interdit `orders.status`, qui est autre
   chose ; `payment_status` est la seule vraie machine d'état d'une commande. Une commande impayée
   qu'on ne peut pas distinguer serait un trou. Le bouton « Pagar » reste sur le détail — un seul
   point d'entrée de paiement, comme la spec 33 l'a posé.
3. **`order.status` sort du payload** du contrat partagé (invariant 4). Changement de contrat d'une
   RPC livrée la veille, mais **sans lecteur** : `getOrderByToken.ts` ne le portait pas jusqu'au
   TypeScript, et aucune assertion pgTAP ne le touche.
4. **Le slug d'établissement est rendu inconditionnellement**, lien mort rare accepté (§9). Au
   backlog comme point connu.
5. **Ni pagination ni défilement infini.** Quelques dizaines de commandes par client, et les props
   de `ListadoInfinito` (`tarjetasIniciales`, `endpointBase`) sont typées aux cartes du catalogue :
   l'y plier demanderait un endpoint de pagination dont personne n'a besoin.
6. **Pas de nouveau namespace i18n** — `AccountOrdersPage` est étendu. En créer un obligerait à
   éditer `messages/index.ts`, **le dernier fichier i18n partagé**, que l'agent du profil devra
   éditer aussi s'il crée le sien. Les sept libellés de statut sont **lus** depuis
   `OrderResultPage.lineStatus.*` plutôt que recopiés. Le nom ment un peu — le geste propre
   (déménager vers `Common.orderLineStatus`) touche deux fichiers partagés : **lot à part**.
7. **`orderState.ts` est extrait** de `OrderResult.tsx` vers `lib/orders/`, avec ses tests. Les six
   états d'une commande sont aujourd'hui une cascade de ternaires dans un composant client, non
   testée, et la liste en a besoin aussi.

### Points ouverts

8. ⚠️ **La fuite des colonnes de commission reste ouverte, et le remède habituel ne marche pas.**
   Un `grant select (colonnes)` **s'attache au rôle**, pas à la policy : admin, socio, référent et
   client sont tous `authenticated`. La liste des colonnes autorisées devrait donc inclure
   `referrer_commission_cop` et `app_commission_cop` pour ne pas casser sept lectures de
   `apps/admin` — et ces colonnes redeviendraient lisibles par le client. **Ce chemin est
   structurellement sans issue.** La seule fermeture réelle : `revoke select on public.order_lines
   from authenticated` + conversion des sept lectures admin/socio/référent en RPC (précédents :
   `list_clients`, `list_client_orders`, `list_partners_admin`). **Ce lot y contribue** — il retire
   les deux lectures client du chemin direct — **sans le trancher.** Au backlog sous cette forme.
9. ~~**`formatLineSchedule` rend les dates ISO brutes**~~ — **tranché par Jérôme le 2026-09-11 :
   à part, plus tard.** Les dates restent affichées en brut (`2026-11-01`) sur les trois écrans,
   donc de façon cohérente. Corriger ici aurait changé le rendu de `CartSummary` et `OrderResult`,
   que ce lot ne refait pas, et fait rougir leurs e2e — une régression portée sur du code qui n'est
   pas le sien. Reste au backlog, et **ne pas la corriger « au passage »** en écrivant les écrans.
10. **La garde de zone pour `/cuenta/perfil`** : ⑦ vaut pour toute la zone compte, et
    `(cuenta)/layout.tsx` ne m'appartient pas. **À porter à l'agent du profil.**
11. **Le déménagement des sept libellés de statut** vers un namespace transverse (pt 6).

---

---

## 10bis. Ce que le code a corrigé du texte (2026-09-11)

### Deux défauts que seul le rendu réel a montrés

1. **Mes `data-testid` enfants cassaient un e2e existant.** `order-line-establishment-…`,
   `order-line-paid-…` et `order-line-contact-…` commencent tous par `order-line-`, et
   `payment-return.spec.ts` compte `getByTestId(/^order-line-/)` pour vérifier qu'une commande à
   une ligne en affiche bien une : il en trouvait **trois**. Le préfixe `order-line-<uuid>` reste
   réservé à la LIGNE ; ses enfants s'appellent `establishment-link-…`, `line-paid-…`,
   `line-total-…`, `contact-whatsapp-…`. ⚠️ Le filet a fonctionné comme prévu — c'est un e2e
   antérieur qui a attrapé une régression introduite par ce lot.
2. **Deux boutons WhatsApp quasi homonymes sur le même écran.** Le pied de page de la zone vitrine
   porte déjà « Escríbenos por WhatsApp » — le canal **Hifago** — et le bouton de la décision ⑥
   disait « Escribir por WhatsApp », le canal **établissement**. Constaté en capturant le rendu, pas
   en relisant le code. Le libellé **nomme désormais l'établissement** (« Escribir a Casa Kayam
   Guatapé »). Le cahier §2c prévoit bien les deux canaux ; c'est au libellé de dire lequel.

### Un e2e qui était mort sans que personne le sache

`cancel-order.spec.ts`, que ce lot remplace, passait `p_lines` à `create_order` — **paramètre
supprimé par la spec 32 le 2026-09-10**, quand le panier est passé en base et que la RPC s'est mise
à lire ses propres lignes. Il n'aurait pas pu passer. Invisible parce que la suite e2e est en pause
depuis le 2026-09-09, soit la veille.

⚠️ **Cinq autres fichiers portent la même rupture** — `admin-order-status`, `admin-ledger`,
`admin-modify-order-line`, `admin-product-price-tiers`, `admin-product-delete`. Porté au backlog :
le jour où la suite sera réactivée, ces cinq-là échoueront pour une raison qui n'a rien à voir avec
ce qu'ils testent.

### Un défaut d'affichage révélé par l'écran, non corrigé

Une commande dont les prestations sont **réalisées** (`fulfilled`) mais dont `payment_status` vaut
`unpaid` s'annonce « Tu reserva aún no está pagada ». La dérivation vient de la spec 33, où elle ne
se voyait pas (on y arrive après avoir payé) ; sur un historique, elle saute aux yeux. **Non corrigé
dans ce lot** : il faudrait un libellé de plus et une décision sur ce que signifie cet état, et la
correction toucherait aussi `/reserva/<jeton>`. Au backlog. *(En production le cas devrait être
rare — `expire_stale_payment_orders` reprend une commande impayée au bout de 30 minutes ; c'est
surtout le seed qui le produit.)*

### Trois choses vérifiées par mutation, pas par relecture

| Mutation appliquée | Ce qui a rougi |
|---|---|
| `coalesce(end_date, date)` → `date` seule dans `list_my_orders` | le séjour en cours classé « à venir », **et** l'ordre de la liste |
| `'app_commission_cop', ol.app_commission_cop` ajouté au contrat partagé | **les deux** écrans d'un coup — la démonstration de ce que le partage achète |
| `where id = p_line_id` → `where order_id = v_order_id` dans `cancel_order_line` | la prestation sœur, le décompte restant, **et** la file LobbyPMS (la nuit d'hôtel serait partie) |

### Ce que la base savait déjà, et qu'on a failli réécrire

Le prédicat « à venir / passée » **existait en SQL** depuis le 2026-08-28 : `list_clients` le
calcule pour le tableau clients de l'admin, avec `coalesce(end_date, date)` contre
`today_in_bogota()`. `upcoming` est la fusion exacte de ses cas `proxima` et `en_casa`. Et
`today_in_bogota()` est `revoke`d pour `authenticated` : une lecture TypeScript **ne pouvait pas**
appeler la définition du jour de référence, elle aurait dû la re-dériver. Deux arguments qui ne se
voyaient qu'en lisant la base, et qui ont décidé la forme du lot.

## 11. Annexe — traçabilité

| Section | Sources |
|---|---|
| ① ② ⑤ ⑧ | `docs/01-cahier-des-charges-client.md` §2c (révisé), §2d (révisé), §7/A3 |
| ③ ⑨ | `docs/specs/33-resultat-paiement-et-fermeture-du-tunnel.md` §0 et invariant 4 ; `supabase/migrations/20260910170100_get_order_by_token.sql` |
| ④ | `supabase/migrations/20260814180000_order_lines_commission_snapshot.sql` (`acompte_cop`, `total_cop` figés par ligne) |
| ⑥ | `supabase/migrations/20260908202000_establishments_contacto_publico.sql` ; `apps/web/lib/catalog/establecimiento.ts` (`urlDeContacto`) ; legacy `public/reservar.js:321` (`confirm_wa_msg`) |
| ⑦ | `docs/specs/31-identite-anonyme.md` ; `packages/supabase/src/identity.ts` ; `supabase/migrations/20260909200000_liste_blanche_sessions_anonymes.sql` |
| ⑩ | `supabase/migrations/20260814161500_cancel_order_rpc.sql` ; `supabase/tests/database/security_definer_exposure.test.sql` (cas 2) |
| Groupe et tri | `supabase/migrations/20260828150000_dates_civiles_en_heure_de_bogota.sql` (`today_in_bogota`, `list_clients`) |
| File PMS | `supabase/migrations/20260827160000_pms_cancellation_queue.sql` ; `docs/specs/25-propagation-annulation-lobbypms.md` |
| Couche d'accès | `scripts/check-data-layer.sh` ; `apps/web/lib/cart/getCartLines.ts` ; `apps/web/lib/orders/getOrderByToken.ts` |
| Legacy — l'absence | `docs/1-manuels/10-client.md` §4 : le portail actuel n'a **aucun** compte client ni historique. Le seul ancrage réutilisable est le WhatsApp pré-rempli après réservation |

## 12. Documents liés

`docs/01-cahier-des-charges-client.md` (§2c, §2d, §3f, §7/A3) · `docs/specs/31-identite-anonyme.md` ·
`docs/specs/32-panier-en-base.md` · `docs/specs/33-resultat-paiement-et-fermeture-du-tunnel.md` ·
`docs/specs/25-propagation-annulation-lobbypms.md` · `docs/specs/27-architecture-vitrine-et-routage.md` ·
`docs/05-reference-technique.md` · `.claude/rules/{supabase,apps,ui,tests}.md` ·
`apps/web/components/README.md`.

---
id: specs-resultat-paiement-et-fermeture-du-tunnel
titre: "L'écran de résultat de paiement et la fermeture du tunnel"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: implemente
maj: 2026-09-20
revise: docs/01-cahier-des-charges-client.md#2b.9
resume: >
  Donne une adresse propre à chaque commande — /reserva/<jeton>, rechargeable sans limite de temps
  et envoyée dans l'email de confirmation — et referme le tunnel dessus : les trois back_urls de
  Mercado Pago y mènent au lieu de renvoyer sur un écran de checkout devenu vide depuis la spec 32,
  l'échec de paiement y propose « Reintentar pago », et un invité peut y créer un compte qui
  rattache ses commandes par adresse email. Corrige au passage la locale forcée à `es` au retour de
  paiement, l'entrée « Iniciar sesión » disparue du site depuis la spec 31, et l'angle mort e2e qui
  a laissé ce trou survivre.
mots_cles: [resultat, paiement, reserva, access_token, reference, rattachement, back_urls, robots, mercadopago, tunnel]
repond_a:
  - "Que voit le client quand il revient de Mercado Pago ?"
  - "Comment un invité retrouve-t-il sa réservation des mois plus tard ?"
  - "Comment une commande passée en invité est-elle rattachée à un compte créé après coup ?"
---

# L'écran de résultat de paiement et la fermeture du tunnel

> **Cible stack** : hifago. **Dernier écran du tunnel**, après la spec 31 (identité anonyme) et la
> spec 32 (panier en base), toutes deux livrées le 2026-09-10. Applique la décision du cahier
> `docs/01-cahier-des-charges-client.md` §2b.9 (2026-09-07), qui renvoyait explicitement deux
> contraintes à cette spec.
>
> **Décisions prises en entretien avec Jérôme le 2026-09-10**, écran par écran. Les sept arbitrages
> sont au §3, chacun avec ce qui a été écarté et pourquoi.
>
> **✅ Validée par Jérôme le 2026-09-10**, section par section, après lecture des cinq points que la
> rédaction avait tranchés seule.
>
> **✅ Implémentée le 2026-09-10** — les quatre tranches. Ce que le code a corrigé du texte est en
> §10bis : **deux gardes ajoutées en écrivant**, dont une trouvée par un test qui a rougi.

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 0 | **Contrat compact** (pour coder — lire seul, sans le reste) | ✅ validé 2026-09-10 |
| 1 | Contexte et problème | ✅ validé 2026-09-10 |
| 2 | Portée et tranches | ✅ validé 2026-09-10 |
| 3 | Décisions retenues (entretien du 2026-09-10) | ✅ validé 2026-09-10 |
| 4 | Parcours cible | ✅ validé 2026-09-10 |
| 5 | Les écrans, bloc par bloc | ✅ validé 2026-09-10 |
| 10 | Décisions tranchées / points ouverts | ✅ validé 2026-09-10 |
| 11 | Annexe — traçabilité code→règle | ✅ validé 2026-09-10 |
| 12 | Documents liés | ✅ validé 2026-09-10 |

---

## 0. Contrat compact (pour coder — lire seul, sans le reste)

### Ce que ça change, en une phrase

Une commande gagne **une adresse à elle** — `/[locale]/reserva/<jeton>` — vers laquelle Mercado
Pago renvoie, que l'email de confirmation porte, et qui reste ouvrable sans limite de temps ; le
tunnel s'y referme, de sorte que `/pago` ne rend plus jamais d'écran de succès et que `CheckoutForm`
perd tout son état de paiement.

### Carte des routes

| URL | Fichier | Zone | Contenu |
|---|---|---|---|
| `/[locale]/reserva/[token]` | `app/[locale]/(vitrine)/reserva/[token]/page.tsx` | **vitrine** | l'écran de résultat — Server Component, rendu **dynamique** |
| `/reserva/[token]` *(sans locale)* | *(la même route, après redirection du proxy)* | — | **la forme utilisée par `back_urls`** — cf. « Locale » ci-dessous |

⚠️ **Zone vitrine, pas tunnel** (décision ⑦) : en-tête et pied de page complets. Le paiement est
terminé, il n'y a plus rien à protéger d'une fuite, et un client qui rouvre son lien trois mois plus
tard depuis son email doit trouver un site autour de sa réservation, pas un cul-de-sac. Le layout
de zone (`CoquillaVitrine`) est déjà celui qu'il faut, aucune coquille nouvelle.

### Locale — pourquoi la back_url ne porte **pas** de préfixe

`back_urls` vaut `${origin}/reserva/<jeton>`, **sans `/es` ni `/en`**. C'est le correctif entier de
la trouvaille 3, et il ne coûte ni colonne ni migration :

`resolveLocale` (next-intl) résout dans cet ordre — **préfixe du chemin → cookie `NEXT_LOCALE` →
`Accept-Language` → `es`** (`node_modules/next-intl/dist/esm/production/middleware/resolveLocale.js`,
lu le 2026-09-10). Le projet ne surcharge ni `localeDetection` ni `localeCookie`, qui valent donc
`true` et `{name: "NEXT_LOCALE", sameSite: "lax"}` (`routing/config.js`). Une URL **sans** préfixe
tombe donc sur le cookie du visiteur, puis sur sa langue de navigateur — et le retour depuis
`mercadopago.com` est une navigation GET de document, que `SameSite=Lax` laisse passer.

⚠️ Et c'est le `/es` en dur qui **cassait** ce mécanisme, pas son absence : un chemin préfixé fait
résoudre `es` par la branche 1, et `syncCookie` **réécrit alors `NEXT_LOCALE` à `es`** dès que la
valeur diffère (`middleware/syncCookie.js`) — d'où la bascule de toute la suite de session en
espagnol pour un anglophone, et pas seulement de cette page-là.

### Modèle de données (delta)

| Objet | État | Détail |
|---|---|---|
| `orders.reference text` | **à créer** | `not null unique`, forme `HFG-000042` — le numéro **affiché**, dictable, jamais un secret |
| `orders.access_token text` | **à créer** | `not null unique`, `encode(extensions.gen_random_bytes(16), 'hex')` — 32 caractères, 128 bits. Le **secret**, jamais affiché comme un numéro |
| `orders_reference_seq` | **à créer** | séquence qui alimente le défaut de `reference` |
| index sur `orders(access_token)` | **à créer** | l'unicité le fournit ; c'est le seul chemin de lecture de l'écran |
| `orders` / `order_lines` | inchangées sinon | aucune colonne retirée, aucun type changé |
| `create_order` | **inchangée** | ⚠️ délibérément — cf. « Pourquoi `create_order` n'est pas touchée » |

Backfill obligatoire dans la même migration (les deux colonnes sont `not null`) : la séquence
numérote les commandes existantes par `created_at` croissant, et `gen_random_bytes` leur donne un
jeton. `pgcrypto` est déjà installé dans le schéma `extensions`
(`20260821020000_enable_pgcrypto_extension.sql`) — d'où la qualification `extensions.`, obligatoire
sous `search_path = ''`.

### Pourquoi `create_order` n'est **pas** touchée

Tentation naturelle : lui faire renvoyer `reference` et `access_token` à côté d'`order_id`. Écarté —
c'est une RPC critique au sens de `CLAUDE.md` §4, et la rouvrir pour deux champs de retour n'a
aucune contrepartie : **`orders_select` autorise déjà le propriétaire à lire sa propre ligne**
(`account_id = (select auth.uid())`), et depuis la spec 31 `orders.account_id` est `NOT NULL` et
porte l'identité — anonyme comprise. `CheckoutForm` lit donc le jeton en RLS directe, comme
n'importe quelle autre colonne :

```ts
const { data } = await supabase.from("orders").select("access_token").eq("id", orderId).single();
```

Zéro migration sur une RPC anti-survente, zéro aller-retour de plus qu'aujourd'hui.

### Les deux RPC

#### `get_order_by_token(p_token text) → jsonb`

`security definer`, `set search_path = ''`, `stable`. Rend la commande **entière** — lignes, totaux,
statut de paiement, et les coordonnées du client (nom, téléphone, email : le tradeoff est assumé par
écrit au cahier §2b.9). Rend `{"ok": false, "reason": "order_not_found"}` pour un jeton inconnu —
**la même réponse qu'une commande inexistante**, jamais un refus qui distinguerait les deux (même
discipline que `cancel_order` et `create_payment_intent`).

Les libellés localisés sortent **bruts** (`products.name`, `establishments.name` en JSONB) et sont
résolus côté TypeScript par `resolveLocalizedField` — exactement ce que fait déjà `getCartLines`
(spec 32). La RPC ne traduit rien, comme `lib/catalog/` ne compose aucun libellé.

`grant execute to anon, authenticated` : un client qui ouvre le lien depuis son email sur un appareil
neuf **n'a aucune session**, pas même anonyme (la spec 31 n'en pose une qu'au premier ajout au
panier). Le jeton fait foi, jamais l'identité.

⚠️ **Elle devra être ajoutée nommément aux exceptions du cas 1 de
`supabase/tests/database/security_definer_exposure.test.sql`** — elle ne contient ni `is_admin(`, ni
`auth.uid(`, ni `has_capability(`, puisque son garde est le jeton. Le précédent exact existe déjà
dans ce même fichier : `check_partner_invitation`, « publique par conception : vérifie un jeton
d'invitation AVANT toute inscription, donc nécessairement appelable sans compte ». Le commentaire
d'exception doit dire la même chose, dans les mêmes termes.

#### `attach_orders_to_account() → jsonb`

`security definer`, `set search_path = ''`. Sans paramètre : elle lit `auth.uid()` et l'email de
`auth.users` elle-même — **jamais un email reçu en paramètre**, qui serait précisément le
*pre-account takeover* que la spec 31 décision ⑤ a écarté.

Trois gardes, dans cet ordre :

1. `auth.uid()` non nul, sinon `not_authenticated` ;
2. **`is_anonymous_session()` → refus** (`anonymous_session`). Un anonyme n'a de toute façon jamais
   d'email vérifié, mais l'exclure nommément est ce qui satisfait le **cas 2** du test
   `security_definer_exposure` (invariant 4 de la spec 31) — sans lui, la fonction y échouerait ;
3. `auth.users.email_confirmed_at is not null`, sinon `email_not_confirmed`. **C'est le seul geste
   qui rend le rattachement sûr** : sans lui, n'importe qui s'inscrit avec l'email d'autrui et
   récupère ses commandes.

Puis, dans une seule transaction :

```sql
update public.orders
   set account_id = v_account_id
 where lower(holder_email) = lower(v_email)
   and account_id is distinct from v_account_id
   and holder_email <> 'reserva-manual@hifago.local';   -- compte technique, spec 31 invariant 8

update public.order_lines ol                             -- account_id y est DUPLIQUÉ depuis orders
   set account_id = v_account_id                         -- (20260813194515) : les deux ou aucun
 where ol.order_id in (…les mêmes commandes…);
```

Idempotente : un second appel ne trouve plus rien à rattacher et rend `{"ok": true, "attached": 0}`.

⚠️ **`order_lines.account_id` doit bouger en même temps** — il est dénormalisé depuis `orders`
depuis `20260813194515` (« évite qu'une lecture de `order_lines` déclenche en cascade l'évaluation
de la policy RLS d'`orders` »). L'oublier laisserait `/cuenta/reservas` montrer la commande et
`order_lines_select` en cacher les lignes.

Appelée **une fois**, depuis `apps/web/app/auth/callback/route.ts`, juste après un `verifyOtp` /
`exchangeCodeForSession` réussi : c'est l'instant précis où l'email vient d'être vérifié et où la
session existe. Un échec n'interrompt jamais la redirection (le compte est créé, c'est l'essentiel).

### Mercado Pago — deux changements dans `createCheckoutPreference`

| Aujourd'hui | Demain |
|---|---|
| `successUrl`/`pendingUrl`/`failureUrl` = `${origin}/es/pago` | `${origin}/reserva/<jeton>` — un seul et même écran pour les trois issues, sans préfixe de locale |
| aucun filtre de moyens de paiement | `payment_methods.excluded_payment_types: [{id: "ticket"}, {id: "atm"}]` |

Le jeton est lu **côté serveur** dans `POST /api/payments/create`, qui a déjà le `payment_id` et
lit déjà `payments` via `service_role` : un `select` de plus sur `orders` par `order_id`. Le
navigateur n'a jamais à transmettre le jeton à ce Route Handler.

⚠️ **`auto_return: "approved"` reste** : il ne concerne que le cas approuvé, et rend le retour
automatique là où il l'est déjà.

### Invariants

1. **Le numéro n'est jamais le secret.** `reference` s'affiche, se dicte et part dans l'objet d'un
   email ; `access_token` ne s'affiche jamais comme un numéro et ne vit que dans une URL.
2. **Aucune lecture directe de la commande depuis l'écran** : tout passe par `get_order_by_token`.
   L'écran ne fait ni `.from("orders")` ni appel `service_role` — la logique d'autorisation vit en
   base, où un test pgTAP peut l'atteindre.
3. **`service_role` n'est jamais présenté comme un filet de sécurité** (`CLAUDE.md` §3.5). Il ne sert
   ici qu'à ce qu'il servait déjà (lire `payments` dans `/api/payments/create`) ; le filet de cet
   écran, ce sont le jeton, ses tests pgTAP et sa revue.
4. **Le jeton ne donne aucun droit d'écriture destructif.** `cancel_order` exige strictement
   `account_id = auth.uid()` et **n'est pas ouverte** au jeton : quiconque détient le lien pourrait
   sinon annuler la réservation d'un autre. Annuler reste l'affaire de `/cuenta/reservas`.
5. **Un échec de paiement ne renvoie jamais au panier** (cahier §2b.9) : la réservation est
   conservée, l'écran propose « Reintentar pago ».
6. **`/pago` ne rend plus jamais d'écran de succès** — dès que `create_order` et le PMS ont accepté,
   le client est redirigé sur son adresse de commande. C'est ce qui referme le tunnel, et ce qui
   fait disparaître au passage le défaut cosmétique connu du 2026-09-10 (`CartSummary` figée après
   succès sur `/pago`).
7. **L'adresse reste valable sans limite de temps** (cahier §2b.9) : aucune expiration de jeton,
   aucune purge. Elle montre l'**état courant** de la commande, y compris annulée, expirée ou
   réalisée — jamais une photo figée du jour de l'achat.
8. **Une identité anonyme n'est pas « connectée »** : `user.is_anonymous` distingue les deux partout
   où l'interface parle de compte (invariant nouveau, cf. décision ⑥).

### Cas limites

| Situation | Traitement |
|---|---|
| Jeton inconnu, malformé, ou commande supprimée | **404** — jamais un message qui distingue les trois |
| Retour `approved` mais webhook pas encore arrivé | L'écran montre « paiement en cours de confirmation » et se rafraîchit tout seul (`router.refresh()`, donc `get_order_by_token` — même jeton, même garde), **borné à 1 minute** et suspendu si l'onglet n'est pas visible. ⚠️ `GET /api/payments/[orderId]/status` n'est **pas** utilisée : elle lit `orders` en `service_role` sur la seule possession de l'`order_id`, l'autre modèle d'autorisation (§3 décision ②). Elle reste donc sans appelant — la supprimer ou la garder par jeton est un point ouvert (§10) |
| Retour `pending` (revue anti-fraude, quelques minutes) | Même écran d'attente, plus la mention explicite des 30 minutes. Devenu rare par la décision ③ |
| Retour `failure` / `rejected` | Réservation conservée, « Reintentar pago » (invariant 5) |
| Le client ferme l'onglet avant de revenir de Mercado Pago | Rien n'est perdu : le webhook confirme la commande de son côté, et l'email porte le lien |
| Le client rouvre le lien 3 mois plus tard | L'écran s'affiche avec l'état courant des lignes (réalisée / annulée / expirée) |
| Le client rouvre le lien depuis un **autre appareil où il a déjà un panier** | L'écran s'affiche normalement (lecture par jeton). ⚠️ « Reintentar pago » y échoue en `order_not_found` : `create_payment_intent` refuse une session anonyme **différente** du propriétaire. Sans conséquence pratique — la commande expire de toute façon en 30 minutes, donc un paiement se relance depuis l'appareil d'origine ou pas du tout. Documenté, pas corrigé (§10) |
| La commande a expiré (30 min) avant le retour | L'écran le dit, sans proposer de payer (`nothing_to_pay` serait la réponse de la RPC de toute façon) |
| Un invité crée un compte avec un email **différent** de celui de sa commande | Rien n'est rattaché, et c'est correct : la règle est « par adresse email » (cahier §2b.9) |
| Deux commandes portent le même `holder_email` | Les deux sont rattachées — « plusieurs commandes sur le même mail » est une décision explicite (spec 31 ⑤) |
| Le compte technique `reserva-manual@hifago.local` | Exclu nommément du rattachement ; son adresse est non routable, donc non vérifiable de toute façon |
| Rattachement réussi → l'ancienne identité anonyme n'a plus de commande | Elle redevient purgeable à 30 jours (spec 31 invariant 10). Voulu |
| Le client avait encore un panier sur son identité anonyme | `cart_items` **n'est pas** rattaché — hors périmètre (§10) |

### Fichiers touchés

**Créés** — `app/[locale]/(vitrine)/reserva/[token]/page.tsx` · `app/[locale]/(vitrine)/reserva/[token]/OrderResult.tsx`
(+ test + story) · `lib/orders/getOrderByToken.ts` · `messages/{es,en}/OrderResultPage.json` ·
`e2e/payment-return.spec.ts` · `supabase/migrations/<ts>_orders_reference_et_access_token.sql` ·
`supabase/migrations/<ts>_get_order_by_token.sql` ·
`supabase/migrations/<ts>_attach_orders_to_account.sql` ·
`supabase/tests/database/get_order_by_token.test.sql` ·
`supabase/tests/database/attach_orders_to_account.test.sql`.

**Modifiés** — `app/robots.ts` (Disallow `/es/reserva/`, `/en/reserva/`) ·
`app/api/payments/create/route.ts` (back_urls + lecture du jeton) ·
`lib/mercadopago/client.ts` (`excluded_payment_types`) ·
`app/[locale]/(tunnel)/pago/CheckoutForm.tsx` (perd `pendingOrderId`/`paymentError`/`isPaying`,
redirige) · `app/[locale]/(tunnel)/pago/page.tsx` (`isAuthenticated` tient compte de
`is_anonymous`) · `app/[locale]/(vitrine)/CoquillaVitrine.tsx` (idem) ·
`app/auth/callback/route.ts` (appel du rattachement) ·
`packages/e2e-support/src/payments.ts` (le mock redirige vers le **vrai** retour) ·
`supabase/tests/database/security_definer_exposure.test.sql` (exception nommée) ·
`supabase/migrations/<ts>_notify_payment_confirmed_v2.sql` (numéro + lien dans l'email client) ·
`packages/supabase/src/database.types.ts` (régénéré) ·
`docs/01-cahier-des-charges-client.md` (« Écarts connus » : la contrainte (a) est périmée).

---

## 1. Contexte et problème

### Le trou, et pourquoi il a grandi sans que personne ne le voie

La spec 19 a assumé un repli, par écrit : « page de retour dédiée toujours absente — `back_urls`
pointe vers l'écran checkout existant (suffisant pour ce périmètre) ». C'était vrai. Le client
revenait de Mercado Pago sur `/es/pago`, où `CheckoutForm` gardait son panier en mémoire React et
affichait au moins **quelque chose**.

**La spec 32 a rendu cette phrase fausse le 2026-09-10**, sans que rien ne la relise. `create_order`
vide désormais `cart_items` **dans sa propre transaction**
(`20260910160000_create_order_lit_panier_et_attribution.sql:468`), avant même que `startPayment`
ne redirige. Au retour de paiement : nouveau chargement, `pendingOrderId` (un `useState`) perdu,
`getCartLines()` rend `[]`, et `pago/page.tsx:60` ne rend `<CheckoutForm>` **que si**
`lines.length > 0`. Le client voit donc le `<h1>` « Pago » et le `data-testid="empty-cart"` de
`CartSummary`. **Rien d'autre** : aucun numéro, aucune confirmation, aucun message d'échec. La page
ne destructure même pas `searchParams` — `payment_id`, `status` et `collection_status`, que Mercado
Pago pose sur l'URL de retour, sont jetés.

⚠️ **Ce n'est donc pas une dette neuve, c'est une dette qui a changé de nature** :
`docs/dette-technique.md:26` et le journal du 2026-08-18 la décrivent comme « réutilise l'écran
checkout ». Le repli assumé est passé, en une journée, d'« écran de checkout » à **page blanche** —
et personne ne l'a mesuré parce que la spec 32 n'avait aucune raison de relire la spec 19.

### Pourquoi rien ne l'a attrapé

`packages/e2e-support/src/payments.ts:18` fait rediriger le mock vers `${origin}/es?mp_mock_redirect=1`
— **l'accueil**, jamais `/es/pago`. Onze specs e2e traversent le checkout, **aucune** ne traverse
le vrai retour de paiement. C'est l'angle mort structurel, et il se corrige dans le même lot
(`CLAUDE.md` §11.20 : une règle que rien ne vérifie est un souhait).

⚠️ Et il ne peut **pas** se corriger à la main sur cette machine : `MERCADOPAGO_WEBHOOK_SECRET` est
absent et aucun identifiant sandbox n'est configuré, donc `startPayment` échoue en « Mercado Pago
indisponible » avant toute redirection. **Le filet de cette spec est un e2e qui simule le retour,
jamais un parcours manuel** — c'est exactement le segment que la machine locale ne peut pas exercer,
et la raison pour laquelle ce trou a survécu.

> **Périmé le 2026-09-20** : `MERCADOPAGO_WEBHOOK_SECRET` est configuré en préprod et le premier
> paiement réel a été confirmé de bout en bout (piège 19). Le e2e simulé reste le filet local.

### Ce qui part quand même, et ce qui ne part pas

Sur un paiement **approuvé**, l'email `client_order_confirmed` part bien
(`20260824120000_notify_payment_confirmed.sql:113-131`), avec le détail des lignes — mais **sans
numéro de commande et sans lien**. Le code le dit lui-même : « lien vers `/orders/[id]/status` non
ajouté en v1, **à confirmer par Jérôme** ». Sur `pending` et sur `failure` : ni email, ni écran, ni
message.

### Une prémisse du cahier était périmée — vérifiée, pas supposée

Le cahier §2b.9 renvoie à cette spec deux contraintes « vérifiées le 2026-09-07 ». **La première ne
tient plus.** Elle dit que la policy `orders_select` « exclut l'invité de toute lecture ». Or
`orders_select` vaut `is_admin() or account_id = (select auth.uid())`, et depuis la spec 31 —
livrée trois jours **après** cette phrase — `orders.account_id` est `NOT NULL` et porte l'identité
anonyme du visiteur. `(cuenta)/cuenta/reservas/page.tsx:25-30` l'écrit déjà noir sur blanc.

Un invité **peut** donc lire sa propre commande, sur son propre appareil. Ça ne change pas la
décision — un jeton reste indispensable — mais ça en change la **raison** : il ne sert plus à
contourner une policy qui exclut l'invité, il sert à rouvrir le lien **depuis l'email, des mois plus
tard, sur un autre appareil, ou après purge de la session**. C'est cette raison-là que la spec écrit,
et c'est elle qui justifie que le jeton n'expire jamais.

La seconde contrainte, elle, tient : `robots.ts` ne bloque aujourd'hui que `/{locale}/r/`, `/auth/`
et `/api/`, et cette adresse porte des données personnelles.

### Deux défauts voisins, trouvés en mesurant celui-là

**La locale forcée** — `api/payments/create/route.ts:61` construit `${origin}/es/pago`. Un anglophone
paie et revient en espagnol, et **toute la suite de sa session** bascule, parce qu'un chemin préfixé
fait réécrire le cookie `NEXT_LOCALE`. Le report est documenté dans le commentaire l. 46-49 : « le
locale du panier n'est pas conservé sur `orders`/`payments` ». Le §0 montre qu'aucune colonne n'est
nécessaire — c'est le `/es` en dur qui neutralisait un repli déjà en place.

**L'entrée « Iniciar sesión » disparue** — `CoquillaVitrine.tsx:27` pose
`isAuthenticated = Boolean(data.user)`. Depuis la spec 31, `CartContext` appelle
`signInAnonymously()` au premier ajout au panier, et `getUser()` rend un user pour une session
anonyme. `SiteMenu.tsx:108` bascule alors sur « Mi cuenta ». Or `SiteMenu.tsx:43` est le **seul**
lien vers `/entrar` de tout le chrome de la vitrine (`SiteFooter` n'en a aucun), et le seul autre du
site est `CheckoutForm.tsx:362-370`, gardé par le **même** calcul. **L'entrée de connexion disparaît
donc du site entier dès le premier ajout au panier**, et `is_anonymous` n'est consulté nulle part
dans `apps/web` — seule la fonction SQL `is_anonymous_session()` existe. Ce défaut est directement
sur le chemin de cette spec : un écran qui propose de créer un compte suppose qu'on puisse encore
se connecter.

---

## 2. Portée et tranches

| Tranche | Contenu | Pourquoi dans cet ordre |
|---|---|---|
| **1** | Migration `reference` + `access_token` + backfill ; RPC `get_order_by_token` ; ses tests pgTAP ; exception nommée dans `security_definer_exposure` | Rien ne peut être affiché tant que l'adresse n'existe pas. **À relire en manual edit** : décide qui lit les données personnelles d'une commande |
| **2** | L'écran `/reserva/[token]` ; `robots.ts` ; les `back_urls` ; l'exclusion des moyens hors ligne ; `CheckoutForm` simplifié ; `is_anonymous` dans les deux calculs d'`isAuthenticated` ; **le mock e2e corrigé + `payment-return.spec.ts`** | Le cœur du lot. L'e2e est le seul filet possible ici (§1) |
| **3** | RPC `attach_orders_to_account` ; appel dans `/auth/callback` ; bouton « Crear una cuenta » sur l'écran ; tests pgTAP | **À relire en manual edit** : décide qui peut s'approprier une commande |
| **4** | L'email `client_order_confirmed` porte le numéro et le lien | Dépend de la Tranche 1 pour les deux valeurs |

### Hors périmètre, et pourquoi

- **Le panier non restauré après un refus PMS** (`CheckoutForm.tsx:253-259`) — déjà signalée dans le
  code, au journal du 2026-09-10 et au backlog. La corriger proprement voudrait dire faire recréer
  des lignes `cart_items` par `release_order_after_pms_refusal`, dont ce n'est pas le rôle : une RPC
  critique à rouvrir, donc un lot à elle seule (décision ④).
- **Le voucher / e-ticket** (QR, PDF) — point ouvert du cahier §2f, et la spec 19 §10 point 8 en fait
  un « nouveau gabarit à concevoir ». Cet écran n'en est pas un.
- **L'internationalisation des emails** — `client_order_confirmed` est en espagnol en dur. La
  Tranche 4 y ajoute un numéro et un lien, elle ne traduit rien : ce serait un lot de la spec 23.
- **Le rattachement du panier** — seules les commandes sont rattachées. `cart_items` reste sur
  l'identité anonyme (§10).
- **L'exploit des oracles de lecture** (`is_admin('<uuid>')` sous le rôle `anon`) — ouvert au backlog
  le 2026-09-10, **en attente d'arbitrage**. Cette spec ne le corrige pas et **ne s'appuie pas
  dessus** : aucune de ses deux RPC n'appelle `is_admin`.

---

## 3. Décisions retenues (entretien du 2026-09-10)

| # | Décision | Ce qui a été écarté, et pourquoi |
|---|---|---|
| ① | **Numéro court lisible** `HFG-000042`, colonne `orders.reference` | L'UUID brut (ce que l'écran affiche aujourd'hui) : 36 caractères que personne ne dicte ni ne retient, et qui deviendrait la clé d'accès si l'URL l'utilisait. Le préfixe court de l'UUID : unicité non garantie, et « f » vs « e » indistinguables à l'oral |
| ② | **Jeton distinct** `orders.access_token`, URL `/reserva/<jeton>` | L'`order_id` comme secret — c'est pourtant le modèle déjà assumé par `create_payment_intent` (« la possession de `p_order_id`, uuid à haute entropie, fait foi »). Écarté parce qu'il fusionne l'identifiant et le secret : impossible de montrer le numéro sans donner l'accès |
| ③ | **Retirer les moyens hors ligne** de Checkout Pro (`ticket`, `atm`) | Garder Efecty/Baloto avec un écran honnête ; allonger la fenêtre d'expiration. Cf. l'encadré ci-dessous — c'est le seul arbitrage de cette spec qui soit commercial, et il est de Jérôme |
| ④ | **Le refus PMS reste hors périmètre** | Le ramasser ici : rouvrirait `release_order_after_pms_refusal` et mélangerait deux récits |
| ⑤ | **La RPC de rattachement est dans ce lot** | La renvoyer au lot suivant : le bouton « Crear una cuenta » mentirait, cf. l'encadré ci-dessous |
| ⑥ | **Une identité anonyme n'est pas « connectée »** dans l'interface — `user.is_anonymous` | Garder « Mi cuenta » et ajouter la connexion au pied de page (le tunnel n'en a pas, la connexion resterait introuvable sur `/carrito` et `/pago`) ; afficher deux entrées (exigerait de savoir si l'anonyme a commandé : une requête Supabase de plus sur **chaque** page de la vitrine, exactement ce que `CoquillaVitrine` évite pour la cacheabilité, spec 27 §8) |
| ⑦ | **L'écran vit en zone vitrine**, tunnel refermé | La zone tunnel : conçue pour un client **en train de payer**, elle n'a ni menu ni pied de page — un client qui rouvre son lien des mois plus tard y atterrirait dans un cul-de-sac |

### L'encadré ③ — pourquoi l'espèces sort du tunnel

Mesuré pendant l'entretien, pas supposé : `expire_stale_payment_orders` annule **toute** commande
`payment_status in ('unpaid','pending')` de plus de **30 minutes**
(`20260824010000_expire_stale_payment_orders_exempt_manual.sql:30-31`). Or en Colombie, Mercado Pago
rend `pending` précisément pour les paiements en espèces (Efecty, Baloto) : un bon à payer en point
de vente **sous 1 à 3 jours**. Un client qui choisit ce moyen voit donc sa réservation annulée avant
d'avoir pu payer, et rien ne le lui dit.

**Allonger la fenêtre a été écarté d'emblée** : immobiliser des places trois jours aggraverait le
*Trou (a)* du backlog — rien ne libère un cupo quand une commande expire, seul `cancel_order` le
fait — qui est lui-même en attente d'arbitrage. On ne construit pas sur un trou ouvert.

Reste donc le choix entre un écran honnête sur une impasse, et supprimer l'impasse. Jérôme a tranché :
**supprimer l'impasse**. Conséquence assumée : un client sans carte ni PSE ne peut plus réserver.

### L'encadré ⑤ — pourquoi le rattachement ne peut pas être gratuit

L'hypothèse commode aurait été : le client crée son compte depuis sa session anonyme, Supabase lie
l'email à l'identité existante, `account_id` ne bouge pas, la commande suit toute seule.

**Elle est fausse, et deux vérifications indépendantes le montrent.** La spec 31 **invariant 7**
l'interdit explicitement — « aucun `updateUser({email})`, aucun `linkIdentity` » — et son
« Hors périmètre » l'écrit : « un invité qui crée un compte plus tard ne récupère pas ses commandes,
conséquence assumée, **à rouvrir si le besoin se manifeste** ». Et le code du SDK le confirme :
`_updateUser` transmet `jwt: session.access_token` (c'est ce qui convertirait une identité), tandis
que **`signUp` n'en transmet aucun** (`@supabase/auth-js`, `GoTrueClient.js:715-740` vs `2838-2860`,
lu le 2026-09-10) — il crée donc un utilisateur **neuf**.

Le besoin se manifeste ici, exactement. La RPC est le seul mécanisme possible, et le cahier §2f le
disait déjà : « la règle est tranchée, le mécanisme n'existe pas, périmètre à part entière ».

---

## 4. Parcours cible

1. Le client valide ses coordonnées sur `/pago`. `create_order` réussit → `order_id`.
2. `POST /api/pms/reserve-nights` accepte (inchangé — **Lobby d'abord**, spec 21 §8).
3. `CheckoutForm` lit `orders.access_token` en RLS directe, puis **redirige** vers
   `/[locale]/reserva/<jeton>`. Le tunnel est fermé ; `/pago` ne rendra plus jamais de succès.
4. L'écran affiche le numéro, le récapitulatif, les totaux — et, la commande n'étant pas payée,
   déclenche le paiement : `create_payment_intent` → `POST /api/payments/create` → redirection vers
   Checkout Pro.
5. Le client paie. Mercado Pago le renvoie sur `${origin}/reserva/<jeton>` — **sans préfixe** : le
   proxy le redirige vers sa propre langue.
6. L'écran relit la commande. Selon `payment_status` : confirmé, en attente de confirmation
   (interrogation de `GET /api/payments/[orderId]/status`), ou échoué avec « Reintentar pago ».
7. L'email de confirmation arrive, portant le **numéro** et le **lien** — le canal de suivi d'un
   client sans compte (cahier §2b.9 ; le WhatsApp pré-rempli a été retiré le 2026-09-07).
8. S'il le souhaite, le client crée un compte depuis cet écran. Après vérification de son email,
   `attach_orders_to_account` rattache **toutes** ses commandes portant cette adresse, et
   `/cuenta/reservas` les montre.

---

## 5. Les écrans, bloc par bloc

### `/[locale]/reserva/[token]`

```
(vitrine)/layout.tsx              CoquillaVitrine → SiteHeader · SiteFooter   (spec 27)
│
└─ reserva/[token]/page.tsx                       Server Component, dynamique
   ├─ getOrderByToken(token, locale)              LA seule requête — RPC get_order_by_token
   ├─ notFound() si !ok                           404, jamais un message qui distingue les cas
   ├─ generateMetadata                            titre seulement — PAS de robots noindex (cf. ci-dessous)
   └─ PageShell variant="normal"                  pose l'unique <main>
      ├─ <h1> VISIBLE                             « Reserva HFG-000042 »
      └─ OrderResult                              "use client" — porte l'état de paiement
         ├─ bandeau d'état                        confirmé / en attente / échoué / expiré / annulé
         ├─ récapitulatif des lignes              même forme que CartSummary, jamais le même composant
         ├─ totaux                                total, acompte payé en ligne, reste à régler sur place
         ├─ [ Reintentar pago ]                   si non payé et payable
         ├─ [ Crear una cuenta ]                  si le visiteur n'est pas un compte réel (Tranche 3)
         └─ coordonnées du client                 nom · téléphone · email (tradeoff assumé, cahier §2b.9)
```

⚠️ **`OrderResult` n'est pas `CartSummary`.** La tentation de réutiliser est réelle — mêmes lignes,
même mise en forme — mais les deux divergent sur le fond : `CartSummary` lit `products.price_cop`
**vivant** et sait retirer une ligne, `OrderResult` lit `order_lines.total_cop`/`acompte_cop`
**figés au moment de la commande** et porte un statut par ligne. Les fusionner ferait afficher un
prix courant sur une commande passée — exactement ce que la spec 32 invariant 3 sépare.

### `robots.ts` — Disallow **seul**, jamais avec un `noindex`

`.claude/rules/seo.md` règle 5 : « `Disallow` empêche le crawl, `noindex` l'indexation — **jamais
les deux sur la même page** ». Ici c'est le **crawl** qu'on veut empêcher : un crawler ne doit jamais
**charger** une page qui porte le nom, le téléphone et l'email d'un client. Un `noindex` exigerait
au contraire qu'il la charge pour lire la balise. Donc `/es/reserva/`, `/en/reserva/` rejoignent
`DISALLOW`, et `generateMetadata` **ne pose pas** `robots: { index: false }` — contrairement à
`/pago` et `/carrito`, qui font l'inverse et ont raison de le faire (rien de personnel n'y est
rendu avant hydratation).

### `CheckoutForm.tsx` — ce qui disparaît

Tout le bloc `if (pendingOrderId)` (l. 271-310) et les trois états qui le pilotent
(`pendingOrderId`, `paymentError`, `isPaying`), plus `startPayment` **entière** : elle déménage dans
`OrderResult`. Le formulaire redevient ce qu'il dit être — des coordonnées et un bouton — et se
termine par une redirection.

Le lien « Iniciar sesión » (l. 362-370) reste, mais sa condition change avec la décision ⑥.

---

## 10. Décisions tranchées / points ouverts

- **Le numéro révèle le volume de commandes.** `HFG-000042` est séquentiel : un concurrent qui passe
  deux commandes à un mois d'intervalle en déduit le volume. Accepté sciemment — la lisibilité et
  l'absence de collision valent plus que cette information, et le numéro n'étant **pas** le secret
  (invariant 1), sa prédictibilité n'a aucune conséquence de sécurité. Une alternative existe si
  Jérôme change d'avis : 8 caractères en base32 sans caractères ambigus, au prix de la dictée.
- **Qui détient le lien voit le nom, le téléphone et l'email du client.** Tradeoff **déjà** assumé
  par écrit au cahier §2b.9, répété ici pour qu'il ne se perde pas : il est la contrepartie d'une
  adresse sans limite de temps, ouvrable sans compte.
- **« Reintentar pago » échoue depuis un appareil portant une autre session anonyme.**
  `create_payment_intent` refuse quand `auth.uid()` est non nul et distinct du propriétaire. Sans
  conséquence pratique (la commande expire en 30 minutes), donc **non corrigé** : élargir une RPC de
  paiement mérite mieux qu'un effet de bord.
- **Le panier n'est pas rattaché au compte.** `attach_orders_to_account` ne touche que
  `orders`/`order_lines` ; `cart_items` reste sur l'identité anonyme, qui sera purgée à 30 jours avec
  son contenu. Sans effet ici (le panier est vide après une commande réussie), à rouvrir si le
  rattachement devient accessible ailleurs que depuis l'écran de résultat.
- **Un tiers qui connaît l'email d'un client et le vérifie chez lui récupérerait ses commandes.**
  Impossible sans accès à la boîte du client — c'est précisément ce que la garde
  `email_confirmed_at` verrouille. Conséquence inhérente à la règle « rattachement par adresse
  email », tranchée au cahier §2b.9, pas une faiblesse de cette implémentation.
- **Point ouvert : que devient une URL `/reserva/<jeton>` en Disallow si elle fuit ?** Un moteur peut
  indexer une URL sans la crawler, si un lien externe la désigne. Le vrai rempart reste que l'URL ne
  soit jamais publiée. Aucune contre-mesure supplémentaire n'est prise ici — la signaler suffit.
- **Point ouvert : `GET /api/payments/[orderId]/status` n'a (toujours) aucun appelant.** Construite
  « prête mais non branchée » par la spec 19, elle l'est restée : cet écran s'en passe délibérément
  (deux modèles d'autorisation sur un même écran, cf. §10bis point 4). La supprimer serait le geste
  propre ; la garder par jeton plutôt que par `order_id` la rendrait utilisable. Hors périmètre —
  elle appartient à la spec 19.
- **Point ouvert : le rattachement n'a pas de rattrapage.** `attach_orders_to_account` est appelée
  depuis `/auth/callback`, que `signInWithPassword` ne traverse jamais — un échec réseau n'est donc
  jamais rejoué, et un client déjà titulaire d'un compte avant de commander en invité ne verra rien
  se rattacher. La RPC est idempotente et supporterait d'être appelée à chaque session réelle
  (garde `(cuenta)`, ou `onAuthStateChange`) : l'accrocher à l'invariant plutôt qu'à l'événement est
  le geste plus profond, non fait faute d'arbitrage — le cahier §2b.9 ne vise que le compte créé
  DEPUIS l'écran de résultat, qui passe bien par le callback.
- **Point ouvert, hérité : `pending` reste possible** (revue anti-fraude). Rare et court après la
  décision ③, mais pas impossible — d'où le bandeau d'attente, qui reste nécessaire.
- **Non lié, trouvé le même jour** : `docs/dette-technique.md` porte encore « **cliquer le fil
  d'Ariane vide le panier**, tenu en mémoire ». C'est **périmé depuis la spec 32** — le panier vit en
  base, une navigation complète ne le perd plus. La ligne mérite d'être requalifiée (le défaut
  restant, `Migas` qui rend des `<a href>` natifs et provoque une navigation complète, est réel mais
  n'a plus cette conséquence-là). Pas corrigé ici.

---

## 10bis. Ce que l'implémentation a corrigé de la spec

Trois écarts entre le texte et le code livré. Aucun ne renverse une décision ; deux ajoutent une
garde que la rédaction n'avait pas vue.

1. **Garde « propriétaire anonyme » sur le rattachement — ajoutée, arbitrée par Jérôme le
   2026-09-10.** La spec disait « rattache les commandes portant l'email vérifié du compte ». Un
   scénario trouvé en écrivant la RPC : un compte RÉEL A commande en saisissant l'email de son ami B
   (`holder_email` est un champ libre du checkout, rien ne l'interdit) ; le jour où B s'inscrit, un
   rattachement par email seul lui donnerait la commande de A, **qui la perdrait**. La RPC ne
   rattache donc que des commandes appartenant encore à une identité **anonyme** — le sens littéral
   du cahier, « une commande passée *en invité* ». Effet de bord utile : le compte technique des
   réservations comptoir (spec 31 invariant 8) en est exclu par construction, sans clause dédiée.
2. **`revoke ... from public, anon, authenticated` — les trois, pas seulement `public`.** La
   première version ne révoquait que `public`, et le test pgTAP a montré qu'`anon` gardait `EXECUTE`.
   Deux sources cumulées, pas une : PostgreSQL accorde `EXECUTE` à `PUBLIC` sur toute fonction neuve,
   **et** ce projet porte un `alter default privileges … grant … to anon, authenticated, service_role`
   (`20260813163456`) qui accorde **nommément** à `anon` — qu'un revoke sur `public` ne retire pas.
   C'est la forme exacte que prescrit `.claude/rules/supabase.md`, et la démonstration de pourquoi
   elle la prescrit. Le test a fait son travail avant la revue.
3. **Le lien de l'email vient du Vault — et la première version inventait un mécanisme pour rien.**
   L'implémentation avait posé un jeton de gabarit `{{SITE_URL}}` résolu à l'envoi par l'Edge
   Function, en justifiant que « Postgres ne connaît pas l'URL publique du site, et rien dans le
   dépôt ne la connaissait côté base ». **C'était faux** : `20260824040000` lit déjà
   `vault.decrypted_secrets → admin_app_public_url` pour le lien de l'email d'invitation partenaire,
   avec exactement la même justification (« seedée par environnement, jamais une valeur en dur »),
   et `pms_functions_base_url` fait de même pour les crons. Corrigé le 2026-09-10 (`/simplify`) :
   un seul patron, `web_app_public_url`. ⚠️ **Différence assumée avec l'invitation** : là-bas un
   secret manquant fait *sauter* l'email (le lien reste affiché à l'écran) ; ici le client a payé et
   n'a plus l'écran — la confirmation part donc toujours, avec le lien si le secret existe, sans lui
   sinon. **À poser en préprod et en prod.**

4. **Corrections de `/simplify` (2026-09-10), quatre agents de revue en parallèle.** Au-delà du
   point 3 ci-dessus : le prédicat « compte réel » existait en **trois** copies TypeScript se citant
   l'une l'autre — il vit désormais dans `@hifago/supabase/identity`, seul module importé par le
   client, le serveur et les deux apps. `OrderResult` était dans `components/organisms/` alors qu'il
   ne sert qu'une route (`components/README.md` prescrit la colocalisation ; `CartSummary` y est
   légitimement, servant deux routes). Le sondage d'attente du webhook tournait **sans plafond** :
   ~600 requêtes pour un paiement abandonné, désormais borné à 1 minute et suspendu sur un onglet
   invisible. Et il sondait `GET /api/payments/[orderId]/status`, qui lit `orders` en `service_role`
   sur la seule possession de l'`order_id` — soit le modèle d'autorisation que le §3 décision ②
   écarte : l'écran se rafraîchit maintenant par `router.refresh()`, qui repasse par le jeton.
   `robots.ts` dérive ses chemins de `routing.locales` (une 3ᵉ locale exposerait sinon
   `/pt/reserva/<jeton>`), et `orders.holder_email` reçoit l'index fonctionnel sans lequel chaque
   confirmation d'email balayait la table.

### Une découverte au passage, qui resserre la surface d'attaque

`auth.users` porte une contrainte d'unicité sur l'email (`users_email_partial_key`) : deux comptes
ne peuvent **jamais** porter la même adresse. L'usurpation d'adresse n'est donc possible que tant que
la victime n'a pas encore de compte — exactement le cas d'un invité, et exactement ce que la garde
« email confirmé » ferme. Trouvé en écrivant le test, qui a d'abord échoué sur cette contrainte.

### Vérifié en réel, pas seulement au typecheck

- **26 tests pgTAP** sur `get_order_by_token` (dont l'ouverture **sans aucune session**, une session
  anonyme étrangère, et les quatre entrées invalides qui rendent toutes la même réponse) et **17**
  sur `attach_orders_to_account` (chaque garde testée **par le cas qui la viole**, pre-account
  takeover compris).
- **5 e2e** (`payment-return.spec.ts`) traversant le vrai retour — dont « l'adresse survit à un
  rechargement », le test de non-régression du lot.
- **6 tests unitaires** sur le Route Handler, **vérifiés par mutation** : remettre `${origin}/es/pago`
  en fait rougir 4 sur 6. C'est le seul endroit d'où la `back_url` est observable (elle part dans la
  préférence Mercado Pago, jamais dans l'`init_point`) — donc le seul endroit où ce trou pouvait être
  verrouillé.
- Les **292 assertions pgTAP** existantes des 11 fichiers qui écrivent dans `orders` restent vertes
  après l'ajout de deux colonnes `NOT NULL`, et le grant de `apply_payment_webhook` reste
  `service_role` seul après sa réécriture (vérifié par `has_function_privilege`).

---

## 11. Annexe — traçabilité code→règle

| Section | Fichiers sources |
|---|---|
| §0 Locale | `node_modules/next-intl/.../middleware/resolveLocale.js` (ordre de résolution), `.../middleware/syncCookie.js` (réécriture du cookie), `.../routing/config.js` (défauts `localeDetection`/`localeCookie`), `apps/web/i18n/routing.ts` (aucune surcharge), `apps/web/proxy.ts:66-68` (matcher) |
| §0 Modèle de données | `packages/supabase/src/database.types.ts` (`orders` actuelle), `supabase/migrations/20260821020000_enable_pgcrypto_extension.sql` (pgcrypto dans `extensions`) |
| §0 `create_order` non touchée | `supabase/migrations/20260813194515_availability_orders_core_tables.sql:44-49` (`orders_select`), `docs/specs/31-identite-anonyme.md` (invariant 6, `account_id` NOT NULL) |
| §0 RPC — contraintes | `supabase/tests/database/security_definer_exposure.test.sql:34-104` (cas 1 et cas 2, et `check_partner_invitation` comme précédent) |
| §0 Rattachement | `supabase/migrations/20260813194515_...sql:54-56` (`order_lines.account_id` dénormalisé), `docs/specs/31-identite-anonyme.md:125` (invariant 7), `apps/web/app/auth/callback/route.ts:40-50` |
| §0 Mercado Pago | `apps/web/app/api/payments/create/route.ts:45-71`, `apps/web/lib/mercadopago/client.ts:55-75` |
| §1 Le trou | `supabase/migrations/20260910160000_create_order_lit_panier_et_attribution.sql:468`, `apps/web/app/[locale]/(tunnel)/pago/page.tsx:60`, `packages/e2e-support/src/payments.ts:18` |
| §1 Email | `supabase/migrations/20260824120000_notify_payment_confirmed.sql:112-131` |
| §1 Prémisse périmée | `docs/01-cahier-des-charges-client.md` §2b.9, `apps/web/app/[locale]/(cuenta)/cuenta/reservas/page.tsx:25-30` |
| §1 Connexion disparue | `apps/web/components/organisms/CoquillaVitrine.tsx:27`, `SiteMenu.tsx:43,108`, `CheckoutForm.tsx:362-370` |
| §3 Encadré ③ | `supabase/migrations/20260824010000_expire_stale_payment_orders_exempt_manual.sql:30-31`, `docs/backlog.md` (Trou (a)) |
| §3 Encadré ⑤ | `node_modules/@supabase/auth-js/dist/module/GoTrueClient.js:715-740` (`signUp`) vs `:2838-2860` (`_updateUser`) |
| §5 robots | `.claude/rules/seo.md` règle 5, `apps/web/app/robots.ts:22` |
| §5 `OrderResult` ≠ `CartSummary` | `apps/web/components/organisms/CartSummary.tsx`, `docs/specs/32-panier-en-base.md` §0 invariant 3 |

---

## 12. Documents liés

- `docs/01-cahier-des-charges-client.md` §2b.8-9 — la décision que cette spec applique ; §2f, le
  rattachement qu'elle referme.
- `docs/specs/19-paiement-mercadopago-acompte-ledger.md` — la spec qui a assumé le repli que
  celle-ci remplace ; `GET /api/payments/[orderId]/status` y est construite « prête mais non
  branchée ».
- `docs/specs/31-identite-anonyme.md` — invariants 6 et 7 : pourquoi le rattachement doit être une
  RPC, et pourquoi `orders_select` couvre désormais l'invité.
- `docs/specs/32-panier-en-base.md` — la spec qui a transformé ce trou en page blanche.
- `docs/specs/23-notifications-email-transactionnelles.md` — l'email dont la Tranche 4 change le
  contenu.

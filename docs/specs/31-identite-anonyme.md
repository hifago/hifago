---
id: specs-identite-anonyme
titre: "Identité anonyme de l'invité"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: partiel
reste: >
  Les 4 tranches sont livrées (2026-09-10). Reste le point de vérification de la Tranche 4 : la
  purge `DELETE FROM auth.users` en SQL pur (pg_cron) jamais testée sur Supabase Cloud. La promotion
  en `implemente` attend l'arbitrage de Jérôme (spec 32 §10, `docs/backlog.md`).
maj: 2026-09-10
resume: >
  Donne une identité Supabase à tout visiteur qui ajoute au panier, pour que sa commande, son
  panier et son attribution référent lui appartiennent vraiment. Rend orders.account_id
  obligatoire — ce qui referme au passage une fuite de PII encore ouverte — et pose la règle du
  refus par défaut pour les RPC face à un anonyme.
mots_cles: [identite anonyme, session anonyme, invite, account_id, attribution, liste blanche, purge]
repond_a:
  - "À quel moment un visiteur reçoit-il une identité, et laquelle ?"
  - "Qu'est-ce qu'un visiteur anonyme a le droit d'appeler ?"
  - "Qui possède une commande passée sans compte ?"
---

# Identité anonyme de l'invité

> **Cible stack** : hifago. Spec **bloquante** : le panier en base, puis le tunnel, puis les deux
> derniers écrans hérités en dépendent (décidé le 2026-09-07, `docs/journal/2026-09.md`).

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 0 | **Contrat compact** (prérequis, données, RPC, invariants, cas limites — pour coder) | brouillon |
| 1 | Contexte et problème | brouillon |
| 2 | Portée et tranches | brouillon |
| 3 | Décisions retenues (entretien des 2026-09-09 et 10) | brouillon |
| 4 | Parcours cible | brouillon |
| 5 | Écrans | brouillon |
| 10 | Points ouverts | brouillon |
| 11 | Annexe — traçabilité code→règle | brouillon |

---

## 0. Contrat compact (pour coder — lire seul, sans le reste)

### Ce que ça change, en une phrase

Aujourd'hui un invité n'a **aucune** identité : sa commande a `account_id` nul, donc personne ne
peut la relire, ni l'annuler, et n'importe qui connaissant son numéro peut créer un paiement
dessus. Demain, tout visiteur qui ajoute au panier reçoit une identité Supabase anonyme — « un
compte, juste sans mot de passe » — et cette identité possède sa commande.

### Prérequis de configuration (rien ne marche sans ça)

`supabase/config.toml` porte aujourd'hui `enable_anonymous_sign_ins = false` (l. 229). **C'est le
prérequis n°0** : tant qu'il vaut `false`, `signInAnonymously()` échoue et toute la spec est
inerte. `anonymous_users = 30` (l. 254) plafonne déjà les créations par IP et par heure — valeur
par défaut conservée, à surveiller le jour de la bascule.

⚠️ Le même réglage doit être posé sur le projet Supabase de préprod, qui n'est pas piloté par ce
fichier.

### Modèle de données (delta)

| Table | Changement | Pourquoi |
|---|---|---|
| `orders.account_id` | `null` → **NOT NULL** | Décision ⑤. Referme la dernière fuite de `create_payment_intent` (cf. invariant 6). |
| `order_lines.account_id` | **NOT NULL** également | Même raison ; `create_manual_order_line` y écrit `null` en dur aujourd'hui. |
| `carts` (spec suivante) | portera `attribution_code` | Décision ②. Cette spec **n'écrit pas** la table ; elle fige seulement que l'attribution lui appartiendra. |
| Aucune autre | — | Aucune policy RLS d'écriture n'existe sur `orders` (une seule policy, `orders_select`) : rien à modifier de ce côté. |

**⚠️ La migration NOT NULL ne peut pas être un simple `alter column`.** Vérifié : sur la base
locale, `alter table public.orders alter column account_id set not null` échoue aujourd'hui
(`column "account_id" contains null values`) — il reste 1 commande sur 5 sans compte, et
`supabase/seed.sql` en insère une explicitement (l. 326-345). La migration doit traiter les lignes
existantes **avant** l'`ALTER`, dans le même fichier.

**⚠️ Et le backfill ne peut pas fabriquer d'identité lui-même** : `insert into auth.users` est
refusé sur Supabase Cloud (« permission denied for schema auth, restriction plateforme, pas un
grant manquant », constaté le 2026-08-21, `supabase/seed.sql` l. 29-33). Une fonction
`security definer` y parvient **en local** — donc une migration qui compterait dessus passerait
tous les tests et casserait au déploiement. Le compte technique de l'invariant 8 se crée hors
migration, par l'API Admin (`supabase/scripts/seed_auth_users.mjs` est le précédent à suivre).

### Contrat — ce que chaque RPC doit faire

| RPC | Changement |
|---|---|
| `create_order` | Gagne une garde `if auth.uid() is null then return {ok:false, reason:'not_authenticated'}`. Sans elle, `NOT NULL` remonterait au navigateur une erreur Postgres brute (23502) au lieu d'un motif. **Et perd sa persistance d'attribution** (cf. invariant 3). |
| `create_manual_order_line` | Écrit le compte technique au lieu de `null` (invariant 8). |
| `create_payment_intent` | **Inchangée.** Sa garde actuelle devient suffisante d'elle-même dès que `account_id` est NOT NULL (cf. invariant 6). |
| `cancel_order` | **Inchangée.** Elle refuse aujourd'hui toute commande à `account_id` nul (`null is distinct from <uuid>` est vrai) ; NOT NULL rend l'annulation possible pour un anonyme sans toucher une ligne. |
| `consume_partner_invitation` | Déjà faite (migration `20260909200000`). |
| Toute RPC nouvelle | Porte la garde de l'invariant 4. |

### Invariants (numérotés — le code les cite, ne jamais renuméroter)

1. **La session anonyme naît au premier ajout au panier, et à rien d'autre.** Jamais à la simple
   visite, jamais à l'arrivée par `?ref=`, jamais au chargement d'une fiche.
2. **`signInAnonymously()` n'est jamais appelé sans vérifier d'abord qu'aucune session n'existe.**
   Il n'est pas idempotent : il fait un `POST /signup` inconditionnel puis remplace la session
   locale. Appelé naïvement dans `addLine`, il créerait une identité à chaque ajout et
   **déconnecterait un client réellement connecté au premier clic**.
3. **L'attribution n'est jamais portée par l'identité.** Exigence *négative*, et c'est la plus
   fragile de cette spec : `create_order` contient déjà les deux blocs qui la violeraient
   (lecture `saved_attribution_code` → `source='account'`, et écriture de cette même colonne),
   tous deux gardés par le seul `v_account_id is not null`. Aujourd'hui ils ne s'exécutent jamais
   pour un invité, faute d'`auth.uid()`. **Le jour de l'invariant 1, ils s'activent seuls, sans
   qu'une ligne de SQL n'ait bougé.** Les deux blocs doivent donc devenir « compte enregistré
   uniquement » — c'est-à-dire exclure explicitement `is_anonymous_session()` — et un test pgTAP
   doit échouer si la garde disparaît. Le §3c du cahier client (validé le 2026-08-13) l'interdit
   déjà pour un invité : « vaut pour la réservation en cours, jamais une préférence durable ».
4. **Refus par défaut** : une RPC refuse un visiteur anonyme sauf si elle l'autorise nommément.
   Socle en place : `public.is_anonymous_session()` (migration `20260909200000`), qui lit
   `auth.users.is_anonymous` et non le claim JWT — un jeton émis avant une conversion resterait
   marqué anonyme jusqu'à son rafraîchissement.
5. **Liste blanche exhaustive** — les seules RPC qu'un anonyme peut appeler :
   `create_order`, `create_payment_intent`, `cancel_order`, `search_catalog`,
   `search_catalog_tags`, `get_product_slots`, `expand_product_slots`, `client_key_for_order`.
   Toute autre refuse. ⚠️ `update_my_account_profile` **n'y est pas** : elle réussit aujourd'hui
   pour un anonyme, précisément parce que l'invariant ⑦ de la décision ④ lui donne une ligne
   `partner_accounts`. C'est la démonstration que ③ et ④ ne sont pas indépendantes.
6. **Toute commande a un propriétaire.** C'est ce qui referme la fuite laissée délibérément
   ouverte le 2026-09-09 : `create_payment_intent` garde `if v_order_account_id is not null and
   v_order_account_id is distinct from v_account_id` — inopérante tant qu'une commande peut
   n'avoir aucun propriétaire. **La liste blanche seule ne referme pas cette fuite ; seul le NOT
   NULL le fait.** L'ordre des tranches en dépend.
7. **L'email n'est jamais un identifiant.** Aucun `updateUser({email})`, aucun `linkIdentity`.
   L'email reste `orders.holder_email`. Sans quoi Supabase imposerait son unicité et « plusieurs
   commandes sur le même mail » (décision ⑤) deviendrait faux dès le deuxième navigateur.
8. **Une réservation manuelle appartient au compte technique `reserva-manual@hifago.local`**, le
   client réel restant dans `holder_name`/`holder_phone`. Jamais le compte du socio qui la saisit :
   il est le vendeur, pas l'acheteur. ⚠️ Cette adresse est **délibérément celle déjà écrite** par
   `create_manual_order_line` dans `orders.holder_email` : elle figure dans
   `NON_REAL_EMAIL_SENTINELS` (`apps/admin/lib/whatsapp.ts` l. 27-30), donc `isRealClientEmail` la
   filtre déjà et aucun écran ne la présentera comme un contact réel. Choisir une valeur neuve
   aurait exigé une troisième sentinelle, et l'oublier aurait affiché un faux email à un
   prestataire.
9. **La purge ne supprime jamais une identité qui a laissé une trace.** Les 20 FK vers
   `partner_accounts` sont **toutes NO ACTION, zéro CASCADE** : c'est un filet, pas un problème.
10. **Seule une COMMANDE épargne une identité de la purge — un panier ne la protège pas** (tranché
   le 2026-09-10). ⚠️ Coût assumé, à ne pas découvrir plus tard : le panier portant l'attribution
   (invariant 3 / décision ②), un visiteur venu par le QR d'un partenaire qui revient après 30
   jours retrouve un panier vide **et le référent perd sa commission**, sans que ni l'un ni l'autre
   ne l'apprenne. C'est le prix d'une table qui ne se remplit pas de paniers fossiles. Si le
   support voit remonter ce cas, c'est cette ligne qu'il faut rouvrir.

### Cas limites

| Cas | Comportement attendu |
|---|---|
| Un client **connecté** ajoute au panier | Aucune session anonyme créée (invariant 2). Sa commande porte son compte. |
| Le visiteur ajoute, ferme l'onglet, revient | La session vit en cookie et survit ; le panier en mémoire, non (jusqu'à la spec panier). L'identité est donc plus durable que le panier — pas l'inverse. |
| Le visiteur revient après 30 jours sans avoir commandé | Son identité a été purgée : panier vide, attribution perdue. Voulu (invariant 10), et c'est le seul cas où un référent perd une commission sans le savoir. |
| Deux visiteurs, même email au checkout | Autorisé et voulu (décision ⑤). Deux identités, deux commandes, un seul email. |
| Le visiteur crée un vrai compte plus tard | Hors périmètre (cf. §10). Ses commandes ne le suivent pas : c'est le prix assumé de l'invariant 7. |
| `enable_anonymous_sign_ins` reste `false` | `signInAnonymously()` échoue → **l'ajout au panier doit échouer proprement**, jamais laisser un panier orphelin qui produira une commande sans propriétaire. |
| Une identité anonyme a une ligne `audit_log` | Non purgeable, définitivement (`audit_log` est immuable : aucune policy de suppression, même admin). Le job doit l'ignorer, pas s'y casser (cf. invariant 9 et le cas ci-dessous). |
| Une identité est ciblée par une campagne | `comm_campaign_targets_account_id_fkey` est NO ACTION : elle bloque la suppression. Vérifié en réel — une campagne « Todos » verrouille définitivement des visiteurs qu'elle n'aurait jamais dû cibler. |

**⚠️ Le piège du job de purge, à ne pas découvrir en production.** Un `delete` ensembliste
(« anonyme + 30 jours + sans commande ») **avorte en entier** dès qu'une seule identité est
bloquée par une FK : vérifié sur deux identités dont une seule portait une ligne `audit_log` —
zéro identité purgée, y compris celle qui était parfaitement purgeable. Comme le bloqueur peut
être définitif, **le job peut mourir en silence et ne plus jamais rien purger**. Le prédicat doit
donc énumérer toutes les tables bloquantes en `not exists`, ou la suppression se faire identité
par identité avec l'exception rattrapée. Ce n'est pas un détail d'implémentation.

### Fichiers touchés

| Fichier | Nature |
|---|---|
| `supabase/config.toml` | `enable_anonymous_sign_ins = true` |
| `supabase/migrations/<NN>_orders_account_id_not_null.sql` | backfill + `set not null` ×2 |
| `supabase/migrations/<NN>_create_order_garde_et_attribution.sql` | garde + invariant 3 |
| `supabase/migrations/<NN>_purge_identites_anonymes.sql` | job pg_cron |
| `apps/web/lib/cart/CartContext.tsx` | invariants 1 et 2 ; **son commentaire de tête est déjà faux** (il cite « perdu si l'onglet est fermé », règle réécrite et validée le 2026-09-07) |
| `apps/admin/app/partner/(app)/AddReservationDialog.tsx` | inchangé — le compte technique est posé côté RPC |
| `supabase/tests/database/security_definer_exposure.test.sql` | ⚠️ à durcir : il accepte `auth.uid(` comme garde suffisante, donc il resterait **vert** sur une RPC neuve ouverte aux anonymes |
| `supabase/seed.sql` | la commande invité (l. 326-345) doit devenir une identité anonyme seedée |

---

## 1. Contexte et problème

Le 2026-09-07, une trouvaille sur le réordonnancement de l'accueil a déclenché une chaîne : le
panier persistant faisait perdre l'attribution d'un invité → il fallait garder le référent quelque
part → « dans l'utilisateur », sauf qu'un invité n'en a pas → lui en donner un. Trois specs en
sont sorties, dans un ordre imposé : **identité anonyme → panier en base → modèle de la ligne**.

### Ce que la reconnaissance a corrigé avant la rédaction

Six agents ont établi 147 faits vérifiés avant qu'une ligne de cette spec soit écrite. Quatre ont
changé le plan, et trois d'entre eux n'auraient pas été trouvés en raisonnant :

1. **La réservation manuelle n'était couverte par aucune décision** — `create_manual_order_line`
   écrit `account_id = null` en dur alors que son appelant est toujours authentifié. Il a fallu
   une huitième question à Jérôme.
2. **L'attribution se serait déplacée sur l'identité toute seule** (invariant 3). C'est la
   trouvaille la plus précieuse : une régression qui s'auto-active, invisible dans un diff
   puisqu'aucune ligne ne change.
3. **Le job de purge pouvait mourir en silence** (cas limites ci-dessus).
4. **`signInAnonymously()` déconnecte un client connecté** s'il est appelé naïvement.

### Une erreur de description, corrigée en passant

Le backlog et le journal décrivaient le périmètre comme « 79 migrations, 67 policies ». C'est faux
deux fois : **aucune** policy ne porte de clause `to authenticated`, et les 81 fonctions
exécutables par `authenticated` le sont **toutes via `PUBLIC`** — donc aussi par le rôle `anon`.
Les 106 `grant execute` ne filtrent rien : la sécurité tient entièrement aux gardes internes.

---

## 2. Portée et tranches

L'ordre n'est pas négociable : l'invariant 6 dit que la fuite de PII n'est refermée que par la
Tranche 2.

| Tranche | Contenu | Pourquoi cet ordre |
|---|---|---|
| **1** | `config.toml`, création de session (invariants 1-2), garde `create_order`, invariant 3 | Sans identité, rien à rattacher. L'invariant 3 doit être livré **dans la même tranche** que l'invariant 1, sinon la régression s'active entre les deux. |
| **2** | Compte technique, backfill, `account_id` NOT NULL ×2, seed | Referme la fuite de `create_payment_intent`. Exige la Tranche 1 (sinon les nouvelles commandes n'ont toujours pas de propriétaire). |
| **3** | Liste blanche appliquée (invariant 5) + durcissement de `security_definer_exposure` | Indépendante des deux autres, mais sans son contrôle mécanique la règle reste un souhait (§11.20). |
| **4** | Job de purge (invariant 9) | Aucune urgence : rien ne se dégrade tant qu'il n'existe pas, hors volume. |

### Hors périmètre, et pourquoi

- **Le panier en base** — spec séparée. Ici on ne fige que le fait qu'il portera l'attribution.
- **La conversion vers un vrai compte** — un invité qui crée un compte plus tard ne récupère pas
  ses commandes. Conséquence assumée de l'invariant 7, à rouvrir si le besoin se manifeste.
- **Les oracles de lecture** signalés par l'audit du 2026-09-09 (`has_capability`, `is_admin`,
  `establishment_slug_from_name` prennent un uuid en paramètre plutôt qu'`auth.uid()`) : réels
  mais **non reproduits**, et sans lien avec l'identité anonyme.

---

## 3. Décisions retenues (entretien des 2026-09-09 et 10)

| # | Décision | Ce qui a été écarté, et pourquoi |
|---|---|---|
| ① | Session créée au **premier ajout au panier** | « Ou à l'arrivée `?ref=` » (formulation du 2026-09-07) : révisé, car `on_auth_user_created` en aurait fait un compte fantôme par scan de QR. |
| ② | Attribution portée par **le panier** | Sur l'identité : interdit par le §3c pour un invité. |
| ③ | **Refus par défaut**, liste blanche | Liste noire : chaque RPC future serait ouverte par défaut. |
| ④ | Trigger `on_auth_user_created` **inchangé** | Le conditionner : il est sur INSERT, or lier un email est un UPDATE — un converti n'aurait jamais eu de ligne. |
| ⑤ | L'identité **est** le compte, sans mot de passe ; `account_id` NOT NULL ; pas d'`updateUser` | La conversion automatique par email : `updateUser` échoue si l'email est pris, et Supabase refuse de lier sur un email non vérifié (*pre-account takeover*). |
| ⑥ | **Aucune** confirmation d'email en plus du voucher | Une confirmation bloquante : interruption au pire endroit du parcours. |
| ⑦ | Purge à **30 jours** des anonymes sans commande. **Le panier ne protège pas** : seule une commande épargne une identité (tranché le 2026-09-10, après reformulation explicite) | 90 jours ; « aucune purge » ; « un panier récent protège ». |
| ⑧ | Réservation manuelle → **compte technique unique**, d'email `reserva-manual@hifago.local` | Le compte du socio (il est le vendeur) ; une identité par client (exige l'API Admin, chantier à part) ; un email distinct ou un compte par établissement. |

---

## 4. Parcours cible

1. Le visiteur arrive, navigue, consulte des fiches. **Aucune identité créée.**
2. Il clique « Ajouter au panier ». `CartContext` vérifie qu'aucune session n'existe (invariant 2),
   puis appelle `signInAnonymously()`. Si le réglage est désactivé ou l'appel échoue, **l'ajout
   échoue visiblement** — jamais un panier sans identité.
3. Le code référent du cookie `hifago_ref` est recopié sur le panier (spec suivante).
4. Au checkout, il saisit nom, email et WhatsApp : ces valeurs vont sur la **commande**, pas sur
   l'identité.
5. `create_order` écrit `account_id = auth.uid()`. La commande lui appartient : il la relit dans
   `/cuenta/reservas`, peut l'annuler, et lui seul peut en créer le paiement.
6. Le voucher part sur `orders.holder_email` (email #7). Une adresse fausse se voit là.
7. S'il ne commande jamais, son identité est purgée après 30 jours.

---

## 5. Écrans

**Aucun écran nouveau, et c'est voulu** : la création d'identité est invisible. Deux retouches :

- **`CartContext`** — la seule vraie modification front. Son commentaire de tête doit être corrigé
  du même geste : il affirme que le panier est « perdu si l'onglet est fermé » en citant une règle
  du cahier qui a été réécrite **et validée** le 2026-09-07.
- **`/cuenta/reservas`** — devient atteignable pour un invité, sans un pixel de changement : la
  policy `orders_select` filtre sur `account_id = auth.uid()`, aujourd'hui `NULL` pour une commande
  invité, donc invisible pour tout le monde. C'est un gain, pas une régression.

---

## 10. Points ouverts

1. **`update_my_account_profile` pour un anonyme** : exclue par l'invariant 5, mais faut-il qu'un
   invité puisse renseigner son nom une fois pour toutes plutôt qu'à chaque commande ? Non tranché,
   et sans effet sur les quatre tranches — à reprendre quand l'écran `/cuenta` sera abordé.

*(Les deux autres points ouverts au moment de la rédaction ont été tranchés le 2026-09-10 :
critère de purge → invariant 10 ; compte technique → invariant 8.)*

## 11. Annexe — traçabilité code→règle

| Règle | Où elle vit déjà |
|---|---|
| Socle `is_anonymous_session()` | `supabase/migrations/20260909200000_liste_blanche_sessions_anonymes.sql` |
| Première application (invitation) | même migration, `consume_partner_invitation` |
| Garde de paiement à compléter | `supabase/migrations/20260909190000_create_payment_intent_sans_session.sql` l. 60-69 |
| Blocs d'attribution à neutraliser | `create_order`, blocs `saved_attribution_code` (lecture puis écriture) |
| Contrôle mécanique à durcir | `supabase/tests/database/security_definer_exposure.test.sql` |
| Décisions ①-⑧ | `docs/journal/2026-09.md`, entrées des 2026-09-09 et 2026-09-10 |

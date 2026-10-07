---
id: runbook-environnements
titre: "Runbook des environnements — préprod et prod, variable par variable"
theme: cadrage
statut: vivant
langue: fr
maj: 2026-10-03
resume: >
  Ce que chaque environnement cloud (préprod, prod) doit porter pour fonctionner : variables
  Vercel par projet et par cible, secrets des Edge Functions, Vault, Auth, relais LobbyPMS,
  e-mails (Resend + SMTP de l'Auth), Mercado Pago. Ordre de déploiement et vérifications.
  Aucune valeur secrète : uniquement des noms, des sources et des formats.
mots_cles: [environnement, prod, preprod, variables, secrets, vault, vercel, resend, smtp, mercadopago, relais, vultr, lobby, deploiement]
repond_a:
  - "Quelles variables et quels secrets la prod doit-elle avoir ?"
  - "Comment configurer les e-mails, Mercado Pago et le relais Lobby en prod ?"
  - "Dans quel ordre déployer migrations, fonctions et apps ?"
---
# Runbook des environnements

> Aucune valeur secrète ici (dépôt public, `CLAUDE.md` §8.2) : des noms, des sources, des formats.
> L'état courant de chaque environnement (posé / manquant) vit au journal et au backlog, pas ici.
> Une variable ajoutée au code s'ajoute à ce tableau dans le même commit.

## 1. Les environnements

| | Local | Préprod | Prod |
|---|---|---|---|
| Branche | toute branche | `staging` | `main` (PR `staging → main`, merge commit) |
| Vercel | `npm run dev` | Custom Environment `staging` (+ Preview) | Production |
| Supabase | `supabase start` (Docker) | `ujlltaauitqfabcbgvaw` | `flshpzcpizqqmgmnfgkd` |
| Vitrine | `http://localhost:3100` | `https://hifago-staging.vercel.app` | `https://hifago-web-orpin.vercel.app`, puis `https://hifago.co` à la bascule |
| Admin | `http://localhost:3101` | `https://hifago-admin-staging.vercel.app` | `https://hifago-admin-theta.vercel.app` |
| Relais Lobby | aucun (fixtures) | **un seul relais Vultr, partagé** (même URL, même secret) | même relais que la préprod |
| Mercado Pago | mock (`MERCADOPAGO_MOCK_MODE`) | appli `8226931100726923` du vendeur **de test** `3627131944` | appli `6356741966824143` du compte **réel** de Jérôme `225649476`, identifiants de production |
| Données | `seed.sql` | reprise v1 (dérogation à §7.3, journal du 2026-10-03) | jamais de seed ni de mock-data |

Une appli Mercado Pago, une clé Resend et un jeu de secrets Supabase/Vercel **par environnement**.
Sont partagés entre préprod et prod : le compte Google Maps et le **relais Lobby** (décision de
Gabriel, 2026-10-03 — un seul relais Vultr au lieu d'un par environnement).

## 2. Vercel — variables au niveau projet

Toujours au niveau du projet, jamais en « Shared Environment » d'équipe (invisibles à
`vercel env ls`). Secrets en type **Sensitive**. Préprod = cibles `staging` + `Preview` ; prod =
cible `Production`. Toute modification exige un redéploiement (les `NEXT_PUBLIC_*` sont figées au
build).

**`hifago-web`** (vitrine)

| Variable | Type | Valeur / source |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | plain | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | plain | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | sensitive | idem |
| `NEXT_PUBLIC_WEB_APP_URL` | plain | URL publique de la vitrine de l'environnement. En prod, elle commande aussi `robots.txt` (`isIndexableSite()` : fermé tant qu'elle est en `*.vercel.app`) et l'origine de la `notification_url` Mercado Pago |
| `LOBBY_API_BASE_URL` | plain | `https://<ip-avec-tirets>.nip.io` du relais de l'environnement |
| `LOBBY_RELAY_SECRET` | sensitive | lu sur le relais (§5), jamais affiché |
| `MERCADOPAGO_ACCESS_TOKEN` | sensitive | token de l'appli qui encaisse (§7) |
| `MERCADOPAGO_WEBHOOK_SECRET` | sensitive | clé secrète Webhooks de **la même** appli, même mode (§7) |

Jamais en cloud : `MERCADOPAGO_MOCK_MODE` (ignorée en prod par `isPaymentsMockEnabled()`, mais à
ne pas poser). Optionnelles, défauts dans le code : `LOBBY_RESERVE_TIMEOUT_MS`,
`LOBBY_RESERVE_BUDGET_MS`.

**`hifago-admin`**

| Variable | Type | Valeur / source |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | comme web | |
| `NEXT_PUBLIC_WEB_APP_URL` | plain | URL de la **vitrine** (obligatoire au build) |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | plain | optionnelle ; absente = autocomplétion d'adresse désactivée |
| `LOBBY_API_BASE_URL`, `LOBBY_RELAY_SECRET` | comme web | « Tester la connexion » et la lecture des catégories Lobby |

## 3. Supabase — trois couches à poser par projet

Une fonction ou un cron n'existe pas tant que ces trois couches ne sont pas posées
(`.claude/rules/supabase.md`) : vérifier les trois, jamais supposer.

**3.1 Secrets des Edge Functions** (Dashboard → Edge Functions → Secrets, ou
`supabase secrets set --project-ref`). Les `SUPABASE_*` sont injectés d'office. Gabarit :
`supabase/functions/.env.example`.

| Secret | Utilisé par | Valeur |
|---|---|---|
| `RESEND_API_KEY` | `send-notification-emails` | clé Resend « Sending access » propre à l'environnement |
| `NOTIFICATION_EMAIL_FROM` | `send-notification-emails` | prod : `Hifago <notificaciones@hifago.co>` (domaine vérifié le 2026-10-03, §6). Préprod : **rester** sur `Hifago <onboarding@resend.dev>`, qui n'envoie qu'au titulaire du compte Resend — garde-fou voulu, la préprod portant les données réelles de la v1 |
| `MERCADOPAGO_ACCESS_TOKEN` | `payments-reconcile` | **le même** token que `hifago-web` ; absent = `secret_missing`, échec fermé |
| `LOBBY_API_BASE_URL` | 4 fonctions `pms-*` | **le même** relais que Vercel ; absent = appel direct à Lobby, refusé faute d'IP déclarée |
| `LOBBY_RELAY_SECRET` | 4 fonctions `pms-*` | idem |

Jamais en cloud : `RESEND_API_BASE_URL`, `MERCADOPAGO_API_BASE_URL` (interception par les tests).

**3.2 Vault** (SQL Editor, gabarits `supabase/scripts/seed_*_vault_secrets.example.sql`) : lus
par les crons (`pg_net`) et par les e-mails.

| Nom | Valeur |
|---|---|
| `pms_functions_base_url` | `https://<ref>.supabase.co` — la base du projet, **sans** `/functions/v1` (les wrappers `invoke_*` l'ajoutent) |
| `pms_service_role_key` | **exactement** la clé service_role du runtime des fonctions |
| `admin_app_public_url` | URL de l'admin (lien d'invitation) |
| `web_app_public_url` | URL de la vitrine (lien « ver mi reserva » de l'e-mail de confirmation) |

**3.3 Auth** (API de gestion, `PATCH /v1/projects/{ref}/config/auth`, champ par champ, ou
Dashboard → Authentication — jamais `config push`, cassé et dangereux ; puis constat en lecture par
`SUPABASE_ACCESS_TOKEN=… node scripts/check-cloud-auth-config.mjs <ref>`, qui compare à
`supabase/auth-policy.json`. Sur le plan gratuit, les gabarits d'e-mail exigent un SMTP propre :
Resend, comme en préprod depuis le 2026-10-07.)
- Site URL = admin de l'environnement ; Redirect URLs = origine nue et `/**` de web et d'admin.
- Google : client OAuth propre à l'environnement (`hifago-preprod` / `hifago-prod`), callback
  `https://<ref>.supabase.co/auth/v1/callback`. En prod, l'écran de consentement doit être
  **publié** (en mode Test, seuls les testeurs déclarés peuvent se connecter).
- Sessions anonymes actives (`enable_anonymous_sign_ins`, panier en base).
- SMTP personnalisé = Resend (§6). Sans lui, le mailer par défaut n'écrit qu'aux membres de
  l'organisation Supabase : aucune inscription client par e-mail ne peut aboutir
  (`enable_confirmations = true`), et les gabarits espagnols sont refusés (400).
- Prod : plan **Pro** avant l'ouverture au public (le plan gratuit met le projet en pause après
  7 jours sans trafic et n'a pas de sauvegarde exploitable).

## 4. Ordre de déploiement

Vercel déploie au merge ; le schéma doit donc être en place **avant** le code qui en dépend.
1. `supabase db push --project-ref <ref>` (depuis la racine du dépôt), puis
   `supabase functions deploy --project-ref <ref>` (les fonctions importent `packages/domain` :
   toujours depuis la racine). Ne pas changer le lien local, qui reste sur la préprod.
2. Secrets (§2, §3) posés ou mis à jour.
3. Merge : `staging` pour la préprod ; PR `staging → main` pour la prod.
4. Vérifications (§8).

Tant que le workflow de déploiement Supabase automatique n'existe pas (plan de migration,
phase 9 bis), l'étape 1 est manuelle, sur l'accord explicite de Jérôme pour la prod (§8.3).

## 5. Relais LobbyPMS (Vultr)

Procédure complète : `infra/relay/README.md` (création, IP réservée, pare-feu, vérifications,
pièges). **Un seul relais sert la préprod et la prod** (décision du 2026-10-03) :
- `LOBBY_API_BASE_URL` et `LOBBY_RELAY_SECRET` ont donc la **même valeur** dans les deux
  environnements : secrets Supabase de chaque projet, et cibles `staging`/Preview et Production des
  **deux** projets Vercel ;
- changer le secret du relais = le mettre à jour dans les deux environnements dans la foulée, puis
  redéployer, sinon la prod perd Lobby ;
- l'IP doit être une **IP réservée** Vultr : la prod en dépend ;
- l'IP est déclarée chez Lobby sur chaque utilisateur dont le jeton est saisi dans un admin (jeton
  et liste d'IP vont par utilisateur) ;
- ⚠️ un même établissement ne doit jamais être piloté par deux environnements à la fois : quand
  le connecteur d'un hôtel est actif en prod, celui de la préprod reste coupé.

## 6. E-mails (Resend + SMTP de l'Auth)

Deux flux distincts, un seul fournisseur :
- **notifications métier** (8 e-mails, `docs/06-emails-transactionnels.md`) : Edge Function
  `send-notification-emails` → API Resend ;
- **e-mails d'Auth** (confirmation d'inscription, réinitialisation) : Supabase Auth → SMTP Resend.

Le DNS de `hifago.co` est chez **Hostinger** (serveurs `dns-parking.com`). L'app legacy envoie
par la boîte SMTP Hostinger (`no-reply@hifago.co`) : son MX, son SPF racine et l'enregistrement A
(Fly) ne se touchent **jamais**.
1. Resend (compte hifago) → Domains : `hifago.co` y est déclaré (région `eu-west-1`, ajouté vers
   le 2026-09-20).
2. Hostinger → DNS de `hifago.co` : les trois enregistrements demandés par Resend y sont déjà,
   identiques (vérifié le 2026-10-03 par `dig`) — TXT `resend._domainkey` (DKIM), CNAME `send`
   et CNAME `rsend` (vers `*.forge.rmta.net`). Ils ne touchent ni la racine ni le legacy.
3. Resend → Verify DNS Records. Puis `NOTIFICATION_EMAIL_FROM = Hifago <notificaciones@hifago.co>`
   (§3.1).
4. Supabase prod → Authentication → Emails → SMTP Settings : hôte `smtp.resend.com`, port `465`,
   utilisateur `resend`, mot de passe = une clé Resend dédiée (`hifago-prod-smtp`, Sending access
   limitée à `hifago.co`), expéditeur
   `notificaciones@hifago.co`, nom `Hifago`. Puis pousser les gabarits `[auth.email.template.*]`
   de `config.toml` (sujets + `supabase/templates/*.html`) : indispensables, leurs liens
   `{{ .RedirectTo }}&token_hash=…` sont ceux que traitent les routes `/auth/callback`. Fait en
   prod le 2026-10-03 par l'API de gestion (`PATCH /v1/projects/{ref}/config/auth`, champs
   `smtp_*` et `mailer_*`), la clé étant saisie dans une fenêtre masquée.
5. Vérifier : une inscription par e-mail sur une adresse hors équipe reçoit la confirmation, et
   un événement de notification part avec un `provider_message_id`.

## 7. Mercado Pago (Checkout Pro)

Piège 19 (`docs/pieges-empiriques.md`) : le token et la clé secrète du webhook viennent de **la
même application**, celle du compte qui **encaisse**, lue en étant connecté à **ce** compte. Le
préfixe du `preference-id` est l'identifiant du compte qui encaisse : c'est le moyen de le
vérifier.

Prod (posé le 2026-10-03) :
1. Connecté au compte **réel** de Jérôme (`225649476`, Colombie) — en navigation privée, sinon le
   panel reste sur le vendeur de test de la préprod → appli `6356741966824143`
   (`https://www.mercadopago.com.co/developers/panel/app/6356741966824143`).
2. Activer les **identifiants de production** → Access Token `APP_USR-…`. Le vérifier avant de le
   poser : `GET https://api.mercadopago.com/users/me` doit rendre `id` `225649476`, `site_id`
   `MCO`, sans tag `test_user` (un token du vendeur de test commence AUSSI par `APP_USR-`).
3. Webhooks → **mode production** : URL `<vitrine prod>/api/payments/webhook?source_news=webhooks`,
   événement **Paiements** seul → enregistrer → la clé secrète apparaît.
4. Poser : `MERCADOPAGO_ACCESS_TOKEN` (Vercel web Production + secret Supabase prod) et
   `MERCADOPAGO_WEBHOOK_SECRET` (Vercel web Production). Redéployer la vitrine.
5. À la bascule de domaine : remplacer l'URL du webhook dans le panel (la `notification_url` des
   préférences suit `NEXT_PUBLIC_WEB_APP_URL` d'elle-même).

`?source_news=webhooks` est obligatoire (PR #6) : sans lui, Mercado Pago livre aussi des IPN dont
la signature n'est jamais vérifiable. ⚠️ Dès que le token de production est posé, la prod encaisse
de l'argent réel.

## 8. Vérifications après déploiement

- Supabase : `migration list` aligné sur le dépôt, `functions list` = 6 fonctions, noms des
  secrets (§3.1) et du Vault (§3.2) présents, `cron.job` actifs, `net._http_response` en 200 sans
  `warning` Vault après ~15 min.
- Relais : `/healthz` = `ok`, 403 sans secret ; « Tester la connexion » Lobby depuis l'admin, puis
  **enregistrer** le jeton (le test ne l'enregistre pas).
- Vitrine : `robots.txt` = `Disallow: /` tant que l'URL est en `*.vercel.app` ; ajout au panier en
  anonyme.
- Admin : connexion + enrôlement TOTP ; connexion Google.
- E-mails : §6.5. Paiement : un paiement réel de faible montant, webhook accepté, commande payée,
  puis remboursement depuis le panel.

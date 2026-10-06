---
paths:
  - "**/supabase/**"
  - "**/*.sql"
  - "**/packages/supabase/**"
  - "**/packages/domain/**"
  - "**/app/api/**"
---

# Règles Supabase / SQL / Route Handlers — chargées quand on touche ces fichiers

Les invariants, eux, sont toujours chargés : `CLAUDE.md` §3 (frontière RLS / RPC-only) et §4
(anti-survente). Ce fichier porte leur forme exécutable et les pièges vérifiés en conditions
réelles. Règle d'échappement : au-delà de 100 lignes, le piège le plus ancien part au journal
(`docs/journal/`) avec un lien depuis ici.

## Forme exécutable de §3 — à chaque nouvelle table ou fonction

1. Trancher explicitement RPC-only vs RLS directe (critère : §3.1-3.2). RPC-only =
   ```sql
   alter table <table> enable row level security;
   revoke insert, update, delete on <table> from authenticated, anon;
   -- aucune policy d'écriture n'est créée sur cette table
   ```
   Cas pas limpide → ne pas trancher seul, signaler à Jérôme (§1.4).
2. Fonction appelée depuis une policy : `stable` ; `security definer` + `set search_path = ''` si
   elle lit une table sous RLS ; vérifier qu'elle ne re-déclenche pas une policy en cascade.
3. Toute policy enveloppe `auth.uid()` en `(select auth.uid())` — jamais l'appel brut.
4. Toute fonction `security definer` fixe `set search_path = ''` sans exception.
5. RPC critique au sens de §4.1 (réservation, fermeture de date/créneau, décrément) : squelette
   exact de `docs/05-reference-technique.md` §1 + test de concurrence (`/hifago-rpc-critique`) —
   sinon elle n'est pas terminée. Une table RPC-only sans opération critique (audit-log, vue
   miroir) n'est pas concernée.
6. Régénérer les types après chaque migration (`/hifago-migration` — le filtre
   `grep -v "^Connecting to db"` est obligatoire, la CLI écrit parfois sur stdout avant le TS).
7. `create or replace` ne remplace jamais une signature différente ni ne retire un paramètre :
   `drop function` explicite d'abord. Pour modifier une RPC longue et critique (`create_order`,
   `apply_payment_webhook`), extraire la définition vivante par `pg_get_functiondef` et remplacer
   par occurrences comptées — jamais retaper à la main.
8. Toute fonction qui verrouille, écrit `orders`/`payments`/`order_lines`, OU **insère une ligne
   fille d'une commande existante** (l'`insert` prend un verrou de clé sur `orders`, piège 22) prend
   **`orders` d'abord, toujours** — `for update` explicite avant tout autre verrou (2026-09-20/21 :
   `apply_payment_webhook` puis `modify_order_line`, interblocages reproduits puis prouvés absents par
   `tests/concurrency/apply_payment_webhook_vs_expiry` et `reconcile_order_vs_webhook.concurrency.mjs`).

## Pièges vérifiés — prescription ici, récit dans `docs/journal/`

- **Grants par défaut restrictifs** (2026-08-13) : une table créée par le rôle `postgres` n'hérite
  PAS des grants larges — sans `GRANT` explicite, `permission denied` tombe AVANT la RLS, facile à
  confondre avec un bug de policy. `ALTER DEFAULT PRIVILEGES … GRANT … TO anon, authenticated,
  service_role` est posé (`20260813163456_identity_rls.sql`) mais n'est pas rétroactif : `GRANT`
  explicite par table déjà créée, et `grant execute on function … to authenticated;` pour chaque
  RPC. ⚠️ Observé sur l'instance locale seulement — à re-vérifier sur cloud avant de supposer.
- **`establishments` n'a pas de grant SELECT global** (révoqué pour protéger `lobby_api_token`,
  ré-accordé colonne par colonne) : une colonne neuve y est illisible tant qu'on ne l'accorde pas.
  Ne pas étendre `update_establishment` (trois chemins de modération l'appellent) — écrire une RPC
  étroite.
- **`db reset` ne recharge pas `[auth]`/`[auth.email]`/`[auth.external.*]` de `config.toml`**
  (2026-08-19) : GoTrue lit ces clés au démarrage du conteneur. Après les avoir touchées :
  `npx supabase stop && npx supabase start`. `db reset` suffit pour migrations et seed.
- **`[auth.email].enable_signup=false` désactive le provider email ENTIER** (connexion comprise,
  message `Email logins are disabled`), pas seulement l'inscription. Le seul verrou pour bloquer les
  nouveaux comptes sans toucher aux connexions : `[auth].enable_signup` (racine). Ne jamais
  dupliquer la valeur dans `[auth.email]` « pour être sûr ».
- **Un flag GoTrue global ne voit pas un jeton d'invitation dans l'URL** (`enable_signup=false`
  cassait `/partner/join?token=…` via Google ; un Auth Hook `before_user_created` ne reçoit pas non
  plus le contexte de requête). **Leçon générale** : quand le besoin est « ne pas laisser un visiteur
  croire qu'il peut s'auto-inscrire » (un problème d'ÉCRAN), retirer le point d'entrée UI écran par
  écran plutôt que poser un verrou serveur global, qui ne distingue jamais un contexte légitime d'un
  contexte anonyme.
- **`supabase db push --include-seed` n'exécute pas `seed.sql` avec les droits de `postgres`** sur
  le cloud (rôle éphémère `cli_login_postgres`) — procédure et contournement : `/hifago-seed`.
- **Une Edge Function ou un cron n'existe pas tant qu'il n'est pas déployé ET que ses secrets sont
  posés côté Supabase** (`supabase secrets list`, Vault) : les crons ont tourné à vide en silence
  du 19 au 27/08. Vérifier les trois couches, jamais supposer. Import Deno sans extension `.ts` =
  boot cassé, invisible au typecheck, au lint et aux tests. En LOCAL, le runtime Edge ne voit pas un
  module `packages/domain/` fraîchement CRÉÉ (un module modifié se propage, un nouveau fichier
  non — 2026-09-18, `toMirrorRows.ts`) : `Module not found` malgré un `docker restart` du conteneur
  `edge_runtime` seul — `npx supabase stop && npx supabase start` complet est nécessaire.
- **LobbyPMS** : `end_date` est INCLUSIF ; la date d'une ligne vient de la RÉPONSE, jamais de la
  date demandée (`alignLobbyCatalogEntries` échoue bruyamment plutôt que de compter les rangs) ; une
  disponibilité illisible vaut « non cotée », jamais « complet » ; le succès se lit dans le CORPS,
  jamais dans le statut HTTP ; `cancellation_reason` est un code fermé. Lobby n'est jamais la
  source du prix. Le cache `(établissement, mois)` rejoint la promesse en vol (`getOrFetch`).
- **Deux règles opposées coexistent volontairement** : une NUIT PMS refusée défait la commande
  (`release_order_after_pms_refusal`, panier conservé), une ACTIVITÉ refusée ne la défait pas.
  Ne pas « corriger » l'une au nom de l'autre. Toute annulation REND la place (20261006192424 : A3
  règle l'argent, jamais l'inventaire). Un refus de nuit ne crée plus d'entrée de réconciliation
  (`notify_all_admins` n'a pas de dédup).
- Sur la base locale partagée : ne jamais `db reset` sans savoir si une autre session a des
  données en cours (`AGENTS-PARALLELES.md`) ; les échecs pgTAP par accumulation d'`audit_log` sont
  de la pollution, pas une régression — prouver en vidant dans la transaction du test.
- **Grants par défaut, sens INVERSE selon table ou fonction** (2026-08-28, faillite re-mesurée le
  2026-09-10) : une TABLE créée par `postgres` n'a PAS de grant par défaut (ci-dessus), mais une
  FONCTION en a un — PostgreSQL accorde EXECUTE à PUBLIC sur toute nouvelle fonction. Une RPC
  `security definer` neuve (cron ou non) est donc appelable par `anon`/`authenticated` tant qu'un
  `revoke all on function ... from public, anon, authenticated;` explicite ne le referme pas —
  jamais un `grant` qui manquerait, un `revoke` qui manque. Vérifier avec
  `has_function_privilege('anon', '<fn>()', 'EXECUTE')`, jamais supposer sur la lecture du corps
  seule.

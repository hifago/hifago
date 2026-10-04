---
name: hifago-test
description: Lance les tests du nouveau stack Hifago — Vitest (unitaire), Playwright E2E, et la suite de concurrence anti-survente à barrière de synchronisation — toujours contre la stack Supabase locale, jamais un projet cloud partagé. Invocation Codex — $hifago-test, $hifago-test unit, e2e ou concurrence
---

# /hifago-test — lancer les tests du nouveau stack

⚠️ **Toutes les commandes de ce skill s'exécutent depuis `hifago/`**, racine du monorepo (dépôt
git séparé). Ce n'est pas une commodité : `test:db` et `test` existent AUSSI dans le
`package.json` de la racine, où ils lancent la suite de l'app **legacy**. Lancés du mauvais
répertoire, ils passent au vert en ayant testé autre chose.

## Argument `$ARGUMENTS`
| Valeur | Effet |
|---|---|
| *(vide)* | pgTAP + Unitaire (en parallèle, aucune dépendance entre les deux), puis concurrence — réservé à la fin d'une feature/session. **N'inclut PLUS l'E2E** (en pause, cf. § ci-dessous) |
| `unit` | Vitest seul |
| `e2e` | Playwright seul — **uniquement sur demande explicite de Jérôme** (suite en pause). Contre un serveur Next.js local déjà démarré, cf. `/hifago-dev` |
| `concurrence` | Suite de tests de concurrence sur toutes les RPC critiques existantes |
| `<fichier ou motif>` | Lance uniquement ce(s) fichier(s) — `vitest run <motif>` si `.test.ts(x)`, `playwright test <motif>` sinon (les deux outils supportent nativement un filtre par chemin/nom). **Pendant le développement d'une feature, préférer ce mode** à la suite complète (cf. `.claude/rules/tests.md`, proportionnalité du test) |

## Règle non négociable (`CLAUDE.md` §6.4)
Stack de test locale par défaut, jamais un projet cloud partagé. La seule exception documentée est
un job nocturne dédié
(`pms-nightly-contract-check`, spec 21) qui frappe le **compte réel Casa Kayam en lecture seule**
(`GET /rooms`/`GET /available-rooms`, jamais d'écriture) — **aucun sandbox LobbyPMS n'existe**
(confirmé, spec 21 §10 point 1 : LobbyPMS ne propose qu'un essai commercial de 15 jours, pas de
bac à sable API pérenne) — jamais par défaut, jamais en CI/en test (tout test automatisé de ce
connecteur passe par un serveur de fixtures local, cf.
`packages/e2e-support/src/pmsFixtureServer.ts` et `tests/pms-integration/`, jamais le vrai
LobbyPMS).

## Procédure

Étapes 0 et 1 n'ont aucune dépendance entre elles (Vitest ne touche aucune base, pgTAP annule
toujours ses transactions) — les lancer **en parallèle**, comme le fait déjà `hifago-init` pour
son lint/typecheck/unitaire de CI. L'étape 3 écrit de vraies lignes dans la base locale et reste
séquentielle après les deux premières. L'étape 2 (E2E) est en pause et n'est plus lancée.

⚠️ **Ordre imposé quand l'E2E reviendra** : tout e2e admin écrit dans `audit_log`, or six fichiers
pgTAP le comptent en absolu — une mesure pgTAP prise après des e2e ne veut rien dire
(`docs/backlog.md`). `npm run db:setup` referme l'écart.

0. **Base de données (pgTAP)** : `npm run test:db` (`supabase test db`) — policies RLS,
   contraintes, logique séquentielle (48 fichiers dans `supabase/tests/database/`, cf.
   `supabase/tests/database/README.md`). Ne remplace **jamais** un test de concurrence (point 3
   ci-dessous, cf. `CLAUDE.md` §6) : chaque fichier `pg_prove` tourne dans une transaction
   annulée en rollback, structurellement incapable de simuler une vraie concurrence.

1. **Unitaire (Vitest)** : `npm test` (= `npm run test --workspaces --if-present`). Le moteur
   de commission et toute logique métier
   dense doit être testé en fonction pure, sans mock Supabase — si un test unitaire dépend d'un
   mock du client `supabase-js`, c'est probablement un test d'intégration mal classé.

2. **E2E (Playwright) — EN PAUSE depuis le 2026-09-09, ne pas lancer sans demande explicite.**
   ⚠️ Décision de Jérôme : la suite e2e sort du chemin par défaut le temps que la dette soit
   traitée (19 rouges sur 120 mesurées le 2026-09-09 : 17/82 en admin, 2/38 en web). **Il faudra
   les remettre** — le point de réactivation vit dans `docs/backlog.md`. En attendant, aucune
   étape de ce skill ne les lance, et la CI n'en a jamais eu de job.
   Pour mémoire quand elles reviendront : `npm run test:e2e` ; auth jamais par le vrai écran
   Google OAuth — login programmatique via l'API REST Supabase, session réutilisée en
   `storageState.json` par rôle (client/socio/admin) ; MFA/TOTP admin via `otplib`, jamais un
   vrai téléphone.

3. **Concurrence** : pour chaque RPC critique existante (celles créées via
   `/hifago-rpc-critique`), relancer son test de barrière de synchronisation. Même raison qu'au
   point 0 : jamais pgTAP pour cette catégorie de test.

## Ce qui est normal, ne pas le signaler comme un problème
- Un test E2E plus lent que les unitaires — normal, c'est un vrai navigateur piloté.
- La stack Supabase locale prend quelques secondes à démarrer au premier `npx supabase start` de
  la session — normal (téléchargement d'images Docker au tout premier lancement uniquement).

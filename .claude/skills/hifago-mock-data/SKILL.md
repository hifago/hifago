---
name: hifago-mock-data
description: Applique mockData/ (établissements/activités/tags/partenaires/photos, JSON) contre le nouveau stack Hifago — crée chaque item s'il n'existe pas encore, ne retouche jamais un item déjà en base (même modifié depuis) — jamais un reset, contrairement au skill hifago-seed. Invocation Codex — $hifago-mock-data ou $hifago-mock-data preprod
---

# /hifago-mock-data — mock data JSON rejouable

## Différence avec `/hifago-seed`
`supabase/seed.sql` (`/hifago-seed`) suppose une base fraîche et un reset complet — rejouable
seulement après `db reset`. `mockData/` (ce skill) est fait pour l'inverse : **créer si absent,
jamais retoucher un item déjà créé**, y compris ses photos. Il peut tourner répétitivement contre
une base déjà utilisée, y compris en préprod, sans écraser le travail de test en cours. Format et
schéma JSON exacts : `mockData/README.md`.

## Argument `$ARGUMENTS`
| Valeur | Effet |
|---|---|
| *(vide)* | Applique `mockData/` en local |
| `preprod` | Confirme d'abord la cible (`/hifago-verify-compte`), puis applique `mockData/` sur le projet préprod |

## Procédure

1. **Local** : un compte admin doit déjà exister (`npm run db:setup` l'a créé —
   `admin@hifago.test` / `Seed1234!`).
   ```
   eval "$(npx supabase status -o env | grep -E '^[A-Z0-9_]+=' | sed 's/^/export /')"
   SUPABASE_URL="$API_URL" SUPABASE_ANON_KEY="$ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
     SUPABASE_ADMIN_EMAIL="admin@hifago.test" SUPABASE_ADMIN_PASSWORD="Seed1234!" \
     MOCK_PERSONNE_MDP="Seed1234!" \
     node supabase/scripts/seed-mock-data.mjs
   ```
   Ou `npm run db:mock-data` avec les mêmes variables déjà exportées. `MOCK_PERSONNE_MDP` donne
   leur mot de passe aux personnes SANS `password` dans leur JSON (les 21 comptes fictifs du
   catalogue v1 — dépôt public, aucun mot de passe écrit) ; sans elle, ces partenaires sont créés
   sans compte de connexion. En préprod, jamais `Seed1234!` : un mot de passe fort, en variable de
   session.
   ⚠️ Base locale PARTAGÉE : avant tout `db:setup` ou application de mockData, demander le jeton de
   la pile à l'orchestrateur d'audit s'il y en a un (`AGENTS-PARALLELES.md` §3).

2. **Préprod** : `/hifago-verify-compte` d'abord (jamais par défaut). Un compte admin équivalent à
   `admin@hifago.test` doit exister sur ce projet et avoir une capacité `admin` `active` — sinon le
   script ne peut pas s'authentifier pour les RPC. Mêmes variables, credentials cloud en variable
   de session uniquement, jamais dans un fichier (`CLAUDE.md` §8.2).

3. Lire le résumé affiché (créés/ignorés par type) — toute erreur RPC interrompt le script
   immédiatement avec le chemin du fichier `mockData/` en cause, jamais un résumé de succès sur un
   état partiel.

## Ce qui n'est délibérément PAS fait

- Aucune synchro : modifier un fichier `mockData/` après la création de l'item correspondant n'a
  aucun effet — le script ignore silencieusement tout item déjà en base (photos comprises).
- Aucune exécution automatique au lancement de `npm run dev` — toujours manuel, comme
  `/hifago-seed`.

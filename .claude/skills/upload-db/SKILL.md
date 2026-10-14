---
name: upload-db
description: Envoie la base de staging vers la préprod Hifago sans pousser de code — migrations Supabase en attente et Edge Functions modifiées — puis contrôle les fiches au rendu réel. Préprod uniquement, aucune donnée. Invocation Codex — $upload-db ou $upload-db dry-run
---

# /upload-db — envoyer la base vers la préprod, sans le code

`node scripts/deploy-preprod.mjs db` (argument `dry-run` : ajouter `--dry-run`).

Applique les migrations en attente et redéploie les Edge Functions si leurs sources ont changé ;
aucun `git push`. « Base » veut dire **schéma et fonctions** : aucune donnée ne part (ni
`seed.sql`, ni `mockData/`) — une donnée qui doit exister en préprod s'écrit en migration.

**Procédure, codes de retour, ce que la commande vaut et ce qu'elle n'emporte pas** : ce sont ceux
de `/push-db` — lire `.claude/skills/push-db/SKILL.md` et l'appliquer tel quel, avec `db` à la
place de `all`. L'ordre n'est écrit qu'à un endroit, le script.

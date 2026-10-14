---
name: push
description: Pousse le code de staging vers la préprod Hifago sans jamais la casser — si une migration Supabase est en attente, elle part d'abord, d'elle-même — puis attend le build Vercel et contrôle les fiches. Préprod uniquement. Invocation Codex — $push ou $push dry-run
---

# /push — pousser le code vers la préprod

`node scripts/deploy-preprod.mjs code` (argument `dry-run` : ajouter `--dry-run`).

Jamais un `git push origin staging` nu : Vercel déploie dès le push, et du code parti avant sa
migration a mis toute la préprod en erreur le 2026-10-13. Le script regarde donc d'abord la base :
s'il y a une migration en attente ou des Edge Functions modifiées, il les envoie avant le code,
sans rien demander. `/push` et `/push-db` ne diffèrent que par l'intention.

**Procédure, codes de retour, ce que la commande vaut et ce qu'elle n'emporte pas** : ce sont ceux
de `/push-db` — lire `.claude/skills/push-db/SKILL.md` et l'appliquer tel quel, avec `code` à la
place de `all`. L'ordre n'est écrit qu'à un endroit, le script.

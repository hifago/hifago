---
name: backlog
description: Maintenance de docs/backlog.md (points ouverts, arbitrages en attente, dette connue de hifago) — synchroniser en fin de session, fermer un point ou en ajouter un. Invocation Codex — $backlog, $backlog done [point], $backlog add [texte]
---

# /backlog — tenir `docs/backlog.md` à jour (hifago)

Fichier cible : `docs/backlog.md`. TOUJOURS le lire en entier d'abord ; ses « Règles pour l'IA »
en tête font foi si ce skill diverge. Une ligne par point, jamais de récit — le récit va dans
`docs/journal/<mois>.md`. Argument `$ARGUMENTS` : `sync` (défaut si vide), `done <point>`,
`add <texte>`.

## /backlog sync (défaut — à lancer en fin de session)
1. Repérer ce qui a avancé : session en cours + `git log --oneline -10` + `git status`.
2. RETIRER chaque ligne dont le point est fermé — vérifié par commit ou dans le code, jamais
   supposé — et le dire dans l'entrée de journal du jour (« fermé : … »).
3. AJOUTER une ligne pour tout point nouvellement ouvert (bloquant, arbitrage, dette signalée non
   corrigée), dans la bonne section, avec le fichier ou la fonction concernés.
4. Mettre `maj:` à jour dans l'en-tête. Si le fichier dépasse ~60 lignes, ne pas tasser : proposer
   à Jérôme quel groupe part en spec ou en ticket séparé.

## /backlog done <point>
Comme sync, ciblé sur ce point : vérifier, retirer, journaliser.

## /backlog add <texte>
Une ligne, section adaptée (Arbitrage Jérôme requis · Bloquants externes · Data/config ·
Dette technique · Dette QA/UI), fichier concerné cité. Si le point dépend d'une action de Jérôme,
le dire dans la ligne.

## Interdits
Réécrire ou supprimer une édition manuelle de Jérôme · retirer une ligne sans preuve de fermeture ·
mettre du récit · committer depuis ce skill (la mise à jour reste dans le working tree).

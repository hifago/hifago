---
name: next
description: Dis-moi quoi faire maintenant sur hifago — guidage TDAH. Lit docs/backlog.md, la dernière entrée du journal et git log, et donne UNE seule action, jamais un choix. Usage — /next, /next done <point>, /next skip
---

# /next — une seule action à la fois (hifago)

Objectif : supprimer la paralysie du choix. La sortie donne UNE action — jamais une liste
d'options, jamais de question ouverte.

Sources, toutes trois obligatoires, dans cet ordre : `docs/backlog.md` (points ouverts — ses
« Règles pour l'IA » en tête font foi), la dernière entrée du journal
(où on en est — `grep -n '^## 20' docs/journal/*.md | tail -5`, puis Read avec `offset` et `limit`,
jamais le fichier entier), `git log --oneline -10` + `git status` (ce qui est en cours). Jamais le backlog du
dépôt legacy parent : il ne décrit pas hifago.

## Procédure
1. Lire les trois sources.
2. `$ARGUMENTS` : `done <point>` → retirer la ligne du backlog après avoir vérifié (commit ou code)
   que c'est réellement fermé, et le noter dans l'entrée de journal du jour ; `skip` → passer au
   point suivant ; vide → continuer.
3. Choisir l'action : d'abord ce qui **débloque** (« Bloquants externes », si Jérôme peut agir en
   2 minutes — déclarer une IP, autoriser une app), sinon l'arbitrage le plus ancien, sinon la
   dette la plus rapide à fermer. Une action humaine 🙋 en priorité ; si l'IA peut avancer en
   parallèle sur un point 🤖 sans risque (pas de push/deploy/données réelles/dépense), la démarrer
   immédiatement dans la session.
4. Mettre `docs/backlog.md` à jour AVANT de répondre.

## Format de sortie (STRICT — rien d'autre)

```
🎯 MAINTENANT : <l'action, une phrase impérative>
   ⏱️ Commence par (2 min) : <la micro-étape>
🤖 PENDANT CE TEMPS : <ce que l'IA vient de lancer / a préparé>   ← omettre s'il n'y a rien
⛔ Tout le reste attend. Fini ? → `/next done <point>` · Bloqué ? → `/next skip`
```

## Interdits
Proposer plusieurs options ou poser une question ouverte · choisir un point bloqué par une action
externe non faite (l'action donnée est alors celle qui débloque) · push / deploy / données réelles /
dépense sans GO explicite.

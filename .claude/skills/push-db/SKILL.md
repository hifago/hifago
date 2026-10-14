---
name: push-db
description: Pousse staging vers la préprod Hifago en une seule commande — migrations Supabase, Edge Functions puis code, dans l'ordre qui ne casse rien — attend le build Vercel et contrôle les fiches au rendu réel. Préprod uniquement, jamais la prod. Invocation Codex — $push-db ou $push-db dry-run
---

# /push-db — tout pousser vers la préprod (la base, puis le code)

Né de la panne du 2026-10-13 : du code lisant une colonne neuve est parti sur `staging` avant sa
migration, et toute fiche de la préprod a rendu « Algo salió mal ». L'ordre vit désormais dans
`scripts/deploy-preprod.mjs` (son en-tête dit quoi et pourquoi) — ne jamais le refaire à la main.

Trois commandes, un seul script. Jérôme n'a pas à choisir juste : aucune ne peut casser la préprod.

| Commande | Lance | Effet |
|---|---|---|
| `/push-db` | `node scripts/deploy-preprod.mjs all` | base + code |
| `/push` | `… code` | code ; si une migration est en attente, elle part d'abord, d'elle-même |
| `/upload-db` | `… db` | base seule (migrations, Edge Functions), aucun `git push` |

Argument `dry-run` (les trois) : ajoute `--dry-run` — dit ce qui partirait, ne pousse rien.

## Ce que vaut la commande

Quand **Jérôme** tape l'une des trois, c'est son accord explicite pour écrire sur la **préprod**,
pour cette exécution (`CLAUDE.md` §8.3). Ça ne vaut ni pour la prod, ni pour une session qui
déciderait seule de lancer le script. Le compte est vérifié par le script lui-même (§8.1).

## Procédure

1. **Committer ce qui est fini.** Jérôme committe « de temps en temps » et attend que son travail
   parte. `git status --short`, puis un commit par sujet (le journal du jour dit ce qui est
   terminé). Ce qu'une autre session est visiblement en train d'écrire (aucune entrée de journal,
   fichier modifié à l'instant) reste dehors — le nommer en une ligne dans le compte rendu.
2. **Données.** Le script n'envoie que du schéma. Si le lot contient une donnée qui doit exister
   en préprod — fichier `mockData/` ajouté ou modifié, `UPDATE` passé à la main sur la base
   locale — l'écrire en **migration idempotente** (clé métier : slug, jamais un uuid local) AVANT
   de pousser. Si cela demande un choix de produit, poser UNE question à Jérôme, puis finir.
3. **Lancer le script**, délai d'au moins 15 min (contrôles, puis build Vercel).
4. **Selon le code de retour** — corriger et relancer, jamais s'arrêter sur un « reste à faire » :
   - `0` : tout est vert ;
   - `3` : fichiers de base non commités → étape 1, relancer ;
   - `2` : précondition. En retard sur `origin` → `git pull --rebase origin staging` ; CLI non
     connectée → seul Jérôme peut : `npx.cmd supabase login` (PowerShell refuse `npx` sur son poste) ;
   - `1` : lire l'étape en échec. `verify` rouge ou build Vercel en échec → corriger le code,
     committer, relancer (la base déjà poussée ne gêne pas : le script repart de l'état réel).
5. **Compte rendu** en quelques lignes : ce qui est parti, les pages contrôlées, et s'il y en a, ce
   qui est resté non commité. Puis l'entrée de journal habituelle.

## Ce que la commande n'emporte jamais

- **La prod** : PR `staging → main` et geste manuel (`CLAUDE.md` §7.2, runbook §4).
- **`mockData/` et `seed.sql`** : la préprod porte les partenaires réels de la v1 ; ceux de
  `mockData/` ont tous une adresse `@mock.hifago.test`, donc `/hifago-mock-data preprod` y
  recréerait chaque partenaire en double (clé d'idempotence = e-mail).
- **Secrets, Vault, configuration de l'Auth** : runbook §2 et §3.

## Ce qui est normal

- Les Edge Functions redéployées au premier lancement d'un clone, puis seulement quand
  `supabase/functions`, `packages/domain` ou `config.toml` changent.
- Un `git push` tapé à la main vers `staging` refusé par le hook `pre-push` quand il porte une
  migration : c'est la garde, pas une panne — passer par l'une des trois commandes.
- Si le classifieur de permissions refuse le script alors que Jérôme vient de taper la commande :
  le lui dire, il le lance lui-même (`node scripts/deploy-preprod.mjs all`) — ne pas contourner.

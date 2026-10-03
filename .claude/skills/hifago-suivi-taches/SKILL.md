---
name: hifago-suivi-taches
description: Ajoute une tâche, ou marque une ligne existante comme faite ou attribuée, sur la grille de suivi partagée Gabriel/Jérôme (com-dev/suivi-taches-beta-hifago/) — l'artifact Claude.ai publié. Invocation Codex — $hifago-suivi-taches [texte] ou $hifago-suivi-taches fait [id] [gabriel ou jerome]
---

# /hifago-suivi-taches — grille de suivi partagée

La grille (`com-dev/suivi-taches-beta-hifago/index.html`) est un artifact Claude.ai publié que
Gabriel et Jérôme éditent eux-mêmes en direct (Fait, Attribué, Human check) — ce skill sert à ce
que l'interface ne permet PAS de faire seule : ajouter une ligne, ou la marquer depuis Claude Code
sans relire toute la grille (~2500 lignes). Contexte complet et URL de l'artifact :
`com-dev/suivi-taches-beta-hifago/README.md`.

**Deux procédures distinctes selon la demande — lire celle qui correspond, pas les deux.**

## Ce qui ne doit JAMAIS arriver

⚠️ **Ne jamais publier `review.json` ou `taches.json` en même temps que la mise à jour.** Ces deux
fichiers contiennent l'état réel, en direct, coché par Gabriel/Jérôme via l'artifact — la copie
locale du dépôt n'est qu'un instantané de seed, presque certainement périmée. Le rôle de ce skill
est UNIQUEMENT de republier `index.html` (le contenu `window.GRILLE`) ; laisser les deux fichiers
de données hors du paramètre `files` de l'outil Artifact pour qu'ils soient conservés tels quels
côté serveur (« files you leave out are kept »).

⚠️ **Republier avec `url:` = l'URL de l'artifact existant**, jamais un `Artifact` publish sans
`url` (ça créerait un second artifact séparé, cassant le lien que Gabriel/Jérôme utilisent déjà).
Si cette conversation n'a pas encore lu ou publié cet artifact, l'outil refuse le publish tant
qu'on ne l'a pas lu (`action: "read"`) au moins une fois avant — le faire d'abord.

## Procédure A — Ajouter une tâche (texte libre, pas encore dans la grille)

1. Lire `com-dev/suivi-taches-beta-hifago/README.md` pour l'URL de l'artifact publié, puis
   `Artifact(action: "read", url: <cette URL>)` pour confirmer l'accès (obligatoire avant tout
   publish dans une conversation qui n'a pas déjà cet artifact en contexte).
2. Lire `com-dev/suivi-taches-beta-hifago/index.html`, repérer le tableau `window.GRILLE`.
3. Si une section `{ id: "ajoutees", n: "A", title: "Tâches ajoutées après coup", rows: [] }`
   n'existe pas encore en toute fin de tableau (juste avant le `];` de fermeture), la créer.
4. Choisir un id `add-N` (N = plus grand `add-` existant + 1, ou `add-1` si aucun) — jamais un id
   déjà pris par une des 100 lignes d'origine (`nav-`, `acc-`, `cmp-`, etc.).
5. Ajouter la ligne dans `rows` de la section `ajoutees` :
   `{ id: "add-N", t: "<texte de la tâche, tel que demandé>", v: [] }`
   (pas de verdict : ce n'est pas une ligne d'audit, `v: []` suffit — le rendu gère un tableau
   vide sans problème). Si une section existante correspond clairement mieux (ex. « Camps » pour
   une tâche sur les camps) et que ça a été demandé explicitement, l'y ajouter à la place plutôt
   que dans `ajoutees` — sinon, toujours `ajoutees` par défaut, pour rester prévisible d'une
   session à l'autre.
6. Republier UNIQUEMENT `index.html` :
   `Artifact(file_path: ".../index.html", url: <URL de l'artifact>)` — sans `files`, sans
   `capabilities`, sans `favicon` (tout est conservé tel quel par défaut sur une mise à jour).
7. Committer la modification locale d'`index.html` si Gabriel le demande (jamais par défaut,
   comme pour tout commit dans ce dépôt).

## Procédure B — Marquer une ligne comme faite/attribuée (id déjà connu)

Chaque ligne affiche son id (petit tag mono, ex. `cmp-4`) sous la colonne Tâche — si on te donne
un id directement, ne relis NI `index.html` NI la grille en entier : ce serait ~2500 lignes pour
changer deux champs.

1. Lire `com-dev/suivi-taches-beta-hifago/README.md` pour l'URL de l'artifact, puis
   `Artifact(action: "read", url: <cette URL>)` si cette conversation ne l'a pas déjà en contexte
   (même obligation qu'en Procédure A).
2. Lecture CIBLÉE, jamais la page entière : `Artifact(action: "read_file", url: <URL>, path:
   "taches.json")` — quelques Ko, contient uniquement `{ rows: { <id>: { done, who, t } } }`.
3. Dans l'objet lu, fusionner sur l'id donné : `done: true` si "fait"/"résolu"/"corrigé" ;
   `who: "gabriel"` ou `"jerome"` si précisé (sinon laisser tel quel) ; `t: <horodatage ms>`.
   Aucun `Date.now()` disponible ? Utiliser `date +%s%3N` en Bash pour l'horodatage.
4. Republier UNIQUEMENT ce fichier, jamais `index.html` ni `review.json` :
   `Artifact(file_path: <chemin local index.html, INCHANGÉ>, url: <URL de l'artifact>, files:
   {"taches.json": {content: <JSON mis à jour>, contentType: "application/json"}})`. `file_path`
   reste obligatoire pour l'outil mais son contenu ne doit pas bouger — seul `taches.json` change.
5. Si l'id donné n'existe dans aucune ligne (faute de frappe probable), le dire à Gabriel plutôt
   que de deviner ou de créer une entrée orpheline.
6. Pas de commit git nécessaire ici : `taches.json` local reste un seed volontairement figé (même
   logique qu'en Procédure A) — rien à committer pour une donnée qui ne vit que côté artifact.

⚠️ Risque rare mais réel : si Gabriel/Jérôme cochent la MÊME ligne dans le navigateur pile au même
moment, la publication peut recevoir `conflict` — relire `taches.json` et refaire l'étape 3-4 une
fois, jamais forcer.

## Ce qui n'est délibérément PAS fait

- Pas de champ Verdict/Human check pour une ligne ajoutée à la main — ces colonnes restent
  réservées à l'audit original de Jérôme.
- Pas de pré-remplissage de Fait/Attribué à l'ajout : la ligne démarre neutre (comme toutes les
  lignes tant que personne n'a cliqué), Gabriel/Jérôme l'assignent eux-mêmes depuis l'artifact.

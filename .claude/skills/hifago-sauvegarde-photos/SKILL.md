---
name: hifago-sauvegarde-photos
description: Sauvegarde locale des photos du catalogue Hifago en ligne (prod ou préprod) dans la photothèque de Jérôme, hors dépôt — ne télécharge que ce qui manque, reconnaît une image déjà présente même dans une autre taille, range tout à plat dans Photos avec le nommage partenaire_rubrique_sujet_NN_description, décrit chaque nouvelle photo d'après l'image, régénère l'index et la page d'aperçu. Lecture anonyme uniquement. Invocation Codex — $hifago-sauvegarde-photos, $hifago-sauvegarde-photos preprod, appliquer ou index
---

# /hifago-sauvegarde-photos — rapatrier les photos du site et les ranger

Les photos des partenaires ne vivent que dans le Storage du site. Ce skill en garde une copie sur
le disque de Jérôme, rangée comme la photothèque posée à la main le 2026-10-12 (journal) : il veut
retrouver une photo **par la recherche Windows, sans ouvrir de dossiers**. Tout tient donc dans le
nom du fichier.

```
<dest>/                       par défaut ../Assets à côté du dépôt (ou HIFAGO_ASSETS_DIR)
  Photos/                     les photos du catalogue — le SEUL dossier que ce skill remplit
  Marque/                     logos, motifs, charte : rangé à la main par Jérôme, jamais touché
  _a-classer/                 transit : nouvelles photos en attente de description
  index-photos.csv            une ligne par fichier (Excel)
  apercu-photos.html          toutes les vignettes, filtre par mots
  sauvegarde-etat.json        ce qui a déjà été traité — ne pas supprimer
```

## Argument `$ARGUMENTS`
| Valeur | Effet |
|---|---|
| (rien) ou `prod` | Sauvegarde depuis `https://hifago.co` |
| `preprod` | Depuis la vitrine de préprod |
| une URL `https://…` | Depuis cette vitrine (ex. le domaine Vercel de la prod avant la bascule) |
| `appliquer` | Reprend à l'étape 3 (des photos attendent déjà dans `_a-classer/`) |
| `index` | Régénère seulement `index-photos.csv` et `apercu-photos.html` |

L'outil reconnaît seul ce qui répond à l'URL : le portail v1 (tant qu'il sert `hifago.co`), la
vitrine du nouveau stack, ou un catalogue vide. Les adresses sont dans `conventions.json`
(`sources`) : à la bascule de `hifago.co`, rien à changer.

## Procédure
1. **Collecter**, depuis la racine `hifago/` :
   ```
   node .claude/skills/hifago-sauvegarde-photos/sauvegarde.mjs collecter --source prod
   ```
   Ajouter `--a-blanc` pour seulement voir ce qui serait fait. L'outil imprime le bilan : photos en
   ligne, déjà traitées, reconnues dans la photothèque, **nouvelles** (`+`), **en meilleure
   définition** (`↑`, remplaceront le fichier existant sous le même nom). S'il annonce des
   **erreurs, la sauvegarde est incomplète** : le dire à Jérôme, ne pas conclure.
   Zéro nouvelle et zéro meilleure : passer à l'étape 5.
2. **Regarder et décrire.** Ouvrir chaque `_a-classer/planche-NN.jpg` avec l'outil de lecture
   d'image de l'IA (Read côté Claude Code), puis remplir `description` dans
   `_a-classer/a-decrire.json`, une entrée par `n°` de la planche :
   - **2 à 4 mots de ce qu'on VOIT**, en français, minuscules, sans accents, séparés par des
     tirets : `terrasse-hamac-vue-lac`, `dortoir-lits-superposes-rideau-vert` ;
   - d'après l'image, jamais d'après le nom de la fiche ni un ancien nom de fichier ;
   - écrire chaque mot comme Jérôme le taperait (voir « Nommage ») ;
   - reprendre les mots déjà en usage : `piedra-penol`, `lac`, `terrasse`, `dortoir`, `affiche`
     (chercher dans `index-photos.csv` avant d'inventer un synonyme) ;
   - une entrée `remplace` garde la description du fichier qu'elle remplace : ne pas y toucher.
   `partenaire`, `sujet` et `numero` y sont modifiables si le calcul est mauvais ; dans ce cas,
   reporter aussi la correction dans `conventions.json` pour les fois suivantes.
3. **Appliquer** :
   ```
   node .claude/skills/hifago-sauvegarde-photos/sauvegarde.mjs appliquer
   ```
   L'outil refuse une description vide ou mal formée, un nom déjà pris, un fichier disparu. Il
   range les photos dans `Photos/`, vide `_a-classer/`, régénère l'index et l'aperçu.
4. **Montrer** : ouvrir `apercu-photos.html` dans le navigateur de Jérôme
   (`Invoke-Item <dest>\apercu-photos.html` sous PowerShell, `open` sous macOS) pour qu'il valide
   les nouveaux noms. Jamais un simple lien : hors du workspace, il ne s'ouvre pas depuis le chat.
5. **Rendre compte** : source lue, nombre de photos en ligne, ajoutées, remplacées, erreurs.

## Nommage
`partenaire_rubrique_sujet_NN_description.ext` — exemple :
`bania_hebergement_casa-completa_02_terrasse-canape-piscine-lac.jpg`.

| Champ | Vient de | Règle |
|---|---|---|
| `partenaire` | slug de l'établissement | tel quel (`casa-kayam`), sauf alias de `conventions.json` (`bania`) |
| `rubrique` | rubrique du site | `hebergement`, `activite`, `evenement`, `transport`, `camp`, `etablissement` |
| `sujet` | slug de la fiche | celui de `conventions.json`, sinon le slug sans mots creux (4 mots au plus) |
| `NN` | ordre d'affichage sur la fiche | le numéro suivant s'il est pris |
| `description` | l'image | étape 2 |

Vérifié sur l'index Windows de la machine de Jérôme (2026-10-12) : le tiret, le souligné et
l'espace séparent les mots, et **un mot ne se trouve que par son début**. D'où `casa-kayam` (sinon
« kayam » ne trouve rien) et `jetski` en un mot (sinon « jetski » ne trouve rien).

`conventions.json` porte les décisions prises à la main : alias de partenaires, sujets raccourcis,
et les événements de la ville rangés sous `guatape` bien que le site les rattache à Casa Kayam.
Une nouvelle fiche au slug interminable s'y ajoute en une ligne.

## Ce que l'outil garantit
- **Une seule version par image.** Une photo déjà présente est reconnue même réencodée ou dans une
  autre taille (empreinte de contours + couleurs + proportions ; seuils et marges mesurés dans
  l'en-tête de `memeImage`). La même photo sur l'établissement et sur son produit n'est gardée
  qu'une fois, sous le nom du produit.
- **Rien n'est renommé ni supprimé** dans `Photos/` : un fichier n'est remplacé que par la même
  image en plus grande (+15 % de pixels au moins), sous le même nom.
- **Une photo retirée à la main ne revient pas** : `sauvegarde-etat.json` s'en souvient. `--tout`
  réexamine tout, et la ferait donc revenir.
- **Une photo retirée du site reste** dans la photothèque : c'est une sauvegarde.

## Pièges connus
- **Les anciens noms mentent.** Dans le dépôt v1, `02-bania-terraza-hamacas…` montrait la
  terrasse-piscine et `06-…-pared-verde` la chambre au balcon. D'où la règle de l'étape 2.
- **La vitrine est lue par son JSON-LD** (`image` de chaque fiche, dans l'ordre), son fil d'Ariane
  et son `sitemap.xml`. Si une page change de forme, l'outil le dit (« aucun JSON-LD de fiche »,
  « rubrique introuvable ») et sort en erreur plutôt que de deviner : corriger l'adaptateur.
- **`collecter` refuse de tourner** tant que `_a-classer/a-decrire.json` existe : finir par
  `appliquer` (ou `appliquer --sans-description`, qui range les photos sans description).
- La préprod porte les données réelles de la v1 (journal du 2026-10-03) : `preprod` et `prod`
  donnent aujourd'hui presque les mêmes photos, reconnues comme telles.
- `sharp` est résolu depuis `apps/admin` : lancer `npm install` à la racine sur un clone neuf.

## Ce que ce skill ne fait pas
- **Aucun accès authentifié.** Pages et fichiers publics, comme un visiteur : pas de jeton, pas de
  `service_role`, pas de CLI ni de MCP (`CLAUDE.md` §8). Il ne voit donc **pas** les photos des
  fiches non publiées.
- **Pas de documents.** Le Storage ne porte aujourd'hui que deux buckets publics d'images
  (`catalog-media`, `establishment-photos`). Le jour où un bucket privé de documents existe, sa
  sauvegarde touche à des données personnelles et à `service_role` : c'est un arbitrage de Jérôme,
  pas une extension silencieuse de ce skill.
- Il ne touche ni `Marque/`, ni aucun autre dossier de la destination, ni le dépôt.
- Il ne sauvegarde ni la base ni le code : uniquement les images du catalogue.

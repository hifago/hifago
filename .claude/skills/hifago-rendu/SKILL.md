---
name: hifago-rendu
description: Capture le rendu réel d'écrans de la vitrine Hifago dans Storybook (Playwright + Edge, sans Docker) à 360/390/1280 px, dans la police de production (Anton), relève débordement horizontal, titres, boutons, champs, et compare avant/après au pixel. Invocation Codex — $hifago-rendu [écran ou storyId…] [avant ou apres] [--largeurs 360,390,1280] [--mesure], ou $hifago-rendu compare
---

# /hifago-rendu — regarder le vrai rendu, pas le supposer

Un écran n'est pas fini tant qu'on ne l'a pas **vu**. C'est une règle du projet
(`.claude/rules/ui.md` : « vu à 390 × 844 et 1 280 × 900 » ; `.claude/rules/orchestration.md` : « l'impression
du rendu réel au lieu de sa supposition »). jsdom n'applique ni les media queries ni les polices :
seul un navigateur dit si une page déborde, quelle police s'affiche, quel rayon a un bouton. Ce skill
fait les captures et les mesures qui ont servi au plan `docs/specs/41-charte-hifago-toute-la-vitrine.md`.

## Argument `$ARGUMENTS`
| Valeur | Effet |
|---|---|
| `<écran>` (voir la table plus bas) ou `<storyId…>` | Capture à 390 et 1 280 px, avec relevés (`--mesure`) |
| `… avant` / `… apres` | Range les captures dans `<scratchpad>/rendu/avant` ou `…/apres` (pour comparer) |
| `--largeurs 360,390,1280` | Largeurs voulues (360 pour traquer le débordement) |
| `compare` | Compare `rendu/avant` et `rendu/apres` au pixel, fichier par fichier |

Sans argument : demander quel écran.

## Prérequis
1. **Storybook** sur le port 6006 : `curl -s -o /dev/null -w "%{http_code}" http://localhost:6006/index.json`
   doit rendre 200. Sinon, le lancer **en arrière-plan** (`npm run storybook -w @hifago/web`), et attendre
   que l'index réponde. Ne jamais lancer un second Storybook si le port est déjà pris : c'est peut-être
   celui de Jérôme ou d'un autre agent.
2. **Microsoft Edge** installé. Aucun navigateur Playwright n'est téléchargé sur cette machine : le
   script passe par le canal `msedge`. Ne pas lancer `npx playwright install` sans accord.
3. Les captures vont dans le **scratchpad** de la session (`<scratchpad>/rendu/…`), **jamais dans le
   dépôt**.

## Procédure
1. Traduire l'écran en identifiants de stories (table plus bas, ou
   `curl -s http://localhost:6006/index.json`, puis filtrer les entrées `Écrans/…`).
2. Lancer l'outil depuis la racine `hifago/` :
   ```
   node .claude/skills/hifago-rendu/capture.cjs --out <scratchpad>/rendu/avant \
     --largeurs 360,390,1280 --mesure --decoupe 1100 <storyId> [<storyId>…]
   ```
   L'outil force la langue espagnole et le rayon de production dans l'URL
   (`globals=radius:piste;locale:es`, où `piste` est le preset de rayon de production). La charte
   Hifago adoptée est l'unique palette de la vitrine et reste claire.
   Il imprime une ligne JSON par capture : largeur de page contre largeur de vue, liste des `<h1>`,
   images `priority`, titres (police, taille, graisse), boutons (rayon, hauteur), champs, et des
   **alertes** :
   - débordement horizontal ;
   - nombre de `<h1>` différent de 1 ;
   - police de titre sous 20 px ;
   - faux gras ;
   - cible sous 44 px ;
   - plusieurs rayons de bouton ;
   - plus d'une image `priority`.
3. **Regarder** les images avec Read : les tranches `-NN.png` d'une page longue, une par une. Décrire ce
   qu'on voit ; ne jamais conclure sur les seuls chiffres.
4. Après une modification, refaire les mêmes captures dans `rendu/apres`, puis comparer :
   `node .claude/skills/hifago-rendu/capture.cjs --compare <scratchpad>/rendu/avant <scratchpad>/rendu/apres`.
   Le résultat est « IDENTIQUE », un pourcentage de pixels différents, ou une taille différente. Pour un
   item qui doit laisser l'accueil **identique au pixel**, c'est la preuve attendue.
5. Rendre compte à Jérôme : les captures clés à 390 et 1 280 px (Read), les alertes, et ce qui a changé.
   Dès qu'il doit choisir ou valider, **lui ouvrir les images dans son navigateur** (demande du
   2026-10-02) : une page HTML du scratchpad qui les regroupe (chemins relatifs, une légende par image,
   la recommandation en tête), ouverte par `Invoke-Item <chemin>.html` (PowerShell). Jamais un lien
   vers un PNG du scratchpad : hors du workspace, il ne s'ouvre pas depuis le chat.

## Écrans → stories principales
| Écran | Stories (préfixe `ecrans-`) |
|---|---|
| accueil | `accueil--defecto`, `accueil--sin-resultados`, `accueil--con-criterios`, `accueil--calendario-abierto` |
| index | `index-par-type--actividades`, `--alojamientos`, `--alojamiento-para-camp`, `--sin-resultados` |
| categorie | `categorie--con-descripcion`, `--cargar-mas`, `--otras`, `--error-al-cargar` |
| fiche-produit | `fiche-produit--actividad-con-franjas`, `--actividad-con-fecha`, `--camp`, `--alojamiento-pms`, `--alojamiento-rango-elegido`, `--transporte`, `--evento-vitrina`, `--precio-consultar-sin-foto` |
| fiche-etablissement | `fiche-etablissement--completa`, `--minima`, `--sin-ofertas` |
| mi-viaje | `mi-viaje--viaje`, `--vacio`, `--linea-no-disponible`, `--camp-sin-alojamiento` |
| pago | `pago--invitado`, `--telefono-invalido`, `--cupo-agotado` |
| resultat | `resultat-reservation--por-pagar`, `--pagado`, `--expirado`, `--lineas-mixtas` |
| reservas | `mes-reservations--todas-las-variantes`, `--sin-reservas`, `--confirmar-anulacion` |
| perfil | `mon-profil--perfil-completo`, `--supresion-confirmacion` |
| auth | `connexion--formulario`, `inscription--formulario`, `mot-de-passe-oublie--correo-enviado`, `verification-email--con-email` |
| erreurs | `erreurs--pagina-no-encontrada`, `erreurs--error-en-la-vitrina` |
| coquille | `coquille-siteheader--defaut`, `coquille-siteheader--transparente`, `coquille-sitefooter--defaut` (sans préfixe `ecrans-`) |

L'inventaire complet (128 états) est dans `apps/web/components/README.md`, et la table écran → e2e
au §8 du plan.

## Pièges connus
- **Une seule police de titre** : Anton, confirmée par Jérôme le 2026-10-02. Storybook ne charge plus
  la Sugo Pro Display d'essai, et l'option `--prod` qui la bloquait a disparu (l'outil refuse toute
  option inconnue). Les captures plus anciennes du plan 41 montrent encore la Sugo, avec des chiffres
  en glyphes de filigrane.
- La vitrine Storybook expose une seule charte claire. Ne pas ajouter de global de palette ou de
  mode aux commandes de capture.
- `globals=locale:en` dans l'URL n'a pas basculé la langue lors d'un essai du 2026-10-02 (journal). Pour
  l'anglais, utiliser la barre d'outils et vérifier à l'œil.
- Une story peut garder une requête **volontairement pendante** (état « en cours ») : l'outil
  n'attend jamais `networkidle` plus de 8 s.
- Un « 0 alerte » ne prouve pas un contraste : les couleurs composées se mesurent dans la story
  `Playground/Palette → Contrastes`, à capturer elle aussi quand un jeton change.

## Ce que ce skill ne fait pas
- Il ne modifie aucun fichier du dépôt.
- Il ne lance pas les tests : c'est `/hifago-test`.
- Il ne décide d'aucun arbitrage visuel : il montre, Jérôme tranche.

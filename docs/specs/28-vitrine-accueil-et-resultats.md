---
id: specs-vitrine-accueil-et-resultats
titre: "Vitrine : l'accueil, qui est aussi l'écran de résultats de recherche"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: implemente
reste: >
  Les 3 tranches sont livrées (Tranche 3 le 2026-09-13). Un seul point reste ouvert : le carrousel
  de la carte d'activité dans un visuel de 64 px (§10bis) — décision visuelle, à voir dans
  Storybook avant de coder. Le décompte de couchages sur la carte groupée, autrefois listé ici,
  est refermé depuis le 2026-09-09 (commit 4be2b05 — `TarjetaOferta.tsx` rend `nAlojamientos`).
maj: 2026-09-13
resume: >
  Construit le premier écran du chantier front : l'accueil de la vitrine, qui porte le bloc de
  recherche et une section par type d'offre, et qui devient l'écran de résultats dès que des
  critères sont présents dans son URL.
mots_cles: [accueil, vitrine, recherche, sections, cartes, apps/web, search_catalog]
repond_a:
  - "Que montre l'accueil de la vitrine, et comment la recherche s'y branche-t-elle ?"
  - "Que contient une carte d'offre, et en quoi celle d'une activité diffère-t-elle ?"
---

# Vitrine : l'accueil, qui est aussi l'écran de résultats de recherche

> **Cible stack** : hifago. **Premier écran** du chantier front. S'appuie sur la spec 27
> (routes, coquilles, `lib/catalog/`, `search_catalog`) : elle doit être livrée avant.
>
> **Révisée en profondeur le 2026-09-07** après un audit adversarial (28 agents, 14 trouvailles
> confirmées sur 24). Ce que l'audit a changé est signalé dans le texte ; le récit est dans
> `docs/journal/2026-09.md`.
>
> **✅ Validée par Jérôme le 2026-09-07.** Le `statut: brouillon` du frontmatter décrit l'état
> d'**implémentation** (rien n'est encore construit), pas l'état de validation — cf.
> `docs/specs/README.md`.

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 0 | **Contrat compact** | ✅ validé 2026-09-07 |
| 1 | Contexte et problème | ✅ validé 2026-09-07 |
| 2 | Portée et tranches | ✅ validé 2026-09-07 |
| 3 | Décisions retenues | ✅ validé 2026-09-07 |
| 4 | Parcours cible | ✅ validé 2026-09-07 |
| 5 | L'écran, bloc par bloc | ✅ validé 2026-09-07 |
| 6 | Modèle de données (delta) | ✅ validé 2026-09-07 |
| 7 | Contrat — URL, données, composants | ✅ validé 2026-09-07 |
| 8 | Règles et invariants | ✅ validé 2026-09-07 |
| 9 | Cas limites | ✅ validé 2026-09-07 |
| 10 | Décisions tranchées / points ouverts | ✅ validé 2026-09-07 |
| 11 | Annexe — traçabilité | ✅ validé 2026-09-07 |
| 12 | Documents liés | ✅ validé 2026-09-07 |

---

## 0. Contrat compact (pour coder — lire seul, sans le reste)

### Route et paramètres

`app/[locale]/(vitrine)/page.tsx` → `/es`, `/en`. Zone vitrine, **indexable**, rendu **dynamique**.

| Paramètre | Type | Effet |
|---|---|---|
| `q` | texte | cherche dans **le nom de l'offre, le nom de son établissement et les libellés de ses tags** — jamais le libellé du type, qui n'est qu'une chaîne d'interface |
| `tipo` | `activity\|lodging\|transport\|camp\|evento` | restreint à ce type |
| `tag` | slug de `catalog_tags` | restreint aux offres portant ce tag |
| `personas` | entier ≥ 1 | voir « Sens de `personas` » ci-dessous |
| `desde`, `hasta` | `YYYY-MM-DD` | **chevauchement** de période, jamais inclusion |

**Sens de `personas` — une intention, trois colonnes** (tranché le 2026-09-07) : « l'offre marche
pour n personnes ».

| Type | Prédicat |
|---|---|
| `lodging` | `capacity >= n` — combien de personnes y dorment |
| `activity`, `camp`, `transport`, `evento` | `max_qty is null or max_qty >= n` — combien on peut en réserver |

Jamais `capacity` sur un non-logement : cette colonne y désigne le cupo d'une date, pas la taille
d'un groupe.

**Normalisation des paramètres** (aucun n'échoue jamais, tous sont ignorés s'ils sont invalides) :
une seule date → la période est **ce jour-là** · `hasta < desde` → les deux ignorés · `personas`
non entier ou < 1 → ignoré · `tipo`/`tag` inconnu → ignoré · un paramètre à sa valeur par défaut
n'est **jamais écrit** dans l'URL.

Le canonical de l'accueil **ignore les paramètres** (déjà en place, posé pour `?ref=`).

### Arbre de la page

⚠️ **`SearchPanel` a des fonctions dans ses props** : le rendre depuis un Server Component lève une
erreur de sérialisation à l'exécution. Il lui faut un hôte client, que voici.

```
(vitrine)/layout.tsx        SiteHeader · SiteFooter          (spec 27 — ne pose PAS <main>)
└─ page.tsx                 Server Component
   ├─ buscarSecciones(…)    LA seule requête
   ├─ generateMetadata      titre, description, canonical    (repris de l'ancien accueil)
   ├─ JsonLd WebSite        rendu serveur                    (repris de l'ancien accueil)
   └─ PageShell variant="large"        pose l'unique <main>
      ├─ <h1> masqué visuellement      provisoire (§10)
      ├─ BuscadorInicio    "use client"  ← NOUVEAU : hôte de SearchPanel
      └─ SeccionOfertas × n              données déjà sérialisées
         └─ TarjetaOferta × 8
            └─ PhotoStrip                (molécule existante, pas un carrousel réécrit)
```

**Ordre des sections** : `activity`, `lodging`, `transport`, `camp`, `evento`. *(Le
réordonnancement selon le panier part en Tranche 3 — voir §2.)*
**Ordre dans une section** : `created_at desc` — les plus récentes d'abord.

### Données

Un seul appel : `buscarSecciones(criterios, { porSeccion: 8 })` (`lib/catalog/buscar.ts`).

```ts
type FotoTarjeta = { url: string };   // ⚠️ pas d'`alt` ici — voir ci-dessous

type PrecioTarjeta =
  | { tipo: "monto"; cop: number }     // price_cop
  | { tipo: "desde"; cop: number }     // établissement groupé
  | { tipo: "texto"; label: string }   // price_label (vitrine)
  | null;                              // aucun des deux

type TarjetaOferta = {
  clave: string;                 // `producto-<id>` | `establecimiento-<id>`
  href: string;                  // /productos/<slug> | /establecimientos/<slug>
  nombre: string;                // déjà résolu dans la locale
  establecimiento: string | null;
  precio: PrecioTarjeta;
  fotos: FotoTarjeta[];          // toutes, URL déjà résolues
  tipo: string;
  testId: string;                // `tarjeta-<slug>`
};

type Seccion = { tipo: string; tarjetas: TarjetaOferta[]; total: number };
```

`total` = nombre d'offres du type **avant** le plafond de 8 — il alimente le libellé « Ver más ».

### Modèle de données (delta)

| Objet | État | Détail |
|---|---|---|
| `search_catalog` — colonne `fotos jsonb` | **à ajouter** | `jsonb_agg(jsonb_build_object('storage_path', m.storage_path) order by m.sort)` sur `product_media` / `establishment_media` |
| `search_catalog` — colonne `precio_desde` | **à ajouter** | `min(p.price_cop) filter (where p.type='lodging' and p.sellable and p.price_cop is not null)` |
| `search_catalog` — colonnes `price_label`, `total_seccion` | **à ajouter** | `total_seccion = count(*) over (partition by tipo)` |
| `product_media`, `establishment_media` | réutilisés tels quels | policies publiques déjà en place ; **aucune colonne de texte alternatif** — voir §6 |
| `lib/supabase/publicClient.ts` | réutilisé | résolution `storage_path` → URL publique dans `buscar.ts`, **jamais** dans `page.tsx` |

Aucune table créée, aucune écriture ajoutée, aucune RPC `security definer`.

### Invariants

1. `page.tsx` n'appelle **aucune** requête Supabase et n'importe **rien** de `@hifago/ui`.
2. **Un seul `<main>`** — posé par `PageShell`, jamais par le layout de zone (§5).
3. Un seul `<h1>` ; les titres de section sont des `<h2>`.
4. Une section sans résultat n'est **pas rendue**.
5. Le plafond de 8 vaut **aussi** sous recherche ; « Ver más » emporte les critères.
6. **Seule la première image de chaque carrousel est chargée** ; `loading="priority"` sur la
   première carte de la première section, `"lazy"` partout ailleurs.
7. Le carrousel d'une carte passe par **`PhotoStrip`**, jamais par un `Carousel` remonté à la main.
8. Aucune couleur en dur ; aucune largeur en dur ; rien de masqué selon la largeur.
9. Tout lien passe par le `Link` de `@/i18n/navigation`.
10. Les critères de l'URL sont **les seuls** qui filtrent : aucun filtrage en mémoire.

### Cas limites

| Situation | Traitement |
|---|---|
| Aucun critère | les 5 sections, 8 cartes chacune |
| Critères, aucun résultat nulle part | état vide explicite sous la barre, la barre reste utilisable |
| Une section vide, les autres non | la section n'est pas rendue |
| Offre sans photo | `PhotoStrip` avec une liste vide → son état `AucunePhoto` |
| Offre sans prix chiffré ni `price_label` | aucun prix affiché, la carte reste valide |
| Établissement groupé dont **aucun** couchage n'a de prix chiffré | `precio = null` — jamais « desde 0 » |
| Paramètre invalide | ignoré, jamais d'erreur (voir « Normalisation ») |
| « Ver más » de la section activités | mène à `/es/actividades`, qui est un **index de tags** et non une liste d'offres (spec 29) — le libellé de ce lien diffère donc des quatre autres |

### Ce que le design system n'a pas encore

Trois manques, nommés ici plutôt que découverts en codant (convention posée le 2026-09-07 dans
`apps/web/components/README.md`) :

| Manque | Où | Quand |
|---|---|---|
| `SeccionOfertas` — titre, grille ou liste, lien « Ver más » | `organisms/` | **dans ce lot** |
| `TarjetaOferta` — les deux variantes de carte | `molecules/` | **dans ce lot** |
| `EstadoVacio` — le bloc « aucun résultat », qui **n'existe nulle part** aujourd'hui | `molecules/` | **dans ce lot** |
| Un visuel plus grand sur `Card layout="row"` | `atoms/Card.tsx` — **modifie un composant existant** | **lot à part**, après arbitrage visuel (§10) |

Les trois premiers ne servent que cet écran et ne demandent aucune décision visuelle : ils naissent
avec l'écran, chacun avec son test et sa story. Le quatrième touche un atome que d'autres écrans
utilisent déjà — il sort du lot, comme la convention l'exige.

### Fichiers touchés

**Créés** : `app/[locale]/(vitrine)/page.tsx` · `app/[locale]/(vitrine)/BuscadorInicio.tsx` ·
`components/organisms/SeccionOfertas.tsx` (supprimé par le plan 41, G5) · `components/molecules/TarjetaOferta.tsx` ·
`components/molecules/EstadoVacio.tsx` (chacun + test + story) · `lib/catalog/criterios.ts` · `lib/catalog/segmentos.ts` (table `tipo` → segment d'URL) ·
`e2e/home.spec.ts` · `supabase/migrations/<ts>_search_catalog_fotos_y_precios.sql`.
**Modifiés** : `messages/{es,en}/HomePage.json` · `lib/catalog/buscar.ts` ·
`supabase/seed.sql` — ⚠️ **il ne couvre pas le regroupement** : aucun établissement n'y a deux
couchages vendables (constaté sur base propre le 2026-09-07), donc l'e2e de l'accueil ne verrait
jamais de carte groupée. Le lot doit ajouter un second couchage à un établissement existant ·
`e2e/{reserve,reserve-lodging-range,attribution,cart-multi-establishment,establishment-page}.spec.ts`
(elles entrent par l'accueil, dont les sélecteurs changent).
**Supprimés** : `app/[locale]/page.tsx`, `app/[locale]/CatalogBrowser.tsx` et son test — **après**
avoir repris leur `generateMetadata` et leur `JsonLd`.

---

## 1. Contexte et problème

L'accueil actuel est un **catalogue à plat** : `page.tsx` (186 l.) fait trois requêtes séquentielles
et soixante lignes de regroupement, puis passe le tout à `CatalogBrowser` (125 l.), qui filtre
**en mémoire côté client**. Son propre commentaire l'assume : « la recherche/le filtre restent
volontairement basiques — pas de recherche géo/tags, cible différée ».

En face, `SearchPanel` est construit depuis le 4 septembre et **n'est branché nulle part**. Son
fichier documente le manque : « il n'existe pas encore de route de recherche pour porter les dates
et le nombre de personnes ».

Le §2a du cahier client, validé le 2026-09-07, tranche les deux d'un coup : **l'accueil et l'écran
de résultats sont la même page**, les critères vivent dans son URL, et les résultats restent
groupés par type.

## 2. Portée et tranches

**Tranche 1 — l'accueil.** La page, l'hôte client du bloc de recherche, les cinq sections, les deux
variantes de carte, le contrat d'URL, le prix « desde ». **Livrable** : le catalogue s'affiche, on
cherche, on filtre, on clique.

**Tranche 2 — les suggestions de la barre.** `SearchBar` accepte une liste vide, et `Entrée` soumet
toujours le texte tapé — c'est son contrat. La recherche est donc complète sans elles.

**Tranche 3 — le réordonnancement des sections selon le panier, et le retour à l'accueil qui le
déclenche. ✅ Livrée le 2026-09-13** — voir §10sexies pour le contrat complet.
⚠️ **Sortie de la Tranche 1 le 2026-09-07, sur constat d'infaisabilité** : deux raisons cumulées,
trouvées par l'audit. `CartLine` ne portait pas le type de l'offre, et le panier était un état
**client** que `page.tsx`, Server Component, ne pouvait pas lire. Les deux sont résolues par les
specs 31 (identité anonyme) et 32 (panier en base, `cart_items.product_id` joint à
`products.type`), livrées le 2026-09-10 — ce qui a débloqué cette tranche.

**Out.** Les pages de listing et l'index de tags (spec 29) · les fiches (spec 30) · le tunnel · le
compte · la recherche géographique, différée · les tokens du thème `vitrine` et les polices Geist.

## 3. Décisions retenues

Actées au cahier §2a et §2b.5 ou tranchées le 2026-09-07, non rouvertes ici :

- Une section par type, cinq au total ; camps et eventos jamais fusionnés ; activités d'abord.
- Huit offres par section, un « Ver más », **section vide non affichée** — y compris sous recherche.
- Carte = carrousel · nom · prix · établissement.
- **`personas` = capacité déclarée**, avec la colonne juste de chaque type ; **dates =
  chevauchement**. La recherche n'interroge donc aucune disponibilité et **jamais LobbyPMS**.
- Un établissement apparaît comme une seule offre **dès deux couchages vendables**.
- **Ordre dans une section : `created_at desc`** — les nouveautés remontent, l'ordre est stable
  d'un chargement à l'autre, et ça reste un point d'extension isolé.
- **Texte alternatif d'une photo : `<nom de l'offre>, foto <i> de <n>`** — aucune colonne à créer,
  et chaque photo reste distinguable pour un lecteur d'écran.

## 4. Parcours cible

1. **Arrivée sans critère** — cinq sections, huit cartes chacune.
2. **Le visiteur tape et valide** — `BuscadorInicio` reçoit les critères de `SearchPanel` et
   **navigue vers l'URL de la page** enrichie des paramètres. Le serveur re-rend.
3. **Il clique une carte** — vers la fiche. L'URL de destination **ne porte pas les critères**
   (spec 27) ; le calendrier de la fiche se pré-remplit depuis la mémoire du navigateur.
4. **Il clique « Ver más »** — vers `/es/<segmento>` **avec les critères**.
5. **Il ajoute au panier depuis une fiche** (Tranche 3) — redirection immédiate ici, critères
   conservés, sections réordonnées selon le panier (§10sexies).

## 5. L'écran, bloc par bloc

**L'unique `<main>`.** ⚠️ **Corrigé le 2026-09-07** : la spec 27 décrivait un `<main>` dans
`(vitrine)/layout.tsx`, or `PageShell` en pose déjà un — deux `<main>` imbriqués sont une faute de
structure et un défaut d'accessibilité. **Le layout ne pose que `SiteHeader` et `SiteFooter`** ;
c'est la page qui pose son `<main>` via `PageShell`, comme l'atome a été construit pour le faire
(« L'unique `<main>` d'une page »). La spec 27 doit être corrigée du même geste.

**Le titre.** Un seul `<h1>`, **provisoirement masqué visuellement** mais présent dans le DOM :
l'accueil du cahier §2a ne porte rien au-dessus du bloc de recherche, et une page sans `h1` est une
faute d'accessibilité comme de référencement. Masquer **visuellement** n'est pas le `hidden
md:block` interdit, qui retire le contenu de l'index mobile.
**État de transition** : Jérôme a indiqué qu'un **bloc titré** viendra plus tard au-dessus du bloc
de recherche ; le jour où il existe, la seule chose à retirer est la classe de masquage.
**Levé le 2026-10-02** (seconde maquette de l'accueil) : le bloc titré existe — « Guatapé merece
más de un día. » est le `<h1>` VISIBLE de `PortadaInicio`, suivi d'un sous-titre (`HomePage.lema`) ;
le logo du héros est redevenu un décor. Journal `docs/journal/2026-10.md`, même date.

**`BuscadorInicio` — l'hôte client.** ⚠️ Sans lui, l'écran ne compile pas : toutes les props de
`SearchPanel` (`onSubmit`, `onCriteriaChange`, `onSuggestionSelect`) sont des fonctions, et un
Server Component ne peut pas les sérialiser. `BuscadorInicio` porte `"use client"`, reçoit les
critères initiaux et les libellés **déjà traduits** en props sérialisables, tient l'état du panneau,
et pousse la nouvelle URL au `onSubmit` via le `useRouter` de `@/i18n/navigation`.
⚠️ Il fournit aussi `aujourdIso` à `SearchPanel` — **calculé dans le fuseau `America/Bogota`** via
`bogotaDates` de `@hifago/domain`, seule échappatoire autorisée à la règle de lint sur les dates
(§11.20, `scripts/check-timezone.sh`).

**Une section.** `SeccionOfertas` : un `<h2>`, une grille ou une liste, un lien « Ver más ».
Grille : **1 colonne** en mobile, 2 à partir de `md`, 3 à partir de `lg`. Aucune largeur en dur.

**Deux variantes de carte.**

| Section | Variante | Forme |
|---|---|---|
| Activités | `Card layout="row"` | visuel à gauche, texte à droite — **une liste** |
| Les quatre autres | `Card layout="stack"` | photos à fleur de carte, texte dessous, ratio `4/3` |

**Emplacement des champs** : le **nom** est le titre de la carte (`titleAs="h3"`, sous le `<h2>` de
la section) · l'**établissement** est le `subtitle` · le **prix** est le contenu.

**Les photos passent par `PhotoStrip`.** ⚠️ **Corrigé le 2026-09-07** : la première rédaction
faisait construire un carrousel dans la carte, alors que la molécule `PhotoStrip` existe depuis le
4 septembre et a été bâtie exactement pour ça (`Carousel` de `@hifago/ui` + `next/image`). La
réécrire aurait été une rupture de la règle « un composant qui duplique quelque chose d'existant ».

**Le chargement des images.** Cinq sections de huit cartes peuvent monter à plusieurs centaines
d'images. Seule la **première** de chaque carrousel est chargée ; les suivantes à l'interaction.
La toute première carte de la première section porte `loading="priority"` (c'est elle, le LCP).
`sizes` suit la grille : `(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw`.

**Les métadonnées et le JSON-LD.** ⚠️ L'ancien `page.tsx` porte un `generateMetadata` (titre,
description, **canonical auto-référent** — celui qui rassemble les variantes `?ref=` et désormais
`?q=`) et un `JsonLd` de type `WebSite`. Les **reprendre** dans le nouveau fichier avant de
supprimer l'ancien : les perdre reviendrait à défaire une partie de la spec 26.

## 6. Modèle de données (delta)

Aucune table, aucune écriture. Trois colonnes de retour s'ajoutent à `search_catalog` (spec 27).

**Les photos.** `search_catalog` ne rendait aucun média : le carrousel, élément central de la carte,
n'avait **aucune source**. Elle rend désormais `fotos jsonb`, agrégé depuis `product_media` (ou
`establishment_media` pour une ligne groupée) et **trié par `sort`**. La résolution
`storage_path` → URL publique se fait dans `buscar.ts` via le client anonyme — jamais dans
`page.tsx`, qui n'a pas le droit de toucher Supabase.
**Photos d'une carte groupée** : celles du **premier couchage** de l'établissement, la requête étant
triée par `created_at` — c'est la règle déjà appliquée par le catalogue actuel, reconduite telle
quelle plutôt que réinventée.

**Le texte alternatif.** `product_media` ne porte **aucune colonne** pour lui — seulement `id`,
`product_id`, `storage_path`, `sort`, `created_at`. Décision du 2026-09-07 : il est **calculé**,
`<nom de l'offre>, foto <i> de <n>`.
⚠️ **Corrigé à l'implémentation (2026-09-07)** : il est construit par le **composant qui affiche la
photo**, pas par `lib/catalog/`. Un texte alternatif est du texte d'INTERFACE — le mettre dans la
couche de données y ferait entrer next-intl et rendrait la couche intestable sans contexte i18n. La
carte reçoit déjà `nombre` et connaît le rang de chaque photo : elle a tout ce qu'il faut. Une colonne rédigée par le partenaire serait meilleure pour le
référencement image, mais elle exige une migration, un champ dans deux écrans d'administration, et
surtout quelqu'un pour l'écrire sur chaque photo — en pratique elle resterait vide et il faudrait
ce repli de toute façon.

**Le prix « desde ».** ⚠️ **Corrigé le 2026-09-07 — collision entre deux décisions du même jour.**
La spec 27 a relâché la contrainte de prix (une offre en vitrine peut n'avoir aucun `price_cop`) ;
la première rédaction de cette spec calculait `min(price_cop)`. Sur des colonnes nulles, l'agrégat
rend une valeur fausse ou nulle. D'où le filtre explicite :

```sql
min(p.price_cop) filter (where p.type = 'lodging' and p.sellable and p.price_cop is not null)
```

et la règle qui va avec : si **aucun** couchage n'a de prix chiffré, la carte n'affiche **aucun
prix** — jamais « desde 0 ».

Cet agrégat est retenu contre une colonne dénormalisée, pour les raisons écrites en spec 27 §6 :
une dénormalisation non maintenue dérive en silence, et les écritures de produit passent par trois
chemins distincts. **Condition de bascule** inchangée : si la requête dépasse un budget mesuré, on
dénormalise, et la colonne devient un cache écrit dans la même transaction, avec son test.

## 7. Contrat — URL, données, composants

**Lecture et écriture des critères** — `lib/catalog/criterios.ts`, partagé avec les listings :

```ts
type ParamsBrutos = Record<string, string | string[] | undefined>;  // ce que Next passe à une page
export function leerCriterios(params: ParamsBrutos): Criterios
export function escribirCriterios(criterios: Criterios): string      // "?q=…&personas=2"
```

⚠️ Le type d'entrée est bien `Record<string, string | string[] | undefined>` — **pas
`URLSearchParams`** : c'est la forme que Next passe à `searchParams`, et une valeur peut être un
tableau si le paramètre est répété. Un tableau : on prend la **première** valeur.

**Table `tipo` → segment d'URL** — `lib/catalog/segmentos.ts`, seule source :

| `tipo` | segment |
|---|---|
| `activity` | `actividades` |
| `lodging` | `alojamientos` |
| `transport` | `transportes` |
| `camp` | `camps` |
| `evento` | `eventos` |

**`SeccionOfertas`** :

```ts
export type SeccionOfertasProps = {
  titulo: string;                       // déjà traduit
  tituloAs?: "h2";
  hrefVerMas: string;                   // critères inclus
  labelVerMas: string;                  // déjà traduit — diffère pour les activités (§0)
  variante: "grilla" | "lista";
  tarjetas: TarjetaOferta[];
  testId?: string;
};
```

**Clés de traduction** — namespace `HomePage`, à ajouter dans les **deux** locales (le test de
parité échoue sur toute clé manquante) : `h1`, `emptyState`, `secciones.<tipo>` (5),
`verMas`, `verMasTags`, `precioDesde`, `fotoAlt`, plus les libellés de `SearchPanelLabels`
(`buscar.*`, `fechas.*`, `personas.*`). Les clés devenues inutiles de l'ancien écran
(`typeFilterLabel`, `typeFilterAllLabel`, `noResults`, `searchLabel`, `searchPlaceholder`) sont
retirées des deux fichiers.

## 8. Règles et invariants

Le tableau sec est en §0. Ce qui mérite justification :

**Le composant ne filtre rien en mémoire.** C'est ce que fait `CatalogBrowser`, et c'est ce qui rend
la recherche inutilisable au-delà de quelques dizaines d'offres — et invisible pour Google, qui ne
voit que le catalogue complet.

**Une section vide n'est pas rendue.** Un bloc « Aucune activité » répété cinq fois sur une
recherche pointue est du bruit ; l'état vide global existe une seule fois.

**Le plafond de 8 vaut aussi sous recherche.** Sinon l'accueil filtrée devient une page à rallonge
et la distinction avec les pages de listing disparaît.

**L'ordre doit être déterministe.** Sans `order by`, la base rend les lignes dans l'ordre qui
l'arrange : le même visiteur qui recharge voit d'autres cartes, et un crawler voit une page
différente à chaque passage. `created_at desc` est le minimum, et il reste changeable en un endroit.

## 9. Cas limites

Le tableau sec est en §0. Trois méritent d'être justifiés.

**Paramètres invalides ignorés, jamais une erreur.** `?personas=abc` doit rendre l'accueil normale.
Une 400 sur une URL malformée transforme un lien mal recopié en page cassée, et donne à un crawler
une raison de croire le site instable.

**Établissement sans aucun prix chiffré → aucun prix.** « desde 0 » serait un mensonge affiché.

**États de l'écran.** Pendant une soumission, le panneau reste utilisable et la navigation est
signalée (`loading.tsx` de la zone). Chaque recherche **pousse une entrée d'historique** : le retour
arrière revient aux critères précédents, et le panneau se resynchronise depuis l'URL — jamais depuis
son état interne, qui n'est pas la source de vérité.

## 10. Décisions tranchées / points ouverts

**Tranché le 2026-09-07** — suggestions en Tranche 2 · `<h1>` masqué visuellement, provisoire ·
prix « desde » en agrégat filtré, pas en colonne · `alt` calculé depuis le nom et le rang · ordre
`created_at desc` dans une section · `personas` avec la colonne juste de chaque type ·
réordonnancement en Tranche 3.

**Corrigé le 2026-09-07 après audit** — le `<main>` est posé par `PageShell` et non par le layout
(la spec 27 doit être corrigée) · les photos passent par `PhotoStrip` · `search_catalog` rend les
médias, `price_label` et le total de section · `generateMetadata` et le `JsonLd` sont repris avant
suppression de l'ancien écran · `leerCriterios` prend la forme que Next passe réellement.

**Point ouvert — la carte d'activité en ligne garde-t-elle son carrousel ?** Le visuel de
`Card layout="row"` fait **64 px** — dimensionné pour la ligne produit d'une fiche établissement,
trop petit pour un carrousel. Trois issues : agrandir le visuel de la variante `row`, renoncer au
carrousel sur cette seule variante, ou faire de la carte d'activité une molécule à part.
**Recommandation** : agrandir le visuel et garder le carrousel — seule issue qui ne crée pas deux
cartes divergentes. Décision visuelle, à voir dans Storybook avant de coder.

**Point ouvert — un bloc titré au-dessus du bloc de recherche.** Annoncé par Jérôme le 2026-09-07,
contenu non arrêté. **À porter au cahier §2a** quand il le sera : ce n'est pas une décision
d'implémentation.

**Hérité, non rouvert** : les six points du cahier §2f.

## 10bis. Ce que l'implémentation a corrigé (2026-09-08, lot D)

Tranche 1 livrée. Sept écarts avec le texte ci-dessus, tous constatés en codant.

1. **Aucune migration n'a été nécessaire.** Le §6 annonçait trois colonnes à ajouter à
   `search_catalog` (`fotos`, `precio_desde`, `price_label`, `total_seccion`) : le lot A les avait
   déjà écrites, la spec ayant été rédigée avant. `supabase/migrations/<ts>_search_catalog_fotos_y_precios.sql`
   n'existe pas et n'a pas lieu d'être.
2. **`lib/catalog/criterios.ts` et `segmentos.ts` existaient déjà**, avec exactement le contrat du
   §7 — plus un `hayCriterios` non prévu. Rien à créer.
3. **`emptyState` est devenue deux clés** (`emptyState.titulo`, `emptyState.descripcion`) : le §7
   n'en annonçait qu'une, alors que le bloc a deux emplacements — un titre et une phrase qui dit
   quoi faire ensuite.
4. **Un SIXIÈME fichier e2e dépendait de l'ancien `catalog-link-<slug>`** :
   `apps/admin/e2e/partner-qr-tool.spec.ts`, que la liste des « fichiers touchés » ne nommait pas.
   Le nouveau sélecteur est `tarjeta-<slug>-link` — le `testId` de la carte vient de `buscar.ts`,
   le suffixe `-link` est dérivé par l'atome `Card` sur le lien du titre.
5. **`personas.valueLabel` ne peut pas venir de la page.** C'est un pluriel accordé sur le nombre
   choisi, et ce nombre est un état client : `BuscadorInicio` le traduit lui-même. Sans lui,
   `PeopleField` affiche le nombre NU sur son déclencheur.
6. **La resynchronisation du panneau sur l'URL (§9) a dû être écrite explicitement.** React garde
   l'état d'un composant monté et l'initialiseur de `useState` ne rejoue pas : sans elle, le bouton
   « précédent » affichait des champs qui ne décrivaient plus les résultats. La comparaison porte
   sur la SIGNATURE de l'URL, jamais sur l'objet de props — sinon la saisie en cours s'efface à
   chaque frappe. Les deux régressions ont leur test, et la première est vérifiée par mutation.
7. **`SeccionOfertas` rend son « Ver más » même quand la section est vide** : c'est la page qui
   décide de ne pas rendre une section sans résultat (§8), le composant n'a pas la vue d'ensemble.

**Constat de conformité** : le contrôle `scripts/check-data-layer.sh` ne porte plus d'exemption pour
`(vitrine)/page.tsx` — la nouvelle page passe la règle « aucune requête Supabase dans un fichier de
route » sans dérogation. La liste des écrans hérités est passée de cinq à quatre.

**Point ouvert qui s'est précisé — la carte groupée perd son décompte.** Le cahier §2b.4 montre
« Casa Kayam · 6 alojamientos », mais le type `TarjetaOferta` fixé au §0 ne porte aucun nombre de
couchages, et `search_catalog` calcule `n_alojamientos` sans le rendre. La carte livrée n'affiche
donc pas ce décompte. Combler l'écart coûte une colonne dans le `returns` de la fonction et un champ
dans le type — pas un chantier, mais une modification d'un contrat validé : **à arbitrer**, pas à
trancher en codant.

**Point ouvert inchangé — le carrousel de la carte d'activité.** La variante `lista` rend
`PhotoStrip` dans le visuel de 64 px de `Card layout="row"` : les flèches et les points d'Embla
occupent la vignette entière. `Card.tsx` n'a pas été touché (c'est un lot à part, §10). La story
`Affichage/TarjetaOferta` → `Lista` existe pour regarder le défaut avant de trancher. ⚠️ Si le visuel
est agrandi, la constante `SIZES_LISTA` de `TarjetaOferta.tsx` doit bouger avec lui, sinon
`next/image` sert une image de 64 px dans un cadre plus grand.

## 10ter. La Tranche 2 telle qu'elle a été construite (2026-09-08)

Le §2 tenait en une phrase (« `SearchBar` accepte une liste vide, et `Entrée` soumet toujours le
texte tapé »). Ce qu'une suggestion CONTIENT n'y était pas écrit : il a été repris des deux seules
sources qui l'avaient déjà tranché — les stories de `SearchBar` (2026-09-02 : des offres, des
établissements et des raccourcis de catégorie, chacun avec une ligne secondaire « nature · lieu »)
et le cahier §2a (« on cherche par tag, par nom, par type d'offre et par établissement »).

**Deux états, et le premier ne coûte rien.** Avant la deuxième frappe, la barre propose les
**types réellement présents à l'écran** avec leur nombre d'offres — la page les a déjà comptés pour
rendre ses sections, donc aucune requête. Un type absent des résultats n'apparaît pas : un raccourci
ne mène jamais à une page vide. À partir de deux caractères, la liste vient du catalogue.

**Le pont, et pourquoi il en fallait un.** Le champ est CLIENT, `lib/catalog/` est `server-only` :
`GET /api/catalogo/sugerencias?q=&locale=` est le seul chemin possible. Il rend
`{ sugerencias: SugerenciaCatalogo[] }`, appelle la même RPC `search_catalog` que l'accueil, avec le
même client anonyme et les mêmes policies — il n'expose donc rien de plus que la page elle-même.
Une panne rend `{ ok: false, reason }` **sans** clé `sugerencias` : une réponse d'échec ne doit pas
avoir la forme d'un succès, sinon la panne s'affiche comme « aucun résultat ».

**Aucun libellé dans la couche de données.** `SugerenciaCatalogo` porte le type de l'offre et le nom
de son établissement ; c'est `BuscadorInicio` qui compose « Actividad · Casa Kayam ». Même règle que
le texte alternatif des photos (§6), pour la même raison : un libellé est du texte d'interface, et
le faire entrer dans `lib/catalog/` y ferait entrer next-intl.

**Deux garde-fous distincts** sur la frappe, souvent confondus : un anti-rebond de 250 ms évite une
requête par caractère ; un `AbortController` évite qu'une réponse lente à « kay » arrive **après**
celle de « kayak » et réécrive la liste avec un résultat périmé — un défaut qui ne se voit qu'en
réseau lent.

**Ce qu'un raccourci de type fait, et ne fait pas.** Il n'a délibérément **pas** de `href` : il ne
quitte pas la page, il change ses critères. Il passe donc par `onSuggestionSelect` et
`escribirCriterios` reste le seul écrivain de l'URL. Les suggestions d'offre et d'établissement, à
l'inverse, portent un vrai `href` — mais ⚠️ `SearchBar` rend l'option en `<a>` **natif**
(`ListBox.Item href=`), pas avec le `Link` localisé : le préfixe de langue y est posé à la main.

**Conséquence assumée** : les raccourcis de type ne se combinent jamais avec une recherche texte,
puisqu'ils disparaissent dès la deuxième frappe. Ils se combinent bien avec les filtres venus de
l'URL (dates, personnes), et c'est ce que vérifie leur test.

## 10quater. Le §9 « États de l'écran », tenu pour de bon (2026-09-08)

Le §9 promettait deux choses que le code ne tenait pas encore.

**« Le panneau reste utilisable et la navigation est signalée. »** Une recherche re-rend la page
côté serveur. Sans transition, React remplace l'écran par un vide le temps de la réponse — le
panneau compris. `BuscadorInicio` pousse donc l'URL dans un `useTransition` : l'écran précédent
reste monté, et l'état `isPending` donne le seul signal fiable qu'une recherche est en cours.
⚠️ La région qui le porte est rendue **en permanence, vide au repos** : un `role="status"` monté au
moment où il a quelque chose à dire n'est jamais annoncé par un lecteur d'écran — la région doit
exister avant que son contenu change. Un test le vérifie, parce que c'est invisible à l'œil.

**« Base injoignable → la page échoue franchement »** (spec 27 §9). C'était déjà vrai —
`lib/catalog/` lève — mais l'échec rendait la page d'erreur NUE de Next : ni traduite, ni habillée.
`(vitrine)/error.tsx` la remplace. Trois choses à connaître : `"use client"` y est imposé par Next
(un `error.tsx` s'attache à une frontière d'erreur React) ; elle ne rend **pas** la coquille, à la
différence de `not-found.tsx`, parce qu'un `error.tsx` de groupe est rendu à l'intérieur du layout
de sa zone — la rendre donnerait deux en-têtes ; et **le message brut de l'erreur n'atteint jamais
l'écran**, il peut porter un fragment de requête SQL. Il part au journal du navigateur avec son
`digest`, et le visiteur lit un texte écrit pour lui.

Les trois autres zones n'ont toujours pas leur `error.tsx` ni leur `loading.tsx` (spec 27 §5 les
prévoit pour chacune) : la vitrine est la seule à porter aujourd'hui un écran qui interroge le
catalogue, et créer trois fichiers sans écran pour les justifier serait de l'anticipation.

## 10quinquies. Ce que la revue adversariale a trouvé (2026-09-08)

29 trouvailles remontées par quatre chercheurs, **16 tuées par les réfuteurs**, 5 confirmées et
reproduites en réel. Quatre sont corrigées dans le même geste ; la cinquième est datée ci-dessous.

**Corrigé — les suggestions ne proposaient pas ce qu'on leur demandait.** `search_catalog` finit par
`order by c.tipo, c.rango_seccion`, un ordre pensé pour l'accueil qui range ses cinq sections. Or
`products.type` est du texte : `activity < camp < evento < lodging < transport`. Demander six lignes
à cette requête, c'était donc demander « les six premières ACTIVITÉS ». Reproduit contre le Postgres
local : taper « Casa Kayam » proposait l'hôtel ; en lui ajoutant cinq activités, le même appel
rendait six activités et **la carte de l'hôtel disparaissait** — le prédicat texte couvre le nom de
l'établissement, donc son nom fait correspondre tous ses produits, et sa propre carte est servie en
dernier. `sugerencias.ts` demande désormais une réserve (`limite × 5`, une par section) et classe en
TypeScript : préfixe d'abord, établissement pour départager, ordre de la base ensuite. Sans migration.

**Corrigé — trois trous de couverture, chacun refermé et vérifié par mutation.** (a) Retirer
`useTransition` en ENTIER laissait 515 tests sur 515 au vert : la moitié du §10quater pouvait
disparaître sans qu'un garde-fou bouge. (b) Retirer le `if (!reponse.ok) throw` du pont de
suggestions laissait la suite verte, alors que le rendu partait en `TypeError` — donc sur l'écran
d'erreur. (c) Les trois tests du lot montaient un catalogue i18n **écrit à la main** : renommer
`{indice}` en `{index}` dans les messages laissait tout vert pendant que chaque photo aurait porté
`alt="HomePage.fotoAlt"` en production. Ils utilisent maintenant `loadMessages("es")`, la convention
déjà majoritaire du dépôt — et la justification qui les excusait (« le lot i18n est écrit en
parallèle ») était fausse : `git log -S` montre que les deux sont nés dans le MÊME commit.

**Non corrigé, et daté — `?tag=<slug inconnu>` vide l'accueil.** Le §0 dit « `tipo`/`tag` inconnu →
ignoré ». C'est vrai pour `tipo`, validé par `esTipoOferta` à la lecture ; c'est **faux pour `tag`**,
qui part tel quel en `p_tag_slug` et dont le prédicat SQL n'a qu'une échappatoire (`is null`) : un
slug absent de `catalog_tags` filtre tout, et `BuscadorInicio` le reporte à chaque soumission, donc
la page reste vide indéfiniment. Mesuré en réel (7 lignes sans tag, 0 avec `zzz-inexistant`).

**Pourquoi ce n'est pas corrigé ici** : rien ne fabrique de lien `?tag=` aujourd'hui — les pages de
tags sont la spec 29 — donc le chemin n'est atteignable qu'en tapant l'URL à la main ; et le
correctif tient en trois lignes de SQL **dans une fonction de 300 lignes**, qu'il faudrait
republier en entier. La spec 29 doit de toute façon redéfinir `search_catalog` (pour l'index de
tags) et donner des tags au seed — qui n'en a **aucun** aujourd'hui, si bien que le volet « chercher
par libellé de tag » du cahier §2a n'est couvert par rien. Le correctif y coûte zéro ligne de plus.
**✅ CORRIGÉ le 2026-09-08** (spec 29 Tranche 1, migration `20260908120000_search_catalog_sin_tag.sql`).
Exactement ce qui était prescrit ici : le prédicat a gagné
`or not exists (select 1 from public.catalog_tags ct where ct.slug = p_tag_slug)`, l'assertion pgTAP
19 (« un slug de tag INCONNU est ignoré — il ne filtre rien ») et `&tag=zzz-inexistant` dans l'URL de
l'e2e des paramètres invalides. Les deux sont **vérifiés par mutation** : retirer cette seule ligne
du corps de la fonction fait rougir l'assertion 19 et elle seule, et fait rougir l'e2e sur
`home.spec.ts:233` — l'assertion « l'écran n'est jamais l'état vide », c'est-à-dire le symptôme
exact décrit ci-dessus.

## 10sexies. Tranche 3 — retour à l'accueil réordonnée après un ajout au panier (2026-09-13)

Entretien tenu (trois décisions, courtes — la règle de réordonnancement elle-même était déjà
tranchée au cahier §2b.5, verbatim, non rouverte ici) :

1. **Retour = redirection immédiate** (`router.push`), pas une invitation avec lien.
2. **Toujours** rediriger après un ajout réussi, y compris un 2e/3e ajout depuis la même fiche
   établissement ou des activités en série — aucun cas particulier pour un geste multi-ajouts.
3. Le réordonnancement s'applique **seulement juste après un ajout**, jamais à une simple visite
   de l'accueil dont le panier n'est pas vide (une relecture de l'URL le lendemain garde l'ordre
   habituel).

### La fonction pure

`lib/catalog/ordenSecciones.ts` — `ordenarTipos(enCarrito: ReadonlySet<TipoOferta>): TipoOferta[]`,
une partition stable de `ORDEN_SECCIONES` (absents d'abord, présents à la fin, chacun dans son
ordre habituel). Zéro dépendance, testée sans base, **vérifiée par mutation** (inverser les deux
prédicats `.filter` fait rougir 3 tests — 2 dans son propre fichier, 1 dans `buscar.test.ts` — puis
restaurée). `buscarSecciones` prend un paramètre optionnel `tiposEnCarrito` et l'utilise à la place
de `ORDEN_SECCIONES` quand il est fourni ; le filtre de section vide est inchangé.

### Le flag « on vient d'ajouter », et pourquoi il ne rejoint jamais `Criterios`

Même patron que `leerPagina` (déjà dans `criterios.ts`, « ne rejoint jamais `Criterios`, n'échoue
jamais ») : `leerDesdeCarrito(params): boolean` et `hrefRetornoCarrito(criterios): string` (ajoute
`desdeCarrito=1` à la suite d'`escribirCriterios`). `page.tsx` ne lit `getCartLines(locale)` (déjà
existant, réutilisé tel quel) que quand ce flag est présent — sur une visite normale, zéro requête
de plus, comportement strictement inchangé. C'est ce qui tient la décision ③ sans code conditionnel
dans un composant.

### « Critères conservés » — un mécanisme qui n'existait nulle part

La fiche produit ne porte jamais les critères dans son URL (§4 ci-dessus), et **aucune mémoire de
navigateur n'existait** pour ça avant ce lot — vérifié par grep (`sessionStorage`/`localStorage`) :
un seul résultat dans tout `apps/web`, un commentaire Storybook disant explicitement que ce n'est
pas fait. Nouveau fichier `lib/catalog/ultimosCriterios.ts` (séparé de `criterios.ts`, qui documente
zéro dépendance — `sessionStorage` est une API navigateur) : `guardarUltimosCriterios(sufijo:
string)` / `leerUltimosCriterios(): Criterios`, format de stockage = la sortie d'`escribirCriterios`
elle-même, pas un format maison. `BuscadorInicio.tsx` écrit dans un `useEffect` sur `firmaUrl` (déjà
suivie pour la resynchronisation §9) — **jamais sur l'objet `criteriosIniciales`**, reconstruit à
chaque rendu, qui aurait forcé soit un effet qui se redéclenche sans rapport, soit un
`eslint-disable` que ce dépôt ne pratique nulle part (vérifié par grep). `useAddToCart` lit au
moment de rediriger.

### `useAddToCart.ts` — où se branche LE geste de retour

Sur succès : `toast.success(...)`, puis `startTransition(() => router.push(hrefRetornoCarrito(...)))`
— jamais dans un formulaire, exactement pourquoi ce hook avait été extrait le 2026-09-10
(`/simplify`). Les trois formulaires de réservation perdent leur bloc `justAdded` (message inline +
lien `/pago`), devenu du code mort : le composant est sur le point de se démonter avant qu'il ne
s'affiche.

### Trouvaille non anticipée — `SiteToaster` n'était monté nulle part dans `apps/web`

Confirmé par grep et par le commentaire d'en-tête de `SiteToaster.tsx` lui-même (écrit le
2026-09-02, jamais suivi d'effet) : `toast.danger` sur échec d'ajout était **déjà invisible**
aujourd'hui, indépendamment de ce lot. Monté en frère de `{children}` dans
`app/[locale]/layout.tsx` — ce lot corrige donc deux défauts d'un coup.

### Fichiers touchés

**Créés** : `lib/catalog/ordenSecciones.ts` (+ test) · `lib/catalog/ultimosCriterios.ts` (+ test) ·
`lib/cart/useAddToCart.test.tsx` (aucune couverture n'existait) ·
`(vitrine)/BuscadorInicio.ultimosCriterios.test.tsx` · `packages/e2e-support/src/cart.ts`
(`irAPagoTrasAgregar`, `esperarRetornoTrasAgregar`) · `e2e/reorder-secciones-tras-agregar.spec.ts`.
**Modifiés** : `lib/catalog/criterios.ts`/`buscar.ts` (+ tests) · `lib/cart/useAddToCart.ts` ·
`(vitrine)/BuscadorInicio.tsx` · `(vitrine)/page.tsx` · `app/[locale]/layout.tsx` · les trois
formulaires de `productos/[slug]/` · `messages/{es,en}/ProductPage.json` (`goToCheckout` retiré,
orphelin ; `addedToCart` réutilisé pour le toast).

### Effet de bord non anticipé — 9 specs e2e dépendaient de l'UI supprimée

`added-to-cart`/`go-to-checkout-link` servaient de simple étape de mise en place (jamais l'objet du
test) dans `attribution`, `cart-multi-establishment`, `login`, `payment-return`,
`reserve-concurrency`, `reserve-lodging-pms-availability`, `reserve-lodging-range`, `reserve`,
`signup`. Toutes corrigées dans ce lot (`irAPagoTrasAgregar`/`esperarRetornoTrasAgregar`).
`cart-multi-establishment.spec.ts` en particulier : son en-tête affirmait que le panier est « un
état React en mémoire... se réinitialise sur toute navigation dure » — faux depuis la spec 32
(panier en base) ; corrigé au passage, avec son clic « ← Volver al catálogo » devenu inutile.

### Quatre défauts pré-existants trouvés en vérifiant, non corrigés ici (hors périmètre)

Chacun reproduit à l'identique contre le code d'avant ce lot (vérifié par `git stash` + rejeu) —
aucun n'est une régression de cette tranche :
1. **`reserve-lodging-range.spec.ts`** : le total affiché sur `/pago` pour un séjour de plusieurs
   nuits (400.000 attendu) ne montre que 200.000 — la logique d'estimation du formulaire (qui
   multiplie par le nombre de nuits) et celle de `CartSummary`/le total du panier semblent diverger
   pour un produit à plage de dates.
2. **`reserve.spec.ts`** (« capacité épuisée... ») : après un refus de `create_order`, la ligne
   fautive du panier ne porte pas `data-failed="true"` comme l'assertion l'attend.
3. **`cart-multi-establishment.spec.ts`** (test 1) : `countOrdersByPhone` fait une comparaison
   exacte de chaîne alors que `PhoneField` (2026-09-10) normalise en E.164 compact — un numéro de
   test écrit avec des espaces ne retrouve jamais sa commande.
4. **`reserve-lodging-pms-availability.spec.ts`** : timeout au clic d'une seconde date de plage sur
   un calendrier PMS-backed, reproductible même isolé sur base fraîche — cause non investiguée plus
   avant, hors périmètre de cette tranche.

### Vérifié

`npm run typecheck && npm run lint && npm run test` (713/713, dont les nouveaux fichiers) verts.
Les six `scripts/check-*.sh` verts (le seul rouge, `check-timezone.sh` sur les deux migrations
`lodging_default_availability` du 2026-09-13, est antérieur et sans rapport — jamais touché ici).
`npm run build` vert. `ordenarTipos` vérifiée par mutation. Parcours réel via Playwright contre la
stack locale (`reorder-secciones-tras-agregar.spec.ts`) : ajout depuis une fiche → redirection
immédiate vers l'accueil → critères ET flag dans l'URL → toast de succès **visible pour la première
fois** → sections réordonnées (activité tombée en dernier, logement passé devant). 19/23 tests e2e
du périmètre touché verts, les 4 rouges restants pré-existants et documentés ci-dessus.

## 11. Annexe — traçabilité

| Sujet | Sources |
|---|---|
| Accueil, sections, filtres, réordonnancement | `docs/01-cahier-des-charges-client.md` §2a, §2b.5 |
| Routes, coquilles, `lib/catalog/`, `search_catalog` | `docs/specs/27-architecture-vitrine-et-routage.md` |
| Regroupement des couchages, photos de la carte groupée | `app/[locale]/page.tsx`, spec 24 T1/T3 |
| Photos du catalogue (bucket, tables, URL publique) | `supabase/migrations/20260815110000_gestion_images.sql`, spec 04, `app/[locale]/products/[slug]/page.tsx` |
| Bloc de recherche et ses pièges | `components/organisms/{SearchBar,SearchPanel}.tsx` |
| Carte, image, prix, titre, coquille | `components/atoms/{Card,Image,Price,Title,PageShell}.tsx`, `components/molecules/PhotoStrip.tsx`, `components/README.md` |
| Fuseau de référence | `packages/domain/src/time/bogotaDates.ts`, `scripts/check-timezone.sh` |
| Canonical de l'accueil et `?ref=` | spec 26, `lib/seo/pageMetadata.ts` |
| Panier et son modèle de ligne | `lib/cart/CartContext.tsx`, cahier §3e |
| Écran remplacé | `app/[locale]/page.tsx`, `app/[locale]/CatalogBrowser.tsx` |

## 12. Documents liés

`docs/01-cahier-des-charges-client.md` (§1, §2a, §2b, §3a, §3e) · specs `04`, `24`, `26`, `27` ·
`apps/web/components/README.md` · `.claude/rules/{apps,seo,ui,tests}.md`.

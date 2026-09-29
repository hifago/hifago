---
id: specs-vitrine-listings-et-index-de-categories
titre: "Vitrine : les pages de listing et l'index de catégories"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: implemente
maj: 2026-09-08
resume: >
  Construit les six routes vers lesquelles pointent les cinq « Ver más » de l'accueil : l'index de
  catégories des activités (des tags devenus éditoriaux — image, nom, texte), la page d'offres
  d'une catégorie, et les quatre listings qui listent leurs offres directement, tous en défilement
  infini. Fait aussi de catalog_tags une entité éditoriale et donne à l'admin de quoi la remplir.
mots_cles: [listings, catégories, tags, catalog_tags, défilement infini, apps/web, search_catalog, fil d'Ariane]
repond_a:
  - "Que montrent /es/actividades, /es/alojamientos et les autres pages de listing ?"
  - "Comment une catégorie d'activité est-elle décrite, et par qui ?"
  - "Comment la suite d'une liste se charge-t-elle, et que devient l'adresse ?"
---

# Vitrine : les pages de listing et l'index de catégories

> **Cible stack** : hifago. **Deuxième écran** du chantier front, après la spec 28 (l'accueil).
> S'appuie sur la spec 27 (routes, coquilles, `lib/catalog/`, `search_catalog`) et sur la spec 28
> (le type `TarjetaOferta`, les critères d'URL, le bloc de recherche).
>
> **Décisions prises en entretien avec Jérôme le 2026-09-08**, écran par écran, en commençant par
> l'index de catégories — le moins décidé des six. Les treize arbitrages sont listés au §3, chacun
> avec la raison qui l'a emporté.
>
> **✅ Validée par Jérôme le 2026-09-08**, en bloc, après lecture des sept points que la rédaction
> avait tranchés seule (§10 « Ce que la rédaction a décidé »).
>
> **✅ Implémentée le 2026-09-08** — les trois tranches. Ce que le code a corrigé du texte est en
> §10bis (Tranches 1a/1b), §10ter (Tranche 2) et §10quater (Tranche 3) : deux décisions de la
> spec ont été renversées en codant, et arbitrées avant d'être écrites.
>
> ⚠️ **PÉRIMÉE depuis le 2026-09-14** (chantier « catégories partout », commit `8d4849eb`,
> `docs/journal/2026-09.md`) — le système décrit ici (index de tuiles vides réservé à `activity`,
> `search_catalog_tags`, route `[tag]`) a été **remplacé**, pas seulement retouché : un index de
> catégories généralisé aux CINQ types, sur demande explicite de Jérôme (*« pas que l'alojamiento
> doit avoir des cate tout doit pouvoir en avoir »*). Le §0 ci-dessous est corrigé pour décrire le
> système ACTUEL — tout le reste du document (§1-§10quater) reste la trace historique de la
> décision du 2026-09-08, à lire comme un historique, pas comme le contrat courant. Détail complet
> du remplacement : **§10quinquies**.

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 0 | **Contrat compact** | ✅ validé 2026-09-08 |
| 1 | Contexte et problème | ✅ validé 2026-09-08 |
| 2 | Portée et tranches | ✅ validé 2026-09-08 |
| 3 | Décisions retenues | ✅ validé 2026-09-08 |
| 4 | Parcours cible | ✅ validé 2026-09-08 |
| 5 | Les écrans, bloc par bloc | ✅ validé 2026-09-08 |
| 6 | Modèle de données (delta) | ✅ validé 2026-09-08 |
| 7 | Contrat — URL, données, composants | ✅ validé 2026-09-08 |
| 8 | Règles et invariants | ✅ validé 2026-09-08 |
| 9 | Cas limites | ✅ validé 2026-09-08 |
| 10 | Décisions tranchées / points ouverts | ✅ validé 2026-09-08 |
| 11 | Annexe — traçabilité | ✅ validé 2026-09-08 |
| 12 | Documents liés | ✅ validé 2026-09-08 |

---

## 0. Contrat compact (pour coder — lire seul, sans le reste)

### Carte des routes

Toutes sous `app/[locale]/(vitrine)/`. Zone vitrine, **indexables**, rendu **dynamique**.

| URL | Fichier | Contenu |
|---|---|---|
⚠️ **Périmé — table corrigée le 2026-09-21/22, voir §10quinquies.** Les URL et fichiers restent
exacts (à un renommage de segment près) ; c'est le CONTENU de l'index qui a changé pour les cinq
types, plus le nom du segment dynamique.

| URL | Fichier | Contenu |
|---|---|---|
| `/[locale]/actividades` | `actividades/page.tsx` | index de catégories **avec un aperçu de 6 offres par catégorie** (`POR_CATEGORIA`), plus « Ver más » si elle en a plus |
| `/[locale]/actividades/[categoria]` | `actividades/[categoria]/page.tsx` | les offres d'une catégorie (renommé depuis `[tag]`, cosmétique) |
| `/[locale]/actividades/otras` | *(la même route `[categoria]`)* | les activités **sans aucun tag** |
| `/[locale]/alojamientos` (+`/[categoria]`) | `alojamientos/{page,[categoria]/page}.tsx` | **même patron que `/actividades` désormais** — plus un simple listing plat |
| `/[locale]/transportes` (+`/[categoria]`) | `transportes/{page,[categoria]/page}.tsx` | idem |
| `/[locale]/camps` (+`/[categoria]`) | `camps/{page,[categoria]/page}.tsx` | idem |
| `/[locale]/eventos` (+`/[categoria]`) | `eventos/{page,[categoria]/page}.tsx` | idem |
| `/api/catalogo/listado` | `app/api/catalogo/listado/route.ts` | le pont du défilement infini, pages `[categoria]` seulement |

`otras` est un **slug réservé** (constante `SLUG_SIN_TAG`, `lib/catalog/buscar.ts`) : une contrainte
l'interdit à `catalog_tags` (§6). Sans elle, une catégorie nommée « Otras » masquerait la page des
offres non classées, en silence. Généralisé aux cinq types depuis le 2026-09-14 (§10quinquies).

⚠️ Le paramètre de critère `?tag=` (recherche libre, `lib/catalog/criterios.ts`) **n'a pas été
renommé** et reste distinct du segment de route `[categoria]` — sur une page de catégorie, le
filtre vient du SEGMENT, un `?tag=` de l'URL est ignoré (même règle que `?tipo=` sur un listing).

### Paramètres d'URL

Les mêmes que l'accueil (spec 28 §0, `lib/catalog/criterios.ts` — inchangés), **plus un** :

| Paramètre | Type | Effet |
|---|---|---|
| `q`, `tipo`, `tag`, `personas`, `desde`, `hasta` | cf. spec 28 §0 | identiques, même lecture, même normalisation |
| `pagina` | entier ≥ 1 | combien de pages sont déjà chargées — **1 à 20**, sinon ramené à 1 |

⚠️ `pagina` **n'est pas un critère** : il ne passe jamais par `Criterios`, et `escribirCriterios`
ne l'écrit jamais. Sinon il se propagerait dans les liens « Ver más » de l'accueil et dans le
canonical. Il a sa propre fonction, `leerPagina(params)`.

⚠️ **Le plafond de 20 n'est pas cosmétique** : sans lui, `?pagina=99999` demande 2,4 millions de
lignes à Postgres depuis une URL publique et anonyme. Une valeur hors bornes est ramenée à 1, comme
tout paramètre invalide de ce dépôt — jamais une erreur.

`tipo` sur une page de listing est **ignoré** : le type vient du segment d'URL, qui fait foi. Un
`/es/camps?tipo=lodging` liste des camps.

### Arbre des pages

⚠️ **Périmé — remplacé le 2026-09-14, voir §10quinquies.** `IndiceCategorias` et `TarjetaCategoria`
sont supprimés (commit `8d4849eb`) ; l'index réutilise désormais `SeccionOfertas`, le composant de
l'accueil. Arbre actuel :

```
(vitrine)/layout.tsx              SiteHeader · SiteFooter        (spec 27 — ne pose PAS <main>)
│
├─ {actividades,alojamientos,transportes,camps,eventos}/page.tsx   Server Component, MINCE
│  └─ IndiceCategoriasConOfertas(tipo, locale, searchParams)       corps PARTAGÉ des cinq index
│     ├─ buscarCategorias(tipo, criterios, {porCategoria: 6, locale})   LA seule requête
│     ├─ generateMetadata + JsonLd BreadcrumbList
│     └─ PageShell variant="large"
│        ├─ Migas                     Inicio / Actividades
│        ├─ <h1> VISIBLE              « Actividades » (ou le titre du type)
│        ├─ BuscadorInicio            "use client" — atajosTipo={[]}, écrit vers `/`
│        └─ une SeccionOfertas PAR CATÉGORIE (même composant que l'accueil)
│           ├─ titulo = nom de la catégorie, variante="carrusel"
│           ├─ tarjetas = ses 6 premières offres candidates (plafonné EN SQL, §10quinquies)
│           └─ mostrarVerMas = total > 6 (contrairement à l'accueil, toujours vrai)
│           (la catégorie "sans tag" ferme la liste, jamais dans l'ordre alphabétique)
│
└─ {actividades,alojamientos,transportes,camps,eventos}/[categoria]/page.tsx  (renommé depuis [tag])
   ├─ resolverCategoria(tipo, slug, locale)     404 si catégorie inconnue/vidée
   └─ ListadoTipo(tipo, locale, searchParams, categoria)   — INCHANGÉ dans son rôle
      ├─ buscarTipo(tipo, criterios, …)         LA seule requête, fonction inchangée
      ├─ generateMetadata + JsonLd BreadcrumbList
      └─ PageShell variant="large"
         ├─ Migas                     Inicio / Actividades / Kayak
         ├─ <h1> VISIBLE              le nom du type, ou celui de la catégorie
         ├─ <p> descriptif            catégorie seulement, quand elle en a un
         ├─ BuscadorInicio            "use client"
         └─ ListadoInfinito           "use client" — reçoit les cartes de la 1re page rendues serveur
            ├─ TarjetaOferta × n
            ├─ sentinelle             IntersectionObserver
            ├─ bouton « Cargar más »  repli clavier / lecteur d'écran, toujours rendu
            └─ role="status"          rendu en permanence, vide au repos (spec 28 §10quater)
```

### Données

⚠️ **Périmé — voir §10quinquies.** `CategoriaConOferta` est remplacé par `CategoriaConTarjetas`, qui
porte aussi les offres elles-mêmes (l'index les affiche désormais, il ne se contente plus de
compter) :

```ts
// lib/catalog/tipos.ts — remplace CategoriaConOferta
type CategoriaConTarjetas = {
  slug: string; href: string; nombre: string; descripcion: string | null;
  foto: FotoTarjeta | null; esSinTag: boolean; localesNativas: string[];
  tarjetas: TarjetaOferta[];     // NOUVEAU — les offres de la catégorie, plafonnées EN SQL
  total: number;                 // NOUVEAU — pilote `mostrarVerMas`
  testId: string;                // `categoria-<slug>`
};
```

| Page | Appel |
|---|---|
| Les cinq index (`/actividades`, `/alojamientos`, …) | `buscarCategorias(tipo, criterios, { porCategoria, locale })` → `CategoriaConTarjetas[]` (remplace `listarTagsConOferta`, généralisée aux 5 types) |
| Les cinq pages de catégorie (`/[type]/[categoria]`) | `resolverCategoria(tipo, slug, locale)` (existence, 404 sinon) **puis** `buscarTipo(tipo, criterios, { limite, desplazamiento: 0, locale, sinTag? })` (offres) — `buscarTipo` inchangée, deux lectures distinctes (motif déjà au §10ter point 3) |

⚠️ **`foto`/`descripcion` existent dans le type mais ne sont consommés NULLE PART sur l'index**
depuis le 2026-09-14 : `IndiceCategoriasConOfertas`/`SeccionOfertas` ne passent que `titulo` (le
nom) et la grille d'offres — ni l'image ni le texte éditorial de `catalog_tags` n'y apparaissent
(§10quinquies, choix produit non validé par Jérôme). `descripcion` reste affiché sur la page de
catégorie elle-même (§5b, inchangé) ; **l'image, elle, n'est affichée nulle part** dans le code
actuel — vérifié par lecture de `IndiceCategoriasConOfertas.tsx` et `SeccionOfertas.tsx`, à
signaler plutôt qu'à laisser découvrir.

**`nombre` et `descripcion` de la catégorie « sans tag » (`SLUG_SIN_TAG = "otras"`) ne viennent
toujours PAS de la base** — ils viennent des messages next-intl (`ListadoPage.json`, clés
`sinTag.${tipo}.nombre`/`.descripcion`, une entrée par type depuis la généralisation).

### Modèle de données (delta)

| Objet | État | Détail |
|---|---|---|
| `catalog_tags.description jsonb` | **à créer** | nullable, `{es, en?}` — même convention que `label` |
| `catalog_tags.image_path text` | **à créer** | nullable, chemin dans le bucket `catalog-media`, dossier `tags/` |
| contrainte `catalog_tags_slug_reservado` | **à créer** | `check (slug <> 'otras')` |
| fonction `search_catalog(…)` | **à republier** | `drop` + `create` : nouveau paramètre `p_sin_tag`, et le tag inconnu devient ignoré. Rien d'autre ne bouge |
| fonction `search_catalog_tags(…)` | **créée puis SUPPRIMÉE** | créée en Tranche 2 (2026-09-08, appelait `search_catalog`, rendait les catégories sans leurs offres) ; `drop` le 2026-09-14 (migration `20260914120000`), plus aucun appelant TypeScript — voir §10quinquies |
| fonction `search_catalog_categorias(…)` | **créée le 2026-09-14, hors périmètre de cette spec** | remplace `search_catalog_tags`, généralisée aux 5 types, rend chaque catégorie AVEC ses offres plafonnées EN SQL (`p_por_categoria`) — signature et détail au §10quinquies |
| `CatalogImageFolder` | **à étendre** | `"products" \| "establishments"` gagne `"tags"` |
| `/api/upload/[entity]` | **à étendre** | accepte `entity === "tag"` |

Aucune table créée, aucune écriture capacitaire, **aucune RPC `security definer`** : comme la
spec 27, rien ici ne relève de la frontière RPC-only. `catalog_tags` reste en RLS directe
(écriture admin), calibrage inchangé depuis sa migration du 2026-08-15.

### Invariants

1. Aucun `page.tsx` n'appelle Supabase et n'importe rien de `@hifago/ui` (specs 27 §0, 28 §0).
2. Un seul `<main>`, posé par `PageShell` ; un seul `<h1>`, **visible** sur ces six pages.
3. `pagina` ne transite jamais par `Criterios` ni par `escribirCriterios`.
4. Le canonical de ces six pages **ignore tous les paramètres**, `pagina` compris — même mécanisme
   que l'accueil (`pathFor` ne reçoit aucun `searchParams`).
5. Un tag qui ne porte **aucune offre publiée** n'apparaît jamais dans l'index (cahier §2a) et sa
   page rend **404**, jamais une liste vide indexable.
6. La première page d'un listing est rendue **par le serveur** ; le défilement n'ajoute que les
   suivantes. Ce qu'un crawler lit ne dépend d'aucun JavaScript.
7. Le bouton « Cargar más » est **toujours rendu** tant qu'il reste des offres — l'observateur
   d'intersection ne le remplace pas, il le devance.
8. Toute soumission du bloc de recherche navigue vers **l'accueil**, jamais vers la page courante.
9. Tout lien interne passe par le `Link` de `@/i18n/navigation`.
10. Aucune couleur en dur, aucune largeur en dur, rien de masqué selon la largeur.

### Cas limites

| Situation | Traitement |
|---|---|
| `/actividades` sans aucune catégorie ni activité sans tag | `EstadoVacio`, la barre reste utilisable |
| `/actividades` où **aucune** activité n'est taguée | une seule tuile : « Otras actividades » |
| Catégorie sans image | aplat (`Image` sans source), la tuile reste valide |
| Catégorie sans texte | la tuile n'affiche que son nom ; sa page n'affiche pas de chapô |
| `/actividades/<slug inconnu>` | **404** |
| `/actividades/<slug existant sans offre>` | **404** (invariant 5) |
| `/actividades/otras` sans activité non taguée | **404**, même règle |
| Catégorie avec offres, mais aucune sous les critères | **200** + `EstadoVacio` — la page existe, la recherche ne donne rien |
| `/es/camps` sans aucun camp au catalogue | **200** + `EstadoVacio` — une route structurelle ne disparaît pas |
| `?pagina=0`, `?pagina=abc`, `?pagina=99999` | ramené à 1 |
| `?pagina=3` ouvert directement | le serveur rend les 72 premières offres, pas la seule 3ᵉ page |
| `?tag=<slug inconnu>` sur n'importe quelle page | **ignoré** — le correctif de la dette (§6) |
| Le pont `/api/catalogo/listado` échoue | la liste garde ce qu'elle a, un message le dit, le bouton reste cliquable |

### Fichiers touchés

**Créés** — `app/[locale]/(vitrine)/{actividades,alojamientos,transportes,camps,eventos}/page.tsx` ·
`app/[locale]/(vitrine)/actividades/[tag]/page.tsx` (supprimé le 2026-09-14, devenu `actividades/[categoria]/` — §10quinquies) · `app/[locale]/(vitrine)/ListadoTipo.tsx` ·
`app/api/catalogo/listado/route.ts` · `components/molecules/TarjetaCategoria.tsx` (supprimé le 2026-09-14, §10quinquies) ·
`components/molecules/Migas.tsx` · `components/organisms/IndiceCategorias.tsx` (supprimé le 2026-09-14 — `IndiceCategoriasConOfertas.tsx`, §10quinquies) ·
`components/organisms/ListadoInfinito.tsx` (chacun + test + story) ·
`lib/seo/jsonld/breadcrumb.ts` (+ test) · `messages/{es,en}/ListadoPage.json` ·
`e2e/listados.spec.ts` · `supabase/migrations/<ts>_catalog_tags_editorial.sql` ·
`supabase/migrations/<ts>_search_catalog_sin_tag.sql` (Tranche 1) · `supabase/migrations/<ts>_search_catalog_tags.sql` (Tranche 2) ·
`supabase/tests/database/search_catalog_tags.test.sql` (supprimé le 2026-09-14, §10quinquies).

**Modifiés** — `lib/catalog/{buscar,criterios,tipos}.ts` · `app/sitemap.ts` (les pages de
catégorie) · `app/[locale]/(vitrine)/BuscadorInicio.tsx` (destination explicite) ·
`supabase/seed.sql` (catégories + assignations + deux activités) ·
`apps/admin/lib/media/catalogImage.ts` · `apps/admin/app/api/upload/[entity]/route.ts` ·
`apps/admin/app/admin/tags/[id]/page.tsx` + un bloc d'édition · `apps/admin/app/admin/tags/NewTagForm.tsx`
et `RenameTagButton.tsx` (le slug réservé) · `e2e/home.spec.ts` (`&tag=zzz-inexistant`) ·
`packages/supabase/src/database.types.ts` (régénéré).

---

## 1. Contexte et problème

**Les cinq « Ver más » de l'accueil mènent à un 404.** Mesuré au serveur de dev le 2026-09-08 :
`/es/actividades`, `/es/alojamientos`, `/es/transportes`, `/es/camps`, `/es/eventos` n'existent
pas. C'est le seul trou visible du parcours livré la veille, et c'est la raison qui a fait passer
cette spec avant la spec 30 (fiches produit et établissement) — celles-ci fonctionnent, elles sont
simplement restées l'ancien écran.

Trois manques se referment dans le même lot, parce qu'ils partagent le même code :

1. **`buscarTipo()` est écrite, testée, et appelée par personne** (`lib/catalog/buscar.ts:189`).
   Elle a été écrite avec le lot A pour ces pages-ci. `hrefSeccion()`, elle, sert déjà : c'est elle
   qui fabrique les cinq liens en 404.
2. **`catalog_tags` est vide** — aucune ligne, aucune assignation. L'index de catégories n'aurait
   rien à montrer, et le volet « chercher par libellé de tag » du cahier §2a, pourtant implémenté
   dans `search_catalog`, n'est couvert par **aucun** test de bout en bout.
3. **`?tag=<slug inconnu>` vide l'accueil sans se déverrouiller** (revue adversariale du
   2026-09-08, spec 28 §10quinquies). Le §0 de la spec 28 promet « tag inconnu → ignoré » : c'est
   vrai pour `tipo`, faux pour `tag`. Reporté ici parce que ce lot republie `search_catalog` de
   toute façon.

**Et un quatrième problème, apparu pendant l'entretien** : les tags ne sont pas des étiquettes,
ce sont des **catégories**. Une page « Kayak » qui n'affiche qu'une grille de cartes n'a rien à
dire d'elle-même — ni à un visiteur, ni à un moteur. `catalog_tags` ne porte aujourd'hui qu'un
libellé et un slug ; elle devient une entité éditoriale.

## 2. Portée et tranches

### Dans le périmètre

- Les six routes du §0, leur métadonnée, leur fil d'Ariane et leur JSON-LD.
- Le défilement infini et son pont d'API.
- `catalog_tags` éditoriale : migration, seed, et **l'écran admin qui la remplit**.
- La correction de `?tag=` inconnu, et l'extraction des prédicats de `search_catalog`.

### Tranches

| # | Contenu | Ce qu'elle livre |
|---|---|---|
| **1** | `search_catalog` republiée (`p_sin_tag`, tag inconnu ignoré) · `buscarTipo` étendue · `ListadoTipo` · les quatre listings · le pont · `ListadoInfinito` · `Migas` · seed | **quatre** des cinq « Ver más » cessent d'être des 404 |
| **2** | `catalog_tags` éditoriale · `search_catalog_tags` · `listarTagsConOferta` · `TarjetaCategoria` · `IndiceCategorias` · `/actividades` et `/actividades/[tag]` | le **cinquième**, et la navigation par catégorie |
| **3** | `/api/upload/tag` · le bloc « contenu de la catégorie » sur `/admin/tags/[id]` · le slug réservé côté formulaires | une catégorie devient éditable **sans SQL** |

La Tranche 3 ne bloque pas la 2 : le seed remplit directement les colonnes. Mais tant qu'elle n'est
pas livrée, **une catégorie créée en préprod ou en production naît sans image ni texte** — à dire
franchement plutôt qu'à découvrir.

### Hors périmètre, et pourquoi

- ~~**Un filtre par catégorie sur les quatre autres listings.**~~ — **FAIT le 2026-09-14**, hors
  périmètre de cette spec : les cinq types ont désormais un index de catégories généralisé, sur
  demande explicite de Jérôme (§10quinquies). Ce que le cahier §2a ne prévoyait que pour les
  activités a été étendu sans réouverture formelle du cahier.
- **Un `ItemList` JSON-LD sur les listings.** Il ne décrirait que la première page, alors que la
  règle SEO 6 exige qu'un JSON-LD décrive **exactement** ce que la page affiche. Le maillage passe
  déjà par les liens des cartes et par le sitemap.
- **Le fil d'Ariane des fiches** produit et établissement : spec 30, avec les écrans concernés.
- **Le tri d'une liste.** L'ordre reste `created_at desc`, celui des sections de l'accueil ; le
  cahier §2a garde l'algorithme de mise en avant hors périmètre, et un sélecteur de tri serait le
  premier pas dedans.

## 3. Décisions retenues (entretien du 2026-09-08)

Treize arbitrages, dans l'ordre où ils ont été posés. Chacun porte la raison qui l'a emporté, parce
que c'est elle qui permettra de rouvrir la décision plus tard sans la redécouvrir.

1. **Une activité sans tag n'est pas perdue : une tuile « Otras actividades » la rattrape.** Elle
   n'est rendue que s'il existe au moins une telle activité, et elle disparaît d'elle-même quand
   tout est classé. *Écarté* : ne rien faire (une offre publiée deviendrait invisible depuis la
   navigation par catégorie) ; interdire la publication sans tag (une règle métier qui vit dans
   `apps/admin`, donc un autre lot, et le trou resterait ouvert d'ici là).
2. **Son adresse est `/es/actividades/otras`, un slug réservé par contrainte.** *Écarté* :
   `?sin_tag=1` sur l'index — une même URL rendrait deux écrans différents, et la page perdrait
   une adresse propre à indexer.
3. **L'index respecte les critères de recherche** : un tag n'apparaît que s'il porte au moins une
   offre qui y répond, et chaque tuile les emporte vers sa liste. C'est le cahier §2a (« le bloc
   reste présent sur toutes les pages qui affichent des listes, les critères se conservent »), et
   c'est ce qui garantit qu'une tuile ne mène jamais à une page vide.
4. **Ordre alphabétique, dans la langue affichée.** C'est le seul ordre qu'un visiteur peut
   prédire. *Écarté* : par nombre d'offres — invisible à l'œil puisque le nombre n'est pas affiché,
   et il bouge à chaque publication.
5. **Titre visible, au-dessus du bloc de recherche, sur les six pages.** La règle « rien au-dessus
   du bloc » du cahier §2a ne concerne que l'accueil. Sur une page de catégorie, un `<h1>` masqué
   laisserait le visiteur deviner où il a atterri.
6. **Une catégorie porte une image, un nom et un texte** — décision de Jérôme en cours d'entretien,
   qui renverse le choix précédent (« libellé seul ») : *« les tags qui sont en fait des
   catégories, on doit pouvoir ajouter une image et le nom et son texte que l'on display »*. Elle
   change le modèle de données, pas seulement l'affichage.
7. **Le texte se lit deux fois : sur la tuile et en tête de sa page.** Il aide à choisir dans
   l'index, puis présente la catégorie une fois dedans — et c'est le **seul contenu rédactionnel
   indexable** d'une page de catégorie, qui n'aurait sinon que des cartes.
8. **L'image ne sert qu'une fois : sur la tuile.** *Écarté* : un bandeau en tête de la page de
   catégorie — il deviendrait le LCP, et cette place revient à la première carte.
9. **Le lot étend l'écran admin.** Une catégorie doit être éditable en préprod et en production,
   pas seulement par le seed. Le lot grossit d'un écran et de ses tests ; c'est le prix d'une
   fonctionnalité réellement livrée.
10. **Une recherche lancée depuis un listing repart à l'accueil.** Le site n'a qu'**un seul écran
    de résultats**, comme la spec 28 l'a posé. *Écarté* : rester sur le listing — un « kayak »
    tapé depuis les hébergements afficherait « aucun résultat » alors que le site en vend trois,
    et il aurait fallu inventer une échappatoire pour le rattraper.
11. **Défilement automatique, avec un bouton de repli toujours rendu.** Le confort du défilement
    infini sans son défaut d'accessibilité. Le pied de page recule à chaque chargement : c'est le
    coût assumé de ce motif, et le bouton reste le seul chemin au clavier.
12. **`?pagina=N` dans l'adresse.** Revenir depuis une fiche retrouve les offres déjà chargées, et
    l'URL se partage. Ouvrir `?pagina=3` directement fait rendre les trois pages par le serveur :
    une requête plus large, pas un écran de plus.
13. **Un fil d'Ariane complet, avec son JSON-LD `BreadcrumbList`.** Un visiteur arrivé par Google
    sur une page de catégorie ne doit pas être dans un cul-de-sac.

## 4. Parcours cible

```
Accueil /es?q=kayak
  │
  ├─ section « Actividades » → « Ver todas las categorías »
  │     └─ /es/actividades?q=kayak
  │          ├─ Kayak       → /es/actividades/kayak?q=kayak
  │          ├─ Buceo       → (absent : aucune offre « kayak » en buceo)
  │          └─ Otras       → /es/actividades/otras?q=kayak
  │
  └─ section « Alojamientos » → « Ver más »
        └─ /es/alojamientos?q=kayak
             ├─ 24 offres rendues par le serveur
             ├─ on défile      → 48 offres, l'adresse devient ?q=kayak&pagina=2
             ├─ on ouvre une fiche
             └─ ← retour       → les 48 offres sont là, la position est gardée
```

Et le chemin inverse, celui d'un visiteur venu d'un moteur :

```
Google → /es/actividades/kayak
           ├─ Inicio / Actividades / Kayak        (le fil d'Ariane le sort du cul-de-sac)
           ├─ Kayak                               (h1)
           ├─ « Recorridos guiados por el embalse… »   (le texte de la catégorie)
           └─ [ buscar… ] → toute recherche le ramène à /es
```

## 5. Les écrans, bloc par bloc

### 5a. L'index de catégories — `/es/actividades`

⚠️ **Périmé depuis le 2026-09-14 — voir §10quinquies.** Ce qui suit décrit l'index de TUILES validé
le 2026-09-08 (`TarjetaCategoria`, une grille sans offre). Il a été remplacé par un index de
SECTIONS (chaque catégorie rend `SeccionOfertas`, le composant de l'accueil, avec un aperçu de ses
offres) — conservé ici comme trace de la décision d'origine, plus valide comme description du code.

**Le fil d'Ariane** : `Inicio / Actividades`. Le dernier élément n'est pas un lien (c'est la page
courante) et porte `aria-current="page"`. *(toujours vrai)*

**Le titre**, visible, en `<h1>` : « Actividades ». Il vient de next-intl, pas de la base — c'est
un libellé d'interface. *(toujours vrai)*

**Le bloc de recherche** : le même `BuscadorInicio` que l'accueil, avec `atajosTipo={[]}`. Les
raccourcis de type n'ont pas de sens ici (la page ne connaît qu'un type et n'a pas compté les
autres) ; les suggestions du catalogue, à partir de deux caractères, fonctionnent normalement.
Toute soumission navigue vers `/` avec les critères (décision 10). *(toujours vrai)*

~~**La grille de catégories.** Une colonne en mobile, deux à `md`, trois à `lg`… **Une tuile**
(`TarjetaCategoria`) : une image, un nom, un texte de deux ou trois lignes… **La tuile « Otras
actividades »** est rendue en dernier…~~ — remplacé par une **section par catégorie**
(`SeccionOfertas`, `variante="carrusel"`), chacune avec son titre (nom de la catégorie), ses 6
premières offres candidates et un « Ver más » **conditionnel** (`total > 6`, contrairement à
l'accueil où il est toujours rendu). Ni image ni texte éditorial de la catégorie ne sont affichés
ici (§10quinquies). La catégorie « sans tag » (ex-« Otras actividades ») ferme toujours la liste.

**L'état vide** : `EstadoVacio`, le composant de l'accueil. Il apparaît quand aucune catégorie ne
répond aux critères **et** qu'il n'y a pas d'offre sans tag. La barre reste au-dessus, utilisable.
*(principe inchangé)*

### 5b. La page d'une catégorie — `/es/actividades/[categoria]`

⚠️ Route renommée depuis `/es/actividades/[tag]` (cosmétique, §10quinquies) ; le contenu ci-dessous
reste exact et généralisé aux 5 types.

Le fil d'Ariane gagne un niveau : `Inicio / Actividades / Kayak`. Le `<h1>` est le **nom de la
catégorie**, résolu dans la locale. Sous lui, son texte, dans un `<p>` — s'il en a un.

Puis le bloc de recherche, puis la liste (§5d). `/es/actividades/otras` rend exactement le même
écran : son nom et son texte viennent de `messages/`, son fil d'Ariane est identique.

### 5c. Les quatre autres types — `/es/alojamientos`, `/transportes`, `/camps`, `/eventos`

⚠️ **Périmé depuis le 2026-09-14 — voir §10quinquies.** Décrivait ces quatre routes comme de
simples listings plats, sans index de catégories. Elles suivent désormais **le même patron que
`/actividades`** : `/es/alojamientos` (et les trois autres) sont devenues des index de catégories
(§5a généralisé), et `/es/alojamientos/[categoria]` (et les trois autres) sont devenues des pages
de catégorie (§5b généralisé). Le texte ci-dessous décrivait l'ancien listing plat, remplacé par
l'index :

~~`Inicio / Alojamientos`, un `<h1>` qui reprend le titre de la section correspondante de l'accueil
(**la même clé de traduction** — deux libellés parallèles divergeraient à la première retouche),
pas de texte descriptif, puis le bloc de recherche et la liste.~~

### 5d. La liste, et son défilement

**La première page est rendue par le serveur.** `ListadoInfinito` reçoit ses cartes en props ; il
n'en demande aucune au montage. C'est ce que le crawler lit, et c'est ce qui rend le LCP mesurable.

**La sentinelle** : un élément vide sous la dernière carte, observé par un `IntersectionObserver`
avec une marge basse (une hauteur d'écran) pour que la page suivante arrive avant le vide.

**Le bouton « Cargar más » est toujours rendu** tant que `hayMas`. Ce n'est pas un repli qui
apparaît quand l'observateur échoue : il est là dès le départ, c'est le seul chemin au clavier, et
c'est lui que l'e2e clique.

**La région d'état** (`role="status"`) est rendue **en permanence, vide au repos** — le piège du
§10quater de la spec 28 : une région montée au moment où elle a quelque chose à dire n'est jamais
annoncée par un lecteur d'écran. Elle porte « Cargando… », puis le décompte (« 48 de 132 »).

**L'adresse suit.** Après chaque page ajoutée, `history.replaceState` — jamais `push` : chaque
chargement empilerait une entrée d'historique, et le bouton « précédent » ferait remonter la liste
page par page au lieu de revenir d'où l'on vient.

**Une panne du pont ne vide rien.** La liste garde ce qu'elle affiche, la région d'état dit qu'elle
n'a pas pu charger la suite, et le bouton reste cliquable pour réessayer. C'est l'échec fermé en
lecture : ne jamais faire croire que le catalogue s'arrête là.

## 6. Modèle de données (delta)

### 6a. `catalog_tags` devient éditoriale

```sql
alter table public.catalog_tags
  add column description jsonb,
  add column image_path   text;

-- « otras » désigne la page des activités NON classées : une catégorie portant ce slug la
-- masquerait, et la collision serait silencieuse (les deux routes sont légitimes).
alter table public.catalog_tags
  add constraint catalog_tags_slug_reservado check (slug <> 'otras');
```

Les deux colonnes sont **nullables** : les catégories existantes n'en ont pas, et une catégorie
créée par l'admin avant d'être rédigée doit rester valide. `description` suit la convention de
`label` — `{es, en?}`, repli obligatoire, jamais une colonne par langue (CLAUDE.md §5.1).

**Une colonne d'image, pas une table de médias.** `product_media` et `establishment_media` existent
parce qu'un produit a une galerie ordonnée. Une catégorie a **une** image de couverture : une table
lui imposerait un `sort` qui ne veut rien dire et une jointure à chaque lecture. Le chemin pointe
dans le bucket `catalog-media` déjà en place (spec 04), dossier `tags/`.

⚠️ **Remplacer l'image d'une catégorie laisse l'ancien objet dans le bucket.** C'est le
comportement actuel de tout le module images du dépôt ; le corriger ici serait un chantier à part
(il faudrait le faire partout). Signalé au §10.

### 6b. Les six filtres n'existent qu'une fois — et `search_catalog` n'est pas découpée

⚠️ **Cette section renverse la première rédaction, arbitrée par Jérôme le 2026-09-08 en cours
d'implémentation.** Le texte validé le matin faisait extraire les six prédicats dans une fonction
`catalog_candidates` que `search_catalog` et `search_catalog_tags` auraient consommée. Deux faits
constatés en l'écrivant l'ont fait abandonner :

- **`security invoker` impose `grant execute … to anon`** sur la fonction extraite — sans quoi
  `search_catalog`, qui s'exécute avec les droits du visiteur, ne pourrait pas l'appeler. La
  fonction interne serait donc devenue une **RPC PostgREST publique**
  (`POST /rest/v1/rpc/catalog_candidates`), née d'un détail d'implémentation. Aucune donnée nouvelle
  exposée — mêmes policies, mêmes lignes — mais une surface d'API de plus, sans contrepartie.
- **Il aurait fallu découper une fonction de 300 lignes qui marche**, couverte par 16 assertions
  pgTAP, pour un seul consommateur nouveau.

**Ce qui est fait à la place** : `search_catalog` ne gagne que ses deux prédicats (§6c), et
`search_catalog_tags` **l'appelle**. Pour les activités, `search_catalog` ne groupe rien — elle rend
exactement les produits candidats, avec `es_establecimiento = false`. L'index lit cette sortie, jette
ce dont il n'a pas besoin (photos, prix, comptages) et compte les tags.

**L'objectif est atteint identiquement** : les six filtres n'existent **qu'une seule fois**, dans
`search_catalog`. C'est cela qui compte, pas la forme du découpage — deux copies divergeraient un
jour, l'index proposerait « Kayak » et la page Kayak dirait « aucun résultat », **sans qu'aucun test
des deux fonctions ne devienne rouge**.

**Ce que cette voie coûte, dit franchement** :

- `search_catalog_tags` dépend de la **forme de sortie** de `search_catalog`, pas seulement de son
  comportement. Si `es_establecimiento` change de sens, elle suit.
- Elle appelle avec `p_limite => 1000000` : le plafond par défaut est de 24, et l'index doit voir
  **tout** le catalogue candidat. C'est le même motif que le test pgTAP (`p_limite => 100000`,
  posé après un faux rouge en septembre) — connu, documenté, jamais un appel nu.
- `search_catalog` agrège les photos et les prix de chaque ligne, dont l'index ne fait rien. Mesuré
  le 2026-09-08 sur la base locale : **10 offres vendables, 0 média**. Gratuit à cette échelle, et
  c'est le même raisonnement qui a déjà écarté l'index trigramme.
- **Limite structurelle** : sur un type qui groupe (`lodging`), l'index ne verrait que les produits
  **non** groupés — les assignations de tags portent sur des produits, jamais sur un établissement.
  Sans effet aujourd'hui, l'index de catégories ne concernant que les activités (cahier §2a) ; à
  reprendre le jour où un autre type en veut un.

**Elle reste `security invoker`** — ce que la spec 27 a tranché et documenté : elle ne lit que du
public, les policies `_select_public` s'appliquent d'elles-mêmes, et poser `security definer`
contournerait RLS sans aucun besoin (CLAUDE.md §3.5).

⚠️ **`create or replace` ne suffit pas** : la signature change (`p_sin_tag`). `drop function
public.search_catalog(text, text[], text, int, date, date, int, int, int);` explicite d'abord,
puis `create`, puis **regrant** — c'est la règle 7 de `.claude/rules/supabase.md`, et un grant
oublié rendrait la vitrine entière muette pour `anon`.

⚠️ **Aucun appel positionnel n'existe** (vérifié le 2026-09-08 : `buscar.ts`, `sugerencias.ts` et
les 16 assertions pgTAP nomment tous leurs paramètres). `p_sin_tag` peut donc être inséré à sa place
logique, juste après `p_tag_slug`, plutôt qu'ajouté en queue de signature.

### 6c. Les deux prédicats nouveaux

```sql
-- 1. Un tag inconnu est IGNORÉ, comme tout paramètre invalide de ce dépôt (spec 28 §0).
--    Sans la deuxième ligne, un slug absent de catalog_tags filtre TOUT et la page reste vide
--    indéfiniment, puisque le bloc de recherche le reporte à chaque soumission.
and (
  p_tag_slug is null
  or not exists (select 1 from public.catalog_tags ct where ct.slug = p_tag_slug)
  or exists (
    select 1 from public.product_tag_assignments pta
    join public.catalog_tags ct on ct.id = pta.tag_id
    where pta.product_id = p.id and ct.slug = p_tag_slug
  )
)

-- 2. « Otras actividades » : aucune assignation, quel que soit le tag.
and (
  not p_sin_tag
  or not exists (
    select 1 from public.product_tag_assignments pta where pta.product_id = p.id
  )
)
```

### 6d. L'index de catégories

⚠️ **Périmé — `search_catalog_tags` supprimée le 2026-09-14, remplacée par
`search_catalog_categorias`, voir §10quinquies pour sa signature exacte.** Conservé ci-dessous comme
trace de la Tranche 2 d'origine (2026-09-08) :

```sql
create function public.search_catalog_tags(
  p_tipo     text default 'activity',
  p_query    text default null,
  p_personas int  default null,
  p_desde    date default null,
  p_hasta    date default null
) returns table (
  slug        text,
  label       jsonb,
  description jsonb,
  image_path  text,
  total       bigint,
  es_sin_tag  boolean
)
language sql stable security invoker set search_path = ''
as $$ … $$;
```

Son corps tient en une quinzaine de lignes, parce qu'il ne refait aucun filtrage (§6b) :

```sql
with candidatos as (
  select sc.id
  from public.search_catalog(
    p_query => p_query, p_tipos => array[p_tipo], p_personas => p_personas,
    p_desde => p_desde, p_hasta => p_hasta, p_limite => 1000000
  ) sc
  where not sc.es_establecimiento   -- une assignation de tag porte sur un PRODUIT (§6b)
)
-- une ligne par catégorie, puis la ligne « sans tag » si elle a lieu d'être
```

Elle rend **une ligne par catégorie** portant au moins une offre candidate, plus — si au moins une
offre candidate n'a aucun tag — **une ligne `es_sin_tag = true`** dont `slug`, `label`,
`description` et `image_path` sont `null`.

Une ligne d'une nature différente dans le même retour n'est pas une entorse : c'est exactement ce
que fait déjà `search_catalog` avec `es_establecimiento`, pour la même raison — un seul aller-retour,
et le TypeScript décide quoi en faire.

`total` n'est **pas affiché** (décision 4 : les tuiles portent un texte, pas un chiffre). Il est
rendu parce qu'il est le critère d'existence de la ligne, et parce qu'un test doit pouvoir
l'affirmer : *cette catégorie est là parce qu'elle a trois offres*.

**Le tri n'est pas fait en SQL.** L'ordre alphabétique porte sur le libellé **résolu dans la
locale**, avec son repli JSONB — que la base ne connaît pas. Un `order by label->>'es'` classerait
la version anglaise par ses libellés espagnols, et ignorerait la collation (« ñ », les accents).
`listarTagsConOferta` trie avec `Intl.Collator(locale)`.

### 6e. Le seed

Le seed n'a **aucun** tag ni assignation. Il gagne :

- **quatre catégories** avec `label` et `description` en es **et** en — sans quoi rien ne prouve
  que le repli et la locale anglaise fonctionnent ;
- **deux activités vendables de plus** : avec les deux actuelles, l'index ne montrerait qu'une ou
  deux tuiles, et l'ordre alphabétique n'est vérifiable qu'à partir de deux catégories ;
- des assignations qui laissent **au moins une activité vendable sans tag** — c'est ce qui rend la
  tuile « Otras actividades » atteignable en e2e.

⚠️ **Aucune image dans le seed** : il n'en a aucune, et `storage.objects` ne se remplit pas depuis
un fichier SQL (il faudrait le binaire). Les tuiles rendront donc l'aplat en local comme en e2e —
c'est le substitut prévu, et la variante avec image est couverte par le test de composant et sa
story. À dire plutôt qu'à laisser découvrir.

## 7. Contrat — URL, données, composants

### 7a. `lib/catalog/`

⚠️ **Périmé — `listarTagsConOferta` remplacée le 2026-09-14 par `buscarCategorias`, voir
§10quinquies.** `buscarTipo` n'a pas bougé :

```ts
// buscar.ts — inchangée depuis la Tranche 1
export async function buscarTipo(
  tipo: TipoOferta,
  criterios: Criterios,
  { limite, desplazamiento, locale, sinTag }: {
    limite: number; desplazamiento: number; locale: string; sinTag?: boolean;
  }
): Promise<{ tarjetas: TarjetaOferta[]; total: number; hayMas: boolean }>;

// buscar.ts — REMPLACÉE le 2026-09-14 par buscarCategorias (§10quinquies)
export async function listarTagsConOferta(
  tipo: TipoOferta,
  criterios: Criterios,
  { locale }: { locale: string }
): Promise<CategoriaConOferta[]>;
```

⚠️ **`sinTag` est une option, jamais un critère.** Il vient du segment d'URL `otras`, pas d'un
paramètre ; le mettre dans `Criterios` le ferait écrire dans les liens par `escribirCriterios`.
*(toujours vrai)*

⚠️ **Écart assumé avec la spec 27 §0**, qui annonçait `listarTagsConOferta(tipo)`. Doublement
périmé depuis : la fonction elle-même a été remplacée le 2026-09-14. La spec 27 est à corriger sur
cette ligne — comme elle l'a déjà été pour le `<main>` de `PageShell`.

### 7b. `lib/catalog/criterios.ts`

```ts
export const TAMANO_PAGINA = 24;   // multiple de 1, 2 et 3 — les trois largeurs de la grille
export const MAX_PAGINAS = 20;     // plafond dur : 480 offres, cf. §0

/** Jamais dans `Criterios` : ce n'est pas un filtre. Hors bornes ou illisible → 1. */
export function leerPagina(params: ParamsBrutos): number;
```

### 7c. Le pont — `GET /api/catalogo/listado`

`?tipo=&tag=&sinTag=&pagina=&q=&personas=&desde=&hasta=&locale=` →
`{ tarjetas: TarjetaOferta[], hayMas: boolean }`.

Il appelle la **même** fonction que la page (`buscarTipo`), avec le **même** client anonyme et les
mêmes policies : il n'expose rien de plus qu'elle. Exactement le pont des suggestions
(spec 28 §10ter), et pour la même raison — le composant qui défile est client, `lib/catalog/` est
réservé au serveur.

⚠️ **Une réponse d'échec ne porte pas de clé `tarjetas`** (`{ ok: false, reason }`) : une panne qui
aurait la forme d'un succès s'afficherait comme « il n'y a plus rien ». Et côté client,
`if (!reponse.ok) throw` — la revue du 2026-09-08 a montré que son absence laissait toute la suite
verte pendant que le rendu partait en `TypeError`.

### 7d. Les composants

⚠️ **Périmé — `TarjetaCategoria` et `IndiceCategorias` supprimés le 2026-09-14** (commit `8d4849eb`,
§10quinquies), remplacés par la réutilisation de `SeccionOfertas` (déjà le composant de l'accueil,
pas un nouveau composant). Table corrigée :

| Composant | Où | `"use client"` | Pourquoi |
|---|---|---|---|
| ~~`TarjetaCategoria`~~ | — | — | **supprimé 2026-09-14**, sans remplaçant dédié |
| `Migas` | `molecules/` | **oui** | `Breadcrumbs` de HeroUI v3, via `@hifago/ui` |
| ~~`IndiceCategorias`~~ | — | — | **supprimé 2026-09-14** → `IndiceCategoriasConOfertas` (colocalisé `(vitrine)/`, non client, appelle `buscarCategorias` puis rend des `SeccionOfertas`) |
| `SeccionOfertas` | `organisms/` | **oui** | déjà le composant de section de l'accueil ; réutilisé tel quel pour chaque catégorie de l'index depuis le 2026-09-14 |
| `ListadoInfinito` | `organisms/` | **oui** | l'observateur, l'état de la liste, `replaceState` |
| `ListadoTipo` | colocalisé `(vitrine)/` | **non** | Server Component : il appelle `buscarTipo` — inchangé |

⚠️ `Breadcrumbs` existe bien dans HeroUI v3 (`node_modules/@heroui/react/dist/components/breadcrumbs`)
— donc il **doit** passer par `packages/ui` : jamais un fil d'Ariane maison à côté du design system
(CLAUDE.md §2.2). À vérifier à l'implémentation : si son `Item href=` rend un `<a>` **natif**, le
préfixe de langue s'y pose à la main, comme pour les options de `SearchBar` (spec 28 §10ter).

### 7e. Les messages

Un namespace `ListadoPage`, un fichier par locale. Il porte : les titres des quatre listings (**les
mêmes clés que `HomePage.secciones.*`** — jamais un second jeu), « Otras actividades » et son texte,
« Cargar más », le décompte, les états vides, les libellés du fil d'Ariane, et le message d'échec du
pont. Parité es/en vérifiée par `messages/parity.test.ts`.

⚠️ Les tests de ces composants montent le catalogue par `loadMessages("es")`, **jamais un objet
écrit à la main** : la revue du 2026-09-08 a montré qu'un catalogue manuel laisse tout vert pendant
qu'une variable renommée casse chaque libellé en production (`t()` n'est pas typé sur le catalogue
dans ce dépôt, et `parity.test.ts` ne compare que des chemins de clés, jamais leurs variables).

## 8. Règles et invariants

Les dix du §0, plus ce qui ne s'y résume pas :

1. **`generateMetadata` sur chacune des six pages**, avec canonical auto-référent sans paramètres
   (règle SEO 4). Pour une catégorie, le titre et la description viennent de son contenu ; sans
   description rédigée, la description de la page se rabat sur un libellé d'interface — jamais une
   balise vide.
2. **`noindex` pour une catégorie sans contenu natif dans la locale servie** (règle SEO 2) : une
   page « Kayak » servie en anglais avec un texte espagnol de repli reste `noindex` + canonical vers
   l'espagnol, tant qu'aucune traduction réelle n'existe. Le prédicat est `hasNativeContent`, celui
   du sitemap et des fiches — jamais recopié.
3. **Le sitemap gagne les pages de catégorie**, une entrée par locale réellement traduite, avec le
   **même** prédicat que le point 2. Les six routes fixes y entrent aussi, dans les deux locales :
   elles sont indexables et n'ont pas de contenu partenaire.
4. **Le JSON-LD `BreadcrumbList` est rendu côté serveur**, dans le `page.tsx`, échappé — jamais
   dans `Migas` (règle SEO 6). Le composant affiche ; la page décrit.
5. **Un `error.tsx` existe déjà pour la zone vitrine** (spec 28 §10quater) : ces six pages en
   héritent, rien à créer. Une base injoignable rend un écran lisible, pas une liste vide.
6. **Responsive** : reflow en cartes sous `md`, cible tactile ≥ 44 px sur le bouton et les tuiles,
   jamais `hidden md:block` (`.claude/rules/ui.md`).

**Aucun nouveau contrôle CI n'est nécessaire**, et c'est un constat, pas un oubli
(CLAUDE.md §11.20) : `check-data-layer.sh` couvre automatiquement les six nouvelles routes (aucune
requête Supabase, aucun `@hifago/ui` dans un fichier de route) ; le slug réservé est tenu par une
contrainte de base ; le plafond de `pagina` par un test unitaire. Ce qui reste sans vérification
mécanique est nommé au §10.

## 9. Cas limites

Ceux du §0, plus les trois qui demandent une explication :

**Ouvrir `?pagina=3` directement.** Le serveur rend `3 × TAMANO_PAGINA` offres en une requête
(`limite = 72, desplazamiento = 0`), pas la seule troisième tranche. Rendre la 3ᵉ page isolée
donnerait une liste qui commence au milieu de rien — et le retour depuis une fiche, qui est
précisément le cas d'usage de ce paramètre, afficherait une liste tronquée par le haut.

**Une catégorie vidée entre l'index et le clic.** L'index l'affichait, sa page rend 404 : c'est
correct et volontaire. L'alternative (une page vide indexable) est exactement ce que le cahier §2a
interdit.

**Un tag existant, mais qui ne porte que des offres non vendables.** `catalog_candidates` filtre sur
`p.sellable and e.status = 'active'` : la catégorie est absente de l'index et sa page rend 404. Le
même prédicat sert aux deux — c'est tout l'intérêt de l'avoir extrait.

## 10. Décisions tranchées / points ouverts

**Tranché le 2026-09-08** — les treize décisions du §3.

**Ce que la rédaction a décidé** (et que Jérôme a validé en bloc le 2026-09-08, après les avoir vus
énumérés) — ce ne sont pas des arbitrages produit, mais ils engagent le code :

1. ~~**Extraire `catalog_candidates`**~~ — **renversé le 2026-09-08 en cours d'implémentation, et
   arbitré par Jérôme** : `search_catalog` n'est pas découpée, `search_catalog_tags` l'appelle. Les
   deux faits qui l'ont emporté (une RPC publique née d'un `grant` obligatoire, et 300 lignes
   validées qu'il aurait fallu couper) sont au §6b, avec ce que la voie retenue coûte. L'objectif
   — les six filtres n'existent qu'une fois — est atteint identiquement.
2. **Une colonne `image_path`, pas une table de médias** (§6a).
3. **`?pagina` plafonnée à 20, page de 24 offres** (§0). Le plafond est une protection, pas un
   réglage : sans lui, une URL publique et anonyme demande des millions de lignes à Postgres.
4. **Trois tranches** (§2), les quatre listings d'abord — ce sont quatre 404 en moins dès la
   première.
5. **Le sitemap gagne les pages de catégorie** (§8.3), avec le prédicat de contenu natif déjà
   utilisé par les fiches.
6. **La spec 27 §0 est à corriger** : elle annonce `listarTagsConOferta(tipo)`, la signature réelle
   gagne les critères et la locale (§7a).
7. **Le seed gagne quatre catégories et deux activités, sans aucune image** (§6e).

**Point ouvert — l'image orpheline.** Remplacer l'image d'une catégorie laisse l'ancien objet dans
le bucket. C'est le comportement de tout le module images depuis la spec 04 ; le corriger pour les
seules catégories créerait une incohérence de plus. À traiter globalement, ou pas du tout.

**Point ouvert — le pied de page recule.** C'est le défaut structurel du défilement automatique
(décision 11), assumé. Si les liens du pied de page deviennent nécessaires (mentions légales,
contact — routes repoussées par la spec 27 §0), il faudra soit les remonter, soit revoir la
décision. Rien à faire tant qu'ils n'existent pas.

**Ce que rien ne vérifie mécaniquement**, et qui tient donc à la relecture (§11.20) : que le `<h1>`
d'un listing utilise bien la clé de `HomePage.secciones.*` et non un libellé parallèle ; que le fil
d'Ariane d'une page de catégorie nomme la catégorie et non son slug.

**Hérités, non rouverts** : les six points du cahier §2f · l'algorithme de mise en avant dans une
section (cahier §2a) · les deux arbitrages ouverts de la spec 28 §10bis (le décompte de couchages
sur la carte groupée, le carrousel de la carte d'activité dans un visuel de 64 px) — ⚠️ le second
touche `Card layout="row"`, **la variante `lista` que ce lot ne rend pas** : les six pages de la
spec 29 utilisent la grille.

## 10bis. Ce que l'implémentation a corrigé (2026-09-08, Tranches 1a et 1b)

Le SQL et les quatre listings sont livrés. Neuf écarts avec le texte ci-dessus, tous constatés en
codant — et deux d'entre eux ont fait GAGNER du travail plutôt qu'en ajouter.

1. **`lib/seo/jsonld/breadcrumb.ts` existait déjà**, avec son test, et il est **déjà posé sur les
   deux fiches** (produit, établissement). Le §0 l'annonçait « à créer » : rien à écrire.
   ⚠️ Constat qui en découle et qui n'était pas prévu : **les fiches déclarent aux moteurs un fil
   d'Ariane qu'aucun visiteur ne voit** — le JSON-LD est là, le composant visible n'existait nulle
   part. La règle SEO 6 veut qu'un JSON-LD décrive ce que la page affiche ; ce lot ajoute le fil
   visible sur ses propres pages, l'écart subsiste sur les deux fiches. Porté au backlog.
2. **`BuscadorInicio` poussait DÉJÀ vers `/`** — il pousse `escribirCriterios(...)` préfixé de `/`. La
   décision 10 — « une recherche depuis un listing repart à l'accueil » — était donc gratuite : le
   §0 prévoyait de le modifier pour une « destination explicite », il n'a pas été touché. Seul
   `atajosTipo={[]}` lui est passé.
3. **`Migas` enveloppe HeroUI dans un `<nav>` à nous.** Vérifié au rendu : `Breadcrumbs` rend un
   `<ol>` NU. Un `<ol>` portant un `aria-label` n'est pas un landmark ARIA — sans enveloppe, le fil
   disparaissait de la liste des repères de la page, pour le public à qui il sert le plus.
4. **Le plafond de `pagina` est reposé dans le Route Handler**, pas seulement dans la page : le pont
   est appelable directement, et `?pagina=99999` y aurait contourné la protection en une requête.
   Un plafond ne vaut qu'à chaque porte d'entrée.
5. **Le bouton « Cargar más » utilise `isPending`, jamais `isDisabled`.** L'atome `Button` le dit
   déjà, et la raison compte ici plus qu'ailleurs : un bouton désactivé **perd le focus**, donc le
   visiteur au clavier serait renvoyé en haut du document à chaque page chargée — sur le seul
   chemin qui lui soit garanti.
6. **`delete criterios.tipo` plutôt que `tipo: undefined`.** `hayCriterios` compte les CLÉS
   présentes : une clé posée à `undefined` compte pour un filtre, et la page aurait affiché « ta
   recherche ne donne rien » là où il faut « cette section est encore vide », sur une route où
   personne n'a rien cherché.
7. **La ref de l'observateur se synchronise dans un effet.** `react-hooks/refs` a refusé l'écriture
   pendant le rendu, à juste titre : elle casse la pureté du rendu, que React 19 peut jeter et
   rejouer.
8. **`npx next typegen`** est nécessaire après avoir créé une route : `PageProps<"/[locale]/camps">`
   n'existe pas tant que les types de routes ne sont pas régénérés, et l'erreur (`does not satisfy
   the constraint 'AppRoutes'`) ne dit pas quoi lancer.
9. **La migration s'appelle `20260908120000_search_catalog_sin_tag.sql`** et ne contient que
   `search_catalog` : `search_catalog_tags` part en Tranche 2, puisqu'elle rend `description` et
   `image_path`, colonnes que la Tranche 2 crée.

**Deux limites du lot, dites plutôt que découvertes** :

- **Le défilement n'est pas couvert en e2e**, et il ne peut pas l'être : une page sert 24 offres, le
  seed en compte dix, `hayMas` est donc toujours faux et le bouton n'est jamais rendu. Fabriquer 25
  offres dans un spec pour voir un bouton coûterait plus que ce que ça prouve.
  `ListadoInfinito.test.tsx` couvre l'ajout de page, le décompte, le `replaceState` et l'échec du
  pont avec le vrai composant ; l'e2e couvre le PONT, en HTTP, contre la vraie base.
- **Trois des quatre listings sont vides** avec le seed actuel : aucun camp, evento ni transporte
  n'y est vendable. C'est le cas « route structurelle sans offre » du §9 — 200 et un état vide,
  jamais un 404 — et c'est ce qui a permis de le tester sans rien fabriquer.

## 10ter. La Tranche 2 telle qu'elle a été construite (2026-09-08)

L'index de catégories, ses pages, `catalog_tags` éditoriale et le seed sont livrés. Six écarts et
constats avec le texte ci-dessus.

1. **`products.category` n'est PAS un tag**, et la confusion a coûté une contrainte violée au
   premier essai du seed : c'est l'ancienne liste FERMÉE de six familles
   (`products_category_check` : musica, arte, bienestar, nautica, adrenalina, gastronomia), celle
   que `catalog_tags` remplace précisément (spec 08 §5). Les deux coexistent tant que la colonne
   n'est pas retirée — le seed y met donc une valeur valide de l'ancienne liste, sans rapport avec
   la catégorie assignée.
2. **`CategoriaConOferta` porte `localesNativas`**, non prévu au §0. Le nom d'une catégorie est du
   contenu partenaire : une page servie en repli (nom espagnol sous `/en/`) doit rester `noindex`
   avec canonical vers la langue source (règle SEO 2). La couche le calcule avec `hasNativeContent`,
   **le même prédicat que le sitemap et les fiches** — jamais une seconde version. « Otras
   actividades » fait exception : ses libellés viennent de next-intl, elle est native partout.
3. **La page `[tag]` fait DEUX lectures, et c'est le bon compte.** La première décide si la page
   existe (`cache()` la partage avec `generateMetadata`, motif des deux fiches) ; la seconde
   demande les offres. Elles ne peuvent pas fusionner : une liste vide ne distingue pas
   « catégorie inconnue » de « catégorie vidée » — les deux rendent 404 — d'une **recherche** sans
   résultat dans une catégorie vivante, qui rend 200.
4. **`getCategorias` est appelée SANS critères**, à dessein : « cette catégorie existe-t-elle ? » ne
   dépend pas de la recherche en cours. Y passer les critères ferait rendre 404 dès qu'un filtre ne
   laisse rien — un lien partagé deviendrait mort selon les dates qu'il porte.
5. **Le message du slug réservé est livré ici, pas en Tranche 3** (le §2 le plaçait avec l'admin
   éditorial). La contrainte et son message vont ensemble : livrer l'une sans l'autre ferait lire
   « No se pudo crear la etiqueta » à un admin qui a simplement nommé une catégorie « Otras ».
   `NewTagForm` **et** `RenameTagButton` (qui recalcule le slug) traitent le code `23514`.
6. **Le fil d'Ariane HeroUI rend la page courante en `<span role="link" aria-disabled="true">`.**
   Le `aria-current="page"` est correct et posé tout seul — c'est ce qui compte — mais un lecteur
   d'écran annonce « lien désactivé », un anti-motif du fil d'Ariane. Comportement du socle :
   documenté et porté au backlog, jamais contourné par un composant parallèle. Conséquence
   pratique : un test compte `a[href]`, jamais `getByRole("link")`.

**Ce que le seed exerce, et qui ne s'invente pas** : `cultura` n'est assignée qu'à une offre **non
vendable** et `gastronomia` à **aucune** — les deux doivent être absentes de l'index ET rendre 404
sur leur page. C'est le cas limite le plus facile à casser sans s'en apercevoir (il suffirait
d'oublier le prédicat `p.sellable`), et il est maintenant tenu par l'e2e comme par pgTAP.

⚠️ **Une fragilité RÉVÉLÉE, pas créée, par ce lot** : `home.spec.ts` (« carte groupée ») a échoué
une fois pendant la Tranche 2. Cause mesurée — `reserve-lodging-pms-availability` laisse un produit
`lodging` derrière lui à **chaque** exécution ; l'ordre étant `created_at desc`, huit résidus
saturent le plafond de 8 de la section et poussent la carte du seed hors de l'accueil. Purgés à la
main, les 22 tests repassent. Aucun rapport avec le code de ce lot — porté au backlog.

## 10quater. La Tranche 3 telle qu'elle a été construite (2026-09-08)

L'écran admin qui remplit une catégorie est livré. Une catégorie créée en préprod ou en production
n'est plus condamnée à naître vide.

1. **Le Route Handler d'upload gagne UNE entrée de liste blanche, rien d'autre.**
   `/api/upload/[entity]` est le chemin canonique de **tout** le module images — photos de produits
   et d'établissements, propositions socio, import PMS. Sa signature, l'ordre de ses vérifications
   (session lue avant le corps de la requête) et ses deux chemins existants sont intacts.
   ⚠️ Le ternaire de choix du dossier est devenu une **table** : à trois valeurs, un
   `a ? b : c ? d : e` est l'endroit exact où une quatrième entité partirait dans le mauvais
   dossier sans que rien ne le signale — le fichier atterrirait dans `products/` et la page
   l'afficherait quand même.
2. **`MediaGallery` avec `maxPhotos={1}`**, pas de téléverseur maison : le README l'exige (« un
   composant qui duplique quelque chose de `packages/ui` est une rupture »), et ça donne
   gratuitement le recadrage, les messages d'erreur et le geste déjà connu des admins. `onReorder`
   est satisfait par un succès immédiat — on ne réordonne pas un élément unique, et rendre la prop
   optionnelle pour ce seul écran serait moins honnête.
3. **Le nettoyage du texte vit dans `lib/tags/`, pas dans le composant.** Ce n'est pas de la
   cosmétique de saisie : `hasNativeContent` (apps/web, partagé avec le sitemap) déclare une locale
   « native » dès que la chaîne est non blanche. Écrire `{ es: "…", en: "  " }` déclarerait la page
   `/en/` traduite et Google l'indexerait avec un texte vide (règle SEO 2). Fonction pure, donc
   testée comme telle — quatre cas.
4. **Le bouton suit la convention d'`apps/admin`** (`isDisabled` + libellé conditionnel) : le
   `Button` d'admin est le HeroUI brut, il n'a pas le couple `isPending`/`pendingLabel` que l'atome
   d'`apps/web` ajoute — celui qui garde le focus pendant l'envoi. Suivre la convention locale
   plutôt qu'innover dans un coin ; l'écart entre les deux apps est réel mais ne se corrige pas ici.

### Comment ça a été vérifié, faute de filet e2e

⚠️ **Les e2e admin sont tous cassés en local** (facteur MFA du seed refusé par GoTrue, backlog du
2026-09-07) : cet écran a donc été livré **sans aucun test de bout en bout**. Jérôme a choisi la
vérification manuelle, faite ainsi — et l'UI admin exigeant `aal2`, elle passe par HTTP :

| Ce qui a été exercé | Résultat |
|---|---|
| `POST /api/upload/tag` **sans session** | 401 `not_authenticated` — l'auth reste lue avant le corps |
| `POST /api/upload/zzz` | 400 `invalid_entity` |
| `POST /api/upload/{product,establishment,tag}` avec une vraie session admin | 200, et chacun dans **son** dossier (`products/`, `establishments/`, `tags/`) |
| L'objet dans le bucket | présent, converti en WebP par sharp |
| `image_path` écrit puis lu par la vitrine | `/es/actividades` sert bien l'URL de l'image |

**Ce qui N'A PAS été vérifié, et qu'il faut savoir** : le rendu de l'écran admin lui-même. Son
layout exige `aal2`, donc ni navigateur ni Playwright n'y accèdent tant que le seed MFA n'est pas
réparé. Le composant est couvert par le typecheck et par le test de sa seule logique ; sa mise en
page, son bouton et sa galerie n'ont été vus par personne.

Les objets téléversés pendant cette vérification ont été supprimés par l'API Storage (la
suppression SQL directe est refusée par `storage.protect_delete()`), et `image_path` remis à `null` :
la base locale est restée alignée sur le seed.

## 10quinquies. Ce qui a remplacé ce lot le 2026-09-14 (chantier « catégories partout »)

⚠️ **Ce n'est pas une tranche de cette spec** : c'est un lot ultérieur, non tracé par une spec
dédiée (`docs/dette-technique.md` le signalait comme tel), qui a remplacé une bonne partie du
système décrit aux §0/§5/§6d/§7. Reconstitué le 2026-09-21/22 par lecture du journal
(`docs/journal/2026-09.md`, entrée « 2026-09-14 (suite 3) », commit `8d4849eb`) et du code réel —
pas depuis mémoire.

**Déclencheur** : demande explicite de Jérôme, citée dans le journal — *« pas que l'alojamiento
doit avoir des cate tout doit pouvoir en avoir »*. Catégorie = tag éditorial libre, comme pour les
activités, mais pour les cinq types. Le comportement visé : `/alojamientos`, `/actividades`,
`/transportes`, `/camps`, `/eventos` doivent « ressembler à l'accueil — liste de catégories, chacune
avec un aperçu d'offres et un "Ver más" SI BESOIN ».

**Ce qui a changé, précisément** :

1. **L'index n'est plus une grille de tuiles vides : c'est une section par catégorie**, le même
   composant `SeccionOfertas` que l'accueil, avec un aperçu d'offres. `SeccionOfertas` gagne une
   prop `mostrarVerMas?: boolean` (défaut `true`, l'accueil ne change pas) ; le nouveau pattern par
   catégorie la pose à `total > tarjetas.length` — contrairement à l'accueil qui rend son « Ver más »
   inconditionnellement.
2. **`IndiceCategoriasConOfertas.tsx`** (nouveau fichier colocalisé `(vitrine)/`, non client) devient
   le corps partagé des CINQ index. `IndiceCategorias.tsx` et `TarjetaCategoria.tsx` (+ leurs test et
   story) sont supprimés — commit `8d4849eb`.
3. **`POR_CATEGORIA = 6`** (`IndiceCategoriasConOfertas.tsx:42`) — plafond d'offres par catégorie sur
   l'index, plafonné **en SQL** (fenêtre `rango_categoria`, jamais un `.slice()` côté TypeScript).
   Qualifié d'« arbitraire » par le journal lui-même — voir point 7.
4. **`search_catalog_tags` supprimée, remplacée par `search_catalog_categorias`**
   (`supabase/migrations/20260914120000_search_catalog_categorias.sql`, `drop` puis `create`) :
   ```sql
   create function public.search_catalog_categorias(
     p_tipo          text,
     p_query         text default null,
     p_personas      int  default null,
     p_desde         date default null,
     p_hasta         date default null,
     p_por_categoria int  default null
   )
   returns table (
     categoria_slug text, categoria_label jsonb, categoria_description jsonb,
     categoria_image_path text, es_sin_tag boolean, total_categoria bigint,
     rango_categoria bigint,
     -- + les colonnes carte habituelles : tipo, es_establecimiento, id, slug, nombre,
     -- descripcion, precio_cop, precio_desde, precio_label, establecimiento, fotos, n_alojamientos
   )
   language sql stable set search_path = ''
   ```
   Appelle `search_catalog(p_limite => 1000000, …)` en interne — les six prédicats de filtre restent
   dans une seule fonction (§6b, principe inchangé). Construit une ligne par `(candidat, tag)` via une
   CTE, plafonne PAR CATÉGORIE avec `row_number() over (partition by … order by …) as rango_categoria`
   filtré par `p_por_categoria`, et ajoute une branche `es_sin_tag = true` — la généralisation
   d'« Otras actividades » à tout type. Ne trie pas par libellé (locale inconnue côté SQL, tri fait en
   TypeScript, comme avant).
5. **`search_catalog` bifurque désormais la résolution du tag selon la forme de la ligne**
   (`supabase/migrations/20260914110000_search_catalog_tag_bifurcation.sql`, signature INCHANGÉE,
   `create or replace`) : une carte GROUPÉE (établissement `lodging` à ≥ 2 unités) lit son tag dans la
   nouvelle table `establishment_tag_assignments` (même calibrage RLS que `product_tag_assignments`) ;
   toute autre ligne le lit dans `product_tag_assignments`, comme avant. Sans cette bifurcation,
   l'index aurait pu montrer une catégorie que sa propre page de détail (qui appelle `buscarTipo` →
   `search_catalog`) aurait rendue vide.
6. **`lib/catalog/buscar.ts` gagne `buscarCategorias`** (remplace `listarTagsConOferta`), signature :
   ```ts
   export async function buscarCategorias(
     tipo: TipoOferta, criterios: Criterios,
     { porCategoria, locale }: { porCategoria: number; locale: string }
   ): Promise<CategoriaConTarjetas[]>
   ```
   Appelle `search_catalog_categorias`, trie en TypeScript via `Intl.Collator(locale)`, place
   toujours la catégorie « sans tag » en dernier. Servie avec deux usages : l'index (`porCategoria`
   élevé, ex. 6) et la résolution d'une page de catégorie (`porCategoria: 1`, juste pour savoir si
   elle existe). `buscarTipo` n'a pas changé.
7. **Deux choix produit pris SANS confirmation explicite de Jérôme**, à revalider (le journal et le
   backlog le disent explicitement tous les deux) :
   - L'image et le texte éditorial d'une catégorie (`catalog_tags.description`/`image_path`, saisis
     via l'écran admin de la Tranche 3, §10quater) **ne s'affichent plus nulle part sur l'index** —
     seulement le nom. Confirmé par lecture du code : ni `IndiceCategoriasConOfertas.tsx` ni
     `SeccionOfertas.tsx` ne lisent `foto`/`descripcion`. Le texte reste affiché sur la page de
     catégorie (§5b) ; **l'image, elle, n'est affichée nulle part dans le code actuel**, ni sur
     l'index ni sur la page de catégorie — un vrai trou fonctionnel, pas seulement une simplification
     de l'index, à signaler si la spec ou l'écran admin de la Tranche 3 laisse croire le contraire.
   - `POR_CATEGORIA = 6` est une valeur choisie sans qu'aucune ait été donnée par Jérôme dans la
     demande d'origine.
8. **Renommage cosmétique** : segment de route `[tag]` → `[categoria]` sur les cinq types
   (`resolverCategoria`/`metadataCategoria` généralisés dans `ListadoTipo.tsx`, qui étaient câblés en
   dur sur `"activity"`). Le paramètre de critère `?tag=` (recherche libre, distinct du segment) n'est
   **pas** renommé — pas de `?categoria=` dans le code.
9. **`SLUG_SIN_TAG = "otras"`** (`lib/catalog/buscar.ts`) généralise le slug réservé aux 5 types ;
   servie par la même route `[categoria]` que n'importe quelle autre catégorie.

**Fichiers touchés** (chemins confirmés par le code et/ou le commit `8d4849eb`) —
**créés** : `IndiceCategoriasConOfertas.tsx`, les 4 routes `{alojamientos,transportes,camps,eventos}/[categoria]/page.tsx`, `establishment_tag_assignments` (table), `EstablishmentTagsBlock.tsx` (admin, copie de `ProductTagsBlock.tsx`), `search_catalog_categorias.test.sql` (14 assertions pgTAP), migrations `20260914100000`/`20260914110000`/`20260914120000` —
**supprimés** : `IndiceCategorias.tsx`, `TarjetaCategoria.tsx` (+ test + story), `search_catalog_tags.test.sql` —
**modifiés** : `SeccionOfertas.tsx` (+2 tests), `ListadoTipo.tsx` (`resolverCategoria`/`metadataCategoria` généralisés), les 5 `{type}/page.tsx` (mince wrapper vers `IndiceCategoriasConOfertas`), `lib/catalog/{buscar,tipos}.ts`, `search_catalog.test.sql` (+5 assertions), `e2e/categorias.spec.ts` (réécrit), `e2e/listados.spec.ts` —
**doc, non faite à l'époque** : `docs/dette-technique.md` (note de péremption posée le jour même),
`docs/backlog.md` (les 2 choix non validés) — **cette spec elle-même, corrigée seulement le
2026-09-21/22**.

**Ce que ce lot n'a pas touché** : `ListadoInfinito`, le pont `/api/catalogo/listado`, `buscarTipo`,
le fil d'Ariane, le JSON-LD `BreadcrumbList`, les invariants et règles SEO du §8 — tout ce qui régit
la page de catégorie individuelle (§5b, §5d) reste exact.

## 11. Annexe — traçabilité

| Sujet | Sources |
|---|---|
| Index de catégories, listings, « seuls les tags avec offre » | `docs/01-cahier-des-charges-client.md` §2a |
| Critères dans l'URL, conservation d'un écran à l'autre | cahier §2a (2026-09-07), spec 28 §0 |
| Routes, coquilles, `lib/catalog/`, contrat de `listarTagsConOferta` | `docs/specs/27-architecture-vitrine-et-routage.md` §0 |
| `TarjetaOferta`, `Criterios`, plafond de section, pont d'API | `docs/specs/28-vitrine-accueil-et-resultats.md` §0, §10ter |
| `useTransition`, région `role="status"`, `error.tsx` de zone | spec 28 §10quater |
| `?tag=` inconnu : mesure, cause et correctif prescrit | spec 28 §10quinquies |
| `catalog_tags`, `product_tag_assignments`, calibrage RLS | `supabase/migrations/20260815210000_catalog_tags.sql` |
| `search_catalog` : prédicats, regroupement, `security invoker` | `supabase/migrations/20260907200000_search_catalog.sql` |
| Écran admin des étiquettes | `apps/admin/app/admin/tags/`, spec 08 §5, spec 10 §5.4 |
| Pipeline image, bucket, Route Handler d'upload | `apps/admin/lib/media/catalogImage.ts`, `app/api/upload/[entity]/route.ts`, spec 04 |
| Sitemap, hreflang, canonical, JSON-LD | `apps/web/app/sitemap.ts`, `.claude/rules/seo.md`, spec 26 |
| Carte, lien étiré, grille, conventions de composants | `components/atoms/Card.tsx`, `components/organisms/SeccionOfertas.tsx`, `components/README.md` |
| Chantier « catégories partout » qui remplace §0/§5/§6d/§7 (2026-09-14) | §10quinquies, `docs/journal/2026-09.md` (« suite 3 »), commit `8d4849eb`, migrations `20260914{100000,110000,120000}` |

## 12. Documents liés

`docs/01-cahier-des-charges-client.md` (§2a, §2b) · specs `04`, `08`, `10`, `26`, `27`, `28` ·
`apps/web/components/README.md` · `.claude/rules/{apps,seo,ui,tests,supabase}.md`.

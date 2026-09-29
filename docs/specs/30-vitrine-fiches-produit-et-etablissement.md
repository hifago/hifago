---
id: specs-vitrine-fiches-produit-et-etablissement
titre: "Vitrine : les fiches produit et établissement"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: implemente
maj: 2026-09-08
resume: >
  Les deux derniers écrans hérités de la vitrine, et les plus gros. Sort d'abord la logique métier
  des trois formulaires de réservation vers lib/reservas/ (lot B3, différé depuis la spec 27),
  puis réécrit la fiche produit et la fiche établissement sur le socle : PageShell, fil d'Ariane
  visible, carrousel, cartes de chambres en grille. Débranche la fiche vitrine du type evento,
  publie un contact d'établissement, et fait passer les exemptions de check-data-layer.sh de
  quatre à deux.
mots_cles: [fiche produit, fiche établissement, lib/reservas, lot B3, external_booking_url, contact, fil d'Ariane, carrousel, apps/web]
repond_a:
  - "Que montrent /es/productos/[slug] et /es/establecimientos/[slug] ?"
  - "Où vit la logique métier des trois formulaires de réservation ?"
  - "Comment une offre non réservable en ligne se distingue-t-elle des autres ?"
---

# Vitrine : les fiches produit et établissement

> **Cible stack** : hifago. **Troisième et dernier écran** du chantier front hérité, après la
> spec 28 (l'accueil) et la spec 29 (les listings et l'index de catégories). S'appuie sur la
> spec 27 (routes, coquilles, `lib/catalog/`, le lot B3 qu'elle a différé jusqu'ici) et sur les
> specs 28 et 29 (le type `TarjetaOferta`, les critères d'URL, `Migas`, `PhotoStrip`).
>
> **Décisions prises en entretien avec Jérôme le 2026-09-08**, en dix arbitrages listés au §3,
> chacun avec la raison qui l'a emporté. Trois d'entre eux ont été posés **après** une
> reconnaissance de sept lecteurs qui a corrigé la question elle-même : deux des trois « décisions
> de modèle » annoncées comme ouvertes étaient déjà tranchées ailleurs, et la troisième visait la
> mauvaise colonne. Le détail de ces corrections est au §1.
>
> **✅ Validée par Jérôme le 2026-09-08**, en bloc, après lecture des huit points que la rédaction
> avait tranchés seule (§10 « Ce que la rédaction a décidé »). Le `statut: implemente` du frontmatter
> décrit l'état d'**implémentation** (livrée le 2026-09-08, cf. ci-dessous), pas l'état de validation :
> celle-ci vit dans la table ci-dessous, section par section (convention posée par la spec 27).
>
> **✅ Implémentée le 2026-09-08** — ses quatre tranches. Ce que le code a corrigé du texte est en
> §10bis (Tranche 1), §10ter (Tranche 2), §10quater (Tranche 3) et §10quinquies (Tranche 4).

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
| 7 | Contrat — `lib/reservas/`, `lib/catalog/`, composants | ✅ validé 2026-09-08 |
| 8 | Règles et invariants | ✅ validé 2026-09-08 |
| 9 | Cas limites | ✅ validé 2026-09-08 |
| 10 | Décisions tranchées / points ouverts | ✅ validé 2026-09-08 |
| 10bis | **Ce que la Tranche 1 a corrigé** | ✅ implémentée 2026-09-08 |
| 10ter | **La Tranche 2 telle qu'elle a été construite** | ✅ implémentée 2026-09-08 |
| 10quater | **La Tranche 3 : la fiche produit** | ✅ implémentée 2026-09-08 |
| 10quinquies | **La Tranche 4 : la fiche établissement** | ✅ implémentée 2026-09-08 |
| 11 | Annexe — traçabilité | ✅ validé 2026-09-08 |
| 12 | Documents liés | ✅ validé 2026-09-08 |

---

## 0. Contrat compact (pour coder — lire seul, sans le reste)

### Carte des routes

Aucune route nouvelle. Les deux routes existent et répondent ; ce lot les **réécrit**.

| URL | Fichier | Contenu |
|---|---|---|
| `/[locale]/productos/[slug]` | `(vitrine)/productos/[slug]/page.tsx` | la fiche d'une offre — activité, camp, evento, transport, **ou une chambre** |
| `/[locale]/establecimientos/[slug]` | `(vitrine)/establecimientos/[slug]/page.tsx` | la fiche d'un lieu, ses chambres et ses autres produits |

Zone vitrine, **indexables**, rendu **dynamique** (aucune des deux ne déclare `revalidate`,
`dynamic` ni `generateStaticParams` — mesuré, et ce lot ne change pas ce point).

⚠️ **Une chambre garde son URL `/productos/[slug]`** même si on n'y arrive que par l'établissement :
c'est ce qui la rend partageable et indexable (cahier §2b.4, décidé le 2026-09-07).

### Paramètres d'URL

**Aucun.** Les critères de recherche ne vivent pas sur une fiche — c'est ce qui rend les fiches
cacheables (spec 27 §3). Un paramètre inconnu est ignoré, jamais une erreur, et le canonical
n'en porte aucun.

### Arbre des pages

```
(vitrine)/layout.tsx              SiteHeader · SiteFooter        (spec 27 — ne pose PAS <main>)
│
├─ productos/[slug]/page.tsx                   Server Component
│  ├─ getProductoPorSlug(slug, { locale })     LA seule lecture   ← NOUVEAU, lib/catalog/
│  ├─ generateMetadata + JsonLd Product|Event + JsonLd BreadcrumbList
│  └─ PageShell variant="large"                pose l'unique <main>
│     ├─ Migas                    Inicio / Alojamientos / Casa Kayam / Cabaña
│     ├─ FichaProducto            "use client" — l'aiguilleur (ex-ProductDetailView)
│     │  ├─ PhotoStrip            carrousel des photos du produit
│     │  ├─ <h1> VISIBLE          Title as="h1" — le nom résolu
│     │  ├─ <p> description
│     │  ├─ Price | price_label   le prix, ou son libellé libre
│     │  ├─ ligne de faits        lodgingKind · capacity · unitCount   (hébergement seul)
│     │  ├─ occurrenceLabel       quand l'offre est un evento — INDÉPENDANT du mode
│     │  └─ le bloc de réservation, selon `modoReserva` :
│     │     ├─ "vitrina"  → BotonContacto        external_booking_url
│     │     ├─ "lodging"  → LodgingReservationForm
│     │     ├─ "slot"     → SlotReservationForm
│     │     └─ "date"     → ReservationForm
│     └─ BloqueEstablecimiento    carrousel · nom (lien) · description · adresse
│
└─ establecimientos/[slug]/page.tsx            Server Component
   ├─ getEstablecimientoPorSlug(slug, { locale })   LA seule lecture  ← NOUVEAU, lib/catalog/
   ├─ generateMetadata + JsonLd LodgingBusiness|LocalBusiness + JsonLd BreadcrumbList
   └─ PageShell variant="large"
      ├─ Migas                    Inicio / Alojamientos / Casa Kayam
      ├─ FichaEstablecimiento     "use client" (le carrousel l'impose)
      │  ├─ PhotoStrip            carrousel des photos de l'établissement
      │  ├─ <h1> VISIBLE          Title as="h1" — le nom résolu
      │  ├─ <p> description
      │  ├─ adresse + horaires    check_in_time / check_out_time DE L'ÉTABLISSEMENT
      │  └─ BotonContacto         contact_phone → wa.me   (si renseigné)
      ├─ <h2> + grille            ses chambres — TarjetaOferta variante "grilla"
      └─ <h2> + grille            ses autres produits — même variante
```

### Données

```ts
// NOUVEAU — lib/catalog/tipos.ts
type FichaProducto = {
  id: string;
  slug: string;
  tipo: TipoOferta;
  nombre: string;                  // déjà résolu dans la locale
  descripcion: string | null;      // déjà résolue
  fotos: FotoTarjeta[];            // URLs publiques déjà résolues
  precio: PrecioTarjeta;           // le type de la spec 28, inchangé
  modoReserva: "vitrina" | "lodging" | "slot" | "date";
  urlExterna: string | null;       // external_booking_url — non nul ⟺ modoReserva === "vitrina"
  ocurrencia: DatosOcurrencia | null;   // evento seulement — INDÉPENDANT de modoReserva
  alojamiento: DatosAlojamiento | null; // lodgingKind, capacity, unitCount, priceTiers, maxQty, isPmsBacked
  disponibilidad: FilaDisponibilidad[];
  tarifas: FilaTarifa[];
  franjas: FilaFranja[];
  establecimiento: ResumenEstablecimiento | null;  // id, slug, nombre, descripcion, direccion, fotos
  localesNativas: string[];        // pour noindex/canonical — cf. spec 29 §10ter
};

// NOUVEAU — lib/catalog/tipos.ts
type FichaEstablecimiento = {
  id: string;
  slug: string;
  nombre: string;
  descripcion: string | null;
  direccion: string | null;
  lat: number | null;
  lon: number | null;
  horaEntrada: string | null;      // establishments.check_in_time — LUI SEUL fait foi (§3.4)
  horaSalida: string | null;
  modo: "rooms" | "whole_house" | null;
  contacto: string | null;         // contact_phone en E.164, déjà normalisé
  fotos: FotoTarjeta[];
  alojamientos: TarjetaOferta[];   // le type de la spec 28, tel quel
  otrosProductos: TarjetaOferta[];
  localesNativas: string[];
};

// MODIFIÉ — lib/catalog/tipos.ts : TarjetaOferta gagne un champ
type TarjetaOferta = {
  /* … champs existants inchangés … */
  nAlojamientos: number | null;    // NOUVEAU — non nul UNIQUEMENT sur une carte groupée (≥ 2)
};
```

Une seule lecture par page :

| Page | Appel |
|---|---|
| `/productos/[slug]` | `getProductoPorSlug(slug, { locale })` → `FichaProducto \| null` |
| `/establecimientos/[slug]` | `getEstablecimientoPorSlug(slug, { locale })` → `FichaEstablecimiento \| null` |

⚠️ **« Une seule lecture » veut dire un seul appel depuis la page, pas une seule requête SQL.**
La couche garde le regroupement en `Promise.all` déjà en place et son unique attente séquentielle
(les créneaux dépendent du comptage des règles de créneau) : ce lot déplace les requêtes, il ne
promet pas de les réduire. Le contrôle CI ne mesure d'ailleurs que l'**endroit** d'où part la
requête, jamais leur nombre — le dire évite de croire que le vert prouve autre chose.

### Modèle de données (delta)

| Objet | État | Détail |
|---|---|---|
| contrainte `products_price_cop_required_unless_evento` | **à remplacer** | devient `…_unless_vitrine` : `check (type = 'evento' or external_booking_url is not null or price_cop is not null)`. **Strictement plus permissive** — aucune ligne existante ne peut la violer |
| `establishments.contact_phone text` | **à créer** | nullable, E.164 (`check (contact_phone ~ '^\+[1-9][0-9]{7,14}$')`), + **`grant select (contact_phone)`** |
| fonction `search_catalog(…)` | **à republier** | `drop` + `create` + **regrant** : le `returns` gagne `n_alojamientos bigint`. Le corps le calcule déjà |
| `product_media` / `establishment_media` | **seed à créer** | `scripts/seed-media.mjs`, sur le modèle de `seed_auth_users.mjs` |
| `Carousel` de `packages/ui` | **à étendre** | prop `labels?` optionnelle, défauts espagnols actuels — additif, aucun appelant ne change |

Aucune table créée, aucune écriture capacitaire, **aucune RPC `security definer` nouvelle** :
rien ici ne relève de la frontière RPC-only. `establishments` reste en RLS directe.

⚠️ **`establishments` n'a AUCUN grant `SELECT` au niveau table pour `anon`** — dix-huit grants
**colonne par colonne** (mesuré). Une colonne ajoutée n'est donc **pas** lisible : sans
`grant select (contact_phone) on public.establishments to anon, authenticated`, la vitrine
répond « permission denied for column ». C'est le piège §11.1, et il ne se voit ni au typecheck
ni au lint.

⚠️ **Le `drop` de `search_catalog` ne fera PAS échouer la migration s'il casse
`search_catalog_tags`** : les dépendances de fonction à fonction ne vivent pas dans `pg_depend`
(le corps PL/pgSQL est du texte opaque). Vérifié : `search_catalog_tags` **nomme** ses colonnes
(`sc.id`, `sc.es_establecimiento`), donc une colonne de plus au `returns` ne la casse pas — mais
le seul filet reste son test pgTAP. Le faire tourner après la migration n'est pas optionnel.

### Invariants

1. Aucun `page.tsx` n'appelle Supabase et n'importe rien de `@hifago/ui` (specs 27 §0, 28 §0).
   **Ce lot retire les deux fiches de la liste d'exemptions de `check-data-layer.sh`** — elle
   passe de quatre entrées à deux.
2. Un seul `<main>`, posé par `PageShell` ; un seul `<h1>`, **visible**. ⚠️ Aucune des deux fiches
   n'a de `<h1>` aujourd'hui (`Card.Title` de HeroUI rend un `<h3>`) : c'est un défaut à corriger,
   pas un choix à préserver.
3. **`external_booking_url is not null` ⟺ `modoReserva === "vitrina"`**, quel que soit le type.
   Jamais `sellable = false` (cahier §2e).
4. **`occurrenceLabel` est indépendant de `modoReserva`** : la date d'un evento est une propriété
   du type, pas du mode de réservation. Les confondre est le défaut que ce lot corrige.
5. `establishments.check_in_time`/`check_out_time` **font seuls foi**. `products.check_in_time`
   n'est lu par aucune page publique (§3.4).
6. Le fil d'Ariane **visible** et le JSON-LD `BreadcrumbList` portent **exactement les mêmes
   entrées, dans le même ordre**, construits depuis la même valeur (règle SEO 6).
7. Toute image passe par l'atome `Image` ou par `PhotoStrip` — jamais `next/image` en direct.
8. Aucun composant ne duplique `PhotoStrip` : `ProductPhotos.tsx` disparaît (§10.3).
9. Tout lien interne passe par le `Link` de `@/i18n/navigation`.
10. Aucune couleur en dur, aucune largeur en dur, rien de masqué selon la largeur.
11. **Aucun test existant n'est modifié pendant la Tranche 1.** Les 32 tests DOM des formulaires
    restent verts sans être touchés : c'est cela seul qui prouve que l'extraction n'a rien changé.

### Cas limites

| Situation | Traitement |
|---|---|
| Slug inconnu | **404** (`notFound()`), déjà le cas |
| Produit `sellable = false` | **404** — la RLS le rend invisible à `anon`, donc `maybeSingle()` rend `null` |
| Établissement `status <> 'active'` | **404** |
| Produit sans photo | l'aplat gris de l'atome `Image`, au bon ratio — jamais un trou ni une hauteur nulle |
| Établissement sans photo propre | l'aplat gris. **Pas de repli sur les photos de ses chambres** (§10.6) |
| Produit sans établissement | le bloc établissement n'est pas rendu ; le fil d'Ariane n'a pas son niveau intermédiaire |
| Produit sans description | pas de `<p>` — jamais un paragraphe vide |
| Offre en vitrine (`external_booking_url`) | le bloc de réservation est remplacé par le bouton de contact, sans bandeau ni texte explicatif (cahier §2e) |
| Evento **sans** `external_booking_url` | son occurrence s'affiche, et **aucun bloc de réservation** — comportement actuel préservé, et nommé comme cul-de-sac au §10.5 |
| Vitrine **sans** `price_cop` | `price_label` s'affiche ; si les deux manquent, **aucun prix** — jamais « 0 COP » |
| Établissement sans `contact_phone` | le bouton de contact n'est pas rendu. Rien ne le remplace |
| Établissement sans chambre | la section chambres n'est pas rendue ; celle des autres produits l'est |
| Établissement sans aucun produit | **inatteignable** : `establishments_select_public` exige au moins un produit `sellable` (mesuré). L'état vide reste écrit, il ne peut pas être exercé |
| Locale sans contenu natif | `noindex, follow` + canonical vers la langue source (déjà en place, vérifié en réel) |
| `check_in_time` renseigné sur le produit mais pas l'établissement | **rien n'est affiché** — l'établissement fait seul foi (§3.4) |

### Fichiers touchés

**Créés** — `apps/web/lib/reservas/{calendario,cantidad,disponibilidad,pms}.ts` (+ tests) · `apps/web/lib/catalog/{producto,establecimiento}.ts` (+ tests) ·
`apps/web/app/[locale]/(vitrine)/productos/[slug]/FichaProducto.tsx` ·
`apps/web/app/[locale]/(vitrine)/productos/[slug]/BotonContacto.tsx` ·
`apps/web/app/[locale]/(vitrine)/establecimientos/[slug]/FichaEstablecimiento.tsx`
(chacun + test + story) · `apps/web/messages/{es,en}/FichaPage.json` ·
`apps/web/e2e/fichas.spec.ts` · `scripts/seed-media.mjs` + ses images ·
`supabase/migrations/<ts>_products_vitrine_sin_precio.sql` ·
`supabase/migrations/<ts>_establishments_contacto_publico.sql` ·
`supabase/migrations/<ts>_search_catalog_n_alojamientos.sql` ·
`supabase/tests/database/establishments_contacto.test.sql`.

**Déplacés** — `apps/web/lib/products/reservationRange.ts` (+ son test) →
`apps/web/lib/reservas/`.

**Modifiés** — les deux `page.tsx` de fiche · `ProductDetailView.tsx` → `FichaProducto.tsx` ·
`EstablishmentDetailView.tsx` → `FichaEstablecimiento.tsx` · les trois formulaires de réservation
(délestés, pas réécrits) · `lib/catalog/{tipos,buscar}.ts` · `lib/seo/jsonld/establishment.ts`
(le commentaire faux, §1) · `packages/ui/src/components/carousel.tsx` (prop `labels`) ·
`components/molecules/TarjetaOferta.tsx` (le décompte) · `scripts/check-data-layer.sh`
(deux exemptions retirées) · `supabase/seed.sql` (les champs vides) ·
`packages/supabase/src/database.types.ts` (régénéré).

**Supprimés** — `apps/web/app/[locale]/(vitrine)/productos/[slug]/ProductPhotos.tsx`
(remplacé par `PhotoStrip`, §10.3).

---

## 1. Contexte et problème

Quatre faits, tous **mesurés** le 2026-09-08, pas supposés — et trois d'entre eux ont corrigé la
question qu'on croyait poser.

**1. Les deux fiches sont les seules pages restées hors du socle.** `PageShell` a été créé le
2026-09-01 en relevant le gabarit copié dans huit pages, et son en-tête **nomme précisément ces
deux fichiers** comme les deux dérives (`gap-4` au lieu de `gap-6`). Une semaine plus tard, elles
portent toujours leur `<main>` écrit à la main en `p-8` — soit 64 px de marge horizontale sur un
téléphone de 390 px, un sixième de la largeur. Elles n'utilisent ni `Migas`, ni `BackLink`, ni
l'atome `Image` : `EstablishmentDetailView.tsx:3` importe encore `next/image` directement, et
l'en-tête de l'atome `Image` cite **ce fichier précis** comme le bug qu'il existe pour empêcher
(un `fill` sans `sizes`, donc l'image la plus grande servie à un téléphone). Le défaut est nommé,
daté, et toujours en place.

**2. Aucune des deux fiches n'a de `<h1>`.** `Card.Title` de HeroUI rend un `<h3>` ; la hiérarchie
mesurée en réel est `h3 → h2 → h3`. L'invariant 9 de la spec 27 (« un `<h1>` par page ») est violé
sur les deux pages depuis le début, et rien ne le vérifie.

**3. Elles déclarent aux moteurs un fil d'Ariane qu'aucun visiteur ne voit.** Le JSON-LD
`BreadcrumbList` est posé sur les deux depuis un lot antérieur, avec **deux entrées** (Inicio → la
fiche). Le composant visible, `Migas`, existe depuis le 2026-09-08 — mais il n'est appelé que par
`ListadoTipo.tsx` et `actividades/page.tsx`, **jamais par une fiche**, c'est-à-dire précisément là
où un fil d'Ariane a le plus de valeur. C'est une violation de la règle SEO 6 (un JSON-LD décrit
exactement ce que la page montre), portée au backlog et refermée ici.

**4. Elles sont deux des quatre exemptions nommées de `scripts/check-data-layer.sh`**, dont
l'en-tête dit ce qu'il faut en faire : *« Cette liste est de la DETTE VISIBLE, pas une permission
[…] Elle doit RÉTRÉCIR à chaque lot, et le jour où elle est vide, ce bloc disparaît. »* Elle a
déjà perdu un membre (l'accueil). Ce lot lui en retire deux : `getProductoPorSlug` et
`getEstablecimientoPorSlug`, annoncées par la spec 27 §0 et jamais écrites, sont les deux seules
exemptions dont la dette est purement « la requête est au mauvais endroit ». Les deux autres
(`(cuenta)/reservas`, `(tunnel)/pago`) sont hors vitrine — **la liste tombe à deux sans que ce lot
touche au tunnel ni au compte.**

### Ce que la reconnaissance a corrigé avant la première question

Sept lecteurs, en parallèle, avant tout arbitrage. Trois de leurs trouvailles ont changé les
questions elles-mêmes — et deux d'entre elles ont **retiré** du travail.

- **« La fiche vitrine n'a aucun support en base » était faux.** Le cahier §2e tranche le sujet
  depuis le 2026-09-07 : `sellable = true` + `external_booking_url` (migration `20260814190000`),
  « ce n'est **jamais** `sellable = false` », « ce n'est pas réservé aux eventos ». Le front lit
  déjà la colonne — mais **uniquement dans la branche `evento`**. Il ne manquait pas un modèle,
  il manquait un débranchement. La seule vraie question ouverte était la contrainte de prix, et
  le cahier la nommait déjà comme à soumettre à Jérôme.
- **`partners.phone` était le mauvais candidat, et c'était mesurable.** 0 ligne remplie sur 36 ;
  `partner_accounts.phone`, 1 sur 41. La migration `20260819100000` dit pourquoi : `partners` est
  *l'organisation*, le partenaire saisit son téléphone ailleurs. Publier `partners.phone` aurait
  produit un bouton de contact **vide sur toutes les fiches** — un lot livré, mesuré vert, et sans
  effet. Le cahier §2f gardait d'ailleurs trois issues ouvertes, pas une décision acquise.
- **La citation qui justifiait un arbitrage n'était pas là où on la citait.** « Casa Kayam ·
  6 alojamientos » est attribué au « cahier §2b.4 » par la spec 28 §10bis **et** par le backlog ;
  `grep` ne trouve même pas le mot « alojamientos » dans le cahier. La citation existe, mais dans
  `docs/journal/2026-08.md:6488`, et elle décrit un comportement **livré** : « une carte, qui mène
  à sa page et annonce son décompte ». Ce n'était donc pas une addition à débattre — c'était une
  régression à réparer.

### Et une erreur de sécurité, à corriger en passant

`apps/web/lib/seo/jsonld/establishment.ts:31-33` affirme que les colonnes de `partners` « ne sont
pas accordées au rôle `anon` ». **C'est faux** : `anon` a bien le `GRANT SELECT` sur `phone`,
`email`, `legal_name` et `identification_number`. Ce qui protège réellement, c'est l'absence de
policy RLS publique. La conclusion du commentaire (pas de `telephone` dans le JSON-LD) est bonne ;
sa raison est fausse — et quelqu'un qui s'appuierait dessus pour « juste ouvrir la RLS »
exposerait les 36 téléphones partenaires d'un coup. Le commentaire est réécrit dans ce lot.

## 2. Portée et tranches

### Dans le périmètre

- Le **lot B3** : extraire la logique métier des trois formulaires de réservation vers
  `lib/reservas/`, avec ses tests — différé depuis la spec 27 précisément jusqu'ici.
- La **réécriture des deux fiches** sur le socle : `PageShell`, `Migas`, `PhotoStrip`, l'atome
  `Image`, `Title as="h1"`.
- Le **débranchement de la fiche vitrine** du type `evento`, et la contrainte de prix qui va avec.
- Le **contact public d'un établissement** : la colonne, son grant, son bouton.
- Le **décompte de couchages** sur une carte groupée (`n_alojamientos`).
- Un **seed d'images**, sans lequel aucune fiche ne se juge.
- Les **libellés du carrousel** traduits.
- **Deux exemptions retirées** de `check-data-layer.sh`.

### Tranches

| # | Contenu | Ce qu'elle ferme |
|---|---|---|
| **1** | **Lot B3** — `lib/reservas/`, les huit duplications, aucune vue touchée | la dette de la spec 27 §0 ; les trois formulaires deviennent réécrivables |
| **2** | Le SQL et le seed — trois migrations, `seed-media.mjs`, le seed enrichi | l'écran devient jugeable ; la contrainte et le contact existent |
| **3** | La **fiche produit** — réécrite, `getProductoPorSlug`, la vitrine débranchée | une exemption CI ; le fil d'Ariane visible ; le `<h1>` |
| **4** | La **fiche établissement** — réécrite, `getEstablecimientoPorSlug`, les chambres en grille avec leur prix, le contact | la seconde exemption CI ; le dernier écran hérité de la vitrine |

**L'ordre n'est pas négociable sur deux points.** La Tranche 1 précède tout : réécrire une vue
avant d'en avoir sorti la logique, c'est reperdre les six correctifs de fuseau du 2026-08-28/29 en
les recopiant à la main. Et la Tranche 2 précède les Tranches 3-4 : les fiches consomment les
colonnes qu'elle crée.

### Hors périmètre, et pourquoi

- **Réduire le nombre de requêtes.** Ce lot déplace des lectures, il ne les optimise pas. Le
  contrôle CI ne mesure que leur emplacement ; promettre autre chose serait promettre ce que rien
  ne vérifie.
- **Le `drop column` de `products.check_in_time`.** La règle est tranchée ici (§3.4), le nettoyage
  non : la colonne traverse six fichiers d'`apps/admin` **et** le payload JSONB des propositions
  socio avec ses trois chemins de modération. Une spec vitrine ne réécrit pas le socio.
- **La colonne dénormalisée de prix minimum** du cahier §2b.4 : elle n'est plus nécessaire —
  `search_catalog` rend déjà `precio_desde` par un `min()` à la volée (§10.7).
- **Le point ouvert de la spec 28 §10bis sur `Card layout="row"`** : ce lot rend ses grilles en
  variante `grilla`, donc il ne réveille pas le visuel de 64 px (décision de Jérôme, §3.9).
- **L'image orpheline dans le bucket** quand on remplace une photo : dette de tout le module
  images depuis la spec 04, à traiter globalement ou pas du tout.
- **Le carrousel `variant="hero"`**, écrit et jamais rendu : `PhotoStrip` monte `gallery`, et ce
  lot n'invente pas un usage pour une variante que personne n'a vue.

## 3. Décisions retenues (entretien du 2026-09-08)

Dix arbitrages, dans l'ordre où ils ont été posés. Chacun porte la raison qui l'a emporté, parce
que c'est elle qui permettra de rouvrir la décision plus tard sans la redécouvrir.

1. **Une offre en vitrine peut se passer de prix chiffré.** La contrainte
   `products_price_cop_required_unless_evento` devient `…_unless_vitrine` :
   `check (type = 'evento' or external_booking_url is not null or price_cop is not null)`.
   *Raison* : une offre dont le prix se négocie — un transport privé, une location longue — ne
   peut pas inventer un chiffre, et `price_label` existe précisément pour ça (cahier §2e). La
   contrainte nouvelle est **strictement plus permissive** : aucune ligne existante ne peut la
   violer, donc la migration ne peut pas échouer sur les données. *Écarté* : garder l'ancienne —
   elle aurait bloqué la mise en vitrine de tout ce qui n'est pas un evento, c'est-à-dire
   exactement ce que le cahier §2e demande de rendre possible.
2. **Le contact d'un établissement est une colonne sur `establishments`**, remplie par le
   partenaire depuis l'écran admin de son établissement. *Raison* : le contact décrit **le lieu**,
   pas la personne — c'est ce que la fiche affiche, et `establishments` a déjà sa lecture publique.
   *Écarté* : `partners.phone` (0/36 rempli — un bouton vide partout) ; `partner_accounts.phone`
   (1/41, et il faudrait une policy publique sur une table d'identité qui porte aussi des
   référents particuliers et leurs numéros d'identification) ; le canal Hifago seul (retire au
   partenaire le contact direct que le cahier §2e lui promet).
3. **Une seule colonne, `contact_phone`, pas d'email.** *Raison* : le cahier veut un **bouton de
   contact**, pas une fiche de contact. Le canal tranché du projet est WhatsApp (360dialog,
   CLAUDE.md §9), et une colonne d'email sans consommateur écrit serait une dette de plus.
   *(Tranché par la rédaction, §10.1.)*
4. **`establishments.check_in_time` fait seul foi.** `products.check_in_time` n'est plus lu par
   aucune page publique — il l'est déjà de fait. *Raison* : les deux migrations qui ont créé la
   situation le disent déjà — « les horaires sont une propriété du **LIEU**, les répéter chambre
   par chambre était déjà une duplication » (`20260827200000`), et « les fusionner est une
   décision de modèle, pas un nettoyage » (`20260827220000`). Zéro ligne renseignée des deux
   côtés aujourd'hui : le coût de trancher est **nul maintenant**, et il ne le restera pas.
   *Écarté* : le produit fait foi avec repli sur l'établissement — renverse ce que disent les deux
   migrations et l'admin, pour un besoin que rien n'atteste (aucun établissement n'a de chambres
   aux horaires différents).
5. **Le seed gagne des images, par un script Node.** *Raison* : une fiche **est** un carrousel
   avant tout ; sans photo, l'écran ne se juge ni en développement ni en e2e, et le chemin nominal
   n'est jamais exercé. `storage.objects` ne se remplit pas depuis un fichier SQL — mais
   `seed_auth_users.mjs` a déjà posé le précédent d'un seed en Node. **Un produit reste
   délibérément sans photo** pour que le cas de l'aplat gris garde sa couverture.
6. **Le décompte de couchages est restauré sur la carte groupée.** *Raison* : ce n'est pas une
   addition au cahier, c'est une **fonctionnalité perdue en route** — le front d'août l'affichait
   (journal du 2026-08-15). Sans lui, une carte unique qui représente six chambres ne dit pas
   qu'elle en représente six. Le coût est faible : `search_catalog` **calcule déjà**
   `n_alojamientos`, il ne manque qu'une colonne à son `returns`.
7. **Le lot B3 absorbe `lib/products/reservationRange.ts`.** `lib/reservas/` devient le domaine
   unique de la réservation côté vitrine ; `formatOccurrenceLabel.ts` reste dans `lib/products/`
   (c'est de l'affichage d'evento, pas de la réservation). *Raison* : la spec 27 §2 se contredit —
   elle annonce l'extraction vers `lib/reservas/` **et** classe `lib/products/*` « explicitement
   non touché », alors que la moitié du domaine y vit déjà. Deux répertoires porteraient la même
   règle et divergeraient un jour. *Écarté* : descendre dans `packages/domain` — CLAUDE.md §2.1
   exige la preuve par grep qu'`apps/admin` les consomme, et elle n'existe pas.
8. **Aucun test existant n'est modifié pendant l'extraction.** Les 32 tests DOM des formulaires
   restent verts **sans être touchés**, et les tests purs des fonctions extraites s'ajoutent.
   *Raison* : c'est la règle qui a fonctionné sur la Tranche 1a de la spec 29 (16 assertions
   pgTAP intactes) — si un test rougit, c'est qu'un comportement a bougé, et on le sait
   immédiatement. La redondance est assumée : elle **est** le filet. *Écarté* : réécrire les tests
   en tests purs dans le même lot — on perdrait le filet au moment exact où il sert.
9. **Les chambres et les produits d'un établissement s'affichent en grille**, comme partout
   ailleurs sur le site. *Raison* : pour une chambre, c'est la photo qui décide, et la variante
   `lista` la réduit à 64 px. Conséquence voulue : le point ouvert de la spec 28 §10bis sur
   `Card layout="row"` **reste dormant** — ce lot ne le réveille pas.
10. **Le fil d'Ariane suit le parcours réel, et le JSON-LD dit exactement la même chose.**
    Une chambre : `Inicio › Alojamientos › Casa Kayam › Cabaña`. Une activité :
    `Inicio › Actividades › Kayak`. Un établissement : `Inicio › Alojamientos › Casa Kayam`.
    *Raison* : le visiteur venu de Google remonte exactement où il serait passé — et pour une
    chambre, le niveau qui compte est l'établissement, l'écran qui montre les autres chambres du
    même lieu. *Écarté* : sauter l'établissement (le lien manquant serait celui vers l'écran d'où
    tout le parcours alojamiento passe) ; sauter le listing de type (le visiteur arrivé par Google
    n'aurait aucun lien vers les autres hébergements du site).

## 4. Parcours cible

**Une activité, un camp, un evento, un transport.** Le visiteur arrive de l'accueil, d'un listing,
d'une page de catégorie ou de Google. Il voit, dans cet ordre : le carrousel, le nom, la
description, le prix, puis **soit** le calendrier de sélection de date, **soit** le bouton de
contact — jamais les deux, jamais un bandeau qui explique la différence. Dessous, le bloc de
l'établissement, qui mène à sa fiche.

**Une chambre.** Le visiteur n'arrive pas sur une chambre par une liste : il arrive sur
l'**établissement**, qui montre ses couchages en cartes (photo · nom · capacité · prix, jamais de
disponibilité — l'afficher obligerait à interroger LobbyPMS pour rendre une simple liste). Il
ouvre une chambre, et voit sa fiche et son calendrier. La fiche de chambre garde son URL
`/es/productos/[slug]` : partageable, indexable, et atteignable par un lien profond — mais ce
n'est pas le chemin qu'on lui fait prendre.

**Un lieu.** La fiche d'établissement montre le carrousel, le nom, la description, l'adresse et
les horaires, son bouton de contact quand il en a un, puis ses chambres en grille et ses autres
produits en grille.

**Dans les trois cas**, le fil d'Ariane est visible en tête et permet de remonter : au listing de
type, à l'établissement, à l'accueil.

## 5. Les écrans, bloc par bloc

### 5a. La fiche produit — `/es/productos/[slug]`

| Bloc | Contenu | Conditions |
|---|---|---|
| `Migas` | `Inicio › <type> › [<établissement> ›] <nom>` | l'établissement n'apparaît que pour une **chambre** (§10.4) |
| `PhotoStrip` | les photos du produit, `loading="priority"` sur la première | aplat gris si aucune |
| `<h1>` | le nom résolu | **toujours visible** — `Title as="h1"` |
| `<p>` | la description résolue | absent si `null` |
| prix | `Price` si `precio.tipo === "monto"`, le libellé si `"texto"` | **rien** si `null` |
| faits couchage | `lodgingKind · capacity · unitCount` | hébergement seulement |
| occurrence | la date ou la récurrence | **evento seulement, quel que soit le mode** |
| bloc réservation | selon `modoReserva` (§5b) | exactement un des quatre |
| politique d'annulation | inchangée | toujours |
| `BloqueEstablecimiento` | carrousel · nom (lien vers sa fiche) · description · adresse | absent si le produit n'a pas d'établissement |

### 5b. Les quatre modes de réservation, et ce qui les décide

```
modoReserva =
  external_booking_url != null  ou  type === 'evento'   → "vitrina"
  type === 'lodging'                                    → "lodging"
  au moins une règle de créneau                         → "slot"
  sinon                                                 → "date"
```

⚠️ **`type === 'evento'` reste dans la première branche, délibérément.** Le retirer rendrait tout
evento sans URL réservable en ligne — un changement de comportement produit que personne n'a
demandé. Ce que ce lot corrige, c'est l'inverse : que la vitrine ne soit **plus réservée** aux
eventos. Le cas « evento sans URL » reste un cul-de-sac, et il est désormais **nommé** (§10.5).

⚠️ **`occurrenceLabel` sort de la branche.** Aujourd'hui il n'est rendu que dans le bloc `evento`,
comme si la date d'un événement dépendait de la façon dont on le réserve. C'est le défaut que ce
lot corrige : l'occurrence est une propriété du **type**, elle s'affiche pour tout evento.

### 5c. Le bouton de contact — `BotonContacto`

Un seul composant, deux usages, deux sources :

| Écran | Source | Cible |
|---|---|---|
| fiche produit en vitrine | `products.external_booking_url` | l'URL telle quelle, `target="_blank" rel="noopener noreferrer"` |
| fiche établissement | `establishments.contact_phone` | `https://wa.me/<E164 sans le +>`, construit par la couche |

Il occupe **la place exacte** du calendrier — c'est la forme arrêtée par le cahier §2e : « la
différence se voit à l'endroit exact où le client la cherche, sans bandeau ni texte explicatif ».
Il n'est jamais rendu sans sa source.

### 5d. La fiche établissement — `/es/establecimientos/[slug]`

| Bloc | Contenu | Conditions |
|---|---|---|
| `Migas` | `Inicio › Alojamientos › <nom>` | toujours |
| `PhotoStrip` | les photos de l'établissement | aplat gris si aucune — **jamais** celles de ses chambres (§10.6) |
| `<h1>` | le nom résolu | toujours |
| `<p>` | la description résolue | absent si `null` |
| adresse + horaires | `direccion`, puis `horaEntrada` / `horaSalida` **de l'établissement** | chaque ligne absente si sa valeur l'est |
| `BotonContacto` | `contact_phone` → `wa.me` | absent si la colonne est vide |
| `<h2>` + grille | ses chambres — `TarjetaOferta` variante `grilla` | section absente s'il n'en a aucune |
| `<h2>` + grille | ses autres produits — même variante | section absente s'il n'en a aucun |

Le libellé du premier `<h2>` dépend de `establishments.mode` (`rooms` / `whole_house` / neutre) —
comportement existant, conservé.

⚠️ **Une carte de chambre porte son prix.** C'est ce que l'entretien du 2026-09-07 a décidé
(« photo · nom · capacité · prix ») et ce que l'écran actuel ne fait pas : il **lit déjà**
`price_cop` et ne l'affiche nulle part. Ce n'est pas un arbitrage, c'est un écart au décidé.

---

## 6. Modèle de données (delta)

**Rien ici ne relève de la frontière RPC-only** (CLAUDE.md §3.1) : aucune table portant un
compteur de capacité n'est touchée, aucune écriture n'est ajoutée, aucune lecture n'expose les
données d'une autre identité. `establishments` reste en **RLS directe**, calibrage inchangé
depuis sa migration du 2026-08-15. Aucune fonction `security definer` n'est créée.

### 6a. La contrainte de prix — `<ts>_products_vitrine_sin_precio.sql`

```sql
alter table public.products
  drop constraint products_price_cop_required_unless_evento;

alter table public.products
  add constraint products_price_cop_required_unless_vitrine
  check (type = 'evento' or external_booking_url is not null or price_cop is not null);
```

⚠️ **La contrainte nouvelle est strictement plus permissive que l'ancienne** — elle ajoute un
`or`. Aucune ligne existante ne peut donc la violer, et la migration ne peut pas échouer sur les
données. C'est ce qui la rend sûre, et c'est la raison de ne pas la valider `not valid`.

⚠️ Le champ `external_booking_url` est aujourd'hui **verrouillé sur `isEvento` côté admin**
(`product-type-fields.tsx:505`). La migration seule ne suffit donc pas : sans déverrouiller le
champ, aucun admin ne peut créer la vitrine que la contrainte autorise désormais. C'est un geste
de la **Tranche 2**, pas un oubli à découvrir en Tranche 3.

### 6b. Le contact d'établissement — `<ts>_establishments_contacto_publico.sql`

```sql
alter table public.establishments
  add column contact_phone text
  check (contact_phone ~ '^\+[1-9][0-9]{7,14}$');

-- ⚠️ SANS CETTE LIGNE, LA COLONNE EST INVISIBLE À LA VITRINE.
-- `establishments` n'a AUCUN grant SELECT au niveau table pour anon : dix-huit grants
-- colonne par colonne, posés un par un depuis 20260827200000. Une colonne ajoutée n'hérite
-- de rien — `permission denied for column` tombe AVANT la RLS (piège §11.1).
grant select (contact_phone) on public.establishments to anon, authenticated;
```

**Ce que la colonne est, et ce qu'elle n'est pas.** C'est le contact **du lieu**, public,
volontairement séparé de l'identité du partenaire : `partners.phone` et `partner_accounts.phone`
restent protégés par l'absence de policy publique, et ce lot n'y touche pas. Une seule colonne,
pas d'email (§10.1).

**Le format est contraint, pas normalisé à l'écriture.** `^\+[1-9][0-9]{7,14}$` est E.164 : le
`+`, un indicatif, 8 à 15 chiffres. *Raison* : la cible est `https://wa.me/<numéro sans le +>`, et
un numéro saisi en « 300 123 45 67 » produirait un lien mort **sans qu'aucun test ne rougisse** —
le lien existerait, il ne mènerait nulle part. Une contrainte est le seul endroit où cette règle
ne peut pas être contournée.

**Test pgTAP** — `supabase/tests/database/establishments_contacto.test.sql`, quatre assertions :
la colonne existe et est nullable · un numéro E.164 valide s'insère · un numéro mal formé est
refusé (`throws_ok`, **en tant que `postgres`** — en `anon`, une policy refuserait l'écriture
avant que la contrainte n'ait son mot à dire, et le test prouverait la policy, pas la
contrainte : c'est la leçon du slug réservé de la spec 29 §10ter) · `anon` peut lire la colonne
(l'assertion qui attrape un `grant` oublié).

### 6c. Le décompte de couchages — `<ts>_search_catalog_n_alojamientos.sql`

`search_catalog` est republiée : son `returns` gagne `n_alojamientos bigint`. **Le corps le
calcule déjà** (`coalesce(ca.n, 0) as n_alojamientos`, et le seuil `>= 2` qui décide du
regroupement) — il ne fait que le jeter.

Trois précautions, toutes trois apprises en Tranche 1a de la spec 29 :

1. **`drop function` explicite, puis `create`, puis `regrant`.** `create or replace` ne suffit
   pas quand le `returns` change, et le `drop` **emporte les grants** : sans le regrant, la
   vitrine entière devient muette pour `anon`.
2. **La définition vivante en base est comparée au fichier de migration avant réécriture** (règle
   7 de `.claude/rules/supabase.md`) — jamais retaper 300 lignes à la main.
3. ⚠️ **`search_catalog_tags` appelle `search_catalog`, et le `drop` ne le signalera pas.** Les
   dépendances de fonction à fonction ne vivent pas dans `pg_depend` : le corps PL/pgSQL est du
   texte opaque, donc `drop function search_catalog(...)` **réussit** même s'il casse son
   appelante. Vérifié : `search_catalog_tags` **nomme** ses colonnes (`sc.id`,
   `sc.es_establecimiento`), donc une colonne de plus ne la casse pas — mais c'est une propriété
   qu'il faut **vérifier**, pas espérer. Son test pgTAP passé après la migration est le seul
   filet, et il n'est pas optionnel. Ne jamais utiliser `drop … cascade` ici : il supprimerait
   `search_catalog_tags` en silence.

**Assertions pgTAP nouvelles** : `n_alojamientos` vaut le nombre de couchages sur une carte
groupée · il vaut `null` (ou 0) sur une offre non groupée · les assertions existantes restent
vertes **sans être modifiées** — si l'une devait bouger, c'est qu'un prédicat aurait changé.

### 6d. Le seed d'images — `scripts/seed-media.mjs`

`storage.objects` ne se remplit pas depuis un fichier SQL : c'est écrit dans `seed.sql` lui-même,
et ce n'est pas un oubli. Le script suit donc le précédent de `seed_auth_users.mjs` — Node, l'API
Storage, puis les `insert` dans `product_media` / `establishment_media`.

- **3 à 5 photos libres de droits**, versionnées dans le dépôt (~100 Ko chacune, WebP).
- **Idempotent** : relancé, il ne duplique rien (il purge ses propres objets avant d'écrire).
- **Un produit reste délibérément sans photo**, et c'est écrit dans le script : c'est lui qui
  garde exerçable le cas de l'aplat gris, en développement comme en e2e.
- Branché sur `npm run db:setup`, jamais sur `supabase db reset` seul.

⚠️ **Constat à traiter au passage** : le bucket `catalog-media` contient déjà **37 objets `.webp`
orphelins**, laissés par les e2e admin — `cleanup.ts` supprime les lignes SQL par CASCADE, jamais
les binaires. Le bucket grossit à chaque exécution, sans garde-fou. Ce lot ne le corrige pas
(c'est la dette « image orpheline » du module images), mais il **l'inscrit au backlog** : jusqu'ici
il n'y figurait pas.

### 6e. Le seed enrichi — `supabase/seed.sql`

Aucun produit du seed n'exerce ce que les fiches vont afficher : `check_in_time`, `check_out_time`,
`external_booking_url`, `address`, `lat`, `lon`, `price_label`, `duration_minutes`, `start_time`
sont **`null` sur les sept lignes**, et les deux établissements n'ont ni description, ni horaires,
ni `mode`. Le seed gagne donc :

- des **horaires et une description** sur les deux établissements, et un `mode` sur celui qui
  vend des chambres ;
- un **`contact_phone`** sur un établissement, et **pas** sur l'autre — c'est le second qui garde
  exerçable l'absence de bouton ;
- **une offre en vitrine** : `external_booking_url` renseigné, `price_cop` à `null`,
  `price_label` renseigné — l'unique ligne qui prouve que la contrainte nouvelle sert à quelque
  chose, et le seul moyen de voir l'écran vitrine sans le fabriquer à la main ;
- l'`address`, la `lat` et la `lon` d'un établissement, pour que le JSON-LD `geo` cesse d'être une
  branche jamais prise.

⚠️ **Les e2e mutent durablement des lignes du seed** (mesuré : l'établissement `…-0004` s'appelle
en ce moment « Hostal Editado 1788906669463 »), et `cleanup.ts` ne peut rien y faire — sa
propriété de sûreté le lui interdit. **Le seed n'est donc pas l'état de la base après une suite
e2e** : seul `npm run db:setup` le rétablit. À savoir avant de conclure qu'un écran est faux.

## 7. Contrat — `lib/reservas/`, `lib/catalog/`, composants

### 7a. `lib/reservas/` — ce que la Tranche 1 en sort

`apps/web/lib/reservas/` n'existe pas. Il reçoit :

**Par déménagement** — `lib/products/reservationRange.ts` et son test (14 cas), tels quels :
`resolveTierPrice`, `nightsInRange`, `hasUnavailableNightInRange`, `estimateNightsTotal`,
`buildInCartNightsMap`, `reachableRangeWindow`. Un `git mv`, les imports mis à jour, **aucune
ligne de logique touchée**. `formatOccurrenceLabel.ts` reste dans `lib/products/`.

**Par extraction** — les huit duplications mesurées entre les trois formulaires. Chacune est
nommée ici parce qu'aucune ne se devine :

| # | Ce qui est écrit plusieurs fois | Où | Devient |
|---|---|---|---|
| 1 | le clamp de quantité, avec une **garde NaN présente dans un seul des trois** | Lodging:382 · Reservation:172 · Slot:258 | `clampCantidad(brut, max)` — la garde NaN devient la règle des trois |
| 2 | `capacity - booked - (inCart ?? 0)` | Lodging:226 · Reservation:70 **et** 80 · Slot:53 | `plazasRestantes(fila, enCarrito)` |
| 3 | le message de disponibilité (`full` / `lastSpot` / `spotsLeft`) | Reservation:156 · Slot:199 **et** 240 | `estadoDisponibilidad(restantes)` → une valeur, jamais un libellé |
| 4 | la map « déjà dans le panier », **recodée à la main deux fois** alors que `buildInCartNightsMap` existe | Reservation:57 · Slot:94 | la fonction existante, rebranchée |
| 5 | `dernierJourReservable` + son commentaire de 2 lignes | les trois | `dernierDiaReservable()` |
| 6 | `defaultMonth` et `selectedIso` | Reservation · Slot | `mesPorDefecto()` · `isoDeFecha()` |
| 7 | le prédicat `disabled` du calendrier lodging — **30 lignes en propriété JSX**, fonction de `(iso, ancre, fenêtre, fenêtres, qty)` et d'aucun état React | Lodging:489-518 | `nocheSeleccionable(...)` — la pièce la plus dense du lot |
| 8 | `plancherIso` (le plancher `lead_days`), 100 % pur | Lodging:253-259 | `plancherLeadDays(restrictions)` |

**Et le mapping d'erreur PMS**, qui vit aujourd'hui en deux morceaux — un booléen dans le corps du
composant (`canRetry`, Lodging:191) et un ternaire dans le JSX (Lodging:436-438) — devient une
**table de motifs** dans `lib/reservas/pms.ts` :

```ts
// reason → { reintentable, claveI18n }
const MOTIVOS = {
  pms_rate_limited:        { reintentable: true,  claveI18n: "pmsAvailabilityRateLimited" },
  pms_unreachable:         { reintentable: true,  claveI18n: "pmsAvailabilityError" },
  connector_inactive:      { reintentable: false, claveI18n: "pmsAvailabilityError" },
  pms_category_not_quoted: { reintentable: false, claveI18n: "pmsAvailabilityError" },
  month_out_of_range:      { reintentable: false, claveI18n: "pmsAvailabilityError" },
} as const;
```

⚠️ **Cette table referme deux dettes d'un coup, et en découvre une seconde.** Le backlog demandait
que `pms_category_not_quoted` rejoigne `connector_inactive` dans les motifs non retentables. Mais
la Route Handler émet **cinq** motifs et le formulaire n'en connaît que **deux par leur nom** : le
troisième non retentable, `month_out_of_range`, n'était réclamé nulle part — réessayer un mois
hors horizon ne réussira jamais. Une table les rend **tous** visibles, et la prochaine addition
côté Route Handler ne pourra plus atterrir en « retentable » par défaut.

**Ce que la Tranche 1 ne fait pas, et il faut le dire** : elle ne touche **aucune vue** et ne
supprime **aucun** des 9 blocs JSX dupliqués (le bloc `justAdded`, identique au caractère près
dans les trois fichiers, est du **rendu** — il partira en Tranche 3, vers un composant, jamais
vers `lib/reservas/`). Elle ne recycle non plus aucun des 32 tests existants : ils assertent tous
sur le DOM, aucun sur une valeur. Les tests purs s'**ajoutent** (§3.8).

⚠️ **Ce que la Tranche 1 ne risque pas non plus, et c'est mesuré** : aucun des trois formulaires
n'appelle `create_order` ni la moindre RPC. Leur seul appel réseau est un `GET` de disponibilité
PMS. **La barrière anti-survente est ailleurs** — `supabase.rpc("create_order")`, depuis
`CheckoutForm.tsx:188`, et ce lot n'y touche pas. Ce que ces formulaires portent est un **guidage
d'affichage à échec fermé** (« ne propose pas ce que Lobby refusera ») : le risque de la Tranche 1
n'est pas de créer une survente, c'est d'**affaiblir le guidage** — une nuit absente de la map
doit rester non réservable. C'est ce que les 32 tests DOM intacts vérifient.

### 7b. `lib/catalog/` — les deux fonctions annoncées par la spec 27

```ts
getProductoPorSlug(slug: string, opts: { locale: string }): Promise<FichaProducto | null>
getEstablecimientoPorSlug(slug: string, opts: { locale: string }): Promise<FichaEstablecimiento | null>
```

Elles suivent les règles déjà posées par la couche :

- `import "server-only"` en tête, client anonyme sans cookies (`publicClient`) ;
- elles **résolvent** le JSONB dans la locale et rendent `localesNativas` — comme
  `CategoriaConOferta` le fait depuis la spec 29, et pour la même raison : la couche seule tient
  le JSONB brut, et `noindex`/canonical en dépendent ;
- elles **ne traduisent rien** : ni le `alt` des photos, ni le libellé du bouton de contact, ni le
  `<h2>` des chambres. Ces libellés viennent de la page (frontière posée à la spec 28 §0) ;
- elles **résolvent les URL publiques** du Storage : un composant ne parle jamais à Storage ;
- elles rendent `null` sur slug inconnu — la page appelle `notFound()`.

### 7c. Les composants

| Composant | Rôle | Note |
|---|---|---|
| `FichaProducto` | `"use client"` — l'aiguilleur des quatre modes | ex-`ProductDetailView`, délesté par la Tranche 1 |
| `FichaEstablecimiento` | `"use client"` — le carrousel l'impose | ex-`EstablishmentDetailView` |
| `BotonContacto` | le bouton, deux sources (§5c) | neuf, + test + story |
| `PhotoStrip` | **réutilisé tel quel** | `sizes` adapté à une fiche, jamais `64px` |
| `Migas` | **réutilisé tel quel** | premier usage sur une fiche |
| `TarjetaOferta` | **réutilisé**, variante `grilla` | gagne `nAlojamientos` |
| `PageShell` | `variant="large"` sur les deux fiches | §10.2 |
| `Title as="h1"` | le titre visible | corrige l'absence de `<h1>` |

⚠️ **`ProductPhotos.tsx` est supprimé.** Il emballe le même `Carousel` que `PhotoStrip`, avec le
même `variant="gallery"` — mais code son conteneur et son `next/image` à la main, là où
`PhotoStrip` passe par l'atome `Image` et gère le cas zéro photo. Le README l'interdit
explicitement (« un composant qui duplique quelque chose de `packages/ui` est une rupture ») et
cite même ce cas : « `PhotoStrip` a failli être réécrit exactement de cette façon ». La
duplication est déjà là, en production ; ce lot la retire.

### 7d. Le carrousel traduit — `packages/ui`

`Carousel` gagne une prop **optionnelle** :

```ts
labels?: { anterior: string; siguiente: string; irA: (n: number) => string };
```

avec pour défauts les trois chaînes espagnoles actuelles. **Aucun appelant existant ne change** —
`apps/admin`, non localisé, garde son comportement au caractère près. `PhotoStrip` les reçoit de
la vitrine via next-intl.

*Pourquoi ici et pas dans un lot à part* : la fiche est l'écran où le carrousel cesse d'être une
vignette pour devenir l'élément principal. Trois chaînes, une prop additive, un défaut inchangé —
le coût est plus faible que celui d'un lot séparé, et un visiteur anglophone au lecteur d'écran
n'entend plus « Foto siguiente » sur l'écran central du site.

### 7e. Les messages

`messages/{es,en}/FichaPage.json` — un fichier par namespace, parité es/en vérifiée par le
contrôle existant. Clés nouvelles : le libellé du bouton de contact (les deux variantes), les
`<h2>` des deux sections de la fiche établissement, les libellés d'horaires, les libellés du
carrousel, et les entrées de fil d'Ariane qui ne viennent pas de la base.

---

## 8. Règles et invariants

1. **Aucun `page.tsx` n'appelle Supabase.** Les deux exemptions correspondantes sont **retirées**
   de `scripts/check-data-layer.sh` dans le même commit que la fonction qui les rend inutiles —
   jamais après, sinon la liste ne rétrécit jamais.
2. **Un `<h1>` visible par page**, hiérarchie sans saut. C'est un défaut existant à corriger, pas
   un choix à préserver (§1.2).
3. **Le fil d'Ariane visible et son JSON-LD sont construits depuis la même valeur.** Pas deux
   listes qui se ressemblent : une liste, deux rendus. C'est la seule forme qui ne peut pas
   diverger, et la règle SEO 6 l'exige.
4. **`external_booking_url` décide de la vitrine, jamais `sellable`.** `sellable = false` rend le
   produit invisible — et pire, il **retire son établissement du public** :
   `establishments_select_public` exige au moins un produit `sellable` rattaché (mesuré). La règle
   du cahier §2e n'est donc pas une préférence de style, c'est une condition de visibilité du
   parent.
5. **`establishments.check_in_time` fait seul foi** (§3.4).
6. **Aucun test existant n'est modifié en Tranche 1** (§3.8).
7. **Toute image passe par l'atome `Image` ou `PhotoStrip`** — jamais `next/image` en direct,
   jamais un `fill` sans `sizes`.
8. **Le canonical d'une fiche ignore tous les paramètres d'URL** — mécanisme existant, inchangé.
9. **Une fiche servie en repli JSONB reste `noindex` + canonical vers la langue source** (règle
   SEO 3) — mécanisme existant, vérifié en réel, inchangé.
10. Tout lien interne passe par le `Link` de `@/i18n/navigation` ; aucune couleur ni largeur en
    dur ; rien de masqué selon la largeur (responsive obligatoire, CLAUDE.md §2.6).

### Ce qui sera vérifié mécaniquement, et ce qui ne le sera pas

Le projet tient qu'« une règle documentée que rien ne vérifie n'est pas une règle : c'est un
souhait » (CLAUDE.md §11.20). Donc, honnêtement :

| Règle | Vérifiée par |
|---|---|
| aucune requête dans un `page.tsx` | `check-data-layer.sh`, **bloquant** dès que l'exemption tombe |
| un `<h1>` visible | test de composant sur chaque fiche |
| fil visible ⟺ JSON-LD | test de composant : **la même valeur** alimente les deux, donc l'assertion porte sur la source |
| `anon` lit `contact_phone` | assertion pgTAP (§6b) — c'est elle qui attrape un `grant` oublié |
| le format E.164 | contrainte `check` + `throws_ok` pgTAP |
| `n_alojamientos` | assertions pgTAP + e2e sur la carte groupée |
| les 32 tests intacts | `git status` sur les fichiers de test après la Tranche 1 |
| **que le `<h2>` des chambres utilise la bonne clé i18n** | **rien** — relecture |
| **que le fil nomme l'établissement et non son slug** | **rien** — relecture |
| **que `products.check_in_time` ne soit jamais relu** | **rien** tant que la colonne existe — relecture |

## 9. Cas limites

Repris du §0 et complétés — ce tableau fait foi.

| Situation | Traitement | Exercé par |
|---|---|---|
| slug inconnu (les deux fiches) | 404 | e2e |
| produit `sellable = false` | 404 (RLS) | e2e, seed |
| établissement `status <> 'active'` | 404 | e2e |
| produit sans photo | aplat gris au bon ratio | seed (le produit laissé sans photo) |
| établissement sans photo | aplat gris, **jamais** les photos de ses chambres | test de composant |
| produit sans établissement | pas de bloc établissement, fil d'Ariane sans niveau intermédiaire | test de composant |
| produit sans description | pas de `<p>` | test de composant |
| offre en vitrine | bouton de contact **à la place** du calendrier | seed (l'offre vitrine), e2e |
| evento sans `external_booking_url` | occurrence affichée, **aucun** bloc de réservation | test de composant (§10.5) |
| vitrine sans `price_cop` **et** sans `price_label` | **aucun prix** — jamais « 0 COP » | test de composant |
| établissement sans `contact_phone` | pas de bouton, rien à la place | seed (le second établissement) |
| établissement sans chambre | section absente | test de composant |
| établissement sans aucun produit | **inatteignable** (la RLS l'exige) — l'état vide reste écrit, jamais exercé | — |
| `check_in_time` sur le produit seulement | rien n'est affiché | relecture (§8) |
| locale sans contenu natif | `noindex, follow` + canonical vers la source | existant, vérifié en réel |
| `contact_phone` mal formé | refusé à l'écriture | `throws_ok` pgTAP |
| une seule photo | ni flèches ni points (comportement `Carousel` existant) | test `PhotoStrip` existant |

## 10. Décisions tranchées / points ouverts

**Tranché le 2026-09-08** — les dix décisions du §3.

**Ce que la rédaction a décidé** — ce ne sont pas des arbitrages produit, mais ils engagent le
code :

1. **Une seule colonne de contact, `contact_phone`, pas d'email.** Le cahier veut un bouton, pas
   une fiche de contact ; le canal du projet est WhatsApp (CLAUDE.md §9) ; une colonne d'email
   sans consommateur écrit serait une dette. Elle s'ajoutera le jour où un écran la demande.
2. **`PageShell variant="large"` sur les deux fiches.** La fiche produit passe de `max-w-2xl` à
   `max-w-3xl`. *Raison* : rien dans le code ne dit que le `2xl` actuel était une décision — il
   vient du même copier-coller que le `gap-4` que `PageShell` qualifie de « dérive, pas une
   décision ». Et la fiche produit porte désormais un carrousel, un calendrier et un bloc
   établissement : c'est la page la plus dense du site.
3. **`ProductPhotos.tsx` est supprimé au profit de `PhotoStrip`** (§7c). Le README l'exige et cite
   ce cas précis.
4. **Le fil d'Ariane d'une activité ne porte pas sa catégorie.** `Inicio › Actividades › Kayak`,
   jamais `Inicio › Actividades › Náutica › Kayak`. *Raison* : un produit peut porter **plusieurs**
   tags ; en choisir un arbitrairement rendrait le fil non déterministe et mentirait sur le
   chemin — et le JSON-LD déclarerait un chemin qui n'existe pas. Le niveau établissement, lui,
   est **unique**, donc il peut y figurer.
5. **Un evento sans `external_booking_url` reste un cul-de-sac**, et c'est désormais écrit. Le
   comportement est inchangé (il l'était déjà, en silence) : le débranchement de ce lot rend la
   vitrine possible pour tous les types, il ne rend pas les eventos réservables en ligne — ce
   serait un changement de comportement produit que personne n'a demandé. **Porté au backlog** :
   l'admin devrait empêcher de publier un evento sans URL, et rien ne le fait.
6. **La fiche établissement ne se replie pas sur les photos de ses chambres.** *Raison* : la photo
   d'une chambre montre une chambre, pas le lieu — l'afficher comme photo d'établissement
   promettrait autre chose que ce qu'on montre. L'aplat gris dit la vérité ; une photo empruntée
   ment. (La spec 28 applique le repli aux **cartes**, où le contexte est différent : la carte
   groupée représente explicitement ses couchages.)
7. **La colonne dénormalisée de prix minimum du cahier §2b.4 n'est plus nécessaire.** Le cahier
   exigeait une colonne « recalculée dans la même transaction, sinon elle dérive en silence » ;
   `search_catalog` rend déjà `precio_desde` par un `min()` **à la volée**. L'écart au cahier
   simplifie : pas de dénormalisation, donc pas de dérive possible. À corriger dans le cahier.
8. **La table de motifs PMS remplace le booléen `canRetry`** (§7a), ce qui referme
   `pms_category_not_quoted` **et** `month_out_of_range` — le second n'était réclamé nulle part.

**Point ouvert — le bucket grossit sans garde-fou.** 37 objets `.webp` orphelins y sont déjà, et
`cleanup.ts` ne purge que les lignes SQL. Ce lot ne le corrige pas (c'est la dette « image
orpheline » de tout le module images, à traiter globalement ou pas du tout) mais il l'inscrit :
jusqu'ici, l'accumulation dans le **bucket** ne figurait nulle part.

**Point ouvert — `products.check_in_time` reste éditable.** La règle est tranchée (§3.4), le
nettoyage non : six fichiers d'`apps/admin` et le payload des propositions socio. Un admin peut
donc saisir un horaire qu'aucune page publique n'affichera jamais. Porté au backlog comme lot
admin.

**Ce que rien ne vérifie mécaniquement**, et qui tient donc à la relecture : les trois lignes du
tableau du §8.

**Hérités, non rouverts** : les six points du cahier §2f · l'algorithme de mise en avant dans une
section · le point ouvert de la spec 28 §10bis sur `Card layout="row"` — ⚠️ ce lot rend ses
grilles en variante `grilla`, donc **il ne le réveille pas** (§3.9), et la variante `lista` reste
en production sur l'accueil, où elle a été mesurée.

## 10bis. Ce que la Tranche 1 a corrigé (2026-09-08, lot B3)

`lib/reservas/` existe, les trois formulaires en sont délestés, **aucune vue n'a été touchée**.
Huit écarts avec le texte ci-dessus, tous constatés en codant — et le premier invalide une des huit
duplications que le §7a annonçait.

1. ⚠️ **La duplication n°4 n'existait pas.** Le §7a affirmait que `buildInCartNightsMap` « existe
   et n'est utilisée que par un des trois formulaires », les deux autres la recodant à la main.
   Faux : la fonction fait `if (!includeLine(line) || !line.endDate) continue` — elle **ignore les
   lignes sans `endDate`**, or les lignes d'activité et de créneau n'en ont jamais. Les deux
   boucles manuelles n'étaient pas « la fonction recodée » : elles agrègent des lignes à DATE
   UNIQUE, la fonction agrège des lignes à PLAGE. Les fusionner aurait fait compter une nuit
   d'hébergement comme une place d'activité, silencieusement. D'où `agregarEnCarrito`, fonction
   **distincte**, avec un test qui énonce précisément cette différence.
2. ⚠️ **Les 14 tests de `reservationRange.ts` ne couvrent QU'UNE de ses six fonctions**
   (`reachableRangeWindow`). `buildInCartNightsMap`, `resolveTierPrice`, `nightsInRange`,
   `hasUnavailableNightInRange` et `estimateNightsTotal` n'ont **aucun test**. C'est ce qui a
   décidé du geste précédent : généraliser une fonction non testée dont dépend le calendrier
   d'hébergement aurait été le geste le plus risqué du lot.
3. **La Route Handler émet DIX motifs, pas cinq.** Le §7a en listait cinq ; deux sont *calculés*
   avant la réponse (`pms_rejected`, `pms_unparseable`) et trois autres n'avaient pas été vus
   (`invalid_params`, `product_not_found`, `not_pms_backed`). La table les porte tous, chacun
   classé retentable ou non.
4. **Un test relit la Route Handler** pour que la table ne périme pas en silence — une table de
   motifs écrite à la main est exactement le défaut qu'on vient de corriger, sous une autre forme.
   ⚠️ Il a trouvé un faux positif à sa première exécution (`"rejected"` et `"unparseable"`, en
   position de COMPARAISON dans un ternaire, pris pour des motifs) : les littéraux de comparaison
   sont retirés avant extraction. Ce faux positif est aussi la démonstration que le test regarde
   vraiment la source.
5. ⚠️ **`check-timezone.sh` filtrait les commentaires avec un `sed 's://.*::'` naïf**, qui ne
   retire pas les blocs `/* … */` — alors que `scripts/lib/sans-commentaires.pl` existe pour ça et
   que les **quatre autres** contrôles l'utilisent. `lib/reservas/calendario.ts` est le premier
   fichier du dépôt à citer `new Date()` dans un bloc JSDoc, et le contrôle a crié à tort. Corrigé
   pour utiliser le filtre commun, puis **vérifié par mutation** : un vrai `new Date()` injecté est
   toujours attrapé, à la bonne ligne, et le fichier a été restauré (`git diff` vide).
6. **Le lint a refusé `useMemo(ultimoDiaReservable, [])`** — « Expected the first argument to be an
   inline function expression » : le compilateur React ne sait pas analyser une référence. La forme
   inline n'est donc pas un choix de style, et c'est écrit dans la doc de la fonction.
7. **`pms.test.ts` tourne en environnement `node`**, pas jsdom : il lit deux fichiers du dépôt, et
   sous jsdom `import.meta.url` n'est pas une URL `file:` — `fileURLToPath` refuse. Mesuré.
8. **Un changement de comportement, minuscule et assumé** : `limitarCantidad` fait retomber
   `Infinity` sur 1, là où l'ancien code le plafonnait au maximum. Inatteignable par un
   `<input type="number">`, mais un nombre non fini vient toujours d'une saisie cassée : repartir
   de 1 est le seul comportement qui ne prétend rien. Testé, documenté.

**Ce que la Tranche 1 n'a PAS fait, comme annoncé** : aucune vue touchée, aucun des 9 blocs JSX
dupliqués supprimé (le bloc `justAdded` est du rendu — il partira en Tranche 3), aucun test
existant modifié.

**Vérifié** : typecheck 0 · lint 0 · **1015 tests Vitest** (964 + 51) · les six contrôles verts ·
`next build` vert · **e2e vitrine 37/38**. ⚠️ L'unique échec, `reserve-lodging-pms-availability`,
a été **mesuré antérieur** : les changements ont été remisés (`git stash -u`) et le test échoue à
la même ligne 66, de la même façon, sur `HEAD` seul. Pas déduit du backlog — reproduit.

**La règle §3.8 est tenue, et vérifiée mécaniquement** : `git status` ne montre aucun fichier de
test en `M`, et le test déménagé affiche `0 insertion, 0 suppression` (un rename pur détecté par
`git mv`).


## 10ter. La Tranche 2 telle qu'elle a été construite (2026-09-08)

Les trois migrations sont appliquées, le seed porte enfin des photos, et l'admin sait créer une
vitrine. Dix écarts avec le texte ci-dessus — dont deux qui ont changé le lot, et deux erreurs de
méthode que je signale plutôt que de taire.

### Ce que le SQL a demandé de plus que prévu

1. **Le contact a eu besoin d'une RPC, pas seulement d'une colonne** (§6b n'annonçait que « la
   colonne + son grant »). `update_establishment` REMPLACE tous les champs et tourne dans les trois
   chemins de modération de propositions : le contact y serait écrasé à chaque approbation, sans
   erreur et sans trace. C'est mot pour mot la raison pour laquelle les horaires ont déjà leur
   propre RPC. D'où `update_establishment_contact`, calquée sur `update_establishment_stay_details`.
2. ⚠️ **`anon` a le grant `UPDATE` sur `contact_phone`, et je ne le lui ai pas donné.** Une colonne
   AJOUTÉE hérite des grants au niveau TABLE, et `establishments` en porte pour `anon`
   (INSERT/UPDATE/REFERENCES) — seul `SELECT` manquait, d'où le grant explicite. Conséquence : le
   seul rempart en écriture est la policy `establishments_write_admin`, et rien d'autre. Une
   assertion pgTAP le prouve désormais, au lieu de l'espérer (CLAUDE.md §3.5).
3. **Mon `grant update (contact_phone) to authenticated` était redondant** — hérité lui aussi. Il
   reste : explicite vaut mieux qu'hérité, et il documente l'intention.

### Une assertion qui passait pour la mauvaise raison

⚠️ **La plus utile des trouvailles du lot.** L'assertion « le couchage NON vendable ne compte pas
dans `n_alojamientos` » a été vérifiée par mutation : remplacer le décompte par un compte BRUT
(sans aucun filtre `sellable`) **ne la fait PAS rougir**. Raison : `search_catalog.test.sql` tourne
en `anon`, et la policy `products_select_public` écarte déjà le non-vendable avant que le décompte
ne compte quoi que ce soit. En `postgres`, la même mutation rend bien 3 au lieu de 2.

L'assertion vérifie donc la propriété qui compte pour l'écran — « le visiteur lit le nombre de
couchages qu'il peut réserver » — et cette propriété est tenue DEUX fois, par le prédicat et par la
RLS. Elle ne verrouille pas le prédicat à elle seule. Le libellé a été réécrit pour dire ce qu'il
prouve : prétendre le contraire ferait croire à un filet qui n'existe pas.

### Ce que ma propre migration a cassé, et qu'il a fallu réparer tout de suite

⚠️ **La contrainte du §6a rend ATTEIGNABLE un état que le front ne savait pas rendre.** Mesuré en
réel sur le seed, une heure après l'avoir appliquée : la fiche d'une offre en vitrine affichait
**« 0 COP »** et un bouton **« ajouter au panier »**. Le code n'avait jamais eu à traiter
`price_cop = null` hors evento — la contrainte l'interdisait jusque-là.

Corrigé **en avance sur la Tranche 3**, minimalement : le prix retombe sur `price_label` puis sur
rien (jamais « 0 COP », qui prétendrait la gratuité), et `reservationMode` gagne `"vitrina"` pour
tout non-evento porteur d'une URL. La réécriture complète de l'écran reste la Tranche 3 ; ceci
refuse seulement de livrer un écran qui ment entre deux tranches. Les 12 tests de
`ProductDetailView` sont restés verts sans être modifiés.

### Le seed, et un contrôle qui ne contrôlait rien

4. **`scripts/seed-media.mjs`** pose 6 lignes média depuis 5 visuels **synthétiques** (générés, pas
   téléchargés : CLAUDE.md §7.3, et aucune question de licence à arbitrer). Il est idempotent —
   vérifié par trois exécutions successives — et il exerce **quatre** cas d'un coup : 3 photos
   (carrousel complet), 2 photos, 1 photo (ni flèches ni points), 0 photo (l'aplat gris). Le
   dernier est le plus facile à perdre en ajoutant « juste une photo partout ».
5. ⚠️ **`db-setup.sh` affichait « base locale prête » sur un seed cassé.** `psql -f` sans
   `ON_ERROR_STOP=1` continue après une instruction refusée et sort 0 — constaté en réel : une
   contrainte violée (`unit = 'per_unit'`, valeur inexistante) a laissé le script se déclarer
   vert sur une base incomplète. Corrigé.
6. **Le partage des deux établissements est dicté par une mesure** : `establishment-page.spec.ts`
   écrit les horaires de `…-0004` puis les remet à `null`. Y poser des valeurs de seed les ferait
   effacer par la première exécution e2e. Casa Kayam devient donc l'établissement riche, `…-0004`
   reste pauvre — et exerce l'absence de contact.

### L'admin, et un défaut antérieur laissé ouvert

7. **`external_booking_url` et `price_label` sortent du bloc `isEvento`** — affichage, validation
   (`needsOwnPrice` devient le miroir exact de la contrainte SQL) et payload de création. L'update
   d'édition les porte désormais aussi : sans cela, poser une URL puis la corriger était
   impossible, la valeur restant figée sans message.
8. **`EstablishmentContactBlock`** — sans lui, la colonne ne serait remplissable que par le seed, et
   un établissement créé en production naîtrait sans contact **et le resterait** (la leçon de la
   spec 29 Tranche 3).
9. ⚠️ **Non fait, et dit** : `productEditPayload.ts` — le chemin des propositions SOCIO — ne porte
   ni `external_booking_url` ni `price_label`, **y compris pour les eventos**. C'est un défaut
   ANTÉRIEUR, pas une régression : un socio ne pouvait déjà pas modifier l'URL d'un evento. Porté
   au backlog plutôt qu'élargir un lot vitrine à la chaîne socio.

### Deux erreurs de méthode, de mon fait

10. ⚠️ **J'ai conclu « c'est le carrousel » sur UNE mesure, et c'était faux.** `attribution.spec.ts`
    a échoué une fois ; retirer les photos du produit concerné l'a fait repasser, et j'en ai déduit
    la cause. Trois exécutions ultérieures **avec** les photos passent, et la suite rend 37/38 en
    `--workers=1` comme en parallèle, deux fois de suite. La vraie variable était *seul vs en
    suite* — la dette de concurrence intra-suite déjà au backlog. C'est exactement l'erreur contre
    laquelle ce dépôt met en garde depuis le matin, commise sur moi-même.
11. ⚠️ **Une fonction-sonde oubliée en base** (`search_catalog_mutant_probe`, créée pendant une
    vérification) a pollué `database.types.ts`. C'est le **diff** qui l'a montrée, pas moi —
    deuxième occurrence de ce piège dans le dépôt après `ZZrefute.test.tsx`. Supprimée, types
    régénérés.

### Et un fait d'outillage à ne pas redécouvrir

⚠️ **La suite pgTAP n'est pas fiable après une exécution e2e** — constaté DEUX fois dans la même
séance. Six fichiers comptent `audit_log` en absolu (`want: 1`, `have: 274` puis `have: 2`), et
toute exécution e2e admin y écrit. `npm run db:setup` la referme à chaque fois. Ce n'est pas une
régression : c'est la dette déjà inscrite au backlog, et elle rend tout chiffre pgTAP mesuré après
des e2e inexploitable.

**Vérifié** : typecheck 0 · lint 0 · **1015 tests Vitest** · **pgTAP 876/876** (868 + 8) · six
contrôles verts · `next build` vert sur les deux apps · e2e vitrine **37/38** (l'échec antérieur,
mesuré par remisage) · e2e admin `admin-evento-vitrine` échoue **à la ligne 22, avant tout code
touché** — vérifié sur `HEAD` seul par remisage, et déjà nommé au backlog (`#name-es`).


## 10quater. La Tranche 3 : la fiche produit (2026-09-08)

La fiche produit est réécrite sur le socle. `check-data-layer.sh` a **une exemption de moins**
(quatre → trois), et la page passe de 325 à 140 lignes.

### Ce qui est livré

- **`lib/catalog/producto.ts`** — `getProductoPorSlug`, mémoïsée par `cache` (la page et
  `generateMetadata` l'appellent toutes deux dans la même requête). Les six requêtes y sont
  déplacées **à l'identique** : même `Promise.all`, même unique attente séquentielle. ⚠️ Ce lot ne
  réduit AUCUN aller-retour, et le vert du contrôle CI ne prouve pas le contraire — il ne mesure
  que l'endroit d'où part une requête.
- **`PageShell variant="large"`**, `Migas`, et un `<h1>` VISIBLE — la page n'en avait aucun,
  `Card.Title` rendant un `<h3>`.
- **`PhotoStrip` remplace `ProductPhotos`**, supprimé : les deux emballaient le même `Carousel`.
  La molécule gère en plus le cas zéro photo.
- **Le `alt` des photos suit enfin le contrat de la spec 28** (« `<nom>, foto i de n` ») ; il
  répétait le nom du produit sur chaque image.
- **Les libellés du carrousel sont traduits** (prop `labels` optionnelle sur `packages/ui`,
  défauts espagnols inchangés — l'admin ne bouge pas d'un caractère).
- **`migasParaJsonLd`** — le fil visible et son JSON-LD viennent désormais d'UNE seule liste. Le
  mapping était déjà recopié dans `ListadoTipo` ; ce lot en aurait fait un troisième exemplaire.

**Vérifié en réel**, pas seulement en test : le fil d'une chambre porte quatre niveaux
(`Inicio › Alojamientos › Casa Kayam Guatapé › Cama en dormitorio compartido`), celui d'une
activité trois, et **le JSON-LD porte exactement les mêmes entrées dans le même ordre**.

### Trois choses trouvées en écrivant

1. ⚠️ **`data-testid` sur un composant maison passe le typecheck et ne fait RIEN.** J'ai écrit
   `<Title as="h1" data-testid="product-name">` ; l'atome attend `testId`. TypeScript accepte
   silencieusement les props hyphenées sur un composant, le rendu réel ne portait aucun testid — et
   je l'avais sous les yeux sans le voir. Ce sont **quatre e2e** qui l'ont attrapé.
2. ⚠️ **La réécriture avait perdu le suffixe d'unité** (« por persona »), parce que le type
   `FichaProducto` ne portait pas `unit`. Trouvé en adaptant les tests de la vue — c'est
   exactement ce qu'ils couvrent, et c'est la raison de les lire AVANT de réécrire.
3. **Un test comparait le prix à une chaîne inventée.** L'ancien passait `priceDisplay="$ 120.000"`
   en dur : il n'exerçait donc pas le formatage. Le montant traverse désormais l'atome `Price`,
   donc le vrai `formatCop` — et l'assertion porte maintenant sur l'ABSENCE de suffixe, jamais sur
   la chaîne exacte : `formatCop` insère une espace INSÉCABLE, invisible dans un message d'échec
   (« expected '120.000 COP' to be '120.000 COP' »).

### Un défaut du socle, révélé par un test et laissé ouvert

⚠️ **`Migas` viole l'invariant 9 de la spec 27** (« tout lien interne passe par le `Link` de
`@/i18n/navigation` ») **depuis sa création**, et personne ne l'avait relevé — c'est pourtant écrit
dans son propre commentaire : `Breadcrumbs.Item` étend le `Link` de react-aria et rend un
`<a href>` NATIF.

Conséquence invisible sur un listing, sérieuse sur une fiche : **cliquer le fil d'Ariane provoque
une navigation complète, qui vide le panier** (`CartContext` est en mémoire). Mesuré : supprimer
le lien « ← Volver al catálogo » fait échouer `cart-multi-establishment.spec.ts`, dont le
commentaire disait déjà « un `page.goto()` direct réinitialiserait le panier ».

Le lien de retour est donc **conservé**, avec la raison écrite à côté pour que personne ne le
supprime en le prenant pour un doublon du fil. Les deux corrections de fond dépassent ce lot :
brancher un `RouterProvider` react-aria (**absent de la version installée**, vérifié), ou rendre le
panier persistant — ce que le cahier §2b.6 décide depuis le 2026-09-07 et que le backlog porte
déjà. Ce lien disparaîtra avec la seconde.

### Ce que ce lot change sans le dire ailleurs

⚠️ **La fiche passe du client à session au client ANONYME** (`createPublicClient`, invariant 3 de
la spec 27). Conséquence réelle : un admin connecté ne peut plus prévisualiser une fiche non
publiée — `products_select_public` lui ouvrait la porte via `OR is_admin(…)`. C'est voulu : une
page publique montre ce que le public voit. Une prévisualisation, si elle est un jour demandée, est
un écran d'admin, pas un effet de bord d'authentification.

**Vérifié** : typecheck 0 · lint 0 · **1019 tests Vitest** (1015 + 4) · six contrôles verts, dont
`check-data-layer` vérifié PAR MUTATION (réintroduire un `.from()` dans la route le fait rougir) ·
`next build` vert · **e2e vitrine 37/38**, le seul échec étant l'antérieur connu.


## 10quinquies. La Tranche 4 : la fiche établissement (2026-09-08)

Le dernier écran hérité de la vitrine. **La liste d'exemptions de `check-data-layer.sh` est à
DEUX**, toutes deux hors vitrine (le compte client, le tunnel de paiement) : l'objectif que le §2
s'était fixé — « quatre à deux » — est atteint, et la prochaine réduction demandera d'ouvrir un
autre chantier plutôt que d'en finir un.

### Ce qui est livré

- **`lib/catalog/establecimiento.ts`** — `getEstablecimientoPorSlug`, et `urlDeContacto`, qui
  retire le `+` que `wa.me` n'accepte pas. La couche ne devine rien : un composant qui déduirait
  « c'est un numéro, donc WhatsApp » ferait de la logique métier dans du rendu.
- **Les produits en GRILLE**, par `TarjetaOferta` variante `grilla` (§3.9). L'écran d'origine avait
  sa propre `ProductRow` maison en `Card layout="row"` — donc un visuel de 64 px pour une chambre,
  dont la photo est justement ce qui décide. ⚠️ Conséquence voulue : **ce lot ne réveille pas** le
  point ouvert de la spec 28 §10bis sur cette variante.
- **`<h1>`**, `PageShell`, `Migas` — vérifié en réel : le fil visible et le JSON-LD portent les
  trois mêmes entrées.
- **Le bouton de contact**, et les horaires **du lieu**.
- **Un fichier de test, là où il n'y en avait jamais eu** : `EstablishmentDetailView` n'avait
  aucune couverture unitaire. 14 cas nouveaux — dont celui qui vérifie qu'AUCUNE ligne d'horaires
  n'apparaît quand le lieu n'en a pas, c'est-à-dire que `products.check_in_time` ne remonte plus
  nulle part (§3.4).

### Le prix, enfin affiché — et deux informations retirées

⚠️ **La carte d'une chambre porte désormais son prix**, ce que l'entretien du 2026-09-07 demandait
(« photo · nom · capacité · prix ») et que l'écran d'origine ne faisait pas : il SÉLECTIONNAIT
`price_cop` en base et ne l'affichait nulle part.

En contrepartie, deux informations disparaissent de la carte : la nature du couchage
(« Habitación privada ») et le nombre d'unités (« 3 en total »), que la `ProductRow` maison
affichait. C'est la forme décidée — quatre éléments, pas six —, et non un oubli : la nature du
couchage se lit dans le NOM de la chambre, et le parc total n'aide pas à choisir (il reste sur la
fiche). `establishment-page.spec.ts` a été adapté en conséquence, avec la raison écrite dedans.

**`TarjetaOferta` gagne `capacidad`** pour cela — `null` partout ailleurs, puisque
`search_catalog` ne la rend pas : l'accueil et les listings ne l'affichent donc jamais.

### Un état écrit et inexerçable, dit plutôt que caché

L'état « établissement sans aucun produit » est **inatteignable** :
`establishments_select_public` exige au moins un produit vendable rattaché, donc la page rend 404
avant d'y arriver. Le bloc est écrit quand même — une policy peut changer —, mais **aucun test ne
peut l'exercer**, et le prétendre serait faux.

**Vérifié** : typecheck 0 · lint 0 · **1033 tests Vitest** (1019 + 14) · **pgTAP 876/876** · six
contrôles verts, `check-data-layer` vérifié PAR MUTATION sur les deux fiches · `next build` vert
sur les deux apps · **e2e vitrine 37/38**, le seul échec étant l'antérieur connu.


## 11. Annexe — traçabilité

**Mesuré le 2026-09-08**, par une reconnaissance de sept lecteurs puis vérification directe :

| Fait | Comment |
|---|---|
| `products_price_cop_required_unless_evento` toujours en base | `pg_constraint`, `psql` |
| `external_booking_url` = 0 ligne sur 7 | `psql` |
| `partners.phone` = 0/36 · `partner_accounts.phone` = 1/41 | `psql` |
| `check_in_time` = 0 ligne des deux côtés | `psql` |
| `establishments` : 18 grants colonne, **aucun** grant table pour `anon` | `information_schema.column_privileges` |
| `product_media` / `establishment_media` = 0 ligne · bucket = 37 objets | `psql` |
| « 6 alojamientos » absent du cahier, présent au journal du 2026-08-15 | `grep` |
| les 8 duplications entre formulaires | `diff` et lecture ligne à ligne |
| `search_catalog_tags` nomme ses colonnes | lecture de `20260908150000` |
| 964 tests Vitest · typecheck 0 · lint 0 | exécution |

**Corrections apportées à des documents existants** (à faire dans le lot) :

- `docs/specs/28-vitrine-accueil-et-resultats.md` §10bis et `docs/backlog.md` : « cahier §2b.4 »
  → `docs/journal/2026-08.md` (2026-08-15) pour la citation « 6 alojamientos ».
- `docs/specs/27-architecture-vitrine-et-routage.md` §2 : `lib/products/*` cesse d'être
  « explicitement non touché » (§3.7) ; §0 : `external_booking_url` n'est plus « jamais consommé
  par le front » (il l'est, dans la seule branche `evento`).
- `docs/01-cahier-des-charges-client.md` §2b.4 : la colonne dénormalisée de prix minimum n'est
  plus nécessaire (§10.7) ; §2f : le point « source du contact d'un établissement » est **fermé**.
- `apps/web/lib/seo/jsonld/establishment.ts:31-33` : le commentaire faux sur les grants `anon`.

## 12. Documents liés

- `docs/specs/27-architecture-vitrine-et-routage.md` — les routes, les coquilles, `lib/catalog/`,
  et le lot B3 qu'elle a différé jusqu'ici.
- `docs/specs/28-vitrine-accueil-et-resultats.md` — `TarjetaOferta`, les critères, `PhotoStrip`.
- `docs/specs/29-vitrine-listings-et-index-de-categories.md` — `Migas`, `search_catalog_tags`,
  la méthode `drop` + `create` + regrant.
- `docs/01-cahier-des-charges-client.md` §2b (les deux fiches), §2e (la fiche vitrine), §2f (le
  contact).
- `docs/specs/04-gestion-images.md` — le module images : plafond de 6 photos, ordre, couverture.
- `docs/specs/26-referencement-seo-et-moteurs-ia.md` — les cinq règles SEO.
- `docs/journal/2026-09.md` — le récit de ce lot.

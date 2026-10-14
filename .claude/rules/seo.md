---
paths:
  - "**/apps/web/**"
---

# SEO de la vitrine — chargée quand on touche `apps/web`

Le principe (deux couches i18n) est dans `apps.md` ; la source détaillée est
`docs/specs/26-referencement-seo-et-moteurs-ia.md` ; `scripts/check-seo.sh` (job `lint` de la CI)
en vérifie une partie. Règle d'échappement : au-delà de 100 lignes, découper par sujet
(sitemap / robots / JSON-LD).

1. hreflang construit uniquement sur les locales d'interface routées, jamais sur la liste dynamique
   de langues de contenu. **Une seule source** : les métadonnées — `alternateLinks: false` reste
   posé dans `i18n/routing.ts` (activé, next-intl pose des hreflang dérivés de `x-forwarded-host`,
   même sur les pages `noindex`).
2. Une fiche servie en repli JSONB sous une URL routée reste `noindex` + canonical vers la langue
   source tant qu'aucune traduction réelle n'existe. Une langue de contenu sans locale routée :
   canonical vers `x-default` (l'espagnol), jamais de route publique dédiée.
3. Un seul `sitemap.xml` dynamique (`export const dynamic = "force-dynamic"`, sinon prérendu VIDE
   par le job `build` de la CI qui n'a pas de base), une entrée **par locale réellement traduite**
   avec `alternates.languages`, jamais une URL `noindex` — le même prédicat `hasNativeContent` sert
   aux deux, jamais recopié.
4. `metadataBase` obligatoire, depuis une variable d'environnement, **jamais** des en-têtes de la
   requête. Canonical auto-référent sur **toute** route routée (`?ref=<code>` fabrique sinon
   autant de variantes indexables).
5. `Disallow` empêche le crawl, `noindex` l'indexation — jamais les deux sur la même page.
   `robots.txt` interdit tout par défaut et n'ouvre que sur un déploiement de **production
   déclarée** (drapeau adossé à l'environnement de déploiement, jamais à l'URL configurée) ; il est
   prérendu au build. Un seul groupe `User-Agent: *` — un crawler nommé ignore le générique ; les
   décisions par bot se documentent en commentaire dans la source.
6. JSON-LD rendu côté **serveur** dans `page.tsx` (jamais dans un composant de présentation),
   échappé (`<` → `<`, le contenu vient de partenaires), décrivant exactement ce que la page
   affiche. Aucune propriété schema.org sans colonne réelle : jamais `aggregateRating`/`review`
   (aucune table d'avis), jamais d'adresse décomposée (seul `formattedAddress` est persisté),
   jamais de `geo` sur coordonnées nulles.
7. Sémantique = décision de composant : un seul `<h1>` par page, hiérarchie sans saut (un titre
   reçoit son niveau en prop), landmarks dans la coquille (`<main>`, `<header>`, `<footer>`,
   `<nav>`), `next/image` avec `alt` requis et `sizes` renseigné, jamais de contenu indexable masqué
   derrière une interaction — et **jamais masqué selon la largeur** (`hidden md:block` sort le
   contenu de l'index mobile) : on réorganise, on ne supprime pas.

Ce qui est normal : une fiche absente du sitemap parce qu'elle n'a de contenu natif dans aucune
locale routée (elle est `noindex` partout) ; `robots.txt` qui interdit tout tant que la production
n'est pas déclarée ; une page établissement sans nœud `geo` ; un établissement `is_place` (un lieu,
ex. le village de Guatapé) sans fiche (404), sans entrée au sitemap et sans lien vers lui.

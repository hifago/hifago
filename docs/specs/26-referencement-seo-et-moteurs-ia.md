---
id: specs-referencement-seo-et-moteurs-ia
titre: "Référencement de la vitrine : Google et moteurs de réponse IA"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: implemente
reste: >
  Vérifiée en local le 2026-09-01 (build, serveur réel, 3 e2e). Validation par un outil externe
  différée à la bascule de domaine — le SSO Vercel renvoie un 302 à tout crawler avant.
maj: 2026-09-01
resume: >
  Rend apps/web indexable par Google et citable par les moteurs de réponse IA : metadataBase,
  robots.txt fermé hors production, sitemap dynamique multilingue, hreflang à source unique et
  données structurées schema.org adossées aux seules colonnes qui existent.
mots_cles: [seo, referencement, sitemap, robots, json-ld, schema.org, hreflang, metadata, canonical, crawlers ia, geo]
repond_a:
  - "Que doit contenir robots.txt et pourquoi bloque-t-il tout hors production ?"
  - "Comment construire le sitemap multilingue sans y mettre d'URL noindex ?"
  - "Quelles propriétés schema.org a-t-on le droit d'émettre, et lesquelles sont interdites ?"
  - "Où vivent les hreflang et pourquoi une seule source ?"
---

# Référencement de la vitrine : Google et moteurs de réponse IA

> **Cible stack** : hifago (`apps/web` uniquement — `apps/admin` n'est pas indexable et ne le sera
> jamais). Pas de numéro de feature de build : ce lot ne crée aucune fonctionnalité utilisateur, il
> rend exécutables des règles déjà tranchées dans `hifago/CLAUDE.md` §5.

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 0 | **Contrat compact** (surfaces produites, invariants, cas limites — pour coder) | implémentée le 2026-09-01 |
| 1 | Contexte et problème | validé par le code (audit du 2026-09-01) |
| 2 | Portée | implémentée ; le hors-périmètre reste ouvert |
| 3 | Décisions retenues | tranchées par Jérôme le 2026-09-01 |
| 4 | Parcours cible | vérifié en local (serveur réel), non vérifié en ligne |
| 5 | Surfaces produites | implémentées |
| 6-9 | *(fusionnées dans 0 — aucune table créée, aucune RPC, aucune migration)* | — |
| 10 | Décisions tranchées / points ouverts | 8 tranchées, 4 points ouverts |
| 11 | Annexe — traçabilité code→règle | à jour |
| 12 | Documents liés | à jour |

---

## 0. Contrat compact (pour coder — lire seul, sans le reste)

### Surfaces produites

| Chemin | Fichier | Rendu | Contenu |
|---|---|---|---|
| `/robots.txt` | `apps/web/app/robots.ts` | **statique** (prérendu au build) | Hors prod : `User-Agent: * / Disallow: /`, sans `Sitemap:`. En prod : `Allow: /` + `Disallow` + `Sitemap` + `Host`. |
| `/sitemap.xml` | `apps/web/app/sitemap.ts` | **dynamique** (`export const dynamic = "force-dynamic"`) | Accueil ×2 locales, produits `sellable`, établissements `active` — une entrée par locale native, chacune avec `es`/`en`/`x-default` et `lastModified`. |
| `<head>` de chaque page | `apps/web/lib/seo/pageMetadata.ts` | — | `title`, `description`, `canonical`, `hreflang`, `robots`, `openGraph`, `twitter`. |
| `<script type="application/ld+json">` | `apps/web/components/seo/JsonLd.tsx` | Server Component | `Product`+`Offer` / `Event`, `LodgingBusiness`/`LocalBusiness`, `BreadcrumbList`, `WebSite`. |

### Modèle de données (delta)

**Aucune migration. Aucune table. Aucune RPC. Aucune policy.**

| Table | Delta |
|---|---|
| `establishments` | `lat`, `lon` **ajoutés au `select`** de la page publique. Déjà accordés à `anon` (migration `20260819110000`) — rien à migrer. |
| `products`, `establishments` | `slug`, `name`, `updated_at` lus par le sitemap. Déjà accordés à `anon`. |

Variable d'environnement : `NEXT_PUBLIC_WEB_APP_URL` (nom **réutilisé** d'`apps/admin`), à poser sur
`apps/web`. Dépendance ajoutée à `apps/web` : `@supabase/supabase-js` (déjà résolue par hoisting,
mais non déclarée).

### Invariants

- `metadataBase` est posé dans `app/[locale]/layout.tsx` — root layout de fait, il n'y a pas de `app/layout.tsx`.
- L'origine du site vient de `NEXT_PUBLIC_WEB_APP_URL`, jamais des en-têtes de la requête.
- `robots.txt` n'ouvre que si `process.env.VERCEL_ENV === "production"` — jamais sur la foi de l'URL configurée.
- `robots.txt` n'a qu'un seul groupe `User-Agent: *`. Aucun groupe nommé par bot.
- Le sitemap n'est jamais prérendu : `force-dynamic`, sans exception.
- Le sitemap ne contient aucune URL que les métadonnées déclarent `noindex`.
- Sitemap et `generateMetadata` partagent `hasNativeContent` — jamais deux copies.
- Un champ localisé compte comme « natif » seulement si c'est une **chaîne non blanche** pour cette locale.
- Les hreflang viennent des métadonnées uniquement ; `alternateLinks: false` dans `i18n/routing.ts`.
- Toute route routée porte un canonical auto-référent.
- `Disallow` et `noindex` ne coexistent jamais sur la même page.
- Le JSON-LD est construit dans `page.tsx`, jamais dans une vue `"use client"`.
- Tout JSON-LD passe par `serializeJsonLd` (`<` → `\u003c`).
- Aucune propriété schema.org sans colonne réelle : jamais `aggregateRating`/`review`/`ratingValue`,
  jamais `telephone`/`email`, jamais `openingHours`, jamais de composant d'adresse hors `addressCountry`.
- `priceCurrency` vaut toujours `"COP"` — aucune colonne de devise n'existe.

### Cas limites

| Situation | Traitement attendu |
|---|---|
| Locale sans traduction réelle | Page `noindex` + canonical vers la langue source ; absente du sitemap ; pas déclarée en `hreflang`. |
| Aucune locale routée traduite (contenu saisi en `fr`) | Aucune entrée de sitemap ; `x-default` retombe sur l'espagnol. |
| Champ JSONB scalaire (`"Tour"` au lieu de `{"es":"Tour"}`) | Traité comme non natif : pas d'indexation, pas d'entrée de sitemap. |
| Champ JSONB blanc (`{"es":"   "}`) | Idem — sinon page indexée au titre vide. |
| `type = 'evento'` avec date | `@type: Event`, `startDate` en heure de Guatapé (`-05:00`), **aucun `offers`**. |
| `type = 'evento'` sans date | Retombe sur `Product` sans `offers` — jamais un `Event` sans `startDate`. |
| `lat`/`lon` nuls ou partiels | Nœud `geo` **omis**. |
| Établissement sans `mode` | `LocalBusiness` au lieu de `LodgingBusiness`. |
| Produit sans photo | Propriété `image` omise, jamais un tableau vide. |
| Description contenant `</script>` | Échappée en `\u003c/script>` ; le document reste du JSON valide. |
| Lecture du catalogue en échec | `console.error` + sitemap réduit à l'accueil. ⚠️ Non couvert par les tests : garde-fou = smoke test de bascule. |
| Build sans base accessible | Ne peut plus produire un sitemap figé (`force-dynamic`) — mais un déploiement dont la base est injoignable sert un sitemap réduit. |

### Fichiers touchés

**Créés** — `apps/web/lib/seo/{siteUrl,nativeContent,pageMetadata}.ts` ;
`apps/web/lib/seo/jsonld/{serialize,product,establishment,breadcrumb,site}.ts` ;
`apps/web/lib/supabase/publicClient.ts` ; `apps/web/components/seo/JsonLd.tsx` ;
`apps/web/app/{robots,sitemap}.ts` ; `hifago/scripts/check-seo.sh` ; les tests colocalisés de chacun
et `apps/web/e2e/seo.spec.ts`.

**Modifiés** — `apps/web/app/[locale]/layout.tsx` (`metadataBase`) ;
`apps/web/app/[locale]/(vitrine)/page.tsx` (`generateMetadata` + `WebSite`) ;
`apps/web/app/[locale]/(vitrine)/productos/[slug]/page.tsx` et `apps/web/app/[locale]/(vitrine)/establecimientos/[slug]/page.tsx`
(métadonnées partagées, JSON-LD, `lat`/`lon`) ; les quatre pages transactionnelles (`noindex`) ;
`apps/web/i18n/routing.ts` (`alternateLinks: false`) ; `apps/web/package.json` ;
`apps/web/messages/{es,en}.json` (`Common.breadcrumbHome`) ;
`.github/workflows/hifago-ci.yml` ; `hifago/CLAUDE.md` §5 ;
`.claude/skills/hifago-review/SKILL.md` §3.

### Vérification

`npx vitest run` (apps/web) · `npx playwright test e2e/seo.spec.ts` (ciblé — jamais la suite
complète, qui remet la base à zéro) · `npm run build --workspace=apps/web` (le piège §11.16 ne se
voit qu'au build ; vérifier que `/robots.txt` sort en `○` et `/sitemap.xml` en `ƒ`) ·
`bash scripts/check-seo.sh`.

## 1. Contexte et problème

`hifago/CLAUDE.md` §5 tranche cinq règles de SEO depuis le cadrage initial. Au moment d'écrire cette
spec, l'audit du code réel en donne l'état suivant :

| Règle §5 | État constaté le 2026-09-01 |
|---|---|
| §5.1 — deux couches i18n distinctes (interface next-intl / contenu JSONB) | respectée |
| §5.2 — hreflang sur les seules locales d'interface routées | **violée**, voir ci-dessous |
| §5.3 — fiche en repli JSONB ⇒ `noindex` + canonical vers la langue source | faite (`products/[slug]/page.tsx:63`) |
| §5.4 — canonical vers `x-default` (l'espagnol) | faite (`products/[slug]/page.tsx:65`) |
| §5.5 — un `sitemap.xml` dynamique avec `alternates.languages` par entrée | **jamais implémentée** — aucun `app/sitemap.ts` |

⚠️ **§5.2 est violée sans que personne l'ait écrit, et c'est le constat le plus important de cette
spec.** `next-intl` active `alternateLinks` **par défaut**
(`next-intl/dist/esm/production/routing/config.js` : `alternateLinks: e.alternateLinks ?? !0`) et
`apps/web/i18n/routing.ts` ne le surcharge pas. Le middleware pose donc, sur **chaque** réponse non
redirigée, un en-tête HTTP `Link` portant les hreflang `es`, `en` **et `x-default`**. Ils sont
construits depuis `x-forwarded-host`
(`next-intl/dist/esm/production/middleware/getAlternateLinksHeaderValue.js`, `f.host = h`). Trois
conséquences, toutes contraires à ce que le projet croit :

1. Le projet **émet déjà des hreflang** qu'aucune ligne de son code ne produit ni ne contrôle.
2. Ils **dépendent de l'hôte de la requête** : le même contenu servi via deux hôtes annonce deux
   jeux d'alternates différents.
3. Ils sont posés **aussi sur les fiches `noindex`** servies en repli JSONB, ce qui contredit §5.3 :
   une page dont on déclare qu'elle n'est pas une version linguistique distincte s'annonce quand
   même comme telle.

S'ajoutent quatre manques qu'aucune règle ne couvrait :

- **Aucun `metadataBase`.** Les `alternates.canonical` déjà écrits sont donc des chemins **relatifs**
  (`next/dist/lib/metadata/default-metadata.js` → `metadataBase: null` ; `resolvers/resolve-url.js`
  ne résout en absolu que si `metadataBase` existe). C'est le même défaut de nature que les liens
  relatifs des emails 2 et 3 constatés le 2026-08-31 : correct en apparence, mort en contexte réel.
- **Aucun `robots.ts`**, donc aucune directive — alors que rien du site n'est censé être public.
- **Aucune donnée structurée.** `grep -rniE "application/ld\+json|schema\.org"` sur `apps/` et
  `packages/` : zéro occurrence.
- **La page d'accueil n'a aucun `generateMetadata`** et hérite du seul `title: "Hifago"` du layout,
  alors que `messages/es.json` porte déjà `HomePage.title` et `HomePage.description`
  (« Actividades y experiencias en Guatapé. »), inutilisés.

**Ce qui déclenche la spec maintenant** : la demande de Jérôme d'avoir « une techno qui fonctionne
bien pour le référencement IA et Google ». La réponse est que la technologie n'est pas en cause —
Next.js App Router rend le contenu côté serveur, ce qui est exactement ce qu'exigent les crawlers IA
(qui, contrairement à Googlebot, n'exécutent quasiment pas de JavaScript). Le seul `useEffect` qui
charge des données dans `apps/web` est la disponibilité PMS
(`products/[slug]/LodgingReservationForm.tsx:134`), qui n'est pas du contenu indexable. Le problème
est entièrement dans la couche de métadonnées absente au-dessus.

⚠️ **Le motif de fond est le piège §11 point 20** : « une règle documentée que rien ne vérifie n'est
pas une règle ». §5.5 était écrite et n'a jamais existé en code ; §5.2 était écrite et était violée
par un défaut de bibliothèque. Cette spec ne se contente donc pas d'implémenter : elle pose aussi les
tests et le garde-fou de CI qui rendent les règles exécutables.

## 2. Portée

**Dans le périmètre (in)**

- `metadataBase` et l'URL publique de `apps/web`.
- `app/robots.ts` — fermé hors production, ouvert et documenté en production.
- `app/sitemap.ts` — dynamique, multilingue, sans URL non indexable.
- Métadonnées manquantes : accueil, OpenGraph textuel, `noindex` des pages transactionnelles,
  canonical auto-référent, alignement de la page établissement sur la fiche produit.
- Source unique de hreflang.
- Données structurées schema.org sur la fiche produit, la page établissement et l'accueil.
- La codification : `CLAUDE.md` §5, la checklist `/hifago-review`, le garde-fou `check-seo.sh`.

**Hors périmètre (out), explicitement**

- **Sortir les pages publiques du rendu dynamique.** Chaque page appelle `createClient()` qui appelle
  `cookies()` (`packages/supabase/src/server.ts:6`), ce qui rend tout `apps/web` dynamique à chaque
  requête. C'est le premier poste de gain sur les Core Web Vitals. Le client public sans cookies
  introduit en §5 pour le sitemap est la brique qui débloquera ce chantier, mais le chantier
  lui-même reste à faire.
- **La bascule de domaine.** `hifago.co` sert **aujourd'hui l'app legacy en production** (Fly.io
  `kayam-partner-portal` : `/guatape`, `/partner`, `/admin`). La reprise du domaine par le nouveau
  stack exigera des redirections 301 depuis `/guatape` et `/reservar`, le retrait de la Deployment
  Protection Vercel, et l'enregistrement en Search Console. Le capital SEO à préserver est
  vraisemblablement faible — le legacy n'a ni `robots.txt` ni sitemap, et ses deux pages statiques
  portent `noindex, nofollow` — mais des 404 en masse pénalisent quand même.
- **`opengraph-image` et favicon.** `apps/web/app/favicon.ico` fait 25 931 octets : c'est exactement
  celui de `create-next-app`, jamais remplacé, et `public/` ne contient que les cinq SVG du starter.
  Cela demande un asset de marque qui n'existe pas ; on ne l'invente pas. Les balises OpenGraph
  **textuelles**, elles, n'exigent aucun asset et sont dans le périmètre.
- **Le contenu.** Cette spec lève des blocages techniques ; elle ne crée aucune demande. Le site
  compte quelques dizaines de fiches aux descriptions courtes saisies par des partenaires, sans
  contenu éditorial, sans avis, sur une seule ville. Un référencement technique parfait sur du
  contenu mince ne classe pas. Le palier suivant est éditorial et relationnel, pas technique.

## 3. Décisions retenues

Décisions prises par Jérôme le 2026-09-01, non rouvertes ici :

- **A — Domaine cible : `hifago.co`.** ⚠️ Ce domaine sert aujourd'hui le legacy en production ; il
  sera repris par le nouveau stack à la bascule (hors périmètre, cf. §2).
- **B — Rien n'est encore public**, ni production ni préproduction. `robots.txt` **bloque par défaut**
  et n'ouvre que si l'environnement se déclare production. Le mode sûr : une préproduction indexée
  cannibalise le vrai site.
- **C — Tous les crawlers IA sont autorisés en production** (GPTBot, ClaudeBot, Google-Extended,
  PerplexityBot, OAI-SearchBot, ChatGPT-User…). Pour Hifago, être cité comme source dans une réponse
  d'IA est de l'acquisition, pas du pillage.
- **D — Périmètre complet livré maintenant**, alors même que rien ne sera observable avant la
  bascule de domaine. La raison qui tranche : ce projet a déjà prouvé qu'une règle non implémentée
  reste lettre morte — §5.5 est écrite depuis le cadrage et n'a jamais existé en code. Écrire des
  règles sans le code les rendrait mortes à leur tour.

Décisions de cadrage antérieures qui s'appliquent sans être rouvertes :

- `apps/web` est localisée en `es`/`en` avec `defaultLocale: "es"` et `localePrefix` à `always`
  (défaut non surchargé) : **aucune URL sans préfixe de locale n'existe**, `/` ne fait que rediriger.
- Le contenu partenaire vit en colonnes JSONB par champ avec repli obligatoire
  (`packages/domain/src/content/resolveLocalizedField.ts`), jamais en table de traductions.
- Un Server Component ne doit jamais importer depuis `@hifago/ui` (`CLAUDE.md` §11.16).

## 4. Parcours cible

Il n'y a pas de parcours utilisateur : les consommateurs de cette feature sont des robots. Le
parcours cible est donc celui d'un crawler.

**Aujourd'hui, hors production.** Le crawler demande `/robots.txt`, reçoit `User-Agent: * /
Disallow: /`, et s'arrête. Aucun `Sitemap:` ne lui est annoncé — on n'indique pas un plan de site
qu'on refuse par ailleurs de faire crawler. Rien d'autre n'est atteint.

**Après la bascule, en production.**

1. Le crawler demande `/robots.txt` : il obtient `Allow: /`, les quelques `Disallow` de routes sans
   contenu, et l'adresse absolue du sitemap.
2. Il demande `/sitemap.xml`. La route interroge la base **à chaque requête** (elle n'est pas
   figée au build) et rend une entrée par page publique **et par locale disposant d'un contenu
   réellement traduit** — accueil, fiches produit vendables, pages établissement actives. Chaque
   entrée porte ses alternates `es` / `en` / `x-default` et sa date de dernière modification.
3. Il suit une URL de fiche. Le HTML lui arrive **complet** : le contenu est rendu côté serveur, il
   n'a aucun JavaScript à exécuter pour le lire.
4. Dans le `<head>`, il trouve un `title`, une `description`, un `canonical` **absolu**, les
   `hreflang` — une seule fois, depuis une seule source — et les balises OpenGraph.
5. Dans le corps, il trouve un `<script type="application/ld+json">` décrivant la même chose que ce
   qu'un humain voit à l'écran : le produit et son offre, ou l'établissement et sa localisation.
6. S'il tombe sur une fiche servie en repli — saisie en espagnol, consultée en `/en` — il lit
   `noindex` et un canonical vers la version espagnole, et n'en fait pas une page distincte.

## 5. Surfaces produites

Cette feature ne produit aucun écran. Elle produit quatre surfaces machine.

### 5.1 `/robots.txt`

Généré par `app/robots.ts`. Deux formes selon l'environnement, et une seule règle de construction :

⚠️ **Un seul groupe `User-Agent: *`, jamais de groupe nommé par bot.** Un crawler n'obéit qu'au
groupe le plus spécifique qui le nomme et **ignore alors le groupe `*`**. Déclarer un groupe
`User-Agent: GPTBot / Allow: /` sans y répéter les `Disallow` autoriserait GPTBot précisément là où
le groupe générique l'interdit. Puisque la décision C est « tout autoriser », le groupe `*` en
`Allow: /` suffit à lui seul — et la décision C se documente en **commentaire** dans le fichier
source, pas en règles redondantes et piégeuses dans le fichier servi.

⚠️ **`robots.txt` est prérendu au build.** Basculer le drapeau de production exige donc un
**redéploiement**, pas seulement un changement de variable d'environnement.

### 5.2 `/sitemap.xml`

Généré par `app/sitemap.ts`.

⚠️ **`export const dynamic = "force-dynamic"` est obligatoire, et ce n'est pas une optimisation.**
Les metadata routes sont compilées en un `GET()` **prérendu au build**
(`next/dist/build/webpack/loaders/next-metadata-route-loader.ts`, avec
`initialRevalidateSeconds: false`). Sans directive, le sitemap serait figé au moment du build —
l'inverse exact du « dynamique » de §5.5. Et `revalidate` ne suffit pas : le premier rendu se ferait
quand même au build, et un sitemap faux serait servi jusqu'à la première revalidation.

⚠️ **Le piège qui rend cette erreur silencieuse** : le job `build` de la CI n'a **aucun Supabase**
(`.github/workflows/hifago-ci.yml`, job `build` = `npm ci` puis `npm run build`, sans service base),
et `postgrest-js` **avale** l'erreur réseau en `{ data: null }` au lieu de la lever
(`PostgrestBuilder.ts`, `if (!this.shouldThrowOnError) res = res.catch(...)`). Un sitemap vide
serait donc produit et livré **sans qu'aucun build n'échoue**.

⚠️ **Aucun test unitaire ne protège de ce piège** : un mock rend toujours des données, donc il valide
la logique et jamais la connexion. Le seul garde-fou réel est un **smoke test post-déploiement**
(`curl <site>/sitemap.xml | grep -c "<loc>"`), à exécuter comme étape de la bascule.

**Une entrée par locale disposant d'un contenu natif**, pas seulement l'espagnole. Ne lister que
`/es/…` priverait les URL `/en/…` de `<loc>` propre — motif classique de « hreflang : pas de balise
de retour » en Search Console. Et un produit dont le `name` n'existe qu'en `en` a une page `/es` en
`noindex` et une page `/en` parfaitement indexable : une entrée unique « es + alternates » la
perdrait purement et simplement.

**Jamais d'URL non indexable au sitemap.** Une fiche servie en repli est `noindex` par §5.3 ;
l'inscrire au sitemap est une contradiction que Search Console signale. Le sitemap applique donc le
**même prédicat de contenu natif** que les `generateMetadata`, via un helper partagé — jamais deux
copies, qui divergeraient à la première évolution.

### 5.3 Le `<head>` des pages

- `metadataBase` posé une fois dans `app/[locale]/layout.tsx`, qui est le **root layout de fait**
  (il n'existe pas de `app/layout.tsx`).
- `canonical` **auto-référent sur toute route routée**, pas seulement sur les deux fiches.
  ⚠️ Raison concrète : `proxy.ts` pose le cookie d'attribution depuis `?ref=` sur **n'importe quelle**
  page, et `[locale]/r/[code]/route.ts` redirige vers `/<locale>?ref=<code>`. **Chaque code promo
  distribué crée donc une URL indexable distincte de l'accueil**, et rien ne les rassemble
  aujourd'hui.
- `hreflang` portés **uniquement** par les métadonnées (cf. §10 point B).
- OpenGraph textuel (`type`, `siteName`, `locale`, `url`, `title`, `description`) et `twitter.card`.
- `noindex` sur les pages transactionnelles.

### 5.4 Le JSON-LD

⚠️ **Rendu depuis `page.tsx` (Server Component), jamais depuis la vue cliente** — pour une raison de
**données**, pas de §11.16 : `ProductDetailView` ne reçoit ni le `slug`, ni le `type`, et reçoit le
prix **déjà formaté** en chaîne (`page.tsx`, `priceDisplay = formatCop(...)`), inutilisable pour
`offers.price`. Le Server Component a tout.

⚠️ **Échappement obligatoire, et la doc officielle Next se contredit sur ce point.**
Elle montre la même ligne sous deux formes : l'une remplace `<` par le caractère `<`
lui-même — donc **ne fait rien** — l'autre le remplace par la séquence d'échappement JSON
`\u003c` (barre oblique inversée, `u`, `003c`). **Seule la seconde est correcte.** Elle est
légale dans une chaîne JSON, donc le document reparse toujours, et elle neutralise aussi
`<!--`.

L'enjeu est réel et non théorique : noms et descriptions sont saisis par des **partenaires**,
donc du contenu non maîtrisé placé dans une balise `<script>` ; un `</script>` dans une
description fermerait le script et casserait la page.

⚠️ Ce piège s'est refermé **deux fois pendant la rédaction de ce lot** : une première dans
le garde-fou censé l'interdire (un grep qui cherchait `<` au lieu de la séquence, donc ne
pouvait jamais échouer), une seconde dans ce paragraphe lui-même. C'est précisément pourquoi
`scripts/check-seo.sh` cherche la séquence littérale, et pourquoi un test unitaire fait passer
une description contenant `</script>` dans le constructeur.

## 10. Décisions tranchées / points ouverts

**A — Le discriminant de production est l'environnement de déploiement, pas l'URL.** Un premier
jet adossait `isProductionSite()` à la valeur de `NEXT_PUBLIC_WEB_APP_URL`. C'est faux sur Vercel :
une variable définie « All Environments » ferait émettre `Allow: /` **et** des canonicals de
production depuis chaque build de preview — exactement le scénario que la décision B veut empêcher.
Le drapeau est donc `process.env.VERCEL_ENV === "production"`.

**B — Une seule source de hreflang : les métadonnées.** `alternateLinks: false` est posé dans
`i18n/routing.ts`. *Arbitrage assumé, pas une évidence* : Google ignore de toute façon les hreflang
impliquant une page `noindex`, donc la contradiction avec §5.3 est plus théorique que dangereuse, et
laisser next-intl seul maître (sans rien ajouter en métadonnées) serait moins de code. Ce qui tranche
est la dépendance à `x-forwarded-host` : elle rend les hreflang tributaires de l'hôte de la requête,
alors que le canonical, lui, doit en être indépendant sous peine de perdre son sens. Deux sources
obéissant à deux règles opposées est le pire des trois mondes ; on garde celle qu'on maîtrise.

**C — Le canonical n'est jamais dérivé des en-têtes de requête.** `packages/domain/src/http/resolveOrigin.ts`
existe et sait le faire, mais une URL canonique qui change avec l'hôte servant la requête annule
exactement ce que le canonical sert à résoudre : deux hôtes produiraient deux canonicals pour la même
page.

**D — Le client Supabase du sitemap est anonyme et sans cookies, et reste local à `apps/web`.**
Anonyme et sans cookies parce qu'un sitemap n'a aucune session à lire, que cela évite `cookies()`
(donc prépare la sortie du rendu dynamique), et que cela le rend testable — **aucun mock de
`next/headers` n'existe dans ce dépôt**. ⚠️ **Jamais `createServiceRoleClient` ici** : il
contournerait `sellable` et `status`, et publierait au monde des fiches non publiées.
Local à `apps/web` plutôt que dans `packages/supabase` : §2.1 est explicite, un module ne migre vers
`packages/` que s'il est **prouvé consommé par les deux apps aujourd'hui**. Un seul consommateur, il
reste donc local — quitte à le promouvoir le jour où `apps/admin` en aura besoin. Corollaire :
`@supabase/supabase-js` doit être ajouté aux dépendances d'`apps/web`, qui ne déclare aujourd'hui que
`@supabase/ssr` ; sans cela ce serait une dépendance fantôme résolue par le hoisting npm.

**E — Aucune propriété schema.org sans colonne réelle derrière.** Interdits, avec leur raison :
`aggregateRating` / `review` / `ratingValue` (⚠️ **aucune table d'avis n'existe** — inventer une note
déclenche une action manuelle Google, longue à lever) ; `telephone` / `email` (aucune colonne de
contact sur `establishments`, et celles de `partners` ne sont pas accordées au rôle `anon`) ;
`openingHours` (n'existe pas — `check_in_time`/`check_out_time` ne sont pas des horaires
d'ouverture) ; `priceRange` / `AggregateOffer` (le calcul du « à partir de » a été supprimé avec
l'étage `hotel` le 2026-08-27 ; le recréer serait un ajout produit, pas du SEO).

**F — `geo` est conditionnel.** `establishments.lat` / `lon` **existent** et sont déjà accordés à
`anon` (migration `20260819110000`), donc aucune migration n'est nécessaire — mais ils ne sont pas
dans le `select` de la page, et ils sont souvent vides (le seed ne les peuple jamais). Le nœud `geo`
est **omis** quand ils sont nuls, et testé comme tel.

**G — L'adresse n'est pas décomposable, et on ne fait pas semblant.** `establishments.address` est une
chaîne unique (`formattedAddress` de Google) ; `apps/admin/components/address-autocomplete.ts` ne
demande que `formattedAddress` et `location`, et aucun composant d'adresse (`addressLocality`,
`postalCode`…) n'est persisté nulle part. On émet donc `PostalAddress { streetAddress, addressCountry: "CO" }` —
le pays est le seul composant réellement garanti, l'autocomplétion étant restreinte à la Colombie.

**H — Un `evento` est un `Event`, jamais un `Product` avec offre.** `price_cop` y est nullable par
contrainte (`products_price_cop_required_unless_evento`) et seul `price_label`, texte libre, existe —
il n'est pas parsable en prix. `occurrence_date`, `start_time` et `duration_minutes` sont déjà
chargés par la page et donnent un `startDate` réel.

**Points ouverts, non tranchés ici**

- **`updated_at` n'a aucun trigger** : seules les RPC qui l'écrivent explicitement le font bouger.
  Ajouter ou retirer une photo (`product_media`, `establishment_media`) ne change jamais
  `products.updated_at`. Le `lastModified` du sitemap est donc exact pour les changements de champs
  et muet pour les changements d'images. Acceptable, mais à savoir avant de s'y fier.
- **`asLocalizedField` est un cast sans validation** (`resolveLocalizedField.ts`). Si un champ JSONB
  contient un scalaire (`"Tour"` au lieu de `{"es":"Tour"}`), `resolveLocalizedField` fait
  `Object.values("Tour")` et renvoie **`"T"`** comme titre de page. Bug préexistant, hors périmètre
  SEO, mais il contamine tout ce qui lit ces champs — dont désormais le sitemap et le JSON-LD. Le
  prédicat de contenu natif introduit ici est durci en conséquence, sans corriger la cause.
- **`apps/web` n'a aucun `not-found.tsx`** : les 404 ne sont ni localisées ni cohérentes avec la
  vitrine.
- **Aucune validation par un outil externe n'est possible avant la bascule.** La Deployment
  Protection Vercel est active sur les deux projets (`all_except_custom_domains`) : tout visiteur
  anonyme d'une URL `*.vercel.app` reçoit un 302 vers le SSO. Ni Search Console, ni le test de
  résultats enrichis, ni un crawler IA ne peuvent atteindre le site aujourd'hui. La validation réelle
  est **différée à la bascule** — elle n'est pas faite, et cette spec ne prétend pas le contraire.
  ⚠️ **Révisé le 2026-09-30 (migration vers le compte hifago)** : la Deployment Protection est
  désormais **désactivée** sur les deux projets. Elle ne distingue pas la production de la préprod,
  qui doit rester joignable par les testeurs et par le webhook Mercado Pago. La production est donc
  publique sous `*.vercel.app` avant la bascule. La garde « rien n'est indexable » passe dans le
  code : `isIndexableSite()` (`apps/web/lib/seo/siteUrl.ts`) n'ouvre `robots.txt` que si
  `VERCEL_ENV=production` **et** si `NEXT_PUBLIC_WEB_APP_URL` n'est pas un `*.vercel.app`.
  À la bascule, poser `NEXT_PUBLIC_WEB_APP_URL=https://hifago.co` puis redéployer.

## 11. Annexe — traçabilité code→règle

| Règle / décision | Fichiers |
|---|---|
| §5.2 violée par next-intl | `apps/web/i18n/routing.ts` ; `next-intl/dist/esm/production/routing/config.js` ; `next-intl/dist/esm/production/middleware/getAlternateLinksHeaderValue.js` |
| §5.3 / §5.4 déjà implémentées | `apps/web/app/[locale]/products/[slug]/page.tsx` (`generateMetadata`) |
| Canonical relatif faute de `metadataBase` | `apps/web/app/[locale]/layout.tsx` ; `next/dist/lib/metadata/default-metadata.js` |
| Sitemap prérendu au build | `next/dist/build/webpack/loaders/next-metadata-route-loader.ts` |
| Erreur réseau avalée par PostgREST | `node_modules/@supabase/postgrest-js/src/PostgrestBuilder.ts` |
| CI sans base au job `build` | `.github/workflows/hifago-ci.yml` |
| Duplication d'URL par `?ref=` | `apps/web/proxy.ts` ; `apps/web/app/[locale]/r/[code]/route.ts` |
| Colonnes et GRANTs `anon` | `supabase/migrations/20260819110000_pms_connector_schema.sql` ; `supabase/migrations/20260827200000_establishments_public_page.sql` |
| Absence de table d'avis | *(vérifié par recherche exhaustive sur `supabase/migrations/` et `packages/supabase/src/database.types.ts`)* |
| Devise COP codée en dur | `packages/domain/src/format/formatCop.ts` |
| Adresse non décomposée | `apps/admin/components/address-autocomplete.ts` |
| Piège du Server Component et de `@hifago/ui` | `hifago/CLAUDE.md` §11.16 |

## 12. Documents liés

- `hifago/CLAUDE.md` §5 (i18n et SEO) — les règles que cette spec rend exécutables, et qu'elle étend.
- `hifago/CLAUDE.md` §11 point 20 — « une règle documentée que rien ne vérifie n'est pas une règle ».
- `hifago/docs/04-architecture-cible.md` — hébergement Vercel, environnements, domaine.
- `hifago/docs/01-cahier-des-charges-client.md` — le parcours public que ce lot rend indexable.
- `hifago/docs/specs/24-modele-hebergement-et-surface-lobbypms.md` — regroupement des logements par
  établissement, qui définit quelles pages existent au sitemap.
- `.claude/skills/hifago-review/SKILL.md` — domaine i18n/SEO, étendu par ce lot.

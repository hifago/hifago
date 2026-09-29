---
id: specs-architecture-vitrine-et-routage
titre: "Architecture de la vitrine : routes, zones, coquilles et couche d'accès aux données"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: implemente
maj: 2026-09-28
resume: >
  Pose la carte des routes de apps/web en espagnol, ses quatre zones et leurs coquilles, la garde
  d'accès du compte, et la couche lib/catalog qui devient le seul endroit d'où part une requête
  Supabase — plus les cinq contrôles CI qui empêchent ces règles de se périmer.
mots_cles: [architecture, routage, vitrine, apps/web, zones, layouts, lib/catalog, buscar, contrôles CI]
repond_a:
  - "Quelles routes existent sur la vitrine publique, et laquelle est publique ou protégée ?"
  - "Où vit une requête Supabase dans apps/web ?"
  - "Comment la garde d'accès du compte client est-elle posée ?"
---

# Architecture de la vitrine : routes, zones, coquilles et couche d'accès aux données

> **Cible stack** : hifago. Première spec du chantier front de `apps/web`. Elle ne construit
> **aucun écran** : elle pose le terrain sur lequel les specs 28 et suivantes en construiront un
> par lot.
>
> **✅ Validée par Jérôme le 2026-09-07.** **Implémentée** : le socle les 2026-09-07/08 (couche
> `lib/catalog` et `search_catalog`, quatre coquilles de zone, routes en espagnol, cinq contrôles
> CI) ; le lot B3 (`lib/reservas/`, écrans hérités supprimés) par la spec 30 ; les routes « à
> créer » du §0 par les specs 29 (listings, index de tags), 32 (panier, devenu `/mi-viaje`), 34 et
> 35 (`/cuenta`), et `olvide-password`/`restablecer-password` côté `(auth)` — constaté le 2026-09-28.

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 0 | **Contrat compact** | ✅ validé 2026-09-07 |
| 1 | Contexte et problème | ✅ validé 2026-09-07 |
| 2 | Portée | ✅ validé 2026-09-07 |
| 3 | Décisions retenues | ✅ validé 2026-09-07 |
| 4 | Parcours cible (flux d'une requête) | ✅ validé 2026-09-07 |
| 5 | Les quatre coquilles | ✅ validé 2026-09-07 |
| 6 | Modèle de données (delta) | ✅ validé 2026-09-07 |
| 7 | Contrat de la couche d'accès | ✅ validé 2026-09-07 |
| 8 | Règles et invariants | ✅ validé 2026-09-07 |
| 9 | Cas limites | ✅ validé 2026-09-07 |
| 10 | Décisions tranchées / points ouverts | ✅ validé 2026-09-07 |
| 11 | Annexe — traçabilité | ✅ validé 2026-09-07 |
| 12 | Documents liés | ✅ validé 2026-09-07 |

---

## 0. Contrat compact (pour coder — lire seul, sans le reste)

### Carte des routes

Toutes sous `app/[locale]/`, préfixe de locale **toujours** posé (`localePrefix: "always"`).
Segments **en espagnol**, non traduits entre locales : `/es/actividades` **et** `/en/actividades`.

| URL | Fichier | Zone | Rendu | État (2026-09-28) |
|---|---|---|---|---|
| `/[locale]` | `(vitrine)/page.tsx` | vitrine | dynamique | livré (spec 28) |
| `/[locale]/actividades` | `(vitrine)/actividades/page.tsx` | vitrine | dynamique | livré (spec 29) |
| `/[locale]/actividades/[categoria]` | `(vitrine)/actividades/[categoria]/page.tsx` | vitrine | dynamique | livré (spec 29 ; `[tag]` renommé `[categoria]`) |
| `/[locale]/alojamientos` | `(vitrine)/alojamientos/page.tsx` | vitrine | dynamique | livré (spec 29) |
| `/[locale]/transportes` | `(vitrine)/transportes/page.tsx` | vitrine | dynamique | livré (spec 29) |
| `/[locale]/camps` | `(vitrine)/camps/page.tsx` | vitrine | dynamique | livré (spec 29) |
| `/[locale]/eventos` | `(vitrine)/eventos/page.tsx` | vitrine | dynamique | livré (spec 29) |
| `/[locale]/productos/[slug]` | `(vitrine)/productos/[slug]/page.tsx` | vitrine | **cacheable** | livré (spec 30) |
| `/[locale]/establecimientos/[slug]` | `(vitrine)/establecimientos/[slug]/page.tsx` | vitrine | **cacheable** | livré (spec 30) |
| `/[locale]/reserva/[token]` | `(vitrine)/reserva/[token]/page.tsx` | vitrine | dynamique | livré (spec 33 ; remplace `/pago/[token]` prévu ici) |
| `/[locale]/mi-viaje` | `(tunnel)/mi-viaje/page.tsx` | tunnel | dynamique | livré (spec 32 sous `/carrito`, renommé le 2026-09-16) |
| `/[locale]/pago` | `(tunnel)/pago/page.tsx` | tunnel | dynamique | livré (specs 32-33) |
| `/[locale]/cuenta/reservas` | `(cuenta)/cuenta/reservas/page.tsx` | compte | dynamique | livré (spec 34) |
| `/[locale]/cuenta/perfil` | `(cuenta)/cuenta/perfil/page.tsx` | compte | dynamique | livré (spec 35 ; accueil de la zone, pas de `/cuenta` seul) |
| `/[locale]/entrar` | `(auth)/entrar/page.tsx` | auth | dynamique | livré |
| `/[locale]/registro` | `(auth)/registro/page.tsx` | auth | dynamique | livré |
| `/[locale]/verificar-email` | `(auth)/verificar-email/page.tsx` | auth | dynamique | livré |
| `/[locale]/olvide-password` | `(auth)/olvide-password/page.tsx` | auth | dynamique | livré (prévu ici sous `/recuperar`) |
| `/[locale]/restablecer-password` | `(auth)/restablecer-password/page.tsx` | auth | dynamique | livré (prévu ici sous `/restablecer`) |
| `/[locale]/r/[code]` | inchangé | — | — | **intact** |

**Intacts, hors `[locale]`** : `app/api/payments/*`, `app/api/pms/*`, `app/auth/callback/route.ts`,
`app/robots.ts`, `app/sitemap.ts`.
**Repoussées** (spec ultérieure) : `/legal`, `/privacidad`, `/contacto`, `/ayuda`, `/terminos` —
d'ici là les cinq liens sortent de `SiteFooter`.
**Supprimées** : `app/[locale]/{page,login,signup,verify-email,checkout,account,products,establishments}`
et leurs vues. Aucune redirection à poser : `apps/web` n'a jamais été servi en production.

### Zones et coquilles

| Zone | Layout | Contenu de la coquille | robots | Garde |
|---|---|---|---|---|
| — | `app/[locale]/layout.tsx` | `<html data-theme="vitrine">`, `NextIntlClientProvider`, `CartProvider`, `SiteToaster` **en sibling** | — | aucune |
| vitrine | `(vitrine)/layout.tsx` | `SiteHeader` + `{children}` + `SiteFooter` — **pas de `<main>`** (voir §5) | indexable | aucune |
| tunnel | `(tunnel)/layout.tsx` | en-tête allégé (logo seul), ni menu ni footer | `index:false, follow:true` | aucune — **l'invité réserve de bout en bout** |
| compte | `(cuenta)/layout.tsx` | en-tête + nav de compte | `index:false` | `getUser()` → `redirect("/entrar?next=…")` |
| auth | `(auth)/layout.tsx` | coquille centrée minimale | `index:false, follow:true` | aucune |

### Couche d'accès — `apps/web/lib/catalog/`

`import "server-only"` en tête de chaque module. **Aucun `page.tsx` n'appelle Supabase.**

| Fonction | Rend | Utilisée par |
|---|---|---|
| `buscarSecciones(criterios, { porSeccion })` | `{ tipo, tarjetas[], total }[]`, sections vides retirées | accueil |
| `buscarTipo(tipo, criterios, { limite, curseur })` | `{ tarjetas[], curseurSuivant }` | listings, scroll infini |
| `listarTagsConOferta(tipo)` | `{ slug, label, total }[]`, jamais un tag à 0 | `/actividades` |
| `getProductoPorSlug(slug, locale)` | fiche complète ou `null` | `/productos/[slug]` |
| `getEstablecimientoPorSlug(slug, locale)` | fiche + couchages + autres produits | `/establecimientos/[slug]` |
| `listarRutasIndexables()` | slugs + `lastModified` + locales natives | `sitemap.ts` |

`criterios = { q?, tag?, tipo?, personas?, desde?, hasta? }` — le **même type** partout.

### Modèle de données (delta)

| Objet | État | Détail |
|---|---|---|
| extension `unaccent` | **à créer** | recherche par nom insensible aux accents (« guatape » → « Guatapé ») |
| extension `pg_trgm` | **à créer** | index trigramme sur le texte cherchable |
| fonction `search_catalog(...)` | **à créer** | `stable`, `security invoker` — les policies publiques s'appliquent, aucun `security definer` |
| index trigramme sur le texte cherchable de `products` et `establishments` | **à créer** | — |
| `products`, `establishments`, `catalog_tags`, `product_tag_assignments`, `product_media` | réutilisés tels quels | policies `_select_public` déjà en place |
| `products.external_booking_url` | **mort à activer** | posé le 2026-08-13, jamais consommé par le front — c'est lui qui fait une fiche vitrine, **jamais** `sellable = false` |
| contrainte `products_price_cop_required_unless_evento` | **à remplacer** | devient `…_unless_vitrine` : `check (type = 'evento' or external_booking_url is not null or price_cop is not null)` — une vitrine de n'importe quel type peut se passer de prix chiffré et afficher `price_label` |

Aucune table n'est créée. Aucune écriture n'est ajoutée. **Aucune RPC `security definer`** : cette
spec ne touche à rien de capacitaire, donc rien ne relève de la frontière RPC-only.

### Invariants

1. Aucun `page.tsx` ni `layout.tsx` n'importe `@hifago/ui` — le barrel casse `next build`.
2. Aucun `page.tsx` n'appelle `supabase.from(...)` : tout passe par `lib/catalog/`.
3. Les lectures publiques utilisent le **client anonyme sans cookies** (`lib/supabase/publicClient.ts`).
4. Tout lien interne passe par le `Link` de `@/i18n/navigation`.
5. Aucune couleur en dur : ni hex, ni `oklch()`, ni classe de palette Tailwind (`bg-blue-500`).
6. Toute route de zone tunnel/compte/auth exporte `robots: { index: false }`.
7. `SiteToaster` est monté **en frère** de `{children}`, jamais en wrapper.
8. La garde d'accès vit dans `(cuenta)/layout.tsx`, **jamais** dans `proxy.ts`.
9. Un `<h1>` par page, hiérarchie sans saut, aucun contenu masqué selon la largeur.
10. Le préfixe de locale est toujours présent ; aucune URL sans locale n'existe.
11. **Un seul `<main>` par page**, posé par `PageShell` et jamais par un layout de zone (corrigé le 2026-09-07, cf. §5).

### Cas limites

| Situation | Traitement |
|---|---|
| Slug inconnu ou produit dépublié | `notFound()` → 404 sobre dans la coquille vitrine, message traduit, lien vers l'accueil. Jamais une redirection vers la catégorie (« soft 404 ») |
| Section sans résultat | la section n'est pas rendue |
| Tag sans offre publiée | absent de l'index des tags |
| Recherche sans aucun résultat | l'accueil rend un état vide explicite, pas une page blanche |
| Visiteur non connecté sur `/cuenta/*` | `redirect("/entrar?next=<chemin courant>")` |
| Locale inconnue | `notFound()` (déjà en place) |
| Base injoignable | la page échoue franchement (`error.tsx` de zone) — jamais un catalogue vide présenté comme un catalogue |
| Produit portant `external_booking_url` | fiche vitrine : le calendrier laisse la place au bouton de contact |

### Fichiers touchés

**Créés** : les 4 `layout.tsx` de zone · `not-found.tsx`, `error.tsx`, `loading.tsx` par zone ·
`lib/catalog/{buscar,tags,producto,establecimiento,rutas,tipos}.ts` ·
`supabase/migrations/<ts>_search_catalog.sql` ·
`supabase/migrations/<ts>_precio_opcional_en_vitrina.sql` · `scripts/check-tokens.sh` ·
`scripts/check-data-layer.sh` · `scripts/check-i18n-links.sh`.
**Modifiés** : `app/[locale]/layout.tsx` · `proxy.ts` (pose du pathname en en-tête) ·
`app/robots.ts` (ajout de `/{locale}/pago/`) · `app/sitemap.ts` (consomme `listarRutasIndexables`) ·
`components/organisms/SiteFooter.tsx` (retrait des 5 liens) · `.github/workflows/*` (3 contrôles).
**Déplacés** : la logique métier des trois formulaires de réservation vers `lib/reservas/`.
**Supprimés** : les 14 fichiers d'écran de `app/[locale]/` listés en §0, après extraction.

---

## 1. Contexte et problème

Trois faits, tous vérifiés le 2026-09-07, pas supposés.

**La bibliothèque de composants existe et n'est branchée nulle part.** Les vagues 1 à 8
(2026-09-01 → 2026-09-04) ont produit 26 composants, chacun avec son test et sa story. Compté :
`SiteHeader`, `SiteFooter`, `SiteMenu`, `SiteToaster`, `SearchBar`, `SearchPanel`,
`LanguageSwitcher`, `PageShell`, `Card`, `Title`, `BackLink`, `TypeBadge`, `PhotoStrip` ont **zéro
usage** hors stories et tests. Les seuls imports de `@/components` dans `app/` sont trois `JsonLd`.
Le layout ne monte ni en-tête ni pied de page : **le site n'a aucun landmark de navigation**.

**Les composants ont commencé à décider de l'architecture sans qu'elle soit écrite.** `SiteFooter`
pointe vers cinq routes qui n'existent pas ; `SiteHeader` envoie le panier sur `/checkout` alors
qu'aucune route `/cart` n'existe ; et `SearchPanel` documente lui-même « il n'existe pas encore de
route de recherche pour porter les dates et le nombre de personnes ».

**Le parcours client a été réécrit.** Le §2 du cahier client, validé le 2026-08-11, ne faisait plus
foi sur ses quatre axes ; il a été réécrit le 2026-09-07 après interview, puis audité. Cette spec en
est la traduction technique — elle ne rouvre aucune de ses décisions.

Enfin, tout `apps/web` est aujourd'hui **dynamique à chaque requête** : chaque page appelle
`createClient()` → `cookies()`. La spec 26 l'avait relevé comme « le premier poste de gain sur les
Core Web Vitals » et explicitement écarté de son périmètre. C'est le moment de le traiter, parce que
le choix se prend à l'architecture et pas au douzième écran.

## 2. Portée

**In.** La carte des routes et son passage à l'espagnol · les quatre zones, leurs coquilles et leurs
`not-found`/`error`/`loading` · la garde d'accès du compte · la couche `lib/catalog/` et sa fonction
de recherche SQL avec ses index · la stratégie de rendu par zone · l'extraction de la logique métier
des trois formulaires de réservation vers `lib/reservas/` · les cinq contrôles CI · la suppression
des écrans actuels après extraction.

**Out, renvoyé aux specs suivantes.** Le contenu de chaque écran, à commencer par l'accueil
(spec 28) · la recherche géographique par rayon, différée (cahier §2f) · le voucher · la RPC de
rattachement d'une commande invitée par email · la colonne de prix minimum d'un établissement · les
cinq pages institutionnelles · les tokens du thème `vitrine` et les polices Geist.

**Explicitement non touché.** `app/api/payments/*` et `app/api/pms/*` (signature HMAC Mercado Pago,
budget d'appels Lobby, `service_role`) · `app/auth/callback` · `lib/seo/*` (spec 26 livrée) ·
`lib/products/*` · `packages/*` · les migrations existantes.

## 3. Décisions retenues

Actées ailleurs, non rouvertes ici :

- **Segments d'URL en espagnol, non traduits** entre locales (Jérôme, 2026-09-07). Une seule table
  de routes ; `next-intl` `pathnames` n'est pas utilisé.
- **On repart de zéro sur les vues**, en **extrayant d'abord** la logique métier (Jérôme,
  2026-09-07) : `LodgingReservationForm` (572 l., disponibilité LobbyPMS, vérifiée en réel le
  2026-08-27), `SlotReservationForm`, `ReservationForm`.
- **Le compte est optionnel** : l'invité réserve de bout en bout (cahier §1).
- **L'accueil porte les critères de recherche dans son URL** ; pas de route `/buscar` (cahier §2a).
- **Les critères vivent dans l'URL des pages à résultats seulement**, en mémoire du navigateur
  ailleurs (cahier §2a) — c'est ce qui rend les fiches cacheables.
- **Identité visuelle neutre d'abord** (Jérôme, 2026-09-07) : aucune couleur en dur nulle part.
- **HeroUI v3 seul socle, via `packages/ui`** ; aucune dépendance UI hors de la carte
  besoin → bibliothèque (`CLAUDE.md` §2, `.claude/rules/ui.md`).

## 4. Parcours cible (flux d'une requête)

```
requête
  └─ proxy.ts        next-intl (préfixe de locale) · cookie ?ref= · refresh de session
  │                  + pose x-hifago-pathname  ← nouveau
  └─ app/[locale]/layout.tsx        <html>, providers, SiteToaster
      └─ (zone)/layout.tsx          coquille, et pour (cuenta) la garde serveur
          └─ page.tsx               Server Component
              ├─ lib/catalog/…      LA seule requête, via le client anonyme
              ├─ JsonLd             rendu serveur (spec 26)
              └─ <Vista …/>         "use client", reçoit des données sérialisées
```

Le `page.tsx` ne fait que trois choses : appeler une fonction de `lib/catalog/`, poser son JSON-LD,
et rendre une vue cliente avec des données déjà mises en forme. C'est ce qui le rend court et ce qui
permet au contrôle CI de vérifier qu'il ne contient aucune requête.

## 5. Les quatre coquilles

**Racine — `app/[locale]/layout.tsx`.** Reste le root layout de fait : `apps/web` n'a pas de
`app/layout.tsx` et n'en aura pas. Il rend `<html lang data-theme="vitrine">`, `metadataBase`, les
providers, et `SiteToaster`. ⚠️ `SiteToaster` se monte **en frère** de `{children}` : son `children`
est un render-prop consommé par toast ; en wrapper, toute l'app rend `null` tant qu'aucun toast
n'existe — page blanche, aucune erreur, build vert (`.claude/rules/apps.md`).

**`(vitrine)`.** `SiteHeader` + `{children}` + `SiteFooter`. Seule zone indexable.
⚠️ **Corrigé le 2026-09-07 (audit de la spec 28)** : la première rédaction plaçait le `<main>` dans
ce layout. Or l'atome `PageShell` en pose déjà un, et son en-tête le dit — « l'unique `<main>` d'une
page ». Les deux ensemble donnaient **deux `<main>` imbriqués** : faute de structure et défaut
d'accessibilité, invisibles au typecheck comme au lint. C'est donc **la page** qui pose son `<main>`
via `PageShell` ; le layout ne pose que l'en-tête et le pied de page. La règle SEO « landmarks dans
la coquille » reste tenue : `<header>`, `<footer>` et `<nav>` viennent bien du layout, et chaque
page apporte le sien. La barre de recherche
n'est **pas** dans l'en-tête et n'est pas collante : elle vit dans le premier bloc des pages à
résultats (décision de Jérôme du 2026-09-02, documentée dans `SearchBar.tsx`).

**`(tunnel)`.** En-tête allégé, ni menu ni pied de page. ⚠️ **Conséquence à connaître** : l'écran de
confirmation n'a donc **pas** de contact WhatsApp de pied de page — c'est ce qui invalidait la
première justification du retrait du WhatsApp (cahier §2b.9), et le canal de suivi d'un invité est
l'email de confirmation.

**`(cuenta)`.** Porte **la seule garde d'accès du site** :

```ts
const { data: { user } } = await supabase.auth.getUser()
if (!user) redirect({ href: `/entrar?next=${pathname}`, locale })
```

⚠️ Un layout ne connaît pas le chemin courant. `proxy.ts` pose donc le pathname en en-tête de
requête, que le layout relit — une ligne dans le proxy, et la garde reste à sa place. La garde
n'est **jamais** dans le proxy : `@supabase/ssr` et la documentation Supabase déconseillent de
faire porter l'autorisation au middleware, et le proxy ne voit ni les rôles ni la ressource visée.

**`(auth)`.** Coquille centrée minimale.

Chaque zone porte ses `not-found.tsx`, `error.tsx` et `loading.tsx` : aujourd'hui `apps/web` n'en a
**aucun**, et une 404 y est la page nue de Next, ni traduite ni habillée (point ouvert relevé par la
spec 26 §10).

## 6. Modèle de données (delta)

Aucune table créée, aucune écriture ajoutée.

**`unaccent` et `pg_trgm`.** Le nom d'un produit vit en JSONB multilingue ; chercher « guatape »
doit trouver « Guatapé », et « kayac » doit approcher « kayak ». Un `ilike` naïf ne fait ni l'un ni
l'autre. Deux extensions du tronc Postgres, disponibles sur Supabase, aucune dépendance nouvelle.

**`search_catalog(...)`, `stable` et `security invoker`.** Pas de `security definer` : la fonction
ne lit que des données déjà publiques (`products_select_public` exige `sellable`,
`establishments_select_public` exige `status = 'active'`), et l'invoker fait que ces policies
s'appliquent d'elles-mêmes. Poser `security definer` ici contournerait RLS **sans aucun besoin** —
exactement ce que `CLAUDE.md` §3.5 interdit de présenter comme un filet de sécurité.

**`products.external_booking_url` — mort à activer.** Posé par la migration `20260814190000` avec le
commentaire « générique, plus jamais figé WhatsApp seul », jamais consommé par le front, qui branche
aujourd'hui sur `isEvento`. C'est cette colonne qui fait une fiche vitrine.
**La contrainte de prix est relâchée (tranché par Jérôme le 2026-09-07).**
`products_price_cop_required_unless_evento` n'exemptait que les eventos, parce qu'à sa création
(2026-08-13) eux seuls pouvaient être en vitrine. Depuis que la vitrine vaut pour tous les types,
elle rattrapait un transport dont le tarif se négocie : il aurait dû afficher un montant ferme qui
n'est pas le vrai — le genre d'écart qui finit en litige au moment de payer. Elle devient donc
`products_price_cop_required_unless_vitrine` :

```sql
check (type = 'evento' or external_booking_url is not null or price_cop is not null)
```

Un produit portant une URL de contact peut alors se passer de `price_cop` et afficher `price_label`
(« Consultar », « Desde $150.000 ») — exactement ce que font déjà les eventos, avec une colonne qui
existe déjà et n'était pas réservée à un type. Aucune donnée existante ne devient invalide : la
nouvelle contrainte est strictement plus permissive que l'ancienne.

## 7. Contrat de la couche d'accès

```sql
create or replace function search_catalog(
  p_query        text        default null,
  p_tipos        text[]      default null,   -- null = tous
  p_tag_slug     text        default null,
  p_personas     int         default null,   -- capacité DÉCLARÉE, jamais la dispo réelle
  p_desde        date        default null,
  p_hasta        date        default null,   -- chevauchement, jamais inclusion
  p_por_tipo     int         default null,   -- plafond par section ; null = pas de plafond
  p_limite       int         default 24,
  p_offset       int         default 0
) returns table (
  tipo             text,
  es_establecimiento boolean,   -- true = carte groupée d'un établissement
  id               uuid,
  slug             text,
  nombre           jsonb,
  descripcion      jsonb,
  precio_desde     bigint,
  establecimiento  jsonb,       -- { slug, nombre }
  rango_seccion    int          -- row_number() partition by tipo
)
language sql stable security invoker;
```

Côté TypeScript, `lib/catalog/buscar.ts` enveloppe cet appel et rend des objets déjà **résolus dans
la locale** (`resolveLocalizedField` de `@hifago/domain`) — un composant ne reçoit jamais un JSONB.

**Sémantique des deux filtres, telle que le cahier §2a l'arrête** :
- `p_personas` compare aux **capacités déclarées** (`products.capacity`, `max_qty`), jamais aux
  places restantes. **Conséquence voulue** : la recherche ne consulte aucune disponibilité, donc
  elle n'appelle **jamais LobbyPMS** et fonctionne sans dates.
- `p_desde`/`p_hasta` filtrent par **chevauchement** : une offre sort dès que sa période croise la
  plage, et peut déborder avant et après. Un produit sans date requise reste visible.

## 8. Règles et invariants

Les dix invariants secs sont en §0. Ceux qui méritent une justification :

**Aucune requête dans un `page.tsx`.** L'accueil actuel fait trois requêtes séquentielles et
soixante lignes de regroupement dans le fichier de page ; `sitemap.ts` réécrit sa propre version des
mêmes requêtes. À vingt écrans, les deux divergent. La couche unique rend le prédicat partageable —
c'est le même `hasNativeContent` qui sert au sitemap et aux métadonnées (spec 26 §3), et il ne doit
exister qu'une fois.

**Client anonyme pour les lectures publiques.** `lib/supabase/publicClient.ts` existe déjà et sert
au sitemap. L'utiliser partout où la donnée est publique fait tomber l'appel à `cookies()`, donc
rend la page cacheable. Les fiches produit et établissement, qui ne lisent aucun critère d'URL, en
bénéficient réellement ; les listes restent dynamiques, et c'est assumé.

**La garde ne vit pas dans le proxy.** Cf. §5.

**Aucune couleur en dur.** L'identité visuelle est repoussée (« neutre d'abord, habillage après »).
Ce choix ne tient **que si** aucun écran n'écrit une couleur : sinon l'habillage d'après ne rattrape
rien et il faut repeindre vingt écrans à la main. D'où un contrôle, pas une consigne.

**Chaque contrôle est vérifié par mutation.** On casse volontairement la règle, on regarde le
contrôle échouer, on répare. C'est la méthode que le projet s'est donnée (§11.20 : « une règle
documentée que rien ne vérifie n'est pas une règle, c'est un souhait ») et celle qui a validé
`check-design-system.sh` et `check-seo.sh`.

### Les cinq contrôles

| Contrôle | Ce qu'il refuse | Fichier |
|---|---|---|
| tokens | hex, `oklch(`, `rgb(`, classe de palette Tailwind dans `apps/web/**` | `scripts/check-tokens.sh` (créé) |
| couche de données | `.from(` ou `createClient` dans un `page.tsx`/`layout.tsx` | `scripts/check-data-layer.sh` (créé) |
| liens i18n | `next/link` ou `<a href="/` dans `apps/web/**` | `scripts/check-i18n-links.sh` (créé) |
| zones noindex | une coquille de `(tunnel)`/`(cuenta)`/`(auth)` sans `robots: { index: false }`, ou une route de ces zones qui se redéclare `index: true` | `scripts/check-seo.sh` (étendu) |
| barrel RSC | `@hifago/ui` importé depuis un Server Component **ou depuis un fichier de route** | `scripts/check-design-system.sh` (étendu) |

⚠️ **Deux pièges d'écriture, mesurés le 2026-09-07 en faisant tourner ces contrôles à la main sur
l'état actuel du dépôt.** Sans eux, trois contrôles sur cinq naissent avec des faux positifs — et un
contrôle qui crie à tort est un contrôle qu'on désactive.

1. **Ignorer les commentaires.** Une recherche naïve de `@hifago/ui` dans les `page.tsx` remonte
   deux fichiers… qui ne font que **citer la règle en commentaire** pour expliquer pourquoi ils ne
   l'importent pas. Idem pour `next/link` : les deux seules occurrences du dépôt sont les
   commentaires de `LinkButton` et `BackLink` qui expliquent quoi ne pas faire. Ne matcher que la
   ligne `import`, jamais le texte libre.
2. **Exempter les couleurs qui ne sont pas des couleurs de thème.** Les huit valeurs hexadécimales
   du dépôt sont les **drapeaux SVG** de `LanguageSwitcher` (colombien, britannique). Un drapeau n'a
   pas de jeton sémantique : sa couleur *est* sa définition. Le contrôle doit exempter les attributs
   `fill`/`stroke` d'un SVG, ou ce fichier avec sa raison écrite.

**État de départ mesuré** : seul le contrôle « aucune requête dans un `page.tsx` » échoue, sur cinq
fichiers — et ce sont exactement les cinq écrans que les specs 28 et suivantes remplacent. Les
quatre autres contrôles passent déjà. Chaque contrôle reste néanmoins **vérifié par mutation** avant
d'être considéré comme posé.

### Ce que l'écriture réelle a corrigé (2026-09-07, lot C)

Les cinq contrôles sont posés et vérifiés par mutation. Quatre écarts avec la prévision ci-dessus,
tous constatés en les faisant tourner :

1. **« Les quatre autres contrôles passent déjà » était faux.** Le contrôle de navigation localisée
   a trouvé **deux violations réelles** : `LoginForm.tsx` et `SignupForm.tsx` prenaient `useRouter`
   dans `next/navigation`, donc `router.push("/verificar-email?…")` produisait un chemin **sans
   préfixe de langue**. Rien ne cassait — le proxy rattrape par une redirection — mais la langue
   était alors redevinée depuis un cookie au lieu d'être celle de la page lue. Corrigé dans le même
   lot ; c'est exactement le genre de défaut que la règle existe pour attraper.
2. **Le contrôle des zones noindex ne peut pas porter sur les pages.** Les métadonnées Next se
   fusionnent champ par champ du layout vers la page — **vérifié en réel dans les deux sens** sur le
   serveur de dev : sans `robots`, `/es/pago` sert quand même `noindex, follow` (hérité) ; avec
   `robots: { index: true }`, elle sert `index` et annule sa zone. Exiger un `robots` par page
   aurait crié à tort sur `(cuenta)/cuenta/reservas/page.tsx`. Le contrôle porte donc sur la
   **coquille de zone**, plus une seconde moitié qui refuse toute annulation.
3. **`check-design-system.sh` ne couvrait pas l'invariant 1.** Il ne balayait que
   `apps/web/components/`, jamais `apps/web/app/`. Un bloc a été ajouté — et pour une route la règle
   est plus stricte que pour un composant : elle n'importe **jamais** le barrel, là où un composant
   peut le faire avec `"use client"` (réponse qui, sur une route, coûterait le rendu serveur et les
   métadonnées).
4. **Six fichiers hérités, pas cinq** — `(cuenta)/layout.tsx` est né depuis. Il est exempté du seul
   `createClient` (la garde d'accès du §5 doit résoudre la session), jamais du `.from(`.

Le piège « ignorer les commentaires » s'est confirmé chiffré : une recherche naïve de `@hifago/ui`
dans les fichiers de route remonte **quatre** fichiers, dont **aucun** ne l'importe — tous les
quatre citent la règle pour expliquer qu'ils la respectent. D'où `scripts/lib/sans-commentaires.pl`,
partagé par les trois contrôles concernés, qui retire les commentaires **en conservant les numéros
de ligne**.

## 9. Cas limites

Le tableau sec est en §0. Deux méritent d'être justifiés.

**Base injoignable → échec franc.** Un catalogue vide rendu comme un catalogue normal est pire
qu'une erreur : le client croit qu'il n'y a rien à vendre. C'est la déclinaison en lecture de la
règle « échec fermé » du projet (`CLAUDE.md` §4.4).

**Slug inconnu → 404, jamais une redirection vers la catégorie.** Google traite une redirection de
ce genre comme un « soft 404 » et elle rend le débogage plus difficile. Décision de Jérôme du
2026-09-07 : 404 sobre, en-tête et pied de page normaux, message traduit, lien vers l'accueil.

## 10. Décisions tranchées / points ouverts

**Tranché ici — le regroupement des établissements se fait en SQL, pas en TypeScript.** Le catalogue
actuel groupe les couchages d'un même établissement en TypeScript, après la requête. Ça ne marche
plus avec un plafond par section : plafonner à huit *produits* puis grouper donne moins de huit
*cartes*. Le plafond porte sur ce que le client voit, donc le regroupement doit précéder le
plafonnement — donc vivre dans `search_catalog`, d'où la colonne `es_establecimiento`.

**Tranché ici — `security invoker`, pas `security definer`.** Justifié en §6.

**Tranché ici — pas de `next-intl pathnames`.** Les segments sont en espagnol dans les deux locales
(Jérôme, 2026-09-07). Conséquence SEO assumée : l'URL anglaise ne porte pas de mots-clés anglais.
Réversible plus tard, au prix d'une table de correspondance et de 301.

**Tranché par Jérôme le 2026-09-07 — une vitrine de n'importe quel type peut se passer de prix
chiffré.** La contrainte est relâchée (cf. §6) : un produit portant `external_booking_url` affiche
`price_label` au lieu d'un montant. Écarté : garder la contrainte et saisir un prix indicatif —
annoncer un montant ferme sur une offre dont le tarif se négocie est un écart qui se découvre au
moment de payer.

**Point ouvert, hérité — les six du cahier §2f** : recherche géographique différée · plafonds du
panier · forme du voucher · disponibilité PMS dans une recherche datée · colonne exacte du contact
d'établissement · (rattachement par email : tranché, reste à construire).

**Signalé, pas corrigé ici.** `apps/web/lib/cart/CartContext.tsx` cite le §3e du cahier client pour
interdire toute persistance du panier. §3e est marqué « à rouvrir » depuis le 2026-09-07 : le
commentaire n'est pas encore faux, il le deviendra dès que §2b.6 sera revalidé, et devra être
corrigé dans le geste qui rendra le panier persistant (spec du panier, pas celle-ci).

## 11. Annexe — traçabilité

| Sujet | Sources |
|---|---|
| Parcours et écrans | `docs/01-cahier-des-charges-client.md` §2 (réécrit le 2026-09-07) |
| Pièges RSC, barrel, toasts, formulaires | `.claude/rules/apps.md` |
| SEO, sitemap, robots, JSON-LD | `.claude/rules/seo.md`, `docs/specs/26-referencement-seo-et-moteurs-ia.md` |
| Design system, responsive, carte besoin→bibliothèque | `.claude/rules/ui.md`, `apps/web/components/README.md` |
| Frontière RLS / RPC-only | `CLAUDE.md` §3, `.claude/rules/supabase.md` |
| Logique de réservation à extraire | `app/[locale]/products/[slug]/{LodgingReservationForm,SlotReservationForm,ReservationForm}.tsx` et leurs 4 fichiers de tests |
| Regroupement des couchages (règle actuelle) | `app/[locale]/page.tsx`, T1/T3 de la spec 24 |
| Fiche vitrine | migration `20260814190000_products_evento_vitrine.sql` |
| Portail legacy (URLs réellement servies) | dépôt parent, `server.js` l.185-235, `public/reservar.html` |

## 12. Documents liés

`docs/01-cahier-des-charges-client.md` (§1, §2, §3a, §3d, §3e, §6) · `docs/04-architecture-cible.md` ·
`docs/05-reference-technique.md` · specs `07`, `17`, `18`, `19`, `21`, `24`, `26` ·
`apps/web/components/README.md` · `AGENTS-PARALLELES.md`.

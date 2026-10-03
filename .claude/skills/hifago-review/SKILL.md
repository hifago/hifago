---
name: hifago-review
description: Audit de conformité d'une contribution au nouveau stack Hifago aux invariants de l'architecture avant de la considérer terminée — frontière RLS/RPC-only, pattern anti-survente, cohérence du design system unique, correction i18n/SEO, absence de fournisseur écarté. Invocation Codex — $hifago-review, $hifago-review rls, anti-survente, i18n ou design-system
---

# /hifago-review — audit de conformité avant de considérer une tâche terminée

> Tu rapportes, tu ne corriges pas de ta propre initiative — signale les écarts, laisse Jérôme
> décider de la correction, sauf s'il a explicitement demandé une correction dans la même tâche.

Ce skill vérifie qu'une contribution récente au nouveau stack respecte les décisions déjà actées
dans `CLAUDE.md` et `docs/04-architecture-cible.md` — il ne redécide rien, il compare
le code écrit aux règles déjà tranchées.

## Argument `$ARGUMENTS`
| Valeur | Effet |
|---|---|
| *(vide)* | Les 5 domaines ci-dessous — aucune dépendance entre eux (fichiers disjoints : migrations SQL, handlers de route RPC, usages next-intl/JSONB, imports de composants, dépendances), à traiter en un seul passage interleavé (greps/lectures groupés) plutôt qu'en 5 passes séquentielles |
| `rls` | Frontière RLS/RPC-only seule |
| `anti-survente` | Pattern RPC critique seul |
| `i18n` | i18n/SEO seul |
| `design-system` | Cohérence des bibliothèques UI seule |

## Domaines contrôlés

### 1. Frontière RLS / RPC-only
Règles : `CLAUDE.md` §3 + `.claude/rules/supabase.md`. Vérifier sur chaque migration nouvelle ou
modifiée : grants d'écriture directe révoqués sur toute table RPC-only (aucune policy d'écriture) ;
`stable` / `security definer` + `search_path = ''` sur les fonctions de policy ;
`(select auth.uid())` partout. `supabase/tests/database/rls_rpc_only_checklist.test.sql` couvre
3 des 5 points sur tout le schéma — les 2 restants (quelle table doit être RPC-only, squelette
exact) se vérifient à la lecture.

### 2. Pattern anti-survente
Règles : `CLAUDE.md` §4. Vérifier : RPC unique avec `select … for update`, un seul aller-retour ;
test de concurrence à barrière (`tests/concurrency/*.concurrency.mjs`, jamais pgTAP ni
`Promise.all` naïf) pour chaque RPC critique ; échec fermé partout où une réservation dépend d'un
service externe. Comparer à la liste des RPC déjà couvertes plutôt qu'à la seule propriété RPC-only.

### 3. i18n et SEO
Règles : `.claude/rules/apps.md` et `.claude/rules/seo.md`. Vérifier : aucune chaîne ES/EN en dur
dans `apps/web` (grep) ; contenu partenaire en JSONB par champ ; `alternateLinks: false` toujours
posé dans `apps/web/i18n/routing.ts` ; canonical auto-référent sur toute nouvelle route publique ;
nouvelle page atteignable depuis `app/sitemap.ts` (`export const dynamic = "force-dynamic"`
présent) et sitemap exempt de toute URL `noindex` via le même `hasNativeContent` ; `app/robots.ts`
à un seul groupe, fermé hors production ; aucune propriété schema.org sans colonne réelle ; JSON-LD
construit dans `page.tsx`. `bash scripts/check-seo.sh` doit passer.

### 4. Cohérence du design system
Règles : `.claude/rules/ui.md`. Vérifier : `grep 'from "@heroui/react"'` hors de `packages/ui/` —
toute occurrence est une rupture ; aucune dépendance UI hors de la carte ; un composant ajouté dans
`apps/*/components/` qui duplique `packages/ui` ; `grep 'Table.Body\|Table.Content'` dans
`apps/*/app/**/page.tsx` sans `"use client"` en ligne 1 ; sur `apps/admin`, un tableau dense en
simple `overflow-x-auto` sans reflow en cartes, ou un formulaire en colonnes qui déborde — le rendu
réel à 390×844 doit rester utilisable (l'absence de préfixe `sm:`/`md:` n'est pas en soi un écart).
`bash scripts/check-design-system.sh` doit passer.
### 5. Absence de fournisseur/outil écarté
Grep rapide sur les dépendances et le code pour détecter une réintroduction accidentelle de : Fly.io
(sauf le relais réseau minimal déjà acté, jamais l'hébergement applicatif), Cypress, Jest, pgTAP
pour un test de concurrence, MUI/Chakra/Mantine/Ant Design, un second design system quelconque.
Depuis la scission monorepo du 2026-08-14, vérifier aussi : aucun cookie de session partagé entre
`apps/web` et `apps/admin` n'a été réintroduit (domaine de cookie explicite, JWT transmis entre
apps, etc.) — les sessions sont volontairement indépendantes, cf. `CLAUDE.md` § 2 point 1.

## Ce qui est normal, ne pas le signaler comme un problème
- Une table purement informative (sans capacité/audit/vue miroir) n'a ni grants revoke ni fonction
  `security definer` — normal, elle n'en a pas besoin.
- Absence de langue d'interface autre que ES/EN — normal au premier périmètre (v1).
- Contenu JSONB présent dans une langue sans locale d'interface routée (ex. `pt` alors que seules
  `es`/`en` sont routées) — normal, c'est le mécanisme de repli voulu, pas une fiche mal traduite.
- Une fiche absente du sitemap parce qu'elle n'a de contenu natif dans aucune locale routée —
  normal : elle est `noindex` partout, l'inscrire au sitemap serait la contradiction.
- `robots.txt` qui interdit tout — normal tant que la production n'est pas déclarée. Ce n'est un
  problème qu'après la bascule de domaine.
- Une page établissement sans nœud `geo` — normal : `lat`/`lon` sont facultatifs et rarement
  remplis, et le nœud est omis à dessein plutôt que rempli de nulls.
- Un point explicitement listé dans `CLAUDE.md` § 10 ("hors périmètre") laissé non tranché
  dans le code — normal, c'est voulu tant que Jérôme n'a pas arbitré.

## Sortie attendue

```markdown
## Audit hifago-review — <date>

| Domaine | Verdict | Détail |
|---|---|---|
| RLS/RPC-only | 🟢/🟡/🔴 | ... |
| Anti-survente | 🟢/🟡/🔴 | ... |
| i18n/SEO | 🟢/🟡/🔴 | ... |
| Design system | 🟢/🟡/🔴 | ... |
| Fournisseurs écartés | 🟢/🟡/🔴 | ... |

### 🔴 Ruptures (à corriger avant de considérer la tâche terminée)
...

### 🟡 Points à signaler à Jérôme (pas bloquants, mais à trancher)
...

Aucune correction appliquée sans accord explicite de Jérôme.
```

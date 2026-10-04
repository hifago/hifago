---
name: hifago-ui
description: Scaffold ou vérifie un écran ou composant du nouveau stack Hifago selon le design system déjà tranché — HeroUI v3 comme socle unique, bibliothèque exacte par besoin, jamais de second design system ni de dépendance UI hors périmètre. Invocation Codex — $hifago-ui [écran] ou $hifago-ui check
---

# /hifago-ui — construire un écran selon le design system tranché

## Argument `$ARGUMENTS`
| Valeur | Effet |
|---|---|
| `<écran>` | Scaffold un nouvel écran/composant en appliquant la carte besoin→bibliothèque ci-dessous |
| `check` | Audite un écran déjà écrit contre les mêmes règles, sans en créer de nouveau |

## Carte besoin → bibliothèque et règles transverses

Elles sont dans `.claude/rules/ui.md`, chargée automatiquement dès qu'un fichier de `packages/ui`
ou d'un dossier `components/` est ouvert : carte besoin → bibliothèque (HeroUI seul socle via
`@hifago/ui`, Recharts, react-day-picker, FullCalendar/SVAR, TanStack + `SimpleTable`, Refine en
scaffolding), deux thèmes sur un seul design system, responsive obligatoire sur `apps/admin`
(reflow en cartes sous `md`, viewports 390×844 et 1280×900, rien de masqué selon la largeur). Ce
skill ne la recopie pas : il l'applique.

## Procédure (mode scaffold)
1. Identifier l'app (`apps/web` ou `apps/admin`) et le besoin précis dans la carte de `.claude/rules/ui.md`.
2. Si un composant HeroUI manque au registre de `packages/ui`, l'ajouter depuis `packages/ui/`
   (jamais depuis une app) et le réexporter par le barrel `packages/ui/src/index.ts`.
3. Écrire l'écran en composant Server Component par défaut ; ne passer en Client Component que si
   l'interactivité l'exige réellement (formulaire, calendrier interactif, etc.). Exception : un
   `Table` HeroUI avec `items=`/`renderEmptyState=` (cf. `.claude/rules/apps.md`) exige un sous-composant
   `"use client"` même sur un écran par ailleurs sans interactivité — ce n'est pas un choix
   d'interactivité mais une contrainte de sérialisation RSC.
4. Sur `apps/web` : tout texte visible passe par `useTranslations()`/`getTranslations()`
   (next-intl), jamais une chaîne en dur. Sur `apps/admin` : texte en dur assumé (pas de next-intl
   dans cette app), langue selon la convention déjà en place pour le sous-arbre (`/admin/*` vs
   `/partner/*`).
5. Avant de considérer l'écran terminé : vérifier son rendu à 390×844 (capture Playwright ou
   navigateur piloté) — une liste/tableau dense doit être lisible sur mobile, pas seulement
   scrollable (cf. `.claude/rules/ui.md`).

## Ce que ce skill NE fait PAS
Ne décide jamais seul d'ajouter une dépendance UI hors de la carte de `.claude/rules/ui.md` (une nouvelle
lib de charts, un autre calendrier, etc.) — si le besoin ne rentre dans aucune ligne de la carte,
signaler le cas précis à Jérôme et attendre son arbitrage plutôt que d'improviser.

## Ce qui est normal, ne pas le signaler comme un problème
Un écran back-office qui a l'air visuellement différent du portail public — voulu (deux thèmes),
tant que les deux utilisent HeroUI comme socle commun via `@hifago/ui`.

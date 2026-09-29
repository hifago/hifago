# hifago/ — refonte Casa Kayam / Hifago

Monorepo Next.js (App Router, npm workspaces) sur Vercel + Supabase (Postgres/PostGIS, Auth,
Storage, Realtime, Edge Functions/pg_cron) qui remplace l'app legacy Express/SQLite du dépôt
parent — deux apps déployées séparément, `apps/web` (vitrine publique) et `apps/admin`
(admin+socio). Dépôt git séparé (`casakayam/hifago-2.0`) : c'est ici la racine de travail, rien
du dépôt parent ne s'y applique (`CLAUDE.md` porte les règles).

**État réel** (pas « à venir ») : le code est écrit, testé, et déployé en préprod Vercel avec
paiement réel confirmé. Les specs de `docs/specs/` couvrent l'essentiel du périmètre v1 — la
carte `docs/INDEX.md` dit lesquelles sont livrées, partielles ou encore en brouillon. Le cahier des charges
initial (`docs/00-03-*.md`) reste la référence du périmètre fonctionnel mais n'a pas suivi tous
les raffinements des specs au même rythme — voir leur en-tête « Écarts connus ». Ce qui reste
ouvert ou bloqué : `docs/backlog.md`.

**Pour démarrer** : `/hifago-dev` (Supabase local + les deux apps) ou lire `CLAUDE.md` en entier
d'abord si c'est une première session — il tient sous 200 lignes.

## Avant de pousser

`npm run verify` lance en ~35 s les 12 contrôles du job `lint` de la CI — **exactement les mêmes,
dans le même script** (`scripts/verify.sh`), et sans s'arrêter au premier échec : un seul passage
donne la liste complète de ce qu'il faut corriger.

Deux hooks git le posent automatiquement. Ils s'installent tout seuls au premier `npm install`
(script `prepare`) ; à la main c'est `git config core.hooksPath scripts/git-hooks`.

| Hook | Ce qu'il fait | Contournement |
|---|---|---|
| `pre-commit` | Régénère `docs/INDEX.md` et `docs/ai-index.json` depuis l'index git dès qu'un `docs/**/*.md` est commité | `git commit --no-verify` |
| `pre-push` | Lance `npm run verify` | `git push --no-verify` |

Les deux restent contournables : ce sont des filets, pas des barrières. Ils existent parce que la
CI passait 65 % de son temps en rouge (39 runs sur 60 au 2026-09-19) pour des défauts que ces
35 secondes auraient montrés — le détail de ce diagnostic est au journal du 2026-09-19.

## Carte du dossier

| Dossier | Contenu |
|---|---|
| `apps/web`, `apps/admin` | Les deux apps Next.js |
| `packages/` | `ui` (design system), `supabase` (client/types), `domain` (logique métier partagée), `e2e-support` |
| `supabase/` | Migrations, seed, tests pgTAP, Edge Functions |
| `docs/` | `docs/INDEX.md` = la carte (humains et IA), générée. Cahiers des charges (`00`-`03`), architecture (`04`), specs (`specs/`), historique (`journal/`), points ouverts (`backlog.md`) |
| `tests/` | Concurrence (anti-survente), intégration PMS/notifications |
| `.claude/` | `rules/` (chargées selon le fichier ouvert), `skills/` (procédures à la demande) |
| `scripts/` | Dev, seed, garde-fous CI (`check-*.sh`), manifeste documentaire (`docs_index.js`) |
| `archive/` | Outils/skills périmés, gardés pour mémoire (jamais chargés) |

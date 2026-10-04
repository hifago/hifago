<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:hifago-codex-rules -->

# Instructions projet Hifago pour Codex

- Répondre en français.
- Avant chaque nouvelle tâche, lire entièrement `CLAUDE.md` (invariants du projet), puis
  `.claude/rules/orchestration.md`. Annoncer en une ligne la forme de travail et l'effort que la
  tâche mérite, conformément à cette règle. L'annonce est une recommandation : Codex ne prétend
  pas avoir changé l'effort de la session.
- Énumérer ensuite **tous** les fichiers `.claude/rules/*.md` et charger, avant d'écrire ou
  d'auditer, chaque règle dont au moins un motif YAML `paths:` couvre un fichier concerné. Le hook
  Codex `inject-path-rules.mjs` fournit le même garde-fou avant les outils de lecture/édition. La
  table ci-dessous décrit les règles actuelles mais n'est volontairement pas exhaustive :

  | Fichiers concernés | Règle à lire entièrement |
  |---|---|
  | `apps/**/*.tsx` | `.claude/rules/apps.md` |
  | `apps/web/**` | `.claude/rules/seo.md` |
  | `supabase/**`, `*.sql`, `packages/supabase/**`, `packages/domain/**`, `app/api/**` | `.claude/rules/supabase.md` |
  | `*.spec.*`, `*.test.*`, `tests/**`, `packages/e2e-support/**` | `.claude/rules/tests.md` |
  | `packages/ui/**`, `apps/**/components/**` | `.claude/rules/ui.md` |

- `.agents/skills/` et `.agents/rules/` sont des alias de dossier vers les sources versionnées
  `.claude/skills/` et `.claude/rules/`. Créer un futur skill ou une future règle par **l'un ou
  l'autre chemin** crée donc le même fichier physique, immédiatement utilisable par Claude et
  Codex. Si les alias locaux sont absents après un clone, exécuter
  `node scripts/setup-codex-skills.mjs` ; les hooks `SessionStart` Claude et Codex le font aussi.
- Tout nouveau skill partagé respecte le standard commun : dossier en kebab-case, `SKILL.md`, et
  frontmatter contenant uniquement `name` et `description`. Les mentions historiques
  `/nom-du-skill` désignent `$nom-du-skill` dans Codex, et `$ARGUMENTS` désigne le texte placé après
  l'invocation. Toute nouvelle règle porte un frontmatter `paths:` non vide.
- Pour toute tâche Next.js, la règle auto-générée ci-dessus prime : lire d'abord le guide pertinent
  dans `node_modules/next/dist/docs/` avant d'écrire du code.
- Ne jamais remplacer les alias `.agents/skills/` ou `.agents/rules/` par des copies : toute
  amélioration doit rester dans les sources physiques communes sous `.claude/`.

<!-- END:hifago-codex-rules -->

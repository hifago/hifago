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
- Charger ensuite, avant d'écrire ou d'auditer, chaque règle situationnelle dont le motif couvre
  au moins un fichier concerné :

  | Fichiers concernés | Règle à lire entièrement |
  |---|---|
  | `apps/**/*.tsx` | `.claude/rules/apps.md` |
  | `apps/web/**` | `.claude/rules/seo.md` |
  | `supabase/**`, `*.sql`, `packages/supabase/**`, `packages/domain/**`, `app/api/**` | `.claude/rules/supabase.md` |
  | `*.spec.*`, `*.test.*`, `tests/**`, `packages/e2e-support/**` | `.claude/rules/tests.md` |
  | `packages/ui/**`, `apps/**/components/**` | `.claude/rules/ui.md` |

- Les skills de projet sont exposés à Codex dans `.agents/skills/`. Les mentions historiques
  `/nom-du-skill` dans leurs textes désignent le skill Codex `$nom-du-skill`, et `$ARGUMENTS`
  désigne le texte placé après cette invocation. Si les liens locaux sont absents après un clone,
  les recréer avec `node scripts/setup-codex-skills.mjs`.
- Pour toute tâche Next.js, la règle auto-générée ci-dessus prime : lire d'abord le guide pertinent
  dans `node_modules/next/dist/docs/` avant d'écrire du code.
- Ne jamais modifier les liens de `.agents/skills/` pour adapter un skill uniquement à Codex : la
  source commune reste `.claude/skills/`. Faire toute amélioration partagée dans la source.

<!-- END:hifago-codex-rules -->

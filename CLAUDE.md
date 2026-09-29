# hifago/ — instructions projet (refonte Casa Kayam / Hifago)

> `hifago/` est un projet à part entière — dépôt git séparé (`casakayam/hifago-2.0`), ouvert comme
> racine de travail ; rien du dépôt legacy parent ne s'y applique. Répondre en français. Ce fichier
> ne porte que des invariants : règles situationnelles dans `.claude/rules/` (chargées quand on
> touche les fichiers concernés), procédures dans `.claude/skills/`, état dans `docs/journal/` et
> `docs/backlog.md`. ⚠️ Annoncer la forme et l'effort de CHAQUE tâche avant de commencer :
> `.claude/rules/orchestration.md`.

## Projet en une phrase
Refonte complète de Casa Kayam/Hifago : monorepo Next.js (App Router, npm workspaces) sur Vercel +
Supabase utilisé pleinement (Postgres+PostGIS, Auth, Storage, Realtime, Edge Functions/pg_cron),
sans Fly.io. Deux apps déployées séparément — `apps/web` (vitrine publique) et `apps/admin`
(admin+socio) — plus des packages partagés (`packages/ui`, `packages/supabase`, `packages/domain`,
`packages/e2e-support`). L'app legacy (Express/SQLite, dépôt parent) reste seule en production
pendant tout ce chantier.

## 1. Sources de vérité — à lire avant toute tâche

**Chercher un sujet précis** : lire `docs/INDEX.md` (carte générée, mode d'emploi en tête), puis
Read avec l'`offset`/`limit` qu'elle indique (§0 d'une spec) ; sujet absent → `grep -i <mot>
docs/ai-index.json` — jamais parcourir `docs/` en entier ni lire un gros fichier en entier.

1. `docs/04-architecture-cible.md` fait foi pour toute décision technique « confirmée »/« retenue »
   — ne jamais la rouvrir sans fait nouveau explicite présenté à Jérôme (Fly, Cypress, Jest, pgTAP
   pour une concurrence, Chakra/Mantine/Ant Design, shadcn/ui, Neon/Convex/Clerk, HeroUI
   `RangeCalendar` : déjà comparés et écartés avec raisons documentées).
2. `docs/00-03-*.md` (cahiers des charges) font foi pour le périmètre fonctionnel. **Précédence** :
   une spec `implemente` de `docs/specs/` prime sur la section du cahier qu'elle révise.
3. `docs/05-reference-technique.md` fait foi pour les patterns de code validés (RPC anti-survente,
   test de concurrence) — copier ce squelette, ne pas le redériver.
4. `docs/04-architecture-cible.md` § « Points volontairement non tranchés ici » liste ce qui est
   renvoyé au chiffrage — ne jamais trancher ces points dans du code ou une migration ; signaler à
   Jérôme et attendre son arbitrage.

## 2. Stack non négociable
1. Monorepo npm workspaces, deux apps Next.js (App Router) — `apps/web` (vitrine, next-intl) et
   `apps/admin` (admin+socio, non localisé) — sessions Supabase indépendantes entre les deux (pas de
   cookie partagé, assumé). Un module ne migre vers `packages/` que s'il est prouvé consommé par les
   deux apps aujourd'hui (grep, jamais anticipé). Décision révisée le 2026-08-14 — historique dans
   `docs/04-architecture-cible.md`.
2. HeroUI v3 (React Aria + Tailwind v4) = seul socle de composants, importé uniquement via
   `packages/ui` (jamais `@heroui/react` dans une app). Deux thèmes nommés sur le même design
   system : `data-theme="vitrine"` / `data-theme="admin"` sur `<html>`. Bibliothèques additionnelles
   uniquement pour leur usage précis déjà tranché (Recharts, react-day-picker, FullCalendar, SVAR,
   TanStack Table) — la carte besoin → bibliothèque et les raisons, dont react-day-picker conservé
   face à HeroUI `RangeCalendar` (évalué deux fois) : `.claude/rules/ui.md` et
   `docs/04-architecture-cible.md`. Jamais de second design system.
3. `Table.Body`/`Table.Content` HeroUI depuis un Server Component : jamais d'enfant en fonction —
   idiomes valides dans `.claude/rules/apps.md`.
4. Refine.dev uniquement comme scaffolding des écrans CRUD purs — jamais pour la logique métier,
   jamais son intégration MUI.
5. Vercel pour le web. Supabase pleinement pour tout le backend. Jamais de Fly.io, même ponctuel
   (relais réseau compris — Vultr/Hetzner, jamais Fly).
6. **Responsive obligatoire sur tout `apps/admin`, pas seulement `apps/web`** (décision Jérôme,
   2026-08-15) : reflow en cartes sous `md`, jamais de contenu masqué selon la largeur — règles
   complètes dans `.claude/rules/ui.md`, audité par `/hifago-review`.
7. Composants de la vitrine dans `apps/web/components/{atoms,molecules,organisms}/`, jamais dans
   `packages/ui` (réservé à ce qui est prouvé consommé par les deux apps). Storybook est le
   playground (tranché le 2026-09-01). Aucun barrel, aucun registre de stories. Conventions :
   `apps/web/components/README.md`. ⚠️ La CI audite `npm audit --omit=dev` : Storybook introduit
   3 avis `high` sans correctif sur `image-size`, devDependency jamais déployée.

## 3. Frontière RLS / RPC-only — checklist non négociable
1. **RPC-only (aucune policy RLS d'écriture, grants revoke)** : toute table portant un compteur de
   capacité/disponibilité (calendrier, cupos, stock), toute écriture nécessitant un audit
   nominatif, toute lecture exposant les données d'une autre identité (vue miroir admin), tout
   verrou optimiste multi-admin.
2. **RLS directe autorisée** : tout le reste (une identité sur ses propres données non
   capacitaires).
3. Toute fonction Postgres centralisée utilisée dans une policy RLS directe doit être `STABLE`
   (jamais `VOLATILE` par défaut) ; si elle lit une table elle-même sous RLS, `SECURITY DEFINER`
   avec `SET search_path = ''` obligatoire.
4. Toute policy RLS enveloppe `auth.uid()` en `(select auth.uid())`.
5. `service_role` (utilisé dans les Route Handlers pour les tables RPC-only) contourne RLS
   entièrement — ne jamais présenter ça comme un "filet de sécurité RLS" dans un commentaire ou
   une doc : le vrai filet est l'absence de policy d'écriture directe + les tests + la revue.
   Forme exécutable et pièges : `.claude/rules/supabase.md`, chargée dès qu'un `.sql` est ouvert.

## 4. Invariant anti-survente
1. Toute opération critique (réservation, fermeture de date/créneau, décrément de capacité) = une
   seule fonction RPC Postgres (`SECURITY DEFINER`, `SET search_path=''`), un seul aller-retour
   réseau depuis la Route Handler — jamais orchestrée en plusieurs requêtes séparées côté app.
2. Verrouillage explicite `SELECT ... FOR UPDATE` sur la ligne concernée avant toute décision.
3. Reproduire le squelette exact de `docs/05-reference-technique.md` (validé par un test de
   concurrence réelle le 2026-08-12 : 9 exécutions propres, 20 tentatives concurrentes, exactement
   1 succès à chaque fois) pour toute nouvelle RPC critique — pas une réinvention.
4. Échec fermé partout : si un service dont dépend une réservation est indisponible (calendrier,
   relais réseau LobbyPMS), bloquer la réservation plutôt que risquer une incohérence.
5. Supabase Realtime n'est jamais la source de vérité au moment de valider une réservation — un
   confort d'affichage seulement.

## 5. i18n et SEO
1. Deux couches distinctes, jamais confondues : libellés d'interface (next-intl, ES/EN routés, jeu
   fermé) vs contenu partenaire (colonnes JSONB par champ, langues illimitées, repli obligatoire).
2. hreflang construit uniquement sur les locales d'interface routées, jamais sur la liste
   dynamique de langues de contenu.
3. Une fiche servie en repli JSONB sous une URL routée reste `noindex` + canonical vers la langue
   source tant qu'aucune traduction réelle n'existe.
4. Une langue de contenu sans locale routée : canonical vers `x-default` (l'espagnol), jamais de
   route publique dédiée.
5. Un seul `sitemap.xml` dynamique, une entrée par locale réellement traduite, jamais une URL
   `noindex`.
6. Le reste (metadataBase, source unique des hreflang, canonical auto-référent, robots, JSON-LD,
   frontière RSC du traducteur, un fichier de messages par namespace, parité es/en) :
   `.claude/rules/seo.md` et `.claude/rules/apps.md`, chargées dès qu'un fichier d'`apps/` est
   ouvert. Les numéros 1-5 ci-dessus sont cités par le code — ne pas les renuméroter.

## 6. Tests
1. E2E : Playwright, jamais Cypress (seul capable de piloter plusieurs `BrowserContext` isolés
   pour prouver l'invariant anti-survente sous vraie concurrence).
2. Unitaire/composant : Vitest, jamais Jest.
3. Pour tester une race condition : jamais pgTAP (chaque test tourne dans une transaction annulée
   en rollback — structurellement incapable de simuler une vraie concurrence). Pattern à barrière
   de synchronisation de `docs/05-reference-technique.md`.
4. Toute stack de test tourne en local (`supabase start`, Docker) par défaut — jamais un projet
   Supabase cloud partagé entre tests, sauf job nocturne explicitement dédié et approuvé.
5. Proportionnalité (rien / composant / e2e), sélecteurs HeroUI, fuseau, environnement :
   `.claude/rules/tests.md`, chargée dès qu'un `*.test.*`/`*.spec.*` est ouvert. Pendant le
   développement : `/hifago-test <fichier(s) touché(s)>`, jamais la suite complète.

## 7. Environnements
1. Préprod = Vercel Custom Environment `staging` (domaine stable, pas juste un Preview éphémère)
   + un second projet Supabase dédié (jamais une branche persistante).
2. Promotion vers la prod toujours manuelle (revue de PR + approbateurs), jamais automatique sur
   simple push.
3. Données de préprod 100 % synthétiques via `supabase/seed.sql` — jamais une copie de données de
   production.
4. **Déploiement Vercel — pièges vérifiés en réel** (incident du 2026-08-27, `docs/journal/2026-08.md`) :
   vérifier `.vercel/project.json` juste avant CHAQUE `vercel deploy` (sans lui, la commande CRÉE
   silencieusement un projet au nom du répertoire courant au lieu d'échouer) ; déployer depuis la
   RACINE du monorepo, jamais depuis `apps/*` (le CLI double le chemin) ; poser `framework=nextjs`
   explicitement sur tout nouveau projet, jamais la détection zero-config ; après tout changement
   de réglage projet, redéployer à froid (`vercel deploy --force`) ; `vercel env ls` n'affiche PAS
   les variables "Shared Environment" d'équipe. Le relais réseau (Vultr) se relance par
   `systemctl restart`, jamais `reload` (systemd ne relit l'`EnvironmentFile` qu'au démarrage).

## 8. Sécurité opérationnelle — non négociable (leçon du 2026-08-12)
1. **Avant toute action touchant une ressource cloud réelle** (Supabase, Vercel, tout MCP),
   vérifier explicitement à quel compte/organisation l'outil/token est rattaché — ne jamais
   supposer (`/hifago-verify-compte`). Le 2026-08-12, le serveur MCP Supabase connecté pointait
   sur un compte tiers — détecté avant toute action, à répéter systématiquement.
2. Aucun token/secret n'est jamais écrit sur disque, même dans un scratchpad — au pire une variable
   d'environnement de session, jamais persistée.
3. Stack locale (Docker) par défaut pour toute expérimentation ou prototype. Toute ressource cloud
   réelle (projet Supabase, déploiement Vercel) nécessite une confirmation explicite de Jérôme à
   chaque fois — jamais une autorisation acquise une fois pour toutes.
4. `npx supabase projects api-keys` affiche la clé `service_role` legacy (JWT) en clair même SANS
   `--reveal` (3 occurrences constatées). Ne JAMAIS l'appeler brute : capturer dans un filtre non
   échoïsant (`eval "$(… -o env | grep SERVICE_ROLE_KEY)"`) ou masquer par `sed` avant toute lecture.

## 9. Fournisseurs externes déjà tranchés (ne pas rouvrir)
360dialog (WhatsApp Business, mode API-only) · Google Routes API (itinéraire admin) · **Resend**
(email transactionnel — tranché le 2026-08-24, vérifié en réel le 2026-08-31 ; jamais le mailer
Supabase Auth) · Mercado Pago (paiement, Checkout Pro) · un relais réseau minimal auto-hébergé
(jamais Fly) pour l'IP stable exigée par LobbyPMS — **Vultr retenu pour l'instance préprod**
(région Miami ; Oracle Cloud écarté pour sa carte bancaire obligatoire, Hetzner reste valide comme
référence « ou équivalent » pour un futur relais prod).

## 10. Hors périmètre — à ne jamais trancher sans Jérôme
Niveaux d'accès différenciés entre utilisateurs d'une même organisation partenaire · schéma exact
de la file de réconciliation/campagnes · fréquence du cron PMS et taille de lot · format de
l'export comptable/fiscal · tout point listé dans `docs/backlog.md` § « Arbitrage Jérôme requis ».

## 11. Pièges empiriques — index déporté
Les 22 pièges numérotés vivent dans `docs/pieges-empiriques.md` : la numérotation y fait foi et ne
bouge JAMAIS, parce que le code, les migrations, `docs/specs/` et `docs/journal/` citent
`CLAUDE.md §11.N`. Chacun est déjà prescrit dans la règle `.claude/rules/*` chargée quand on touche
les fichiers concernés — cet index dit seulement où. Le seul qui gouverne tout le projet, et qui
reste donc ici :

20. **Une règle documentée que rien ne vérifie n'est pas une règle : c'est un souhait** — toute
    règle vérifiable mécaniquement l'est (`eslint.rules.mjs`, `scripts/check-*.sh`, CI).

## 12. État courant
État courant → dernière entrée de `docs/journal/<mois-en-cours>.md` (nouveau mois = nouveau
fichier). Points ouverts et arbitrages en attente → `docs/backlog.md`. Fin de session : *append*
(jamais écraser) une entrée datée au journal, puis mettre `docs/backlog.md` à jour (ajouter ce qui
s'ouvre, retirer ce qui se referme).

# À coller en tête du prompt d'un agent lancé en parallèle d'autres

Ce texte n'est lu par aucun agent automatiquement — c'est un bloc que Jérôme colle à la main au
début du prompt de CHAQUE agent, quand plusieurs tournent en même temps sur des specs séparées
dans `hifago/`. Objectif : que l'agent sache qu'il n'est pas seul avant de commencer, pas après
avoir cassé le travail d'un autre.

---

## Bloc à coller (copier tel quel, puis enchaîner avec la tâche réelle)

```
Tu n'es pas seul sur ce dépôt. D'autres agents travaillent peut-être EN CE MOMENT MÊME sur
d'autres specs, dans le même répertoire de travail hifago/, avec la même instance Supabase locale.
Avant de commencer, et à chaque fois que quelque chose semble incohérent avec ce que tu attendais :

1. Lire `docs/backlog.md` (points ouverts) puis la dernière entrée du journal
   (`grep -n '^## 20' docs/journal/*.md | tail -5`, puis Read avec `offset` et `limit` — jamais le
   fichier entier) — une autre session a peut-être livré quelque chose depuis ta dernière lecture
   du repo. (`CLAUDE.md` ne porte plus de curseur d'état depuis le 2026-09-07 — c'est justement
   pour éviter que plusieurs agents parallèles s'écrasent dessus, cf. `docs/journal/2026-09.md`.)
2. Avant de créer une migration : `ls supabase/migrations/ | tail -5` pour repérer un timestamp
   très récent posé par une autre session en cours, et éviter toute collision de nom/ordre.
3. Ne JAMAIS lancer `supabase db reset` (ou `/hifago-test` sans argument, qui le fait aussi via la
   suite complète) sans te demander si une autre session a des données en cours sur cette même
   instance locale — un reset efface tout, y compris son travail. En cas de doute, préférer
   `/hifago-test <fichier(s) que tu touches>` (mode ciblé) plutôt que la suite complète.
4. Avant d'éditer un fichier transverse (nav, layout, composant partagé dans `packages/ui`, page
   d'accueil, un formulaire déjà réutilisé ailleurs) : `git status`/`git diff` d'abord — vérifier
   qu'une autre session n'a pas déjà une modification en cours dessus. Une double-édition
   concurrente le même jour sur le même fichier est déjà arrivée sur ce projet
   (`docs/journal/2026-08.md`, specs 03/04).
5. Dans un test, ne jamais sélectionner un enregistrement seedé PARTAGÉ par son nom affiché à
   l'écran — une autre session peut le renommer en testant sa propre spec au même moment (déjà
   arrivé : contamination croisée entre `admin-product-price-tiers.spec.ts` et
   `admin-establishment-edit.spec.ts`, cf. le journal). Créer une fixture dédiée à ton propre test.
6. Si ta tâche touche une fonction/un chokepoint centralisé (`is_admin()`, `has_capability()`, un
   garde d'authentification partagé, une policy RLS générique) : le rayon d'effet dépasse ta seule
   spec — ça peut casser les tests ou l'accès d'une autre session en cours. Le signaler avant de
   modifier, ne pas supposer que ça n'affecte que toi (un rollout de 2FA a déjà bloqué une autre
   session en cours de vérification sur ce projet).
7. Si `npm install`/le typecheck échoue sur une dépendance qui te semble absente : lancer
   `npm install` (le lockfile fait foi) avant de suspecter ta propre spec — une autre session a
   probablement ajouté une dépendance entre-temps.
8. En fin de tâche, si tu as croisé un aléa de concurrence (fichier modifié sous toi, test cassé
   par un autre lot, reset qui t'a fait perdre du travail) : le consigner explicitement dans ton
   entrée de journal, jamais le passer sous silence — ça évite à la session suivante de le
   redécouvrir à l'aveugle.

Tâche réelle à partir d'ici :
```

## Pourquoi ce fichier existe

Le journal de session (`docs/journal/2026-08.md`) documente déjà plusieurs collisions
réelles entre sessions concurrentes sur ce dépôt (édition simultanée de
`NewEstablishmentForm.tsx`, désynchronisation `node_modules`/`package-lock.json`, rollout 2FA
cassant les tests d'une autre session, contamination croisée entre deux specs partageant un
établissement seedé). Ce ne sont pas des cas isolés : lancer plusieurs agents en parallèle sur ce
repo est un mode de travail normal ici, donc chaque agent doit démarrer en le sachant, au lieu de
le découvrir en marchant sur le travail d'un autre.

---

## Bloc additionnel — agent qui crée des composants de la vitrine

À coller **en plus** du bloc générique ci-dessus, quand plusieurs agents créent des composants
`apps/web` en même temps. Ajouté le 2026-09-01, en montant le terrain des composants atomiques.

Le bloc générique parle de migrations, de base Supabase et de fixtures de test. Les collisions du
front sont ailleurs : un fichier de messages partagé, un barrel, un port. L'architecture a été faite
pour les supprimer — ce bloc dit ce qu'il en reste.

```
Périmètre exclusif. Tu ne crées des composants QUE dans le dossier qui t'est assigné, et tu
n'écris QUE dans le namespace i18n qui t'est assigné (messages/es/<Namespace>.json et son
équivalent en/). Les composants des autres agents sont en LECTURE SEULE pour toi.

Ne crée jamais un atome hors de ton périmètre. Si tu as besoin d'un atome qui n'existe pas encore,
tu ne le crées PAS : tu le signales et tu composes localement en attendant. Sinon on se retrouve
avec trois variantes du même bouton, chacune écrite par un agent différent — c'est le vrai risque
de ce mode de travail, bien plus que les conflits de fichiers.

Fichiers que tu ne touches pas :
- `apps/web/package.json` et le lockfile — aucune dépendance à ajouter, le terrain les fournit
  toutes. Si tu crois en avoir besoin, c'est un signal : demande d'abord.
- `apps/web/messages/index.ts` — sauf si tu introduis un namespace NOUVEAU (rare : un par écran).
  Dans ce cas, préviens, parce que c'est le seul fichier de messages que plusieurs agents partagent.
- `apps/web/.storybook/**` — la configuration du playground est commune.
- Il n'existe volontairement AUCUN barrel `index.ts` dans `apps/web/components/` : n'en crée pas.
  Chaque composant s'importe par son chemin. Ajouter un composant ne doit modifier aucun fichier
  partagé — les stories sont découvertes par glob.

Ports. Une seule instance de chaque serveur tourne sur la machine : `npm run dev` (3100) et
Storybook (6006), lancés par Jérôme. Tu ne les lances pas. Tu vérifies ton travail avec
`npx vitest run <ton fichier>`, `npx tsc --noEmit` et `npm run build`. Si tu as réellement besoin
d'un rendu, utilise un autre port (`storybook dev -p 6007`) et arrête-le en partant.

Conventions. `apps/web/components/README.md` fait foi : nommage, anatomie d'un composant, règles
SEO/sémantique, i18n, accessibilité, responsive, et la liste des états limites à couvrir en story.
Lis-le avant d'écrire, il tient en cinq minutes et il a été écrit pour éviter que chaque agent
invente sa propre convention.

Vérifie avant de rendre : `npx vitest run` (dont messages/parity.test.ts, qui échoue si une clé
n'existe que dans une langue), `npx tsc --noEmit`, et le rendu de tes stories aux gabarits Mobile
390 et Desktop 1280.
```

### Découpage en vagues (2026-09-01)

⚠️ **Ce découpage n'a été suivi tel quel que jusqu'à la vague 2.** Les vagues réellement exécutées
sont allées jusqu'à la vague 8 (`prompts/vague3-*.md` à `vague8-*.md`, plus `relais-B-*.md` et
`suite-*.md`) sur un découpage différent de celui planifié ici pour la vague 2 — la table ci-dessous
documente le PLAN d'origine, pas l'exécution réelle. Historique complet de ce qui a été fait à
chaque lot : `docs/journal/2026-09.md`.

Le risque n'est pas le conflit de fichier, c'est **deux agents qui créent le même atome** sous deux
noms. D'où un ordre, pas un simple partage :

- **Vague 1 — les atomes partagés, DEUX agents en parallèle.** `PageShell`, `Title` (niveau en
  prop), `BackLink`, `Price`, `TypeBadge`, `Image`. Livrée (`a21fe61`) — les prompts d'origine
  (prompts vague1-agent-A et -B) sont partis avec `prompts/` (git rm le 2026-09-07, contenu
  couvert par le journal) ; `git show a21fe61:prompts/vague1-agent-A.md` les retrouve au besoin.

  ⚠️ **Cette vague était planifiée séquentielle** (« tout le monde en dépend, goulot assumé »).
  Révisé le 2026-09-01 à la demande de Jérôme, et ce n'est tenable que parce que trois conditions
  sont réunies — si l'une saute, on revient à un seul agent :

  | Agent | Atomes | Ce qui les lie |
  |---|---|---|
  | A | `PageShell`, `Title`, `BackLink` | sémantique du document : landmarks, niveaux de titre, navigation localisée |
  | B | `Price`, `TypeBadge`, `Image` | affichage d'une valeur : montant, type, visuel |

  1. **Les six atomes ne dépendent d'aucun autre** — vérifié, aucun n'en consomme un second.
  2. **Aucun ne traduit** (ils reçoivent leurs libellés), donc aucun ne touche `messages/`, qui est
     le seul fichier de messages réellement partagé.
  3. ⚠️ **Aucun agent ne migre les pages existantes.** C'est la condition décisive : `page.tsx` a
     besoin d'atomes des DEUX périmètres, donc la migration est le seul vrai point de collision.
     Elle est faite après, par le coordinateur, en une passe.

  Le risque résiduel n'est pas le conflit de fichier, c'est la **divergence de conception** : deux
  agents qui inventent deux façons d'exposer `testId` ou de nommer une variante. La parade est dans
  les prompts : les six signatures sont **écrites à l'avance par le coordinateur**, les agents
  implémentent au lieu de concevoir.
- **Vague 2 — molecules et organisms, en parallèle, une verticale par agent.** Les frontières
  coïncident avec les namespaces i18n existants, qui découpent déjà l'app par écran :

  | Agent | Dossier / périmètre | Namespace i18n |
  |---|---|---|
  | A | Coquille : `SiteHeader`, `SiteFooter`, `LanguageSwitcher`, `CartButton` | `Chrome` (nouveau) |
  | B | Catalogue : `ProductCard`, `CatalogFilters`, `EmptyState` | `HomePage` |
  | C | Fiche : `PhotoStrip`, `PriceBlock`, `FactsList`, `EstablishmentBlock` | `ProductPage`, `EstablishmentPage` |
  | D | Commande : `CartSummary`, `OrderCard` | `CheckoutPage`, `AccountOrdersPage` |

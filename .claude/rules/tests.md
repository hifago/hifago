---
paths:
  - "**/*.{spec,test}.{ts,tsx}"
  - "**/tests/**"
  - "**/packages/e2e-support/**"
---

# Règles de test — chargées quand on écrit ou lance un test

Les choix d'outils sont toujours chargés (`CLAUDE.md` §6 : Playwright, Vitest, jamais pgTAP pour
une concurrence, stack locale). Ce fichier porte la proportionnalité et les pièges vérifiés.
Règle d'échappement : au-delà de 100 lignes, le piège le plus ancien part au journal avec un lien.

## Proportionnalité — le palier le plus léger qui prouve le comportement

- **Rien** (build/typecheck/lint suffisent) : affichage pur, sans état dérivé ni logique.
- **Composant** (Vitest + `@testing-library/react`, `*.test.tsx` à côté du composant) : logique de
  rendu/état contenue dans un composant — validation de formulaire, calcul affiché, rendu
  conditionnel selon props.
- **E2E** (Playwright, `*.spec.ts`) : parcours multi-écrans, vraie session, aller-retour réseau/DB
  à prouver bout-en-bout. Auth programmatique (API REST, `storageState.json` par rôle), TOTP admin
  via `generateTotp` (`packages/e2e-support/src/mfa.ts`, sans dépendance) — jamais le vrai écran
  Google, jamais un vrai téléphone.
- **CRUD simple** : exactement **1** e2e chemin heureux ; les variantes vont en test composant.
- Pendant le développement : `/hifago-test <fichier(s) touché(s)>`, pas la suite complète.
- Un test vert ne prouve rien s'il passe aussi quand la règle est cassée : quand c'est possible,
  vérifier par **mutation** (casser la règle → le test rougit) et le dire dans le journal.

## Sélecteurs HeroUI v3 (Playwright) — helpers dans `packages/e2e-support`

- `Select` : le trigger est `role="button"` + `aria-haspopup="listbox"`, jamais `role="combobox"`.
  Cibler par testid, sinon par rôle `button` scopé.
- Le `<select>` natif caché contient TOUJOURS le texte de toutes les options : `toContainText` sur
  le composant entier matche n'importe quoi. Scoper à `[data-slot="select-value"]` —
  helper `selectValue()`.
- `Switch` : le vrai `<input role="switch">` est masqué dans un `<label>` react-aria —
  `toBeChecked()` cible `.locator("input")`, clic en `{ force: true }` — helpers
  `switchInput()`/`toggleSwitch()`.
- `Checkbox` : cliquer le wrapper racine, même en `{ force: true }`, **laisse l'état inchangé sans
  erreur** — seul `.locator("input")` fonctionne — helpers `checkboxInput()`/`toggleCheckbox()`.
  Toujours affirmer l'état obtenu côté serveur après coup.
- `ComboBox` : cliquer une option d'une liste non filtrée committe de façon intermittente. Taper la
  requête d'abord (`fill()` puis `getByRole("option", { name })`) — fiable à chaque run.
- Écran client-heavy après une navigation client-side : la première interaction peut atteindre le
  DOM avant que React n'ait attaché ses gestionnaires (valeur perdue, `<Link>` inerte, aucune
  erreur). `await page.waitForLoadState("networkidle")` après tout `page.goto`/clic de navigation
  vers un écran client conséquent.
- Le modifier CSS « nuit pleine » de react-day-picker est sur le `<td>`, pas sur le `<button>`.
- Un état transitoire (`order-success`) peut être remplacé par une redirection mockée avant que
  Playwright ne l'observe (« navigated to … » dans l'erreur) : `page.waitForURL(redirectUrl)`.

## Environnement de test

- Tout test automatisé du connecteur LobbyPMS passe par le serveur de fixtures local
  (`packages/e2e-support/src/pmsFixtureServer.ts`, `tests/pms-integration/`) — aucun sandbox
  Lobby n'existe. ⚠️ Une fixture plus complaisante que le vrai service ne teste rien : elle honore
  `end_date` INCLUSIF comme Lobby (`endDateInclusive: true` par défaut) et répond dans le corps,
  pas seulement en 200.
- Le nettoyage e2e partagé (`resetAvailability`, `packages/e2e-support/src/db.ts`) doit purger
  toute table portant une FK vers `orders`/`order_lines` (`payments`, `ledger_entries`,
  `pms_reconciliation_entries`, `availability_blocks`) — vérifier `pg_constraint` avant d'ajouter
  une table liée.
- **Des échecs sur des écrans hors du périmètre de la tâche** pendant qu'une autre session tourne =
  instabilité du dev server partagé (Turbopack, ports 3100/3101) ou de la base locale, pas une
  régression. À isoler via `next build` + `next start -p <port dédié>` avant de conclure.
- Les tests qui créent une invitation admin partagent un compte TOTP seedé : `mode: "serial"`
  (contention constatée à 4 workers). Ne jamais sélectionner un enregistrement seedé partagé par son
  nom affiché — créer une fixture dédiée (`AGENTS-PARALLELES.md` point 5).

## Fuseau horaire — un test qui ne force pas un troisième fuseau ne prouve rien

La machine de dev est en `America/Bogota`, Vercel en UTC : un test doit poser explicitement un
autre fuseau (`process.env.TZ = "Europe/Paris"`, cf. `LodgingReservationForm.timezone.test.tsx`).
`timezoneId` de `playwright.config.ts` ne couvre que le navigateur — le runner Node et le serveur
Next gardent le leur ; les deux gestes sont nécessaires. Les helpers de date de
`packages/e2e-support` ne recalculent jamais « aujourd'hui » comme le code testé (les deux côtés se
trompaient ensemble le 2026-08-28). Garde-fous à ne pas retirer : `eslint.rules.mjs`,
`scripts/check-timezone.sh`, `packages/domain/src/time/` comme unique échappatoire.

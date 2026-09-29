---
id: specs-vue-referent-restreinte
titre: "Vue référent restreinte — pas d'établissement/mis reservas, liste des ventes attribuées"
theme: specs
public: [ia, dev, jerome]
langue: fr
statut: implemente
reste: Validé par Jérôme le 2026-08-20.
maj: 2026-08-20
resume: >
  Ferme "Mi establecimiento y actividades" et "Mis reservas" pour un référent pur (aucune capacité
  operator) — nav + garde serveur sur les 3 layouts concernés — et enrichit /partner/commissions
  (déjà la liste des ventes attribuées à son code) avec établissement, client et pourcentage.
mots_cles: [référent, referrer, capacités, nav socio, commissions, ledger_entries]
repond_a:
  - "Qu'est-ce qu'un référent pur peut voir dans le portail socio ?"
  - "Pourquoi /partner/establishment et /partner/reservations sont-ils fermés à certains comptes ?"
  - "Où voir la liste des ventes attribuées à un code de parrainage, avec établissement/client/% ?"
---

# Vue référent restreinte

> **Cible stack** : hifago. Suite directe de la refonte des statuts du 2026-08-20 (`partner_capabilities`
> à 2 valeurs) — pas un numéro de feature de build séparé, périmètre couvert entièrement par ce
> document.

## Sommaire et statut

| # | Section | Statut |
|---|---|---|
| 0 | **Contrat compact** | validé |
| 1 | Contexte et problème | validé |
| 2 | Portée | validé |
| 3 | Décisions retenues | validé |
| 4 | Parcours cible | validé |
| 5 | Écran(s) | validé |
| 10 | Décisions tranchées / points ouverts | validé |
| 11 | Annexe — traçabilité code→règle | validé |
| 12 | Documents liés | validé |

---

## 0. Contrat compact (pour coder — lire seul, sans le reste)

### Endpoints / RPC

Aucun — aucune nouvelle RPC, aucune migration. Uniquement des Server Components/layouts (contrôle
d'accès) et une requête `.select()` étendue (colonnes déjà existantes).

### Modèle de données (delta)

Aucun. `order_lines.holder_name`/`order_lines.referrer_pct`/`establishments.name` existent déjà
(features 9/11/12, spec 19) — seulement jamais sélectionnées par `commissions/page.tsx` avant ce
lot.

### Invariants

- Un référent pur (aucune ligne `partner_capabilities.role = 'operator'`, quel que soit le statut
  des lignes qu'il a) n'atteint jamais `/partner/establishment` ni `/partner/reservations`, que ce
  soit via la nav ou une URL tapée directement.
- Un opérateur suspendu (capacité `operator` avec `status='suspended'`) garde l'accès à ces deux
  écrans — la fermeture est scopée au rôle, jamais à son statut (cf. §3).
- Un admin (`is_admin(uid)`) n'est jamais concerné par cette fermeture (aucun `partner_id`, même
  raisonnement que `requirePartnerOrAdmin` déjà en place).
- `/partner/commissions` reste accessible à toute capacité `referrer`, active ou suspendue —
  inchangé par ce lot (déjà le cas).
- Aucun point d'entrée self-service vers "devenir prestataire" n'est ajouté pour un référent pur
  (décision explicite, cf. §3 — divergence assumée avec la v1 legacy).

### Cas limites

- Compte avec capacités `operator` ET `referrer` → nav complète inchangée (6 liens), accès
  inchangé aux 2 écrans.
- Compte sans aucune capacité (inscription libre pas encore rattachée) → déjà redirigé plus haut
  par `requirePartnerOrAdmin` (`fallbackPath="/partner"` par défaut), ce lot ne change rien ici.
- Ligne `ledger_entries` dont `order_line` a été supprimée/inaccessible (ne devrait jamais arriver,
  FK non nullable) → `establishmentName`/`holderName` retombent sur `"—"`/`0` comme les colonnes
  déjà existantes du même mapping (`productName`, `totalCop`).

### Fichiers touchés

- `apps/admin/lib/agenda/activeOperatorEstablishments.ts` — nouveau `hasOperatorCapability()`.
- `apps/admin/app/partner/(app)/nav-items.ts` — `NAV_ITEMS` (const) → `getNavItems(hasOperatorCapability)`.
- `apps/admin/app/partner/(app)/PartnerNav.tsx` (supprimé le 2026-08-20 avec `PartnerMobileNav.tsx`, fusionnés dans `apps/admin/app/partner/(app)/PartnerAppNav.tsx`) — prop `hasOperatorCapability`.
- `apps/admin/app/partner/(app)/layout.tsx` — calcule la capacité, la transmet aux 2 navs.
- `apps/admin/app/partner/(app)/establishment/layout.tsx`, `products/layout.tsx`,
  `reservations/layout.tsx` — garde serveur ajoutée après `requirePartnerOrAdmin`.
- `apps/admin/app/partner/(app)/commissions/page.tsx`, `CommissionsTable.tsx` — colonnes
  établissement/client/%, puis filtres date/état + migration DataList (addendum ci-dessous).
- `apps/admin/app/partner/(app)/commissions/commissionStateLabels.ts` (nouveau) — vocabulaire
  `ledger_entries.status`, partagé entre le filtre "Estado", les badges de la table et la fiche
  détail.
- `apps/admin/app/partner/(app)/commissions/[id]/page.tsx` (nouveau) — fiche détail minimale,
  requise par le lien de ligne par défaut de `DataList`.
- `apps/admin/lib/lists/filters.ts` — `COMMISSIONS_FILTER_DEFINITIONS`/`COMMISSIONS_FILTERS`.
- `apps/admin/lib/lists/sortable-columns.ts` — `COMMISSIONS_SORT_WHITELIST`/`COMMISSIONS_DEFAULT_SORT`.
- `apps/admin/e2e/partner-referrer-restricted-view.spec.ts` (nouveau),
  `apps/admin/e2e/partner-commissions.spec.ts` (assertions étendues : colonnes, filtre, fiche
  détail), `apps/admin/e2e/partner-qr-tool.spec.ts` (bug préexistant non lié corrigé en marge, §10).

### Addendum — filtres date/état + migration DataList sur `/partner/commissions` (même jour)

Demande immédiate après livraison : filtrer la liste par date et par état. **1re tentative** :
`ServerFilters` (le formulaire de filtre interne de `DataList`, exporté séparément par
`packages/ui`) posé au-dessus du `SortablePaginatedTable` existant, sans migrer vers `DataList` —
motif à l'époque : `DataList` impose un lien de ligne vers `${basePath}/${id}` sans échappatoire, et
cette liste n'avait pas de fiche détail à pointer. **Jérôme a tranché explicitement : utiliser
`DataList`** (cohérence avec les 13 autres listes admin+socio, spec 10) — repli abandonné.
Migration complète effectuée : `resolveListParams` (pagination/tri/filtres serveur, `order_lines!
inner` pour filtrer sur la colonne embarquée `date`), totaux recalculés via une requête séparée
(agrégée sur TOUTES les entrées filtrées, pas seulement la page affichée — sinon un total mentirait
dès la page 2), et nouvelle fiche détail `[id]/page.tsx` (champs identiques à la ligne de liste,
aucune donnée supplémentaire — nécessaire uniquement parce que `DataList` l'exige). Action "Ver
detalle" explicite ajoutée en plus du lien de ligne implicite (même correctif déjà appliqué à
`TagsList.tsx` : le lien furtif par défaut s'est avéré peu fiable au clic Playwright, jamais
retiré mais jamais le seul chemin non plus). `next build` réel vérifié (pas seulement typecheck) —
piège `hifago/CLAUDE.md` §11.16 (tout import `@hifago/ui` dans un Server Component plante le build
depuis l'ajout d'`AppNavShell` au barrel) : la fiche détail n'importe que `@hifago/domain`, jamais
`@hifago/ui` (état affiché en texte brut, pas de `Chip`).

## 1. Contexte et problème

Le portail socio affiche aujourd'hui la même nav à tout compte partenaire (`nav-items.ts`, liste
statique), qu'il porte une capacité `operator`, `referrer`, ou les deux. Un référent pur atteint
donc "Mi establecimiento y actividades" et "Mis reservas" — des écrans qui n'ont structurellement
rien à lui montrer (aucune ligne `establishments`/`products` à son `partner_id`, RLS déjà
suffisante) mais qui n'ont aucune raison de lui être proposés. Le cahier des charges socio
(`docs/02-cahier-des-charges-socio.md` §3a/§3c, validé le 2026-08-11) le dit déjà explicitement —
un référent "ne peut pas voir d'établissement" — mais §3d ("chaque endpoint revalide la capacité,
jamais un simple masquage d'onglet") n'a jamais été implémenté : aucun des 3 layouts concernés ne
vérifie de rôle, seulement une garde d'authentification générique (`requirePartnerOrAdmin`).

En contrepartie, `/partner/commissions` est déjà, dans les faits, la liste des ventes attribuées au
code du référent (`ledger_entries` filtré `beneficiary_type='referrer'` + `referrer_partner_id`) —
il ne lui manque que 3 colonnes déjà présentes plus haut dans la chaîne de requête et jamais
sélectionnées.

## 2. Portée

**In** : fermeture nav + garde serveur des 2 écrans côté établissement/opérateur pour un référent
pur ; enrichissement de `/partner/commissions` (établissement, client, %).

**Out** : tout changement de RPC/RLS (aucun trou de sécurité à combler, cf. §3) ; un CTA
d'auto-évolution référent→prestataire façon v1 (décision explicite, §3) ; renommage/refonte de
l'écran `/partner/commissions` lui-même — il gagne 3 colonnes, il ne change pas de nature.

## 3. Décisions retenues

- **Fermeture complète, pas de CTA d'auto-évolution** (Jérôme, 2026-08-20). La v1 legacy
  (`partnerPortalService.js`, `docs/5-conception/roles-composables.md`) proposait un CTA "Quiero
  ofrecer una experiencia" menant un référent pur à proposer un établissement (auto-évolution
  validée ensuite par l'admin). Ce lot ne le reprend pas : devenir prestataire ne se fait plus que
  par octroi admin direct (`grant_capability`, déjà existant). Divergence assumée, pas un oubli.
- **Prédicat scopé au rôle, jamais au statut** — un opérateur *suspendu* garde l'accès à ses écrans
  (il doit pouvoir comprendre sa situation), ce n'est pas un référent pur. Distinct du prédicat déjà
  existant `selectActiveOperatorEstablishmentIds` (actif seulement), qui lui scope des DONNÉES
  (l'agenda), pas un ACCÈS — les deux prédicats coexistent dans le même fichier, avec des usages
  différents documentés en commentaire.
- **Pas de correctif RLS/RPC** — `establishments_select`/`products_select_own` filtrent déjà par
  `partner_id` ; un référent pur n'a par construction aucune ligne à lui. La fermeture est un choix
  produit (ne pas montrer un écran vide), pas un correctif de sécurité.
- **Aucune migration** — les 3 colonnes ajoutées à `/partner/commissions` existent déjà
  (`order_lines.holder_name`/`referrer_pct`, `establishments.name`), simplement jamais
  sélectionnées jusqu'ici.

## 4. Parcours cible

1. Un référent pur se connecte, atterrit sur `/partner` (agenda vide, pas de capacité operator
   active → pas d'agenda affiché, comportement déjà existant).
2. Sa nav (desktop et mobile) ne montre que : Inicio, Mis comisiones, Mi enlace y QR, Mi cuenta.
3. S'il tape directement `/partner/establishment` ou `/partner/reservations` dans la barre
   d'adresse, il est redirigé vers `/partner` (garde serveur, jamais un simple masquage client).
4. Sur `/partner/commissions`, il voit chaque vente attribuée à son code : date de prestation,
   nom de l'activité, **nom de l'établissement**, **nom du client**, montant total, **pourcentage
   qui lui est reversé**, montant de sa commission, état de paiement (Estimada/Ganada, por
   pagar/Pagada/Reasignada al prestador/Excluida).
5. Un compte operator+referrer ne voit aucun changement — nav complète, accès inchangé aux 2
   écrans, mêmes colonnes en plus sur `/partner/commissions`.

## 5. Écran(s)

**Nav socio** (`PartnerNav.tsx`/`PartnerMobileNav.tsx`) — 4 liens au lieu de 6 pour un référent
pur ; aucun changement visuel pour les autres comptes.

**`/partner/commissions`** — mêmes 4 totaux agrégés en tête (inchangés), table étendue :
`Fecha | Producto | Establecimiento | Cliente | Monto total | % referido | Comisión referente | Estado`
(`Establecimiento` juste après `Producto`, `Cliente` avant `Monto total`, `% referido` avant la
commission déjà en COP dont il est la lecture directe).

## 10. Décisions tranchées / points ouverts

- **Tranché** : pas de CTA d'auto-évolution (§3).
- **Tranché** : prédicat scopé au rôle seul, pas au statut (§3).
- **Ouvert, hors périmètre de ce lot** : `submit_establishment_creation_proposal`/
  `submit_product_creation_proposal` restent atteignables par un appel RPC direct (hors UI) sans
  vérification de rôle — un référent pur pourrait toujours, en contournant la garde UI, soumettre
  une proposition qu'un admin devrait alors rejeter manuellement. Non corrigé ici (chokepoint RPC
  partagé avec les parcours operator légitimes, changement plus large qu'une fermeture de vue) —
  signalé pour arbitrage futur si jugé nécessaire.

## 11. Annexe — traçabilité code→règle

| Section | Fichiers sources |
|---|---|
| §3 rôle vs statut | `apps/admin/lib/agenda/activeOperatorEstablishments.ts` (`selectActiveOperatorEstablishmentIds` vs `hasOperatorCapability`) |
| §4 garde serveur | `apps/admin/app/partner/(app)/establishment/layout.tsx`, `products/layout.tsx`, `reservations/layout.tsx` |
| §4 nav | `apps/admin/app/partner/(app)/nav-items.ts`, `layout.tsx` |
| §5 commissions | `apps/admin/app/partner/(app)/commissions/page.tsx`, `CommissionsTable.tsx` |
| v1 legacy comparée (§3) | `docs/5-conception/roles-composables.md`, `src/services/partnerPortalService.js` (dépôt racine, hors hifago/) |

## 12. Documents liés

`docs/02-cahier-des-charges-socio.md` §3a/§3c/§3d · `docs/specs/19-paiement-mercadopago-acompte-ledger.md`
(moteur 17/10/7, `ledger_entries`) · `docs/specs/20-agenda-reservations-socio.md` (page d'accueil
socio, `selectActiveOperatorEstablishmentIds`) · `docs/journal/2026-08.md` (entrée 2026-08-20
"nettoyage complet des statuts").

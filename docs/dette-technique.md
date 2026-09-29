---
id: dette-technique
titre: "Dette technique et QA/UI connue — hifago"
theme: journal
statut: vivant
langue: fr
maj: 2026-09-22
resume: >
  Dette signalée et non corrigée du chantier hifago — technique, puis QA/UI mineure. Sortie de
  docs/backlog.md le 2026-09-08 : ce fichier-là plafonne à 60 lignes et prescrit lui-même qu'un
  groupe entier parte en ticket séparé quand il déborde.
mots_cles: [dette, technique, qa, ui, connu, non-corrige, hifago]
repond_a:
  - "Quelle dette est connue et assumée ?"
  - "Ce défaut est-il déjà signalé ou est-ce une découverte ?"
---
# Dette technique et QA/UI connue

> **Règles pour l'IA** : même discipline que `docs/backlog.md` — 1 ligne par point, le récit va au
> journal. Ce fichier porte ce qui est CONNU, ASSUMÉ et NON CORRIGÉ ; les points qui attendent une
> décision de Jérôme restent au backlog, qui est le fichier court qu'on lit en premier.
> ⚠️ Un point trouvé ici n'est pas une découverte : ne pas le re-diagnostiquer, ne pas le rouvrir
> comme s'il était neuf.

## Dette technique signalée, non corrigée
- Spec 19 Tranche 2 (remboursement Mercado Pago) non commencée. ⚠️ « Page de retour paiement dédiée toujours absente » RETIRÉ le 2026-09-10 : livrée par la spec 33 (`/reserva/<jeton>`). Ce point avait cessé d'être une dette assumée pour devenir un défaut réel — le repli « réutilise l'écran checkout » était devenu une PAGE BLANCHE le jour où la spec 32 a fait vider `cart_items` par `create_order`, sans que rien ne le relise.
- ~~**`SiteToaster` n'est monté nulle part dans `apps/web`**~~ — **REFERMÉ le 2026-09-13** (spec 28
  Tranche 3) : monté en frère de `{children}` dans `app/[locale]/layout.tsx`. `toast.danger`/
  `toast.success` de `ResendConfirmationForm.tsx`/`useAddToCart.ts` sont désormais visibles.
  `GoogleButton.tsx`, écrit avant ce correctif, continue de rendre son échec en ligne — pas repris,
  hors périmètre de cette tranche.
- Vitrine (`apps/web`) : polices Geist non appliquées (`--font-geist-*` du layout vs `--font-sans`/`--font-mono` consommés par HeroUI).
- La garde de `(cuenta)` redirige vers `/entrar` SANS `?next=` : un layout serveur ne connaît pas le chemin courant, et la « ligne dans `proxy.ts` » annoncée par la spec 27 §5 n'en est pas une (un middleware ne peut pas poser d'en-tête de REQUÊTE sur une réponse construite par `intlMiddleware`). Sans effet tant qu'il n'existe qu'un écran de compte — vrai déclencheur : le lot qui ajoute `/cuenta` et `/cuenta/perfil`.
- Remplacer une image du catalogue laisse l'ancien objet dans le bucket `catalog-media` — vrai pour `product_media`/`establishment_media` depuis la spec 04, et vrai pour l'image de catégorie que la spec 29 ajoute. À traiter globalement ou pas du tout : le corriger pour une seule entité créerait une incohérence de plus.
- Bricoles signalées, non reprises : `createTtlCache` ne purge jamais les entrées expirées (Map non bornée) · `addDaysIso` (`bogotaDates.ts:56`) porte le débordement d'année déjà corrigé ailleurs · `partner-agenda.spec.ts` ne nettoie pas derrière lui et se sabote après plusieurs runs · sonde à un appel LobbyPMS sur `start_date == end_date` jamais vérifiée.
- Les quatre cahiers (00-03) portent leurs écarts en en-tête « Écarts connus » plutôt que dans leurs sections : réécrire les sections elles-mêmes est un geste de fond à valider avec Jérôme, section par section (statut de validation à reprendre).
- **§0 de specs non conformes, tolérées nommément** (2026-09-28, `EXEMPTIONS_CONTRAT` dans `scripts/docs_index.js`) : sans §0 — 01-05, 07, 08, 25, 38 ; §0 de plus de 150 lignes — 17 (241), 19 (370), 23, 28, 29, 30, 33. La carte `docs/INDEX.md` les montre (« sans §0 », plage longue) et `docs:check` échoue dès qu'une exemption devient inutile : à resserrer à la prochaine réouverture de chaque spec, pas en passe dédiée. Même traitement pour la §0 de la 32 (encore rédigée au futur, tableau « Aujourd'hui/Demain ») et celle de la 17 (volet hôtel seulement barré d'un avertissement en tête).
- **Recadrage "carrito"→"Mi viaje" (2026-09-15) : 3 restes volontairement non traités**, hors du périmètre validé par Jérôme (texte + URL + icône seulement) — `pathnames` next-intl par locale (l'anglais garde un segment espagnol, `/en/mi-viaje`, décision SEO déjà documentée) ; libellés d'exemple "Carrito"/"Añadir al carrito" dans `Button.stories.tsx`/`IconButton.stories.tsx`/`LinkButton.stories.tsx`/`IconButton.test.tsx`/`IconLink.test.tsx` (non lus par next-intl, aucun test réel n'en dépend) ; `OrderResultPage`/`AccountOrdersPage` gardent "pedido"/"reserva" (contexte d'une commande déjà créée, pas le tunnel panier visé).

- ~~**`create_order`/`modify_order_line` (branche logement, `end_date` non null) ne multiplient plus
  par `qty` depuis le correctif du 2026-08-18**~~ — **REFERMÉ le 2026-09-16** (Gabriel, confirmé) :
  migration `20260916120000_fix_lodging_price_missing_qty` restaure la multiplication dans les deux
  RPC (corps extraits par `pg_get_functiondef` depuis la définition vivante, un seul site modifié
  par fonction). pgTAP mis à jour (`date_range_booking.test.sql` : nouveau cas qty=2 avec
  `price_tiers` ; `modify_order_line.test.sql` cas L1 ; `create_order_pms_backed.test.sql` cas 4),
  suite `test:db` complète verte (hors pollution `audit_log` préexistante, sans rapport). E2E :
  `reserve-lodging-range.spec.ts` reçoit un second scénario qty=2, vert de bout en bout (fiche
  produit/panier/base cohérents à 900 000). Concurrence réelle rejouée
  (`create_order_date_range.concurrency.mjs`, 3 scénarios × 5 runs propres, y compris le scénario 2
  à qty multiples) — verrouillage/atomicité non affectés, seule l'arithmétique finale change. Front
  (`cartLineTotal.ts`, `LodgingReservationForm.tsx`) n'avait besoin d'aucun changement : déjà
  aligné, seuls ses commentaires laissaient croire à une divergence volontaire avec `create_order`
  (référence à une entrée backlog qui n'existait pas). Doc corrigée : `docs/specs/12-admin-
  alojamiento-house.md` §0 (« qty = nombre de personnes » → unités facturables). Backoffice vérifié
  séparément (investigation dédiée) : `create_manual_order_line` exclut déjà `lodging`, aucun autre
  écran admin ne recalcule de prix — rien d'autre à corriger côté `apps/admin`. Trouvé en creusant
  ce point : `create_manual_order_line` duplique à la main la logique de tarification au lieu
  d'appeler `create_order` (risque de dérive déjà présent, pas nouveau), et ne gère pas explicitement
  `evento` (gratuit ou capacité `unlimited`/`rsvp`) — échoue en erreur plutôt que de mal facturer,
  mais une réservation manuelle de ces evento reste impossible depuis l'admin. Ni l'un ni l'autre
  traité ici, signalé pour un futur lot.

- **Une commande aux prestations `fulfilled` mais `payment_status = 'unpaid'` s'annonce « aún no está pagada »** (trouvé le 2026-09-11, spec 34) — la dérivation vient de la spec 33, où elle était invisible (on arrive sur `/reserva/<jeton>` après avoir payé) ; sur l'historique du compte elle saute aux yeux. Corriger demande un libellé de plus et une décision sur ce que cet état signifie, et toucherait les DEUX écrans (`lib/orders/orderState.ts`, partagé depuis la spec 34). En production le cas devrait être rare — `expire_stale_payment_orders` reprend une commande impayée au bout de 30 minutes ; c'est surtout le seed qui le produit.

## Dette trouvée par `/simplify` le 2026-09-08
- **`server-only` n'est installé nulle part**, alors que la spec 27 §7, la spec 30 §7b et l'en-tête de `scripts/check-data-layer.sh` le décrivaient comme acquis (en-tête corrigé le 2026-09-08). Conséquence non couverte : un composant CLIENT qui importerait `lib/catalog/` embarquerait la clé anonyme et le graphe Supabase dans le bundle, sans erreur ni contrôle rouge. Décision d'une ligne — ajouter la dépendance ou non.
- ⚠️ **Secret Vault `web_app_public_url` posé dans aucun environnement** (2026-09-10, spec 33) — `apply_payment_webhook` y lit l'URL publique pour le lien « Ver tu reserva » de l'email de confirmation, même patron que `admin_app_public_url` (20260824040000). En son absence l'email part quand même, **sans le lien** (choix assumé : le client a payé, une confirmation sans lien vaut mieux que pas de confirmation). À poser dès qu'un projet préprod existe.
- **`SearchAction` JSON-LD : à décider, plus à écarter.** `lib/seo/jsonld/site.ts` l'excluait parce que « la recherche est un filtre en mémoire sans URL adressable » — faux depuis la spec 28, les critères vivent dans l'URL. Le nœud reste sans `potentialAction` par non-décision.
- **Sept `data-testid` posés le 2026-09-08 qu'aucun test n'exerce** (`indice-categorias`, `establishment-info`, `establishment-address`, `volver-al-catalogo`, `vitrina-contact-link`, `price-label-vitrina-input`, `establishment-contact-block`). Des ancres prêtes, pas du code mort — à ne pas supprimer, à consommer quand la couverture des deux fiches et de l'admin éditorial s'étendra.

## Dette trouvée par `/simplify` le 2026-09-16
- **La formule de prix d'un séjour existe en TROIS exemplaires SQL** — `create_order` (branche alojamiento), `modify_order_line` (même branche) et `create_manual_order_line` (déjà signalé le 2026-09-16 pour une autre raison). Chaque évolution tarifaire logement oblige à retrouver les N sites, ré-extraire N corps par `pg_get_functiondef` et relire N migrations de 1000 lignes — exactement la manœuvre faite le 2026-09-16, et un diff de migration entière ne laisse voir aucun oubli. Remède identifié, non appliqué (rouvre les corps de RPC anti-survente, donc test de concurrence obligatoire) : extraire `public.lodging_line_total(product_id, from, to, qty)` `stable` `set search_path=''`, à côté de `resolve_tier_price`/`resolve_date_price` qui sont déjà extraites.
- **Le prix est calculé des deux côtés de la frontière app/base, avec des entrées volontairement incomplètes côté app.** `lib/cart/cartLineTotal.ts` documente ignorer `stay_rates`, les surcharges `product_calendar` et la remise de groupe camp — « estimation assumée ». Tant que la fiche et le panier affichent un montant, tout produit portant une de ces surcharges affichera un total différent de celui débité. Remède identifié, non appliqué (architecture) : une RPC de LECTURE `quote_cart()` rendant chaque ligne avec son `total_cop` et son `acompte_cop`, réutilisant le même bloc que `create_order` — `cartLineTotal.ts` et l'export de `price_tiers` jusqu'à `getCartLines` disparaîtraient avec elle.
- ⚠️ **L'acompte affiché par `CartSummary` est fixé à 17 % en dur**, alors que `create_order` descend à 7 % (auto-parrainage), 10+7 % (référent externe) et surtout **0** pour un evento gratuit ou `payment_mode = 'on_site'`. Documenté comme une estimation, mais le cas 0 affiche un montant faux juste avant le bouton de paiement. Question de CORRECTION, pas de qualité — non traitée par `/simplify`, à passer en revue de bugs.
- **`search_catalog` bifurque sur `p.type`, là où l'app bifurque sur la FORME.** La branche « activity à créneaux » teste `p.type = 'activity' and exists(product_slot_rules)`, or `product_slot_rules` n'a aucune contrainte de type et `create_order` applique sa garde `slot_required` à TOUT produit portant des règles de créneaux : un `transport` à créneaux — structurellement possible et déjà réservable — retombe dans la branche `product_calendar`, c'est-à-dire dans le bug même que la migration du 2026-09-16 corrige. L'app a déjà l'axe correct et nommé (`resolverModoReserva`, `lib/catalog/producto.ts`). Deux taxonomies concurrentes de « comment ce produit porte ses dates », une par côté de la frontière. Arbitrage Jérôme (changement de comportement).
- **L'atome `Field` a toujours zéro consommateur** (construit avec test et stories pour absorber le triplet `TextField`+`Label`+`Input`) : 11 écrans utilisent désormais le triplet brut, dont les deux écrans de mot de passe du 2026-09-16. Il porte trois choses que les formulaires réécrivent ou perdent — `validationBehavior="aria"` (parade CLAUDE.md §11.11, remplacée à la main par `noValidate`), la prop `error` reliée par `aria-describedby`/`aria-invalid` (remplacée par un `<p role="alert">` détaché), et le bouton de révélation du mot de passe demandé le 2026-09-02.

## Dette trouvée en vérifiant la spec 28 Tranche 3, le 2026-09-13

Chacune reproduite à l'identique contre le code d'AVANT cette tranche (`git stash` + rejeu sur base
fraîche) — aucune n'est une régression de ce lot, toutes hors de son périmètre.

- ~~**`reserve-lodging-range.spec.ts` : le total du panier sur `/pago` ne compte pas les nuits.**~~
  — **REFERMÉ le 2026-09-16** (Jérôme) : `CartSummary` multiplie désormais par les nuits (et par
  `qty`, qui désigne des chambres/lits/maisons, pas des occupants) via le nouveau
  `lib/cart/cartLineTotal.ts`, réutilisant `resolveTierPrice`/`nightsInRange` de
  `lib/reservas/reservationRange.ts` — même fonctions que `LodgingReservationForm.tsx`, jamais une
  formule recopiée. `reserve-lodging-range.spec.ts:62` passe désormais au vert. A révélé un écart
  côté serveur, voir plus bas.
- **`reserve.spec.ts` (« capacité épuisée ») : une ligne de panier refusée par `create_order` ne
  porte pas `data-failed="true"`** comme l'écran de checkout est censé le marquer.
- **`cart-multi-establishment.spec.ts` (test 1) : `countOrdersByPhone` compare une chaîne exacte**,
  alors que `PhoneField` (2026-09-10) normalise en E.164 compact — un numéro de test écrit avec des
  espaces ne retrouve jamais sa commande. Aucune commande n'est perdue en réalité (vérifié en base),
  seul le test se trompe de format.- **`scripts/check-timezone.sh` est ROUGE en CI depuis le 2026-09-13** — deux migrations de ce jour
  (`20260913100000_lodging_default_availability.sql:81` et son garde PMS `20260913100100:23`)
  utilisent `current_date` nu dans un `generate_series`, là où le dépôt impose
  `public.today_in_bogota()` (`current_date` rend la date du fuseau de la SESSION, UTC sur
  Supabase). Trouvé le 2026-09-18 en lançant le script sur un lot sans rapport. Soit les corriger,
  soit les exempter NOMMÉMENT dans `est_exempte()` avec leur raison — mais pas les laisser rouges,
  sinon le garde-fou entier cesse d'être lu.
- **Trois constats de `/simplify` (2026-09-18) volontairement non appliqués**, tous réels :
  (a) les deux `tests/pms-integration/*.mjs` réécrivent un serveur de fixtures LobbyPMS que
  `packages/e2e-support/src/pmsFixtureServer.ts` sert déjà — le blocage est que `node` nu ne sait
  pas importer du `.ts` (`--experimental-strip-types` ou conversion des scripts) ;
  (b) le pipeline unités→cupos + filtre des restrictions existe en DEUX exemplaires
  (`apps/web/lib/catalog/producto.ts` et `apps/web/app/api/pms/night-availability/route.ts`) qui
  alimentent le MÊME composant dans la même session — une fonction de domaine partagée les
  réunirait ;
  (c) `invoke_pms_sync_availability` est la 5ᵉ copie octet-pour-octet du wrapper Vault +
  `net.http_post` — une `invoke_pms_function(p_name)` unique remplacerait les cinq, au prix d'une
  migration qui réécrit quatre entrées `cron.job`.

## Dette QA/UI mineure connue
les tests e2e parallèles se disputent encore les 8 places d'une section pendant une MÊME exécution (`cart-multi-establishment` passe seul, échoue en suite) — le `globalTeardown` ajouté le 2026-09-08 empêche l'accumulation ENTRE exécutions (⚠️ il ne purgeait plus rien du 2026-09-10 au 2026-09-17, `cart_items` manquant à sa liste de FK), pas la concurrence intra-suite ; il faudrait des données scopées par test · le fil d'Ariane HeroUI rend la page courante en `<span role="link" aria-disabled>` : un lecteur d'écran annonce « lien désactivé », anti-motif WAI-ARIA — `aria-current` est correct, le reste vient du socle · Palette SVAR non harmonisée avec HeroUI · pas de refetch agenda au changement de vue · e2e spec 18 (créneaux horaires) absents · tri/filtre catalogue par tag manquant · Tranche 4 spec 17, Tranche 2 specs 11/12/13 · `waitForLoadState` sur `admin-camp-booking.spec.ts` · `LocalizedTextField` lot 2 établissement · `admin-evento-vitrine.spec.ts` (`#name-es`) · sidebar admin non repliée sous `md` · activer les créneaux jetski réels via `set_product_slot_capacity` · 6 fichiers pgTAP sensibles au volume de données locales accumulées (`audit_log` non scopé) · `admin-reconciliation.spec.ts`/`admin-home-navigation.spec.ts` fragiles en exécution parallèle · échec Vitest non identifié, DEUX fois le 2026-09-07 (1 puis 2 tests), toujours dans un `npm run test` monorepo enchaîné après typecheck+lint, jamais reproduit ensuite en ~15 exécutions — nom jamais capturé, sortie non conservée · `campaign_engine.test.sql` cas 23 (« completed » une fois les cibles pending traitées) échoue seul, reproductible en isolation, aucun rapport avec `today_in_bogota()`/`search_catalog` (grep vide) — trouvé le 2026-09-15 en lançant la suite complète pour un lot sans rapport (tri des evento), cause non investiguée.

Historique complet de chaque point (comment on y est arrivé) : `docs/journal/<mois>.md`.

## Dette produit/admin déplacée du backlog le 2026-09-10

> Sortie de `docs/backlog.md` parce qu'il dépassait son plafond de 60 lignes — sa propre règle prescrit qu'un groupe entier parte plutôt que d'élaguer au hasard. **Rien n'a été supprimé.** Un point qui se trouve ici est CONNU : ne pas le re-diagnostiquer.

- **Le bucket `catalog-media` grossit sans garde-fou** (mesuré le 2026-09-08 : 37 objets `.webp` orphelins, `product_media`/`establishment_media` à 0 ligne) — `cleanup.ts` purge les lignes SQL par CASCADE, jamais les binaires. Distinct de la dette « image orpheline au remplacement » : ici c'est l'accumulation par les e2e admin, et elle ne figurait nulle part.
- **`products.check_in_time`/`check_out_time` : la RÈGLE est tranchée** (l'établissement fait seul foi, spec 30 §3.4), le NETTOYAGE non — la colonne reste éditable dans 6 fichiers d'`apps/admin` et dans le payload JSONB des propositions socio (3 chemins de modération). Un admin peut saisir un horaire qu'aucune page publique n'affichera. Lot admin à part.
- **Rien n'empêche de publier un evento sans `external_booking_url`** — sa fiche affiche alors son occurrence et AUCUN moyen de réserver : un cul-de-sac silencieux, comportement actuel préservé et nommé par la spec 30 §10.5. La garde manque côté admin.
- **L'UPDATE de `moderate_product_proposal` écrit ses colonnes INCONDITIONNELLEMENT** (constaté le 2026-09-09 en écrivant son test) — une proposition dont le payload ne porte pas une clé EFFACE la colonne correspondante à l'approbation, jusqu'à violer une contrainte (`products_price_cop_required_unless_vitrine` déclenchée en réel). Seules `external_booking_url`/`price_label` en sont exemptées (forme `case when payload ? 'clé'`, migration 20260909180000) ; les ~15 autres colonnes gardent le défaut.
- **Un evento reste le seul type dont l'URL de vitrine n'est pas modifiable** — ni côté admin (bloc `isEvento ? {} : …` de product-form.tsx et productEditPayload.ts), ni donc côté socio. Le cas NON-evento a été refermé le 2026-09-09 (whitelist SQL élargie, migration 20260909180000) ; la whitelist accepte désormais ces clés pour TOUS les types, il ne reste que le geste d'écran.
- **Rien ne teste la création admin d'un produit** — ni `buildProductCreationPayload` ni `product-form.tsx` n'ont de test unitaire, et la seule couverture réelle (`admin-product-create.spec.ts`) est dans la suite e2e en pause. Le correctif vitrine du 2026-09-09 n'est donc protégé par rien (§11.20).
- ⚠️ **La suite pgTAP est INEXPLOITABLE après une exécution e2e** (constaté deux fois le 2026-09-08) : six fichiers comptent `audit_log` en absolu, et tout e2e admin y écrit. `npm run db:setup` la referme. Ce n'est pas une régression — c'est la même dette que la ligne « 6 fichiers pgTAP sensibles au volume » ci-dessous, mais sa CONSÉQUENCE méritait d'être nommée : un chiffre pgTAP mesuré après des e2e ne veut rien dire.
- ~~`docs/specs/29-vitrine-listings-et-index-de-categories.md` est PÉRIMÉE depuis le 2026-09-14~~ —
  **corrigée le 2026-09-21/22** : §0 (contrat compact), §2, §5a/c, §6d, §7a/d réécrits ou annotés
  `⚠️ Périmé`, nouvelle section §10quinquies documentant le remplacement en détail (signature de
  `search_catalog_categorias`, `POR_CATEGORIA = 6`, fichiers créés/supprimés/modifiés). Deux
  constats faits en la corrigeant, pas seulement en la relisant : l'image de catégorie n'est
  affichée NULLE PART dans le code actuel (ni index ni page de catégorie, pas seulement absente de
  l'index comme on le pensait) ; les deux choix produit non validés par Jérôme (masquage
  image/texte sur l'index, `POR_CATEGORIA` arbitraire) restent ouverts, cf. backlog.
- ⚠️ **`Migas` rend des `<a href>` NATIFS, donc le fil d'Ariane provoque une navigation COMPLÈTE** — il viole l'invariant 9 de la spec 27 depuis sa création (`Breadcrumbs.Item` étend le `Link` de react-aria, pas celui de `@/i18n/navigation`). Invisible sur un listing, ~~sérieux sur une fiche : **cliquer le fil vide le panier**, tenu en mémoire~~ — ⚠️ **cette conséquence est PÉRIMÉE depuis la spec 32** (2026-09-10) : le panier vit en base, une navigation complète ne le perd plus. Le défaut lui-même reste réel (une navigation complète là où l'app devrait rester client-side), mais il est redevenu un point de performance, pas une perte de données — requalifié le 2026-09-10 en écrivant la spec 33. Deux corrections possibles, aucune triviale : un `RouterProvider` react-aria (ABSENT de la version installée, vérifié le 2026-09-08) ou le panier persistant (cahier §2b.6, déjà décidé, spec à écrire). En attendant, la fiche produit garde son lien « ← Volver al catálogo », qui est le seul lien client-side vers l'accueil — ne pas le supprimer en le prenant pour un doublon.

## Dette trouvée en livrant le transport informatif, le 2026-09-16

- **`products.address`/`lat`/`lon` sont écrivables depuis le 2026-08-16 et n'ont JAMAIS été affichés** sur la vitrine pour `activity` et `lodging` : `COLUMNAS_PRODUCTO` (`apps/web/lib/catalog/producto.ts`) ne les lit pas, et le type `FichaProducto` ne les porte pas. Un admin remplit « Dirección » depuis quatre mois ; aucun visiteur ne l'a jamais vue. Le transport en est SORTI le 2026-09-16 (colonnes dédiées `transport_departure_*`/`transport_arrival_*`, réellement affichées), donc ce lot ne répare ce trou que pour lui — les deux autres types restent concernés. Le geste manquant est symétrique de ce qui a été fait pour le transport (3 colonnes à lire, un champ de type, un bloc de rendu), il n'a juste jamais été demandé.
- **La fenêtre de départs d'un transport n'apparaît ni sur le voucher ni dans le récapitulatif de commande** (`order_for_client_jsonb`) : le voyageur voit « à quelle heure » sur la fiche AVANT d'acheter, plus jamais après. L'extension serait cohérente (cette RPC expose déjà `duration_days` et `slot_start_time`), mais ses assertions pgTAP indexent `lines,0` et son contrat est partagé par deux écrans — hors périmètre du lot, jamais demandé par Jérôme.
- **Un service de nuit à cheval sur minuit est structurellement impossible** (`products_transport_departure_order` exige `last >= first`) : un bus 22:00 → 02:00 ne peut pas être saisi. Aucun transport réel n'est dans ce cas au 2026-09-16. À la première demande, le remède n'est PAS de retirer le CHECK (il deviendrait vacuously vrai et ne protégerait plus rien) mais d'ouvrir une seconde plage — donc de rouvrir la décision « un seul intervalle » de Jérôme.
- ⚠️ **Les deux tests anti-fuseau du transport n'attrapent que les `Date` qui DÉCALENT** (mesuré par mutation le 2026-09-16, les deux sens testés) : un aller-retour neutre `new Date(\`…T${h}\`).toTimeString()` reste vert, parce qu'il ne produit aucun décalage observable. C'est le comportement correct, mais ne pas les croire capables de bannir tout `new Date` d'un chemin d'heure — ils bannissent les conséquences, pas la construction. Même limite pour les trois autres découpages `"HH:MM:SS"` du repo (`toTimeInputValue` ×2 côté admin, `toHHMM` dans `SlotReservationForm`), non couverts.

## Dette trouvée en passant le transport en « contact seulement », le 2026-09-17

- **`products.unit` (`per_person`/`per_house`) n'est PAS saisissable pour un transport** — mesuré en e2e le 2026-09-17 : le champ est lodging-only dans `product-type-fields.tsx`, donc un transport créé depuis l'admin n'a JAMAIS d'unité de prix et son prix s'affiche nu (« 210.000 COP »). Or c'est précisément l'information que le texte legacy insistait à donner : « El precio es **por pasajero, ida y vuelta** » (Aeroturex) contre « **por trayecto (solo ida)** y por vehículo, hasta 4 o 7 pasajeros » (Gotravel) — deux modèles de prix qu'on ne peut pas distinguer aujourd'hui. Les 6 mocks, eux, renseignent `unit` à la main, ce qui masque le trou en local. Le geste manquant est d'ajouter `unit` au gating transport (le suffixe, lui, s'affiche déjà correctement en mode vitrine depuis ce lot).
- **Le bouton de contact d'un transport s'appelle « Reservar »** (clé `reserveExternal`, partagée avec les eventos en vitrine) alors qu'il ouvre WhatsApp — le pied de page dit « Escríbenos por WhatsApp » pour la même action. Pas corrigé : la clé est partagée par toutes les vitrines, changer son libellé est une décision d'écriture, pas un correctif local.
- **La mention « Una cancelación o una ausencia de tu parte nunca es reembolsada » s'affiche sous le bouton de contact** d'un produit qu'on ne peut pas réserver en ligne. Comportement préexistant de toutes les vitrines, rendu visible par le passage des transports en vitrine — à trancher avec le libellé ci-dessus.

## Dette trouvée en découpant `product-type-fields.tsx`, le 2026-09-17

- **Un `transport` affiche deux champs « Precio (COP) »** — le champ générique
  (`!isEvento && !hasLocationAndTags`) ET celui de `PriceTiersEditor` (`hasPriceQtyFields`) se
  rendent tous les deux, tous deux liés à `state.priceCop`. Régression du 2026-09-16 : quand
  `hasLocationAndTags` a perdu `isTransport` (`transport_departure_*` remplace le trio générique
  adresse), la condition `!hasLocationAndTags` du champ générique est redevenue vraie pour ce type
  sans que quiconque la corrige en miroir. Pas de perte de donnée (même state), juste un doublon
  visuel. Trouvé en extrayant `product-type-fields/index.tsx` en sous-composants (revue de
  packaging admin) — préservé à l'identique dans l'extraction (pure, zéro changement de
  comportement), documenté en tête du fichier hôte plutôt que corrigé en silence.

## Data/config en écart, déplacée du backlog le 2026-09-19
Même motif que les déplacements des 2026-09-08 et 2026-09-10 : `docs/backlog.md` avait atteint
60/60 lignes, son propre plafond, et la règle du projet (mettre le backlog à jour en fin de
session) allait donc rendre la CI rouge au prochain ajout. Ces points ne sont pas des
arbitrages — rien n'y attend une décision de Jérôme.

- `alojamiento-pms-backed-demo` reste `sellable` en préprod alors qu'il est invendable (PMS-backed sans vraie disponibilité).
- `caminata-mirador-penon` (produit utilisé par les précédents smoke tests manuels) n'a plus aucune date ouverte sur 3 mois glissants, vérifié le 2026-09-10 — utiliser un autre produit du seed (`kayak-embalse-guatape` a une date ouverte le 2026-10-05) pour tout nouveau test manuel du parcours panier.
- **Les 7 transports déjà en base n'ont PAS d'horaires** malgré l'enrichissement d'`aeroturex-bus-compartido.json` (2026-09-16) : `seed-mock-data.mjs` est create-only et ignore un produit existant. Leurs deux LIEUX, eux, sont bien arrivés (migration de données de `20260916150000`). Un `update` manuel ou un `db reset` est nécessaire pour voir la fenêtre de départs sur un environnement déjà seedé — le lot n'est pas cassé.
- **Paiement Mercado Pago — webhook : RÉSOLU le 2026-09-20**, premier paiement confirmé de bout en bout (piège 19 refermé). La clé de signature doit venir de l'application QUI ENCAISSE — ici celle du compte vendeur de test, pas celle du compte de développement. ⚠️ Restent ouverts : (a) la variable partagée d'équipe `MERCADOPAGO_WEBHOOK_SECRET` porte encore l'ancienne valeur, surchargée par une variable de projet sur `hifago-web` — à nettoyer ; (b) deux paiements encaissés sur commandes annulées (`00bd6fbb`, `e153dea0`) qu'une retentative MP transformerait en commandes fantômes ; (c) ~~la confirmation n'est garantie que tant que le webhook fonctionne~~ — **REFERMÉ le 2026-09-22** en local (spec 39 B1/B2 : `expire_stale_payment_orders` supprimée, `payments-reconcile` interroge MP avant toute expiration, remboursement par le job, client prévenu) ; reste le déploiement préprod (spec 39 §C).

## Fragilités des contrôles CI, relevées par la revue du 2026-09-19
Trouvées en auditant `scripts/check-*.sh`, toutes VÉRIFIÉES en différentiel mais AUCUNE ne se
déclenche sur l'arbre actuel. Elles sont ici pour ne pas être re-diagnostiquées le jour où un
run vire au rouge sans faute réelle.

- `check-data-layer.sh` — le motif `\.from\(` matche `Array.from(` autant que `supabase.from(` : un `Array.from({length: n})` dans un `page.tsx` (idiome courant pour une grille de squelettes) rendrait le script rouge sans faute réelle.
- `check-seo.sh` — le filtre de commentaires n'écarte que ceux en DÉBUT de ligne : un `{/* aggregateRating */}` (commentaire JSX) ou un commentaire de fin de ligne fait échouer le contrôle. C'est le seul des cinq scripts à ne pas passer par `sans-commentaires.pl`.
- `check-seo.sh` — faux négatif symétrique et silencieux : si une zone `(tunnel)`/`(cuenta)`/`(auth)` est renommée, le `grep -r` échoue, le `2>/dev/null || true` avale l'erreur et le contrôle passe au VERT.
- `check-design-system.sh` — trois de ses cinq blocs ne filtrent pas les commentaires : un commentaire citant `from "@heroui/react"` suffit à les faire échouer. Et la comparaison `head -n1` contre `"use client";` casse sur un fichier portant un bandeau de commentaire, un BOM ou un CRLF.
- `check-design-system.sh:41` — ce `find` ne `prune` ni `node_modules` ni `.next`, contrairement aux quatre autres du même fichier : il traverse ~11 600 fichiers pour rien à chaque run.
- `check-deno-imports.sh` — seul script à utiliser des tableaux bash sous `set -u` : deux idiomes y sont fatals en bash 3.2 (le `/bin/bash` de macOS) et légaux depuis 4.4. Inoffensif sur la forme actuelle du dépôt, et ne pourrait casser qu'en LOCAL, jamais en CI (Ubuntu a bash 5.x).
- `check-i18n-links.sh` / `check-tokens.sh` / `check-data-layer.sh` — parcourent l'arbre 3, 2 et 2 fois respectivement (une passe par règle), soit ~2 700 `fork` de `perl`+`grep`. Factoriser en une seule traversée rendrait `npm run verify` sensiblement plus rapide.

## Faits déplacés du backlog le 2026-09-20
Même motif que les déplacements précédents : `docs/backlog.md` à 59/60 lignes. Un fait à ne pas
re-découvrir, pas un arbitrage.

- **`client_key_for_order` perd 2 de ses 3 branches en usage réel** (mesuré le 2026-09-10, conséquence de `account_id` NOT NULL) — `coalesce(account_id, email, téléphone, order_id)` résout désormais TOUJOURS via `account_id` pour ses deux seuls appelants (`list_clients`, `list_client_orders`) : les replis email/téléphone/order_id sont inatteignables par une vraie ligne `orders`. Pas une régression (l'admin ne tape jamais un email à la main, toujours un client_key déjà résolu) — juste un fait à ne pas re-découvrir en confusion. Fonction non modifiée ; sa couverture vit dans `list_client_orders_rpc.test.sql` en appelant la fonction pure directement.

## Dette trouvée en livrant la spec 39 (Lot B), les 2026-09-21/22
- **Deux fonctions insèrent une ligne fille pendant qu'une autre tient la ligne parente** : le
  `KEY SHARE` d'un `insert into order_lines` sur `orders` a interbloqué `modify_order_line` avec
  `expire_payment_order` (3 `40P01` sur 12, reproduit avant correctif, `20260921100200`). Toute
  future RPC qui insère des `order_lines` dans une commande EXISTANTE doit verrouiller `orders`
  d'abord (`create_manual_order_line` crée sa propre commande : hors cause). Piège 22.
- **Codes d'erreur Mercado Pago des remboursements jamais observés en réel** : la fixture
  d'intégration rejoue des corps supposés (`Payment-too-old-to-be-refunded`) ; à remplacer par des
  captures préprod avant de faire confiance au mapping 4xx → `rejected` (spec 39 §10.5).
- **`/admin/reconciliation` sans pagination** : deux listes en cartes (PMS, Pagos) qui grandissent
  avec l'historique (`Reembolsados` compris) — passer en `DataList` quand le volume le justifiera.
- **Aucun écran ne lit `job_heartbeats`** : l'admin apprend qu'un job est arrêté par e-mail
  (`admin_job_stalled`), pas par un voyant. Un bloc « santé des jobs » sur l'accueil admin serait la
  suite naturelle (RLS admin déjà posée).

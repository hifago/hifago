-- Données synthétiques — Tranche 1 (identité composable) uniquement. Aucune PII réelle, aucune
-- copie de production (cf. hifago/CLAUDE.md §7). Ce seed grossira au fil des tranches suivantes
-- (catalogue, disponibilité, commandes...) — normal, pas une dérive à corriger.
--
-- Ordre d'exécution (2026-08-21, depuis que les auth.users de ce fichier sont créés via l'API
-- Admin Auth plutôt qu'en SQL direct — cf. plus bas) :
--   Local  : `npm run db:setup` (scripts/db-setup.sh) — enchaîne les trois étapes dans l'ordre :
--            `db reset --no-seed`, puis `seed_auth_users.mjs`, puis ce fichier via psql.
--   Préprod/prod : migrations déjà à jour (`supabase db push`), puis le même
--            `seed_auth_users.mjs` contre le projet cible (jamais sans /hifago-verify-compte au
--            préalable), puis `psql "$URL_DU_PROJET" -f supabase/seed.sql`.
--   Depuis le 2026-08-27, le seed AUTOMATIQUE est désactivé (`[db.seed] enabled = false` dans
--   config.toml) : un `supabase start` ou un `db reset` nu ne joue plus ce fichier, et ne peut
--   donc plus échouer sur des auth.users manquants. Pour le forcer quand même, une fois le
--   script passé : `supabase db reset --sql-paths ./seed.sql`.
--
-- 4 profils demandés par le plan de la Tranche 1 :
--   1. Invitation en attente (jamais consommée)
--   2. Référent seul, actif
--   3. Référent + opérateur, actif
--   4. Référent suspendu
--
-- Les profils 2/3/4 sont créés en consommant réellement une invitation via la RPC
-- consume_partner_invitation (dogfooding : exerce le vrai chemin métier plutôt que d'insérer des
-- lignes à la main), puis leur statut de capacité est ajusté par UPDATE direct — aucune RPC
-- d'approbation/suspension admin n'existe encore à ce stade du chantier (backlog Partie B). Les
-- trois profils partagent la même séquence en 6 étapes ; factorisée en boucle plutôt que répétée.
--
-- Comptes auth.users (2026-08-21) : plus insérés ici en SQL direct — bloqué sur Supabase Cloud
-- (permission denied for schema auth, restriction plateforme, pas un grant manquant). Créés en
-- amont via `node supabase/scripts/seed_auth_users.mjs` (API Admin Auth, mêmes UUID), qui doit
-- donc tourner AVANT ce fichier (le trigger on_auth_user_created a besoin du vrai INSERT déclenché
-- par createUser() pour provisionner partner_accounts).

-- 1. Invitation en attente --------------------------------------------------
insert into partner_codes (code) values ('SEED-PENDING');

insert into partner_invitations (token_hash, promo_code, onboarding_path, expires_at, partner_hint)
values (
  encode(extensions.digest('seed-pending-token', 'sha256'), 'hex'),
  'SEED-PENDING',
  'referrer',
  now() + interval '30 days',
  jsonb_build_object('display_name', 'Organisation en attente')
);

-- 2/3/4. Référent seul actif, référent+opérateur actif, référent suspendu ----
do $$
declare
  profile record;
begin
  for profile in
    select * from (values
      ('a0000000-0000-4000-8000-000000000002'::uuid, 'referent.actif@hifago.test',
       'SEED-REFACTIVE', 'seed-referent-actif-token', 'referrer', 'Référent Actif', 'active'),
      -- Opérateur actif : sa ligne operator (insérée par consume_partner_invitation ci-dessous)
      -- reste establishment_id = null (pending) après le correctif Tranche 1 — aucun
      -- établissement seedé pour ce partenaire à ce stade, comportement voulu, pas un oubli.
      ('a0000000-0000-4000-8000-000000000003'::uuid, 'operateur.actif@hifago.test',
       'SEED-OPACTIVE', 'seed-operateur-actif-token', 'provider', 'Opérateur Actif', 'active'),
      ('a0000000-0000-4000-8000-000000000004'::uuid, 'referent.suspendu@hifago.test',
       'SEED-REFSUSP', 'seed-referent-suspendu-token', 'referrer', 'Référent Suspendu', 'suspended')
    ) as t(account_id, email, code, token, onboarding_path, signer_name, final_status)
  loop
    -- profile.account_id existe déjà dans auth.users (seed_auth_users.mjs, cf. commentaire plus haut).
    insert into partner_codes (code) values (profile.code);
    insert into partner_invitations (token_hash, promo_code, onboarding_path, expires_at, partner_hint)
    values (
      encode(extensions.digest(profile.token, 'sha256'), 'hex'),
      profile.code,
      profile.onboarding_path,
      now() + interval '30 days',
      jsonb_build_object('display_name', profile.signer_name || ' Org')
    );

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', profile.account_id, 'role', 'authenticated')::text,
      false
    );
    perform consume_partner_invitation(profile.token, profile.signer_name, 'v1', null, null);

    update partner_capabilities set status = profile.final_status
     where partner_id = partner_id_for_account(profile.account_id);
  end loop;
end $$;

reset role;
select set_config('request.jwt.claims', '', false);

-- Feature 1 (Admin : créer un établissement) — compte admin seedé. Nécessaire pour l'e2e
-- admin-establishment.spec.ts et pour toute future feature admin (aucun profil admin n'existait
-- avant cette feature). Capacité insérée directement, pas de flux d'invitation à consommer : une
-- capacité admin est account_id-scoped (jamais partner_id-scoped), cf.
-- partner_capabilities_scope — même schéma que les fixtures admin des tests pgTAP.
-- a0000000-...-0005 (admin@hifago.test) existe déjà dans auth.users (seed_auth_users.mjs).
insert into partner_capabilities (account_id, role, source, status)
values ('a0000000-0000-4000-8000-000000000005', 'admin', 'migration', 'active');

-- Feature 31 (docs/specs/07-connexion-inscription-complete.md §8) — 2FA TOTP désormais obligatoire
-- pour is_admin() (AAL2, migration 20260815250000_admin_2fa_aal2.sql) : sans un facteur déjà
-- enrôlé, tout test e2e utilisant ce compte échouerait sur chaque écran admin. Secret FIXE (pas un
-- vrai secret, uniquement pour environnement de test local) : packages/e2e-support/src/mfa.ts
-- calcule le TOTP courant à partir de cette même valeur pour compléter la connexion
-- programmatique (loginAs) — jamais utilisé/valide en dehors de la base locale.
-- friendly_name = '' (jamais NULL) : le scanner Go de GoTrue attend une string, pas un NULL — une
-- valeur NULL ici casse silencieusement TOUTE connexion (pas seulement celle de ce compte), "sql:
-- Scan error on column index 2, name friendly_name: converting NULL to string is unsupported",
-- reproduit puis corrigé en écrivant cette migration (l'enrôlement réel via mfa.enroll() laisse
-- toujours une chaîne vide, jamais NULL, cf. logs auth de ce même test).
insert into auth.mfa_factors (id, user_id, factor_type, status, friendly_name, secret, created_at, updated_at)
values (
  'c0000000-0000-4000-8000-00000000000f', 'a0000000-0000-4000-8000-000000000005',
  'totp', 'verified', '', 'MUFUB2W7HB62XKO323JGYVPWPE7OJHI7', now(), now()
);

-- Feature 2 (products.establishment_id not null) — établissement créé AVANT le produit de
-- Checkpoint B ci-dessous (Checkpoint B a été codé avant que establishments n'existe, cf. plan) :
-- réordonné ici plutôt qu'un vrai backfill, rien ne persiste entre deux `db reset`. Même
-- partenaire ("Opérateur Actif Org") que le produit qu'il va porter.
insert into establishments (id, partner_id, name)
values (
  'b0000000-0000-4000-8000-000000000002',
  (select partner_id from partner_accounts where id = 'a0000000-0000-4000-8000-000000000003'),
  jsonb_build_object('es', 'Casa Kayam Guatapé')
);

-- Checkpoint B (premier écran réel) — catalogue + disponibilité de démonstration. Ajout ciblé,
-- ne touche à aucune ligne existante ci-dessus (identité/capacités, Tranche 1). Rattaché au
-- partenaire "Opérateur Actif Org" déjà seedé (le seul profil avec la capacité operator, cohérent
-- avec le rôle qui possède réellement un établissement/produit à vendre) et à l'établissement
-- ci-dessus (feature 2, même produit — pas un nouveau).
insert into products (
  id, partner_id, establishment_id, type, name, description, price_cop, unit, schedule, qty_unit,
  category, sellable, slug
)
values (
  'b0000000-0000-4000-8000-000000000001',
  (select partner_id from partner_accounts where id = 'a0000000-0000-4000-8000-000000000003'),
  'b0000000-0000-4000-8000-000000000002',
  'activity',
  jsonb_build_object(
    'es', 'Tour en lancha por el Embalse de Guatapé',
    'en', 'Boat tour on the Guatapé reservoir'
  ),
  jsonb_build_object(
    'es', 'Recorrido guiado de una hora por el embalse, salida desde el muelle principal.',
    'en', 'Guided one-hour tour of the reservoir, departing from the main dock.'
  ),
  80000,
  'per_person',
  'date',
  'qty',
  'nautica',
  true,
  'tour-lancha-guatape'
);

-- 5 dates de démonstration sur le même produit : une largement disponible (réservation réussie),
-- une déjà pleine (message d'échec clair), une à cupo=1 (« dernière place ») — cette dernière est
-- réutilisée à la fois par la vérification manuelle du Checkpoint B et par
-- e2e/reserve-concurrency.spec.ts (exactement une réservation concurrente doit réussir dessus) —
-- une réservée exclusivement à e2e/login.spec.ts (feature 6 : preuve que la session posée par
-- le vrai formulaire de connexion survit jusqu'au bout du parcours panier → checkout → create_order)
-- et une réservée exclusivement à e2e/attribution.spec.ts (feature 7 : parcours invité complet via
-- un lien ?ref=, sans partager de ressource avec les autres specs qui manipulent 2026-09-05/07/10/12).
-- ⚠️ DATES RELATIVES DEPUIS LE 2026-09-07 — elles étaient EN DUR, et c'était une bombe à
-- retardement qui a explosé ce jour-là. Le seed posait `2026-09-05/07/10/12/13/14/15/20` et douze
-- specs e2e codaient les mêmes littéraux ; le 2026-09-07, le 05 était passé et le 07 était le jour
-- même (déjà plein), donc trois specs échouaient. Les cinq autres seraient mortes dans la semaine.
-- Personne ne l'avait vu parce que les e2e n'étaient pas lancés.
--
-- Deux contraintes commandent la forme choisie, et aucune n'est évidente :
--
--   1. **Le MOIS SUIVANT, jamais « aujourd'hui + n ».** Un décalage relatif traverse la frontière
--      de mois une fois sur trois, et le calendrier d'une fiche produit n'affiche QU'UN mois — son
--      `defaultMonth` est celui de la PREMIÈRE disponibilité (`ReservationForm.tsx`). Une date du
--      mois d'après ne serait tout simplement pas dans le DOM, et le sélecteur `[data-date]`
--      échouerait sans rien dire d'utile. Le mois suivant, lui, est toujours entier et toujours
--      futur. C'est déjà la leçon de `nextMonthIsoDate()` dans `packages/e2e-support`, née d'un
--      échec de `partner-agenda.spec.ts` le 2026-08-27.
--   2. **Aucun jour au-delà de 28.** Février existe. Les jours retenus (5 à 20) valent dans tous
--      les mois.
--
-- Le jour du mois est CONSERVÉ pour chaque scénario : une spec qui visait le 12 vise toujours un 12,
-- ce qui garde lisibles à la fois ce fichier et les specs (`seedDate(12)` côté e2e).
insert into product_availability (product_id, date, capacity, booked)
select
  'b0000000-0000-4000-8000-000000000001',
  (date_trunc('month', (now() at time zone 'America/Bogota')::date) + interval '1 month')::date
    + (v.dia - 1),
  v.capacity,
  v.booked
from (values
  -- (jour, capacity, booked)
  ( 5, 10, 0),   -- largement disponible : reserve.spec.ts, et le panier multi-établissement
  ( 7,  1, 1),   -- DÉJÀ PLEINE : message d'échec clair
  (10,  1, 0),   -- dernière place : Checkpoint B + reserve-concurrency.spec.ts
  (12, 10, 0),   -- réservée à login.spec.ts
  (13, 10, 0),   -- réservée à attribution.spec.ts (parcours invité via ?ref=)
  -- Feature 8 : réservée exclusivement à e2e/cancel-order.spec.ts (setup direct via create_order,
  -- resetAvailability exige une ligne product_availability déjà existante pour ce (product, date)).
  (14, 10, 0),
  -- Feature 10 : réservée exclusivement à e2e/admin-order-status.spec.ts (même raison : setup
  -- direct via create_order pour créer une ligne reserved à faire passer à un statut terminal).
  (15, 10, 0),
  -- Feature 18 : réservée exclusivement à e2e/partner-qr-tool.spec.ts (parcours bout-en-bout via le
  -- vrai lien /[locale]/r/[code] généré par /partner/tools, disjointe de toutes les dates ci-dessus).
  (20, 10, 0),
  -- Spec 33 : réservée exclusivement à e2e/payment-return.spec.ts (retour de paiement →
  -- /reserva/<jeton>). Capacity 5 et non 10 : ce spec passe trois commandes d'affilée sur la même
  -- date, il lui en faut assez pour ne jamais buter sur la capacité, jamais plus.
  -- ⚠️ Une date NEUVE était nécessaire : les huit ci-dessus sont toutes déjà dédiées à une autre
  -- spec, et `resetAvailability` fait un UPDATE — sans ligne préexistante pour (produit, date),
  -- il n'ouvre rien et la case du calendrier reste désactivée (constaté en écrivant ce spec).
  (17, 5, 0),
  -- Spec 35 : réservée exclusivement à e2e/perfil.spec.ts (pré-remplissage du tunnel — la commande
  -- de setup y porte un nom délibérément différent du profil édité ensuite, pour prouver que
  -- /pago ne retombe jamais sur elle une fois le profil rempli).
  (16, 5, 0),
  -- Réservée exclusivement à e2e/cart-resume-pending-order.spec.ts (reprise d'une commande invitée
  -- non payée depuis /carrito et /pago à panier vide). Même piège que le 17 ci-dessus : une date
  -- NEUVE est nécessaire, `resetAvailability` ne fait qu'un UPDATE.
  (18, 5, 0)
) as v(dia, capacity, booked);

-- Feature 15 (Socio : soumettre une proposition d'édition) — profil dédié isolé. Constat en
-- préparant cette feature : aucun compte seedé n'a de capacité operator à la fois ACTIVE et
-- SCOPÉE à un établissement précis. operateur.actif@hifago.test (profil 3 ci-dessus) a bien une
-- capacité operator active, mais son establishment_id reste volontairement null ("en attente",
-- documenté plus haut) — has_capability(uid, 'operator', establishment_id) avec un
-- establishment_id précis ne matche jamais une ligne en attente (établissement_id null), donc
-- submit_product_proposal renverrait systématiquement capability_suspended pour ce compte.
-- Nouveau partenaire/compte/établissement/produit entièrement isolé plutôt que de toucher à la
-- ligne existante d'operateur.actif ou de réutiliser son partner_id : has_capability résout par
-- partner_id (pas par account_id, cf. correctif Tranche 1), donc ajouter une deuxième ligne
-- operator au partenaire "Opérateur Actif Org" aurait accordé un effet de bord — une nouvelle
-- capacité effective — au compte operateur.actif existant, qu'on ne doit pas modifier.
insert into partners (id, display_name)
values ('b0000000-0000-4000-8000-000000000003', 'Prestador Propuestas Org');

insert into establishments (id, partner_id, name)
values (
  'b0000000-0000-4000-8000-000000000004',
  'b0000000-0000-4000-8000-000000000003',
  jsonb_build_object('es', 'Establecimiento Propuestas E2E')
);

-- a0000000-...-0006 (operador.propuestas@hifago.test) existe déjà dans auth.users
-- (seed_auth_users.mjs).
-- partner_accounts est déjà provisionné par le trigger handle_new_auth_user (Tranche 1) avec
-- partner_id null — rattaché ici directement (pas de flux d'invitation à consommer, ce profil n'a
-- besoin que de sa capacité finale, pas de tester le parcours d'onboarding).
update partner_accounts set partner_id = 'b0000000-0000-4000-8000-000000000003'
 where id = 'a0000000-0000-4000-8000-000000000006';

-- referrer inséré avant operator : l'invariant operator ⇒ referrer (0002) exige que la ligne
-- referrer existe déjà au moment de l'insertion operator, même ordre que consume_partner_invitation.
insert into partner_capabilities (partner_id, role, source, status)
values ('b0000000-0000-4000-8000-000000000003', 'referrer', 'migration', 'active');

insert into partner_capabilities (partner_id, role, source, status, establishment_id)
values (
  'b0000000-0000-4000-8000-000000000003', 'operator', 'migration', 'active',
  'b0000000-0000-4000-8000-000000000004'
);

-- sellable=false à dessein : preuve que products_select_own (feature 15) est bien nécessaire pour
-- que ce socio voie sa propre fiche dans /partner/products (products_select_public, Tranche 2, ne
-- couvre que sellable=true ou admin).
insert into products (
  id, partner_id, establishment_id, type, name, description, price_cop, unit, schedule, qty_unit,
  category, sellable, slug
)
values (
  'b0000000-0000-4000-8000-000000000005',
  'b0000000-0000-4000-8000-000000000003',
  'b0000000-0000-4000-8000-000000000004',
  'activity',
  jsonb_build_object('es', 'Caminata ecológica por el bosque nativo'),
  jsonb_build_object('es', 'Caminata guiada de dos horas por senderos del bosque nativo.'),
  60000,
  'per_person',
  'date',
  'qty',
  'bienestar',
  false,
  'caminata-ecologica-propuestas'
);

-- Feature 6 (Client : composer un panier multi-établissement) — second produit sellable=true,
-- rattaché à un SECOND établissement ("Establecimiento Propuestas E2E", déjà seedé par la feature
-- 15 — réutilisé plutôt qu'un troisième partenaire créé pour la forme : un établissement qui
-- porte à la fois une fiche non publiée (feature 15) et une fiche publiée est un scénario normal,
-- pas une confusion entre les deux features). Sans ce second produit sellable, le scénario
-- multi-établissement (cahier des charges client §3e) ne serait pas testable de bout en bout : un
-- panier avec des lignes de deux établissements différents nécessite deux produits publiés
-- distincts, jamais un seul.
insert into products (
  id, partner_id, establishment_id, type, name, description, price_cop, unit, schedule, qty_unit,
  category, sellable, slug
)
values (
  'b0000000-0000-4000-8000-000000000006',
  'b0000000-0000-4000-8000-000000000003',
  'b0000000-0000-4000-8000-000000000004',
  'activity',
  jsonb_build_object('es', 'Kayak en el Embalse de Guatapé', 'en', 'Kayaking on the Guatapé reservoir'),
  jsonb_build_object(
    'es', 'Recorrido en kayak de dos horas, equipo incluido, salida desde el muelle comunitario.',
    'en', 'Two-hour kayak tour, equipment included, departing from the community dock.'
  ),
  45000,
  'per_person',
  'date',
  'qty',
  'nautica',
  true,
  'kayak-embalse-guatape'
);

-- Même date que la disponibilité principale de tour-lancha-guatape (Checkpoint B, 2026-09-05) —
-- un client peut composer un panier avec une ligne de chaque établissement sur le même jour,
-- scénario le plus direct pour e2e/cart-multi-establishment.spec.ts. La date déjà pleine de
-- tour-lancha-guatape (2026-09-07, capacity=1/booked=1) est réutilisée telle quelle pour le cas
-- "capacité dépassée" de ce même test — pas besoin d'une deuxième ressource pleine ici.
insert into product_availability (product_id, date, capacity, booked)
select
  'b0000000-0000-4000-8000-000000000006',
  (date_trunc('month', (now() at time zone 'America/Bogota')::date) + interval '1 month')::date + 4,
  10, 0;   -- même jour 5 que la disponibilité principale ci-dessus (+4 car le 1er = décalage 0)

-- Feature 9 (Admin : liste des commandes) — 2 commandes de démonstration pour exercer les deux cas
-- d'affichage du référent dès le premier chargement de /admin/orders : une "directe" et une avec
-- un référent externe résolu. Dates dédiées (2026-10-01/02), disjointes de celles utilisées par
-- les specs e2e du panier (2026-09-05/07/10/12/13/14). Préfixe c0000000 (nouveau domaine, ni
-- identité ni catalogue).
insert into partner_codes (code, partner_id, active)
values ('SEED-DEMO-REF', 'b0000000-0000-4000-8000-000000000003', true);

-- Commande directe : invité, aucun référent. RÉVISÉ 2026-09-10 (spec 31, Tranche 2) —
-- account_id null n'est plus possible (NOT NULL) ; ce compte (d0000000-...-000003,
-- supabase/scripts/seed_auth_users.mjs) REMPLACE l'ancien account_id null, jamais le compte
-- technique des réservations comptoir (e0000000-...-000001) — un invité web n'est pas une
-- réservation prise au comptoir, même s'il n'a pas non plus d'identité anonyme "vivante" ici (la
-- créer via l'API Admin exigerait le mécanisme réel signInAnonymously(), hors de portée d'un seed).
insert into orders (id, account_id, holder_name, holder_phone, holder_email)
values (
  'c0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000003',
  'Cliente Directo Seed', '+57 300 000 0001', 'cliente.directo.seed@test.local'
);
-- Feature 11 (snapshot prix+commission) : commande directe, qty=1, price_cop=80000 (produit
-- tour-lancha-guatape ci-dessus) → total_cop=80000, direct (0/17), acompte_cop=13600.
-- holder_name obligatoire (spec 17 §0 Tranche 1, 20260817180000) : bug latent trouvé en testant
-- (spec 19) — ce seed n'avait jamais été rejoué depuis que la colonne est devenue NOT NULL,
-- corrigé ici sur les 3 inserts order_lines du fichier, pas seulement celui-ci.
insert into order_lines (
  order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  'c0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000003',
  'b0000000-0000-4000-8000-000000000001', '2026-10-01', 1, 'reserved', 'Cliente Directo Seed',
  80000, 80000, 'direct', 0.17, 0, 0.17, 13600, 0, 13600
);

-- Commande avec référent résolu : compte enregistré (referente.actif), code SEED-DEMO-REF
-- présenté, référent externe (Prestador Propuestas Org — différent du partenaire propriétaire du
-- produit tour-lancha-guatape) — scénario réaliste, pas une auto-référence.
insert into orders (
  id, account_id, holder_name, holder_phone, holder_email, referrer_partner_id, attribution_code, attribution_source
)
values (
  'c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002',
  'Cliente Referido Seed', '+57 300 000 0002', 'cliente.referido.seed@test.local',
  'b0000000-0000-4000-8000-000000000003', 'SEED-DEMO-REF', 'link'
);
-- Feature 11 : référent externe (b0000000-...-0003, différent du propriétaire du produit), qty=2,
-- price_cop=80000 → total_cop=160000, external_referrer (10/7), referrer_commission_cop=16000,
-- app_commission_cop=11200.
-- Feature 14 : referrer_partner_id dénormalisé ici aussi (colonne créée après cette ligne, backfill
-- de cohérence — sans lui, ce référent ne verrait pas cette ligne dans /partner/commissions malgré
-- orders.referrer_partner_id déjà résolu ci-dessus).
insert into order_lines (
  order_id, account_id, product_id, date, qty, status, referrer_partner_id, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  'c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002',
  'b0000000-0000-4000-8000-000000000001', '2026-10-02', 2, 'reserved',
  'b0000000-0000-4000-8000-000000000003', 'Cliente Referido Seed',
  80000, 160000, 'external_referrer', 0.17, 0.10, 0.07, 27200, 16000, 11200
);

-- Revue admin clientes (Jérôme, 2026-08-19) — payments n'avait jusqu'ici AUCUNE ligne dans ce
-- seed (table posée par 20260818200000, jamais alimentée) : premier consommateur réel de cette
-- table côté affichage (fiche détail client), sans ligne le bloc paiement resterait vide de tout
-- premier chargement local/e2e. amount_cop = l'acompte de cette commande (27200, cf. ligne
-- au-dessus), jamais le total (cahier des charges §3f).
insert into payments (order_id, mp_payment_id, status, amount_cop, payer_email) values (
  'c0000000-0000-4000-8000-000000000002', 'SEED-MP-PAYMENT-001', 'approved', 27200,
  'cliente.referido.seed@test.local'
);

-- Feature 12 (ledger) : commande DÉDIÉE (pas les 2 ci-dessus, "Cliente Directo Seed"/"Cliente
-- Referido Seed" — e2e/admin-orders-list.spec.ts scope ses locators par nom de titulaire et
-- s'attend à ce que "Cliente Referido Seed" reste ABSENT du filtre "Realizada", une ligne fulfilled
-- de plus sur cette même commande casserait cette assertion). Même référent externe
-- (b0000000-...-0003) sur 2 lignes, statuts différents, pour exercer visuellement earned et
-- redistributed dès le premier chargement de /admin/orders/[id] — sans elles, la différence entre
-- les deux ne serait jamais visible (le ledger ne modifie jamais ces colonnes, il les DÉRIVE à la
-- lecture, cf. deriveLedgerEntry).
insert into orders (
  id, account_id, holder_name, holder_phone, holder_email, referrer_partner_id, attribution_code, attribution_source
)
values (
  'c0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002',
  'Cliente Ledger Seed', '+57 300 000 0003', 'cliente.ledger.seed@test.local',
  'b0000000-0000-4000-8000-000000000003', 'SEED-DEMO-REF', 'link'
);
-- qty=1, price_cop=80000 → total_cop=80000, external_referrer (10/7) : acompte_cop=13600,
-- referrer_commission_cop=8000, app_commission_cop=5600 (identique sur les 3 lignes, seul le
-- statut diffère). Feature 14 : referrer_partner_id dénormalisé aussi ici — ce même trio
-- fulfilled/cancelled_by_client/fulfilled(payé) sert désormais aussi de fixture e2e pour
-- e2e/partner-commissions.spec.ts (compte operador.propuestas, référent de b0000000-...-0003),
-- pas seulement pour le ledger admin (feature 12) qui a introduit les deux premières.
insert into order_lines (
  order_id, account_id, product_id, date, qty, status, referrer_partner_id, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  -- fulfilled → ledger_entries status 'due' : referrer_commission_cop reste dû au référent tel quel.
  ('c0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002',
   'b0000000-0000-4000-8000-000000000001', '2026-10-03', 1, 'fulfilled',
   'b0000000-0000-4000-8000-000000000003', 'Cliente Ledger Seed',
   80000, 80000, 'external_referrer', 0.17, 0.10, 0.07, 13600, 8000, 5600),
  -- cancelled_by_client → ledger_entries status 'void' : referrer_commission_cop redirigé vers le
  -- prestataire (compensation), jamais simplement perdu — c'est précisément ce que l'écran doit
  -- rendre visible.
  ('c0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002',
   'b0000000-0000-4000-8000-000000000001', '2026-10-04', 1, 'cancelled_by_client',
   'b0000000-0000-4000-8000-000000000003', 'Cliente Ledger Seed',
   80000, 80000, 'external_referrer', 0.17, 0.10, 0.07, 13600, 8000, 5600),
  -- fulfilled + déjà réglé (spec 19 §0 Tranche 0) → ledger_entries status 'paid' directement en
  -- fixture (représente un règlement historique déjà fait, pas une transition rejouée via les RPC
  -- — même logique que pms_reconciliation_entries qui seed aussi un statut 'resolved' directement).
  -- Seule ligne du seed capable de prouver que /partner/commissions affiche "Pagada", un état que
  -- l'ancienne dérivation (deriveLedgerEntry) ne pouvait structurellement jamais produire.
  ('c0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002',
   'b0000000-0000-4000-8000-000000000001', '2026-10-05', 1, 'fulfilled',
   'b0000000-0000-4000-8000-000000000003', 'Cliente Ledger Seed',
   80000, 80000, 'external_referrer', 0.17, 0.10, 0.07, 13600, 8000, 5600);

-- Spec 19 §0 Tranche 0 (ledger de règlement réel) — ledger_entries correspondantes aux 4 lignes
-- external_referrer ci-dessus, comme create_order/set_order_line_status/mark_ledger_entry_paid les
-- auraient produites elles-mêmes (jamais un id en dur : order_lines n'a pas d'id explicite dans ses
-- INSERT, résolu ici par sous-requête (order_id, date), même patron que
-- pms_reconciliation_entries plus bas). Sert à la fois au dashboard référent (/partner/commissions,
-- désormais lu depuis le vrai ledger, plus une dérivation) et à l'écran admin (/admin/ledger).
insert into ledger_entries (order_line_id, beneficiary_type, referrer_partner_id, entry_type, amount_cop, status)
select id, 'referrer', 'b0000000-0000-4000-8000-000000000003', 'referral_earned', 16000, 'estimated'
  from order_lines
 where order_id = 'c0000000-0000-4000-8000-000000000002' and date = '2026-10-02';

insert into ledger_entries (order_line_id, beneficiary_type, referrer_partner_id, entry_type, amount_cop, status)
select id, 'referrer', 'b0000000-0000-4000-8000-000000000003', 'referral_earned', 8000, 'due'
  from order_lines
 where order_id = 'c0000000-0000-4000-8000-000000000003' and date = '2026-10-03';

-- cancelled_by_client (2026-10-04) : la part référent est void (jamais due, ligne pas réalisée) et
-- redirigée en compensation à l'établissement propriétaire du produit (b0000000-...-0002, "Casa
-- Kayam Guatapé") — même mécanique que set_order_line_status, §0 invariants spec 19.
insert into ledger_entries (order_line_id, beneficiary_type, referrer_partner_id, entry_type, amount_cop, status)
select id, 'referrer', 'b0000000-0000-4000-8000-000000000003', 'referral_earned', 8000, 'void'
  from order_lines
 where order_id = 'c0000000-0000-4000-8000-000000000003' and date = '2026-10-04';

-- 2026-10-05 : déjà réglé (paid_at fixe, pas now() — un seed déterministe ne dépend jamais de
-- l'heure d'exécution). comprobante_path/note factices, cohérents avec un vrai appel
-- mark_ledger_entry_paid.
insert into ledger_entries (
  order_line_id, beneficiary_type, referrer_partner_id, entry_type, amount_cop, status,
  comprobante_path, note, paid_at
)
select id, 'referrer', 'b0000000-0000-4000-8000-000000000003', 'referral_earned', 8000, 'paid',
  'comprobantes/seed-demo.pdf', 'Transferencia Bancolombia (seed)', '2026-10-06 10:00:00+00'
  from order_lines
 where order_id = 'c0000000-0000-4000-8000-000000000003' and date = '2026-10-05';

insert into ledger_entries (order_line_id, beneficiary_type, establishment_id, entry_type, amount_cop, status)
select id, 'establishment', 'b0000000-0000-4000-8000-000000000002', 'establishment_compensation', 8000, 'due'
  from order_lines
 where order_id = 'c0000000-0000-4000-8000-000000000003' and date = '2026-10-04';

-- Feature 22 (Admin : file de réconciliation PMS) — 2 entrées de démonstration (open/retrying),
-- rattachées à des order_lines RÉELLEMENT seedées ci-dessus (jamais un UUID inventé : order_lines
-- n'a pas d'id explicite dans ses INSERT, généré par gen_random_uuid(), donc résolu ici par
-- sous-requête sur (order_id, date) plutôt que codé en dur). Les deux lignes ciblées portent sur
-- tour-lancha-guatape (établissement "Casa Kayam Guatapé", b0000000-...-0002) pour que l'écran
-- affiche un contexte réaliste (établissement + référence de commande) dès son premier chargement.
insert into pms_reconciliation_entries (order_line_id, status, attempts, last_attempt_at)
select id, 'open', 1, now() - interval '2 hours'
  from order_lines
 where order_id = 'c0000000-0000-4000-8000-000000000001' and date = '2026-10-01';

insert into pms_reconciliation_entries (order_line_id, status, attempts, last_attempt_at)
select id, 'retrying', 2, now() - interval '30 minutes'
  from order_lines
 where order_id = 'c0000000-0000-4000-8000-000000000002' and date = '2026-10-02';

-- Feature 25 (Admin : audiences serveur + moteur de campagne) — 2 comptes clients ENREGISTRÉS
-- dédiés (jamais un simple invité : list_audience_members ne voit que les comptes avec une ligne
-- partner_accounts, jointe depuis auth.users) — l'un avec consentement marketing sur sa commande la
-- plus récente, l'autre sans, pour que e2e/admin-campaign.spec.ts observe une vraie répartition
-- envoyé/ignoré après traitement du lot, pas un seul cas. Aucun mot de passe/champ d'auth complet
-- nécessaire : ces comptes ne sont jamais connectés, seulement ciblés par une campagne admin.
-- d0000000-...-0001/0002 existent déjà dans auth.users (seed_auth_users.mjs, sans mot de passe).
insert into orders (id, account_id, holder_name, holder_email, marketing_consent) values
  ('c0000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000001',
   'Cliente Campaign Consent Seed', 'campaign-client-consent-seed@test.local', true),
  ('c0000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000002',
   'Cliente Campaign No Consent Seed', 'campaign-client-no-consent-seed@test.local', false);

-- Spec 21 (connecteur LobbyPMS) — établissement PMS-backed de démonstration. Réutilise "Casa Kayam
-- Guatapé" (b0000000-...-0002), déjà l'établissement seedé de référence (feature 22 ci-dessus) —
-- cohérent avec la réalité du projet, Casa Kayam étant le seul établissement réellement PMS-backed
-- (jamais un établissement synthétique séparé qui fragmenterait la donnée de démo). Jeton FACTICE
-- (jamais un vrai jeton dans le seed, cf. hifago/CLAUDE.md §8.2) — un appel réel échouerait en 401,
-- comportement attendu et déjà documenté (401 local = normal, aucune IP whitelistée hors Fly/relais
-- réseau). category_id 9631 repris du legacy (VIDPOVO) pour la continuité narrative, sans lien réel
-- avec un compte Lobby existant.
update establishments
   set lobby_connector_active = true, lobby_api_token = 'seed-fake-token'
 where id = 'b0000000-0000-4000-8000-000000000002';

insert into products (
  id, partner_id, establishment_id, type, name, description, price_cop, unit, schedule, qty_unit,
  sellable, slug, lobby_category_id
)
values (
  'b0000000-0000-4000-8000-000000000007',
  (select partner_id from partner_accounts where id = 'a0000000-0000-4000-8000-000000000003'),
  'b0000000-0000-4000-8000-000000000002',
  'lodging',
  jsonb_build_object('es', 'Alojamiento PMS-backed (demo)', 'en', 'PMS-backed lodging (demo)'),
  jsonb_build_object(
    'es', 'Dormitorio de demostración, disponibilité gérée par LobbyPMS (connecteur, spec 21).',
    'en', 'Demo dorm, availability managed by LobbyPMS (connector, spec 21).'
  ),
  100000,
  'per_person',
  'date',
  'qty',
  true,
  'alojamiento-pms-backed-demo',
  9631
);

-- Spec 28 (accueil de la vitrine, Lot D) — SECOND couchage vendable de « Casa Kayam Guatapé »,
-- ajouté le 2026-09-08.
--
-- POURQUOI IL EXISTE. Uniquement pour rendre OBSERVABLE la règle « un établissement à deux
-- couchages vendables ou plus apparaît comme UNE carte » (`search_catalog`, CTE
-- `conteo_alojamientos`, seuil `n_alojamientos >= 2`). Avant lui, `alojamiento-pms-backed-demo`
-- ci-dessus était le SEUL produit `lodging` `sellable` de toute la base — donc `n_alojamientos`
-- valait 1 partout, l'accueil ne pouvait JAMAIS produire de carte d'établissement, et l'e2e de
-- l'accueil n'aurait eu aucune carte groupée à vérifier (constat sur base propre le 2026-09-07,
-- spec 28 § « Fichiers touchés »).
--
-- DÉLIBÉRÉMENT SANS `lobby_category_id`. Le premier couchage est adossé au PMS ; si le second
-- l'était aussi, l'accueil dépendrait de LobbyPMS pour une simple carte groupée. Celui-ci est un
-- couchage ordinaire géré par le calendrier hifago — et le mélange PMS / non-PMS sur un même
-- établissement est exactement ce que porte un vrai partenaire.
--
-- PRIX INFÉRIEUR À CELUI DU PREMIER (65 000 < 100 000), et c'est le point : le `precio_desde` de la
-- carte groupée vaut le MINIMUM des couchages vendables de l'établissement. Deux prix identiques ne
-- prouveraient pas que le minimum est bien calculé.
--
-- `capacity` RENSEIGNÉE : c'est la colonne que le filtre « personas » lit pour un logement
-- (`search_catalog` : `when p.type = 'lodging' then p.capacity is null or p.capacity >= p_personas`).
-- Le couchage PMS, lui, l'a à null et passe donc par ABSENCE de borne ; sans une capacité explicite
-- ici, aucune donnée du seed n'exercerait la branche qui filtre réellement.
insert into products (
  id, partner_id, establishment_id, type, name, description, price_cop, unit, schedule, qty_unit,
  capacity, sellable, slug
)
values (
  'b0000000-0000-4000-8000-000000000008',
  (select partner_id from partner_accounts where id = 'a0000000-0000-4000-8000-000000000003'),
  'b0000000-0000-4000-8000-000000000002',
  'lodging',
  jsonb_build_object('es', 'Cama en dormitorio compartido (demo)', 'en', 'Shared dorm bed (demo)'),
  jsonb_build_object(
    'es', 'Cama en un dormitorio de seis, con baño compartido. Disponibilidad gestionada por el calendario de hifago, sin PMS.',
    'en', 'Bed in a six-person dorm with shared bathroom. Availability managed by the hifago calendar, no PMS.'
  ),
  65000,
  'per_person',
  'date',
  'qty',
  6,
  true,
  'cama-dormitorio-compartido-demo'
);

-- Contrairement au couchage PMS ci-dessus, celui-ci n'a AUCUNE source externe de disponibilité :
-- sans lignes ici, il apparaîtrait à l'accueil (le filtre de dates ne lit que `product_calendar`,
-- creux et ouvert par défaut) mais serait impossible à réserver — un produit mort dans le seed.
-- Huit nuits contiguës, donc une vraie plage arrivée → départ est sélectionnable.
-- ⚠️ DATES RELATIVES, même mécanisme et mêmes raisons que le bloc de `tour-lancha-guatape`
-- ci-dessus (mois SUIVANT, jamais « aujourd'hui + n » ; aucun jour au-delà de 28).
insert into product_availability (product_id, date, capacity, booked)
select
  'b0000000-0000-4000-8000-000000000008',
  (date_trunc('month', (now() at time zone 'America/Bogota')::date) + interval '1 month')::date
    + (dia - 1),
  6,
  0
from generate_series(5, 12) as dia;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Spec 29 (Tranche 2) — LES CATÉGORIES D'ACTIVITÉ, ajoutées le 2026-09-08.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
--
-- POURQUOI ELLES EXISTENT. `catalog_tags` était VIDE — aucune ligne, aucune assignation (constaté
-- le 2026-09-08). Trois conséquences, toutes silencieuses :
--   • `/es/actividades` n'aurait eu aucune tuile à montrer ;
--   • le volet « chercher par libellé de tag » du cahier §2a, pourtant implémenté dans
--     `search_catalog` depuis le lot A, n'était couvert par AUCUN test de bout en bout ;
--   • et rien n'exerçait la règle « seuls les tags portant au moins une offre publiée figurent ».
--
-- ⚠️ `label` ET `description` DANS LES DEUX LANGUES. Sans l'anglais, rien ne prouverait que le repli
-- JSONB et la locale `/en/` fonctionnent — et une page de catégorie servie en repli doit rester
-- `noindex` (règle SEO 2), un comportement qu'il faut pouvoir observer.
--
-- ⚠️ AUCUNE IMAGE, ET CE N'EST PAS UN OUBLI. `storage.objects` ne se remplit pas depuis un fichier
-- SQL : il y faudrait le binaire. Les tuiles rendront donc l'aplat gris en local comme en e2e —
-- c'est le substitut prévu par l'atome `Image`, et la variante illustrée est couverte par la story
-- `Affichage/TarjetaCategoria` → `Completa` et par son test de composant.
--
-- `20261014160938_contenu_admin_local_du_13.sql` crée « cultura » dans TOUTE base, celle-ci
-- comprise : le seed passe après les migrations, et sa ligne garde l'identifiant fixe que les
-- rattachements ci-dessous citent. La copie de la migration n'a encore aucun rattachement ici (les
-- fiches qu'elle vise n'existent pas dans le seed) : elle est retirée avant l'insert.
delete from catalog_tags where slug = 'cultura' and id <> 'c0000000-0000-4000-8000-000000000003';
insert into catalog_tags (id, label, slug, description) values
  (
    'c0000000-0000-4000-8000-000000000001',
    jsonb_build_object('es', 'Deportes náuticos', 'en', 'Water sports'),
    'deportes-nauticos',
    jsonb_build_object(
      'es', 'Kayak, lancha y paddle en el embalse, con equipo incluido.',
      'en', 'Kayak, boat and paddle on the reservoir, equipment included.'
    )
  ),
  (
    'c0000000-0000-4000-8000-000000000002',
    jsonb_build_object('es', 'Naturaleza', 'en', 'Nature'),
    'naturaleza',
    jsonb_build_object(
      'es', 'Caminatas y miradores alrededor del Peñón.',
      'en', 'Hikes and viewpoints around the Peñón.'
    )
  ),
  -- ⚠️ Une catégorie DÉLIBÉRÉMENT NON RÉDIGÉE : c'est l'état d'un catalogue en cours de
  -- remplissage, et le seul moyen de voir en local qu'une tuile sans texte n'ouvre pas de bloc
  -- vide sous son titre (story `SinTexto`).
  (
    'c0000000-0000-4000-8000-000000000003',
    jsonb_build_object('es', 'Cultura', 'en', 'Culture'),
    'cultura',
    null
  ),
  -- ⚠️ Une catégorie SANS AUCUNE OFFRE, et c'est tout son intérêt : elle ne doit JAMAIS apparaître
  -- dans l'index (cahier §2a — « un tag vide produirait une page vide que Google indexerait »), et
  -- sa page doit rendre 404. Sans elle, rien dans le seed n'exercerait cette règle.
  (
    'c0000000-0000-4000-8000-000000000004',
    jsonb_build_object('es', 'Gastronomía', 'en', 'Food & drink'),
    'gastronomia',
    jsonb_build_object('es', 'Sabores del embalse.', 'en', 'Flavours of the reservoir.')
  );

-- ⚠️ `category` N'EST PAS UN TAG, et la confusion coûte une contrainte violée : c'est l'ancienne
-- liste FERMÉE de six familles (`products_category_check` : musica, arte, bienestar, nautica,
-- adrenalina, gastronomia), celle que `catalog_tags` remplace précisément (spec 08 §5). Les deux
-- coexistent tant que la colonne n'est pas retirée — on y met donc une valeur VALIDE de l'ancienne
-- liste, sans rapport avec la catégorie assignée plus bas.

-- Deux activités vendables de plus. Avec les deux existantes, l'index n'aurait montré qu'une ou
-- deux tuiles — et l'ordre alphabétique n'est vérifiable qu'à partir de deux catégories réellement
-- distinctes. Elles sont rattachées au partenaire et à l'établissement déjà seedés : aucun
-- troisième partenaire créé pour la forme.
insert into products (
  id, partner_id, establishment_id, type, name, description, price_cop, unit, schedule, qty_unit,
  category, max_qty, sellable, slug
)
values
  (
    'b0000000-0000-4000-8000-000000000009',
    'b0000000-0000-4000-8000-000000000003',
    'b0000000-0000-4000-8000-000000000004',
    'activity',
    jsonb_build_object('es', 'Caminata al mirador del Peñón', 'en', 'Hike to the Peñón viewpoint'),
    jsonb_build_object(
      'es', 'Caminata guiada de tres horas hasta el mirador, con parada en el bosque nativo.',
      'en', 'Three-hour guided hike to the viewpoint, with a stop in the native forest.'
    ),
    55000, 'per_person', 'date', 'qty', 'bienestar', 12, true, 'caminata-mirador-penon'
  ),
  -- ⚠️ Celle-ci reste DÉLIBÉRÉMENT NON TAGUÉE (voir les assignations ci-dessous) : c'est elle qui
  -- rend la tuile « Otras actividades » atteignable en e2e. Sans une activité publiée qu'aucune
  -- catégorie ne classe, la décision 1 de la spec 29 ne serait observable nulle part.
  (
    'b0000000-0000-4000-8000-00000000000a',
    'b0000000-0000-4000-8000-000000000003',
    'b0000000-0000-4000-8000-000000000004',
    'activity',
    jsonb_build_object('es', 'Taller de cerámica de zócalos', 'en', 'Zócalo pottery workshop'),
    jsonb_build_object(
      'es', 'Taller de dos horas para pintar tu propio zócalo, materiales incluidos.',
      'en', 'Two-hour workshop to paint your own zócalo, materials included.'
    ),
    70000, 'per_person', 'date', 'qty', 'arte', 8, true, 'taller-ceramica-zocalos'
  );

-- Les assignations. `taller-ceramica-zocalos` n'y figure PAS, à dessein (cf. ci-dessus).
--
-- ⚠️ `kayak-embalse-guatape` et `tour-lancha-guatape` reçoivent la MÊME catégorie : c'est ce qui
-- rend observable qu'une tuile compte plusieurs offres, et non une par tag.
insert into product_tag_assignments (product_id, tag_id) values
  ('b0000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000009', 'c0000000-0000-4000-8000-000000000002'),
  -- ⚠️ Une assignation vers une activité NON VENDABLE (`caminata-ecologica-propuestas`,
  -- `sellable = false`) : la catégorie « Cultura » n'a donc AUCUNE offre publiée et ne doit pas
  -- apparaître dans l'index. C'est le cas limite le plus facile à casser sans s'en apercevoir —
  -- il suffirait d'oublier le prédicat `p.sellable` dans `search_catalog`.
  ('b0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000003');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Spec 30 (Tranche 2) — de quoi JUGER les deux fiches, et pas seulement les afficher
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- Constat qui motive ce bloc (mesuré le 2026-09-08) : `check_in_time`, `check_out_time`,
-- `external_booking_url`, `address`, `lat`, `lon`, `price_label`, `duration_minutes` et
-- `start_time` étaient NULL sur les sept produits, et les deux établissements n'avaient ni
-- description, ni horaires, ni `mode`. Autrement dit, aucune des deux fiches n'était observable
-- dans son état nominal — ni en développement, ni en e2e.
--
-- ⚠️ LE PARTAGE DES DEUX ÉTABLISSEMENTS EST DÉLIBÉRÉ, et il tient à un fait vérifié :
--   • `…-0002` (Casa Kayam) devient l'établissement RICHE. Aucun e2e ne le mute.
--   • `…-0004` reste PAUVRE, et c'est lui qui exerce l'absence (pas de contact → pas de bouton).
--     `establishment-page.spec.ts` lui écrit ses horaires puis les remet à `null` : y poser des
--     valeurs de seed les ferait effacer par la première exécution e2e venue.
update public.establishments
   set description = jsonb_build_object(
         'es', 'Casa de huéspedes frente al embalse, con habitaciones privadas y dormitorio compartido. '
               'Desayuno incluido y muelle propio para las salidas en lancha.',
         'en', 'Guest house facing the reservoir, with private rooms and a shared dormitory. '
               'Breakfast included and a private dock for boat departures.'
       ),
       address = 'Vereda La Peña, Guatapé, Antioquia',
       lat = 6.2333,
       lon = -75.1667,
       check_in_time = '15:00',
       check_out_time = '11:00',
       mode = 'rooms',
       -- E.164 obligatoire (contrainte `establishments_contact_phone_e164`) : la fiche construit
       -- `wa.me/<numéro sans le +>`, et un numéro écrit autrement donnerait un lien mort.
       -- ⚠️ Numéro SYNTHÉTIQUE (préfixe 300 000 00 00), jamais une ligne réelle : CLAUDE.md §7.3.
       contact_phone = '+573000000000'
 where id = 'b0000000-0000-4000-8000-000000000002';

-- L'OFFRE EN VITRINE — la seule ligne qui prouve que la contrainte
-- `products_price_cop_required_unless_vitrine` sert à quelque chose, et le seul moyen de voir
-- l'écran vitrine sans le fabriquer à la main.
--
-- ⚠️ `type = 'transport'` et non `'camp'` : `listados.spec.ts` vérifie l'état vide sur `/es/camps`
-- (« une section sans offre rend 200 et un état vide, jamais un 404 »). Remplir les camps
-- casserait ce test — vérifié avant d'écrire, pas après.
--
-- `sellable = true` et `price_cop = null` : c'est bien `external_booking_url` qui fait la vitrine,
-- JAMAIS `sellable = false`, qui rendrait le produit invisible ET retirerait son établissement du
-- public (`establishments_select_public` exige un produit vendable). Cahier §2e.
insert into products (
  id, partner_id, establishment_id, type, name, description, price_cop, price_label,
  external_booking_url, unit, schedule, qty_unit, sellable, slug
)
values (
  'b0000000-0000-4000-8000-000000000031',
  (select partner_id from partner_accounts where id = 'a0000000-0000-4000-8000-000000000003'),
  'b0000000-0000-4000-8000-000000000002',
  'transport',
  jsonb_build_object(
    'es', 'Traslado privado Medellín – Guatapé',
    'en', 'Private transfer Medellín – Guatapé'
  ),
  jsonb_build_object(
    'es', 'Vehículo privado hasta cuatro personas. Tarifa según punto de recogida y horario.',
    'en', 'Private vehicle for up to four people. Fare depends on pickup point and time.'
  ),
  null,
  'Consultar',
  'https://wa.me/573000000000',
  -- `unit` n'accepte que per_person / per_two / per_house (`products_unit_check`) — `null` est
  -- permis, et c'est le bon choix ici : le tarif d'un traslado se négocie, il n'a pas d'unité.
  null,
  'none',
  'qty',
  true,
  'traslado-privado-medellin-guatape'
);

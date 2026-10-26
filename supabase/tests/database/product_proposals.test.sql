-- Feature 15 (Socio : soumettre une proposition d'édition) — submit_product_proposal (3
-- garde-fous : identité+propriété, capacité, plafond, puis filtrage du payload),
-- withdraw_product_proposal, RLS sur product_proposals et products_select_own.
begin;
select plan(20);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Fixtures : 3 partenaires distincts, chacun avec son établissement + produit.
--   own    : le partenaire dont c'est le point de vue dans la plupart des tests (capacité operator
--            active, scopée à son établissement).
--   other  : un tiers, utilisé comme cible "produit d'un autre partenaire" et comme tentative de
--            withdraw sur une proposition qui n'est pas la sienne.
--   nocap  : possède bien son produit, mais n'a AUCUNE ligne operator (capacité absente, pas
--            seulement suspendue) — deuxième chemin vers capability_suspended.
insert into partners (id, display_name) values
  ('66660000-0000-4000-8000-000000000001', 'Prop Test Own'),
  ('66660000-0000-4000-8000-000000000002', 'Prop Test Other'),
  ('66660000-0000-4000-8000-000000000003', 'Prop Test NoCap');

insert into establishments (id, partner_id, name) values
  ('66660000-0000-4000-8000-000000000011', '66660000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Own')),
  ('66660000-0000-4000-8000-000000000012', '66660000-0000-4000-8000-000000000002',
   jsonb_build_object('es', 'Establecimiento Other')),
  ('66660000-0000-4000-8000-000000000013', '66660000-0000-4000-8000-000000000003',
   jsonb_build_object('es', 'Establecimiento NoCap'));

insert into auth.users (id, email) values
  ('66660000-0000-4000-8000-000000000021', 'prop-own@test.local'),
  ('66660000-0000-4000-8000-000000000022', 'prop-other@test.local'),
  ('66660000-0000-4000-8000-000000000023', 'prop-nocap@test.local'),
  ('66660000-0000-4000-8000-000000000024', 'prop-admin@test.local');

update partner_accounts set partner_id = '66660000-0000-4000-8000-000000000001'
 where id = '66660000-0000-4000-8000-000000000021';
update partner_accounts set partner_id = '66660000-0000-4000-8000-000000000002'
 where id = '66660000-0000-4000-8000-000000000022';
update partner_accounts set partner_id = '66660000-0000-4000-8000-000000000003'
 where id = '66660000-0000-4000-8000-000000000023';

insert into partner_capabilities (partner_id, role, source, status) values
  ('66660000-0000-4000-8000-000000000001', 'referrer', 'migration', 'active'),
  ('66660000-0000-4000-8000-000000000002', 'referrer', 'migration', 'active'),
  ('66660000-0000-4000-8000-000000000003', 'referrer', 'migration', 'active');

insert into partner_capabilities (partner_id, role, source, status, establishment_id) values
  ('66660000-0000-4000-8000-000000000001', 'operator', 'migration', 'active',
   '66660000-0000-4000-8000-000000000011'),
  ('66660000-0000-4000-8000-000000000002', 'operator', 'migration', 'active',
   '66660000-0000-4000-8000-000000000012');
-- nocap : délibérément aucune ligne operator.

insert into partner_capabilities (account_id, role, source, status) values
  ('66660000-0000-4000-8000-000000000024', 'admin', 'migration', 'active');

insert into products (
  id, partner_id, establishment_id, type, name, price_cop, sellable, slug
) values
  ('66660000-0000-4000-8000-000000000031', '66660000-0000-4000-8000-000000000001',
   '66660000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Producto Own'), 50000, false, 'prop-test-own'),
  ('66660000-0000-4000-8000-000000000032', '66660000-0000-4000-8000-000000000002',
   '66660000-0000-4000-8000-000000000012', 'activity',
   jsonb_build_object('es', 'Producto Other'), 50000, false, 'prop-test-other'),
  ('66660000-0000-4000-8000-000000000033', '66660000-0000-4000-8000-000000000003',
   '66660000-0000-4000-8000-000000000013', 'activity',
   jsonb_build_object('es', 'Producto NoCap'), 50000, false, 'prop-test-nocap');

set local role authenticated;

-- Garde-fous 1+2 : produit d'un autre partenaire / produit inexistant → même réponse ------------
select test_login('66660000-0000-4000-8000-000000000021');

select is(
  (select submit_product_proposal('66660000-0000-4000-8000-000000000032'::uuid, '{}'::jsonb)->>'reason'),
  'product_not_found',
  'produit appartenant à un autre partenaire → product_not_found'
);
select is(
  (select submit_product_proposal('00000000-0000-4000-8000-000000000099'::uuid, '{}'::jsonb)->>'reason'),
  'product_not_found',
  'produit inexistant → la même réponse product_not_found (ne révèle rien de plus)'
);

-- Garde-fou 3 : capacité suspendue (own, temporairement) puis absente (nocap) -------------------
reset role;
update partner_capabilities set status = 'suspended'
 where partner_id = '66660000-0000-4000-8000-000000000001' and role = 'operator';
set local role authenticated;
select test_login('66660000-0000-4000-8000-000000000021');

select is(
  (select submit_product_proposal('66660000-0000-4000-8000-000000000031'::uuid, '{}'::jsonb)->>'reason'),
  'capability_suspended',
  'capacité operator suspendue pour cet établissement → capability_suspended'
);

reset role;
update partner_capabilities set status = 'active'
 where partner_id = '66660000-0000-4000-8000-000000000001' and role = 'operator';
set local role authenticated;

select test_login('66660000-0000-4000-8000-000000000023');
select is(
  (select submit_product_proposal('66660000-0000-4000-8000-000000000033'::uuid, '{}'::jsonb)->>'reason'),
  'capability_suspended',
  'aucune ligne operator du tout pour cet établissement → capability_suspended (même raison)'
);

select test_login('66660000-0000-4000-8000-000000000021');

-- Plafond de propositions en attente -------------------------------------------------------------
reset role;
insert into product_proposals (product_id, partner_id, submitted_by, payload, status)
select
  '66660000-0000-4000-8000-000000000031',
  '66660000-0000-4000-8000-000000000001',
  '66660000-0000-4000-8000-000000000021',
  jsonb_build_object('name', jsonb_build_object('es', 'Dummy ' || n)),
  'pending'
from generate_series(1, 10) as n;
set local role authenticated;
select test_login('66660000-0000-4000-8000-000000000021');

select is(
  (select submit_product_proposal('66660000-0000-4000-8000-000000000031'::uuid, '{}'::jsonb)->>'reason'),
  'pending_cap_exceeded',
  '10 propositions déjà en attente → pending_cap_exceeded'
);

reset role;
delete from product_proposals where partner_id = '66660000-0000-4000-8000-000000000001';
set local role authenticated;
select test_login('66660000-0000-4000-8000-000000000021');

-- Soumission valide + preuve du filtrage du payload (propriété de sûreté n°2) --------------------
-- Whitelist étendue par type (spec 15 bis, 20260817150000) — miroir de ProductForm en mode
-- édition : plus seulement name/description/price_cop/category (category abandonné, cf. tête de
-- cette migration), le produit fixture est type='activity' → address/lat/lon/price_tiers/min_qty/
-- max_qty rejoignent la whitelist (null ici, absents du payload soumis), jamais category/sellable/
-- acompte_pct/champo_arbitrario.
select lives_ok(
  $$ select submit_product_proposal(
       '66660000-0000-4000-8000-000000000031'::uuid,
       jsonb_build_object(
         'name', jsonb_build_object('es', 'Nombre editado'),
         'description', jsonb_build_object('es', 'Descripción editada'),
         'price_cop', 95000,
         -- Cupo diario por defecto (spec 18) — activity est dans le groupe hasDefaultCapacity,
         -- doit survivre la whitelist au même titre que price_cop.
         'default_capacity', 7,
         'category', 'adrenalina',
         'sellable', true,
         'acompte_pct', 0.99,
         'champo_arbitrario', 'valeur piégée'
       )
     ) $$,
  'une soumission valide (avec un payload piégé de champs supplémentaires) réussit'
);

select is(
  (select count(*) from product_proposals
    where product_id = '66660000-0000-4000-8000-000000000031' and status = 'pending')::int,
  1,
  'une proposition pending a bien été créée'
);
select is(
  (select payload from product_proposals
    where product_id = '66660000-0000-4000-8000-000000000031' and status = 'pending'),
  jsonb_build_object(
    'name', jsonb_build_object('es', 'Nombre editado'),
    'description', jsonb_build_object('es', 'Descripción editada'),
    'address', null, 'lat', null, 'lon', null,
    'price_cop', 95000, 'price_tiers', null, 'min_qty', null, 'max_qty', null,
    'default_capacity', 7,
    -- Spec 43 (20261025140000) : mode et personnes d'une activité, null quand l'écran ne les envoie pas.
    'pricing_unit', null, 'min_persons', null, 'max_persons', null,
    -- Ajoutées le 2026-09-09 (migration 20260909180000) : la vitrine n'est plus réservée aux
    -- eventos, donc submit_product_proposal whitelist ces deux clés pour TOUS les types. Elles
    -- valent null ici parce que le payload soumis plus haut ne les porte pas — et c'est
    -- volontaire : la clé PRÉSENTE à null dit « le socio a soumis sans URL, retire-la », que
    -- moderate_product_proposal distingue d'une clé ABSENTE (proposition d'avant la migration,
    -- dont l'approbation doit préserver l'URL déjà posée).
    'external_booking_url', null, 'price_label', null
  ),
  'whitelist par type (activity) dans payload — jamais category/sellable/acompte_pct/champo_arbitrario'
);
select is(
  (select (payload->>'default_capacity')::int from product_proposals
    where product_id = '66660000-0000-4000-8000-000000000031' and status = 'pending'),
  7,
  'default_capacity (cupo diario) survit le round-trip payload → whitelist de submit_product_proposal'
);

-- withdraw_product_proposal : propriétaire sur pending → withdrawn ------------------------------
select is(
  (
    select withdraw_product_proposal(
      (select id from product_proposals
        where product_id = '66660000-0000-4000-8000-000000000031' and status = 'pending')
    )->>'ok'
  ),
  'true',
  'withdraw par le propriétaire sur une proposition pending réussit'
);
select is(
  (select status from product_proposals
    where product_id = '66660000-0000-4000-8000-000000000031'
    order by created_at desc limit 1),
  'withdrawn',
  'le statut passe bien à withdrawn'
);

-- Nouvelle proposition pending : refus par un tiers, puis retrait propriétaire, puis « déjà traité »
create temp table tmp_target_proposal as
  select (submit_product_proposal('66660000-0000-4000-8000-000000000031'::uuid, '{}'::jsonb)->>'proposal_id')::uuid as id;

select test_login('66660000-0000-4000-8000-000000000022');
select is(
  (select withdraw_product_proposal((select id from tmp_target_proposal))->>'reason'),
  'proposal_not_found',
  'un autre partenaire ne peut pas retirer une proposition qui n''est pas la sienne'
);

select test_login('66660000-0000-4000-8000-000000000021');
select is(
  (select withdraw_product_proposal((select id from tmp_target_proposal))->>'ok'),
  'true',
  'le propriétaire peut retirer sa propre proposition pending'
);
select is(
  (select withdraw_product_proposal((select id from tmp_target_proposal))->>'reason'),
  'not_pending',
  'retirer une proposition déjà traitée (withdrawn) échoue avec not_pending'
);

drop table tmp_target_proposal;

-- RLS product_proposals : chacun voit ses propres propositions, pas celles d'un autre partenaire,
-- l'admin voit tout --------------------------------------------------------------------------
reset role;
insert into product_proposals (product_id, partner_id, submitted_by, payload) values (
  '66660000-0000-4000-8000-000000000032', '66660000-0000-4000-8000-000000000002',
  '66660000-0000-4000-8000-000000000022', jsonb_build_object('name', jsonb_build_object('es', 'Other proposal'))
);
set local role authenticated;

select test_login('66660000-0000-4000-8000-000000000021');
select is(
  (select count(*) from product_proposals where partner_id <> '66660000-0000-4000-8000-000000000001')::int,
  0,
  'own_account ne voit aucune proposition d''un autre partenaire (RLS product_proposals_select_own)'
);

select test_login('66660000-0000-4000-8000-000000000024');
select is(
  (select count(*) from product_proposals)::int >= 2,
  true,
  'admin voit les propositions de tous les partenaires (RLS product_proposals_select_admin)'
);

-- RLS products_select_own : own voit son propre produit non vendable, other ne le voit pas -------
select test_login('66660000-0000-4000-8000-000000000021');
select is(
  (select count(*) from products where id = '66660000-0000-4000-8000-000000000031')::int,
  1,
  'own_account voit son propre produit non vendable via products_select_own'
);

select test_login('66660000-0000-4000-8000-000000000022');
select is(
  (select count(*) from products where id = '66660000-0000-4000-8000-000000000031')::int,
  0,
  'other_account ne voit pas le produit non vendable d''own (ni products_select_public ni products_select_own)'
);

-- Vitrine à la modération (migration 20260909180000) : clé ABSENTE vs clé PRÉSENTE à null -------
-- Ces deux cas ne se distinguent pas par `->>`, qui rend NULL dans les deux. C'est exactement ce
-- que le `case when v_final_payload ? '...'` de moderate_product_proposal tranche, et sans ces
-- deux assertions rien ne le vérifierait (CLAUDE.md §11.20).
reset role;
update products set external_booking_url = 'https://vitrine-a-preserver.example'
 where id = '66660000-0000-4000-8000-000000000031';

-- Cas 1 — proposition d'AVANT la migration : la clé n'est pas dans le payload, l'URL doit survivre.
insert into product_proposals (id, product_id, partner_id, submitted_by, payload, status, kind, version)
values ('66660000-0000-4000-8000-000000000041', '66660000-0000-4000-8000-000000000031',
        '66660000-0000-4000-8000-000000000001', '66660000-0000-4000-8000-000000000021',
        jsonb_build_object('name', jsonb_build_object('es', 'Nombre sin clave'),
                           'price_cop', 50000), 'pending', 'content', 0);

set local role authenticated;
select test_login('66660000-0000-4000-8000-000000000024');
select public.moderate_product_proposal('66660000-0000-4000-8000-000000000041', 'approve', 0);

reset role;
select is(
  (select external_booking_url from products where id = '66660000-0000-4000-8000-000000000031'),
  'https://vitrine-a-preserver.example',
  'approuver une proposition SANS la clé external_booking_url préserve l''URL déjà posée'
);

-- Cas 2 — proposition d'APRÈS la migration : la clé est là, à null. Le socio a soumis sans URL,
-- donc il la retire : l'effacement est voulu, pas un effet de bord.
insert into product_proposals (id, product_id, partner_id, submitted_by, payload, status, kind, version)
values ('66660000-0000-4000-8000-000000000042', '66660000-0000-4000-8000-000000000031',
        '66660000-0000-4000-8000-000000000001', '66660000-0000-4000-8000-000000000021',
        jsonb_build_object('name', jsonb_build_object('es', 'Nombre con clave nula'),
                           'price_cop', 50000,
                           'external_booking_url', null), 'pending', 'content', 0);

set local role authenticated;
select test_login('66660000-0000-4000-8000-000000000024');
select public.moderate_product_proposal('66660000-0000-4000-8000-000000000042', 'approve', 0);

reset role;
select is(
  (select external_booking_url from products where id = '66660000-0000-4000-8000-000000000031'),
  null,
  'approuver une proposition dont la clé est PRÉSENTE à null efface bien l''URL (retrait voulu)'
);

select * from finish();
rollback;

-- Correctif Tranche 2/3 — RPC set_product_availability + reclassement RPC-only de
-- product_calendar.
-- Résolu (feature 6, 2026-08-13) : reserve_order_line a été remplacée par create_order
-- (20260813243000_create_order_rpc.sql), qui reprend la même logique de fermeture de calendrier
-- (product_calendar.open explicite, sinon products.calendar_default_open) — les 3 cas qui
-- exerçaient ce comportement via reserve_order_line ci-dessous ont donc été retirés ; la
-- couverture équivalente vit maintenant dans create_order.test.sql (cas 13). Les tests
-- set_product_availability ci-dessous restent inchangés (feature 17 change son contrat de
-- sortie, exception → jsonb {ok, reason}).
begin;
select plan(16);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Motif de refus de set_product_availability, ou « sqlstate <code> » si elle lève : sans la garde
-- invalid_capacity, une capacité négative sur une date neuve heurte la contrainte booked <= capacity
-- (23514) — le helper en fait une valeur, l'assertion rougit sans interrompre le fichier (même
-- dispositif que test_try_create_order, create_order_qty_guard.test.sql).
create function test_try_set_availability(p_date date, p_capacity int) returns text
language plpgsql as $$
begin
  return set_product_availability('c0000000-0000-4000-8000-000000000005', p_date, p_capacity)->>'reason';
exception when others then
  return 'sqlstate ' || sqlstate;
end;
$$;

insert into partners (id, display_name) values
  ('c0000000-0000-4000-8000-000000000001', 'Availability RPC Test Partner');

insert into establishments (id, partner_id, name) values
  ('c0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Availability RPC Test Establishment'));

insert into auth.users (id, email) values
  ('c0000000-0000-4000-8000-000000000003', 'availrpc-admin@test.local'),
  ('c0000000-0000-4000-8000-000000000004', 'availrpc-buyer@test.local');

insert into partner_capabilities (account_id, role, source, status)
  values ('c0000000-0000-4000-8000-000000000003', 'admin', 'migration', 'active');

-- Produit A : calendar_default_open = true (défaut de la Tranche 2, comportement inchangé).
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
values (
  'c0000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000002', 'activity',
  jsonb_build_object('es', 'Actividad A'), 50000, true, 'actividad-a-availrpc'
);

-- date5 (produit A) : déjà configurée, 3 places déjà vendues — pour les tests capacité ci-dessous.
insert into product_availability (product_id, date, capacity, booked) values
  ('c0000000-0000-4000-8000-000000000005', '2027-02-02', 5, 3);

set local role authenticated;
select test_login('c0000000-0000-4000-8000-000000000004');

-- set_product_availability : non-admin refusé, rien créé ----------------------------------------
-- Corrigé (feature 17) : set_product_availability ne lève plus d'exception pour un appelant
-- non-admin — refactor du contrat de sortie en jsonb {ok, reason}, cf.
-- set_product_availability_socio.test.sql pour la couverture complète des 3 nouveaux garde-fous
-- (identité/propriété/capacité). Ce compte acheteur n'a jamais été rattaché à un partenaire
-- (v_partner_id resterait null), donc la vérification de propriété échoue en premier :
-- product_not_found, pas capability_suspended.
select is(
  (select set_product_availability('c0000000-0000-4000-8000-000000000005'::uuid, '2027-03-01'::date, 8)->>'reason'),
  'product_not_found',
  'set_product_availability refuse un appelant non-admin (product_not_found, plus une exception depuis feature 17)'
);
select is(
  (select count(*) from product_availability
    where product_id = 'c0000000-0000-4000-8000-000000000005' and date = '2027-03-01')::int,
  0,
  'aucune ligne product_availability créée par l''appel non-admin refusé'
);

-- admin : audit_log encore vide à ce stade (rien créé par le refus non-admin ci-dessus) -------
set local role authenticated;
select test_login('c0000000-0000-4000-8000-000000000003');
-- Scopé au produit visé par le refus, jamais en absolu (audit_log d'une base seedée n'est pas vide).
select is(
  (select count(*) from audit_log where entity_id = 'c0000000-0000-4000-8000-000000000005')::int, 0,
  'aucune ligne audit_log créée par l''appel set_product_availability refusé'
);

-- set_product_availability : admin, date jamais configurée → création atomique ----------------
select lives_ok(
  $$ select set_product_availability('c0000000-0000-4000-8000-000000000005', '2027-03-01', 8, true, 'create-date4') $$,
  'set_product_availability réussit pour l''admin sur une date jamais configurée'
);
select is(
  (select jsonb_build_object('capacity', capacity, 'booked', booked) from product_availability
    where product_id = 'c0000000-0000-4000-8000-000000000005' and date = '2027-03-01'),
  jsonb_build_object('capacity', 8, 'booked', 0),
  'product_availability créée (capacity=8, booked=0)'
);
select is(
  (select open from product_calendar
    where product_id = 'c0000000-0000-4000-8000-000000000005' and date = '2027-03-01'),
  true,
  'product_calendar créée dans la même transaction'
);
select is(
  (select count(*) from audit_log where note = 'create-date4')::int, 1,
  'une ligne audit_log créée par la création admin'
);

-- set_product_availability : p_capacity < booked → refusé, rien modifié -------------------------
-- Corrigé (feature 17) : below_booked est désormais un refus jsonb {ok:false, reason, booked},
-- plus une exception — inchangé pour le reste (logique de capacité identique, cf. plan feature 17
-- "chemin admin strictement inchangé").
select is(
  (select set_product_availability('c0000000-0000-4000-8000-000000000005'::uuid, '2027-02-02'::date, 2)),
  jsonb_build_object('ok', false, 'reason', 'below_booked', 'booked', 3),
  'set_product_availability refuse une capacité inférieure aux places déjà vendues (below_booked)'
);

-- Capacité négative (20261001144546) : motif métier, avant tout autre contrôle, comme
-- set_product_slot_capacity. Sur une date déjà configurée, sans la garde, below_booked masquait la
-- vraie raison ; sur une date neuve, la contrainte booked <= capacity levait 23514.
select is(
  test_try_set_availability('2027-02-02', -1),
  'invalid_capacity',
  'capacité négative sur une date configurée : invalid_capacity, pas below_booked'
);
select is(
  test_try_set_availability('2027-04-01', -1),
  'invalid_capacity',
  'capacité négative sur une date neuve : invalid_capacity, pas une erreur de contrainte'
);
select is(
  (select jsonb_build_object('capacity', capacity, 'booked', booked) from product_availability
    where product_id = 'c0000000-0000-4000-8000-000000000005' and date = '2027-02-02'),
  jsonb_build_object('capacity', 5, 'booked', 3),
  'product_availability inchangée après un refus capacité < booked'
);

-- set_product_availability : admin, date déjà configurée, capacité valide → mise à jour -------
select lives_ok(
  $$ select set_product_availability('c0000000-0000-4000-8000-000000000005', '2027-02-02', 10, false, 'update-date5') $$,
  'set_product_availability réussit pour une mise à jour valide (capacity >= booked)'
);
select is(
  (select capacity from product_availability
    where product_id = 'c0000000-0000-4000-8000-000000000005' and date = '2027-02-02'),
  10,
  'capacity mise à jour'
);
select is(
  (select open from product_calendar
    where product_id = 'c0000000-0000-4000-8000-000000000005' and date = '2027-02-02'),
  false,
  'product_calendar mise à jour (upsert)'
);
select is(
  (select count(*) from audit_log where note = 'update-date5')::int, 1,
  'une ligne audit_log créée par la mise à jour admin'
);

-- product_calendar reclassée RPC-only : écriture directe refusée, même pour l'admin -----------
select throws_ok(
  $$ update product_calendar set open = true
     where product_id = 'c0000000-0000-4000-8000-000000000005' and date = '2027-02-02' $$,
  '42501'::char(5), null,
  'l''admin ne peut plus écrire product_calendar en direct (RPC-only, grants révoqués)'
);

select * from finish();
rollback;

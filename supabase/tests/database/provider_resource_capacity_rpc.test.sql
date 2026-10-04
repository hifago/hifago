-- Feature 20 (Admin : créer et réserver un camp multi-jours) — set_provider_resource_capacity.
-- Parallèle à set_product_availability (feature 5/17) mais sur une clé établissement+date, sans
-- notion 'open' — cf. plan.
begin;
select plan(12);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Motif de refus, ou « sqlstate <code> » si la RPC lève : sans la garde invalid_capacity, une
-- capacité négative sur une date neuve heurte la contrainte booked <= capacity (23514) — le helper
-- en fait une valeur, l'assertion rougit sans interrompre le fichier.
create function test_try_set_resource_capacity(p_date date, p_capacity int) returns text
language plpgsql as $$
begin
  return set_provider_resource_capacity('cc110000-0000-4000-8000-000000000011', p_date, p_capacity)->>'reason';
exception when others then
  return 'sqlstate ' || sqlstate;
end;
$$;

-- Fixtures : 1 partenaire/établissement, 1 admin, 1 non-admin. Une ligne provider_resource_calendar
-- déjà posée (capacity=5, booked=3) pour le cas below_booked — insert direct, rôle privilégié
-- avant le switch (RPC-only, authenticated n'a pas le droit d'écrire directement).
insert into partners (id, display_name) values
  ('cc110000-0000-4000-8000-000000000001', 'Resource Capacity Test Partner');
insert into establishments (id, partner_id, name) values
  ('cc110000-0000-4000-8000-000000000011', 'cc110000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Resource Capacity'));

insert into auth.users (id, email) values
  ('cc110000-0000-4000-8000-000000000021', 'resource-capacity-admin@test.local'),
  ('cc110000-0000-4000-8000-000000000022', 'resource-capacity-nonadmin@test.local');
insert into partner_capabilities (account_id, role, source, status) values
  ('cc110000-0000-4000-8000-000000000021', 'admin', 'migration', 'active');

insert into provider_resource_calendar (establishment_id, slot_date, capacity, booked) values
  ('cc110000-0000-4000-8000-000000000011', '2028-06-01', 5, 3);

set local role authenticated;
select test_login('cc110000-0000-4000-8000-000000000022');

-- Non-admin → exception -----------------------------------------------------------------------
select throws_ok(
  $$ select set_provider_resource_capacity(
       'cc110000-0000-4000-8000-000000000011'::uuid, '2028-06-01'::date, 10
     ) $$,
  '42501'::char(5), 'set_provider_resource_capacity réservé au rôle admin',
  'set_provider_resource_capacity refuse un appelant non-admin'
);

select test_login('cc110000-0000-4000-8000-000000000021');

-- p_capacity < booked actuel → below_booked, aucune écriture -------------------------------------
select lives_ok(
  $$ select set_provider_resource_capacity(
       'cc110000-0000-4000-8000-000000000011'::uuid, '2028-06-01'::date, 2, 'trop bas'
     ) $$,
  'set_provider_resource_capacity (capacité sous booked) réussit à répondre (refus métier, pas une exception)'
);
select is(
  (select (set_provider_resource_capacity(
     'cc110000-0000-4000-8000-000000000011'::uuid, '2028-06-01'::date, 2
   )->>'reason')),
  'below_booked',
  'refuse une capacité inférieure au booked actuel'
);
select is(
  (select (set_provider_resource_capacity(
     'cc110000-0000-4000-8000-000000000011'::uuid, '2028-06-01'::date, 2
   )->>'booked')::int),
  3,
  'le refus indique le booked actuel (3)'
);
select is(
  (select capacity from provider_resource_calendar
    where establishment_id = 'cc110000-0000-4000-8000-000000000011' and slot_date = '2028-06-01'),
  5,
  'capacité inchangée (toujours 5) après un refus below_booked'
);

-- Capacité négative (20261001144546) : motif invalid_capacity avant tout autre contrôle, comme
-- set_product_slot_capacity — sur une date configurée (sinon below_booked) et sur une date neuve
-- (sinon erreur de contrainte booked <= capacity).
select is(
  test_try_set_resource_capacity('2028-06-01', -1),
  'invalid_capacity',
  'capacité négative sur une date configurée : invalid_capacity, pas below_booked'
);
select is(
  test_try_set_resource_capacity('2028-07-01', -1),
  'invalid_capacity',
  'capacité négative sur une date neuve : invalid_capacity, pas une erreur de contrainte'
);

-- Admin valide, ligne déjà existante → mise à jour + audit_log -----------------------------------
select lives_ok(
  $$ select set_provider_resource_capacity(
       'cc110000-0000-4000-8000-000000000011'::uuid, '2028-06-01'::date, 10, 'ajustement admin'
     ) $$,
  'set_provider_resource_capacity réussit pour l''admin (capacité >= booked)'
);
select is(
  (select capacity from provider_resource_calendar
    where establishment_id = 'cc110000-0000-4000-8000-000000000011' and slot_date = '2028-06-01'),
  10,
  'capacité mise à jour à 10'
);
select is(
  (select jsonb_build_object('action', action, 'before', before, 'after', after) from audit_log
    where note = 'ajustement admin'),
  jsonb_build_object(
    'action', 'establishment.set_resource_capacity',
    'before', jsonb_build_object('date', '2028-06-01', 'capacity', 5, 'booked', 3),
    'after', jsonb_build_object('date', '2028-06-01', 'capacity', 10)
  ),
  'audit_log enregistre before/after corrects'
);

-- Admin valide, AUCUNE ligne existante pour cette date → insertion (booked=0 par défaut) ----------
select lives_ok(
  $$ select set_provider_resource_capacity(
       'cc110000-0000-4000-8000-000000000011'::uuid, '2028-06-02'::date, 8
     ) $$,
  'set_provider_resource_capacity réussit pour une date sans ligne existante (insertion)'
);
select is(
  (select jsonb_build_object('capacity', capacity, 'booked', booked) from provider_resource_calendar
    where establishment_id = 'cc110000-0000-4000-8000-000000000011' and slot_date = '2028-06-02'),
  jsonb_build_object('capacity', 8, 'booked', 0),
  'nouvelle ligne insérée avec capacity=8, booked=0 par défaut'
);

select * from finish();
rollback;

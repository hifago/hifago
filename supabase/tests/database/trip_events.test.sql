-- trip_events (spec 42, migration 20261019190000) : un evento non réservable noté dans Mi viaje.
--   - insert : seulement pour soi, seulement un evento NON réservable en ligne et publié ;
--   - doublon refusé (23505) ; aucun update ;
--   - lecture et retrait : ses propres lignes seulement ; anon n'y a aucun accès ;
--   - trip_events_status() : la date est-elle encore une occurrence (expand_event_occurrences) ;
--   - cascade : un produit ou une identité supprimés emportent leurs lignes.
begin;
select plan(19);

insert into partners (id, display_name) values
  ('c42e0000-0000-4000-8000-000000000001', 'Trip Events Partner');
insert into establishments (id, partner_id, name) values
  ('c42e0000-0000-4000-8000-000000000011', 'c42e0000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Trip Events'));

-- 021 : evento vitrine, une fois le 2029-12-05 ; 022 : evento vitrine tous les 7 jours depuis le
-- 2029-12-01 ; 023 : evento réservable en ligne ; 024 : evento vitrine NON publié ; 025 : activité.
insert into products (
  id, partner_id, establishment_id, type, name, sellable, slug,
  occurrence_type, occurrence_date, recurrence_frequency_days
) values
  ('c42e0000-0000-4000-8000-000000000021', 'c42e0000-0000-4000-8000-000000000001',
   'c42e0000-0000-4000-8000-000000000011', 'evento', jsonb_build_object('es', 'Concierto Trip'),
   true, 'trip-events-once', 'once', '2029-12-05', null),
  ('c42e0000-0000-4000-8000-000000000022', 'c42e0000-0000-4000-8000-000000000001',
   'c42e0000-0000-4000-8000-000000000011', 'evento', jsonb_build_object('es', 'Mercado Trip'),
   true, 'trip-events-recurring', 'recurring', '2029-12-01', 7),
  ('c42e0000-0000-4000-8000-000000000024', 'c42e0000-0000-4000-8000-000000000001',
   'c42e0000-0000-4000-8000-000000000011', 'evento', jsonb_build_object('es', 'Oculto Trip'),
   false, 'trip-events-hidden', 'once', '2029-12-05', null);
insert into products (
  id, partner_id, establishment_id, type, name, price_cop, sellable, slug,
  online_bookable, evento_capacity_mode, evento_payment_mode, occurrence_type, occurrence_date,
  evento_occupies_resource
) values
  ('c42e0000-0000-4000-8000-000000000023', 'c42e0000-0000-4000-8000-000000000001',
   'c42e0000-0000-4000-8000-000000000011', 'evento', jsonb_build_object('es', 'Reservable Trip'),
   30000, true, 'trip-events-bookable', true, 'unlimited', 'online', 'once', '2029-12-05', false);
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('c42e0000-0000-4000-8000-000000000025', 'c42e0000-0000-4000-8000-000000000001',
   'c42e0000-0000-4000-8000-000000000011', 'activity', jsonb_build_object('es', 'Actividad Trip'),
   30000, true, 'trip-events-activity');

-- A = 031, B = 032 (partner_accounts provisionnées par le trigger d'auth.users).
insert into auth.users (id, email) values
  ('c42e0000-0000-4000-8000-000000000031', 'trip-events-a@test.local'),
  ('c42e0000-0000-4000-8000-000000000032', 'trip-events-b@test.local');

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- ── En A ────────────────────────────────────────────────────────────────────────────────────────
select test_login('c42e0000-0000-4000-8000-000000000031');
set local role authenticated;

select lives_ok(
  $$insert into public.trip_events (account_id, product_id, date) values
      ('c42e0000-0000-4000-8000-000000000031', 'c42e0000-0000-4000-8000-000000000021', '2029-12-05'),
      ('c42e0000-0000-4000-8000-000000000031', 'c42e0000-0000-4000-8000-000000000022', '2029-12-15'),
      ('c42e0000-0000-4000-8000-000000000031', 'c42e0000-0000-4000-8000-000000000022', '2029-12-16')$$,
  'A note un evento vitrine (une fois, puis récurrent) — même à une date hors occurrence'
);
select throws_ok(
  $$insert into public.trip_events (account_id, product_id, date) values
      ('c42e0000-0000-4000-8000-000000000031', 'c42e0000-0000-4000-8000-000000000021', '2029-12-05')$$,
  '23505', null,
  'le même evento à la même date une seconde fois : doublon refusé'
);
select throws_ok(
  $$insert into public.trip_events (account_id, product_id, date) values
      ('c42e0000-0000-4000-8000-000000000031', 'c42e0000-0000-4000-8000-000000000023', '2029-12-05')$$,
  '42501', null,
  'un evento réservable en ligne passe par le panier, jamais par trip_events'
);
select throws_ok(
  $$insert into public.trip_events (account_id, product_id, date) values
      ('c42e0000-0000-4000-8000-000000000031', 'c42e0000-0000-4000-8000-000000000024', '2029-12-05')$$,
  '42501', null,
  'un evento non publié est refusé'
);
select throws_ok(
  $$insert into public.trip_events (account_id, product_id, date) values
      ('c42e0000-0000-4000-8000-000000000031', 'c42e0000-0000-4000-8000-000000000025', '2029-12-05')$$,
  '42501', null,
  'une activité n''est pas un evento'
);
select throws_ok(
  $$insert into public.trip_events (account_id, product_id, date) values
      ('c42e0000-0000-4000-8000-000000000032', 'c42e0000-0000-4000-8000-000000000021', '2029-12-05')$$,
  '42501', null,
  'A ne note rien au nom de B'
);
select throws_ok(
  $$update public.trip_events set date = '2029-12-22'
     where product_id = 'c42e0000-0000-4000-8000-000000000022'$$,
  '42501', null,
  'aucun update : changer de date = retirer puis ajouter'
);
select is(
  (select count(*)::int from public.trip_events),
  3,
  'A lit ses trois lignes'
);
select results_eq(
  $$select p.slug::text, te.date, s.on_occurrence
      from public.trip_events_status() s
      join public.trip_events te on te.id = s.id
      join public.products p on p.id = te.product_id
     order by p.slug, te.date$$,
  $$values ('trip-events-once'::text, '2029-12-05'::date, true),
           ('trip-events-recurring', '2029-12-15'::date, true),
           ('trip-events-recurring', '2029-12-16'::date, false)$$,
  'trip_events_status : une fois à sa date, récurrent sur la série, et hors série signalé'
);

-- ── En B ────────────────────────────────────────────────────────────────────────────────────────
reset role;
select test_login('c42e0000-0000-4000-8000-000000000032');
set local role authenticated;

select is((select count(*)::int from public.trip_events), 0, 'B ne voit aucune ligne de A');
select is((select count(*)::int from public.trip_events_status()), 0, 'trip_events_status de B : vide');
delete from public.trip_events;
select lives_ok(
  $$insert into public.trip_events (account_id, product_id, date) values
      ('c42e0000-0000-4000-8000-000000000032', 'c42e0000-0000-4000-8000-000000000021', '2029-12-05')$$,
  'B note le même evento à la même date que A : chacun son voyage'
);

reset role;
select is(
  (select count(*)::int from public.trip_events
    where account_id = 'c42e0000-0000-4000-8000-000000000031'),
  3,
  'le delete de B n''a rien retiré à A'
);

-- ── A retire une ligne ──────────────────────────────────────────────────────────────────────────
select test_login('c42e0000-0000-4000-8000-000000000031');
set local role authenticated;
delete from public.trip_events where date = '2029-12-16';
reset role;
select is(
  (select count(*)::int from public.trip_events
    where account_id = 'c42e0000-0000-4000-8000-000000000031'),
  2,
  'A retire sa propre ligne'
);

-- ── anon ────────────────────────────────────────────────────────────────────────────────────────
select ok(
  not has_table_privilege('anon', 'public.trip_events', 'SELECT')
  and not has_table_privilege('anon', 'public.trip_events', 'INSERT'),
  'anon n''a aucun accès à trip_events'
);
select ok(
  not has_function_privilege('anon', 'public.trip_events_status()', 'EXECUTE'),
  'anon ne peut pas exécuter trip_events_status'
);
select ok(
  not has_table_privilege('authenticated', 'public.trip_events', 'UPDATE'),
  'authenticated n''a pas le droit UPDATE'
);

-- ── Cascades ────────────────────────────────────────────────────────────────────────────────────
delete from public.products where id = 'c42e0000-0000-4000-8000-000000000022';
select is(
  (select count(*)::int from public.trip_events
    where product_id = 'c42e0000-0000-4000-8000-000000000022'),
  0,
  'un produit supprimé emporte ses lignes trip_events'
);
delete from auth.users where id = 'c42e0000-0000-4000-8000-000000000032';
select is(
  (select count(*)::int from public.trip_events
    where account_id = 'c42e0000-0000-4000-8000-000000000032'),
  0,
  'une identité supprimée emporte ses lignes trip_events'
);

select * from finish();
rollback;

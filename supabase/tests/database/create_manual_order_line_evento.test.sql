-- create_manual_order_line pour un evento (migration 20261006203542) : les prédicats de create_order.
-- Compteur product_availability pour le seul mode `metered` ; ressource partagée et blocage d'agenda
-- pour un evento qui l'occupe, `online_bookable` ignoré ; prix 0 pour un evento gratuit ; date hors
-- occurrence refusée pour un evento vendu en ligne ; aucun refus ne laisse un compteur incrémenté.
-- La course contre create_order : tests/concurrency/create_manual_order_line_evento_vs_camp.
begin;
select plan(29);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Fixtures : un partenaire operator de son établissement (operator ⇒ referrer), six eventos qui
-- couvrent chaque prédicat, une activité témoin. D1 = 2029-07-01 (occurrence des eventos vendus en
-- ligne, ressource 2) ; D2 sans ressource ; D3 ressource 1 ; D4 hors occurrence.
insert into partners (id, display_name) values ('7b700000-0000-4000-8000-000000000001', 'Manual Evento');
insert into establishments (id, partner_id, name) values
  ('7b700000-0000-4000-8000-000000000011', '7b700000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Manual Evento'));
insert into auth.users (id, email) values
  ('7b700000-0000-4000-8000-000000000021', 'manual-evento-operator@test.local'),
  -- Compte technique des réservations walk-in (même raison que create_manual_order_line.test.sql).
  ('e0000000-0000-4000-8000-000000000001', 'reserva-manual@hifago.local')
on conflict (id) do nothing;
update partner_accounts set partner_id = '7b700000-0000-4000-8000-000000000001'
 where id = '7b700000-0000-4000-8000-000000000021';
insert into partner_capabilities (partner_id, role, source, status) values
  ('7b700000-0000-4000-8000-000000000001', 'referrer', 'migration', 'active');
insert into partner_capabilities (partner_id, role, establishment_id, source, status) values
  ('7b700000-0000-4000-8000-000000000001', 'operator', '7b700000-0000-4000-8000-000000000011',
   'migration', 'active');

insert into products (id, partner_id, establishment_id, type, name, slug, sellable, price_cop, is_free,
                      online_bookable, evento_capacity_mode, evento_payment_mode, evento_occupies_resource,
                      default_capacity, occurrence_type, occurrence_date) values
  -- 31 : metered, occupe la ressource, vendu en ligne.
  ('7b700000-0000-4000-8000-000000000031', '7b700000-0000-4000-8000-000000000001',
   '7b700000-0000-4000-8000-000000000011', 'evento', jsonb_build_object('es', 'Evento metered'),
   'manual-evento-metered', true, 30000, false, true, 'metered', 'online', true, 3, 'once', '2029-07-01'),
  -- 32 : jamais vendu en ligne (mode NULL), occupe la ressource (défaut).
  ('7b700000-0000-4000-8000-000000000032', '7b700000-0000-4000-8000-000000000001',
   '7b700000-0000-4000-8000-000000000011', 'evento', jsonb_build_object('es', 'Evento presencial'),
   'manual-evento-presencial', true, 10000, false, false, null, null, true, null, null, null),
  -- 33 : rsvp, n'occupe pas la ressource.
  ('7b700000-0000-4000-8000-000000000033', '7b700000-0000-4000-8000-000000000001',
   '7b700000-0000-4000-8000-000000000011', 'evento', jsonb_build_object('es', 'Evento rsvp'),
   'manual-evento-rsvp', true, 20000, false, true, 'rsvp', 'online', false, 2, 'once', '2029-07-01'),
  -- 34 : gratuit, unlimited, sans capacité par défaut.
  ('7b700000-0000-4000-8000-000000000034', '7b700000-0000-4000-8000-000000000001',
   '7b700000-0000-4000-8000-000000000011', 'evento', jsonb_build_object('es', 'Evento libre'),
   'manual-evento-libre', true, null, true, true, 'unlimited', null, false, null, 'once', '2029-07-01'),
  -- 35 : metered, payé sur place, capacité 1.
  ('7b700000-0000-4000-8000-000000000035', '7b700000-0000-4000-8000-000000000001',
   '7b700000-0000-4000-8000-000000000011', 'evento', jsonb_build_object('es', 'Evento en sitio'),
   'manual-evento-en-sitio', true, 25000, false, true, 'metered', 'on_site', false, 1, 'once', '2029-07-01'),
  -- 36 : à créneaux, jamais vendu en ligne, occupe la ressource.
  ('7b700000-0000-4000-8000-000000000036', '7b700000-0000-4000-8000-000000000001',
   '7b700000-0000-4000-8000-000000000011', 'evento', jsonb_build_object('es', 'Evento con horario'),
   'manual-evento-horario', true, 15000, false, false, null, null, true, null, null, null);
-- 38 : metered à créneaux, n'occupe pas la ressource — le créneau seul compte, comme create_order.
insert into products (id, partner_id, establishment_id, type, name, slug, sellable, price_cop, is_free,
                      online_bookable, evento_capacity_mode, evento_payment_mode, evento_occupies_resource,
                      default_capacity, occurrence_type, occurrence_date)
values ('7b700000-0000-4000-8000-000000000038', '7b700000-0000-4000-8000-000000000001',
        '7b700000-0000-4000-8000-000000000011', 'evento', jsonb_build_object('es', 'Evento metered con horario'),
        'manual-evento-metered-horario', true, 12000, false, true, 'metered', 'online', false, 4, 'once', '2029-07-01');
insert into product_slot_rules (product_id, weekdays, start_time, end_time, slot_duration_minutes, capacity)
values ('7b700000-0000-4000-8000-000000000038', array[1, 2, 3, 4, 5, 6, 7]::smallint[], '09:00', '10:00', 60, 2);
-- 37 : activité témoin (evento_occupies_resource vaut true par défaut sur tout produit).
insert into products (id, partner_id, establishment_id, type, name, slug, sellable, price_cop, default_capacity)
values ('7b700000-0000-4000-8000-000000000037', '7b700000-0000-4000-8000-000000000001',
        '7b700000-0000-4000-8000-000000000011', 'activity', jsonb_build_object('es', 'Actividad testigo'),
        'manual-evento-actividad', true, 5000, 5);
insert into product_slot_rules (product_id, weekdays, start_time, end_time, slot_duration_minutes, capacity)
values ('7b700000-0000-4000-8000-000000000036', array[1, 2, 3, 4, 5, 6, 7]::smallint[], '09:00', '12:00', 60, 5);

insert into provider_resource_calendar (establishment_id, slot_date, capacity, booked) values
  ('7b700000-0000-4000-8000-000000000011', '2029-07-01', 2, 0),
  ('7b700000-0000-4000-8000-000000000011', '2029-07-03', 1, 0);
-- Une ligne déjà matérialisée et pleine pour l'evento rsvp (ancien chemin) : l'incrémenter
-- heurterait booked <= capacity.
insert into product_availability (product_id, date, capacity, booked) values
  ('7b700000-0000-4000-8000-000000000033', '2029-07-01', 2, 2);

create temp table r (k text primary key, res jsonb);
grant select, insert on r to authenticated;

-- ===== Droits =====================================================================================
select ok(
  not has_function_privilege('anon',
    'public.create_manual_order_line(uuid, date, integer, text, time without time zone, text, text)', 'EXECUTE'),
  'anon n''a pas EXECUTE'
);
select ok(
  has_function_privilege('authenticated',
    'public.create_manual_order_line(uuid, date, integer, text, time without time zone, text, text)', 'EXECUTE'),
  'authenticated garde EXECUTE'
);

-- ===== Appels, dans l'ordre, par l'operator ======================================================
set local role authenticated;
select test_login('7b700000-0000-4000-8000-000000000021');
insert into r values
  ('occ_hors', create_manual_order_line('7b700000-0000-4000-8000-000000000031', '2029-07-04', 1, 'Walk-in')),
  ('met_ok', create_manual_order_line('7b700000-0000-4000-8000-000000000031', '2029-07-01', 1, 'Walk-in')),
  ('met_trop', create_manual_order_line('7b700000-0000-4000-8000-000000000031', '2029-07-01', 2, 'Walk-in')),
  ('off_ok', create_manual_order_line('7b700000-0000-4000-8000-000000000032', '2029-07-01', 1, 'Walk-in')),
  ('off_sans_ressource', create_manual_order_line('7b700000-0000-4000-8000-000000000032', '2029-07-02', 1, 'Walk-in')),
  ('rsvp_ok', create_manual_order_line('7b700000-0000-4000-8000-000000000033', '2029-07-01', 5, 'Walk-in')),
  ('libre_ok', create_manual_order_line('7b700000-0000-4000-8000-000000000034', '2029-07-01', 3, 'Walk-in')),
  ('sitio_ok', create_manual_order_line('7b700000-0000-4000-8000-000000000035', '2029-07-01', 1, 'Walk-in')),
  ('sitio_plein', create_manual_order_line('7b700000-0000-4000-8000-000000000035', '2029-07-01', 1, 'Walk-in')),
  ('horario_sans_place', create_manual_order_line('7b700000-0000-4000-8000-000000000036', '2029-07-01', 1, 'Walk-in', '09:00')),
  ('horario_ok', create_manual_order_line('7b700000-0000-4000-8000-000000000036', '2029-07-03', 1, 'Walk-in', '09:00')),
  ('actividad_ok', create_manual_order_line('7b700000-0000-4000-8000-000000000037', '2029-07-01', 1, 'Walk-in')),
  ('metered_horario_ok', create_manual_order_line('7b700000-0000-4000-8000-000000000038', '2029-07-01', 1, 'Walk-in', '09:00'));
reset role;

-- ===== Réponses ===================================================================================
select is((select res->>'reason' from r where k = 'occ_hors'), 'invalid_occurrence_date',
  'evento vendu en ligne, date hors occurrence → invalid_occurrence_date');
select is((select res->>'ok' from r where k = 'met_ok'), 'true', 'evento metered occupant → ok');
select is((select res->>'reason' from r where k = 'met_trop'), 'resource_unavailable',
  'ressource 1/2 + 2 → resource_unavailable, même avec de la place sur le produit (1/3)');
select is((select res->>'ok' from r where k = 'off_ok'), 'true',
  'evento jamais vendu en ligne → ok (online_bookable ignoré)');
select is((select res->>'reason' from r where k = 'off_sans_ressource'), 'resource_unavailable',
  'evento occupant, aucune ressource ce jour-là → resource_unavailable');
select is((select res->>'ok' from r where k = 'rsvp_ok'), 'true',
  'evento rsvp, ligne product_availability pleine → ok (jamais lue ni incrémentée)');
select is((select res->>'ok' from r where k = 'libre_ok'), 'true',
  'evento gratuit unlimited sans capacité par défaut → ok (ni slot_not_found ni price_missing)');
select is((select res->>'ok' from r where k = 'sitio_ok'), 'true', 'evento payé sur place → ok');
select is((select res->>'reason' from r where k = 'sitio_plein'), 'full', 'evento metered plein → full');
select is((select res->>'reason' from r where k = 'horario_sans_place'), 'resource_unavailable',
  'evento à créneaux occupant, ressource pleine → resource_unavailable');
select is((select res->>'ok' from r where k = 'horario_ok'), 'true', 'evento à créneaux occupant → ok');
select is((select res->>'ok' from r where k = 'actividad_ok'), 'true',
  'activité, ressource pleine ce jour-là → ok (seul un evento l''occupe)');
select is((select res->>'ok' from r where k = 'metered_horario_ok'), 'true', 'evento metered à créneaux → ok');

-- ===== État : rien d'écrit par un refus ===========================================================
select is(
  (select count(*)::int from order_lines where product_id::text like '7b700000-%'),
  8,
  'huit lignes : une par succès, aucune pour les cinq refus'
);
select is(
  (select jsonb_build_object('capacity', capacity, 'booked', booked) from product_availability
    where product_id = '7b700000-0000-4000-8000-000000000031' and date = '2029-07-01'),
  jsonb_build_object('capacity', 3, 'booked', 1),
  'metered : product_availability matérialisée et incrémentée une fois (le refus ressource n''a rien écrit)'
);
select is(
  (select jsonb_object_agg(slot_date, jsonb_build_array(booked, capacity)) from provider_resource_calendar
    where establishment_id = '7b700000-0000-4000-8000-000000000011'),
  jsonb_build_object('2029-07-01', jsonb_build_array(2, 2), '2029-07-03', jsonb_build_array(1, 1)),
  'ressource : D1 = metered + jamais vendu en ligne (2/2), D3 = créneau (1/1)'
);
select is(
  (select jsonb_agg(jsonb_build_array(r.k, ab.start_date, ab.end_date) order by r.k)
     from availability_blocks ab
     join r on (r.res->>'order_line_id')::uuid = ab.source_order_line_id
    where ab.establishment_id = '7b700000-0000-4000-8000-000000000011'),
  jsonb_build_array(
    jsonb_build_array('horario_ok', '2029-07-03', '2029-07-03'),
    jsonb_build_array('met_ok', '2029-07-01', '2029-07-01'),
    jsonb_build_array('off_ok', '2029-07-01', '2029-07-01')
  ),
  'un blocage d''agenda d''un jour par ligne occupante, aucun pour les autres'
);
select is(
  (select count(*)::int from availability_blocks where establishment_id = '7b700000-0000-4000-8000-000000000011'),
  3,
  'aucun autre blocage sur l''établissement'
);
select is(
  (select count(*)::int from product_availability
    where product_id in ('7b700000-0000-4000-8000-000000000032', '7b700000-0000-4000-8000-000000000034',
                         '7b700000-0000-4000-8000-000000000036')),
  0,
  'mode NULL et unlimited : aucune ligne product_availability matérialisée'
);
select is(
  (select jsonb_build_object('capacity', capacity, 'booked', booked) from product_availability
    where product_id = '7b700000-0000-4000-8000-000000000033' and date = '2029-07-01'),
  jsonb_build_object('capacity', 2, 'booked', 2),
  'rsvp : la ligne existante n''est pas incrémentée'
);
select is(
  (select booked from product_availability
    where product_id = '7b700000-0000-4000-8000-000000000035' and date = '2029-07-01'),
  1,
  'payé sur place metered : incrémenté une fois'
);
select is(
  (select booked from product_availability
    where product_id = '7b700000-0000-4000-8000-000000000037' and date = '2029-07-01'),
  1,
  'activité : son compteur seul'
);
select is(
  (select jsonb_object_agg(slot_date, booked) from product_slot_availability
    where product_id = '7b700000-0000-4000-8000-000000000036' and slot_start_time = '09:00'),
  jsonb_build_object('2029-07-01', 0, '2029-07-03', 1),
  'créneau : refusé sans incrément (ligne matérialisée à 0), accepté incrémenté'
);
select is(
  (select jsonb_object_agg(r.k, jsonb_build_array(ol.price_cop, ol.total_cop, ol.acompte_cop))
     from r join order_lines ol on ol.id = (r.res->>'order_line_id')::uuid
    where r.k in ('rsvp_ok', 'libre_ok', 'sitio_ok')),
  jsonb_build_object(
    'rsvp_ok', jsonb_build_array(20000, 100000, 0),
    'libre_ok', jsonb_build_array(0, 0, 0),
    'sitio_ok', jsonb_build_array(25000, 25000, 0)
  ),
  'prix : rsvp au tarif, gratuit à 0, payé sur place au tarif ; acompte 0 (ligne manuelle)'
);

select is(
  (select jsonb_build_array(
     (select booked from product_slot_availability
       where product_id = '7b700000-0000-4000-8000-000000000038' and slot_date = '2029-07-01' and slot_start_time = '09:00'),
     (select count(*)::int from product_availability where product_id = '7b700000-0000-4000-8000-000000000038'))),
  jsonb_build_array(1, 0),
  'metered à créneaux : le créneau est pris, aucune ligne product_availability (comme create_order)'
);

-- ===== Aller-retour : la fonction commune de libération rend exactement ce qui a été pris ========
select release_order_line_capacity((select (res->>'order_line_id')::uuid from r where k = 'met_ok'));
select is(
  (select jsonb_build_array(
     (select booked from provider_resource_calendar
       where establishment_id = '7b700000-0000-4000-8000-000000000011' and slot_date = '2029-07-01'),
     (select count(*)::int from availability_blocks
       where source_order_line_id = (select (res->>'order_line_id')::uuid from r where k = 'met_ok')),
     (select booked from product_availability
       where product_id = '7b700000-0000-4000-8000-000000000031' and date = '2029-07-01'))),
  jsonb_build_array(1, 0, 0),
  'release_order_line_capacity : ressource rendue (2 → 1), blocage retiré, compteur rendu (1 → 0)'
);
select release_order_line_capacity((select (res->>'order_line_id')::uuid from r where k = 'horario_ok'));
select is(
  (select jsonb_build_array(
     (select booked from provider_resource_calendar
       where establishment_id = '7b700000-0000-4000-8000-000000000011' and slot_date = '2029-07-03'),
     (select count(*)::int from availability_blocks
       where source_order_line_id = (select (res->>'order_line_id')::uuid from r where k = 'horario_ok')),
     (select booked from product_slot_availability
       where product_id = '7b700000-0000-4000-8000-000000000036' and slot_date = '2029-07-03' and slot_start_time = '09:00'))),
  jsonb_build_array(0, 0, 0),
  'release_order_line_capacity, créneau occupant : ressource, blocage et créneau rendus'
);

select * from finish();
rollback;

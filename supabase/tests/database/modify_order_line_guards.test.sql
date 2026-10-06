-- modify_order_line (migration 20261006204938) : refus d'une prestation adossée à LobbyPMS ou qui
-- tient la ressource partagée, evento `rsvp` sans compteur, libération commune au plancher 0, pas
-- de min_qty pour un logement, EXECUTE retiré à anon. Les gardes historiques restent couvertes par
-- modify_order_line.test.sql.
begin;
select plan(25);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values ('7c720000-0000-4000-8000-000000000001', 'Modify Guards');
insert into establishments (id, partner_id, name) values
  ('7c720000-0000-4000-8000-000000000011', '7c720000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Modify Guards'));
insert into auth.users (id, email) values
  ('7c720000-0000-4000-8000-000000000031', 'modify-guards-admin@test.local'),
  ('7c720000-0000-4000-8000-000000000032', 'modify-guards-buyer@test.local');
insert into partner_capabilities (account_id, role, source, status)
values ('7c720000-0000-4000-8000-000000000031', 'admin', 'migration', 'active');

insert into products (id, partner_id, establishment_id, type, name, slug, sellable, price_cop, min_qty, max_qty,
                      online_bookable, evento_capacity_mode, evento_payment_mode, evento_occupies_resource,
                      default_capacity, lobby_category_id) values
  -- 21 : activité.
  ('7c720000-0000-4000-8000-000000000021', '7c720000-0000-4000-8000-000000000001',
   '7c720000-0000-4000-8000-000000000011', 'activity', jsonb_build_object('es', 'Actividad'),
   'modify-guards-actividad', true, 10000, 1, 10, false, null, null, true, null, null),
  -- 22 : evento rsvp (n'occupe pas la ressource).
  ('7c720000-0000-4000-8000-000000000022', '7c720000-0000-4000-8000-000000000001',
   '7c720000-0000-4000-8000-000000000011', 'evento', jsonb_build_object('es', 'Evento rsvp'),
   'modify-guards-rsvp', true, 20000, null, null, true, 'rsvp', 'online', false, 2, null),
  -- 23 : evento metered (n'occupe pas la ressource).
  ('7c720000-0000-4000-8000-000000000023', '7c720000-0000-4000-8000-000000000001',
   '7c720000-0000-4000-8000-000000000011', 'evento', jsonb_build_object('es', 'Evento metered'),
   'modify-guards-metered', true, 30000, null, null, true, 'metered', 'online', false, 3, null),
  -- 24 : evento metered qui occupe la ressource.
  ('7c720000-0000-4000-8000-000000000024', '7c720000-0000-4000-8000-000000000001',
   '7c720000-0000-4000-8000-000000000011', 'evento', jsonb_build_object('es', 'Evento ocupante'),
   'modify-guards-ocupante', true, 30000, null, null, true, 'metered', 'online', true, 5, null),
  -- 25 : logement local, min_qty 2.
  ('7c720000-0000-4000-8000-000000000025', '7c720000-0000-4000-8000-000000000001',
   '7c720000-0000-4000-8000-000000000011', 'lodging', jsonb_build_object('es', 'Casa'),
   'modify-guards-casa', true, 100000, 2, 4, false, null, null, true, null, null),
  -- 26 : logement adossé à LobbyPMS.
  ('7c720000-0000-4000-8000-000000000026', '7c720000-0000-4000-8000-000000000001',
   '7c720000-0000-4000-8000-000000000011', 'lodging', jsonb_build_object('es', 'Habitación PMS'),
   'modify-guards-pms', true, 100000, null, null, false, null, null, true, null, 7),
  -- 27 : logement local, pour le plancher d'une nuit.
  ('7c720000-0000-4000-8000-000000000027', '7c720000-0000-4000-8000-000000000001',
   '7c720000-0000-4000-8000-000000000011', 'lodging', jsonb_build_object('es', 'Cabaña'),
   'modify-guards-cabana', true, 100000, null, 4, false, null, null, true, null, null);

insert into product_availability (product_id, date, capacity, booked) values
  -- Activité : 1 réservé pour une ligne de 2 (anomalie : une place manque).
  ('7c720000-0000-4000-8000-000000000021', '2029-03-01', 3, 1),
  ('7c720000-0000-4000-8000-000000000021', '2029-03-05', 3, 1),
  ('7c720000-0000-4000-8000-000000000021', '2029-03-06', 3, 1),
  -- Logement : 1 réservé pour une ligne de 2, capacité 2.
  ('7c720000-0000-4000-8000-000000000027', '2029-03-10', 2, 1),
  -- rsvp : lignes héritées jamais incrémentées, l'une pleine.
  ('7c720000-0000-4000-8000-000000000022', '2029-03-01', 2, 0),
  ('7c720000-0000-4000-8000-000000000022', '2029-03-02', 2, 2),
  ('7c720000-0000-4000-8000-000000000023', '2029-03-01', 3, 1),
  ('7c720000-0000-4000-8000-000000000024', '2029-03-01', 5, 1);
insert into product_availability (product_id, date, capacity, booked)
select '7c720000-0000-4000-8000-000000000025', d::date, 5, case when d < '2029-03-03' then 2 else 0 end
  from generate_series('2029-03-01'::date, '2029-03-05'::date, interval '1 day') d;
insert into provider_resource_calendar (establishment_id, slot_date, capacity, booked) values
  ('7c720000-0000-4000-8000-000000000011', '2029-03-01', 2, 1);

insert into orders (id, account_id, holder_name, holder_email) values
  ('7c720000-0000-4000-8000-000000000041', '7c720000-0000-4000-8000-000000000032',
   'Holder Modify Guards', 'holder-modify-guards@test.local');
insert into order_lines (
  id, order_id, account_id, product_id, date, end_date, qty, status, holder_name, pms_booking_id,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  ('7c720000-0000-4000-8000-000000000051', '7c720000-0000-4000-8000-000000000041',
   '7c720000-0000-4000-8000-000000000032', '7c720000-0000-4000-8000-000000000021',
   '2029-03-01', null, 2, 'reserved', 'Holder', null, 10000, 20000, 'direct', 0, 0, 0, 0, 0, 0),
  ('7c720000-0000-4000-8000-000000000052', '7c720000-0000-4000-8000-000000000041',
   '7c720000-0000-4000-8000-000000000032', '7c720000-0000-4000-8000-000000000022',
   '2029-03-01', null, 1, 'reserved', 'Holder', null, 20000, 20000, 'direct', 0, 0, 0, 0, 0, 0),
  ('7c720000-0000-4000-8000-000000000053', '7c720000-0000-4000-8000-000000000041',
   '7c720000-0000-4000-8000-000000000032', '7c720000-0000-4000-8000-000000000023',
   '2029-03-01', null, 1, 'reserved', 'Holder', null, 30000, 30000, 'direct', 0, 0, 0, 0, 0, 0),
  ('7c720000-0000-4000-8000-000000000054', '7c720000-0000-4000-8000-000000000041',
   '7c720000-0000-4000-8000-000000000032', '7c720000-0000-4000-8000-000000000024',
   '2029-03-01', null, 1, 'reserved', 'Holder', null, 30000, 30000, 'direct', 0, 0, 0, 0, 0, 0),
  ('7c720000-0000-4000-8000-000000000055', '7c720000-0000-4000-8000-000000000041',
   '7c720000-0000-4000-8000-000000000032', '7c720000-0000-4000-8000-000000000025',
   '2029-03-01', '2029-03-03', 2, 'reserved', 'Holder', null, 200000, 400000, 'direct', 0, 0, 0, 0, 0, 0),
  ('7c720000-0000-4000-8000-000000000056', '7c720000-0000-4000-8000-000000000041',
   '7c720000-0000-4000-8000-000000000032', '7c720000-0000-4000-8000-000000000026',
   '2029-03-01', '2029-03-03', 1, 'reserved', 'Holder', null, 200000, 200000, 'direct', 0, 0, 0, 0, 0, 0),
  ('7c720000-0000-4000-8000-000000000057', '7c720000-0000-4000-8000-000000000041',
   '7c720000-0000-4000-8000-000000000032', '7c720000-0000-4000-8000-000000000021',
   '2029-03-05', null, 1, 'reserved', 'Holder', 'P7C-GUARDS-1', 10000, 10000, 'direct', 0, 0, 0, 0, 0, 0),
  ('7c720000-0000-4000-8000-000000000058', '7c720000-0000-4000-8000-000000000041',
   '7c720000-0000-4000-8000-000000000032', '7c720000-0000-4000-8000-000000000021',
   '2029-03-06', null, 2, 'reserved', 'Holder', null, 10000, 20000, 'direct', 0, 0, 0, 0, 0, 0),
  ('7c720000-0000-4000-8000-000000000059', '7c720000-0000-4000-8000-000000000041',
   '7c720000-0000-4000-8000-000000000032', '7c720000-0000-4000-8000-000000000027',
   '2029-03-10', '2029-03-11', 2, 'reserved', 'Holder', null, 100000, 200000, 'direct', 0, 0, 0, 0, 0, 0);
insert into availability_blocks (establishment_id, start_date, end_date, source_order_line_id) values
  ('7c720000-0000-4000-8000-000000000011', '2029-03-01', '2029-03-01', '7c720000-0000-4000-8000-000000000054');

create temp table r (k text primary key, res jsonb);
grant select, insert on r to authenticated;

-- ===== Droits =====================================================================================
select ok(
  not has_function_privilege('anon', 'public.modify_order_line(uuid, date, integer, text, date)', 'EXECUTE'),
  'anon n''a pas EXECUTE'
);
select ok(
  has_function_privilege('authenticated', 'public.modify_order_line(uuid, date, integer, text, date)', 'EXECUTE'),
  'authenticated garde EXECUTE'
);

-- ===== Appels (admin) =============================================================================
set local role authenticated;
select test_login('7c720000-0000-4000-8000-000000000031');
insert into r values
  ('pms_booking', modify_order_line('7c720000-0000-4000-8000-000000000057', '2029-03-05', 2, 'Motivo')),
  ('pms_logement', modify_order_line('7c720000-0000-4000-8000-000000000056', '2029-03-02', 1, 'Motivo', '2029-03-04')),
  ('bloc', modify_order_line('7c720000-0000-4000-8000-000000000054', '2029-03-01', 2, 'Motivo')),
  ('plancher', modify_order_line('7c720000-0000-4000-8000-000000000051', '2029-03-01', 3, 'Motivo')),
  ('rsvp_meme_date', modify_order_line('7c720000-0000-4000-8000-000000000052', '2029-03-01', 3, 'Motivo')),
  ('metered', modify_order_line('7c720000-0000-4000-8000-000000000053', '2029-03-02', 2, 'Motivo')),
  ('logement_min', modify_order_line('7c720000-0000-4000-8000-000000000055', '2029-03-02', 1, 'Motivo', '2029-03-04'));
-- La ligne rsvp, de remplacement en remplacement : vers une date jamais matérialisée (qty 4 au-delà
-- de la capacité par défaut 2), puis vers une date pleine. Elle ne quitte jamais une date dont la
-- ligne héritée compte des places : le résultat ne dépend pas de la libération d'un rsvp.
insert into r values
  ('rsvp_nouvelle_date', modify_order_line(
     (select (res->>'order_line_id')::uuid from r where k = 'rsvp_meme_date'), '2029-03-03', 4, 'Motivo'));
insert into r values
  ('rsvp_date_pleine', modify_order_line(
     (select (res->>'order_line_id')::uuid from r where k = 'rsvp_nouvelle_date'), '2029-03-02', 5, 'Motivo'));
-- Au plancher : une place manquante (1 réservé pour une ligne de 2) ne devient pas une place
-- libre — le contrôle compte 0 + nouvelle qty, comme l'écriture qui suit, jamais -1 + qty.
select throws_ok(
  $$ select modify_order_line('7c720000-0000-4000-8000-000000000058', '2029-03-06', 4, 'Motivo') $$,
  'P0001', null,
  'date unique au plancher : 0 + 4 sur une capacité de 3 → capacité insuffisante (jamais 23514)'
);
select throws_ok(
  $$ select modify_order_line('7c720000-0000-4000-8000-000000000059', '2029-03-10', 3, 'Motivo', '2029-03-11') $$,
  'P0001', null,
  'logement au plancher : 0 + 3 sur une capacité de 2 → capacité insuffisante (jamais 23514)'
);
-- Le plafond max_qty d'un logement, lui, reste (seul min_qty est retiré).
select throws_ok(
  $$ select modify_order_line('7c720000-0000-4000-8000-000000000059', '2029-03-10', 5, 'Motivo', '2029-03-11') $$,
  'P0001', 'quantité 5 hors bornes [1, 4] pour ce produit',
  'logement : qty au-delà de max_qty → refusée'
);
reset role;

-- ===== Refus métier : rien n'est écrit ============================================================
select is((select res->>'reason' from r where k = 'pms_booking'), 'pms_line_not_modifiable',
  'prestation adossée à un booking LobbyPMS → pms_line_not_modifiable');
select is((select res->>'reason' from r where k = 'pms_logement'), 'pms_line_not_modifiable',
  'logement PMS sans booking encore → pms_line_not_modifiable');
select is((select res->>'reason' from r where k = 'bloc'), 'resource_line_not_modifiable',
  'ligne qui porte un blocage d''agenda → resource_line_not_modifiable');
select is(
  (select jsonb_object_agg(id, status) from order_lines
    where id in ('7c720000-0000-4000-8000-000000000054', '7c720000-0000-4000-8000-000000000056',
                 '7c720000-0000-4000-8000-000000000057')),
  jsonb_build_object('7c720000-0000-4000-8000-000000000054', 'reserved',
                     '7c720000-0000-4000-8000-000000000056', 'reserved',
                     '7c720000-0000-4000-8000-000000000057', 'reserved'),
  'les trois lignes refusées restent reserved'
);
select is(
  (select count(*)::int from order_lines
    where replaces_order_line_id in ('7c720000-0000-4000-8000-000000000054', '7c720000-0000-4000-8000-000000000056',
                                     '7c720000-0000-4000-8000-000000000057')),
  0,
  'aucune ligne de remplacement pour un refus'
);
select is((select count(*)::int from pms_cancellation_queue where pms_booking_id = 'P7C-GUARDS-1'), 0,
  'le booking LobbyPMS n''est pas mis en file d''annulation');
select is(
  (select jsonb_build_array(
     (select booked from provider_resource_calendar
       where establishment_id = '7c720000-0000-4000-8000-000000000011' and slot_date = '2029-03-01'),
     (select count(*)::int from availability_blocks where source_order_line_id = '7c720000-0000-4000-8000-000000000054'),
     (select booked from product_availability where product_id = '7c720000-0000-4000-8000-000000000024' and date = '2029-03-01'),
     (select booked from product_availability where product_id = '7c720000-0000-4000-8000-000000000021' and date = '2029-03-05'))),
  jsonb_build_array(1, 1, 1, 1),
  'ressource, blocage et compteurs des lignes refusées inchangés'
);

-- ===== Plancher de la libération ==================================================================
select is((select res->>'ok' from r where k = 'plancher'), 'true',
  'activité, 1 réservé pour une ligne de 2, nouvelle qty 3 → ok (jamais 23514)');
select is(
  (select booked from product_availability where product_id = '7c720000-0000-4000-8000-000000000021' and date = '2029-03-01'),
  3,
  'libéré au plancher 0, puis 3 pris'
);

-- ===== evento rsvp : ni contrôle, ni compteur =====================================================
select is((select res->>'ok' from r where k = 'rsvp_meme_date'), 'true',
  'rsvp, même date, ligne héritée à 0 → ok (jamais 23514)');
select is((select res->>'ok' from r where k = 'rsvp_nouvelle_date'), 'true',
  'rsvp déplacé vers une date jamais matérialisée, au-delà de la capacité par défaut → ok');
select is((select res->>'ok' from r where k = 'rsvp_date_pleine'), 'true',
  'rsvp déplacé sur une date pleine → ok (rsvp ne bloque jamais)');
select is(
  (select jsonb_object_agg(date, booked) from product_availability
    where product_id = '7c720000-0000-4000-8000-000000000022'),
  jsonb_build_object('2029-03-01', 0, '2029-03-02', 2),
  'rsvp : aucune ligne matérialisée, aucune incrémentée'
);
select is(
  (select jsonb_build_object('date', date, 'qty', qty, 'status', status) from order_lines
    where id = (select (res->>'order_line_id')::uuid from r where k = 'rsvp_date_pleine')),
  jsonb_build_object('date', '2029-03-02'::date, 'qty', 5, 'status', 'reserved'),
  'rsvp : la ligne de remplacement porte la nouvelle date et la nouvelle qty'
);

-- ===== evento metered : inchangé ==================================================================
select is((select res->>'ok' from r where k = 'metered'), 'true', 'evento metered déplacé → ok');
select is(
  (select jsonb_object_agg(date, jsonb_build_array(booked, capacity)) from product_availability
    where product_id = '7c720000-0000-4000-8000-000000000023'),
  jsonb_build_object('2029-03-01', jsonb_build_array(0, 3), '2029-03-02', jsonb_build_array(2, 3)),
  'metered : place rendue à l''ancienne date, matérialisée et prise à la nouvelle'
);

-- ===== Logement : pas de min_qty ==================================================================
select is((select res->>'ok' from r where k = 'logement_min'), 'true',
  'logement à min_qty 2 ramené à 1 → ok (pas de min_qty logement)');
select is(
  (select jsonb_object_agg(date, booked) from product_availability
    where product_id = '7c720000-0000-4000-8000-000000000025'),
  jsonb_build_object('2029-03-01', 0, '2029-03-02', 1, '2029-03-03', 1, '2029-03-04', 0, '2029-03-05', 0),
  'logement : anciennes nuits rendues, nouvelles prises'
);
select is(
  (select jsonb_build_object('date', date, 'end_date', end_date, 'qty', qty) from order_lines
    where id = (select (res->>'order_line_id')::uuid from r where k = 'logement_min')),
  jsonb_build_object('date', '2029-03-02'::date, 'end_date', '2029-03-04'::date, 'qty', 1),
  'logement : ligne de remplacement correcte'
);
select is(
  (select status from order_lines where id = '7c720000-0000-4000-8000-000000000055'),
  'superseded',
  'logement : ancienne ligne superseded'
);

select * from finish();
rollback;

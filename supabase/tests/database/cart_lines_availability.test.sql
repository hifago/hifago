-- cart_lines_availability() contre create_order, cas par cas (migration 20261014211217). La fonction est
-- une copie des contrôles ligne de create_order : ce fichier est la garde qui la rend acceptable.
--   - PARITÉ : pour chaque raison ligne, un panier qui la déclenche ; la raison rendue par
--     cart_lines_availability() pour chaque ligne et celle de create_order sont comparées entre
--     elles ET à la raison attendue (une dérive identique des deux côtés rougit aussi) ;
--   - COUVERTURE : l'ensemble des raisons copiées = celui de create_order (relevé dans son code),
--     et chaque raison de create_order a son cas ici — sauf product_not_found, inatteignable depuis
--     un panier (cart_items.product_id est une clé étrangère). Une raison ajoutée à create_order
--     sans copie ni cas fait rougir ce fichier ;
--   - lecture seule : rien de matérialisé (product_availability, product_slot_availability) ;
--   - le panier de l'appelant seulement ; sans identité, rien ; jamais exécutable par anon.
-- Dates relatives à today_in_bogota(), jamais current_date.
begin;
select plan(35);

create temp table test_r (k text primary key, avail text[], ordered text);
grant all on test_r to authenticated;

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
-- Panier de l'appelant : p = suffixe produit, d / e = décalages de date et de fin, s = créneau,
-- q = quantité. created_at étagé : l'ordre du panier est celui du tableau, des deux côtés.
create function test_set_cart(p_lines jsonb) returns void language plpgsql as $$
begin
  delete from public.cart_items where account_id = auth.uid();
  insert into public.cart_items (account_id, product_id, date, end_date, slot_start_time, qty, created_at)
  select auth.uid(), ('b1c70000-0000-4000-8000-0000000000' || (l->>'p'))::uuid,
         public.today_in_bogota() + (l->>'d')::int,
         public.today_in_bogota() + (l->>'e')::int,
         (l->>'s')::time,
         coalesce((l->>'q')::int, 1),
         now() + n * interval '1 millisecond'
    from jsonb_array_elements(p_lines) with ordinality as x(l, n);
end;
$$;
-- Les raisons de cart_lines_availability() dans l'ordre du panier ('ok' si disponible), PUIS, dans
-- une instruction séparée, celle de create_order ('ok' si la commande passe).
create function test_parity(p_case text, p_lines jsonb) returns void language plpgsql as $$
declare
  v_order jsonb;
begin
  perform test_set_cart(p_lines);
  insert into test_r (k, avail)
  select p_case, array_agg(coalesce(a.reason, 'ok') order by ci.created_at)
    from public.cart_lines_availability() a
    join public.cart_items ci on ci.id = a.id;
  v_order := public.create_order('Cliente Paridad', p_holder_email => 'paridad@test.local');
  update test_r
     set ordered = case when (v_order->>'ok')::boolean then 'ok' else v_order->>'reason' end
   where k = p_case;
end;
$$;
create function test_case(p_case text) returns text[] language sql as $$
  select avail || ordered from test_r where k = p_case;
$$;

insert into partners (id, display_name) values ('b1c70000-0000-4000-8000-000000000001', 'Cart Availability');
insert into establishments (id, partner_id, name, lobby_connector_active, lobby_api_token) values
  -- 11 : connecteur actif ; 12 : connecteur coupé ; 13 : aucune ressource partagée ouverte.
  ('b1c70000-0000-4000-8000-000000000011', 'b1c70000-0000-4000-8000-000000000001', jsonb_build_object('es', 'Cart A'), true, 'fake-token'),
  ('b1c70000-0000-4000-8000-000000000012', 'b1c70000-0000-4000-8000-000000000001', jsonb_build_object('es', 'Cart B'), false, null),
  ('b1c70000-0000-4000-8000-000000000013', 'b1c70000-0000-4000-8000-000000000001', jsonb_build_object('es', 'Cart C'), false, null);
insert into auth.users (id, email) values
  ('b1c70000-0000-4000-8000-000000000031', 'cart-availability@test.local'),
  ('b1c70000-0000-4000-8000-000000000032', 'cart-availability-other@test.local');

insert into products (id, partner_id, establishment_id, type, name, slug, sellable, price_cop, price_tiers,
                      default_capacity, min_qty, max_qty, external_booking_url, calendar_default_open,
                      lobby_category_id, duration_days) values
  -- 21 : activité, cupo 2 matérialisé à la demande (aucune ligne product_availability).
  ('b1c70000-0000-4000-8000-000000000021', 'b1c70000-0000-4000-8000-000000000001', 'b1c70000-0000-4000-8000-000000000011',
   'activity', jsonb_build_object('es', 'Kayak'), 'cla-21', true, 30000, null, 2, null, null, null, true, null, null),
  -- 22 : activité non vendable.
  ('b1c70000-0000-4000-8000-000000000022', 'b1c70000-0000-4000-8000-000000000001', 'b1c70000-0000-4000-8000-000000000011',
   'activity', jsonb_build_object('es', 'Pausa'), 'cla-22', false, 30000, null, 5, null, null, null, true, null, null),
  -- 23 : activité à URL de réservation externe (vitrine).
  ('b1c70000-0000-4000-8000-000000000023', 'b1c70000-0000-4000-8000-000000000001', 'b1c70000-0000-4000-8000-000000000011',
   'activity', jsonb_build_object('es', 'Parapente'), 'cla-23', true, 30000, null, 5, null, null,
   'https://reservas.example.test/parapente', true, null, null),
  -- 25 : logement, une chambre par nuit ; J+11 déjà prise, J+20 fermée, rien après J+29.
  ('b1c70000-0000-4000-8000-000000000025', 'b1c70000-0000-4000-8000-000000000001', 'b1c70000-0000-4000-8000-000000000011',
   'lodging', jsonb_build_object('es', 'Cabaña'), 'cla-25', true, 100000, null, null, null, null, null, true, null, null),
  -- 26 : logement à paliers lacunaires (1-2, 4-5).
  ('b1c70000-0000-4000-8000-000000000026', 'b1c70000-0000-4000-8000-000000000001', 'b1c70000-0000-4000-8000-000000000011',
   'lodging', jsonb_build_object('es', 'Casa paliers'), 'cla-26', true, 100000,
   jsonb_build_array(jsonb_build_object('min_qty', 1, 'max_qty', 2, 'price_cop', 100000),
                     jsonb_build_object('min_qty', 4, 'max_qty', 5, 'price_cop', 90000)),
   null, null, null, null, true, null, null),
  -- 27 : logement PMS-backed, établissement au connecteur coupé.
  ('b1c70000-0000-4000-8000-000000000027', 'b1c70000-0000-4000-8000-000000000001', 'b1c70000-0000-4000-8000-000000000012',
   'lodging', jsonb_build_object('es', 'Hotel Lobby'), 'cla-27', true, 100000, null, null, null, null, null, true, 36572, null),
  -- 28 : activité à créneaux (9 h et 10 h, 2 places, tous les jours), aucun créneau matérialisé.
  ('b1c70000-0000-4000-8000-000000000028', 'b1c70000-0000-4000-8000-000000000001', 'b1c70000-0000-4000-8000-000000000011',
   'activity', jsonb_build_object('es', 'Buceo'), 'cla-28', true, 30000, null, null, null, null, null, true, null, null),
  -- 29 : activité de 2 à 3 personnes.
  ('b1c70000-0000-4000-8000-000000000029', 'b1c70000-0000-4000-8000-000000000001', 'b1c70000-0000-4000-8000-000000000011',
   'activity', jsonb_build_object('es', 'Rafting'), 'cla-29', true, 30000, null, 10, 2, 3, null, true, null, null),
  -- 30 : camp de 3 jours (exige un logement couvrant).
  ('b1c70000-0000-4000-8000-000000000030', 'b1c70000-0000-4000-8000-000000000001', 'b1c70000-0000-4000-8000-000000000011',
   'camp', jsonb_build_object('es', 'Campamento largo'), 'cla-30', true, 90000, null, 10, null, null, null, true, null, 3),
  -- 31 : camp d'un jour, établissement sans ressource partagée ouverte.
  ('b1c70000-0000-4000-8000-000000000031', 'b1c70000-0000-4000-8000-000000000001', 'b1c70000-0000-4000-8000-000000000013',
   'camp', jsonb_build_object('es', 'Campamento corto'), 'cla-31', true, 90000, null, 10, null, null, null, true, null, 1),
  -- 33 : activité sans cupo du tout.
  ('b1c70000-0000-4000-8000-000000000033', 'b1c70000-0000-4000-8000-000000000001', 'b1c70000-0000-4000-8000-000000000011',
   'activity', jsonb_build_object('es', 'Senderismo'), 'cla-33', true, 30000, null, null, null, null, null, true, null, null),
  -- 34 : activité fermée par défaut.
  ('b1c70000-0000-4000-8000-000000000034', 'b1c70000-0000-4000-8000-000000000001', 'b1c70000-0000-4000-8000-000000000011',
   'activity', jsonb_build_object('es', 'Cerrado'), 'cla-34', true, 30000, null, 10, null, null, null, false, null, null);

insert into products (id, partner_id, establishment_id, type, name, slug, sellable, price_cop, online_bookable,
                      evento_capacity_mode, evento_payment_mode, default_capacity, evento_occupies_resource,
                      occurrence_type, occurrence_date, recurrence_frequency_days) values
  -- 24 : evento en ligne, hebdomadaire à partir de J+7.
  ('b1c70000-0000-4000-8000-000000000024', 'b1c70000-0000-4000-8000-000000000001', 'b1c70000-0000-4000-8000-000000000011',
   'evento', jsonb_build_object('es', 'Taller'), 'cla-24', true, 20000, true, 'metered', 'online', 10, false,
   'recurring', public.today_in_bogota() + 7, 7),
  -- 32 : evento en ligne payant SANS prix, une date à J+5.
  ('b1c70000-0000-4000-8000-000000000032', 'b1c70000-0000-4000-8000-000000000001', 'b1c70000-0000-4000-8000-000000000011',
   'evento', jsonb_build_object('es', 'Concierto'), 'cla-32', true, null, true, 'metered', 'online', 10, false,
   'once', public.today_in_bogota() + 5, null);

insert into product_slot_rules (product_id, weekdays, start_time, end_time, slot_duration_minutes, capacity) values
  ('b1c70000-0000-4000-8000-000000000028', array[1, 2, 3, 4, 5, 6, 7]::smallint[], '09:00', '11:00', 60, 2);
insert into product_availability (product_id, date, capacity, booked) values
  ('b1c70000-0000-4000-8000-000000000025', public.today_in_bogota() + 10, 1, 0),
  ('b1c70000-0000-4000-8000-000000000025', public.today_in_bogota() + 11, 1, 1),
  ('b1c70000-0000-4000-8000-000000000025', public.today_in_bogota() + 20, 1, 0),
  ('b1c70000-0000-4000-8000-000000000025', public.today_in_bogota() + 21, 1, 0);
insert into product_calendar (product_id, date, open) values
  ('b1c70000-0000-4000-8000-000000000025', public.today_in_bogota() + 20, false);
-- Une ligne dans le panier d'un AUTRE compte.
insert into cart_items (account_id, product_id, date, qty) values
  ('b1c70000-0000-4000-8000-000000000032', 'b1c70000-0000-4000-8000-000000000021', public.today_in_bogota() + 3, 1);

-- ── Forme ───────────────────────────────────────────────────────────────────
select ok(
  (select provolatile = 's' and prosecdef from pg_proc
    where proname = 'cart_lines_availability' and pronamespace = 'public'::regnamespace),
  'STABLE et SECURITY DEFINER');
select ok(
  has_function_privilege('authenticated', 'public.cart_lines_availability()', 'execute')
    and not has_function_privilege('anon', 'public.cart_lines_availability()', 'execute'),
  'exécutable par une session (anonyme comprise), jamais par anon');
select is(
  (select array_agg(distinct m[1] order by m[1]) from pg_proc p, regexp_matches(p.prosrc, 'v_reason := ''([a-z_]+)''', 'g') m
    where p.proname = 'cart_lines_availability' and p.pronamespace = 'public'::regnamespace),
  (select array_agg(distinct m[1] order by m[1]) from pg_proc p, regexp_matches(p.prosrc, '''reason'', ''([a-z_]+)'', ''line''', 'g') m
    where p.proname = 'create_order' and p.pronamespace = 'public'::regnamespace),
  'mêmes raisons ligne que create_order — une raison ajoutée là-bas sans copie ici fait rougir ce test');

set local role authenticated;
select test_login('b1c70000-0000-4000-8000-000000000031');

-- ── Lecture seule, panier de l'appelant ─────────────────────────────────────
select test_set_cart('[{"p":"21","d":3},{"p":"28","d":3,"s":"09:00"}]');
select is(
  (select array_agg(coalesce(a.reason, 'ok') order by ci.created_at)
     from cart_lines_availability() a join cart_items ci on ci.id = a.id),
  array['ok', 'ok'],
  'cupo et créneau encore jamais matérialisés : lus comme create_order les matérialiserait');
select is(
  (select count(*)::int from cart_lines_availability()), 2,
  'seulement les lignes de l''appelant (un autre compte a une ligne au même produit)');
reset role;
select is(
  (select count(*)::int from product_availability where product_id = 'b1c70000-0000-4000-8000-000000000021')
    + (select count(*)::int from product_slot_availability where product_id = 'b1c70000-0000-4000-8000-000000000028'),
  0,
  'rien de matérialisé : ni cupo ni créneau écrit');
set local role authenticated;
select set_config('request.jwt.claims', '{}', true);
select is((select count(*)::int from cart_lines_availability()), 0, 'sans identité : aucune ligne');
select test_login('b1c70000-0000-4000-8000-000000000031');

-- ── Parité, raison par raison ───────────────────────────────────────────────
select test_parity('not_sellable vitrine', '[{"p":"23","d":3}]');
select is(test_case('not_sellable vitrine'), array['not_sellable', 'not_sellable'], 'not_sellable (URL externe, Phase 1)');
select test_parity('not_sellable produit', '[{"p":"22","d":3}]');
select is(test_case('not_sellable produit'), array['not_sellable', 'not_sellable'], 'not_sellable (sellable = false, Phase 3)');
select test_parity('date_in_past', '[{"p":"21","d":-1}]');
select is(test_case('date_in_past'), array['date_in_past', 'date_in_past'], 'date_in_past');
select test_parity('invalid_occurrence_date', '[{"p":"24","d":8}]');
select is(test_case('invalid_occurrence_date'), array['invalid_occurrence_date', 'invalid_occurrence_date'], 'invalid_occurrence_date');
select test_parity('unsupported_date_range', '[{"p":"21","d":3,"e":4}]');
select is(test_case('unsupported_date_range'), array['unsupported_date_range', 'unsupported_date_range'], 'unsupported_date_range');
select test_parity('invalid_date_range', '[{"p":"25","d":10,"e":10}]');
select is(test_case('invalid_date_range'), array['invalid_date_range', 'invalid_date_range'], 'invalid_date_range');
select test_parity('date_range_required', '[{"p":"25","d":10}]');
select is(test_case('date_range_required'), array['date_range_required', 'date_range_required'], 'date_range_required');
select test_parity('unsupported_slot_combination', '[{"p":"25","d":10,"e":12,"s":"09:00"}]');
select is(test_case('unsupported_slot_combination'), array['unsupported_slot_combination', 'unsupported_slot_combination'], 'unsupported_slot_combination');
select test_parity('slot_required', '[{"p":"28","d":3}]');
select is(test_case('slot_required'), array['slot_required', 'slot_required'], 'slot_required');
select test_parity('qty_below_minimum', '[{"p":"29","d":3,"q":1}]');
select is(test_case('qty_below_minimum'), array['qty_below_minimum', 'qty_below_minimum'], 'qty_below_minimum (min_qty du produit)');
select test_parity('qty_cap_exceeded', '[{"p":"29","d":3,"q":4}]');
select is(test_case('qty_cap_exceeded'), array['qty_cap_exceeded', 'qty_cap_exceeded'], 'qty_cap_exceeded (max_qty du produit)');
select test_parity('qty_cap_exceeded logement', '[{"p":"25","d":10,"e":12,"q":21}]');
select is(test_case('qty_cap_exceeded logement'), array['qty_cap_exceeded', 'qty_cap_exceeded'], 'qty_cap_exceeded (logement, plafond 20)');
select test_parity('no_matching_tier', '[{"p":"26","d":10,"e":11,"q":3}]');
select is(test_case('no_matching_tier'), array['no_matching_tier', 'no_matching_tier'], 'no_matching_tier');
select test_parity('pms_unavailable', '[{"p":"27","d":10,"e":11}]');
select is(test_case('pms_unavailable'), array['pms_unavailable', 'pms_unavailable'], 'pms_unavailable');
select test_parity('camp_missing_lodging', '[{"p":"30","d":3}]');
select is(test_case('camp_missing_lodging'), array['camp_missing_lodging', 'camp_missing_lodging'], 'camp_missing_lodging');
select test_parity('price_missing', '[{"p":"32","d":5}]');
select is(test_case('price_missing'), array['price_missing', 'price_missing'], 'price_missing');
select test_parity('date_closed', '[{"p":"34","d":3}]');
select is(test_case('date_closed'), array['date_closed', 'date_closed'], 'date_closed (date unique)');
select test_parity('date_closed nuit', '[{"p":"25","d":20,"e":22}]');
select is(test_case('date_closed nuit'), array['date_closed', 'date_closed'], 'date_closed (une nuit du séjour)');
select test_parity('slot_not_found', '[{"p":"33","d":3}]');
select is(test_case('slot_not_found'), array['slot_not_found', 'slot_not_found'], 'slot_not_found (aucun cupo)');
select test_parity('slot_not_found nuit', '[{"p":"25","d":30,"e":31}]');
select is(test_case('slot_not_found nuit'), array['slot_not_found', 'slot_not_found'], 'slot_not_found (nuit sans disponibilité)');
select test_parity('slot_not_found créneau', '[{"p":"28","d":3,"s":"15:00"}]');
select is(test_case('slot_not_found créneau'), array['slot_not_found', 'slot_not_found'], 'slot_not_found (créneau hors règle)');
select test_parity('full', '[{"p":"21","d":4,"q":3}]');
select is(test_case('full'), array['full', 'full'], 'full (cupo matérialisé à 2)');
select test_parity('full panier', '[{"p":"21","d":5,"q":1},{"p":"21","d":5,"q":2}]');
select is(test_case('full panier'), array['full', 'full', 'full'], 'full (deux lignes du panier qui s''additionnent : chacune est pleine)');
select test_parity('full nuit', '[{"p":"25","d":10,"e":12}]');
select is(test_case('full nuit'), array['full', 'full'], 'full (une nuit déjà prise)');
select test_parity('full créneau', '[{"p":"28","d":3,"s":"09:00","q":3}]');
select is(test_case('full créneau'), array['full', 'full'], 'full (créneau de 2 places)');
select test_parity('resource_unavailable', '[{"p":"31","d":3}]');
select is(test_case('resource_unavailable'), array['resource_unavailable', 'resource_unavailable'], 'resource_unavailable');

-- ── Couverture, puis le panier qui passe (create_order l'écrit : en dernier) ─
select is(
  (select array_agg(distinct ordered order by ordered) from test_r where ordered <> 'ok'),
  (select array_agg(distinct m[1] order by m[1]) from pg_proc p, regexp_matches(p.prosrc, '''reason'', ''([a-z_]+)'', ''line''', 'g') m
    where p.proname = 'create_order' and p.pronamespace = 'public'::regnamespace and m[1] <> 'product_not_found'),
  'chaque raison ligne de create_order a son cas de parité (sauf product_not_found, inatteignable : clé étrangère)');
select test_parity('ok', '[{"p":"21","d":3},{"p":"28","d":3,"s":"10:00","q":2}]');
select is(test_case('ok'), array['ok', 'ok', 'ok'], 'panier disponible : les deux lignes ok, la commande passe');

select * from finish();
rollback;

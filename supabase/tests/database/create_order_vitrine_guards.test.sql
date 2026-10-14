-- create_order : trois refus de Phase 1 (migration 20261014031656, arbitrages du 2026-10-14).
--   - G8a `date_in_past` : hier (heure de Colombie) refusé, aujourd'hui accepté — pour une activité,
--     le début d'un séjour et l'occurrence d'un evento ;
--   - G8b `not_sellable` : evento non réservable en ligne, produit à URL externe, transport ; un
--     evento réservable en ligne passe ;
--   - G17 `no_matching_tier` : logement dont la quantité tombe dans le trou entre deux paliers ;
--     dans un palier, ou sans palier du tout, rien ne change.
-- Aucune commande n'est créée par un refus. Dates relatives à today_in_bogota(), jamais current_date.
begin;
select plan(16);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function test_set_cart(p_lines jsonb) returns void language plpgsql as $$
begin
  delete from public.cart_items where account_id = auth.uid();
  insert into public.cart_items (account_id, product_id, date, end_date, qty)
  select auth.uid(), (l->>'product_id')::uuid, (l->>'date')::date, (l->>'end_date')::date, (l->>'qty')::int
    from jsonb_array_elements(p_lines) as l;
end;
$$;
-- Un panier d'une ligne, puis create_order : la raison rendue (ou 'ok').
create function test_order(p_product text, p_date date, p_qty int default 1, p_end date default null) returns text
language plpgsql as $$
declare
  v_result jsonb;
begin
  perform test_set_cart(jsonb_build_array(jsonb_build_object(
    'product_id', 'c8a80000-0000-4000-8000-0000000000' || p_product, 'date', p_date, 'end_date', p_end, 'qty', p_qty)));
  v_result := create_order('Cliente Vitrina', p_holder_email => 'vitrina@test.local');
  return case when (v_result ->> 'ok')::boolean then 'ok' else v_result ->> 'reason' end;
end;
$$;

insert into partners (id, display_name) values ('c8a80000-0000-4000-8000-000000000001', 'Vitrina Guards');
insert into establishments (id, partner_id, name) values
  ('c8a80000-0000-4000-8000-000000000011', 'c8a80000-0000-4000-8000-000000000001', jsonb_build_object('es', 'Vitrina Guards'));
insert into auth.users (id, email) values ('c8a80000-0000-4000-8000-000000000031', 'vitrina-buyer@test.local');

insert into products (id, partner_id, establishment_id, type, name, slug, sellable, price_cop, price_tiers,
                      external_booking_url, online_bookable, evento_capacity_mode, evento_payment_mode,
                      default_capacity, occurrence_type, occurrence_date, evento_occupies_resource) values
  -- 21 : activité ordinaire.
  ('c8a80000-0000-4000-8000-000000000021', 'c8a80000-0000-4000-8000-000000000001', 'c8a80000-0000-4000-8000-000000000011',
   'activity', jsonb_build_object('es', 'Kayak'), 'vitrina-kayak', true, 30000, null, null, false, null, null, 10, null, null, true),
  -- 22 : evento informatif (jamais réservable en ligne).
  ('c8a80000-0000-4000-8000-000000000022', 'c8a80000-0000-4000-8000-000000000001', 'c8a80000-0000-4000-8000-000000000011',
   'evento', jsonb_build_object('es', 'Charla'), 'vitrina-charla', true, 20000, null, null, false, null, null, null, null, null, false),
  -- 23 : activité à URL de réservation externe.
  ('c8a80000-0000-4000-8000-000000000023', 'c8a80000-0000-4000-8000-000000000001', 'c8a80000-0000-4000-8000-000000000011',
   'activity', jsonb_build_object('es', 'Parapente'), 'vitrina-parapente', true, 30000, null, 'https://reservas.example.test/parapente',
   false, null, null, 10, null, null, true),
  -- 24 : transport.
  ('c8a80000-0000-4000-8000-000000000024', 'c8a80000-0000-4000-8000-000000000001', 'c8a80000-0000-4000-8000-000000000011',
   'transport', jsonb_build_object('es', 'Lancha'), 'vitrina-lancha', true, 15000, null, null, false, null, null, 10, null, null, true),
  -- 25 : evento réservable en ligne, occurrence aujourd'hui, metered, sans ressource partagée.
  ('c8a80000-0000-4000-8000-000000000025', 'c8a80000-0000-4000-8000-000000000001', 'c8a80000-0000-4000-8000-000000000011',
   'evento', jsonb_build_object('es', 'Concierto'), 'vitrina-concierto', true, 40000, null, null, true, 'metered', 'online', 10,
   'once', public.today_in_bogota(), false),
  -- 26 : logement à paliers lacunaires (1-2, 4-5 : rien à 3).
  ('c8a80000-0000-4000-8000-000000000026', 'c8a80000-0000-4000-8000-000000000001', 'c8a80000-0000-4000-8000-000000000011',
   'lodging', jsonb_build_object('es', 'Casa paliers'), 'vitrina-casa-paliers', true, 100000,
   jsonb_build_array(jsonb_build_object('min_qty', 1, 'max_qty', 2, 'price_cop', 100000),
                     jsonb_build_object('min_qty', 4, 'max_qty', 5, 'price_cop', 90000)),
   null, false, null, null, null, null, null, true),
  -- 27 : logement sans palier.
  ('c8a80000-0000-4000-8000-000000000027', 'c8a80000-0000-4000-8000-000000000001', 'c8a80000-0000-4000-8000-000000000011',
   'lodging', jsonb_build_object('es', 'Casa simple'), 'vitrina-casa-simple', true, 100000, null,
   null, false, null, null, null, null, null, true);

-- Disponibilités : hier et aujourd'hui pour l'activité, les nuits de séjour des deux logements.
insert into product_availability (product_id, date, capacity, booked)
select p, public.today_in_bogota() + d, 10, 0
  from unnest(array['c8a80000-0000-4000-8000-000000000021', 'c8a80000-0000-4000-8000-000000000026',
                    'c8a80000-0000-4000-8000-000000000027']::uuid[]) p,
       generate_series(-1, 3) d;

set local role authenticated;
select test_login('c8a80000-0000-4000-8000-000000000031');
create temp table r (k text primary key, reason text);
insert into r values
  ('activite_hier',        test_order('21', public.today_in_bogota() - 1)),
  ('activite_aujourdhui',  test_order('21', public.today_in_bogota())),
  ('sejour_hier',          test_order('27', public.today_in_bogota() - 1, 1, public.today_in_bogota() + 1)),
  ('evento_occurrence_hier', test_order('25', public.today_in_bogota() - 1)),
  ('evento_informatif',    test_order('22', public.today_in_bogota() + 1)),
  ('url_externe',          test_order('23', public.today_in_bogota() + 1)),
  ('transport',            test_order('24', public.today_in_bogota() + 1)),
  ('evento_en_ligne',      test_order('25', public.today_in_bogota())),
  ('palier_trou',          test_order('26', public.today_in_bogota(), 3, public.today_in_bogota() + 2)),
  ('palier_couvert',       test_order('26', public.today_in_bogota(), 2, public.today_in_bogota() + 2)),
  ('sans_palier',          test_order('27', public.today_in_bogota(), 3, public.today_in_bogota() + 2));
reset role;

-- ── G8a : date passée ──────────────────────────────────────────────────────
select is((select reason from r where k = 'activite_hier'), 'date_in_past', 'G8a : activité hier (Colombie) → date_in_past');
select is((select reason from r where k = 'activite_aujourdhui'), 'ok', 'G8a : activité aujourd''hui → acceptée (le jour même reste ouvert)');
select is((select reason from r where k = 'sejour_hier'), 'date_in_past', 'G8a : séjour commencé hier → date_in_past (le début compte)');
select is((select reason from r where k = 'evento_occurrence_hier'), 'date_in_past',
  'G8a : evento réservable, date d''hier → date_in_past (avant même le contrôle d''occurrence)');

-- ── G8b : ce que la vitrine ne vend pas en ligne ────────────────────────────
select is((select reason from r where k = 'evento_informatif'), 'not_sellable', 'G8b : evento non réservable en ligne → not_sellable');
select is((select reason from r where k = 'url_externe'), 'not_sellable', 'G8b : produit à URL de réservation externe → not_sellable');
select is((select reason from r where k = 'transport'), 'not_sellable', 'G8b : transport → not_sellable');
select is((select reason from r where k = 'evento_en_ligne'), 'ok', 'G8b : evento réservable en ligne, occurrence du jour → accepté');

-- ── G17 : palier de logement ────────────────────────────────────────────────
select is((select reason from r where k = 'palier_trou'), 'no_matching_tier',
  'G17 : logement, 3 dans le trou entre les paliers 1-2 et 4-5 → no_matching_tier (jamais le prix de base)');
select is((select reason from r where k = 'palier_couvert'), 'ok', 'G17 : logement, 2 dans le palier 1-2 → accepté');
select is((select reason from r where k = 'sans_palier'), 'ok', 'G17 : logement sans palier, 3 → accepté (aucun palier à couvrir)');

-- ── Aucun refus n'écrit ─────────────────────────────────────────────────────
select is(
  (select count(*)::int from orders where account_id = 'c8a80000-0000-4000-8000-000000000031'),
  (select count(*)::int from r where reason = 'ok'),
  'une commande par acceptation, aucune pour les refus');
select is(
  (select booked from product_availability
    where product_id = 'c8a80000-0000-4000-8000-000000000021' and date = public.today_in_bogota() - 1),
  0, 'G8a : rien de pris hier');
select is(
  (select coalesce(sum(booked), 0)::int from product_availability
    where product_id = 'c8a80000-0000-4000-8000-000000000026'),
  2 * 2, 'G17 : seul le séjour couvert (2 × 2 nuits) a pris des nuits');
select is(
  (select price_cop from order_lines ol join orders o on o.id = ol.order_id
    where o.account_id = 'c8a80000-0000-4000-8000-000000000031' and ol.product_id = 'c8a80000-0000-4000-8000-000000000026'),
  200000::bigint, 'G17 : le séjour couvert est facturé au palier 1-2 (100 000 la nuit, 2 nuits)');
select ok(
  not exists (select 1 from order_lines ol join orders o on o.id = ol.order_id
               where o.account_id = 'c8a80000-0000-4000-8000-000000000031'
                 and ol.product_id in ('c8a80000-0000-4000-8000-000000000022', 'c8a80000-0000-4000-8000-000000000023',
                                       'c8a80000-0000-4000-8000-000000000024')),
  'G8b : aucune ligne pour evento informatif, URL externe ni transport');

select * from finish();
rollback;

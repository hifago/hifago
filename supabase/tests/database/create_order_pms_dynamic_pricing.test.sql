-- Prix Lobby dynamique (migrations 20261024100000 et 20261024110000). Les raisons de refus (devis
-- absent, aux autres dates, périmé, quantité au-delà des places cotées) et leur parité avec
-- cart_lines_availability sont dans cart_lines_availability.test.sql ; ce fichier porte le reste :
--   - grants : pms_cart_quotes fermée, record_pms_cart_quotes au seul service_role, l'interrupteur
--     lisible par la vitrine ;
--   - record_pms_cart_quotes n'écrit que le devis d'une ligne de panier DU compte, aux mêmes produit et
--     dates, à la ventilation complète ; réécrire rafraîchit quoted_at ;
--   - create_order sous devis : price_cop = Σ des nuits, total = × qty, ventilation figée, commission
--     inchangée (une part du total), panier et devis effacés ;
--   - interrupteur éteint : rien ne change (prix fixe, aucun devis exigé, aucune ventilation) ;
--   - claim_paid_order_for_pms_booking relit la ventilation ; le miroir garde les prix ;
--   - pms_quote_unit_sum : la règle « ventilation complète », cas par cas.
-- Dates relatives à today_in_bogota(), jamais current_date.
begin;
select plan(31);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values ('d1c70000-0000-4000-8000-000000000001', 'Prix Lobby');
insert into establishments (id, partner_id, name, lobby_connector_active, lobby_api_token, lobby_dynamic_pricing) values
  -- 11 : prix Lobby ; 12 : connecteur actif, interrupteur éteint.
  ('d1c70000-0000-4000-8000-000000000011', 'd1c70000-0000-4000-8000-000000000001', jsonb_build_object('es', 'Lobby dinámico'), true, 'fake-token', true),
  ('d1c70000-0000-4000-8000-000000000012', 'd1c70000-0000-4000-8000-000000000001', jsonb_build_object('es', 'Lobby fijo'), true, 'fake-token', false);
insert into products (id, partner_id, establishment_id, type, name, slug, sellable, price_cop, lobby_category_id, unit) values
  ('d1c70000-0000-4000-8000-000000000021', 'd1c70000-0000-4000-8000-000000000001', 'd1c70000-0000-4000-8000-000000000011',
   'lodging', jsonb_build_object('es', 'Dormitorio dinámico'), 'pld-21', true, 100000, 9631, 'per_person'),
  ('d1c70000-0000-4000-8000-000000000022', 'd1c70000-0000-4000-8000-000000000001', 'd1c70000-0000-4000-8000-000000000012',
   'lodging', jsonb_build_object('es', 'Dormitorio fijo'), 'pld-22', true, 100000, 9632, 'per_person');
insert into auth.users (id, email) values
  ('d1c70000-0000-4000-8000-000000000031', 'prix-lobby@test.local'),
  ('d1c70000-0000-4000-8000-000000000032', 'prix-lobby-autre@test.local');

-- Une nuitée de deux nuits (J+10 → J+12) dans chacun des deux paniers, et une au prix fixe.
insert into cart_items (id, account_id, product_id, date, end_date, qty) values
  ('d1c70000-0000-4000-8000-000000000041', 'd1c70000-0000-4000-8000-000000000031', 'd1c70000-0000-4000-8000-000000000021',
   public.today_in_bogota() + 10, public.today_in_bogota() + 12, 2),
  ('d1c70000-0000-4000-8000-000000000042', 'd1c70000-0000-4000-8000-000000000032', 'd1c70000-0000-4000-8000-000000000021',
   public.today_in_bogota() + 10, public.today_in_bogota() + 12, 1);

-- La ventilation d'un séjour de J+10 à J+12 : semaine 50 000, la nuit suivante 70 000.
create function test_nightly(p_first int default 50000, p_second int default 70000) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('date', public.today_in_bogota() + 10, 'unit_price_cop', p_first),
    jsonb_build_object('date', public.today_in_bogota() + 11, 'unit_price_cop', p_second));
$$;
create function test_quote(p_item uuid, p_nightly jsonb, p_min int default 5, p_date int default 10, p_end int default 12)
returns jsonb language sql as $$
  select jsonb_build_object('cart_item_id', p_item, 'product_id', 'd1c70000-0000-4000-8000-000000000021',
                            'date', public.today_in_bogota() + p_date, 'end_date', public.today_in_bogota() + p_end,
                            'nightly_unit_prices', p_nightly, 'min_available_cupos', p_min);
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
select ok(
  has_column_privilege('anon', 'public.establishments', 'lobby_dynamic_pricing', 'select')
    and has_column_privilege('authenticated', 'public.establishments', 'lobby_dynamic_pricing', 'select'),
  'l''interrupteur est lisible par la vitrine (anon, session) — establishments n''a qu''un grant par colonne');
select ok(
  not has_table_privilege('anon', 'public.pms_cart_quotes', 'select')
    and not has_table_privilege('authenticated', 'public.pms_cart_quotes', 'select')
    and not has_table_privilege('authenticated', 'public.pms_cart_quotes', 'insert')
    and not has_table_privilege('authenticated', 'public.pms_cart_quotes', 'update'),
  'pms_cart_quotes : ni lecture ni écriture directe pour un client');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.pms_cart_quotes'::regclass)
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pms_cart_quotes'),
  'pms_cart_quotes : RLS active, aucune policy');
select ok(
  has_function_privilege('service_role', 'public.record_pms_cart_quotes(uuid, jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.record_pms_cart_quotes(uuid, jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.record_pms_cart_quotes(uuid, jsonb)', 'execute'),
  'record_pms_cart_quotes : service_role seul');
select ok(
  (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.record_pms_cart_quotes(uuid, jsonb)'::regprocedure),
  'record_pms_cart_quotes : SECURITY DEFINER, search_path vide');

-- ── pms_quote_unit_sum ──────────────────────────────────────────────────────
select is(public.pms_quote_unit_sum(test_nightly(), public.today_in_bogota() + 10, public.today_in_bogota() + 12),
  120000::bigint, 'ventilation complète : Σ des prix d''une unité');
select is(public.pms_quote_unit_sum(test_nightly(), public.today_in_bogota() + 10, public.today_in_bogota() + 13),
  null, 'une nuit manquante : null');
select is(public.pms_quote_unit_sum(jsonb_build_array(test_nightly()->1, test_nightly()->0), public.today_in_bogota() + 10, public.today_in_bogota() + 12),
  null, 'nuits dans le désordre : null');
select is(public.pms_quote_unit_sum(test_nightly(50000, 0), public.today_in_bogota() + 10, public.today_in_bogota() + 12),
  null, 'un prix nul : null — jamais une nuit gratuite');
select is(public.pms_quote_unit_sum(jsonb_build_array(
    jsonb_build_object('date', public.today_in_bogota() + 10, 'unit_price_cop', 50000.5),
    jsonb_build_object('date', public.today_in_bogota() + 11, 'unit_price_cop', 70000)),
  public.today_in_bogota() + 10, public.today_in_bogota() + 12),
  null, 'un prix non entier : null');
select is(public.pms_quote_unit_sum('{"a": 1}'::jsonb, public.today_in_bogota() + 10, public.today_in_bogota() + 12),
  null, 'pas un tableau : null');

-- ── record_pms_cart_quotes ──────────────────────────────────────────────────
set local role service_role;
select is(
  public.record_pms_cart_quotes('d1c70000-0000-4000-8000-000000000031',
    jsonb_build_array(test_quote('d1c70000-0000-4000-8000-000000000041', test_nightly()))),
  '{"ok": true, "recorded": 1, "rejected": 0}'::jsonb, 'le devis d''une ligne du compte est écrit');
select is(
  public.record_pms_cart_quotes('d1c70000-0000-4000-8000-000000000031',
    jsonb_build_array(test_quote('d1c70000-0000-4000-8000-000000000042', test_nightly()))),
  '{"ok": true, "recorded": 0, "rejected": 1}'::jsonb, 'jamais sur la ligne de panier d''un AUTRE compte');
select is(
  public.record_pms_cart_quotes('d1c70000-0000-4000-8000-000000000031', jsonb_build_array(
    test_quote('d1c70000-0000-4000-8000-000000000041', test_nightly(), 5, 11, 13),
    test_quote('d1c70000-0000-4000-8000-000000000041', jsonb_build_array(test_nightly()->0)),
    test_quote('d1c70000-0000-4000-8000-000000000041', test_nightly(), -1),
    jsonb_build_object('cart_item_id', 'pas-un-uuid'))),
  '{"ok": true, "recorded": 0, "rejected": 4}'::jsonb,
  'rejetés : autres dates, ventilation incomplète, places négatives, identifiant illisible');
select is(public.record_pms_cart_quotes('d1c70000-0000-4000-8000-000000000031', '{}'::jsonb),
  '{"ok": false, "reason": "invalid_input"}'::jsonb, 'pas un tableau : refusé');
reset role;
update pms_cart_quotes set quoted_at = now() - interval '1 hour', min_available_cupos = 1
 where cart_item_id = 'd1c70000-0000-4000-8000-000000000041';
set local role service_role;
select public.record_pms_cart_quotes('d1c70000-0000-4000-8000-000000000031',
  jsonb_build_array(test_quote('d1c70000-0000-4000-8000-000000000041', test_nightly())));
reset role;
select ok(
  (select quoted_at = now() and min_available_cupos = 5 and nightly_unit_prices = test_nightly()
     from pms_cart_quotes where cart_item_id = 'd1c70000-0000-4000-8000-000000000041'),
  'réécrire le devis le rafraîchit (quoted_at, places, ventilation)');

-- ── create_order sous devis ─────────────────────────────────────────────────
set local role authenticated;
select test_login('d1c70000-0000-4000-8000-000000000031');
create temp table test_order as
  select public.create_order('Cliente Lobby', p_holder_email => 'cliente-lobby@test.local') as r;
reset role;
-- Créée sous la session du client : le claim, plus bas, la relit en service_role.
grant select on test_order to service_role;
select is((select r->>'ok' from test_order), 'true', 'la commande passe sous devis valide');
select is(
  (select price_cop from order_lines where order_id = (select (r->>'order_id')::uuid from test_order)),
  120000::bigint, 'price_cop = Σ des prix d''une unité du devis (50 000 + 70 000), pas le prix fixe');
select is(
  (select total_cop from order_lines where order_id = (select (r->>'order_id')::uuid from test_order)),
  240000::bigint, 'total_cop = price_cop × qty (2 lits)');
select is(
  (select pms_nightly_unit_prices from order_lines where order_id = (select (r->>'order_id')::uuid from test_order)),
  test_nightly(), 'la ventilation du devis est figée sur la ligne');
select is(
  (select array[commission_case, acompte_cop::text, app_commission_cop::text, referrer_commission_cop::text]
     from order_lines where order_id = (select (r->>'order_id')::uuid from test_order)),
  array['direct', '40800', '40800', '0'],
  'commission inchangée : une PART du total (17 % en direct), jamais une majoration');
select is(
  (select count(*)::int from cart_items where account_id = 'd1c70000-0000-4000-8000-000000000031')
    + (select count(*)::int from pms_cart_quotes where account_id = 'd1c70000-0000-4000-8000-000000000031'),
  0, 'le panier vidé emporte son devis (clé étrangère en cascade)');

-- ── claim_paid_order_for_pms_booking relit la ventilation ───────────────────
update orders set payment_status = 'paid' where id = (select (r->>'order_id')::uuid from test_order);
set local role service_role;
create temp table test_claim as
  select public.claim_paid_order_for_pms_booking((select (r->>'order_id')::uuid from test_order)) as c;
reset role;
select is(
  (select c->'groups'->0->'lodging_lines'->0->'pms_nightly_unit_prices' from test_claim),
  test_nightly(), 'le claim payé porte la ventilation : pms-book-paid-orders envoie ces prix à Lobby');

-- ── Interrupteur éteint : rien ne change ────────────────────────────────────
insert into cart_items (account_id, product_id, date, end_date, qty) values
  ('d1c70000-0000-4000-8000-000000000031', 'd1c70000-0000-4000-8000-000000000022',
   public.today_in_bogota() + 10, public.today_in_bogota() + 12, 2);
set local role authenticated;
select test_login('d1c70000-0000-4000-8000-000000000031');
create temp table test_order_fixe as
  select public.create_order('Cliente Lobby', p_holder_email => 'cliente-lobby@test.local') as r;
reset role;
select is((select r->>'ok' from test_order_fixe), 'true', 'interrupteur éteint : aucun devis exigé');
select is(
  (select array[price_cop, total_cop] from order_lines where order_id = (select (r->>'order_id')::uuid from test_order_fixe)),
  array[200000, 400000]::bigint[], 'interrupteur éteint : le prix fixe hifago (100 000 × 2 nuits), × 2 lits');
select is(
  (select pms_nightly_unit_prices from order_lines where order_id = (select (r->>'order_id')::uuid from test_order_fixe)),
  null, 'interrupteur éteint : aucune ventilation (repli du partage égal chez Lobby)');

-- ── Le miroir garde les prix (affichage) ────────────────────────────────────
set local role service_role;
select public.sync_pms_availability_month('d1c70000-0000-4000-8000-000000000011',
  to_char(public.today_in_bogota() + 40, 'YYYY-MM'),
  jsonb_build_array(
    jsonb_build_object('category_id', 9631, 'date', public.today_in_bogota() + 40, 'available_units', 8,
                       'prices', jsonb_build_object('1', 45000)),
    jsonb_build_object('category_id', 9633, 'date', public.today_in_bogota() + 40, 'available_units', 3,
                       'prices', jsonb_build_array(1)),
    jsonb_build_object('category_id', 9634, 'date', public.today_in_bogota() + 40, 'available_units', 2)));
reset role;
select is(
  (select prices from pms_availability_mirror
    where establishment_id = 'd1c70000-0000-4000-8000-000000000011' and lobby_category_id = 9631
      and date = public.today_in_bogota() + 40),
  '{"1": 45000}'::jsonb, 'sync_pms_availability_month écrit les prix par occupation');
select is(
  (select array_agg(coalesce(prices::text, 'null') order by lobby_category_id) from pms_availability_mirror
    where establishment_id = 'd1c70000-0000-4000-8000-000000000011' and lobby_category_id in (9633, 9634)
      and date = public.today_in_bogota() + 40),
  array['null', 'null'], 'des prix illisibles ou absents (Edge Function à l''ancienne version) : null, la nuit reste écrite');
select ok(
  has_column_privilege('anon', 'public.pms_availability_mirror', 'prices', 'select'),
  'les prix du miroir sont lisibles par la vitrine, comme le reste du miroir');

-- ── La quantité au-delà des places cotées, côté create_order (raison seule) ─
insert into cart_items (id, account_id, product_id, date, end_date, qty) values
  ('d1c70000-0000-4000-8000-000000000043', 'd1c70000-0000-4000-8000-000000000031', 'd1c70000-0000-4000-8000-000000000021',
   public.today_in_bogota() + 10, public.today_in_bogota() + 12, 4);
set local role service_role;
select public.record_pms_cart_quotes('d1c70000-0000-4000-8000-000000000031',
  jsonb_build_array(test_quote('d1c70000-0000-4000-8000-000000000043', test_nightly(), 3)));
set local role authenticated;
select test_login('d1c70000-0000-4000-8000-000000000031');
select is(
  (select public.create_order('Cliente Lobby', p_holder_email => 'cliente-lobby@test.local')->>'reason'),
  'pms_capacity_exceeded', '4 lits demandés, 3 cotés par Lobby : refusé avant toute écriture');
reset role;
select is(
  (select count(*)::int from cart_items where id = 'd1c70000-0000-4000-8000-000000000043'),
  1, 'refusée, la commande laisse le panier intact');

select * from finish();
rollback;

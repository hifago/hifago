-- Fermeture de la fuite des colonnes de commission (docs/backlog.md, 2026-09-11) — site 6/10 :
-- partner_reservations_list (20260922175000) remplace la lecture directe de
-- apps/admin/app/partner/(app)/reservations/page.tsx (« Mis reservas »).
begin;
select plan(5);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('889c0000-0000-4000-8000-000000000001', 'Reservations List Own'),
  ('889c0000-0000-4000-8000-000000000002', 'Reservations List Other');
insert into establishments (id, partner_id, name) values
  ('889c0000-0000-4000-8000-000000000011', '889c0000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Reservations List Own')),
  ('889c0000-0000-4000-8000-000000000012', '889c0000-0000-4000-8000-000000000002',
   jsonb_build_object('es', 'Establecimiento Reservations List Other'));

insert into auth.users (id, email) values
  ('889c0000-0000-4000-8000-000000000021', 'reservations-list-own@test.local'),
  ('889c0000-0000-4000-8000-000000000022', 'reservations-list-other@test.local'),
  ('889c0000-0000-4000-8000-000000000023', 'reservations-list-buyer@test.local');
update partner_accounts set partner_id = '889c0000-0000-4000-8000-000000000001'
 where id = '889c0000-0000-4000-8000-000000000021';
update partner_accounts set partner_id = '889c0000-0000-4000-8000-000000000002'
 where id = '889c0000-0000-4000-8000-000000000022';
insert into partner_capabilities (partner_id, role, source, status) values
  ('889c0000-0000-4000-8000-000000000001', 'referrer', 'migration', 'active'),
  ('889c0000-0000-4000-8000-000000000002', 'referrer', 'migration', 'active');
insert into partner_capabilities (partner_id, role, establishment_id, source, status) values
  ('889c0000-0000-4000-8000-000000000001', 'operator', '889c0000-0000-4000-8000-000000000011',
   'migration', 'active'),
  ('889c0000-0000-4000-8000-000000000002', 'operator', '889c0000-0000-4000-8000-000000000012',
   'migration', 'active');

insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('889c0000-0000-4000-8000-000000000031', '889c0000-0000-4000-8000-000000000001',
   '889c0000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Actividad Reservations List Own'), 50000, true, 'reservations-list-own-test'),
  ('889c0000-0000-4000-8000-000000000032', '889c0000-0000-4000-8000-000000000002',
   '889c0000-0000-4000-8000-000000000012', 'activity',
   jsonb_build_object('es', 'Actividad Reservations List Other'), 50000, true, 'reservations-list-other-test');

insert into orders (id, account_id, holder_name, holder_email) values
  ('889c0000-0000-4000-8000-000000000041', '889c0000-0000-4000-8000-000000000023',
   'Reservations List Holder', 'rl-holder@test.local');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  ('889c0000-0000-4000-8000-000000000051', '889c0000-0000-4000-8000-000000000041',
   '889c0000-0000-4000-8000-000000000023', '889c0000-0000-4000-8000-000000000031',
   '2029-08-20', 1, 'reserved', 'Reservations List Holder',
   50000, 50000, 'direct', 0, 0, 0, 0, 0, 0),
  ('889c0000-0000-4000-8000-000000000052', '889c0000-0000-4000-8000-000000000041',
   '889c0000-0000-4000-8000-000000000023', '889c0000-0000-4000-8000-000000000032',
   '2029-08-20', 1, 'reserved', 'Reservations List Holder',
   50000, 50000, 'direct', 0, 0, 0, 0, 0, 0);

set local role authenticated;

select test_login('889c0000-0000-4000-8000-000000000021'); -- operator_own, établissement 011
select is(
  (select count(*)::int from partner_reservations_list(p_limit => 20, p_offset => 0)),
  1,
  'operator ne voit que les lignes de SON établissement (jamais celles d''un autre socio)'
);
select is(
  (select id from partner_reservations_list(p_limit => 20, p_offset => 0)),
  '889c0000-0000-4000-8000-000000000051'::uuid,
  'operator voit précisément sa propre ligne'
);
select is(
  (select total_count from partner_reservations_list(p_limit => 20, p_offset => 0)),
  1::bigint,
  'total_count reflète le scope établissement, pas le total toutes lignes confondues'
);

select test_login('889c0000-0000-4000-8000-000000000022'); -- operator_other, établissement 012
select is(
  (select id from partner_reservations_list(p_limit => 20, p_offset => 0)),
  '889c0000-0000-4000-8000-000000000052'::uuid,
  'symétrique : l''autre operator voit uniquement SA ligne'
);

-- Colonnes rendues : liste EXACTE, lue dans `proargnames`/`proargmodes` (mode 't' = colonne de
-- `returns table`), même idiome que partner_commissions_list.test.sql. L'ancienne assertion joignait
-- `pg_attribute` via `pg_type.typrelid`, nul pour un `returns table` (type `record`) : elle ne
-- trouvait aucune colonne et passait quoi que la fonction rende. La liste exacte rougit sur une
-- colonne de commission ajoutée comme sur tout autre ajout non relu.
select is(
  (select string_agg(a.n, ', ' order by a.n)
     from pg_proc p, unnest(p.proargnames, p.proargmodes) as a(n, m)
    where p.oid = 'public.partner_reservations_list'::regproc and a.m = 't'),
  'date, establishment_name, holder_email, holder_name, holder_phone, id, product_name, qty, '
  'status, total_cop, total_count',
  'partner_reservations_list rend exactement ses colonnes d''affichage — aucune colonne de commission'
);

select * from finish();
rollback;

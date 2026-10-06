-- Fermeture de la fuite des colonnes de commission (docs/backlog.md, 2026-09-11) — site 2/10 :
-- admin_client_order_lines (20260922130000) remplace la lecture directe d'order_lines de
-- apps/admin/app/admin/clients/[client_key]/page.tsx.
begin;
select plan(4);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('88980000-0000-4000-8000-000000000001', 'Admin Client Lines Test Partner');
insert into establishments (id, partner_id, name) values
  ('88980000-0000-4000-8000-000000000011', '88980000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Admin Client Lines'));
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('88980000-0000-4000-8000-000000000021', '88980000-0000-4000-8000-000000000001',
   '88980000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Actividad Admin Client Lines'), 50000, true, 'admin-client-lines-test');

insert into auth.users (id, email) values
  ('88980000-0000-4000-8000-000000000031', 'admin-client-lines-admin@test.local'),
  ('88980000-0000-4000-8000-000000000032', 'admin-client-lines-buyer@test.local');
insert into partner_capabilities (account_id, role, source, status)
values ('88980000-0000-4000-8000-000000000031', 'admin', 'migration', 'active');

insert into orders (id, account_id, holder_name, holder_email) values
  ('88980000-0000-4000-8000-000000000041', '88980000-0000-4000-8000-000000000032',
   'Admin Client Lines Holder', 'acl-holder@test.local');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '88980000-0000-4000-8000-000000000051', '88980000-0000-4000-8000-000000000041',
  '88980000-0000-4000-8000-000000000032', '88980000-0000-4000-8000-000000000021',
  '2029-08-01', 1, 'reserved', 'Admin Client Lines Holder',
  50000, 50000, 'direct', 0, 0, 0, 0, 0, 0
);

set local role authenticated;

select test_login('88980000-0000-4000-8000-000000000032'); -- buyer, pas admin
select throws_ok(
  $$ select * from admin_client_order_lines(array['88980000-0000-4000-8000-000000000041']::uuid[]) $$,
  '42501'::char(5), null,
  'appel non-admin → exception 42501'
);

select test_login('88980000-0000-4000-8000-000000000031'); -- admin
select is(
  (select count(*)::int from admin_client_order_lines(array['88980000-0000-4000-8000-000000000041']::uuid[])),
  1,
  'admin : voit la ligne de la commande demandée'
);
select is(
  (select jsonb_build_object('order_id', order_id, 'total_cop', total_cop, 'status', status)
     from admin_client_order_lines(array['88980000-0000-4000-8000-000000000041']::uuid[])),
  jsonb_build_object('order_id', '88980000-0000-4000-8000-000000000041'::uuid, 'total_cop', 50000, 'status', 'reserved'),
  'admin : colonnes attendues, correctes'
);

-- Colonnes rendues : liste EXACTE, lue dans `proargnames`/`proargmodes` (mode 't' = colonne de
-- `returns table`), même idiome que partner_commissions_list.test.sql. L'ancienne assertion joignait
-- `pg_attribute` via `pg_type.typrelid`, nul pour un `returns table` (type `record`) : elle ne
-- trouvait aucune colonne et passait quoi que la fonction rende. La liste exacte rougit sur une
-- colonne de commission ajoutée comme sur tout autre ajout non relu.
select is(
  (select string_agg(a.n, ', ' order by a.n)
     from pg_proc p, unnest(p.proargnames, p.proargmodes) as a(n, m)
    where p.oid = 'public.admin_client_order_lines'::regproc and a.m = 't'),
  'date, end_date, establishment_name, id, order_id, product_name, qty, status, total_cop',
  'admin_client_order_lines rend exactement ses colonnes d''affichage — aucune colonne de commission'
);

select * from finish();
rollback;

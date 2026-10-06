-- Fermeture de la fuite des colonnes de commission (docs/backlog.md, 2026-09-11) — sites 9-10/10 :
-- admin_order_line_summaries (20260922140000) remplace les embeds order_lines(...) de
-- apps/admin/app/admin/reconciliation/page.tsx et .../establishments/[id]/resource/page.tsx.
begin;
select plan(4);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('88990000-0000-4000-8000-000000000001', 'Order Line Summaries Test Partner');
insert into establishments (id, partner_id, name) values
  ('88990000-0000-4000-8000-000000000011', '88990000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Order Line Summaries'));
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('88990000-0000-4000-8000-000000000021', '88990000-0000-4000-8000-000000000001',
   '88990000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Actividad Order Line Summaries'), 50000, true, 'order-line-summaries-test');

insert into auth.users (id, email) values
  ('88990000-0000-4000-8000-000000000031', 'ols-admin@test.local'),
  ('88990000-0000-4000-8000-000000000032', 'ols-buyer@test.local');
insert into partner_capabilities (account_id, role, source, status)
values ('88990000-0000-4000-8000-000000000031', 'admin', 'migration', 'active');

insert into orders (id, account_id, holder_name, holder_email) values
  ('88990000-0000-4000-8000-000000000041', '88990000-0000-4000-8000-000000000032',
   'Order Line Summaries Holder', 'ols-holder@test.local');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '88990000-0000-4000-8000-000000000051', '88990000-0000-4000-8000-000000000041',
  '88990000-0000-4000-8000-000000000032', '88990000-0000-4000-8000-000000000021',
  '2029-08-05', 1, 'reserved', 'Order Line Summaries Holder',
  50000, 50000, 'direct', 0, 0, 0, 0, 0, 0
);

set local role authenticated;

select test_login('88990000-0000-4000-8000-000000000032'); -- buyer, pas admin
select throws_ok(
  $$ select * from admin_order_line_summaries(array['88990000-0000-4000-8000-000000000051']::uuid[]) $$,
  '42501'::char(5), null,
  'appel non-admin → exception 42501'
);

select test_login('88990000-0000-4000-8000-000000000031'); -- admin
select is(
  (select count(*)::int from admin_order_line_summaries(array['88990000-0000-4000-8000-000000000051']::uuid[])),
  1,
  'admin : voit le résumé de la ligne demandée'
);
select is(
  (select jsonb_build_object('order_id', order_id, 'holder_name', holder_name)
     from admin_order_line_summaries(array['88990000-0000-4000-8000-000000000051']::uuid[])),
  jsonb_build_object('order_id', '88990000-0000-4000-8000-000000000041'::uuid, 'holder_name', 'Order Line Summaries Holder'),
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
    where p.oid = 'public.admin_order_line_summaries'::regproc and a.m = 't'),
  'establishment_name, holder_name, order_id, order_line_id, product_name',
  'admin_order_line_summaries rend exactement ses colonnes d''affichage — aucune colonne de commission/montant'
);

select * from finish();
rollback;

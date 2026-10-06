-- Fermeture de la fuite des colonnes de commission (docs/backlog.md, 2026-09-11) — site 5/10 :
-- partner_agenda_order_lines (20260922180000) remplace la lecture directe de
-- apps/admin/app/partner/(app)/page.tsx (agenda socio).
begin;
select plan(4);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('889d0000-0000-4000-8000-000000000001', 'Agenda Own'),
  ('889d0000-0000-4000-8000-000000000002', 'Agenda Other');
insert into establishments (id, partner_id, name) values
  ('889d0000-0000-4000-8000-000000000011', '889d0000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Agenda Own')),
  ('889d0000-0000-4000-8000-000000000012', '889d0000-0000-4000-8000-000000000002',
   jsonb_build_object('es', 'Establecimiento Agenda Other'));

insert into auth.users (id, email) values
  ('889d0000-0000-4000-8000-000000000021', 'agenda-own@test.local'),
  ('889d0000-0000-4000-8000-000000000022', 'agenda-buyer@test.local');
update partner_accounts set partner_id = '889d0000-0000-4000-8000-000000000001'
 where id = '889d0000-0000-4000-8000-000000000021';
insert into partner_capabilities (partner_id, role, source, status) values
  ('889d0000-0000-4000-8000-000000000001', 'referrer', 'migration', 'active');
insert into partner_capabilities (partner_id, role, establishment_id, source, status) values
  ('889d0000-0000-4000-8000-000000000001', 'operator', '889d0000-0000-4000-8000-000000000011',
   'migration', 'active');

insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('889d0000-0000-4000-8000-000000000031', '889d0000-0000-4000-8000-000000000001',
   '889d0000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Actividad Agenda Own'), 50000, true, 'agenda-own-test'),
  ('889d0000-0000-4000-8000-000000000032', '889d0000-0000-4000-8000-000000000002',
   '889d0000-0000-4000-8000-000000000012', 'activity',
   jsonb_build_object('es', 'Actividad Agenda Other'), 50000, true, 'agenda-other-test');

insert into orders (id, account_id, holder_name, holder_email) values
  ('889d0000-0000-4000-8000-000000000041', '889d0000-0000-4000-8000-000000000022',
   'Agenda Holder', 'agenda-holder@test.local');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  -- Dans la fenêtre, établissement own → visible.
  ('889d0000-0000-4000-8000-000000000051', '889d0000-0000-4000-8000-000000000041',
   '889d0000-0000-4000-8000-000000000022', '889d0000-0000-4000-8000-000000000031',
   '2029-08-25', 1, 'reserved', 'Agenda Holder',
   50000, 50000, 'direct', 0, 0, 0, 0, 0, 0),
  -- Dans la fenêtre, établissement other → jamais visible pour operator_own.
  ('889d0000-0000-4000-8000-000000000052', '889d0000-0000-4000-8000-000000000041',
   '889d0000-0000-4000-8000-000000000022', '889d0000-0000-4000-8000-000000000032',
   '2029-08-25', 1, 'reserved', 'Agenda Holder',
   50000, 50000, 'direct', 0, 0, 0, 0, 0, 0),
  -- Établissement own mais statut cancelled_by_client → exclu (hors des 3 statuts agenda).
  ('889d0000-0000-4000-8000-000000000053', '889d0000-0000-4000-8000-000000000041',
   '889d0000-0000-4000-8000-000000000022', '889d0000-0000-4000-8000-000000000031',
   '2029-08-26', 1, 'cancelled_by_client', 'Agenda Holder',
   50000, 50000, 'direct', 0, 0, 0, 0, 0, 0);

set local role authenticated;
select test_login('889d0000-0000-4000-8000-000000000021'); -- operator_own, établissement 011

select is(
  (select count(*)::int from partner_agenda_order_lines('2029-08-01'::date, '2029-09-01'::date)),
  1,
  'operator ne voit que sa ligne reserved de son établissement (jamais celle de l''autre, jamais la cancelled)'
);
select is(
  (select id from partner_agenda_order_lines('2029-08-01'::date, '2029-09-01'::date)),
  '889d0000-0000-4000-8000-000000000051'::uuid,
  'exactement la bonne ligne'
);
select is(
  (select count(*)::int from partner_agenda_order_lines('2029-01-01'::date, '2029-02-01'::date)),
  0,
  'fenêtre de dates respectée : rien hors [from, to]'
);
-- Colonnes rendues : liste EXACTE, lue dans `proargnames`/`proargmodes` (mode 't' = colonne de
-- `returns table`), même idiome que partner_commissions_list.test.sql. L'ancienne assertion joignait
-- `pg_attribute` via `pg_type.typrelid`, nul pour un `returns table` (type `record`) : elle ne
-- trouvait aucune colonne et passait quoi que la fonction rende. La liste exacte rougit sur une
-- colonne de commission ajoutée comme sur tout autre ajout non relu.
select is(
  (select string_agg(a.n, ', ' order by a.n)
     from pg_proc p, unnest(p.proargnames, p.proargmodes) as a(n, m)
    where p.oid = 'public.partner_agenda_order_lines'::regproc and a.m = 't'),
  'date, end_date, holder_name, id, product_duration_days, product_id, product_name, '
  'product_type, qty, slot_start_time, status',
  'partner_agenda_order_lines rend exactement ses colonnes d''affichage — aucune colonne de commission/montant'
);

select * from finish();
rollback;

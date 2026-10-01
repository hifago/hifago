-- admin_ledger_entries_list (20260930211348) — remplace l'embed `order_lines!inner` de
-- apps/admin/app/admin/ledger/page.tsx, cassé par le revoke du 2026-09-22 (20260922210000).
--
-- ⚠️ ASSERTIONS DÉTERMINISTES SUR UNE BASE SEEDÉE. L'admin voit TOUT le ledger, seed compris : un
-- « l'admin voit N lignes » serait faux dès que la base locale porte d'autres entrées. Chaque
-- assertion est donc bornée par un filtre qui ne peut viser QUE les fixtures de ce fichier (le
-- référent A, ou les établissements 011/012 créés ici) — c'est aussi ce qui prouve les filtres.
begin;
select plan(13);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('88a10000-0000-4000-8000-000000000001', 'Ledger List Owner'),
  ('88a10000-0000-4000-8000-000000000002', 'Ledger List Referrer A'),
  ('88a10000-0000-4000-8000-000000000003', 'Ledger List Referrer B');
insert into establishments (id, partner_id, name) values
  ('88a10000-0000-4000-8000-000000000011', '88a10000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Ledger List')),
  ('88a10000-0000-4000-8000-000000000012', '88a10000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Segundo Establecimiento Ledger List'));
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('88a10000-0000-4000-8000-000000000021', '88a10000-0000-4000-8000-000000000001',
   '88a10000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Actividad Ledger List'), 50000, true, 'ledger-list-activity-test'),
  ('88a10000-0000-4000-8000-000000000022', '88a10000-0000-4000-8000-000000000001',
   '88a10000-0000-4000-8000-000000000012', 'transport',
   jsonb_build_object('es', 'Transporte Ledger List'), 50000, true, 'ledger-list-transport-test');

insert into auth.users (id, email) values
  ('88a10000-0000-4000-8000-000000000031', 'ledger-list-admin@test.local'),
  ('88a10000-0000-4000-8000-000000000032', 'ledger-list-buyer@test.local');
insert into partner_capabilities (account_id, role, source, status)
values ('88a10000-0000-4000-8000-000000000031', 'admin', 'migration', 'active');
insert into partner_capabilities (partner_id, role, source, status) values
  ('88a10000-0000-4000-8000-000000000002', 'referrer', 'migration', 'active'),
  ('88a10000-0000-4000-8000-000000000003', 'referrer', 'migration', 'active');

insert into orders (id, account_id, holder_name, holder_email) values
  ('88a10000-0000-4000-8000-000000000041', '88a10000-0000-4000-8000-000000000032',
   'Holder Ledger List', 'holder-ledger-list@test.local');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  -- Ligne 051 : établissement 011, activité, 2029-03-10.
  ('88a10000-0000-4000-8000-000000000051', '88a10000-0000-4000-8000-000000000041',
   '88a10000-0000-4000-8000-000000000032', '88a10000-0000-4000-8000-000000000021',
   '2029-03-10', 1, 'fulfilled', 'Holder Ledger List',
   50000, 50000, 'external_referrer', 0.17, 0.10, 0.07, 8500, 5000, 3500),
  -- Ligne 052 : établissement 012, transport, 2029-04-15.
  ('88a10000-0000-4000-8000-000000000052', '88a10000-0000-4000-8000-000000000041',
   '88a10000-0000-4000-8000-000000000032', '88a10000-0000-4000-8000-000000000022',
   '2029-04-15', 1, 'reserved', 'Holder Ledger List',
   50000, 50000, 'external_referrer', 0.17, 0.10, 0.07, 8500, 5000, 3500);

insert into ledger_entries (id, order_line_id, beneficiary_type, referrer_partner_id, establishment_id,
                            entry_type, amount_cop, status, paid_at) values
  ('88a10000-0000-4000-8000-000000000061', '88a10000-0000-4000-8000-000000000051',
   'referrer', '88a10000-0000-4000-8000-000000000002', null, 'referral_earned', 3000, 'due', null),
  ('88a10000-0000-4000-8000-000000000062', '88a10000-0000-4000-8000-000000000051',
   'referrer', '88a10000-0000-4000-8000-000000000002', null, 'referral_earned', 2000, 'paid',
   now() - interval '1 day'),
  ('88a10000-0000-4000-8000-000000000063', '88a10000-0000-4000-8000-000000000051',
   'establishment', null, '88a10000-0000-4000-8000-000000000011', 'establishment_compensation', 4000,
   'due', null),
  ('88a10000-0000-4000-8000-000000000064', '88a10000-0000-4000-8000-000000000052',
   'referrer', '88a10000-0000-4000-8000-000000000003', null, 'referral_earned', 5000, 'estimated', null);

set local role authenticated;

-- ── Garde ───────────────────────────────────────────────────────────────────────────────────────
select test_login('88a10000-0000-4000-8000-000000000032');
select throws_ok(
  $$ select * from admin_ledger_entries_list() $$,
  '42501',
  null,
  'un compte non admin est refusé (42501), jamais servi'
);

select test_login('88a10000-0000-4000-8000-000000000031');

-- ── Filtre référent ─────────────────────────────────────────────────────────────────────────────
select is(
  (select array_agg(id order by id) from admin_ledger_entries_list(
     p_referrer_partner_id => '88a10000-0000-4000-8000-000000000002', p_limit => 100)),
  array['88a10000-0000-4000-8000-000000000061', '88a10000-0000-4000-8000-000000000062']::uuid[],
  'filtre référent : exactement les deux entrées du référent A'
);
select is(
  (select array_agg(total_count) from admin_ledger_entries_list(
     p_referrer_partner_id => '88a10000-0000-4000-8000-000000000002', p_limit => 1)),
  array[2]::bigint[],
  'pagination : une seule ligne rendue, total_count compte les deux (count(*) over())'
);

-- ── Filtres établissement / type / date / statut ────────────────────────────────────────────────
select is(
  (select array_agg(id order by id) from admin_ledger_entries_list(
     p_establishment_id => '88a10000-0000-4000-8000-000000000011', p_limit => 100)),
  array['88a10000-0000-4000-8000-000000000061', '88a10000-0000-4000-8000-000000000062',
        '88a10000-0000-4000-8000-000000000063']::uuid[],
  'filtre établissement : les trois entrées de la ligne de l''établissement 011, entrée '
  'établissement comprise (l''admin voit tout le ledger)'
);
select is(
  (select array_agg(id order by id) from admin_ledger_entries_list(
     p_establishment_id => '88a10000-0000-4000-8000-000000000012', p_limit => 100)),
  array['88a10000-0000-4000-8000-000000000064']::uuid[],
  'filtre établissement : seule l''entrée de l''établissement 012'
);
select is(
  (select count(*)::int from admin_ledger_entries_list(
     p_establishment_id => '88a10000-0000-4000-8000-000000000011', p_type => 'transport', p_limit => 100)),
  0,
  'filtre type combiné à l''établissement : aucun transport dans l''établissement 011'
);
select is(
  (select count(*)::int from admin_ledger_entries_list(
     p_establishment_id => '88a10000-0000-4000-8000-000000000012', p_type => 'transport', p_limit => 100)),
  1,
  'filtre type : le transport de l''établissement 012'
);
select is(
  (select count(*)::int from admin_ledger_entries_list(
     p_establishment_id => '88a10000-0000-4000-8000-000000000011',
     p_date_from => '2029-03-11', p_limit => 100)),
  0,
  'filtre date : porte sur la date de la ligne de commande (2029-03-10), pas sur created_at'
);
select is(
  (select array_agg(id order by id) from admin_ledger_entries_list(
     p_establishment_id => '88a10000-0000-4000-8000-000000000011', p_status => 'due', p_limit => 100)),
  array['88a10000-0000-4000-8000-000000000061', '88a10000-0000-4000-8000-000000000063']::uuid[],
  'filtre statut : les deux entrées « due » de l''établissement 011'
);

-- ── Colonnes rendues ────────────────────────────────────────────────────────────────────────────
select is(
  (select row(amount_cop, status, date, product_type, establishment_name ->> 'es', referrer_display_name)::text
     from admin_ledger_entries_list(
       p_referrer_partner_id => '88a10000-0000-4000-8000-000000000002', p_status => 'due', p_limit => 100)),
  row(3000::bigint, 'due'::text, '2029-03-10'::date, 'activity'::text,
      'Establecimiento Ledger List'::text, 'Ledger List Referrer A'::text)::text,
  'une entrée référent porte montant, statut, date de la ligne, type, établissement et référent'
);
select is(
  (select referrer_display_name from admin_ledger_entries_list(
     p_establishment_id => '88a10000-0000-4000-8000-000000000011', p_status => 'due', p_limit => 100)
    where id = '88a10000-0000-4000-8000-000000000063'),
  null,
  'une entrée établissement n''a pas de référent (left join), elle reste listée'
);

-- ── Tri ─────────────────────────────────────────────────────────────────────────────────────────
select is(
  (select id from admin_ledger_entries_list(
     p_establishment_id => '88a10000-0000-4000-8000-000000000011',
     p_sort_key => 'amount_cop', p_sort_desc => false, p_limit => 1)),
  '88a10000-0000-4000-8000-000000000062'::uuid,
  'tri par montant croissant : 2000 avant 3000 et 4000'
);
select is(
  (select id from admin_ledger_entries_list(
     p_establishment_id => '88a10000-0000-4000-8000-000000000011',
     p_sort_key => 'amount_cop', p_sort_desc => true, p_limit => 1)),
  '88a10000-0000-4000-8000-000000000063'::uuid,
  'tri par montant décroissant : 4000 en tête'
);

select * from finish();
rollback;

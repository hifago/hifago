-- modify_order_line et le ledger (migration 20261112190000) — la commission suit la ligne modifiée.
-- Avant : l'entrée 'referral_earned' restait 'estimated' sur la ligne 'superseded', la nouvelle
-- ligne n'en avait aucune, et la commission ne devenait jamais « A pagar » (constaté le 2026-11-12
-- par exécution, auto-référence 8 % puis 17 %). Ce fichier rougit contre l'ancienne fonction :
-- les cas A1/A2 y trouvent 1 entrée sur l'ancienne ligne et 0 sur la nouvelle.
--
-- Cas : A auto-référence 8/9 (qty 1 → 2), puis réalisée → « due » au nouveau montant ;
-- B auto-référence avec l'option 17 % ; C référent externe ; D ligne directe (aucune entrée créée).
begin;
select plan(9);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('88c30000-0000-4000-8000-000000000001', 'Ledger Follow Owner'),
  ('88c30000-0000-4000-8000-000000000002', 'Ledger Follow External Referrer');
insert into establishments (id, partner_id, name) values
  ('88c30000-0000-4000-8000-000000000011', '88c30000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Ledger Follow'));
insert into auth.users (id, email) values
  ('88c30000-0000-4000-8000-000000000031', 'ledger-follow-admin@test.local'),
  ('88c30000-0000-4000-8000-000000000032', 'ledger-follow-buyer@test.local');
insert into partner_capabilities (account_id, role, source, status)
values ('88c30000-0000-4000-8000-000000000031', 'admin', 'migration', 'active');
-- max_qty NULL : interdit de le fixer pour une activité à cupo (20261025120000).
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, min_qty, max_qty)
values ('88c30000-0000-4000-8000-000000000021', '88c30000-0000-4000-8000-000000000001',
  '88c30000-0000-4000-8000-000000000011', 'activity', jsonb_build_object('es', 'Actividad Ledger Follow'),
  100000, true, 'ledger-follow-activity', 1, null);
insert into product_availability (product_id, date, capacity, booked) values
  ('88c30000-0000-4000-8000-000000000021', '2028-11-01', 20, 4);

insert into orders (id, account_id, holder_name, holder_email, referrer_partner_id) values
  ('88c30000-0000-4000-8000-000000000041', '88c30000-0000-4000-8000-000000000032',
   'Holder Ledger Follow', 'holder-ledger-follow@test.local', '88c30000-0000-4000-8000-000000000001');

-- Les quatre lignes telles que create_order les pose (pourcentages figés) avec leur entrée.
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name, referrer_partner_id,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  ('88c30000-0000-4000-8000-000000000051', '88c30000-0000-4000-8000-000000000041',
   '88c30000-0000-4000-8000-000000000032', '88c30000-0000-4000-8000-000000000021', '2028-11-01', 1,
   'reserved', 'Holder Ledger Follow', '88c30000-0000-4000-8000-000000000001',
   100000, 100000, 'self_referral', 0.17, 0.08, 0.09, 17000, 8000, 9000),
  ('88c30000-0000-4000-8000-000000000052', '88c30000-0000-4000-8000-000000000041',
   '88c30000-0000-4000-8000-000000000032', '88c30000-0000-4000-8000-000000000021', '2028-11-01', 1,
   'reserved', 'Holder Ledger Follow', '88c30000-0000-4000-8000-000000000001',
   100000, 100000, 'self_referral', 0.17, 0.17, 0, 17000, 17000, 0),
  ('88c30000-0000-4000-8000-000000000053', '88c30000-0000-4000-8000-000000000041',
   '88c30000-0000-4000-8000-000000000032', '88c30000-0000-4000-8000-000000000021', '2028-11-01', 1,
   'reserved', 'Holder Ledger Follow', '88c30000-0000-4000-8000-000000000002',
   100000, 100000, 'external_referrer', 0.17, 0.08, 0.09, 17000, 8000, 9000),
  ('88c30000-0000-4000-8000-000000000054', '88c30000-0000-4000-8000-000000000041',
   '88c30000-0000-4000-8000-000000000032', '88c30000-0000-4000-8000-000000000021', '2028-11-01', 1,
   'reserved', 'Holder Ledger Follow', null,
   100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000);
insert into ledger_entries (id, order_line_id, beneficiary_type, referrer_partner_id, entry_type, amount_cop, status)
values
  ('88c30000-0000-4000-8000-000000000061', '88c30000-0000-4000-8000-000000000051', 'referrer',
   '88c30000-0000-4000-8000-000000000001', 'referral_earned', 8000, 'estimated'),
  ('88c30000-0000-4000-8000-000000000062', '88c30000-0000-4000-8000-000000000052', 'referrer',
   '88c30000-0000-4000-8000-000000000001', 'referral_earned', 17000, 'estimated'),
  ('88c30000-0000-4000-8000-000000000063', '88c30000-0000-4000-8000-000000000053', 'referrer',
   '88c30000-0000-4000-8000-000000000002', 'referral_earned', 8000, 'estimated');

set local role authenticated;
select test_login('88c30000-0000-4000-8000-000000000031');
create temp table tmp_new_lines as
  select 'A' as k, (modify_order_line('88c30000-0000-4000-8000-000000000051', '2028-11-01', 2, 'Dos personas')->>'order_line_id')::uuid as line_id
  union all
  select 'B', (modify_order_line('88c30000-0000-4000-8000-000000000052', '2028-11-01', 2, 'Dos personas')->>'order_line_id')::uuid
  union all
  select 'C', (modify_order_line('88c30000-0000-4000-8000-000000000053', '2028-11-01', 2, 'Dos personas')->>'order_line_id')::uuid
  union all
  select 'D', (modify_order_line('88c30000-0000-4000-8000-000000000054', '2028-11-01', 2, 'Dos personas')->>'order_line_id')::uuid;
reset role;

-- ── A : auto-référence 8 % ──────────────────────────────────────────────────────────────────────
select is(
  (select count(*)::int from ledger_entries where order_line_id = '88c30000-0000-4000-8000-000000000051'),
  0,
  'A1 : plus aucune entrée sur l''ancienne ligne (superseded)'
);
select is(
  (select row(id, amount_cop, status, referrer_partner_id)::text from ledger_entries
    where order_line_id = (select line_id from tmp_new_lines where k = 'A')),
  row('88c30000-0000-4000-8000-000000000061'::uuid, 16000::bigint, 'estimated'::text,
      '88c30000-0000-4000-8000-000000000001'::uuid)::text,
  'A2 : la MÊME entrée suit la nouvelle ligne, au montant recalculé (8 % de 200 000)'
);

set local role authenticated;
select test_login('88c30000-0000-4000-8000-000000000031');
select set_order_line_status((select line_id from tmp_new_lines where k = 'A'), 'fulfilled', 'Realizada');
reset role;
select is(
  (select status from ledger_entries where id = '88c30000-0000-4000-8000-000000000061'),
  'due',
  'A3 : la nouvelle ligne réalisée rend la commission « A pagar » (avant : jamais)'
);

-- ── B : auto-référence, option 17 % ─────────────────────────────────────────────────────────────
select is(
  (select row(amount_cop, status)::text from ledger_entries
    where order_line_id = (select line_id from tmp_new_lines where k = 'B')),
  row(34000::bigint, 'estimated'::text)::text,
  'B : option 17 % — l''acompte entier de la nouvelle ligne (34 000) reste dû au prestataire'
);
select is(
  (select count(*)::int from ledger_entries where order_line_id = '88c30000-0000-4000-8000-000000000052'),
  0,
  'B : rien ne reste sur l''ancienne ligne'
);

-- ── C : référent externe ────────────────────────────────────────────────────────────────────────
select is(
  (select row(amount_cop, status, referrer_partner_id)::text from ledger_entries
    where order_line_id = (select line_id from tmp_new_lines where k = 'C')),
  row(16000::bigint, 'estimated'::text, '88c30000-0000-4000-8000-000000000002'::uuid)::text,
  'C : la commission du référent externe suit de même'
);

-- ── D : ligne directe ───────────────────────────────────────────────────────────────────────────
select is(
  (select count(*)::int from ledger_entries
    where order_line_id in ('88c30000-0000-4000-8000-000000000054',
                            (select line_id from tmp_new_lines where k = 'D'))),
  0,
  'D : une ligne directe n''a pas de commission — aucune entrée créée par la modification'
);

-- ── Ensemble ────────────────────────────────────────────────────────────────────────────────────
select is(
  (select count(*)::int from ledger_entries le join order_lines ol on ol.id = le.order_line_id
    where ol.order_id = '88c30000-0000-4000-8000-000000000041'),
  3,
  'trois entrées en tout, ni perdues ni dupliquées'
);
select is(
  (select count(*)::int from ledger_entries le join order_lines ol on ol.id = le.order_line_id
    where ol.order_id = '88c30000-0000-4000-8000-000000000041' and ol.status = 'superseded'),
  0,
  'aucune entrée ne reste accrochée à une ligne superseded'
);

select * from finish();
rollback;

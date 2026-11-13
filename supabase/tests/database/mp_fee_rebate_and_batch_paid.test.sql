-- Migration 20261112200000 — frais Mercado Pago déduits de l'option 17 %, « Pagar todo », état de
-- commission lu dans le vrai ledger (Jérôme, 2026-11-12).
--
-- A : à l'approbation, la part des frais (raw_event.mp_fee_cop) passe de la part prestataire à la
--     part app sur les seules lignes 17/17/0, au prorata de l'acompte ; l'entrée de commission et
--     l'e-mail suivent ; rejouer l'approved ne déduit pas deux fois ; sans frais lisibles, rien.
-- B : la modification d'une ligne garde la déduction ; l'annulation client payée compense au net.
-- C : mark_partner_ledger_entries_paid — tout ou rien, garde admin, total et bénéficiaire vérifiés.
-- D : admin_order_line_ledger rend les entrées réelles (Pagada, compensation, frais).
-- Ce fichier rougit contre l'ancienne apply_payment_webhook (A1-A5 : aucune déduction).
begin;
select plan(26);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('a7f30000-0000-4000-8000-000000000001', 'Fee Rebate Owner'),
  ('a7f30000-0000-4000-8000-000000000002', 'Fee Rebate External');
insert into establishments (id, partner_id, name) values
  ('a7f30000-0000-4000-8000-000000000011', 'a7f30000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Fee Rebate'));
insert into auth.users (id, email) values
  ('a7f30000-0000-4000-8000-000000000031', 'fee-rebate-admin@test.local'),
  ('a7f30000-0000-4000-8000-000000000032', 'fee-rebate-buyer@test.local'),
  ('a7f30000-0000-4000-8000-000000000033', 'fee-rebate-owner@test.local'),
  ('a7f30000-0000-4000-8000-000000000034', 'fee-rebate-external@test.local');
insert into partner_capabilities (account_id, role, source, status)
values ('a7f30000-0000-4000-8000-000000000031', 'admin', 'migration', 'active');
insert into partner_capabilities (partner_id, role, source, status) values
  ('a7f30000-0000-4000-8000-000000000001', 'referrer', 'migration', 'active'),
  ('a7f30000-0000-4000-8000-000000000002', 'referrer', 'migration', 'active');
update partner_accounts set partner_id = 'a7f30000-0000-4000-8000-000000000001'
 where id = 'a7f30000-0000-4000-8000-000000000033';
update partner_accounts set partner_id = 'a7f30000-0000-4000-8000-000000000002'
 where id = 'a7f30000-0000-4000-8000-000000000034';
insert into partner_payout_accounts (partner_id, mercadopago_account)
values ('a7f30000-0000-4000-8000-000000000001', 'owner@mp.test');

insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, min_qty, max_qty)
values ('a7f30000-0000-4000-8000-000000000021', 'a7f30000-0000-4000-8000-000000000001',
  'a7f30000-0000-4000-8000-000000000011', 'activity', jsonb_build_object('es', 'Actividad Fee Rebate'),
  100000, true, 'fee-rebate-activity', 1, null);
insert into product_availability (product_id, date, capacity, booked) values
  ('a7f30000-0000-4000-8000-000000000021', '2028-12-01', 30, 7);

-- Commande 1, référent = le propriétaire : L1 et L4 en option 17 % (17/17/0), L2 en 17/8/9, L3
-- directe, L5 recommandée par un autre aliado.
insert into orders (id, account_id, holder_name, holder_email, referrer_partner_id) values
  ('a7f30000-0000-4000-8000-000000000041', 'a7f30000-0000-4000-8000-000000000032',
   'Holder Fee Rebate', 'holder-fee-rebate@test.local', 'a7f30000-0000-4000-8000-000000000001'),
  ('a7f30000-0000-4000-8000-000000000042', 'a7f30000-0000-4000-8000-000000000032',
   'Holder Fee Rebate', 'holder-fee-rebate@test.local', 'a7f30000-0000-4000-8000-000000000001');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name, referrer_partner_id,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  ('a7f30000-0000-4000-8000-000000000051', 'a7f30000-0000-4000-8000-000000000041',
   'a7f30000-0000-4000-8000-000000000032', 'a7f30000-0000-4000-8000-000000000021', '2028-12-01', 1,
   'reserved', 'Holder Fee Rebate', 'a7f30000-0000-4000-8000-000000000001',
   100000, 100000, 'self_referral', 0.17, 0.17, 0, 17000, 17000, 0),
  ('a7f30000-0000-4000-8000-000000000052', 'a7f30000-0000-4000-8000-000000000041',
   'a7f30000-0000-4000-8000-000000000032', 'a7f30000-0000-4000-8000-000000000021', '2028-12-01', 1,
   'reserved', 'Holder Fee Rebate', 'a7f30000-0000-4000-8000-000000000001',
   100000, 100000, 'self_referral', 0.17, 0.08, 0.09, 17000, 8000, 9000),
  ('a7f30000-0000-4000-8000-000000000053', 'a7f30000-0000-4000-8000-000000000041',
   'a7f30000-0000-4000-8000-000000000032', 'a7f30000-0000-4000-8000-000000000021', '2028-12-01', 1,
   'reserved', 'Holder Fee Rebate', null,
   100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000),
  ('a7f30000-0000-4000-8000-000000000054', 'a7f30000-0000-4000-8000-000000000041',
   'a7f30000-0000-4000-8000-000000000032', 'a7f30000-0000-4000-8000-000000000021', '2028-12-01', 2,
   'reserved', 'Holder Fee Rebate', 'a7f30000-0000-4000-8000-000000000001',
   100000, 200000, 'self_referral', 0.17, 0.17, 0, 34000, 34000, 0),
  ('a7f30000-0000-4000-8000-000000000055', 'a7f30000-0000-4000-8000-000000000041',
   'a7f30000-0000-4000-8000-000000000032', 'a7f30000-0000-4000-8000-000000000021', '2028-12-01', 1,
   'reserved', 'Holder Fee Rebate', 'a7f30000-0000-4000-8000-000000000002',
   100000, 100000, 'external_referrer', 0.17, 0.08, 0.09, 17000, 8000, 9000),
  ('a7f30000-0000-4000-8000-000000000056', 'a7f30000-0000-4000-8000-000000000042',
   'a7f30000-0000-4000-8000-000000000032', 'a7f30000-0000-4000-8000-000000000021', '2028-12-01', 1,
   'reserved', 'Holder Fee Rebate', 'a7f30000-0000-4000-8000-000000000001',
   100000, 100000, 'self_referral', 0.17, 0.17, 0, 17000, 17000, 0);
insert into ledger_entries (id, order_line_id, beneficiary_type, referrer_partner_id, entry_type, amount_cop, status)
values
  ('a7f30000-0000-4000-8000-000000000061', 'a7f30000-0000-4000-8000-000000000051', 'referrer',
   'a7f30000-0000-4000-8000-000000000001', 'referral_earned', 17000, 'estimated'),
  ('a7f30000-0000-4000-8000-000000000062', 'a7f30000-0000-4000-8000-000000000052', 'referrer',
   'a7f30000-0000-4000-8000-000000000001', 'referral_earned', 8000, 'estimated'),
  ('a7f30000-0000-4000-8000-000000000064', 'a7f30000-0000-4000-8000-000000000054', 'referrer',
   'a7f30000-0000-4000-8000-000000000001', 'referral_earned', 34000, 'estimated'),
  ('a7f30000-0000-4000-8000-000000000065', 'a7f30000-0000-4000-8000-000000000055', 'referrer',
   'a7f30000-0000-4000-8000-000000000002', 'referral_earned', 8000, 'estimated'),
  ('a7f30000-0000-4000-8000-000000000066', 'a7f30000-0000-4000-8000-000000000056', 'referrer',
   'a7f30000-0000-4000-8000-000000000001', 'referral_earned', 17000, 'estimated');
-- Paiement 1 : 17 000 × 4 + 34 000 = 102 000 ; frais Mercado Pago 5 100 (5 %).
insert into payments (id, order_id, status, amount_cop) values
  ('a7f30000-0000-4000-8000-000000000071', 'a7f30000-0000-4000-8000-000000000041', 'pending', 102000),
  ('a7f30000-0000-4000-8000-000000000072', 'a7f30000-0000-4000-8000-000000000042', 'pending', 17000);

-- ── A : déduction à l'approbation ───────────────────────────────────────────────────────────────
set local role service_role;
select is(
  (select apply_payment_webhook('mp-fee-1', 'a7f30000-0000-4000-8000-000000000071'::uuid, 'approved',
     jsonb_build_object('mp_payment_id', 'mp-fee-1', 'status', 'approved', 'mp_fee_cop', 5100)) ->> 'ok'),
  'true',
  'A0 : le paiement est appliqué'
);
reset role;

select is(
  (select row(referrer_commission_cop, app_commission_cop, mp_fee_cop)::text from order_lines
    where id = 'a7f30000-0000-4000-8000-000000000051'),
  row(16150::bigint, 850::bigint, 850::bigint)::text,
  'A1 : ligne 17 % de 17 000 d''acompte — 5 100 × 17 000 / 102 000 = 850 passent du prestataire à Hifago'
);
select is(
  (select row(referrer_commission_cop, app_commission_cop, mp_fee_cop)::text from order_lines
    where id = 'a7f30000-0000-4000-8000-000000000054'),
  row(32300::bigint, 1700::bigint, 1700::bigint)::text,
  'A2 : ligne 17 % de 34 000 d''acompte — sa part des frais est 1 700'
);
select is(
  (select array_agg(row(id, referrer_commission_cop, app_commission_cop, mp_fee_cop)::text order by id) from order_lines
    where id in ('a7f30000-0000-4000-8000-000000000052', 'a7f30000-0000-4000-8000-000000000053',
                 'a7f30000-0000-4000-8000-000000000055')),
  array[
    row('a7f30000-0000-4000-8000-000000000052'::uuid, 8000::bigint, 9000::bigint, null::bigint)::text,
    row('a7f30000-0000-4000-8000-000000000053'::uuid, 0::bigint, 17000::bigint, null::bigint)::text,
    row('a7f30000-0000-4000-8000-000000000055'::uuid, 8000::bigint, 9000::bigint, null::bigint)::text
  ],
  'A3 : 8/9, directe et recommandation externe intactes — les frais y restent absorbés par Hifago'
);
select is(
  (select array_agg(row(id, amount_cop, status)::text order by id) from ledger_entries
    where id in ('a7f30000-0000-4000-8000-000000000061', 'a7f30000-0000-4000-8000-000000000062',
                 'a7f30000-0000-4000-8000-000000000064', 'a7f30000-0000-4000-8000-000000000065')),
  array[
    row('a7f30000-0000-4000-8000-000000000061'::uuid, 16150::bigint, 'estimated'::text)::text,
    row('a7f30000-0000-4000-8000-000000000062'::uuid, 8000::bigint, 'estimated'::text)::text,
    row('a7f30000-0000-4000-8000-000000000064'::uuid, 32300::bigint, 'estimated'::text)::text,
    row('a7f30000-0000-4000-8000-000000000065'::uuid, 8000::bigint, 'estimated'::text)::text
  ],
  'A4 : les entrées de commission des lignes 17 % passent au montant net'
);
select ok(
  (select bool_and(body_html like '%17 \% de%' and body_html like '%comisión Mercado Pago $850 COP%'
                   and body_html like '%$16.150 COP%')
     from notification_emails
    where event_type = 'partner_commission_earned' and related_id = 'a7f30000-0000-4000-8000-000000000041'
      and recipient_email = 'fee-rebate-owner@test.local'),
  'A5 : l''e-mail « Nueva comisión asignada » annonce le net et dit les frais retenus'
);

set local role service_role;
select is(
  (select apply_payment_webhook('mp-fee-1', 'a7f30000-0000-4000-8000-000000000071'::uuid, 'approved',
     jsonb_build_object('mp_payment_id', 'mp-fee-1', 'status', 'approved', 'mp_fee_cop', 9999)) ->> 'reason'),
  'already_applied',
  'A6 : un approved rejoué est un no-op'
);
reset role;
select is(
  (select row(referrer_commission_cop, mp_fee_cop)::text from order_lines where id = 'a7f30000-0000-4000-8000-000000000051'),
  row(16150::bigint, 850::bigint)::text,
  'A7 : … et ne déduit pas une seconde fois'
);

set local role service_role;
select apply_payment_webhook('mp-fee-2', 'a7f30000-0000-4000-8000-000000000072'::uuid, 'approved',
  jsonb_build_object('mp_payment_id', 'mp-fee-2', 'status', 'approved', 'mp_fee_cop', null));
reset role;
select is(
  (select row(referrer_commission_cop, app_commission_cop, mp_fee_cop)::text from order_lines
    where id = 'a7f30000-0000-4000-8000-000000000056')
  || '/' || (select amount_cop::text from ledger_entries where id = 'a7f30000-0000-4000-8000-000000000066'),
  row(17000::bigint, 0::bigint, null::bigint)::text || '/17000',
  'A8 : frais illisibles (mock, réponse sans fee_details) — rien n''est déduit plutôt qu''un montant inventé'
);

-- ── B : modification et annulation ──────────────────────────────────────────────────────────────
set local role authenticated;
select test_login('a7f30000-0000-4000-8000-000000000031');
create temp table tmp_new_line as
  select (modify_order_line('a7f30000-0000-4000-8000-000000000051', '2028-12-01', 2, 'Dos personas')->>'order_line_id')::uuid as id;
reset role;
select is(
  (select row(ol.referrer_commission_cop, ol.app_commission_cop, ol.mp_fee_cop)::text from order_lines ol
    where ol.id = (select id from tmp_new_line)),
  row(33150::bigint, 850::bigint, 850::bigint)::text,
  'B1 : la ligne modifiée (acompte 34 000) garde les 850 de frais déjà retenus'
);
select is(
  (select row(order_line_id, amount_cop, status)::text from ledger_entries where id = 'a7f30000-0000-4000-8000-000000000061'),
  row((select id from tmp_new_line), 33150::bigint, 'estimated'::text)::text,
  'B2 : l''entrée suit la nouvelle ligne au montant net'
);

set local role authenticated;
select test_login('a7f30000-0000-4000-8000-000000000031');
select set_order_line_status('a7f30000-0000-4000-8000-000000000054', 'cancelled_by_client', 'El cliente canceló');
reset role;
select is(
  (select row(amount_cop, status, establishment_id)::text from ledger_entries
    where order_line_id = 'a7f30000-0000-4000-8000-000000000054' and entry_type = 'establishment_compensation'),
  row(32300::bigint, 'due'::text, 'a7f30000-0000-4000-8000-000000000011'::uuid)::text,
  'B3 : annulation client payée — la compensation reprend le net (32 300), jamais l''acompte brut'
);

-- ── C : « Pagar todo » ──────────────────────────────────────────────────────────────────────────
set local role authenticated;
select test_login('a7f30000-0000-4000-8000-000000000031');
select set_order_line_status((select id from tmp_new_line), 'fulfilled', 'Realizada');
select set_order_line_status('a7f30000-0000-4000-8000-000000000052', 'fulfilled', 'Realizada');
select set_order_line_status('a7f30000-0000-4000-8000-000000000055', 'fulfilled', 'Realizada');
create temp table tmp_payables as select * from admin_ledger_payables();
reset role;

select is(
  (select row(due_count, due_cop, mercadopago_account)::text from tmp_payables
    where beneficiary_partner_id = 'a7f30000-0000-4000-8000-000000000001'),
  row(3::bigint, 73450::bigint, 'owner@mp.test'::text)::text,
  'C1 : « Por pagar » — 33 150 + 8 000 + 32 300 dus au propriétaire, avec son compte Mercado Pago'
);

create temp table tmp_owner_due as
  select array_agg(le.id order by le.id) as ids from ledger_entries le
    join order_lines ol on ol.id = le.order_line_id
   where ol.order_id = 'a7f30000-0000-4000-8000-000000000041' and le.status = 'due'
     and coalesce(le.referrer_partner_id, (select partner_id from establishments where id = le.establishment_id))
         = 'a7f30000-0000-4000-8000-000000000001';
grant select on tmp_owner_due to authenticated;

set local role authenticated;
select test_login('a7f30000-0000-4000-8000-000000000033');
select throws_ok(
  $$select mark_partner_ledger_entries_paid('a7f30000-0000-4000-8000-000000000001',
      (select ids from tmp_owner_due), 73450, '', 'Transferencia')$$,
  '42501'::char(5), 'mark_partner_ledger_entries_paid réservé au rôle admin',
  'C2 : refusé au partenaire lui-même'
);
select test_login('a7f30000-0000-4000-8000-000000000031');
select throws_like(
  $$select mark_partner_ledger_entries_paid('a7f30000-0000-4000-8000-000000000001',
      (select ids from tmp_owner_due), 70000, '', 'Transferencia')$$,
  '%le total a changé%',
  'C3 : un total différent de celui en base est refusé'
);
select throws_like(
  $$select mark_partner_ledger_entries_paid('a7f30000-0000-4000-8000-000000000001',
      (select ids from tmp_owner_due) || 'a7f30000-0000-4000-8000-000000000065'::uuid, 81450, '', 'Transferencia')$$,
  '%n''est pas due à ce bénéficiaire%',
  'C4 : une entrée d''un autre bénéficiaire est refusée'
);
select throws_like(
  $$select mark_partner_ledger_entries_paid('a7f30000-0000-4000-8000-000000000001',
      (select ids from tmp_owner_due), 73450, '', '  ')$$,
  '%motif obligatoire%',
  'C5 : motif obligatoire'
);
reset role;
select is(
  (select count(*)::int from ledger_entries where id = any((select ids from tmp_owner_due)::uuid[]) and status = 'due'),
  3,
  'C6 : refus = rien n''est marqué (tout ou rien)'
);

set local role authenticated;
select test_login('a7f30000-0000-4000-8000-000000000031');
select is(
  (select mark_partner_ledger_entries_paid('a7f30000-0000-4000-8000-000000000001',
      (select ids from tmp_owner_due), 73450, 'mp://comprobante/1', 'Transferencia Mercado Pago')),
  jsonb_build_object('ok', true, 'count', 3, 'total_cop', 73450),
  'C7 : les trois entrées sont réglées d''un coup'
);
select throws_like(
  $$select mark_partner_ledger_entries_paid('a7f30000-0000-4000-8000-000000000001',
      (select ids from tmp_owner_due), 73450, '', 'Otra vez')$$,
  '%déjà été traitée%',
  'C8 : un second « Pagar todo » sur les mêmes entrées est refusé (jamais payé deux fois)'
);
reset role;

select is(
  (select count(*)::int from ledger_entries
    where id = any((select ids from tmp_owner_due)::uuid[]) and status = 'paid' and paid_at is not null
      and comprobante_path = 'mp://comprobante/1' and note = 'Transferencia Mercado Pago'),
  3,
  'C9 : payées, avec date, comprobante et motif'
);
select is(
  (select count(*)::int from audit_log
    where action = 'ledger_entry.mark_paid' and entity_id = any((select ids from tmp_owner_due)::uuid[])
      and (after ->> 'batch_total_cop')::bigint = 73450),
  3,
  'C10 : une ligne de journal admin par entrée'
);
select is(
  (select status from ledger_entries where id = 'a7f30000-0000-4000-8000-000000000065'),
  'due',
  'C11 : la commission de l''autre aliado reste « A pagar »'
);
select ok(
  not has_function_privilege('anon', 'public.mark_partner_ledger_entries_paid(uuid, uuid[], bigint, text, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.apply_mp_fee_to_full_rebate_lines(uuid)', 'EXECUTE'),
  'C12 : anon ne peut pas payer, personne n''appelle la déduction directement'
);

-- ── D : état de commission de la fiche commande ─────────────────────────────────────────────────
set local role authenticated;
select test_login('a7f30000-0000-4000-8000-000000000031');
create temp table tmp_order_ledger as select * from admin_order_line_ledger('a7f30000-0000-4000-8000-000000000041');
reset role;
select is(
  (select row(commission_entry_status, commission_entry_amount_cop, mp_fee_cop, compensation_entry_status)::text
     from tmp_order_ledger where id = (select id from tmp_new_line)),
  row('paid'::text, 33150::bigint, 850::bigint, null::text)::text,
  'D1 : la ligne réalisée et réglée se lit « paid », avec ses frais'
);
select is(
  (select row(commission_entry_status, compensation_entry_status, compensation_entry_amount_cop)::text
     from tmp_order_ledger where id = 'a7f30000-0000-4000-8000-000000000054'),
  row('void'::text, 'paid'::text, 32300::bigint)::text,
  'D2 : l''annulation client — commission annulée, compensation réglée'
);

select * from finish();
rollback;

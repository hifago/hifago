-- Annulation d'une prestation (migration 20261006192424) : une seule règle pour cancel_order_line
-- (le client) et set_order_line_status (admin, operator).
--
-- CE QUE CE FICHIER DOIT PROUVER :
--   - la place est rendue pour toute annulation (client ou établissement, commande payée ou non) et
--     pour `expired` : cupos, ressource partagée ET blocage d'agenda ; jamais pour no_show ;
--   - l'argent : commande payée annulée par le client → acompte acquis (ledger A3 : référent `void`,
--     compensation de l'établissement) ; impayée ou remboursée → ledger `expired` (aucune
--     compensation) ; le client qui retire une ligne d'une commande `pending` annule ses intents
--     (l'admin, non) ;
--   - l'établissement qui annule une commande payée : place rendue, AUCUN traitement de remboursement
--     (ni `refund_required`, ni entrée de réconciliation — décision du 2026-10-06) ;
--   - `expired` refusé sur une commande payée, sans rien écrire ;
--   - une confirmation au client et une information au prestataire par annulation, valeurs tierces
--     échappées, le FAIT seulement (jamais un remboursement promis) ; rien pour `expired` ;
--   - `cancellable` de list_my_orders = la règle de cancel_order_line ;
--   - droits (anon ne peut plus appeler set_order_line_status ; les fonctions internes fermées) et
--     ordre des verrous du remplacement de jeton Lobby (lignes avant file).
-- Fixtures en SQL direct (tables RPC-only) : ce fichier tourne en tant que postgres.
begin;
select plan(29);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email) values
  ('7c700000-0000-4000-8000-000000000031', 'p7-client@test.local'),
  ('7c700000-0000-4000-8000-000000000032', 'p7-partner@test.local'),
  ('7c700000-0000-4000-8000-000000000033', 'p7-admin@test.local');
insert into partner_capabilities (account_id, role, source, status) values
  ('7c700000-0000-4000-8000-000000000033', 'admin', 'migration', 'active');
insert into partners (id, display_name) values
  ('7c700000-0000-4000-8000-000000000001', 'P7 Partner'),
  ('7c700000-0000-4000-8000-000000000002', 'P7 Referrer');
insert into partner_accounts (id, partner_id) values
  ('7c700000-0000-4000-8000-000000000032', '7c700000-0000-4000-8000-000000000001')
on conflict (id) do update set partner_id = excluded.partner_id;
insert into establishments (id, partner_id, name, slug) values
  ('7c700000-0000-4000-8000-000000000011', '7c700000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento P7'), 'est-p7-cancel');
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('7c700000-0000-4000-8000-000000000021', '7c700000-0000-4000-8000-000000000001',
   '7c700000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Kayak <b>&</b>'), 50000, true, 'p7-cancel-kayak');

-- 10 lignes d'une place le 2029-03-01 ; la ligne « occupante » (57) tient 2 places le 2029-03-05,
-- et la ressource partagée de l'établissement les 2029-03-05 et 06 (blocage d'agenda).
insert into product_availability (product_id, date, capacity, booked) values
  ('7c700000-0000-4000-8000-000000000021', '2029-03-01', 12, 10),
  ('7c700000-0000-4000-8000-000000000021', '2029-03-05', 10, 2);
insert into provider_resource_calendar (establishment_id, slot_date, capacity, booked) values
  ('7c700000-0000-4000-8000-000000000011', '2029-03-05', 5, 2),
  ('7c700000-0000-4000-8000-000000000011', '2029-03-06', 5, 2);

insert into orders (id, account_id, holder_name, holder_email, payment_status, reference) values
  ('7c700000-0000-4000-8000-000000000041', '7c700000-0000-4000-8000-000000000031', 'Ana & <i>Co</i>', 'p7-41@test.local', 'unpaid', 'P7-41'),
  ('7c700000-0000-4000-8000-000000000042', '7c700000-0000-4000-8000-000000000031', 'P7', 'p7-42@test.local', 'paid', 'P7-42'),
  ('7c700000-0000-4000-8000-000000000043', '7c700000-0000-4000-8000-000000000031', 'P7', 'p7-43@test.local', 'pending', 'P7-43'),
  ('7c700000-0000-4000-8000-000000000044', '7c700000-0000-4000-8000-000000000031', 'P7', 'p7-44@test.local', 'refunded', 'P7-44'),
  ('7c700000-0000-4000-8000-000000000045', '7c700000-0000-4000-8000-000000000031', 'P7', 'p7-45@test.local', 'paid', 'P7-45'),
  ('7c700000-0000-4000-8000-000000000046', '7c700000-0000-4000-8000-000000000031', 'P7', 'p7-46@test.local', 'paid', 'P7-46'),
  ('7c700000-0000-4000-8000-000000000047', '7c700000-0000-4000-8000-000000000031', 'P7', 'p7-47@test.local', 'paid', 'P7-47'),
  ('7c700000-0000-4000-8000-000000000048', '7c700000-0000-4000-8000-000000000031', 'P7', 'p7-48@test.local', 'pending', 'P7-48');
insert into payments (id, order_id, status, amount_cop, mp_payment_id) values
  ('7c700000-0000-4000-8000-000000000072', '7c700000-0000-4000-8000-000000000042', 'approved', 8500, 'MP-P7-42'),
  ('7c700000-0000-4000-8000-000000000073', '7c700000-0000-4000-8000-000000000043', 'pending', 17000, null),
  ('7c700000-0000-4000-8000-000000000075', '7c700000-0000-4000-8000-000000000045', 'approved', 17000, 'MP-P7-45'),
  ('7c700000-0000-4000-8000-000000000076', '7c700000-0000-4000-8000-000000000046', 'approved', 17000, 'MP-P7-46'),
  ('7c700000-0000-4000-8000-000000000078', '7c700000-0000-4000-8000-000000000048', 'pending', 8500, null);

create function p7_line(p_id text, p_order text, p_date date, p_qty int, p_referrer boolean) returns void
language sql as $$
  insert into order_lines (
    id, order_id, account_id, product_id, date, qty, status, holder_name,
    price_cop, total_cop, commission_case, referrer_partner_id, acompte_pct, referrer_pct, app_pct,
    acompte_cop, referrer_commission_cop, app_commission_cop
  ) values (
    ('7c700000-0000-4000-8000-0000000000' || p_id)::uuid, ('7c700000-0000-4000-8000-0000000000' || p_order)::uuid,
    '7c700000-0000-4000-8000-000000000031', '7c700000-0000-4000-8000-000000000021', p_date, p_qty, 'reserved', 'P7',
    50000 * p_qty, 50000 * p_qty, case when p_referrer then 'external_referrer' else 'direct' end,
    case when p_referrer then '7c700000-0000-4000-8000-000000000002'::uuid end,
    0.17, case when p_referrer then 0.10 else 0 end, case when p_referrer then 0.07 else 0.17 end,
    8500 * p_qty, case when p_referrer then 5000 * p_qty else 0 end, case when p_referrer then 3500 * p_qty else 8500 * p_qty end
  );
$$;
select p7_line('51', '41', '2029-03-01', 1, true);
select p7_line('52', '41', '2029-03-01', 1, false);
select p7_line('53', '42', '2029-03-01', 1, true);
select p7_line('54', '43', '2029-03-01', 1, false);
select p7_line('55', '43', '2029-03-01', 1, false);
select p7_line('56', '44', '2029-03-01', 1, true);
select p7_line('57', '45', '2029-03-05', 2, false);
select p7_line('58', '46', '2029-03-01', 1, false);
select p7_line('59', '46', '2029-03-01', 1, false);
select p7_line('60', '47', '2029-03-01', 1, false);
select p7_line('61', '48', '2029-03-01', 1, false);
insert into availability_blocks (establishment_id, start_date, end_date, source_order_line_id) values
  ('7c700000-0000-4000-8000-000000000011', '2029-03-05', '2029-03-06', '7c700000-0000-4000-8000-000000000057');
insert into ledger_entries (order_line_id, beneficiary_type, referrer_partner_id, entry_type, amount_cop, status)
select ('7c700000-0000-4000-8000-0000000000' || n)::uuid, 'referrer', '7c700000-0000-4000-8000-000000000002', 'referral_earned', 5000, 'estimated'
  from unnest(array['51', '53', '56']) n;

create temp view p7_booked as
  select (select booked from product_availability where product_id = '7c700000-0000-4000-8000-000000000021' and date = '2029-03-01') as d1;
create temp view p7_emails as
  select event_type, recipient_email, related_id, body_html from notification_emails
   where related_table = 'order_lines' and related_id::text like '7c700000-%';
create temp view p7_ledger as
  select order_line_id, entry_type, status, amount_cop from ledger_entries where order_line_id::text like '7c700000-%';

-- ── Le client retire une ligne d'une commande IMPAYÉE ────────────────────
set local role authenticated;
select test_login('7c700000-0000-4000-8000-000000000031');
select is((public.cancel_order_line('7c700000-0000-4000-8000-000000000051') ->> 'remaining_active_lines')::int, 1,
  'C1 : le client retire une ligne d''une commande impayée (geste conservé) — une ligne reste');
create temp table c1_list as select public.list_my_orders() as r;
reset role;
select is((select d1 from p7_booked), 9, 'C2 : la place est rendue (10 → 9)');
select is(
  (select array_agg(entry_type || ':' || status order by entry_type) from p7_ledger where order_line_id = '7c700000-0000-4000-8000-000000000051'),
  array['referral_earned:void'],
  'C3 : rien n''a été encaissé : part référent annulée, AUCUNE compensation de l''établissement');
select is(
  (select jsonb_object_agg(l ->> 'id', (l ->> 'cancellable')::boolean)
     from c1_list, jsonb_array_elements(r -> 'orders') o, jsonb_array_elements(o -> 'lines') l
    where o ->> 'id' = '7c700000-0000-4000-8000-000000000041'),
  jsonb_build_object('7c700000-0000-4000-8000-000000000051', false, '7c700000-0000-4000-8000-000000000052', true),
  'C4 : list_my_orders rend `cancellable` par ligne — la règle de cancel_order_line');
select is(
  (select count(*)::int from p7_emails
    where related_id = '7c700000-0000-4000-8000-000000000051' and event_type = 'client_order_line_cancelled'
      and recipient_email = 'p7-41@test.local'
      and strpos(body_html, 'Anulaste «Kayak &lt;b&gt;&amp;&lt;/b&gt;» del 01/03/2029') > 0
      and strpos(body_html, 'Hola Ana &amp; &lt;i&gt;Co&lt;/i&gt;,') > 0
      and strpos(body_html, 'No se cobró nada por esta prestación.') > 0
      and strpos(body_html, 'Kayak <b>') = 0 and strpos(body_html, '<i>Co') = 0),
  1, 'C5 : une confirmation au client, valeurs tierces échappées, « rien n''a été cobré »');
select is(
  (select count(*)::int from p7_emails
    where related_id = '7c700000-0000-4000-8000-000000000051' and event_type = 'partner_order_line_cancelled'
      and recipient_email = 'p7-partner@test.local'
      and strpos(body_html, 'Anulada por el cliente.') > 0 and strpos(body_html, 'La disponibilidad quedó liberada.') > 0),
  1, 'C6 : une information au prestataire, par compte du partenaire');

-- ── Commande PAYÉE annulée par le client : place rendue, acompte acquis (A3) ─
set local role authenticated;
select test_login('7c700000-0000-4000-8000-000000000031');
select public.cancel_order_line('7c700000-0000-4000-8000-000000000053');
reset role;
select is((select d1 from p7_booked), 8, 'C7 : commande payée : la place est rendue aussi (G1-bis)');
select is(
  (select array_agg(entry_type || ':' || status || ':' || amount_cop order by entry_type) from p7_ledger where order_line_id = '7c700000-0000-4000-8000-000000000053'),
  array['establishment_compensation:due:5000', 'referral_earned:void:5000'],
  'C8 : A3 : part référent annulée, redirigée vers l''établissement (compensation due)');
select is(
  (select o.payment_status || ':' || p.status from orders o join payments p on p.order_id = o.id where o.id = '7c700000-0000-4000-8000-000000000042'),
  'paid:approved', 'C9 : l''acompte reste acquis : commande et paiement inchangés');
select is(
  (select count(*)::int from p7_emails where related_id = '7c700000-0000-4000-8000-000000000053' and event_type = 'client_order_line_cancelled'
      and strpos(body_html, 'Anulaste «') > 0 and body_html !~* 'reembols|anticipo|cobr'),
  1, 'C10 : la confirmation dit le fait, sans parler d''argent');

-- ── Commande `pending` : l'intent en cours est annulé ────────────────────
set local role authenticated;
select test_login('7c700000-0000-4000-8000-000000000031');
select public.cancel_order_line('7c700000-0000-4000-8000-000000000054');
reset role;
select is(
  (select o.payment_status || ':' || p.status from orders o join payments p on p.order_id = o.id where o.id = '7c700000-0000-4000-8000-000000000043'),
  'unpaid:cancelled', 'C11 : l''intent de l''ancien montant est annulé, la commande repasse impayée');
select is(
  (select count(*)::int from p7_emails where related_id = '7c700000-0000-4000-8000-000000000054' and event_type = 'client_order_line_cancelled'
      and strpos(body_html, 'No se cobró nada por esta prestación. Tu pago en curso quedó anulado.') > 0
      and body_html !~* 'reembols'),
  1, 'C12 : la confirmation dit que le paiement en cours est annulé, sans promettre de remboursement');

-- ── Commande remboursée ──────────────────────────────────────────────────
set local role authenticated;
select test_login('7c700000-0000-4000-8000-000000000031');
select public.cancel_order_line('7c700000-0000-4000-8000-000000000056');
reset role;
select is(
  jsonb_build_object('booked', (select d1 from p7_booked),
    'ledger', (select array_agg(entry_type || ':' || status order by entry_type) from p7_ledger where order_line_id = '7c700000-0000-4000-8000-000000000056')),
  jsonb_build_object('booked', 6, 'ledger', array['referral_earned:void']),
  'C13 : commande remboursée : place rendue, aucune compensation (l''argent est déjà rendu)');

-- ── L'établissement annule la dernière ligne d'une commande payée ────────
select test_login('7c700000-0000-4000-8000-000000000033');
select set_order_line_status('7c700000-0000-4000-8000-000000000057', 'cancelled_by_provider', 'lluvia');
select is(
  jsonb_build_object(
    'cupos', (select booked from product_availability where product_id = '7c700000-0000-4000-8000-000000000021' and date = '2029-03-05'),
    'ressource', (select array_agg(booked order by slot_date) from provider_resource_calendar where establishment_id = '7c700000-0000-4000-8000-000000000011'),
    'blocs', (select count(*)::int from availability_blocks where source_order_line_id = '7c700000-0000-4000-8000-000000000057')),
  jsonb_build_object('cupos', 0, 'ressource', array[0, 0], 'blocs', 0),
  'C14 : cupos, ressource partagée (deux jours) et blocage d''agenda rendus');
select is(
  jsonb_build_object(
    'remboursement', (select count(*)::int from payment_reconciliation_entries where mp_payment_id = 'MP-P7-45'),
    'a_decider', (select count(*)::int from pms_reconciliation_entries where order_line_id = '7c700000-0000-4000-8000-000000000057'),
    'paiement', (select o.payment_status || ':' || p.status from orders o join payments p on p.order_id = o.id where o.id = '7c700000-0000-4000-8000-000000000045')),
  jsonb_build_object('remboursement', 0, 'a_decider', 0, 'paiement', 'paid:approved'),
  'C15 : commande payée annulée par l''établissement : aucun traitement de remboursement (décision du 2026-10-06), paiement inchangé');
select is(
  (select count(*)::int from p7_emails where related_id = '7c700000-0000-4000-8000-000000000057'
      and ((event_type = 'client_order_line_cancelled' and strpos(body_html, 'El establecimiento anuló «') > 0
            and body_html !~* 'reembols|anticipo|contactaremos')
        or (event_type = 'partner_order_line_cancelled' and strpos(body_html, 'Anulada por el establecimiento.') > 0))),
  2, 'C16 : le client apprend le fait, sans promesse de remboursement ; le prestataire est informé');

-- ── … une ligne sur deux : même chose ───────────────────────────────────
select set_order_line_status('7c700000-0000-4000-8000-000000000058', 'cancelled_by_provider', 'cupo agotado');
select is(
  jsonb_build_object(
    'refund', (select count(*)::int from payment_reconciliation_entries where mp_payment_id = 'MP-P7-46'),
    'a_decider', (select count(*)::int from pms_reconciliation_entries where order_line_id = '7c700000-0000-4000-8000-000000000058'),
    'sans_argent', (select count(*)::int from p7_emails where related_id = '7c700000-0000-4000-8000-000000000058' and event_type = 'client_order_line_cancelled'
              and body_html !~* 'reembols|anticipo|contactaremos')),
  jsonb_build_object('refund', 0, 'a_decider', 0, 'sans_argent', 1),
  'C18 : une ligne vit encore : aucune entrée de remboursement ni « à décider », aucun texte d''argent');
select is((select d1 from p7_booked), 5, 'C19 : la place de la ligne annulée par l''établissement est rendue');

-- ── `expired` sur une commande payée : refusé, rien n'est écrit ──────────
select throws_ok(
  $$ select set_order_line_status('7c700000-0000-4000-8000-000000000060', 'expired', 'test') $$,
  'P0001', 'transition refusée : une commande payée n''expire pas',
  'C20 : une commande payée n''expire pas');
select is(
  jsonb_build_object('statut', (select status from order_lines where id = '7c700000-0000-4000-8000-000000000060'), 'booked', (select d1 from p7_booked)),
  jsonb_build_object('statut', 'reserved', 'booked', 5),
  'C21 : refus sans écriture (ligne réservée, place gardée)');

-- ── L'admin annule pour le client : place rendue, intent conservé ────────
select set_order_line_status('7c700000-0000-4000-8000-000000000061', 'cancelled_by_client', 'a pedido del cliente');
select is(
  jsonb_build_object('paiement', (select status from payments where id = '7c700000-0000-4000-8000-000000000078'),
                     'booked', (select d1 from p7_booked),
                     'note', (select count(*)::int from p7_emails where related_id = '7c700000-0000-4000-8000-000000000061'
                               and strpos(body_html, 'Anulamos «') > 0 and strpos(body_html, 'Tu pago en curso') = 0)),
  jsonb_build_object('paiement', 'pending', 'booked', 4, 'note', 1),
  'C22 : par l''admin : place rendue, intent pending NON annulé (décision C9), confirmation « Anulamos »');

-- ── expired (impayée) rend la place, sans e-mail ; no_show ne rend rien ─
select set_order_line_status('7c700000-0000-4000-8000-000000000052', 'expired', 'abandono');
select is(
  jsonb_build_object('booked', (select d1 from p7_booked),
                     'emails', (select count(*)::int from p7_emails where related_id = '7c700000-0000-4000-8000-000000000052')),
  jsonb_build_object('booked', 3, 'emails', 0),
  'C23 : `expired` rend la place, sans e-mail d''annulation');
select set_order_line_status('7c700000-0000-4000-8000-000000000059', 'no_show', 'no vino');
select is((select d1 from p7_booked), 3, 'C24 : no_show ne rend rien (place consommée)');

-- ── La règle, les droits, l'ordre des verrous du remplacement de jeton ──
select is(
  array[order_line_client_cancellable('reserved'), order_line_client_cancellable('cancelled_by_client'),
        order_line_client_cancellable('fulfilled'), order_line_client_cancellable('expired')],
  array[true, false, false, false],
  'C25 : seule une prestation réservée est annulable par son client');
select ok(
  not has_function_privilege('anon', 'public.set_order_line_status(uuid, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.set_order_line_status(uuid, text, text)', 'execute'),
  'C26 : anon n''exécute plus set_order_line_status (authenticated oui, les gardes font le reste)');
select ok(
  not has_function_privilege('anon', 'public.close_order_line_locked(uuid, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.close_order_line_locked(uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.notify_order_line_cancelled(uuid, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.notify_order_line_cancelled(uuid, text, text)', 'execute'),
  'C27 : les fonctions internes (sans garde, sous les verrous de l''appelant) sont fermées à anon et authenticated');
select ok(
  strpos(pg_get_functiondef('public.set_establishment_pms_connector'::regproc), 'for key share of ol')
    < strpos(pg_get_functiondef('public.set_establishment_pms_connector'::regproc), 'update public.pms_cancellation_queue'),
  'C28 : le remplacement de jeton verrouille les lignes AVANT la file (ordre du trigger d''une annulation)');
select is(
  (select count(*)::int from p7_emails where event_type = 'partner_order_line_cancelled' and recipient_email = 'p7-partner@test.local'),
  7, 'C29 : une information au prestataire par annulation (client ou établissement), pas pour expired ni no_show');
select is(
  (select array_agg(substr(related_id::text, 35) order by related_id) from p7_emails where event_type = 'client_order_line_cancelled'),
  array['51', '53', '54', '56', '57', '58', '61'],
  'C30 : une confirmation au client par annulation (client ou établissement), aucune pour expired ni no_show');

select * from finish();
rollback;

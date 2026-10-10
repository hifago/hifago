-- Annulation d'une prestation (migration 20261006192424) : une seule règle pour cancel_order_line
-- (le client) et set_order_line_status (admin, operator).
--
-- CE QUE CE FICHIER DOIT PROUVER :
--   - la place est rendue pour toute annulation (client, admin, operator ; commande payée ou non) et
--     pour `expired` : cupos, ressource partagée ET blocage d'agenda ; jamais pour no_show ; jamais
--     pour un evento qui n'est pas `metered` (`rsvp`, `unlimited`, sans mode), qui n'en a jamais pris ;
--   - l'argent : commande payée (ou `partially_refunded`) annulée pour le client → acompte acquis
--     (ledger A3 : référent `void`, compensation de l'établissement), par le client comme par l'admin ;
--     impayée ou remboursée → ledger `expired` (aucune compensation) ; le client qui retire une ligne
--     d'une commande `pending` annule ses intents (l'admin, non) ; l'établissement qui annule une
--     commande payée : aucun traitement de remboursement (décision du 2026-10-06) ;
--   - `expired` refusé sur une commande payée, sans rien écrire ; accepté sur une commande `pending` ;
--   - une confirmation au client et une information au prestataire par annulation : le FAIT
--     seulement (aucun mot sur l'argent), chaque valeur tierce échappée site par site, sujet en texte
--     brut, la phrase LobbyPMS / disponibilité selon les faits ; jamais vers une adresse sentinelle ;
--     rien pour `expired` ; l'operator laisse sa trace d'audit ;
--   - `cancellable` de list_my_orders = la règle de cancel_order_line ; `deposit_kept_on_cancel` = la
--     règle de close_order_line_locked (acompte encaissé : payée ou partiellement remboursée) ;
--   - `expired` refusé sur une commande payée sous le code HF001 (20261007003627) ;
--   - droits (anon ne peut plus appeler set_order_line_status ; fonctions internes et pures fermées)
--     et ordre des verrous du remplacement de jeton Lobby (lignes avant file) ;
--   - close_order_line_locked refuse un couple (statut, auteur) inconnu et une ligne non réservée.
-- Fixtures en SQL direct (tables RPC-only) : ce fichier tourne en tant que postgres.
begin;
select plan(42);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email) values
  ('7c700000-0000-4000-8000-000000000031', 'p7-client@test.local'),
  ('7c700000-0000-4000-8000-000000000032', 'p7-partner@test.local'),
  ('7c700000-0000-4000-8000-000000000033', 'p7-admin@test.local'),
  ('7c700000-0000-4000-8000-000000000034', 'p7-operator@test.local');
insert into partners (id, display_name) values
  ('7c700000-0000-4000-8000-000000000001', 'P7 Partner'),
  ('7c700000-0000-4000-8000-000000000002', 'P7 Referrer'),
  ('7c700000-0000-4000-8000-000000000003', 'P7 Operator');
insert into partner_accounts (id, partner_id) values
  ('7c700000-0000-4000-8000-000000000032', '7c700000-0000-4000-8000-000000000001'),
  ('7c700000-0000-4000-8000-000000000034', '7c700000-0000-4000-8000-000000000003')
on conflict (id) do update set partner_id = excluded.partner_id;
insert into establishments (id, partner_id, name, slug, lobby_connector_active, lobby_api_token) values
  ('7c700000-0000-4000-8000-000000000011', '7c700000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento P7'), 'est-p7-cancel', false, null),
  ('7c700000-0000-4000-8000-000000000012', '7c700000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento P7 PMS'), 'est-p7-cancel-pms', true, 'tok-p7');
insert into partner_capabilities (account_id, role, source, status) values
  ('7c700000-0000-4000-8000-000000000033', 'admin', 'migration', 'active');
-- operator ⇒ referrer (trigger enforce_operator_implies_referrer) : capacités du PARTENAIRE de
-- l'operator, distinct du propriétaire (les e-mails prestataire vont aux comptes du propriétaire).
insert into partner_capabilities (partner_id, role, source, status) values
  ('7c700000-0000-4000-8000-000000000003', 'referrer', 'migration', 'active');
insert into partner_capabilities (partner_id, role, establishment_id, source, status) values
  ('7c700000-0000-4000-8000-000000000003', 'operator', '7c700000-0000-4000-8000-000000000011', 'migration', 'active');
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, lobby_category_id,
                      evento_capacity_mode, default_capacity, evento_occupies_resource) values
  ('7c700000-0000-4000-8000-000000000021', '7c700000-0000-4000-8000-000000000001', '7c700000-0000-4000-8000-000000000011',
   'activity', jsonb_build_object('es', 'Kayak <b>&</b>'), 50000, true, 'p7-cancel-kayak', null, null, null, true),
  ('7c700000-0000-4000-8000-000000000023', '7c700000-0000-4000-8000-000000000001', '7c700000-0000-4000-8000-000000000012',
   'lodging', jsonb_build_object('es', 'Noche P7'), 80000, true, 'p7-cancel-noche', 9971, null, null, true),
  ('7c700000-0000-4000-8000-000000000024', '7c700000-0000-4000-8000-000000000001', '7c700000-0000-4000-8000-000000000012',
   'activity', jsonb_build_object('es', 'Tour P7'), 30000, true, 'p7-cancel-tour', null, null, null, true),
  ('7c700000-0000-4000-8000-000000000025', '7c700000-0000-4000-8000-000000000001', '7c700000-0000-4000-8000-000000000011',
   'evento', jsonb_build_object('es', 'Fiesta P7'), 10000, true, 'p7-cancel-fiesta', null, 'rsvp', 30, false),
  -- Evento sans mode (jamais vendu en ligne) : comme `rsvp`/`unlimited`, il ne prend aucune place.
  ('7c700000-0000-4000-8000-000000000026', '7c700000-0000-4000-8000-000000000001', '7c700000-0000-4000-8000-000000000011',
   'evento', jsonb_build_object('es', 'Charla P7'), 10000, true, 'p7-cancel-charla', null, null, null, false);

-- Le 2029-03-01 : une place par ligne d'activité (16) ; le 2029-03-05 : la ligne « occupante » (57)
-- tient 2 places et la ressource partagée les 05 et 06 (blocage d'agenda) ; le 2029-03-10 : 4
-- places d'un evento `rsvp` posées par des lignes manuelles — jamais par une ligne en ligne.
insert into product_availability (product_id, date, capacity, booked) values
  ('7c700000-0000-4000-8000-000000000021', '2029-03-01', 20, 16),
  ('7c700000-0000-4000-8000-000000000021', '2029-03-05', 10, 2),
  ('7c700000-0000-4000-8000-000000000025', '2029-03-10', 30, 4),
  ('7c700000-0000-4000-8000-000000000026', '2029-03-12', 30, 4);
insert into provider_resource_calendar (establishment_id, slot_date, capacity, booked) values
  ('7c700000-0000-4000-8000-000000000011', '2029-03-05', 5, 2),
  ('7c700000-0000-4000-8000-000000000011', '2029-03-06', 5, 2);

insert into orders (id, account_id, holder_name, holder_email, payment_status, reference) values
  ('7c700000-0000-4000-8000-000000000041', '7c700000-0000-4000-8000-000000000031', 'Ana & <i>Co</i>', 'p7-41@test.local', 'unpaid', 'P7<41>&'),
  ('7c700000-0000-4000-8000-000000000042', '7c700000-0000-4000-8000-000000000031', 'P7', 'p7-42@test.local', 'paid', 'P7-42'),
  ('7c700000-0000-4000-8000-000000000043', '7c700000-0000-4000-8000-000000000031', 'P7', 'p7-43@test.local', 'pending', 'P7-43'),
  ('7c700000-0000-4000-8000-000000000044', '7c700000-0000-4000-8000-000000000031', 'P7', 'p7-44@test.local', 'refunded', 'P7-44'),
  ('7c700000-0000-4000-8000-000000000045', '7c700000-0000-4000-8000-000000000031', 'P7', 'p7-45@test.local', 'paid', 'P7-45'),
  ('7c700000-0000-4000-8000-000000000046', '7c700000-0000-4000-8000-000000000031', 'P7', 'p7-46@test.local', 'paid', 'P7-46'),
  ('7c700000-0000-4000-8000-000000000047', '7c700000-0000-4000-8000-000000000031', 'P7', 'p7-47@test.local', 'paid', 'P7-47'),
  ('7c700000-0000-4000-8000-000000000048', '7c700000-0000-4000-8000-000000000031', 'P7', 'p7-48@test.local', 'pending', 'P7-48'),
  ('7c700000-0000-4000-8000-000000000049', '7c700000-0000-4000-8000-000000000031', 'Walk-in', 'reserva-manual@hifago.local', 'unpaid', 'P7-49'),
  ('7c700000-0000-4000-8000-000000000050', '7c700000-0000-4000-8000-000000000031', 'P7', 'p7-50@test.local', 'paid', 'P7-50'),
  ('7c700000-0000-4000-8000-000000000051', '7c700000-0000-4000-8000-000000000031', 'P7', 'p7-51@test.local', 'pending', 'P7-51'),
  ('7c700000-0000-4000-8000-000000000052', '7c700000-0000-4000-8000-000000000031', 'P7', 'p7-52@test.local', 'paid', 'P7-52'),
  ('7c700000-0000-4000-8000-000000000053', '7c700000-0000-4000-8000-000000000031', 'P7', 'p7-53@test.local', 'partially_refunded', 'P7-53'),
  ('7c700000-0000-4000-8000-000000000054', '7c700000-0000-4000-8000-000000000031', 'P7', 'p7-54@test.local', 'paid', 'P7-54'),
  ('7c700000-0000-4000-8000-000000000055', '7c700000-0000-4000-8000-000000000031', 'P7', 'p7-55@test.local', 'unpaid', 'P7-55');
insert into payments (id, order_id, status, amount_cop, mp_payment_id) values
  ('7c700000-0000-4000-8000-000000000072', '7c700000-0000-4000-8000-000000000042', 'approved', 8500, 'MP-P7-42'),
  ('7c700000-0000-4000-8000-000000000073', '7c700000-0000-4000-8000-000000000043', 'pending', 17000, null),
  ('7c700000-0000-4000-8000-000000000075', '7c700000-0000-4000-8000-000000000045', 'approved', 17000, 'MP-P7-45'),
  ('7c700000-0000-4000-8000-000000000076', '7c700000-0000-4000-8000-000000000046', 'approved', 17000, 'MP-P7-46'),
  ('7c700000-0000-4000-8000-000000000078', '7c700000-0000-4000-8000-000000000048', 'pending', 8500, null),
  ('7c700000-0000-4000-8000-000000000081', '7c700000-0000-4000-8000-000000000051', 'pending', 8500, null);

create function p7_line(p_id text, p_order text, p_date date, p_qty int, p_referrer boolean,
                        p_product text default '21', p_end date default null, p_booking text default null) returns void
language sql as $$
  insert into order_lines (
    id, order_id, account_id, product_id, date, end_date, qty, status, holder_name,
    price_cop, total_cop, commission_case, referrer_partner_id, acompte_pct, referrer_pct, app_pct,
    acompte_cop, referrer_commission_cop, app_commission_cop, pms_booking_id
  ) values (
    ('7c700000-0000-4000-8000-0000000000' || p_id)::uuid, ('7c700000-0000-4000-8000-0000000000' || p_order)::uuid,
    '7c700000-0000-4000-8000-000000000031', ('7c700000-0000-4000-8000-0000000000' || p_product)::uuid, p_date, p_end, p_qty, 'reserved', 'P7',
    50000 * p_qty, 50000 * p_qty, case when p_referrer then 'external_referrer' else 'direct' end,
    case when p_referrer then '7c700000-0000-4000-8000-000000000002'::uuid end,
    0.17, case when p_referrer then 0.10 else 0 end, case when p_referrer then 0.07 else 0.17 end,
    8500 * p_qty, case when p_referrer then 5000 * p_qty else 0 end, case when p_referrer then 3500 * p_qty else 8500 * p_qty end,
    p_booking
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
select p7_line('62', '49', '2029-03-01', 1, false);
select p7_line('63', '50', '2029-03-01', 1, true);
select p7_line('64', '51', '2029-03-01', 1, false);
select p7_line('65', '52', '2029-03-01', 1, false);
select p7_line('66', '53', '2029-03-01', 1, true);
-- Commande 54 : une nuit PMS et une activité qui partagent le booking P7-B1 (comme reserve-nights).
select p7_line('67', '54', '2029-04-01', 1, false, '23', '2029-04-02', 'P7-B1');
select p7_line('68', '54', '2029-04-01', 1, false, '24', null, 'P7-B1');
-- Commande 55 : deux places d'un evento `rsvp` réservées en ligne (aucune place prise).
select p7_line('69', '55', '2029-03-10', 2, false, '25');
-- Commande 55 : une place d'un evento sans mode (aucune place prise).
select p7_line('70', '55', '2029-03-12', 1, false, '26');
insert into availability_blocks (establishment_id, start_date, end_date, source_order_line_id) values
  ('7c700000-0000-4000-8000-000000000011', '2029-03-05', '2029-03-06', '7c700000-0000-4000-8000-000000000057');
insert into ledger_entries (order_line_id, beneficiary_type, referrer_partner_id, entry_type, amount_cop, status)
select ('7c700000-0000-4000-8000-0000000000' || n)::uuid, 'referrer', '7c700000-0000-4000-8000-000000000002', 'referral_earned', 5000, 'estimated'
  from unnest(array['51', '53', '56', '63', '66']) n;

create temp view p7_booked as
  select (select booked from product_availability where product_id = '7c700000-0000-4000-8000-000000000021' and date = '2029-03-01') as d1;
create temp view p7_emails as
  select event_type, recipient_email, related_id, subject, body_html from notification_emails
   where related_table = 'order_lines' and related_id::text like '7c700000-%';
create temp view p7_ledger as
  select order_line_id, entry_type, status, amount_cop from ledger_entries where order_line_id::text like '7c700000-%';
-- Aucun e-mail d'annulation ne parle d'argent (décision du 2026-10-06).
create temp view p7_money_words as
  select related_id from p7_emails where body_html ~* 'reembols|anticipo|cobr|pago|contactaremos';

-- ── Le client retire une ligne d'une commande IMPAYÉE ────────────────────
set local role authenticated;
select test_login('7c700000-0000-4000-8000-000000000031');
select is((public.cancel_order_line('7c700000-0000-4000-8000-000000000051') ->> 'remaining_active_lines')::int, 1,
  'C1 : le client retire une ligne d''une commande impayée (geste conservé) — une ligne reste');
create temp table c1_list as select public.list_my_orders() as r;
reset role;
select is((select d1 from p7_booked), 15, 'C2 : la place est rendue (16 → 15)');
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
  (select jsonb_object_agg(substr(o ->> 'id', 35),
                           (select jsonb_agg(distinct l -> 'deposit_kept_on_cancel') from jsonb_array_elements(o -> 'lines') l))
     from c1_list, jsonb_array_elements(r -> 'orders') o
    where substr(o ->> 'id', 35) in ('41', '42', '43', '44', '53')),
  jsonb_build_object('41', jsonb_build_array(false), '42', jsonb_build_array(true), '43', jsonb_build_array(false),
                     '44', jsonb_build_array(false), '53', jsonb_build_array(true)),
  'C4b : `deposit_kept_on_cancel` par ligne — acquis si payée ou partiellement remboursée ; impayée, en cours, remboursée : non');
select is(
  (select count(*)::int from p7_emails
    where related_id = '7c700000-0000-4000-8000-000000000051' and event_type = 'client_order_line_cancelled'
      and recipient_email = 'p7-41@test.local' and subject = 'Anulación en tu reserva P7<41>&'
      and strpos(body_html, 'Hola Ana &amp; &lt;i&gt;Co&lt;/i&gt;,') > 0
      and strpos(body_html, 'Anulaste «Kayak &lt;b&gt;&amp;&lt;/b&gt;» del 01/03/2029') > 0
      and strpos(body_html, 'en tu reserva <strong>P7&lt;41&gt;&amp;</strong>') > 0
      and strpos(body_html, 'Kayak <b>') = 0 and strpos(body_html, '<i>Co') = 0 and strpos(body_html, 'P7<41>') = 0),
  1, 'C5 : la confirmation au client : titulaire, produit et référence échappés ; sujet en texte brut');
select is(
  (select count(*)::int from p7_emails
    where related_id = '7c700000-0000-4000-8000-000000000051' and event_type = 'partner_order_line_cancelled'
      and recipient_email = 'p7-partner@test.local' and subject = 'Reserva anulada: Kayak <b>&</b>'
      and strpos(body_html, 'Se anuló «Kayak &lt;b&gt;&amp;&lt;/b&gt;» del 01/03/2029 (cantidad: 1), reserva <strong>P7&lt;41&gt;&amp;</strong>.') > 0
      and strpos(body_html, 'Anulada por el cliente.') > 0 and strpos(body_html, 'La disponibilidad quedó liberada.') > 0
      and strpos(body_html, 'Kayak <b>') = 0 and strpos(body_html, 'P7<41>') = 0),
  1, 'C6 : l''information au prestataire : produit et référence échappés, sujet brut, place libérée');

-- ── Commande PAYÉE annulée par le client : place rendue, acompte acquis (A3) ─
set local role authenticated;
select test_login('7c700000-0000-4000-8000-000000000031');
select public.cancel_order_line('7c700000-0000-4000-8000-000000000053');
reset role;
select is((select d1 from p7_booked), 14, 'C7 : commande payée : la place est rendue aussi (G1-bis)');
select is(
  (select array_agg(entry_type || ':' || status || ':' || amount_cop order by entry_type) from p7_ledger where order_line_id = '7c700000-0000-4000-8000-000000000053'),
  array['establishment_compensation:due:5000', 'referral_earned:void:5000'],
  'C8 : A3 : part référent annulée, redirigée vers l''établissement (compensation due)');
select is(
  (select o.payment_status || ':' || p.status from orders o join payments p on p.order_id = o.id where o.id = '7c700000-0000-4000-8000-000000000042'),
  'paid:approved', 'C9 : l''acompte reste acquis : commande et paiement inchangés');

-- ── Commande `pending` : l'intent en cours est annulé ────────────────────
set local role authenticated;
select test_login('7c700000-0000-4000-8000-000000000031');
select public.cancel_order_line('7c700000-0000-4000-8000-000000000054');
reset role;
select is(
  (select o.payment_status || ':' || p.status from orders o join payments p on p.order_id = o.id where o.id = '7c700000-0000-4000-8000-000000000043'),
  'unpaid:cancelled', 'C10 : l''intent de l''ancien montant est annulé, la commande repasse impayée');

-- ── Commande remboursée ; commande partiellement remboursée ──────────────
set local role authenticated;
select test_login('7c700000-0000-4000-8000-000000000031');
select public.cancel_order_line('7c700000-0000-4000-8000-000000000056');
select public.cancel_order_line('7c700000-0000-4000-8000-000000000066');
reset role;
select is(
  (select array_agg(entry_type || ':' || status order by entry_type) from p7_ledger where order_line_id = '7c700000-0000-4000-8000-000000000056'),
  array['referral_earned:void'],
  'C11 : commande remboursée : aucune compensation (l''argent est déjà rendu)');
select is(
  (select array_agg(entry_type || ':' || status order by entry_type) from p7_ledger where order_line_id = '7c700000-0000-4000-8000-000000000066'),
  array['establishment_compensation:due', 'referral_earned:void'],
  'C12 : commande partiellement remboursée : traitée comme payée (A3)');
select is((select d1 from p7_booked), 11, 'C13 : places rendues (14 → 11 : lignes 54, 56, 66)');

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
  'C15 : commande payée annulée par l''établissement : aucun traitement de remboursement (décision du 2026-10-06)');
select is(
  (select count(*)::int from p7_emails where related_id = '7c700000-0000-4000-8000-000000000057'
      and ((event_type = 'client_order_line_cancelled' and strpos(body_html, 'El establecimiento anuló «') > 0)
        or (event_type = 'partner_order_line_cancelled' and strpos(body_html, 'Anulada por el establecimiento.') > 0))),
  2, 'C16 : le client apprend le fait, le prestataire est informé');

-- ── … une ligne sur deux : même chose ───────────────────────────────────
select set_order_line_status('7c700000-0000-4000-8000-000000000058', 'cancelled_by_provider', 'cupo agotado');
select is(
  jsonb_build_object(
    'refund', (select count(*)::int from payment_reconciliation_entries where mp_payment_id = 'MP-P7-46'),
    'a_decider', (select count(*)::int from pms_reconciliation_entries where order_line_id = '7c700000-0000-4000-8000-000000000058'),
    'booked', (select d1 from p7_booked)),
  jsonb_build_object('refund', 0, 'a_decider', 0, 'booked', 10),
  'C17 : une ligne vit encore : aucune entrée de remboursement ni « à décider » ; la place est rendue');

-- ── `expired` : refusé sur payée, accepté sur `pending` ─────────────────
select throws_ok(
  $$ select set_order_line_status('7c700000-0000-4000-8000-000000000060', 'expired', 'test') $$,
  'HF001', 'transition refusée : une commande payée n''expire pas',
  'C18 : une commande payée n''expire pas');
select is(
  jsonb_build_object('statut', (select status from order_lines where id = '7c700000-0000-4000-8000-000000000060'), 'booked', (select d1 from p7_booked)),
  jsonb_build_object('statut', 'reserved', 'booked', 10),
  'C19 : refus sans écriture (ligne réservée, place gardée)');
select set_order_line_status('7c700000-0000-4000-8000-000000000064', 'expired', 'abandono');
select is(
  jsonb_build_object('statut', (select status from order_lines where id = '7c700000-0000-4000-8000-000000000064'),
                     'booked', (select d1 from p7_booked),
                     'emails', (select count(*)::int from p7_emails where related_id = '7c700000-0000-4000-8000-000000000064'),
                     'intent', (select status from payments where id = '7c700000-0000-4000-8000-000000000081')),
  jsonb_build_object('statut', 'expired', 'booked', 9, 'emails', 0, 'intent', 'pending'),
  'C20 : `expired` accepté sur une commande `pending` : place rendue, aucun e-mail, intent conservé (admin)');

-- ── L'admin annule pour le client ─────────────────────────────────────────
select set_order_line_status('7c700000-0000-4000-8000-000000000061', 'cancelled_by_client', 'a pedido del cliente');
select is(
  jsonb_build_object('paiement', (select status from payments where id = '7c700000-0000-4000-8000-000000000078'),
                     'booked', (select d1 from p7_booked),
                     'client', (select count(*)::int from p7_emails where related_id = '7c700000-0000-4000-8000-000000000061'
                                 and event_type = 'client_order_line_cancelled' and strpos(body_html, 'Anulamos, a tu pedido, «') > 0),
                     'partenaire', (select count(*)::int from p7_emails where related_id = '7c700000-0000-4000-8000-000000000061'
                                 and event_type = 'partner_order_line_cancelled'
                                 and strpos(body_html, 'Anulada por la administración de Hifago, a pedido del cliente.') > 0)),
  jsonb_build_object('paiement', 'pending', 'booked', 8, 'client', 1, 'partenaire', 1),
  'C21 : par l''admin : place rendue, intent pending NON annulé (décision C9), confirmation « a tu pedido »');
select set_order_line_status('7c700000-0000-4000-8000-000000000063', 'cancelled_by_client', 'a pedido del cliente');
select is(
  (select array_agg(entry_type || ':' || status order by entry_type) from p7_ledger where order_line_id = '7c700000-0000-4000-8000-000000000063'),
  array['establishment_compensation:due', 'referral_earned:void'],
  'C22 : l''admin qui annule pour le client une commande payée applique A3, comme le client');

-- ── L'operator (non admin) annule pour son établissement ─────────────────
select test_login('7c700000-0000-4000-8000-000000000034');
select set_order_line_status('7c700000-0000-4000-8000-000000000065', 'cancelled_by_provider', 'cerrado por clima');
select is(
  jsonb_build_object('statut', (select status from order_lines where id = '7c700000-0000-4000-8000-000000000065'),
                     'booked', (select d1 from p7_booked),
                     'audit', (select count(*)::int from audit_log where actor_id = '7c700000-0000-4000-8000-000000000034'
                                and action = 'order_line.set_status' and entity_id = '7c700000-0000-4000-8000-000000000065'),
                     'emails', (select count(*)::int from p7_emails where related_id = '7c700000-0000-4000-8000-000000000065')),
  jsonb_build_object('statut', 'cancelled_by_provider', 'booked', 6, 'audit', 1, 'emails', 2),
  'C23 : l''operator : place rendue, trace d''audit, client et prestataire informés');

-- ── Ligne manuelle (adresse sentinelle) : aucun e-mail client ───────────
select test_login('7c700000-0000-4000-8000-000000000033');
select set_order_line_status('7c700000-0000-4000-8000-000000000062', 'cancelled_by_provider', 'test');
select is(
  jsonb_build_object('client', (select count(*)::int from p7_emails where related_id = '7c700000-0000-4000-8000-000000000062' and event_type = 'client_order_line_cancelled'),
                     'partenaire', (select count(*)::int from p7_emails where related_id = '7c700000-0000-4000-8000-000000000062' and event_type = 'partner_order_line_cancelled'),
                     'booked', (select d1 from p7_booked)),
  jsonb_build_object('client', 0, 'partenaire', 1, 'booked', 5),
  'C24 : jamais d''e-mail vers une adresse sentinelle (@hifago.local) ; le prestataire, lui, est informé');

-- ── no_show ne rend rien ─────────────────────────────────────────────────
select set_order_line_status('7c700000-0000-4000-8000-000000000059', 'no_show', 'no vino');
select is((select d1 from p7_booked), 5, 'C25 : no_show ne rend rien (place consommée)');

-- ── Evento `rsvp` : aucune place n'a été prise, aucune n'est rendue ──────
set local role authenticated;
select test_login('7c700000-0000-4000-8000-000000000031');
select public.cancel_order_line('7c700000-0000-4000-8000-000000000069');
reset role;
select is(
  (select booked from product_availability where product_id = '7c700000-0000-4000-8000-000000000025' and date = '2029-03-10'),
  4, 'C26 : evento `rsvp` : les 4 places des lignes manuelles restent prises (prédicat de create_order)');
select public.release_order_line_capacity('7c700000-0000-4000-8000-000000000070');
select is(
  (select booked from product_availability where product_id = '7c700000-0000-4000-8000-000000000026' and date = '2029-03-12'),
  4, 'C26b : evento sans mode : rien n''est rendu (seul `metered` prend une place)');

-- ── LobbyPMS : la phrase dit les faits ───────────────────────────────────
set local role authenticated;
select test_login('7c700000-0000-4000-8000-000000000031');
select public.cancel_order_line('7c700000-0000-4000-8000-000000000068');
reset role;
select is(
  (select count(*)::int from p7_emails where related_id = '7c700000-0000-4000-8000-000000000068' and event_type = 'partner_order_line_cancelled'
      and strpos(body_html, 'La reserva sigue activa en LobbyPMS: otras prestaciones de la misma reserva siguen vigentes.') > 0
      and strpos(body_html, 'se transmite') = 0),
  1, 'C27 : une activité du booking annulée, la nuit vit encore : « sigue activa en LobbyPMS »');
set local role authenticated;
select test_login('7c700000-0000-4000-8000-000000000031');
select public.cancel_order_line('7c700000-0000-4000-8000-000000000067');
reset role;
select is(
  (select count(*)::int from p7_emails where related_id = '7c700000-0000-4000-8000-000000000067' and event_type = 'partner_order_line_cancelled'
      and strpos(body_html, 'La anulación se transmite a LobbyPMS.') > 0 and strpos(body_html, 'disponibilidad') = 0)
  + (select count(*)::int from pms_cancellation_queue where pms_booking_id = 'P7-B1' and status = 'pending'),
  2, 'C28 : la dernière ligne du booking : enfilée chez Lobby, et c''est ce que dit l''e-mail (rien sur une disponibilité locale)');

-- ── Aucun e-mail d'annulation ne parle d'argent ──────────────────────────
select is((select count(*)::int from p7_money_words), 0, 'C29 : aucun e-mail d''annulation ne parle d''argent');
select is(
  (select array_agg(substr(related_id::text, 35) order by related_id) from p7_emails where event_type = 'client_order_line_cancelled'),
  array['51', '53', '54', '56', '57', '58', '61', '63', '65', '66', '67', '68', '69'],
  'C30 : une confirmation au client par annulation (pas pour expired, no_show, ni l''adresse sentinelle 62)');
select is(
  (select count(*)::int from p7_emails where event_type = 'partner_order_line_cancelled' and recipient_email = 'p7-partner@test.local'),
  14, 'C31 : une information au prestataire par annulation (sentinelle comprise), pas pour expired ni no_show');

-- ── La règle, les gardes, les droits, l'ordre des verrous ────────────────
select is(
  array[order_line_client_cancellable('reserved'), order_line_client_cancellable('cancelled_by_client'),
        order_line_client_cancellable('fulfilled'), order_line_client_cancellable('expired')],
  array[true, false, false, false],
  'C32 : seule une prestation réservée est annulable par son client');
select throws_ok(
  $$ select close_order_line_locked('7c700000-0000-4000-8000-000000000052', 'cancelled_by_provider', 'client') $$,
  'P0001', 'close_order_line_locked : transition cancelled_by_provider par client inconnue',
  'C33 : un couple (statut, auteur) inconnu est refusé');
select throws_ok(
  $$ select close_order_line_locked('7c700000-0000-4000-8000-000000000051', 'cancelled_by_client', 'client') $$,
  'P0001', null,
  'C34 : une ligne qui n''est plus réservée est refusée (jamais une place rendue deux fois)');
select ok(
  not has_function_privilege('anon', 'public.set_order_line_status(uuid, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.set_order_line_status(uuid, text, text)', 'execute'),
  'C35 : anon n''exécute plus set_order_line_status (authenticated oui, les gardes font le reste)');
select ok(
  not has_function_privilege('anon', 'public.close_order_line_locked(uuid, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.close_order_line_locked(uuid, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.notify_order_line_cancelled(uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.notify_order_line_cancelled(uuid, text)', 'execute'),
  'C36 : les fonctions internes (sans garde, sous les verrous de l''appelant) sont fermées à anon et authenticated');
select ok(
  not has_function_privilege('anon', 'public.order_line_client_cancellable(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.order_jsonb_with_client_cancellable(jsonb)', 'execute'),
  'C37 : les fonctions pures de la règle ne sont pas une API');
select ok(
  strpos(pg_get_functiondef('public.set_establishment_pms_connector'::regproc), 'for key share of ol') > 0
  and strpos(pg_get_functiondef('public.set_establishment_pms_connector'::regproc), 'for key share of ol')
    < strpos(pg_get_functiondef('public.set_establishment_pms_connector'::regproc), 'update public.pms_cancellation_queue'),
  'C38 : le remplacement de jeton verrouille les lignes AVANT la file (ordre du trigger d''une annulation)');
select is(
  (select count(*)::int from p7_emails where event_type = 'client_order_line_cancelled' and recipient_email like '%@hifago.local'),
  0, 'C39 : aucune adresse sentinelle parmi les destinataires');
select is((select status from order_lines where id = '7c700000-0000-4000-8000-000000000052'), 'reserved',
  'C40 : les refus de close_order_line_locked n''ont rien écrit');

select * from finish();
rollback;

-- Le prestataire ne voit plus comme une RÉSERVATION une ligne `reserved` dont la commande attend encore
-- son paiement (20261024120000, option A) : partner_agenda_order_lines, partner_reservations_list et
-- partner_reservation_detail. Restent visibles : commande payée (même en cours de booking Lobby),
-- commande SANS acompte dû (evento gratuit / sur place / réservation manuelle du prestataire), tout autre
-- statut de ligne, commande remboursée.
begin;
select plan(25);

create function t_id(p text) returns uuid language sql as $$
  select ('b1500000-0000-4000-8000-' || lpad(p, 12, '0'))::uuid;
$$;
create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values (t_id('1'), 'Impayees Own'), (t_id('2'), 'Impayees Other');
insert into establishments (id, partner_id, name) values
  (t_id('11'), t_id('1'), jsonb_build_object('es', 'Impayees Own')),
  (t_id('12'), t_id('2'), jsonb_build_object('es', 'Impayees Other'));
insert into auth.users (id, email) values (t_id('21'), 'impayees-own@test.local'), (t_id('22'), 'impayees-buyer@test.local');
update partner_accounts set partner_id = t_id('1') where id = t_id('21');
insert into partner_capabilities (partner_id, role, source, status) values (t_id('1'), 'referrer', 'migration', 'active');
insert into partner_capabilities (partner_id, role, establishment_id, source, status)
  values (t_id('1'), 'operator', t_id('11'), 'migration', 'active');
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  (t_id('31'), t_id('1'), t_id('11'), 'activity', jsonb_build_object('es', 'Actividad Impagadas'), 50000, true, 'impayees-own'),
  (t_id('32'), t_id('2'), t_id('12'), 'activity', jsonb_build_object('es', 'Actividad Otra'), 50000, true, 'impayees-other');

create function t_order(p text, p_payment text) returns void language sql as $$
  insert into orders (id, account_id, holder_name, holder_email, payment_status)
  values (t_id(p), t_id('22'), 'Impayees Holder', 'impayees-' || p || '@test.local', p_payment);
$$;
create function t_line(p text, p_order text, p_status text, p_acompte bigint, p_product text default '31') returns void language sql as $$
  insert into order_lines (
    id, order_id, account_id, product_id, date, qty, status, holder_name, holder_phone, holder_email,
    price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
    acompte_cop, referrer_commission_cop, app_commission_cop
  ) values (
    t_id(p), t_id(p_order), t_id('22'), t_id(p_product), '2029-08-25', 1, p_status, 'Impayees Holder',
    '+573000000001', 'cliente-' || p || '@test.local',
    50000, 50000, 'direct', 0, 0, 0, p_acompte, 0, 0
  );
$$;

-- 201 payée (visible) · 202 impayée (masquée) · 203 paiement en cours (masquée) · 204 sans acompte dû
-- (visible) · 205 remboursée (visible) · 206 partiellement remboursée (visible) · 207 impayée mais ligne
-- expirée (visible : seul `reserved` se masque) · 208 impayée, ligne réalisée (visible) · 209 impayée, une
-- ligne sans acompte ET une ligne avec acompte : la commande attend son paiement, les deux `reserved`
-- sont masquées · 210 impayée d'un AUTRE établissement (jamais visible pour ce prestataire).
select t_order('101', 'paid');                select t_line('201', '101', 'reserved', 17000);
select t_order('102', 'unpaid');              select t_line('202', '102', 'reserved', 17000);
select t_order('103', 'pending');             select t_line('203', '103', 'reserved', 17000);
select t_order('104', 'unpaid');              select t_line('204', '104', 'reserved', 0);
select t_order('105', 'refunded');            select t_line('205', '105', 'reserved', 17000);
select t_order('106', 'partially_refunded');  select t_line('206', '106', 'reserved', 17000);
select t_order('107', 'unpaid');              select t_line('207', '107', 'expired', 17000);
select t_order('108', 'unpaid');              select t_line('208', '108', 'fulfilled', 17000);
select t_order('109', 'unpaid');              select t_line('209', '109', 'reserved', 0); select t_line('219', '109', 'reserved', 17000);
select t_order('110', 'unpaid');              select t_line('210', '110', 'reserved', 17000, '32');
-- 211 payée, ligne ANNULÉE (ses coordonnées restent visibles) · 212 commande entièrement gratuite dont la
-- ligne a expiré (ferme : coordonnées visibles).
select t_order('111', 'paid');                select t_line('211', '111', 'cancelled_by_client', 17000);
select t_order('112', 'unpaid');              select t_line('212', '112', 'expired', 0);

-- Une commande payée dont le booking Lobby est en cours : le prestataire doit la voir.
insert into pms_booking_requests (order_id, status) values (t_id('101'), 'pending');

-- ── La fonction interne n'est jamais exposée ─────────────────────────────────────────────────
select ok(
  not has_function_privilege('anon', 'public.order_awaits_payment(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.order_awaits_payment(uuid)', 'execute'),
  'F1 : order_awaits_payment est interne (ni anon ni authenticated)');
select is(
  (select jsonb_object_agg(right(o::text, 3), public.order_awaits_payment(o))
     from unnest(array[t_id('101'), t_id('102'), t_id('103'), t_id('104'), t_id('105'), t_id('106'), t_id('107'), t_id('108'), t_id('109')]) o),
  jsonb_build_object('101', false, '102', true, '103', true, '104', false, '105', false, '106', false, '107', false, '108', true, '109', true),
  'F2 : la règle : unpaid/pending ET acompte dû (lignes vivantes) — ni payée, ni remboursée, ni sans acompte dû');
select is(public.order_awaits_payment(t_id('999')), false, 'F3 : une commande inconnue n''attend rien (jamais NULL, qui masquerait la ligne)');

select is(
  (select jsonb_object_agg(right(l::text, 3), public.line_never_paid(l))
     from unnest(array[t_id('201'), t_id('202'), t_id('204'), t_id('207'), t_id('209'), t_id('211'), t_id('212')]) l),
  jsonb_build_object('201', false, '202', true, '204', false, '207', true, '209', true, '211', false, '212', false),
  'F4 : line_never_paid : jamais payée avec acompte (vivante ou morte) ou ligne gratuite d''une commande à payer ; ni payée, ni commande ferme sans acompte');

-- ── Agenda ───────────────────────────────────────────────────────────────────────────────────
set local role authenticated;
select test_login(t_id('21'));
select is(
  (select array_agg(right(id::text, 3) order by id) from partner_agenda_order_lines('2029-08-01'::date, '2029-09-01'::date)),
  array['201', '204', '205', '206', '208'],
  'A1 : l''agenda montre la payée, la sans-acompte-dû, les remboursées et la réalisée ; jamais l''impayée, la en cours, ni la commande mixte');
select is(
  (select count(*)::int from partner_agenda_order_lines('2029-08-01'::date, '2029-09-01'::date) where id in (t_id('202'), t_id('203'), t_id('209'), t_id('219'))),
  0, 'A2 : aucune ligne masquée n''apparaît (les compteurs du dashboard lisent cette RPC)');

-- ── Liste ────────────────────────────────────────────────────────────────────────────────────
select is(
  (select array_agg(right(id::text, 3) order by id) from partner_reservations_list()),
  array['201', '204', '205', '206', '207', '208', '211', '212'],
  'L1 : la liste montre payée, sans acompte dû, remboursées, expirée, réalisée, annulée d''une payée ; jamais les reserved impayées');
select is(
  (select min(total_count)::int || '/' || max(total_count)::int || '/' || count(*)::int from partner_reservations_list()),
  '8/8/8', 'L2 : total_count (count over) = lignes visibles : la pagination ne compte pas les lignes masquées');
select is(
  (select array_agg(right(id::text, 3) order by id) from partner_reservations_list(p_status => 'reserved')),
  array['201', '204', '205', '206'],
  'L3 : le filtre par statut « reserved » ne rend que les reserved confirmées');
select is(
  (select count(*)::int from partner_reservations_list(p_limit => 2, p_offset => 6)),
  2, 'L4 : la pagination se fait sur les lignes visibles (2 dernières sur 8)');

-- ── Détail ───────────────────────────────────────────────────────────────────────────────────
select is((select count(*)::int from partner_reservation_detail(t_id('201'))), 1, 'D1 : le détail d''une payée s''ouvre');
select is((select count(*)::int from partner_reservation_detail(t_id('204'))), 1, 'D2 : celui d''une sans acompte dû aussi');
select is((select count(*)::int from partner_reservation_detail(t_id('202'))), 0,
  'D3 : le détail d''une ligne masquée, ouvert par lien direct, répond comme introuvable');
select is((select count(*)::int from partner_reservation_detail(t_id('219'))), 0, 'D4 : y compris la ligne d''une commande mixte');
select is((select count(*)::int from partner_reservation_detail(t_id('207'))), 1, 'D5 : une ligne expirée reste ouvrable (seul `reserved` se masque)');

-- ── Coordonnées du client : jamais pour une ligne jamais payée, même morte et visible ─────────
select is(
  (select jsonb_object_agg(right(id::text, 3), jsonb_build_object('tel', holder_phone is not null, 'mail', holder_email is not null))
     from partner_reservations_list() where id in (t_id('201'), t_id('204'), t_id('207'), t_id('208'), t_id('211'), t_id('212'))),
  jsonb_build_object(
    '201', jsonb_build_object('tel', true,  'mail', true),   -- payée
    '204', jsonb_build_object('tel', true,  'mail', true),   -- sans acompte dû
    '207', jsonb_build_object('tel', false, 'mail', false),  -- expirée d'une commande jamais payée : « Expirada » SANS coordonnées
    '208', jsonb_build_object('tel', false, 'mail', false),  -- réalisée dans une commande jamais payée (cas aberrant) : idem
    '211', jsonb_build_object('tel', true,  'mail', true),   -- annulée mais la commande est payée
    '212', jsonb_build_object('tel', true,  'mail', true)),  -- expirée d'une commande gratuite : ferme
  'K1 : liste : coordonnées masquées pour les lignes jamais payées (207, 208), conservées sinon');
select is(
  (select jsonb_build_object('nom', holder_name, 'tel', holder_phone, 'mail', holder_email) from partner_reservation_detail(t_id('207'))),
  jsonb_build_object('nom', 'Impayees Holder', 'tel', null, 'mail', null),
  'K2 : détail d''une ligne expirée jamais payée : le nom, jamais le téléphone ni l''e-mail');
select is(
  (select holder_phone is not null and holder_email is not null from partner_reservation_detail(t_id('211'))),
  true, 'K3 : détail d''une annulée d''une commande payée : coordonnées conservées');
reset role;

-- ── E-mail d'annulation au prestataire : pas pour une ligne jamais confirmée ──────────────────
create function t_cancel_mails(p_line text) returns jsonb language plpgsql as $$
begin
  perform public.notify_order_line_cancelled(t_id(p_line), 'client');
  return jsonb_build_object(
    'client', (select count(*)::int from notification_emails where event_type = 'client_order_line_cancelled' and related_id = t_id(p_line)),
    'prestataire', (select count(*)::int from notification_emails where event_type = 'partner_order_line_cancelled' and related_id = t_id(p_line)));
end; $$;
select is(t_cancel_mails('202'), jsonb_build_object('client', 1, 'prestataire', 0),
  'E1 : ligne d''une commande jamais payée annulée : le client est prévenu, le prestataire (qui ne l''a jamais vue) NON');
select is(t_cancel_mails('201'), jsonb_build_object('client', 1, 'prestataire', 1),
  'E2 : ligne d''une commande payée annulée : le client ET le prestataire');
select is(t_cancel_mails('204'), jsonb_build_object('client', 1, 'prestataire', 1),
  'E3 : ligne d''une commande ferme sans acompte dû annulée : le prestataire la voyait, il est prévenu');
select is(t_cancel_mails('209'), jsonb_build_object('client', 1, 'prestataire', 0),
  'E4 : ligne gratuite d''une commande à payer (masquée avec elle) : le prestataire n''est pas prévenu');
-- L'échappement de l'e-mail prestataire (déplacé de order_line_cancellations C6) : référence et produit à balises.
update products set name = jsonb_build_object('es', 'Kayak <b>&</b>') where id = t_id('31');
insert into orders (id, account_id, holder_name, holder_email, payment_status, reference)
  values (t_id('113'), t_id('22'), 'Ana & <i>Co</i>', 'impayees-113@test.local', 'paid', 'P7<113>&');
select t_line('213', '113', 'cancelled_by_client', 17000);
select t_cancel_mails('213');
select is(
  (select count(*)::int from notification_emails
    where related_id = t_id('213') and event_type = 'partner_order_line_cancelled'
      and subject = 'Reserva anulada: Kayak <b>&</b>'
      and strpos(body_html, 'Se anuló «Kayak &lt;b&gt;&amp;&lt;/b&gt;»') > 0
      and strpos(body_html, 'reserva <strong>P7&lt;113&gt;&amp;</strong>') > 0
      and strpos(body_html, 'Kayak <b>') = 0 and strpos(body_html, 'P7<113>') = 0),
  1, 'E6 : e-mail prestataire d''une commande payée : produit et référence échappés, sujet en texte brut');
select is(t_cancel_mails('207'), jsonb_build_object('client', 1, 'prestataire', 0),
  'E5 : ligne expirée avec acompte d''une commande jamais payée annulée à la main : le prestataire n''est pas prévenu');

-- Colonnes rendues INCHANGÉES (aucune colonne de paiement ajoutée : le prestataire n'a pas à la connaître).
select is(
  (select string_agg(a.n, ', ' order by a.n)
     from pg_proc p, unnest(p.proargnames, p.proargmodes) as a(n, m)
    where p.oid = 'public.partner_agenda_order_lines'::regproc and a.m = 't'),
  'date, end_date, holder_name, id, product_duration_days, product_id, product_name, product_type, qty, slot_start_time, status',
  'C1 : les colonnes de l''agenda sont inchangées');
-- Le prestataire d'un AUTRE établissement ne voit toujours rien d'ici (règle de capacité intacte).
select * from finish();
rollback;

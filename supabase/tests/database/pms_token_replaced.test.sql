-- Époque du jeton Lobby (migration 20261004005336) : un booking posé avec un jeton depuis remplacé
-- n'est plus jamais interrogé ni annulé avec le jeton courant.
--
-- CE QUE CE FICHIER DOIT PROUVER :
--   - l'époque ne change que sur un remplacement RÉEL d'un autre compte : ni un premier jeton, ni le
--     même jeton recollé, ni un champ vide, ni une bascule du connecteur, ni une rotation déclarée sur
--     le même compte (dont les annulations en attente partent normalement) ; elle est lue à l'horloge
--     et survit aux enregistrements suivants de l'écran (jeton absent, bascule) ;
--   - une entrée de réconciliation par booking vivant ancien — un booking = (commande, établissement,
--     numéro) —, sur sa plus petite ligne ; aucune pour une ligne morte, une ligne sans booking, un
--     autre établissement ; aucune en double tant que la précédente est ouverte, même déplacée vers
--     une ligne de remplacement (modify_order_line) ;
--   - ces entrées sont muettes ; UN récapitulatif par remplacement, échappé, à chaque admin actif
--     (annulations seules comprises), et aucun quand rien n'est touché ; l'audit compte ;
--   - claim_pms_poll_batch ne rend ni ne marque jamais une ligne ancienne (sœurs comprises), qui ne
--     prend jamais la place des autres dans un lot ;
--   - claim_pms_cancellation_batch fait échouer, sans la rendre, l'annulation d'un booking ancien, et
--     ne touche à aucune annulation close ;
--   - record_pms_booking date le booking (claimed_at) ; un booking ancien reçoit son entrée muette,
--     ou entre en file directement en échec (surnuméraire, claim périmé, ligne morte) ;
--   - un claim fait après un remplacement est daté après lui (jamais classé ancien) ;
--   - apply_pms_poll_outcome refuse un booking ancien sans rien bouger ;
--   - droits : la nouvelle signature, jamais anon ; l'époque illisible côté client.
-- ⚠️ `now()` est constant dans la transaction ; l'époque, elle, est lue à l'horloge (clock_timestamp).
begin;
select plan(32);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email) values
  ('6b100000-0000-4000-8000-000000000001', 'token-epoch-buyer@test.local'),
  ('6b100000-0000-4000-8000-000000000002', 'token-epoch-admin@test.local');
insert into partner_capabilities (account_id, role, source, status) values
  ('6b100000-0000-4000-8000-000000000002', 'admin', 'migration', 'active');
insert into partners (id, display_name) values ('6b100000-0000-4000-8000-000000000003', 'Token Epoch Owner');
-- E1 : remplacé trois fois ; E2 : jamais remplacé (recollé, vidé, basculé) ; E3 : rotation déclarée
-- sur le même compte ; E4 : sans jeton, reçoit son premier, puis remplacé ; E5 : seulement une
-- annulation en attente.
insert into establishments (id, partner_id, name, lobby_connector_active, lobby_api_token) values
  ('6b100000-0000-4000-8000-000000000011', '6b100000-0000-4000-8000-000000000003', jsonb_build_object('es', 'Época <b>uno</b> & co'), true, 'tok-e1-a'),
  ('6b100000-0000-4000-8000-000000000012', '6b100000-0000-4000-8000-000000000003', jsonb_build_object('es', 'Época dos'), true, 'tok-e2'),
  ('6b100000-0000-4000-8000-000000000013', '6b100000-0000-4000-8000-000000000003', jsonb_build_object('es', 'Época tres'), true, 'tok-e3-a'),
  ('6b100000-0000-4000-8000-000000000014', '6b100000-0000-4000-8000-000000000003', jsonb_build_object('es', 'Época cuatro'), false, null),
  ('6b100000-0000-4000-8000-000000000015', '6b100000-0000-4000-8000-000000000003', jsonb_build_object('es', 'Época cinco'), true, 'tok-e5-a');
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, lobby_category_id) values
  ('6b100000-0000-4000-8000-000000000021', '6b100000-0000-4000-8000-000000000003', '6b100000-0000-4000-8000-000000000011',
   'lodging', jsonb_build_object('es', 'TE Noche uno'), 100000, true, 'te-noche-uno', 9951),
  ('6b100000-0000-4000-8000-000000000022', '6b100000-0000-4000-8000-000000000003', '6b100000-0000-4000-8000-000000000011',
   'activity', jsonb_build_object('es', 'TE Actividad uno'), 50000, true, 'te-actividad-uno', null),
  ('6b100000-0000-4000-8000-000000000023', '6b100000-0000-4000-8000-000000000003', '6b100000-0000-4000-8000-000000000012',
   'lodging', jsonb_build_object('es', 'TE Noche dos'), 100000, true, 'te-noche-dos', 9952),
  ('6b100000-0000-4000-8000-000000000024', '6b100000-0000-4000-8000-000000000003', '6b100000-0000-4000-8000-000000000013',
   'lodging', jsonb_build_object('es', 'TE Noche tres'), 100000, true, 'te-noche-tres', 9953),
  ('6b100000-0000-4000-8000-000000000025', '6b100000-0000-4000-8000-000000000003', '6b100000-0000-4000-8000-000000000014',
   'lodging', jsonb_build_object('es', 'TE Noche cuatro'), 100000, true, 'te-noche-cuatro', 9954);
insert into orders (id, account_id, holder_name, holder_email, payment_status, reference, pms_reserve_claimed_at) values
  ('6b100000-0000-4000-8000-000000000031', '6b100000-0000-4000-8000-000000000001', 'TE', 'token-epoch-buyer@test.local', 'paid', 'TE-31', null),
  ('6b100000-0000-4000-8000-000000000032', '6b100000-0000-4000-8000-000000000001', 'TE', 'token-epoch-buyer@test.local', 'paid', 'TE-32', null),
  -- 33 : un claim lu AVANT tous les remplacements, dont la route enregistre les bookings après.
  ('6b100000-0000-4000-8000-000000000033', '6b100000-0000-4000-8000-000000000001', 'TE', 'token-epoch-buyer@test.local', 'unpaid', 'TE-33', '2026-01-01 00:00+00'),
  ('6b100000-0000-4000-8000-000000000035', '6b100000-0000-4000-8000-000000000001', 'TE', 'token-epoch-buyer@test.local', 'paid', 'TE-35', null),
  -- 36 : réservée APRÈS les remplacements ; 37 : un autre booking d'E1 sous le même numéro que 31.
  ('6b100000-0000-4000-8000-000000000036', '6b100000-0000-4000-8000-000000000001', 'TE', 'token-epoch-buyer@test.local', 'unpaid', 'TE-36', null),
  ('6b100000-0000-4000-8000-000000000037', '6b100000-0000-4000-8000-000000000001', 'TE', 'token-epoch-buyer@test.local', 'paid', 'TE-37', null);

create function te_line(p_id text, p_order text, p_product text, p_status text, p_booking text,
                        p_booked_at timestamptz, p_created_at timestamptz default now()) returns void
language sql as $$
  insert into order_lines (
    id, order_id, account_id, product_id, date, end_date, qty, status, holder_name,
    price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
    acompte_cop, referrer_commission_cop, app_commission_cop, pms_booking_id, pms_booked_at, created_at,
    pms_last_polled_at
  ) values (
    ('6b100000-0000-4000-8000-0000000000' || p_id)::uuid, ('6b100000-0000-4000-8000-0000000000' || p_order)::uuid,
    '6b100000-0000-4000-8000-000000000001', ('6b100000-0000-4000-8000-0000000000' || p_product)::uuid,
    '2029-09-01', case when p_product in ('21', '23', '24', '25') then '2029-09-03'::date end, 1, p_status, 'TE',
    100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000, p_booking, p_booked_at, p_created_at,
    case when p_booking is not null then '2000-01-01'::timestamptz end
  );
$$;
-- 31 / E1 : TE-B1 = une nuit et une activité ; TE-B2 = une nuit sans date de booking (antérieure à la
-- migration : created_at fait foi) ; TE-B3 = une ligne morte ; 53 = une nuit sans booking (elle
-- recevra une entrée déplacée, comme le fait modify_order_line) ; 54 = TE-B1 chez E4 (même commande,
-- même numéro, autre compte). 32 / E2 : TE-B4.
-- 35 / E3 : TE-B6. 33, 36 : des lignes à réserver, déjà là au moment des remplacements.
select te_line('41', '31', '21', 'reserved', 'TE-B1', '2026-01-01');
select te_line('42', '31', '22', 'reserved', 'TE-B1', '2026-01-01');
select te_line('43', '31', '21', 'reserved', 'TE-B2', null, now() - interval '1 day');
select te_line('44', '31', '21', 'cancelled_by_client', 'TE-B3', '2026-01-01');
select te_line('45', '32', '23', 'reserved', 'TE-B4', '2026-01-01');
select te_line('46', '35', '24', 'reserved', 'TE-B6', '2026-01-01');
select te_line('53', '31', '21', 'reserved', null, null);
select te_line('54', '31', '25', 'reserved', 'TE-B1', '2026-01-01');
select te_line('61', '33', '21', 'reserved', null, null);
select te_line('62', '33', '22', 'reserved', null, null);
select te_line('63', '33', '21', 'expired', null, null);
select te_line('65', '33', '25', 'reserved', null, null);
select te_line('67', '36', '21', 'reserved', null, null);
select te_line('68', '33', '21', 'reserved', null, null);
insert into pms_cancellation_queue (pms_booking_id, establishment_id, hifago_status, status) values
  ('TE-Q5', '6b100000-0000-4000-8000-000000000011', 'expired', 'pending'),
  ('TE-Q6', '6b100000-0000-4000-8000-000000000013', 'expired', 'pending'),
  ('TE-Q7', '6b100000-0000-4000-8000-000000000015', 'expired', 'pending'),
  -- L'annulation de TE-B3 (booking ancien) a déjà réussi : rien ne doit la rouvrir.
  ('TE-B3', '6b100000-0000-4000-8000-000000000011', 'cancelled_by_client', 'done');

-- Les entrées de la classe ; le booking est lu dans le detail (une entrée déplacée vers une ligne
-- sans booking le garde).
create temp view te_class as
  select r.id, r.order_line_id, r.status, r.detail, ol.order_id, p.establishment_id,
         substring(r.detail from ' : booking Lobby (\S+) posé ') as booking
    from pms_reconciliation_entries r
    join order_lines ol on ol.id = r.order_line_id
    join products p on p.id = ol.product_id
   where ol.id::text like '6b100000-%' and r.detail like 'jeton Lobby remplacé%';
create temp view te_recap as
  select subject, body_html, related_id from notification_emails
   where event_type = 'admin_new_reconciliation_exception' and related_table = 'establishments'
     and recipient_email = 'token-epoch-admin@test.local';

-- ── Quand l'époque change ────────────────────────────────────────────────────────────────────
select test_login('6b100000-0000-4000-8000-000000000002');
set local role authenticated;
select set_establishment_pms_connector('6b100000-0000-4000-8000-000000000014', 'tok-e4', true, 'premier jeton');
select set_establishment_pms_connector('6b100000-0000-4000-8000-000000000012', E'  tok-e2 \t', true, 'même jeton recollé');
select set_establishment_pms_connector('6b100000-0000-4000-8000-000000000012', '   ', true, 'champ vide');
select set_establishment_pms_connector('6b100000-0000-4000-8000-000000000012', null, false, 'connecteur coupé');
select set_establishment_pms_connector('6b100000-0000-4000-8000-000000000012', null, true, 'connecteur réactivé');
select set_establishment_pms_connector('6b100000-0000-4000-8000-000000000013', 'tok-e3-b', true, 'rotation', p_same_lobby_account => true);
reset role;
select is(
  (select jsonb_build_object(
     'epoques', (select jsonb_agg(lobby_token_changed_at order by id) from establishments
                  where id in ('6b100000-0000-4000-8000-000000000012', '6b100000-0000-4000-8000-000000000013', '6b100000-0000-4000-8000-000000000014')),
     'jeton_e3', (select lobby_api_token from establishments where id = '6b100000-0000-4000-8000-000000000013'),
     'file_e3', (select status from pms_cancellation_queue where pms_booking_id = 'TE-Q6'),
     'entrees', (select count(*) from te_class))),
  jsonb_build_object('epoques', jsonb_build_array(null, null, null), 'jeton_e3', 'tok-e3-b', 'file_e3', 'pending', 'entrees', 0),
  'P1 : premier jeton, même jeton recollé, champ vide, bascule, rotation sur le même compte → aucune époque, l''annulation en attente de la rotation reste en attente');
select is(
  (select after - 'connector_active' - 'token_replaced' from audit_log
    where action = 'establishment.set_pms_connector' and entity_id = '6b100000-0000-4000-8000-000000000013'),
  jsonb_build_object('same_lobby_account', true, 'token_epoch_bumped', false, 'reconciliation_entries', 0, 'cancellations_failed', 0),
  'P1b : le journal d''audit dit la rotation déclarée sur le même compte, sans changement d''époque');

-- ── Remplacement n°1 d'E1 ────────────────────────────────────────────────────────────────────
-- Les admins actifs, figés juste avant : le récapitulatif doit partir à chacun, une fois.
create temp table te_admins as
  select au.email::text as email from partner_capabilities pc join auth.users au on au.id = pc.account_id
   where pc.role = 'admin' and pc.status = 'active';
set local role authenticated;
select set_establishment_pms_connector('6b100000-0000-4000-8000-000000000011', 'tok-e1-b', true, 'nouveau compte Lobby');
reset role;
select ok((select lobby_token_changed_at > now() from establishments where id = '6b100000-0000-4000-8000-000000000011'),
  'P2a : l''époque est lue à l''horloge, après le début de la transaction (jamais now())');
select is(
  (select jsonb_agg(jsonb_build_object('ligne', right(order_line_id::text, 2), 'commande', right(order_id::text, 2), 'booking', booking)
                    order by order_line_id)
     from te_class where establishment_id = '6b100000-0000-4000-8000-000000000011'),
  jsonb_build_array(jsonb_build_object('ligne', '41', 'commande', '31', 'booking', 'TE-B1'),
                    jsonb_build_object('ligne', '43', 'commande', '31', 'booking', 'TE-B2')),
  'P2b : une entrée par booking vivant ancien (commande et numéro), sur sa plus petite ligne — ni la ligne morte, ni E2, E3, E4');
select ok((select bool_and(detail like 'jeton Lobby remplacé le % (heure de Colombie) : booking Lobby TE-B_ posé avec l''ancien jeton, %commande TE-3_')
             from te_class),
  'P2c : le détail dit l''instant, le booking et la commande');
select is((select count(*)::int from pms_reconciliation_entries r join order_lines ol on ol.id = r.order_line_id
            where ol.id::text like '6b100000-%'), 2,
  'P2d : aucune entrée sur une ligne sans booking (en cours de réservation)');
select is(
  (select after from audit_log where action = 'establishment.set_pms_connector' and note = 'nouveau compte Lobby'),
  jsonb_build_object('connector_active', true, 'token_replaced', true, 'same_lobby_account', false, 'token_epoch_bumped', true,
                     'reconciliation_entries', 2, 'cancellations_failed', 1),
  'P2e : le journal d''audit compte les bookings et les annulations touchés');
select is((select count(*)::int from notification_emails where related_table = 'pms_reconciliation_entries'
            and related_id in (select id from te_class)), 0,
  'P4a : les entrées du remplacement sont muettes');
select is((select subject from te_recap where subject like '%Época <b>uno</b>%'),
  'Token de Lobby reemplazado: 2 reserva(s) por verificar — Época <b>uno</b> & co',
  'P4b : UN récapitulatif à l''admin, qui compte les bookings');
select ok((select strpos(body_html, 'Se reemplazó el token de Lobby de Época &lt;b&gt;uno&lt;/b&gt; &amp; co. 2 reserva(s) hechas con el token anterior') > 0
                  and strpos(body_html, ', y 1 cancelación(es) pendientes quedaron en error.') > 0
                  and related_id is null
             from te_recap where subject like '%Época <b>uno</b>%'),
  'P4c : le récapitulatif échappe le nom, compte les annulations en échec, sans related_id (jamais dédupliqué)');
select bag_eq(
  $$ select recipient_email::text from notification_emails
      where event_type = 'admin_new_reconciliation_exception' and related_table = 'establishments' and subject like '%Época <b>uno</b>%' $$,
  $$ select email from te_admins $$,
  'P4d : un récapitulatif par admin actif');

-- ── E4 (même commande et même numéro qu'une entrée ouverte d'E1) ; E5 (annulations seules) ──
set local role authenticated;
select set_establishment_pms_connector('6b100000-0000-4000-8000-000000000014', 'tok-e4-b', true, 'autre compte E4');
select set_establishment_pms_connector('6b100000-0000-4000-8000-000000000015', 'tok-e5-b', true, 'autre compte E5');
reset role;
select is((select array_agg(right(order_line_id::text, 2)) from te_class where establishment_id = '6b100000-0000-4000-8000-000000000014'),
  array['54'],
  'P2f : un booking est propre à son établissement — l''entrée ouverte d''E1 sous le même numéro n''en dispense pas E4');
select ok((select subject = 'Token de Lobby reemplazado: 0 reserva(s) por verificar — Época cinco'
                  and strpos(body_html, '. 0 reserva(s) hechas') > 0 and strpos(body_html, ', y 1 cancelación(es) pendientes') > 0
             from te_recap where subject like '%Época cinco%'),
  'P4e : des annulations seules suffisent au récapitulatif');

-- ── Remplacement n°2 : rien de neuf à signaler ───────────────────────────────────────────────
-- L'entrée de TE-B1 (commande 31) passe sur une ligne sans booking, comme modify_order_line le fait
-- pour la ligne qu'il remplace.
update pms_reconciliation_entries set order_line_id = '6b100000-0000-4000-8000-000000000053'
 where id = (select id from te_class where order_line_id = '6b100000-0000-4000-8000-000000000041');
set local role authenticated;
select set_establishment_pms_connector('6b100000-0000-4000-8000-000000000011', 'tok-e1-c', true, 'encore un autre compte');
reset role;
select is((select jsonb_build_object('entrees', (select count(*) from te_class),
                                     'recaps', (select count(*) from te_recap where subject like '%Época <b>uno</b>%'))),
  jsonb_build_object('entrees', 3, 'recaps', 1),
  'P3a : pas d''entrée en double tant que la précédente est ouverte, même déplacée ; aucun récapitulatif quand rien n''est touché');

-- ── Remplacement n°3 : TE-B2 clos ; un autre booking TE-B1 (commande 37), posé entre-temps ──
update pms_reconciliation_entries set status = 'resolved' where id = (select id from te_class where booking = 'TE-B2');
select te_line('52', '37', '21', 'reserved', 'TE-B1', clock_timestamp());
set local role authenticated;
select set_establishment_pms_connector('6b100000-0000-4000-8000-000000000011', 'tok-e1-d', true, 'troisième compte');
reset role;
select is(
  (select jsonb_agg(jsonb_build_object('commande', right(order_id::text, 2), 'booking', booking, 'statut', status) order by order_id, booking, status)
     from te_class where establishment_id = '6b100000-0000-4000-8000-000000000011'),
  jsonb_build_array(jsonb_build_object('commande', '31', 'booking', 'TE-B1', 'statut', 'open'),
                    jsonb_build_object('commande', '31', 'booking', 'TE-B2', 'statut', 'open'),
                    jsonb_build_object('commande', '31', 'booking', 'TE-B2', 'statut', 'resolved'),
                    jsonb_build_object('commande', '37', 'booking', 'TE-B1', 'statut', 'open')),
  'P3b : une entrée close n''empêche pas la suivante ; un booking est propre à sa commande (l''entrée ouverte de TE-B1/31 n''en dispense pas TE-B1/37) ; rien n''est redoublé');

-- ── L'écran enregistre sans jeton, ou bascule le connecteur : l'époque reste ─────────────────
create temp table te_epoque as select lobby_token_changed_at as t from establishments where id = '6b100000-0000-4000-8000-000000000011';
set local role authenticated;
select set_establishment_pms_connector('6b100000-0000-4000-8000-000000000011', null, false, 'coupé');
select set_establishment_pms_connector('6b100000-0000-4000-8000-000000000011', ' tok-e1-d ', true, 'recollé');
reset role;
select is(
  (select jsonb_build_object('epoque_gardee', e.lobby_token_changed_at = t.t, 'jeton', e.lobby_api_token, 'actif', e.lobby_connector_active)
     from establishments e, te_epoque t where e.id = '6b100000-0000-4000-8000-000000000011'),
  jsonb_build_object('epoque_gardee', true, 'jeton', 'tok-e1-d', 'actif', true),
  'P1c : un enregistrement sans jeton, une bascule, le même jeton recollé : l''époque reste');

-- ── claim_pms_poll_batch ─────────────────────────────────────────────────────────────────────
-- TE-B7 : posé après le remplacement. TE-B8 : une nuit nouvelle et une activité sans date de booking,
-- créée la veille (ancienne). Les lignes d'autres données passent derrière les nôtres (rendu au
-- rollback) : le test ne dépend pas de ce que la base contient.
select te_line('47', '31', '21', 'reserved', 'TE-B7', clock_timestamp());
select te_line('48', '31', '21', 'reserved', 'TE-B8', clock_timestamp());
select te_line('49', '31', '22', 'reserved', 'TE-B8', null, now() - interval '1 day');
update order_lines set pms_last_polled_at = 'infinity'
 where pms_booking_id is not null and status = 'reserved' and id::text not like '6b100000-%';
create temp table p5 as select * from claim_pms_poll_batch(1000) where order_line_id::text like '6b100000-%';
select is(
  (select array_agg(right(order_line_id::text, 2) || ':' || lobby_api_token order by order_line_id) from p5),
  array['45:tok-e2', '46:tok-e3-b', '47:tok-e1-d', '48:tok-e1-d'],
  'P5a : une ligne ancienne n''est jamais rendue ; E2 jamais remplacé et E3 en rotation déclarée, si');
select is(
  (select array_agg(right(id::text, 2) order by id) from order_lines
    where id::text like '6b100000-%' and pms_last_polled_at = '2000-01-01'),
  array['41', '42', '43', '44', '49', '52', '54'],
  'P5b : ni une ligne ancienne ni une sœur ancienne ne sont marquées interrogées');
-- Jamais interrogées, les lignes anciennes restent en tête de l'ordre du claim : sans le filtre des
-- candidates, elles rempliraient chaque lot à elles seules, et plus aucune ligne ne serait interrogée.
select is((select count(*)::int from claim_pms_poll_batch(2) where order_line_id::text like '6b100000-%'), 2,
  'P5c : les lignes anciennes ne prennent jamais la place des autres dans un lot');

-- ── claim_pms_cancellation_batch ─────────────────────────────────────────────────────────────
-- TE-B2 (ancien), TE-B10 (posé après le remplacement) et TE-B4 (E2) partent en annulation.
select te_line('50', '31', '21', 'reserved', 'TE-B10', clock_timestamp());
update order_lines set status = 'cancelled_by_client'
 where id in ('6b100000-0000-4000-8000-000000000043', '6b100000-0000-4000-8000-000000000050', '6b100000-0000-4000-8000-000000000045');
create temp table p6 as select * from claim_pms_cancellation_batch(1000, 3) c where c.pms_booking_id like 'TE-%';
select is(
  (select array_agg(pms_booking_id || ':' || lobby_api_token order by pms_booking_id) from p6),
  array['TE-B10:tok-e1-d', 'TE-B4:tok-e2', 'TE-Q6:tok-e3-b'],
  'P6a : l''annulation d''un booking ancien n''est jamais rendue ; les autres partent avec le jeton courant');
select is(
  (select status || ' / ' || last_error from pms_cancellation_queue where pms_booking_id = 'TE-B2'),
  'failed / jeton Lobby remplacé : annulation à vérifier à la main avant tout renvoi',
  'P6b : elle passe en échec, avec le motif, pour la vérification manuelle');
select is((select status from pms_cancellation_queue where pms_booking_id = 'TE-B3'), 'done',
  'P6c : une annulation déjà réussie d''un booking ancien reste close');

-- ── record_pms_booking ───────────────────────────────────────────────────────────────────────
-- Commande 33 : claim lu avant les remplacements. Commande 34 : claim lu après.
insert into orders (id, account_id, holder_name, holder_email, payment_status, reference, pms_reserve_claimed_at) values
  ('6b100000-0000-4000-8000-000000000034', '6b100000-0000-4000-8000-000000000001', 'TE', 'token-epoch-buyer@test.local', 'unpaid', 'TE-34', clock_timestamp());
select te_line('64', '34', '21', 'reserved', null, null);
create temp table p7 (n int, r jsonb);
insert into p7 select 1, record_pms_booking('6b100000-0000-4000-8000-000000000033', '2026-01-01 00:00+00', '6b100000-0000-4000-8000-000000000061', 'TE-B61');
insert into p7 select 2, record_pms_booking('6b100000-0000-4000-8000-000000000033', '2026-01-01 00:00+00', '6b100000-0000-4000-8000-000000000062', 'TE-B61');
insert into p7 select 3, record_pms_booking('6b100000-0000-4000-8000-000000000033', '2026-01-01 00:00+00', '6b100000-0000-4000-8000-000000000061', 'TE-B61');
insert into p7 select 4, record_pms_booking('6b100000-0000-4000-8000-000000000033', '2026-01-01 00:00+00', '6b100000-0000-4000-8000-000000000061', 'TE-B62');
insert into p7 select 5, record_pms_booking('6b100000-0000-4000-8000-000000000033', '2026-01-01 00:00+00', '6b100000-0000-4000-8000-000000000063', 'TE-B63');
insert into p7 select 6, record_pms_booking('6b100000-0000-4000-8000-000000000034',
  (select pms_reserve_claimed_at from orders where id = '6b100000-0000-4000-8000-000000000034'), '6b100000-0000-4000-8000-000000000064', 'TE-B64');
insert into p7 select 7, record_pms_booking('6b100000-0000-4000-8000-000000000034',
  (select pms_reserve_claimed_at from orders where id = '6b100000-0000-4000-8000-000000000034'), '6b100000-0000-4000-8000-000000000064', 'TE-B65');
-- Un claim périmé (bail repris après le remplacement) qui avait lu l'ancien jeton.
insert into p7 select 8, record_pms_booking('6b100000-0000-4000-8000-000000000034', '2026-01-01 00:00+00', '6b100000-0000-4000-8000-000000000064', 'TE-B66');
-- Le même numéro chez E4, dans la même commande que l'entrée ouverte d'E1.
insert into p7 select 9, record_pms_booking('6b100000-0000-4000-8000-000000000033', '2026-01-01 00:00+00', '6b100000-0000-4000-8000-000000000065', 'TE-B61');
-- Le numéro d'un booking ouvert d'une AUTRE commande du même établissement (TE-B1, commande 31).
insert into p7 select 10, record_pms_booking('6b100000-0000-4000-8000-000000000033', '2026-01-01 00:00+00', '6b100000-0000-4000-8000-000000000068', 'TE-B1');
select is(
  (select jsonb_agg(r order by n) from p7),
  jsonb_build_array(jsonb_build_object('ok', true), jsonb_build_object('ok', true), jsonb_build_object('ok', true, 'idempotent', true),
                    jsonb_build_object('ok', false, 'reason', 'already_booked'), jsonb_build_object('ok', false, 'reason', 'line_not_reserved'),
                    jsonb_build_object('ok', true), jsonb_build_object('ok', false, 'reason', 'already_booked'),
                    jsonb_build_object('ok', false, 'reason', 'claim_stale'), jsonb_build_object('ok', true), jsonb_build_object('ok', true)),
  'P7a : les retours de record_pms_booking ne changent pas');
select ok(
  (select bool_and(pms_booked_at = '2026-01-01 00:00+00') from order_lines
    where id in ('6b100000-0000-4000-8000-000000000061', '6b100000-0000-4000-8000-000000000062',
                 '6b100000-0000-4000-8000-000000000063', '6b100000-0000-4000-8000-000000000065',
                 '6b100000-0000-4000-8000-000000000068'))
  and (select ol.pms_booked_at = o.pms_reserve_claimed_at from order_lines ol join orders o on o.id = ol.order_id
        where ol.id = '6b100000-0000-4000-8000-000000000064'),
  'P7b : le booking est daté par l''instant du claim, ligne vivante ou morte');
select is(
  (select jsonb_build_object(
     'TE-B61@E1', (select count(*) from te_class where booking = 'TE-B61' and establishment_id = '6b100000-0000-4000-8000-000000000011'),
     'TE-B61@E4', (select count(*) from te_class where booking = 'TE-B61' and establishment_id = '6b100000-0000-4000-8000-000000000014'),
     'TE-B1/33', (select count(*) from te_class where booking = 'TE-B1' and order_id = '6b100000-0000-4000-8000-000000000033'),
     'TE-B64', (select count(*) from te_class where booking = 'TE-B64'))),
  jsonb_build_object('TE-B61@E1', 1, 'TE-B61@E4', 1, 'TE-B1/33', 1, 'TE-B64', 0),
  'P7c : un booking posé avec un jeton remplacé depuis le claim reçoit UNE entrée (nuit et activité), par établissement et par commande ; un booking nouveau, aucune');
select is(
  (select jsonb_object_agg(pms_booking_id, s) from (
     select pms_booking_id, string_agg(status || coalesce(':' || left(last_error, 20), ''), ',' order by status) as s
       from pms_cancellation_queue where pms_booking_id in ('TE-B62', 'TE-B63', 'TE-B65', 'TE-B66') group by 1) q),
  jsonb_build_object('TE-B62', 'failed:jeton Lobby remplacé', 'TE-B63', 'failed:jeton Lobby remplacé',
                     'TE-B65', 'pending', 'TE-B66', 'failed:jeton Lobby remplacé'),
  'P7d : un booking ancien surnuméraire, d''un claim périmé ou sur une ligne morte entre en file directement en échec (une fois) ; un nouveau, en attente');

-- ── Un claim fait après le remplacement : daté après lui ─────────────────────────────────────
create temp table p7e as select claim_order_for_pms_booking('6b100000-0000-4000-8000-000000000036') as r;
insert into p7 select 11, record_pms_booking('6b100000-0000-4000-8000-000000000036',
  (select (r ->> 'claimed_at')::timestamptz from p7e), '6b100000-0000-4000-8000-000000000067', 'TE-B67');
select is(
  (select jsonb_build_object(
     'jeton', r -> 'groups' -> 0 ->> 'api_token',
     'apres_epoque', (r ->> 'claimed_at')::timestamptz > (select lobby_token_changed_at from establishments where id = '6b100000-0000-4000-8000-000000000011'),
     'record', (select r from p7 where n = 11),
     'entrees', (select count(*) from te_class where booking = 'TE-B67'))
     from p7e),
  jsonb_build_object('jeton', 'tok-e1-d', 'apres_epoque', true, 'record', jsonb_build_object('ok', true), 'entrees', 0),
  'P7e : un claim qui lit le nouveau jeton est daté après l''époque (now() de sa transaction la précède) — son booking n''est jamais classé ancien');

-- ── apply_pms_poll_outcome ───────────────────────────────────────────────────────────────────
create temp table p8 (n int, r jsonb);
insert into p8 select 1, apply_pms_poll_outcome('6b100000-0000-4000-8000-000000000041', 'gone', 'test');
insert into p8 select 2, apply_pms_poll_outcome('6b100000-0000-4000-8000-000000000041', 'realized', null);
insert into p8 select 3, apply_pms_poll_outcome('6b100000-0000-4000-8000-000000000048', 'gone', 'test');
select is(
  (select jsonb_agg(r order by n) from p8),
  jsonb_build_array(jsonb_build_object('ok', false, 'reason', 'token_replaced'), jsonb_build_object('ok', false, 'reason', 'token_replaced'),
                    jsonb_build_object('ok', false, 'reason', 'token_replaced')),
  'P8a : une issue du poll n''est jamais appliquée à un booking ancien, ni à un booking dont une sœur l''est');
select is(
  (select jsonb_build_object(
     'vivantes', (select array_agg(right(id::text, 2) order by id) from order_lines
                   where id in ('6b100000-0000-4000-8000-000000000041', '6b100000-0000-4000-8000-000000000042',
                                '6b100000-0000-4000-8000-000000000048', '6b100000-0000-4000-8000-000000000049') and status = 'reserved'),
     'entrees', (select count(*) from pms_reconciliation_entries r join order_lines ol on ol.id = r.order_line_id
                  where ol.id::text like '6b100000-%' and r.detail not like 'jeton Lobby remplacé%'))),
  jsonb_build_object('vivantes', array['41', '42', '48', '49'], 'entrees', 0),
  'P8b : rien ne bouge — lignes réservées, aucune entrée « introuvable »');

-- ── Droits ───────────────────────────────────────────────────────────────────────────────────
select ok(
  not has_function_privilege('anon', 'public.set_establishment_pms_connector(uuid, text, boolean, text, boolean)', 'execute')
  and has_function_privilege('authenticated', 'public.set_establishment_pms_connector(uuid, text, boolean, text, boolean)', 'execute')
  and to_regprocedure('public.set_establishment_pms_connector(uuid, text, boolean, text)') is null,
  'P9 : la nouvelle signature remplace l''ancienne, exécutable par authenticated (contrôle admin interne), jamais par anon');
select ok(
  not has_column_privilege('authenticated', 'public.establishments', 'lobby_token_changed_at', 'select')
  and not has_column_privilege('anon', 'public.establishments', 'lobby_token_changed_at', 'select')
  and not has_column_privilege('authenticated', 'public.establishments', 'lobby_api_token', 'select'),
  'P10 : ni l''instant du remplacement ni le jeton ne sont lisibles côté client (la lecture publique d''establishments les ouvrirait)');
select is(
  (select count(*)::int from notification_emails where related_table = 'pms_reconciliation_entries'
    and related_id in (select id from te_class)), 0,
  'P11 : aucune entrée « jeton Lobby remplacé » n''a produit d''e-mail, record_pms_booking compris');

select * from finish();
rollback;

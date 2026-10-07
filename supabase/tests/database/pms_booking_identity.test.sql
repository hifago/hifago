-- Identité d'un booking LobbyPMS : (numéro, établissement) — migration 20261006235357.
-- Deux établissements (deux comptes Lobby) portent le même numéro. Chaque chemin qui enfile,
-- contrôle ou lit la file d'annulation ne doit voir que les lignes de SON établissement :
--   - trigger enqueue_pms_cancellations (annulation d'une ligne) ;
--   - index pms_cancellation_queue_pending_uniq (deux entrées en attente, une par établissement) ;
--   - release_order_after_pms_refusal, record_pms_booking (booking surnuméraire, jeton remplacé) ;
--   - resolve_pms_cancellation (plage du miroir à resynchroniser) ;
--   - notify_order_line_cancelled (la phrase LobbyPMS de l'e-mail au prestataire).
-- Fixtures en SQL direct : ce fichier tourne en tant que postgres.
begin;
select plan(11);

insert into auth.users (id, email) values
  ('7d700000-0000-4000-8000-000000000031', 'p7d-client@test.local'),
  ('7d700000-0000-4000-8000-000000000032', 'p7d-partner@test.local');
insert into partners (id, display_name) values ('7d700000-0000-4000-8000-000000000001', 'P7d Partner');
insert into partner_accounts (id, partner_id) values
  ('7d700000-0000-4000-8000-000000000032', '7d700000-0000-4000-8000-000000000001')
on conflict (id) do update set partner_id = excluded.partner_id;
-- A et B : deux comptes Lobby distincts. C : jeton remplacé APRÈS les réclamations de ce fichier.
insert into establishments (id, partner_id, name, slug, lobby_connector_active, lobby_api_token, lobby_token_changed_at) values
  ('7d700000-0000-4000-8000-000000000011', '7d700000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'P7d A'), 'p7d-a', true, 'tok-a', null),
  ('7d700000-0000-4000-8000-000000000012', '7d700000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'P7d B'), 'p7d-b', true, 'tok-b', null),
  ('7d700000-0000-4000-8000-000000000013', '7d700000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'P7d C'), 'p7d-c', true, 'tok-c', now() + interval '1 hour');
insert into products (id, partner_id, establishment_id, type, name, slug, price_cop, sellable, lobby_category_id) values
  ('7d700000-0000-4000-8000-000000000021', '7d700000-0000-4000-8000-000000000001', '7d700000-0000-4000-8000-000000000011',
   'lodging', jsonb_build_object('es', 'Noche A'), 'p7d-noche-a', 80000, true, 101),
  ('7d700000-0000-4000-8000-000000000022', '7d700000-0000-4000-8000-000000000001', '7d700000-0000-4000-8000-000000000012',
   'lodging', jsonb_build_object('es', 'Noche B'), 'p7d-noche-b', 80000, true, 102),
  ('7d700000-0000-4000-8000-000000000023', '7d700000-0000-4000-8000-000000000001', '7d700000-0000-4000-8000-000000000013',
   'lodging', jsonb_build_object('es', 'Noche C'), 'p7d-noche-c', 80000, true, 103),
  ('7d700000-0000-4000-8000-000000000024', '7d700000-0000-4000-8000-000000000001', '7d700000-0000-4000-8000-000000000011',
   'activity', jsonb_build_object('es', 'Tour A'), 'p7d-tour-a', 30000, true, null);

insert into orders (id, account_id, holder_name, holder_email, payment_status, reference, pms_reserve_claimed_at)
select ('7d700000-0000-4000-8000-0000000000' || n)::uuid, '7d700000-0000-4000-8000-000000000031', 'P7d',
       'p7d-' || n || '@test.local', 'unpaid', 'P7D-' || n, now()
  from unnest(array['41', '42', '43', '44', '45', '46', '47', '48', '49', '50']) n;

create function p7d_line(p_id text, p_order text, p_product text, p_date date, p_booking text) returns void
language sql as $$
  insert into order_lines (
    id, order_id, account_id, product_id, date, end_date, qty, status, holder_name, pms_booking_id, pms_booked_at,
    price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
    acompte_cop, referrer_commission_cop, app_commission_cop
  ) values (
    ('7d700000-0000-4000-8000-0000000000' || p_id)::uuid, ('7d700000-0000-4000-8000-0000000000' || p_order)::uuid,
    '7d700000-0000-4000-8000-000000000031', ('7d700000-0000-4000-8000-0000000000' || p_product)::uuid,
    p_date, case when p_product <> '24' then p_date + 1 end, 1, 'reserved', 'P7d', p_booking, now(),
    80000, 80000, 'direct', 0.17, 0, 0.17, 13600, 0, 13600
  );
$$;
-- DUP-1 : A (janvier) et B (juin) ; DUP-2 : A (commande défaite par un refus) et B ;
-- DUP-3 / DUP-4 : B seul porte le numéro qu'un booking surnuméraire de A / de C reçoit ;
-- DUP-6 : une nuit et une activité de A, et une annulation de B déjà en attente ;
-- DUP-7 : A et B, annulés par UNE instruction ; DUP-8 : une commande sur A et B, défaite par un refus.
select p7d_line('51', '41', '21', '2029-01-10', 'DUP-1');
select p7d_line('52', '42', '22', '2029-06-10', 'DUP-1');
select p7d_line('53', '43', '21', '2029-02-10', 'DUP-2');
select p7d_line('54', '44', '22', '2029-02-10', 'DUP-2');
select p7d_line('55', '45', '21', '2029-03-10', 'OWN-5');
select p7d_line('56', '46', '22', '2029-03-10', 'DUP-3');
select p7d_line('57', '47', '23', '2029-04-10', 'OWN-7');
select p7d_line('58', '48', '22', '2029-04-10', 'DUP-4');
select p7d_line('59', '49', '21', '2029-05-10', 'DUP-6');
select p7d_line('60', '49', '24', '2029-05-10', 'DUP-6');
select p7d_line('61', '41', '21', '2029-07-10', 'DUP-7');
select p7d_line('62', '42', '22', '2029-07-10', 'DUP-7');
select p7d_line('63', '50', '21', '2029-08-10', 'DUP-8');
select p7d_line('64', '50', '22', '2029-08-10', 'DUP-8');
insert into pms_cancellation_queue (pms_booking_id, establishment_id, hifago_status) values
  ('DUP-6', '7d700000-0000-4000-8000-000000000012', 'cancelled_by_client');

-- Chaque appel dans SA propre instruction : une sous-requête de la même instruction ne verrait pas
-- ce que la fonction vient d'écrire (instantané pris au début de l'instruction).
create temp table r (k text primary key, res jsonb);
create temp view p7d_pending as
  select pms_booking_id, establishment_id, hifago_status from pms_cancellation_queue
   where status = 'pending' and pms_booking_id like 'DUP-%';

select ok(
  (select indexdef like '%(pms_booking_id, establishment_id)%WHERE (status = ''pending''::text)'
     from pg_indexes where indexname = 'pms_cancellation_queue_pending_uniq'),
  'l''index partiel des entrées en attente porte sur (numéro, établissement)'
);

-- ── Trigger : chaque établissement enfile SON booking ─────────────────────
update order_lines set status = 'cancelled_by_client' where id = '7d700000-0000-4000-8000-000000000051';
select is(
  (select count(*)::int from p7d_pending where pms_booking_id = 'DUP-1' and establishment_id = '7d700000-0000-4000-8000-000000000011'),
  1,
  'A annule sa dernière ligne de DUP-1 : enfilée, même si B réserve encore un DUP-1 chez son propre Lobby'
);
update order_lines set status = 'cancelled_by_client' where id = '7d700000-0000-4000-8000-000000000052';
select is(
  (select array_agg(substr(establishment_id::text, 35) order by establishment_id) from p7d_pending where pms_booking_id = 'DUP-1'),
  array['11', '12'],
  'puis B annule le sien : deux entrées en attente, une par établissement — aucune absorbée par l''index'
);

update order_lines set status = 'cancelled_by_provider'
 where id in ('7d700000-0000-4000-8000-000000000061', '7d700000-0000-4000-8000-000000000062');
select is(
  (select array_agg(substr(establishment_id::text, 35) order by establishment_id) from p7d_pending where pms_booking_id = 'DUP-7'),
  array['11', '12'],
  'une seule instruction annule DUP-7 chez A et chez B : deux entrées, une par établissement'
);

-- ── resolve_pms_cancellation : le miroir de CET établissement, sur SES dates ──
select resolve_pms_cancellation(
  (select id from pms_cancellation_queue where pms_booking_id = 'DUP-1' and establishment_id = '7d700000-0000-4000-8000-000000000011'),
  'done', 200, null);
select is(
  (select array_agg(month order by month) from pms_sync_state where establishment_id = '7d700000-0000-4000-8000-000000000011'),
  array['2029-01'],
  'annulation de A faite : seul le mois de A est à resynchroniser (jamais les dates de B)'
);

-- ── release_order_after_pms_refusal ────────────────────────────────────────
-- Son insertion EXPLICITE est éprouvée seule : le trigger, qui enfile déjà ces bookings, est
-- suspendu le temps de ces deux appels (verrou limité à la transaction de ce fichier).
alter table order_lines disable trigger order_lines_enqueue_pms_cancellation;
insert into r values ('refus_a', release_order_after_pms_refusal('7d700000-0000-4000-8000-000000000043', 'refus Lobby'));
insert into r values ('refus_ab', release_order_after_pms_refusal('7d700000-0000-4000-8000-000000000050', 'refus Lobby'));
alter table order_lines enable trigger order_lines_enqueue_pms_cancellation;
select is(
  jsonb_build_array(
    (select res ->> 'released_lines' from r where k = 'refus_a'),
    (select count(*)::int from p7d_pending where pms_booking_id = 'DUP-2' and establishment_id = '7d700000-0000-4000-8000-000000000011')),
  jsonb_build_array('1', 1),
  'refus Lobby sur la commande de A : DUP-2 part en annulation chez A, malgré la ligne vivante de B'
);
select is(
  jsonb_build_array(
    (select res ->> 'released_lines' from r where k = 'refus_ab'),
    (select array_agg(substr(establishment_id::text, 35) order by establishment_id) from p7d_pending where pms_booking_id = 'DUP-8')),
  jsonb_build_array('2', jsonb_build_array('11', '12')),
  'refus Lobby sur une commande à cheval sur A et B : DUP-8 part en annulation chez chacun'
);

-- ── record_pms_booking : booking surnuméraire ─────────────────────────────
insert into r values ('surnum_a', record_pms_booking('7d700000-0000-4000-8000-000000000045',
  (select pms_reserve_claimed_at from orders where id = '7d700000-0000-4000-8000-000000000045'),
  '7d700000-0000-4000-8000-000000000055', 'DUP-3'));
insert into r values ('surnum_c', record_pms_booking('7d700000-0000-4000-8000-000000000047',
  (select pms_reserve_claimed_at from orders where id = '7d700000-0000-4000-8000-000000000047'),
  '7d700000-0000-4000-8000-000000000057', 'DUP-4'));
select is(
  jsonb_build_object(
    'reason', (select res ->> 'reason' from r where k = 'surnum_a'),
    'file', (select jsonb_agg(jsonb_build_array(substr(establishment_id::text, 35), hifago_status)) from p7d_pending
              where pms_booking_id = 'DUP-3')),
  jsonb_build_object('reason', 'already_booked', 'file', jsonb_build_array(jsonb_build_array('11', 'superseded'))),
  'booking surnuméraire de A : en file chez A, même si B réserve un DUP-3'
);
select is(
  jsonb_build_object(
    'reason', (select res ->> 'reason' from r where k = 'surnum_c'),
    'echecs', (select count(*)::int from pms_cancellation_queue
                where pms_booking_id = 'DUP-4' and establishment_id = '7d700000-0000-4000-8000-000000000013'
                  and status = 'failed' and last_error like 'jeton Lobby remplacé%')),
  jsonb_build_object('reason', 'already_booked', 'echecs', 1),
  'jeton de C remplacé : le booking surnuméraire entre en file en échec chez C, même si B réserve un DUP-4'
);

-- ── notify_order_line_cancelled : la phrase dit les faits de CET établissement ──
update order_lines set status = 'cancelled_by_client' where id = '7d700000-0000-4000-8000-000000000060';
select is((select count(*)::int from p7d_pending where pms_booking_id = 'DUP-6' and establishment_id = '7d700000-0000-4000-8000-000000000011'),
  0, 'l''activité de A tombe, la nuit de A tient le booking : rien en file chez A');
select notify_order_line_cancelled('7d700000-0000-4000-8000-000000000060', 'client');
select is(
  (select count(*)::int from notification_emails
    where related_table = 'order_lines' and related_id = '7d700000-0000-4000-8000-000000000060'
      and event_type = 'partner_order_line_cancelled'
      and strpos(body_html, 'La reserva sigue activa en LobbyPMS') > 0
      and strpos(body_html, 'se transmite') = 0),
  1,
  'e-mail au prestataire : « sigue activa », jamais « se transmite » à cause de l''annulation de B'
);

select * from finish();
rollback;

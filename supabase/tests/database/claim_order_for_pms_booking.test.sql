-- Lobby avant paiement (migration 20260930221837) — claim_order_for_pms_booking, record_pms_booking,
-- release_pms_reserve_claim.
--
-- CE QUE CE FICHIER DOIT PROUVER :
--   - le claim refuse une commande payée (I3), un claim encore vivant (bail de 5 min), un logement
--     PMS dont le connecteur est coupé ou sans jeton (§4.4), et ne renvoie que ce qui est à
--     réserver chez Lobby ;
--   - record_pms_booking ne perd JAMAIS un booking : chaque booking surnuméraire (claim périmé, ligne
--     déjà bookée, ligne morte) part en file d'annulation — y compris connecteur coupé (amendement
--     du 30/09) — et un booking porté par une ligne vivante n'y part jamais ;
--   - release_pms_reserve_claim ne rend que SON claim.
--
-- ⚠️ pgTAP tourne dans UNE transaction : `now()` y est constant. Le claim pose `now()`, donc le bon
-- jeton est `now()` et un claim « périmé » se simule en passant une autre valeur. La sérialisation
-- de vrais appels concurrents relève de tests/concurrency/claim_order_for_pms_booking.concurrency.mjs.
begin;
select plan(44);

insert into partners (id, display_name) values
  ('9b930000-0000-4000-8000-000000000001', 'Claim Test Partner');
-- 011 : connecteur actif + jeton ; 012 : connecteur coupé ; 013 : actif mais sans jeton.
insert into establishments (id, partner_id, name, lobby_connector_active, lobby_api_token) values
  ('9b930000-0000-4000-8000-000000000011', '9b930000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Claim'), true, 'claim-token'),
  ('9b930000-0000-4000-8000-000000000012', '9b930000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Claim Apagado'), false, 'claim-token-off'),
  ('9b930000-0000-4000-8000-000000000013', '9b930000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Claim Sin Token'), true, null);
insert into auth.users (id, email) values
  ('9b930000-0000-4000-8000-000000000021', 'claim-buyer@test.local');

-- 031 : logement PMS (011) ; 032 : logement NON PMS (011) ; 033 : activité liée à Lobby (011) ;
-- 034 : logement PMS d'un établissement coupé (012) ; 035 : logement PMS sans jeton (013) ;
-- 036 : activité liée à Lobby d'un établissement coupé (012).
insert into products (
  id, partner_id, establishment_id, type, name, price_cop, sellable, slug, lobby_category_id, lobby_product_id
) values
  ('9b930000-0000-4000-8000-000000000031', '9b930000-0000-4000-8000-000000000001',
   '9b930000-0000-4000-8000-000000000011', 'lodging', jsonb_build_object('es', 'Claim PMS'),
   100000, true, 'claim-pms', 7001, null),
  ('9b930000-0000-4000-8000-000000000032', '9b930000-0000-4000-8000-000000000001',
   '9b930000-0000-4000-8000-000000000011', 'lodging', jsonb_build_object('es', 'Claim Local'),
   100000, true, 'claim-local', null, null),
  ('9b930000-0000-4000-8000-000000000033', '9b930000-0000-4000-8000-000000000001',
   '9b930000-0000-4000-8000-000000000011', 'activity', jsonb_build_object('es', 'Claim Actividad'),
   50000, true, 'claim-activity', null, 8001),
  ('9b930000-0000-4000-8000-000000000034', '9b930000-0000-4000-8000-000000000001',
   '9b930000-0000-4000-8000-000000000012', 'lodging', jsonb_build_object('es', 'Claim PMS Apagado'),
   100000, true, 'claim-pms-off', 7002, null),
  ('9b930000-0000-4000-8000-000000000035', '9b930000-0000-4000-8000-000000000001',
   '9b930000-0000-4000-8000-000000000013', 'lodging', jsonb_build_object('es', 'Claim PMS Sin Token'),
   100000, true, 'claim-pms-no-token', 7003, null),
  ('9b930000-0000-4000-8000-000000000036', '9b930000-0000-4000-8000-000000000001',
   '9b930000-0000-4000-8000-000000000012', 'activity', jsonb_build_object('es', 'Claim Actividad Apagada'),
   50000, true, 'claim-activity-off', null, 8002);

-- Commandes : 041 à réserver ; 042 payée ; 043 connecteur coupé ; 044 sans jeton ; 045 rien à
-- réserver chez Lobby ; 046 support des enregistrements.
insert into orders (id, account_id, holder_name, holder_email, payment_status) values
  ('9b930000-0000-4000-8000-000000000041', '9b930000-0000-4000-8000-000000000021', 'Claim A', 'claim-a@test.local', 'unpaid'),
  ('9b930000-0000-4000-8000-000000000042', '9b930000-0000-4000-8000-000000000021', 'Claim B', 'claim-b@test.local', 'paid'),
  ('9b930000-0000-4000-8000-000000000043', '9b930000-0000-4000-8000-000000000021', 'Claim C', 'claim-c@test.local', 'unpaid'),
  ('9b930000-0000-4000-8000-000000000044', '9b930000-0000-4000-8000-000000000021', 'Claim D', 'claim-d@test.local', 'unpaid'),
  ('9b930000-0000-4000-8000-000000000045', '9b930000-0000-4000-8000-000000000021', 'Claim E', 'claim-e@test.local', 'unpaid'),
  ('9b930000-0000-4000-8000-000000000046', '9b930000-0000-4000-8000-000000000021', 'Claim F', 'claim-f@test.local', 'unpaid');

insert into order_lines (
  id, order_id, account_id, product_id, date, end_date, qty, status, pms_booking_id, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
)
select l.id::uuid, l.order_id::uuid, '9b930000-0000-4000-8000-000000000021', l.product_id::uuid,
       l.date::date, l.end_date::date, 1, l.status, l.booking, 'Holder Claim',
       100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000
  from (values
    -- 041 : une nuit PMS à réserver, une nuit locale, une activité Lobby, une nuit PMS DÉJÀ bookée.
    ('9b930000-0000-4000-8000-000000000051', '9b930000-0000-4000-8000-000000000041', '9b930000-0000-4000-8000-000000000031', '2029-05-01', '2029-05-03', 'reserved', null),
    ('9b930000-0000-4000-8000-000000000052', '9b930000-0000-4000-8000-000000000041', '9b930000-0000-4000-8000-000000000032', '2029-05-01', '2029-05-03', 'reserved', null),
    ('9b930000-0000-4000-8000-000000000053', '9b930000-0000-4000-8000-000000000041', '9b930000-0000-4000-8000-000000000033', '2029-05-01', null, 'reserved', null),
    ('9b930000-0000-4000-8000-000000000054', '9b930000-0000-4000-8000-000000000041', '9b930000-0000-4000-8000-000000000031', '2029-05-10', '2029-05-11', 'reserved', 'B-DEJA'),
    ('9b930000-0000-4000-8000-000000000055', '9b930000-0000-4000-8000-000000000042', '9b930000-0000-4000-8000-000000000031', '2029-05-01', '2029-05-03', 'reserved', null),
    ('9b930000-0000-4000-8000-000000000056', '9b930000-0000-4000-8000-000000000043', '9b930000-0000-4000-8000-000000000034', '2029-05-01', '2029-05-03', 'reserved', null),
    ('9b930000-0000-4000-8000-000000000057', '9b930000-0000-4000-8000-000000000044', '9b930000-0000-4000-8000-000000000035', '2029-05-01', '2029-05-03', 'reserved', null),
    -- 045 : une nuit locale et une activité d'un établissement coupé — rien pour Lobby.
    ('9b930000-0000-4000-8000-000000000058', '9b930000-0000-4000-8000-000000000045', '9b930000-0000-4000-8000-000000000032', '2029-05-01', '2029-05-03', 'reserved', null),
    ('9b930000-0000-4000-8000-000000000059', '9b930000-0000-4000-8000-000000000045', '9b930000-0000-4000-8000-000000000036', '2029-05-01', null, 'reserved', null),
    -- 046 : deux nuits PMS vivantes, une expirée, une seconde expirée (connecteur coupé), une activité.
    ('9b930000-0000-4000-8000-000000000061', '9b930000-0000-4000-8000-000000000046', '9b930000-0000-4000-8000-000000000031', '2029-06-01', '2029-06-03', 'reserved', null),
    ('9b930000-0000-4000-8000-000000000062', '9b930000-0000-4000-8000-000000000046', '9b930000-0000-4000-8000-000000000031', '2029-06-05', '2029-06-06', 'reserved', null),
    ('9b930000-0000-4000-8000-000000000063', '9b930000-0000-4000-8000-000000000046', '9b930000-0000-4000-8000-000000000031', '2029-06-08', '2029-06-09', 'reserved', null),
    ('9b930000-0000-4000-8000-000000000064', '9b930000-0000-4000-8000-000000000046', '9b930000-0000-4000-8000-000000000031', '2029-06-10', '2029-06-11', 'reserved', null),
    ('9b930000-0000-4000-8000-000000000065', '9b930000-0000-4000-8000-000000000046', '9b930000-0000-4000-8000-000000000033', '2029-06-01', null, 'reserved', null)
  ) as l(id, order_id, product_id, date, end_date, status, booking);

-- Fixtures de la revue adversariale : un second établissement actif (014) et son logement PMS
-- (037) pour une commande à deux établissements (047) ; une commande `pending` (048) ; une commande
-- remboursée (049) ; une commande sans ligne vivante (04a) ; un code d'attribution sur 041.
insert into establishments (id, partner_id, name, lobby_connector_active, lobby_api_token) values
  ('9b930000-0000-4000-8000-000000000014', '9b930000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Claim Bis'), true, 'claim-token-bis');
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, lobby_category_id) values
  ('9b930000-0000-4000-8000-000000000037', '9b930000-0000-4000-8000-000000000001',
   '9b930000-0000-4000-8000-000000000014', 'lodging', jsonb_build_object('es', 'Claim PMS Bis'),
   100000, true, 'claim-pms-bis', 7004);
insert into partner_codes (code) values ('CLAIM-PROMO');
update orders set attribution_code = 'CLAIM-PROMO', attribution_source = 'link'
 where id = '9b930000-0000-4000-8000-000000000041';
insert into orders (id, account_id, holder_name, holder_email, payment_status) values
  ('9b930000-0000-4000-8000-000000000047', '9b930000-0000-4000-8000-000000000021', 'Claim G', 'claim-g@test.local', 'unpaid'),
  ('9b930000-0000-4000-8000-000000000048', '9b930000-0000-4000-8000-000000000021', 'Claim H', 'claim-h@test.local', 'pending'),
  ('9b930000-0000-4000-8000-000000000049', '9b930000-0000-4000-8000-000000000021', 'Claim I', 'claim-i@test.local', 'refunded'),
  ('9b930000-0000-4000-8000-00000000004a', '9b930000-0000-4000-8000-000000000021', 'Claim J', 'claim-j@test.local', 'unpaid');
insert into order_lines (
  id, order_id, account_id, product_id, date, end_date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
)
select l.id::uuid, l.order_id::uuid, '9b930000-0000-4000-8000-000000000021', l.product_id::uuid,
       l.date::date, l.end_date::date, 1, l.status, 'Holder Claim',
       100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000
  from (values
    ('9b930000-0000-4000-8000-000000000071', '9b930000-0000-4000-8000-000000000047', '9b930000-0000-4000-8000-000000000031', '2029-07-01', '2029-07-03', 'reserved'),
    ('9b930000-0000-4000-8000-000000000072', '9b930000-0000-4000-8000-000000000047', '9b930000-0000-4000-8000-000000000037', '2029-07-01', '2029-07-03', 'reserved'),
    ('9b930000-0000-4000-8000-000000000073', '9b930000-0000-4000-8000-000000000048', '9b930000-0000-4000-8000-000000000031', '2029-07-10', '2029-07-11', 'reserved'),
    ('9b930000-0000-4000-8000-000000000074', '9b930000-0000-4000-8000-000000000049', '9b930000-0000-4000-8000-000000000031', '2029-07-12', '2029-07-13', 'reserved'),
    ('9b930000-0000-4000-8000-000000000075', '9b930000-0000-4000-8000-00000000004a', '9b930000-0000-4000-8000-000000000031', '2029-07-14', '2029-07-15', 'cancelled_by_provider')
  ) as l(id, order_id, product_id, date, end_date, status);

set local role service_role;

-- ── claim_order_for_pms_booking ──────────────────────────────────────────────────────────────
select is(
  public.claim_order_for_pms_booking('00000000-0000-4000-8000-000000000000')->>'reason',
  'order_not_found',
  'claim : commande inconnue → order_not_found'
);

select is(
  public.claim_order_for_pms_booking('9b930000-0000-4000-8000-000000000042')->>'reason',
  'order_paid',
  'claim : commande payée → order_paid (I3)'
);
select is(
  (select pms_reserve_claimed_at from orders where id = '9b930000-0000-4000-8000-000000000042'),
  null,
  'claim : commande payée → aucun claim posé'
);

create temp table claim_041 as
  select public.claim_order_for_pms_booking('9b930000-0000-4000-8000-000000000041') as r;
select is((select r->>'ok' from claim_041), 'true', 'claim : commande à réserver → ok');
select is(
  (select (r->>'claimed_at')::timestamptz from claim_041),
  now(),
  'claim : claimed_at renvoyé = l''horodatage posé (le jeton)'
);
select is(
  (select pms_reserve_claimed_at from orders where id = '9b930000-0000-4000-8000-000000000041'),
  now(),
  'claim : orders.pms_reserve_claimed_at posé'
);
select is(
  (select jsonb_build_object(
     'groupes', jsonb_array_length(r->'groups'),
     'etab', r->'groups'->0->>'establishment_id',
     'jeton', r->'groups'->0->>'api_token',
     'nuits', (select jsonb_agg(x->>'id') from jsonb_array_elements(r->'groups'->0->'lodging_lines') x),
     'activites', (select jsonb_agg(x->>'id') from jsonb_array_elements(r->'groups'->0->'activity_lines') x)
   ) from claim_041),
  jsonb_build_object(
    'groupes', 1,
    'etab', '9b930000-0000-4000-8000-000000000011',
    'jeton', 'claim-token',
    'nuits', jsonb_build_array('9b930000-0000-4000-8000-000000000051'),
    'activites', jsonb_build_array('9b930000-0000-4000-8000-000000000053')
  ),
  'claim : seules la nuit PMS sans booking et l''activité Lobby reviennent (ni la nuit locale, ni la nuit déjà bookée)'
);

select is(
  public.claim_order_for_pms_booking('9b930000-0000-4000-8000-000000000041')->>'reason',
  'claim_in_progress',
  'claim : second appel dans le bail de 5 min → claim_in_progress'
);

reset role;
update orders set pms_reserve_claimed_at = now() - interval '6 minutes'
 where id = '9b930000-0000-4000-8000-000000000041';
set local role service_role;
select is(
  public.claim_order_for_pms_booking('9b930000-0000-4000-8000-000000000041')->>'ok',
  'true',
  'claim : bail expiré (6 min) → la commande est reprise'
);

select is(
  public.claim_order_for_pms_booking('9b930000-0000-4000-8000-000000000043')->>'reason',
  'pms_unavailable',
  'claim : logement PMS d''un établissement au connecteur coupé → pms_unavailable (§4.4)'
);
select is(
  public.claim_order_for_pms_booking('9b930000-0000-4000-8000-000000000044')->>'reason',
  'pms_unavailable',
  'claim : logement PMS d''un établissement sans jeton → pms_unavailable (§4.4)'
);
select is(
  (select count(*)::int from orders
    where id in ('9b930000-0000-4000-8000-000000000043', '9b930000-0000-4000-8000-000000000044')
      and pms_reserve_claimed_at is not null),
  0,
  'claim : pms_unavailable → aucun claim posé'
);

create temp table claim_045 as
  select public.claim_order_for_pms_booking('9b930000-0000-4000-8000-000000000045') as r;
select is(
  (select jsonb_build_object('ok', r->'ok', 'claimed_at', r->'claimed_at', 'groupes', jsonb_array_length(r->'groups')) from claim_045),
  jsonb_build_object('ok', true, 'claimed_at', null, 'groupes', 0),
  'claim : rien à réserver chez Lobby (nuit locale, activité d''un établissement coupé) → ok, aucun groupe'
);
select is(
  (select pms_reserve_claimed_at from orders where id = '9b930000-0000-4000-8000-000000000045'),
  null,
  'claim : rien à réserver → aucun claim posé'
);

-- ── record_pms_booking ───────────────────────────────────────────────────────────────────────
select is(
  public.claim_order_for_pms_booking('9b930000-0000-4000-8000-000000000046')->>'ok',
  'true',
  'record (préalable) : claim de la commande 046'
);
-- Deux lignes de 046 meurent entre le claim et l'enregistrement.
reset role;
update order_lines set status = 'expired'
 where id in ('9b930000-0000-4000-8000-000000000063', '9b930000-0000-4000-8000-000000000064');
set local role service_role;

select is(
  public.record_pms_booking('9b930000-0000-4000-8000-000000000046', now(), '9b930000-0000-4000-8000-000000000061', 'B-61'),
  jsonb_build_object('ok', true),
  'record : ligne vivante sans booking, bon jeton → ok'
);
select is(
  (select pms_booking_id from order_lines where id = '9b930000-0000-4000-8000-000000000061'),
  'B-61',
  'record : le booking est écrit sur la ligne'
);
select is(
  public.record_pms_booking('9b930000-0000-4000-8000-000000000046', now(), '9b930000-0000-4000-8000-000000000061', 'B-61')->>'idempotent',
  'true',
  'record : même booking rejoué → idempotent'
);

select is(
  public.record_pms_booking('9b930000-0000-4000-8000-000000000046', now(), '9b930000-0000-4000-8000-000000000061', 'B-DUP')->>'reason',
  'already_booked',
  'record : autre booking sur une ligne déjà bookée → already_booked (I1)'
);
select is(
  (select jsonb_build_object(
     'ligne', (select pms_booking_id from order_lines where id = '9b930000-0000-4000-8000-000000000061'),
     'file', (select count(*) from pms_cancellation_queue where pms_booking_id = 'B-DUP' and status = 'pending' and hifago_status = 'superseded'))),
  jsonb_build_object('ligne', 'B-61', 'file', 1),
  'record : la ligne garde son booking, le doublon part en file d''annulation'
);

select is(
  public.record_pms_booking('9b930000-0000-4000-8000-000000000046', '2000-01-01T00:00:00Z', '9b930000-0000-4000-8000-000000000062', 'B-STALE')->>'reason',
  'claim_stale',
  'record : mauvais jeton (claim périmé, repris ailleurs) → claim_stale'
);
select is(
  (select jsonb_build_object(
     'ligne', (select pms_booking_id from order_lines where id = '9b930000-0000-4000-8000-000000000062'),
     'file', (select count(*) from pms_cancellation_queue where pms_booking_id = 'B-STALE' and status = 'pending'))),
  jsonb_build_object('ligne', null, 'file', 1),
  'record : claim périmé → rien écrit sur la ligne, le booking part en file d''annulation'
);

-- Activité rattachée au booking principal, sous un claim périmé : le booking est porté par la nuit
-- 061, vivante — il ne doit JAMAIS partir en annulation.
select is(
  public.record_pms_booking('9b930000-0000-4000-8000-000000000046', '2000-01-01T00:00:00Z', '9b930000-0000-4000-8000-000000000065', 'B-61')->>'reason',
  'claim_stale',
  'record : activité sous claim périmé → claim_stale'
);
select is(
  (select count(*)::int from pms_cancellation_queue where pms_booking_id = 'B-61'),
  0,
  'record : un booking porté par une ligne vivante n''est jamais mis en annulation'
);

select is(
  public.record_pms_booking('9b930000-0000-4000-8000-000000000046', now(), '9b930000-0000-4000-8000-000000000063', 'B-EXP')->>'reason',
  'line_not_reserved',
  'record : ligne expirée entre le claim et le record → line_not_reserved'
);
select is(
  (select jsonb_build_object(
     'ligne', (select pms_booking_id from order_lines where id = '9b930000-0000-4000-8000-000000000063'),
     'file', (select count(*) from pms_cancellation_queue where pms_booking_id = 'B-EXP' and status = 'pending' and hifago_status = 'expired'))),
  jsonb_build_object('ligne', 'B-EXP', 'file', 1),
  'record : la ligne morte garde la trace du booking, qui part en file d''annulation (une seule entrée)'
);

-- Amendement du 30/09 : connecteur coupé ENTRE le claim et le record. Le trigger
-- enqueue_pms_cancellations filtre les connecteurs actifs — l'enfilage explicite doit tenir seul.
reset role;
update establishments set lobby_connector_active = false where id = '9b930000-0000-4000-8000-000000000011';
set local role service_role;
-- (L'appel et la relecture sont deux instructions : une instruction lit la base telle qu'elle
-- était à son début, et ne verrait pas l'écriture faite par la fonction qu'elle appelle.)
select is(
  public.record_pms_booking('9b930000-0000-4000-8000-000000000046', now(), '9b930000-0000-4000-8000-000000000064', 'B-OFF')->>'reason',
  'line_not_reserved',
  'record : connecteur coupé, ligne expirée → line_not_reserved'
);
select is(
  (select count(*)::int from pms_cancellation_queue where pms_booking_id = 'B-OFF' and status = 'pending'),
  1,
  'record : connecteur coupé entre le claim et le record → le booking est QUAND MÊME mis en file (jamais orphelin)'
);

-- ── release_pms_reserve_claim ───────────────────────────────────────────────────────────────
select is(
  public.release_pms_reserve_claim('9b930000-0000-4000-8000-000000000046', '2000-01-01T00:00:00Z')->>'released',
  'false',
  'release : un autre jeton → rien de rendu'
);
select is(
  (select pms_reserve_claimed_at from orders where id = '9b930000-0000-4000-8000-000000000046'),
  now(),
  'release : un autre jeton ne rend jamais le claim (claim toujours posé)'
);
select is(
  public.release_pms_reserve_claim('9b930000-0000-4000-8000-000000000046', now())->>'released',
  'true',
  'release : son propre jeton → rendu'
);
select is(
  (select pms_reserve_claimed_at from orders where id = '9b930000-0000-4000-8000-000000000046'),
  null,
  'release : son propre jeton rend le claim (colonne vidée)'
);

-- ── Cas de la revue adversariale ───────────────────────────────────────────────────────────
-- (Ce bloc tourne APRÈS les précédents : l'établissement 011 a encore son connecteur coupé depuis
-- le cas de l'amendement — on le rallume d'abord.)
reset role;
update establishments set lobby_connector_active = true where id = '9b930000-0000-4000-8000-000000000011';
update orders set pms_reserve_claimed_at = now() - interval '4 minutes'
 where id = '9b930000-0000-4000-8000-000000000041';
set local role service_role;
select is(
  public.claim_order_for_pms_booking('9b930000-0000-4000-8000-000000000041')->>'reason',
  'claim_in_progress',
  'claim : un claim de 4 min est encore vivant (bail de 5 min) → claim_in_progress'
);
reset role;
update orders set pms_reserve_claimed_at = null where id = '9b930000-0000-4000-8000-000000000041';
set local role service_role;
create temp table claim_041_attr as
  select public.claim_order_for_pms_booking('9b930000-0000-4000-8000-000000000041') as r;
select is(
  (select jsonb_build_object('code', r->>'attribution_code', 'source', r->>'attribution_source') from claim_041_attr),
  jsonb_build_object('code', 'CLAIM-PROMO', 'source', 'link'),
  'claim : l''attribution de la commande est renvoyée (la note Lobby en a besoin)'
);

create temp table claim_047 as
  select public.claim_order_for_pms_booking('9b930000-0000-4000-8000-000000000047') as r;
select is(
  (select jsonb_agg(jsonb_build_array(g->>'establishment_id', g->>'api_token', jsonb_array_length(g->'lodging_lines'))
                    order by g->>'establishment_id')
     from claim_047, jsonb_array_elements(r->'groups') g),
  jsonb_build_array(
    jsonb_build_array('9b930000-0000-4000-8000-000000000011', 'claim-token', 1),
    jsonb_build_array('9b930000-0000-4000-8000-000000000014', 'claim-token-bis', 1)
  ),
  'claim : deux établissements → deux groupes, chacun SON jeton et SA nuit'
);

select is(
  public.claim_order_for_pms_booking('9b930000-0000-4000-8000-000000000048')->>'ok',
  'true',
  'claim : commande pending (client chez Mercado Pago) → la nuit manquante peut encore être réservée'
);
select is(
  public.claim_order_for_pms_booking('9b930000-0000-4000-8000-000000000049')->>'reason',
  'order_paid',
  'claim : commande remboursée → order_paid (I3)'
);
-- Toutes les nuits PMS déjà bookées, une ligne vivante : rien à réserver, mais la commande est
-- VIVANTE — jamais order_not_active.
reset role;
insert into orders (id, account_id, holder_name, holder_email) values
  ('9b930000-0000-4000-8000-00000000004b', '9b930000-0000-4000-8000-000000000021', 'Claim K', 'claim-k@test.local');
insert into order_lines (
  id, order_id, account_id, product_id, date, end_date, qty, status, pms_booking_id, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '9b930000-0000-4000-8000-000000000076', '9b930000-0000-4000-8000-00000000004b', '9b930000-0000-4000-8000-000000000021',
  '9b930000-0000-4000-8000-000000000031', '2029-07-20', '2029-07-21', 1, 'reserved', 'B-KEEP', 'Holder Claim',
  100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000
);
set local role service_role;
select is(
  (select jsonb_build_object('ok', r->'ok', 'claimed_at', r->'claimed_at', 'groupes', jsonb_array_length(r->'groups'))
     from (select public.claim_order_for_pms_booking('9b930000-0000-4000-8000-00000000004b') as r) x),
  jsonb_build_object('ok', true, 'claimed_at', null, 'groupes', 0),
  'claim : nuits toutes bookées, ligne vivante → ok, aucun groupe (jamais order_not_active)'
);
select is(
  public.claim_order_for_pms_booking('9b930000-0000-4000-8000-00000000004a')->>'reason',
  'order_not_active',
  'claim : plus aucune ligne vivante → order_not_active, jamais un succès'
);

select is(
  public.record_pms_booking('9b930000-0000-4000-8000-000000000046', null, '9b930000-0000-4000-8000-000000000062', 'B-NULL')->>'reason',
  'invalid_arguments',
  'record : jeton NULL → invalid_arguments (jamais un enregistrement hors claim)'
);
select is(
  public.record_pms_booking('9b930000-0000-4000-8000-000000000041', now(), '9b930000-0000-4000-8000-000000000062', 'B-AUTRE')->>'reason',
  'line_not_found',
  'record : ligne d''une AUTRE commande → line_not_found'
);
select is(
  (select pms_booking_id from order_lines where id = '9b930000-0000-4000-8000-000000000062'),
  null,
  'record : la ligne d''une autre commande n''est pas touchée'
);

reset role;
update orders set pms_reserve_claimed_at = now() where id = '9b930000-0000-4000-8000-000000000046';
set local role service_role;
select is(
  public.record_pms_booking('9b930000-0000-4000-8000-000000000046', now(), '9b930000-0000-4000-8000-000000000065', 'B-61'),
  jsonb_build_object('ok', true),
  'record : activité rattachée au booking principal, claim valide → ok'
);
select ok(
  (select invalidated_at is not null from pms_sync_state
    where establishment_id = '9b930000-0000-4000-8000-000000000011' and month = '2029-06'),
  'record : une nuit enregistrée invalide le mois du miroir de disponibilité'
);

select * from finish();
rollback;

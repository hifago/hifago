-- Spec 20 §0 — create_manual_order_line (migration 20260818190000). Réservation manuelle (walk-in)
-- saisie par l'operator depuis l'agenda, admin+socio unifiés (même patron que
-- set_product_slot_capacity, cf. product_slot_availability.test.sql). Ne re-teste jamais la
-- logique de verrouillage anti-survente elle-même (déjà couverte par create_order.test.sql/
-- product_slot_availability.test.sql pour les mêmes deux branches) — seulement les gardes propres
-- à CETTE RPC (autorisation admin+socio, exclusion lodging/camp, absence de commission).
begin;
select plan(23);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Cas 1 : le rôle anon n'a plus EXECUTE (20261006203542) — refusé avant même la garde interne
-- `not_authenticated`, qui reste en place pour une session authentifiée sans `sub`.
set local role anon;
select throws_ok(
  $$ select create_manual_order_line(
       '00000000-0000-4000-8000-000000000000'::uuid, '2029-05-01'::date, 1, 'Cliente Anon'
     ) $$,
  '42501',
  null,
  'cas 1 : rôle anon → 42501 (EXECUTE retiré)'
);
reset role;

-- Fixtures : 2 partenaires (own/other), 1 admin, 1 operator par partenaire, produits couvrant
-- chaque garde (ACT = activité simple, HOTEL = type exclu, TIER = paliers avec un trou, SLOT =
-- créneaux horaires).
insert into partners (id, display_name) values
  ('88950000-0000-4000-8000-000000000001', 'Manual Order Line Own'),
  ('88950000-0000-4000-8000-000000000002', 'Manual Order Line Other');
insert into establishments (id, partner_id, name) values
  ('88950000-0000-4000-8000-000000000011', '88950000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Manual Own')),
  ('88950000-0000-4000-8000-000000000012', '88950000-0000-4000-8000-000000000002',
   jsonb_build_object('es', 'Establecimiento Manual Other'));

insert into auth.users (id, email) values
  ('88950000-0000-4000-8000-000000000021', 'manual-own@test.local'),
  ('88950000-0000-4000-8000-000000000022', 'manual-other@test.local'),
  ('88950000-0000-4000-8000-000000000023', 'manual-admin@test.local'),
  -- Compte TECHNIQUE fixe des réservations walk-in (`v_technical_account_id`, cette RPC,
  -- 20260910140000) — un UUID constant que create_manual_order_line écrit sur CHAQUE commande
  -- qu'elle crée. Provisionné ailleurs par `seed_auth_users.mjs`, jamais par ce fichier ; ce job
  -- pgTAP tourne délibérément SANS seed (`.github/workflows/hifago-ci.yml`, job `db`). Sans cette
  -- ligne, le tout premier appel de la RPC ci-dessous violait `orders_account_id_fkey` — trouvé le
  -- 2026-09-19, masqué jusque-là par un autre job CI en échec qui empêchait celui-ci de tourner.
  -- `on conflict do nothing` : cette base peut aussi être une base de DEV déjà seedée
  -- (`db:setup`/`seed_auth_users.mjs`), où ce même UUID technique existe déjà — jamais un doublon
  -- à lever en erreur ici, contrairement aux autres UUID de ce fichier qui, eux, sont propres.
  ('e0000000-0000-4000-8000-000000000001', 'reserva-manual@hifago.local')
on conflict (id) do nothing;
update partner_accounts set partner_id = '88950000-0000-4000-8000-000000000001'
 where id = '88950000-0000-4000-8000-000000000021';
update partner_accounts set partner_id = '88950000-0000-4000-8000-000000000002'
 where id = '88950000-0000-4000-8000-000000000022';
insert into partner_capabilities (partner_id, role, source, status) values
  ('88950000-0000-4000-8000-000000000001', 'referrer', 'migration', 'active'),
  ('88950000-0000-4000-8000-000000000002', 'referrer', 'migration', 'active');
insert into partner_capabilities (partner_id, role, establishment_id, source, status) values
  ('88950000-0000-4000-8000-000000000001', 'operator', '88950000-0000-4000-8000-000000000011',
   'migration', 'active'),
  ('88950000-0000-4000-8000-000000000002', 'operator', '88950000-0000-4000-8000-000000000012',
   'migration', 'active');
insert into partner_capabilities (account_id, role, source, status) values
  ('88950000-0000-4000-8000-000000000023', 'admin', 'migration', 'active');

insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, min_qty, max_qty)
values (
  '88950000-0000-4000-8000-000000000031', '88950000-0000-4000-8000-000000000001',
  '88950000-0000-4000-8000-000000000011', 'activity',
  jsonb_build_object('es', 'Actividad Manual'), 50000, true, 'manual-order-line-act', 1, 5
);
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
values (
  '88950000-0000-4000-8000-000000000032', '88950000-0000-4000-8000-000000000001',
  '88950000-0000-4000-8000-000000000011', 'lodging',
  jsonb_build_object('es', 'Alojamiento Manual'), 100000, true, 'manual-order-line-lodging'
);
insert into products (id, partner_id, establishment_id, type, name, price_cop, price_tiers, sellable, slug, min_qty, max_qty)
values (
  '88950000-0000-4000-8000-000000000033', '88950000-0000-4000-8000-000000000001',
  '88950000-0000-4000-8000-000000000011', 'activity',
  jsonb_build_object('es', 'Actividad Manual Tiers'), 40000,
  jsonb_build_array(
    jsonb_build_object('min_qty', 1, 'max_qty', 2, 'price_cop', 40000),
    jsonb_build_object('min_qty', 4, 'max_qty', 5, 'price_cop', 35000)
  ),
  true, 'manual-order-line-tiers', 1, 5
);
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, min_qty, max_qty)
values (
  '88950000-0000-4000-8000-000000000034', '88950000-0000-4000-8000-000000000001',
  '88950000-0000-4000-8000-000000000011', 'activity',
  jsonb_build_object('es', 'Actividad Manual Slot'), 20000, true, 'manual-order-line-slot', 1, 5
);
insert into product_slot_rules (product_id, weekdays, start_time, end_time, slot_duration_minutes, capacity)
values (
  '88950000-0000-4000-8000-000000000034', array[1, 2, 3, 4, 5, 6, 7]::smallint[], '09:00', '18:00', 60, 3
);
-- Régression constatée en prod locale (2026-08-18) : price_tiers stocké comme littéral JSON `null`
-- (pas un vrai NULL SQL) sur des produits réels — `v_price_tiers is not null` restait vrai dans ce
-- cas, jsonb_to_recordset('null'::jsonb) levait "cannot call jsonb_to_recordset on a non-array".
insert into products (id, partner_id, establishment_id, type, name, price_cop, price_tiers, sellable, slug, min_qty, max_qty)
values (
  '88950000-0000-4000-8000-000000000035', '88950000-0000-4000-8000-000000000001',
  '88950000-0000-4000-8000-000000000011', 'activity',
  jsonb_build_object('es', 'Actividad Manual Null Tiers'), 15000, 'null'::jsonb, true,
  'manual-order-line-null-tiers', 1, 5
);

insert into product_availability (product_id, date, capacity, booked) values
  ('88950000-0000-4000-8000-000000000031', '2029-05-01', 5, 0),  -- succès date unique
  ('88950000-0000-4000-8000-000000000031', '2029-05-02', 5, 4),  -- presque pleine, pour le refus 'full'
  ('88950000-0000-4000-8000-000000000035', '2029-05-01', 5, 0);  -- pour le cas price_tiers = null littéral
insert into product_calendar (product_id, date, open) values
  ('88950000-0000-4000-8000-000000000031', '2029-05-03', false); -- fermée explicitement

set local role authenticated;

-- Cas 2 : quantité invalide (< 1) → invalid_qty, avant toute lecture produit.
select test_login('88950000-0000-4000-8000-000000000021'); -- operator_own
select is(
  (select create_manual_order_line(
     '88950000-0000-4000-8000-000000000031', '2029-05-01', 0, 'Cliente Walk-in'
   )->>'reason'),
  'invalid_qty',
  'cas 2 : qty < 1 → invalid_qty'
);

-- Cas 3 : nom du client vide → holder_name_required.
select is(
  (select create_manual_order_line(
     '88950000-0000-4000-8000-000000000031', '2029-05-01', 1, '   '
   )->>'reason'),
  'holder_name_required',
  'cas 3 : holder_name vide → holder_name_required'
);

-- Cas 4 : produit inexistant → product_not_found.
select is(
  (select create_manual_order_line(
     '00000000-0000-4000-8000-000000000099', '2029-05-01', 1, 'Cliente Walk-in'
   )->>'reason'),
  'product_not_found',
  'cas 4 : produit inexistant → product_not_found'
);

-- Cas 5 : operator d'un AUTRE établissement tente le produit 031 (établissement 011) →
-- product_not_found (masqué, jamais de fuite d'existence).
select test_login('88950000-0000-4000-8000-000000000022'); -- operator_other, établissement 012
select is(
  (select create_manual_order_line(
     '88950000-0000-4000-8000-000000000031', '2029-05-01', 1, 'Cliente Walk-in'
   )->>'reason'),
  'product_not_found',
  'cas 5 : operator d''un autre établissement → product_not_found (masqué)'
);

select test_login('88950000-0000-4000-8000-000000000021'); -- operator_own pour le reste des cas

-- Cas 6 : type exclu. Fixture 'lodging' depuis T3 étape 2 (20260827220000) : le type 'hotel',
-- qu'exerçait ce cas jusque-là, n'existe plus — l'exclusion elle-même, elle, est intacte.
select is(
  (select create_manual_order_line(
     '88950000-0000-4000-8000-000000000032', '2029-05-01', 1, 'Cliente Walk-in'
   )->>'reason'),
  'unsupported_product_type',
  'cas 6 : products.type=lodging → unsupported_product_type'
);

-- Cas 7 : quantité hors bornes (max_qty=5).
select is(
  (select create_manual_order_line(
     '88950000-0000-4000-8000-000000000031', '2029-05-01', 6, 'Cliente Walk-in'
   )->>'reason'),
  'qty_cap_exceeded',
  'cas 7 : qty > max_qty → qty_cap_exceeded'
);

-- Cas 8 : aucun palier de prix ne couvre la quantité (produit TIER : 1-2 et 4-5, trou à 3).
select is(
  (select create_manual_order_line(
     '88950000-0000-4000-8000-000000000033', '2029-05-01', 3, 'Cliente Walk-in'
   )->>'reason'),
  'no_matching_tier',
  'cas 8 : qty dans le trou entre deux paliers → no_matching_tier'
);

-- Cas 9 : produit à créneaux sans p_slot_start_time → slot_required.
select is(
  (select create_manual_order_line(
     '88950000-0000-4000-8000-000000000034', '2029-05-01', 1, 'Cliente Walk-in'
   )->>'reason'),
  'slot_required',
  'cas 9 : produit avec product_slot_rules mais slot_start_time omis → slot_required'
);

-- Cas 10 : date fermée explicitement (product_calendar.open = false).
select is(
  (select create_manual_order_line(
     '88950000-0000-4000-8000-000000000031', '2029-05-03', 1, 'Cliente Walk-in'
   )->>'reason'),
  'date_closed',
  'cas 10 : date fermée → date_closed'
);

-- Cas 11 : capacité insuffisante (capacity=5, booked=4, qty=2 → 6 > 5).
select is(
  (select create_manual_order_line(
     '88950000-0000-4000-8000-000000000031', '2029-05-02', 2, 'Cliente Walk-in'
   )->>'reason'),
  'full',
  'cas 11 : capacité insuffisante → full'
);

-- Cas 11b (régression) : price_tiers = littéral JSON `null` (pas SQL NULL) → traité comme "pas de
-- palier", ne plante jamais jsonb_to_recordset, prix résolu depuis price_cop.
create temp table tmp_manual_null_tiers as
  select create_manual_order_line(
    '88950000-0000-4000-8000-000000000035', '2029-05-01', 1, 'Cliente Walk-in Null Tiers'
  ) as result;
select is(
  (select result->>'ok' from tmp_manual_null_tiers), 'true',
  'cas 11b : price_tiers = null littéral → succès, jamais un crash jsonb_to_recordset'
);
reset role;
select is(
  (select price_cop from order_lines where id = (select (result->>'order_line_id')::uuid from tmp_manual_null_tiers)),
  15000::bigint,
  'cas 11b : prix résolu depuis price_cop (aucun palier à appliquer)'
);
set local role authenticated;
select test_login('88950000-0000-4000-8000-000000000021'); -- operator_own
drop table tmp_manual_null_tiers;

-- ===== Succès — branche date unique =============================================================
create temp table tmp_manual_act as
  select create_manual_order_line(
    '88950000-0000-4000-8000-000000000031', '2029-05-01', 2, 'Cliente Walk-in Recepción', null,
    '+57 300 000 0000', 'Reserva tomada en el mostrador'
  ) as result;
select is(
  (select result->>'ok' from tmp_manual_act), 'true',
  'succès date unique : appel réussi'
);
reset role;
select is(
  (select jsonb_build_object(
     'account_id', account_id, 'slot_start_time', slot_start_time, 'qty', qty,
     'holder_name', holder_name, 'status', status, 'commission_case', commission_case,
     'price_cop', price_cop, 'total_cop', total_cop, 'referrer_commission_cop', referrer_commission_cop,
     'app_commission_cop', app_commission_cop
   ) from order_lines where id = (select (result->>'order_line_id')::uuid from tmp_manual_act)),
  jsonb_build_object(
    'account_id', 'e0000000-0000-4000-8000-000000000001', 'slot_start_time', null, 'qty', 2,
    'holder_name', 'Cliente Walk-in Recepción', 'status', 'reserved', 'commission_case', 'operator_manual',
    'price_cop', 50000, 'total_cop', 100000, 'referrer_commission_cop', 0, 'app_commission_cop', 0
  ),
  -- RÉVISÉ 2026-09-10 (spec 31, Tranche 2) : account_id porte désormais le compte technique fixe,
  -- plus jamais null (orders.account_id/order_lines.account_id sont NOT NULL).
  'succès date unique : order_line correcte (account_id = compte technique, commission_case operator_manual, zéro commission)'
);
set local role authenticated;
-- orders/audit_log n'ont aucune policy select operator (seulement account_id=acheteur/admin pour
-- orders, admin seul pour audit_log) : bascule admin pour ces deux lectures, même patron que
-- set_order_line_status.test.sql cas 7 (ledger_entries, même raison).
select test_login('88950000-0000-4000-8000-000000000023'); -- admin
select is(
  (select jsonb_build_object('account_id', account_id, 'holder_email', holder_email, 'holder_phone', holder_phone)
     from orders where id = (select (result->>'order_id')::uuid from tmp_manual_act)),
  jsonb_build_object(
    'account_id', 'e0000000-0000-4000-8000-000000000001', 'holder_email', 'reserva-manual@hifago.local',
    'holder_phone', '+57 300 000 0000'
  ),
  'succès date unique : order compte technique + sentinelle email dédiée (RÉVISÉ 2026-09-10, spec 31)'
);
select is(
  (select jsonb_build_object('action', action, 'entity_table', entity_table, 'note', note)
     from audit_log where entity_id = (select (result->>'order_line_id')::uuid from tmp_manual_act)),
  jsonb_build_object(
    'action', 'order_line.create_manual', 'entity_table', 'order_lines',
    'note', 'Reserva tomada en el mostrador'
  ),
  'succès date unique : ligne audit_log correcte'
);
select test_login('88950000-0000-4000-8000-000000000021'); -- operator_own, pour la suite
select is(
  (select booked from product_availability
    where product_id = '88950000-0000-4000-8000-000000000031' and date = '2029-05-01'),
  2,
  'succès date unique : capacité incrémentée (0 + 2 = 2)'
);
drop table tmp_manual_act;

-- ===== Succès — branche créneau horaire ==========================================================
create temp table tmp_manual_slot as
  select create_manual_order_line(
    '88950000-0000-4000-8000-000000000034', '2029-05-01', 1, 'Cliente Walk-in Slot', '09:00'
  ) as result;
select is(
  (select result->>'ok' from tmp_manual_slot), 'true',
  'succès créneau : appel réussi'
);
reset role;
select is(
  (select jsonb_build_object('slot_start_time', slot_start_time, 'qty', qty, 'price_cop', price_cop, 'total_cop', total_cop)
     from order_lines where id = (select (result->>'order_line_id')::uuid from tmp_manual_slot)),
  jsonb_build_object('slot_start_time', '09:00:00'::time, 'qty', 1, 'price_cop', 20000, 'total_cop', 20000),
  'succès créneau : order_line correcte (slot_start_time/prix)'
);
set local role authenticated;
select test_login('88950000-0000-4000-8000-000000000021'); -- operator_own
select is(
  (select booked from product_slot_availability
    where product_id = '88950000-0000-4000-8000-000000000034' and slot_date = '2029-05-01'
      and slot_start_time = '09:00'),
  1,
  'succès créneau : product_slot_availability matérialisée et incrémentée'
);
drop table tmp_manual_slot;

-- Cas 12 (rappel) : même créneau, capacité 3, déjà booked=1 (succès ci-dessus) + qty=3 → 4 > 3 → full.
select is(
  (select create_manual_order_line(
     '88950000-0000-4000-8000-000000000034', '2029-05-01', 3, 'Cliente Walk-in Slot 2', '09:00'
   )->>'reason'),
  'full',
  'cas 12 : créneau presque plein (1/3) + qty=3 → full'
);

-- ===== Admin — bypass de la vérification d'établissement =========================================
reset role;
insert into product_availability (product_id, date, capacity, booked) values
  ('88950000-0000-4000-8000-000000000031', '2029-05-04', 5, 0);
set local role authenticated;
select test_login('88950000-0000-4000-8000-000000000023'); -- admin
create temp table tmp_manual_admin as
  select create_manual_order_line(
    '88950000-0000-4000-8000-000000000031', '2029-05-04', 1, 'Cliente Walk-in Admin'
  ) as result;
select is(
  (select result->>'ok' from tmp_manual_admin), 'true',
  'admin : peut créer une réservation manuelle sur n''importe quel établissement'
);
drop table tmp_manual_admin;

select * from finish();
rollback;

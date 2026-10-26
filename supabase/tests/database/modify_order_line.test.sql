-- Spec 17 §0 Tranche 1 (docs/specs/17-calendrier-disponibilite-refonte.md) — modify_order_line,
-- migration 20260817200000_modify_order_line_rpc.sql, seule source de vérité pour la branche date
-- unique (cas 1-10 + succès A-D ci-dessous, 26 assertions — INCHANGÉS au mot près depuis leur
-- écriture d'origine). Admin-only, même calibrage bas-risque que set_order_line_status/cancel_order
-- (pas de test de concurrence à barrière — le verrouillage FOR UPDATE lui-même est le même patron
-- que create_order Phase 2, déjà couvert par ses propres tests de concurrence).
--
-- Spec 17 §0 Tranche 2 (suite) — migration 20260817220400_modify_order_line_range_support.sql,
-- rend modify_order_line polymorphe (chambre d'hôtel par plage / alojamiento par plage). Cas 11-12
-- + scénarios R1/R2/refus chambre/L1/refus alojamiento ci-dessous (31 assertions supplémentaires,
-- plan 26 → 57) couvrent ces deux nouvelles branches, jamais retestées par la Tranche 1.
--
-- Spec 20 §0 (2026-08-18, migration 20260818180000) — élargissement d'autorisation : un operator
-- peut désormais appeler modify_order_line sur son propre établissement (avant : admin-only strict,
-- cas 1 mis à jour en conséquence). Cas 15-16 couvrent la nouvelle autorisation sur la branche la
-- plus simple (date unique) — l'autorisation est un garde unique en tête de fonction, indépendant
-- de la branche exécutée ensuite ; retester chaque branche (chambre/alojamiento/défaut) sous
-- operator serait une redondance, pas une couverture supplémentaire (cf. hifago/CLAUDE.md §6,
-- proportionnalité du test).
begin;
select plan(52);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Fixtures : 1 partenaire/établissement, 1 admin, 1 buyer (non-admin), 3 produits (ACT = activité
-- normale pour les gardes, ACT2 = activité normale isolée pour les scénarios de succès — jamais le
-- même produit/date que les gardes, pour ne jamais mélanger les compteurs de capacité entre les
-- deux groupes de cas —, TIER = price_tiers pour le cas de re-résolution de prix, CAMP = garde
-- d'exclusion explicite).
insert into partners (id, display_name) values
  ('88920000-0000-4000-8000-000000000001', 'Modify Order Line Test Partner');
insert into establishments (id, partner_id, name) values
  ('88920000-0000-4000-8000-000000000011', '88920000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Modify Order Line'));

insert into auth.users (id, email) values
  ('88920000-0000-4000-8000-000000000031', 'modify-order-line-admin@test.local'),
  ('88920000-0000-4000-8000-000000000032', 'modify-order-line-buyer@test.local');
insert into partner_capabilities (account_id, role, source, status)
values ('88920000-0000-4000-8000-000000000031', 'admin', 'migration', 'active');

insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug,
                       min_qty, max_qty)
values
  ('88920000-0000-4000-8000-000000000021', '88920000-0000-4000-8000-000000000001',
   '88920000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Actividad Modify Guards'), 50000, true, 'modify-order-line-guards',
   -- max_qty NULL : interdit pour une activité depuis la migration 20261025120000.
   1, null),
  ('88920000-0000-4000-8000-000000000022', '88920000-0000-4000-8000-000000000001',
   '88920000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Actividad Modify Success'), 50000, true, 'modify-order-line-success',
   1, null);
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug,
                       min_qty, max_qty, duration_days)
values (
  '88920000-0000-4000-8000-000000000024', '88920000-0000-4000-8000-000000000001',
  '88920000-0000-4000-8000-000000000011', 'camp',
  jsonb_build_object('es', 'Campamento Modify Guard'), 500000, true, 'modify-order-line-camp',
  null, null, 1
);
insert into products (id, partner_id, establishment_id, type, name, price_cop, price_tiers, sellable,
                       slug, min_qty, max_qty)
values (
  '88920000-0000-4000-8000-000000000023', '88920000-0000-4000-8000-000000000001',
  '88920000-0000-4000-8000-000000000011', 'activity',
  jsonb_build_object('es', 'Actividad Modify Tiers'),
  -- price_cop requis par products_price_cop_required_unless_evento même quand price_tiers est
  -- défini (le palier prévaut toujours en pratique, cf. create_order Phase 4) — même convention
  -- que le palier le plus bas déjà utilisée ailleurs (ex. stay_rates).
  40000,
  jsonb_build_array(
    jsonb_build_object('min_qty', 1, 'max_qty', 2, 'price_cop', 40000),
    jsonb_build_object('min_qty', 3, 'max_qty', 5, 'price_cop', 35000)
  ),
  true, 'modify-order-line-tiers', 1, null
);

-- Calendrier/capacité — groupe GARDES (produit 021) : une seule date, jamais touchée par un succès.
insert into product_availability (product_id, date, capacity, booked) values
  ('88920000-0000-4000-8000-000000000021', '2028-09-01', 5, 1);
-- Date fermée explicitement, pour la garde "date cible fermée".
insert into product_calendar (product_id, date, open) values
  ('88920000-0000-4000-8000-000000000021', '2028-09-06', false);
-- Date déjà pleine, pour la garde "capacité insuffisante" (produit/date DIFFÉRENTS de la ligne
-- déplacée, donc jamais same_slot : tout l'effective_booked reste opposable).
insert into product_availability (product_id, date, capacity, booked) values
  ('88920000-0000-4000-8000-000000000021', '2028-09-03', 1, 1);
-- '2028-09-07' volontairement SANS ligne product_availability, pour la garde "aucune disponibilité".

insert into orders (id, account_id, holder_name, holder_email) values
  ('88920000-0000-4000-8000-000000000041', '88920000-0000-4000-8000-000000000032',
   'Holder Modify Order Line', 'holder-modify-order-line@test.local');

-- Ligne G : cible de TOUTES les gardes qui échouent avant toute écriture (jamais consommée,
-- réutilisable d'un cas à l'autre — chaque garde retourne avant la moindre mutation).
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '88920000-0000-4000-8000-000000000051', '88920000-0000-4000-8000-000000000041',
  '88920000-0000-4000-8000-000000000032', '88920000-0000-4000-8000-000000000021',
  '2028-09-01', 1, 'reserved', 'Holder Modify Order Line',
  50000, 50000, 'direct', 0, 0, 0, 0, 0, 0
);
-- Ligne F : déjà fulfilled, pour la garde "statut non modifiable".
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '88920000-0000-4000-8000-000000000052', '88920000-0000-4000-8000-000000000041',
  '88920000-0000-4000-8000-000000000032', '88920000-0000-4000-8000-000000000021',
  '2028-09-01', 1, 'fulfilled', 'Holder Modify Order Line',
  50000, 50000, 'direct', 0, 0, 0, 0, 0, 0
);
-- Ligne CAMP : pour la garde d'exclusion camp.
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '88920000-0000-4000-8000-000000000053', '88920000-0000-4000-8000-000000000041',
  '88920000-0000-4000-8000-000000000032', '88920000-0000-4000-8000-000000000024',
  '2028-09-01', 1, 'reserved', 'Holder Modify Order Line',
  500000, 500000, 'direct', 0, 0, 0, 0, 0, 0
);

set local role authenticated;
select test_login('88920000-0000-4000-8000-000000000032'); -- buyer, pas admin

-- Cas 1 : non-admin, sans capacité operator nulle part → exception 42501, rien modifié.
select throws_ok(
  $$ select modify_order_line(
       '88920000-0000-4000-8000-000000000051', '2028-09-01', 2, 'Tentative non-admin'
     ) $$,
  '42501'::char(5),
  'modify_order_line réservé au rôle admin (ou à l''operator du même établissement)',
  'cas 1 : appel non-admin → exception 42501'
);
reset role;
select is(
  (select status from order_lines where id = '88920000-0000-4000-8000-000000000051'),
  'reserved',
  'cas 1 : ligne inchangée après le refus non-admin'
);

set local role authenticated;
select test_login('88920000-0000-4000-8000-000000000031'); -- admin pour le reste des cas

-- Cas 2 : motif vide/null → exception.
select throws_ok(
  $$ select modify_order_line('88920000-0000-4000-8000-000000000051', '2028-09-01', 2, '') $$,
  'P0001'::char(5), 'motif obligatoire pour modifier une réservation',
  'cas 2a : motif vide → exception'
);
select throws_ok(
  $$ select modify_order_line('88920000-0000-4000-8000-000000000051', '2028-09-01', 2, null) $$,
  'P0001'::char(5), 'motif obligatoire pour modifier une réservation',
  'cas 2b : motif null → exception'
);

-- Cas 3 : quantité cible invalide (< 1).
select throws_ok(
  $$ select modify_order_line('88920000-0000-4000-8000-000000000051', '2028-09-01', 0, 'Motivo válido') $$,
  'P0001'::char(5), null,
  'cas 3 : quantité cible < 1 → exception'
);

-- Cas 4 : ligne introuvable.
select throws_ok(
  $$ select modify_order_line('00000000-0000-4000-8000-000000000099', '2028-09-01', 2, 'Motivo válido') $$,
  'P0001'::char(5), 'ligne de commande introuvable',
  'cas 4 : ligne inexistante → exception'
);

-- Cas 5 : statut non modifiable (ligne déjà fulfilled).
select throws_ok(
  $$ select modify_order_line('88920000-0000-4000-8000-000000000052', '2028-09-01', 2, 'Motivo válido') $$,
  'P0001'::char(5), null,
  'cas 5 : ligne déjà fulfilled → exception'
);

-- Cas 6 : type camp explicitement exclu (Tranche 1, ressource partagée hors périmètre).
select throws_ok(
  $$ select modify_order_line('88920000-0000-4000-8000-000000000053', '2028-09-01', 2, 'Motivo válido') $$,
  'P0001'::char(5), null,
  'cas 6 : produit type=camp → exception (hors périmètre v1)'
);
reset role;
select is(
  (select status from order_lines where id = '88920000-0000-4000-8000-000000000053'),
  'reserved',
  'cas 6 : ligne camp inchangée'
);
set local role authenticated;
select test_login('88920000-0000-4000-8000-000000000031');

-- Cas 7 : plus de plafond par réservation pour une activité (migration 20261025120000) — 6 places
-- butent sur la CAPACITÉ de la date (5), plus sur un max_qty. Message exact : un « hors bornes »
-- ferait rougir ce cas.
select throws_ok(
  $$ select modify_order_line('88920000-0000-4000-8000-000000000051', '2028-09-01', 6, 'Motivo válido') $$,
  'P0001'::char(5), 'capacité insuffisante à la date cible (0 déjà réservé(s) sur 5)',
  'cas 7 : activité, qty au-delà de la capacité → refusée par la capacité, aucun plafond produit'
);

-- Cas 8 : date cible fermée (2028-09-06, product_calendar.open=false).
select throws_ok(
  $$ select modify_order_line('88920000-0000-4000-8000-000000000051', '2028-09-06', 2, 'Motivo válido') $$,
  'P0001'::char(5), 'date cible fermée pour ce produit',
  'cas 8 : date cible fermée → exception'
);

-- Cas 9 : aucune disponibilité définie à la date cible (2028-09-07, jamais créée).
select throws_ok(
  $$ select modify_order_line('88920000-0000-4000-8000-000000000051', '2028-09-07', 2, 'Motivo válido') $$,
  'P0001'::char(5), 'aucune disponibilité définie pour la date cible',
  'cas 9 : aucune ligne product_availability à la date cible → exception'
);

-- Cas 10 : capacité insuffisante à la date cible (2028-09-03, capacity=1 booked=1, produit/date
-- DIFFÉRENTS de la ligne source → tout le booked existant reste opposable, jamais same_slot).
select throws_ok(
  $$ select modify_order_line('88920000-0000-4000-8000-000000000051', '2028-09-03', 1, 'Motivo válido') $$,
  'P0001'::char(5), null,
  'cas 10 : capacité insuffisante à la date cible → exception'
);

-- Vérification finale du groupe gardes : la ligne G n'a JAMAIS été modifiée par aucun des 10 cas
-- ci-dessus, et la capacité de sa propre date (09-01) est restée à 1 (aucune écriture parasite).
reset role;
select is(
  (select jsonb_build_object('status', status, 'date', date, 'qty', qty)
     from order_lines where id = '88920000-0000-4000-8000-000000000051'),
  jsonb_build_object('status', 'reserved', 'date', '2028-09-01'::date, 'qty', 1),
  'groupe gardes : ligne G intacte après tous les refus'
);
select is(
  (select booked from product_availability
    where product_id = '88920000-0000-4000-8000-000000000021' and date = '2028-09-01'),
  1,
  'groupe gardes : capacité de la date source inchangée après tous les refus'
);

-- ===== Scénarios de succès — produits/dates isolés du groupe gardes ===========================

-- Succès A : même date, quantité augmentée (2 → 4) — arithmétique same_slot.
-- reset role : le rôle actif est authenticated depuis les gardes ci-dessus, insuffisant pour ces
-- inserts directs RLS admin-only sur product_availability/order_lines/pms_reconciliation_entries.
reset role;
insert into product_availability (product_id, date, capacity, booked) values
  ('88920000-0000-4000-8000-000000000022', '2028-10-01', 5, 2);
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name, referrer_partner_id,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '88920000-0000-4000-8000-000000000061', '88920000-0000-4000-8000-000000000041',
  '88920000-0000-4000-8000-000000000032', '88920000-0000-4000-8000-000000000022',
  '2028-10-01', 2, 'reserved', 'Holder Modify Order Line', null,
  50000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000
);
set local role authenticated;
select test_login('88920000-0000-4000-8000-000000000031');
create temp table tmp_modify_a as
  select modify_order_line(
    '88920000-0000-4000-8000-000000000061', '2028-10-01', 4, 'Ampliar cupo mismo día'
  ) as result;
select is(
  (select result->>'ok' from tmp_modify_a), 'true',
  'succès A : appel réussi (même date, qty 2→4)'
);
reset role;
select is(
  (select status from order_lines where id = '88920000-0000-4000-8000-000000000061'),
  'superseded',
  'succès A : ancienne ligne marquée superseded'
);
select is(
  (select jsonb_build_object('date', date, 'qty', qty, 'status', status, 'holder_name', holder_name,
          'replaces_order_line_id', replaces_order_line_id, 'price_cop', price_cop, 'total_cop', total_cop)
     from order_lines where id = (select (result->>'order_line_id')::uuid from tmp_modify_a)),
  jsonb_build_object(
    'date', '2028-10-01'::date, 'qty', 4, 'status', 'reserved',
    'holder_name', 'Holder Modify Order Line',
    'replaces_order_line_id', '88920000-0000-4000-8000-000000000061',
    'price_cop', 50000, 'total_cop', 200000
  ),
  'succès A : nouvelle ligne correcte (date/qty/holder_name/replaces_order_line_id/prix)'
);
select is(
  (select booked from product_availability
    where product_id = '88920000-0000-4000-8000-000000000022' and date = '2028-10-01'),
  4,
  'succès A : capacité recalculée correctement (2 - 2 + 4 = 4, jamais 6)'
);
drop table tmp_modify_a;

-- Succès B : déplacement vers une autre date (neutre en capacité — libère la source, consomme la
-- cible).
reset role;
insert into product_availability (product_id, date, capacity, booked) values
  ('88920000-0000-4000-8000-000000000022', '2028-10-05', 5, 3),
  ('88920000-0000-4000-8000-000000000022', '2028-10-06', 5, 1);
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '88920000-0000-4000-8000-000000000062', '88920000-0000-4000-8000-000000000041',
  '88920000-0000-4000-8000-000000000032', '88920000-0000-4000-8000-000000000022',
  '2028-10-05', 3, 'reserved', 'Holder Modify Order Line',
  50000, 150000, 'direct', 0.17, 0, 0.17, 25500, 0, 25500
);
set local role authenticated;
select test_login('88920000-0000-4000-8000-000000000031');
create temp table tmp_modify_b as
  select modify_order_line(
    '88920000-0000-4000-8000-000000000062', '2028-10-06', 2, 'Cliente pidió cambiar de día'
  ) as result;
select is(
  (select result->>'ok' from tmp_modify_b), 'true',
  'succès B : appel réussi (changement de date, qty 3→2)'
);
select is(
  (select booked from product_availability
    where product_id = '88920000-0000-4000-8000-000000000022' and date = '2028-10-05'),
  0,
  'succès B : capacité de la date SOURCE libérée (3 - 3 = 0)'
);
select is(
  (select booked from product_availability
    where product_id = '88920000-0000-4000-8000-000000000022' and date = '2028-10-06'),
  3,
  'succès B : capacité de la date CIBLE consommée (1 + 2 = 3)'
);
drop table tmp_modify_b;

-- Succès C : re-résolution du prix par palier quand la quantité change de tranche (1 → 4, tier
-- 1-2@40000 devient tier 3-5@35000).
reset role;
insert into product_availability (product_id, date, capacity, booked) values
  ('88920000-0000-4000-8000-000000000023', '2028-10-10', 10, 1);
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '88920000-0000-4000-8000-000000000063', '88920000-0000-4000-8000-000000000041',
  '88920000-0000-4000-8000-000000000032', '88920000-0000-4000-8000-000000000023',
  '2028-10-10', 1, 'reserved', 'Holder Modify Order Line',
  40000, 40000, 'direct', 0.17, 0, 0.17, 6800, 0, 6800
);
set local role authenticated;
select test_login('88920000-0000-4000-8000-000000000031');
create temp table tmp_modify_c as
  select modify_order_line(
    '88920000-0000-4000-8000-000000000063', '2028-10-10', 4, 'Grupo más grande'
  ) as result;
reset role;
select is(
  (select jsonb_build_object('price_cop', price_cop, 'total_cop', total_cop)
     from order_lines where id = (select (result->>'order_line_id')::uuid from tmp_modify_c)),
  jsonb_build_object('price_cop', 35000, 'total_cop', 140000),
  'succès C : prix re-résolu par le palier couvrant la nouvelle quantité (35000 × 4)'
);
drop table tmp_modify_c;

-- Succès D : une entrée pms_reconciliation_entries ouverte est transférée vers la nouvelle ligne,
-- historique de tentatives conservé (spec 17 §10 point 2).
reset role;
insert into product_availability (product_id, date, capacity, booked) values
  ('88920000-0000-4000-8000-000000000022', '2028-10-15', 5, 1);
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '88920000-0000-4000-8000-000000000064', '88920000-0000-4000-8000-000000000041',
  '88920000-0000-4000-8000-000000000032', '88920000-0000-4000-8000-000000000022',
  '2028-10-15', 1, 'reserved', 'Holder Modify Order Line',
  50000, 50000, 'direct', 0.17, 0, 0.17, 8500, 0, 8500
);
insert into pms_reconciliation_entries (order_line_id, status, attempts) values
  ('88920000-0000-4000-8000-000000000064', 'retrying', 2);
set local role authenticated;
select test_login('88920000-0000-4000-8000-000000000031');
create temp table tmp_modify_d as
  select modify_order_line(
    '88920000-0000-4000-8000-000000000064', '2028-10-15', 2, 'Ampliar antes de reintentar Lobby'
  ) as result;
select is(
  (select count(*) from pms_reconciliation_entries
    where order_line_id = '88920000-0000-4000-8000-000000000064')::int,
  0,
  'succès D : plus aucune entrée de réconciliation sur l''ANCIENNE ligne'
);
select is(
  (select jsonb_build_object('order_line_id', order_line_id, 'status', status, 'attempts', attempts)
     from pms_reconciliation_entries
    where order_line_id = (select (result->>'order_line_id')::uuid from tmp_modify_d)),
  jsonb_build_object(
    'order_line_id', (select (result->>'order_line_id')::uuid from tmp_modify_d),
    'status', 'retrying', 'attempts', 2
  ),
  'succès D : entrée transférée vers la NOUVELLE ligne, historique (attempts/status) conservé'
);
drop table tmp_modify_d;

-- Audit : une ligne audit_log correcte pour le succès A (action/before/after/note).
select is(
  (select jsonb_build_object(
     'action', action, 'entity_table', entity_table, 'entity_id', entity_id,
     'before', before, 'note', note
   ) from audit_log where entity_id = '88920000-0000-4000-8000-000000000061'),
  jsonb_build_object(
    'action', 'order_line.modify', 'entity_table', 'order_lines',
    'entity_id', '88920000-0000-4000-8000-000000000061',
    'before', jsonb_build_object('date', '2028-10-01', 'qty', 2),
    'note', 'Ampliar cupo mismo día'
  ),
  'succès A : ligne audit_log correcte (action/before/note)'
);

-- ===== Tranche 2 (suite) — modify_order_line sur une ligne à plage ==============================
-- Fixtures dédiées, jamais partagées avec le groupe gardes/succès date unique ci-dessus (mêmes
-- partenaire/établissement, IDs disjoints). Migration couverte : 20260817220400_modify_order_
-- line_range_support.sql. Les scénarios chambre d'hôtel (R1/R2/refus) sont partis avec l'étage
-- hôtel (T3 étape 2, 20260827220000) — la branche alojamiento qu'ils doublaient reste couverte.
reset role;

insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, min_qty, max_qty)
values (
  '88920000-0000-4000-8000-000000000073', '88920000-0000-4000-8000-000000000001',
  '88920000-0000-4000-8000-000000000011', 'lodging',
  jsonb_build_object('es', 'Casa Modify Order Line'), 150000, true, 'modify-order-line-lodging', null, null
);

insert into product_availability (product_id, date, capacity, booked)
select '88920000-0000-4000-8000-000000000073', d::date, 5, 0
  from generate_series('2028-12-01'::date, '2028-12-10'::date, interval '1 day') as d;
update product_availability set booked = 1
 where product_id = '88920000-0000-4000-8000-000000000073'
   and date in ('2028-12-01', '2028-12-02', '2028-12-08');
-- Date fermée explicitement, pour le refus tout-ou-rien alojamiento ci-dessous.
insert into product_calendar (product_id, date, open) values
  ('88920000-0000-4000-8000-000000000073', '2028-12-09', false);

insert into order_lines (
  id, order_id, account_id, product_id, date, end_date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  -- L1 : succès alojamiento, déplacement + augmentation de qty, sans nuit commune.
  ('88920000-0000-4000-8000-000000000084', '88920000-0000-4000-8000-000000000041',
   '88920000-0000-4000-8000-000000000032', '88920000-0000-4000-8000-000000000073',
   '2028-12-01', '2028-12-03', 1, 'reserved',
   'Holder Modify Lodging Range', 150000, 300000, 'direct', 0, 0, 0, 0, 0, 0),
  -- L-closed : refus tout-ou-rien (nuit 09/12 fermée dans le nouvel intervalle).
  ('88920000-0000-4000-8000-000000000085', '88920000-0000-4000-8000-000000000041',
   '88920000-0000-4000-8000-000000000032', '88920000-0000-4000-8000-000000000073',
   '2028-12-08', '2028-12-09', 1, 'reserved',
   'Holder Modify Lodging Closed', 150000, 150000, 'direct', 0, 0, 0, 0, 0, 0);

set local role authenticated;
select test_login('88920000-0000-4000-8000-000000000031'); -- admin

-- Cas 11 : p_new_end_date fourni sur une ligne à date unique → exception (jamais de conversion
-- date unique -> plage dans cette RPC, cf. entête de 20260817220400).
select throws_ok(
  $$ select modify_order_line('88920000-0000-4000-8000-000000000051', '2028-09-01', 1, 'Motivo válido', '2028-09-05') $$,
  'P0001'::char(5),
  'p_new_end_date doit rester null pour une ligne à date unique — transformer une ligne à date unique en ligne à plage (ou l''inverse) est hors périmètre',
  'cas 11 : p_new_end_date fourni sur une ligne à date unique → exception'
);
reset role;
select is(
  (select jsonb_build_object('status', status, 'date', date, 'qty', qty)
     from order_lines where id = '88920000-0000-4000-8000-000000000051'),
  jsonb_build_object('status', 'reserved', 'date', '2028-09-01'::date, 'qty', 1),
  'cas 11 : ligne G toujours intacte après le refus'
);
set local role authenticated;
select test_login('88920000-0000-4000-8000-000000000031');

-- Cas 12 : p_new_end_date manquant sur une ligne à plage → exception. Aucune écriture avant ce
-- garde — la ligne L1 est réutilisée juste après pour son vrai test.
select throws_ok(
  $$ select modify_order_line('88920000-0000-4000-8000-000000000084', '2028-12-04', 2, 'Motivo válido') $$,
  'P0001'::char(5),
  'p_new_end_date obligatoire pour modifier une ligne à plage (alojamiento)',
  'cas 12 : p_new_end_date manquant sur une ligne à plage → exception'
);

-- ===== L1 : succès alojamiento — nouvel intervalle SANS nuit commune, qty 1→2 ===================
create temp table tmp_modify_l1 as
  select modify_order_line(
    '88920000-0000-4000-8000-000000000084', '2028-12-04', 2, 'Cliente cambió de casa completa',
    '2028-12-06'
  ) as result;
select is(
  (select result->>'ok' from tmp_modify_l1), 'true',
  'L1 : appel réussi (nouvelles nuits + qty 1→2, alojamiento)'
);
reset role;
select is(
  (select jsonb_build_object('date', date, 'end_date', end_date, 'qty', qty,
          'status', status, 'price_cop', price_cop, 'total_cop', total_cop)
     from order_lines where id = (select (result->>'order_line_id')::uuid from tmp_modify_l1)),
  jsonb_build_object(
    'date', '2028-12-04'::date, 'end_date', '2028-12-06'::date, 'qty', 2,
    'status', 'reserved', 'price_cop', 300000, 'total_cop', 600000
  ),
  -- Correctif 20260916120000 (renverse 20260818250000) : qty désigne des unités facturables
  -- (lits/chambres selon lodging_kind), jamais des occupants — 150000/nuit × 2 nuits = 300000,
  -- MULTIPLIÉ par qty=2 → 600000. price_cop reste le prix par unité (total_cop / qty = 300000).
  'L1 : nouvelle ligne correcte (date/end_date/qty/prix, total_cop multiplié par qty)'
);
select is(
  (select booked from product_availability
    where product_id = '88920000-0000-4000-8000-000000000073' and date = '2028-12-01'),
  0, 'L1 : ancienne nuit 01/12 libérée'
);
select is(
  (select booked from product_availability
    where product_id = '88920000-0000-4000-8000-000000000073' and date = '2028-12-02'),
  0, 'L1 : ancienne nuit 02/12 libérée'
);
select is(
  (select booked from product_availability
    where product_id = '88920000-0000-4000-8000-000000000073' and date = '2028-12-04'),
  2, 'L1 : nouvelle nuit 04/12 consommée (0 + 2 = 2)'
);
select is(
  (select booked from product_availability
    where product_id = '88920000-0000-4000-8000-000000000073' and date = '2028-12-05'),
  2, 'L1 : nouvelle nuit 05/12 consommée (0 + 2 = 2)'
);
drop table tmp_modify_l1;

-- ===== Refus tout-ou-rien : alojamiento, nuit fermée dans le nouvel intervalle (09/12) ===========
set local role authenticated;
select test_login('88920000-0000-4000-8000-000000000031');
select throws_ok(
  $$ select modify_order_line(
       '88920000-0000-4000-8000-000000000085', '2028-12-08', 1, 'Motivo válido', '2028-12-10'
     ) $$,
  'P0001'::char(5),
  'nuit 2028-12-09 fermée pour ce produit',
  'refus alojamiento : nuit 09/12 fermée dans le nouvel intervalle → exception'
);
reset role;
select is(
  (select jsonb_build_object('status', status, 'date', date, 'end_date', end_date, 'qty', qty)
     from order_lines where id = '88920000-0000-4000-8000-000000000085'),
  jsonb_build_object('status', 'reserved', 'date', '2028-12-08'::date, 'end_date', '2028-12-09'::date, 'qty', 1),
  'refus alojamiento : ligne d''origine intacte (tout ou rien)'
);
select is(
  (select booked from product_availability
    where product_id = '88920000-0000-4000-8000-000000000073' and date = '2028-12-08'),
  1, 'refus alojamiento : nuit 08/12 (ancienne) jamais libérée'
);
select is(
  (select booked from product_availability
    where product_id = '88920000-0000-4000-8000-000000000073' and date = '2028-12-09'),
  0, 'refus alojamiento : nuit 09/12 (fermée) jamais touchée'
);

-- ===== Cas 13 (gap découvert en session, produit jetski réel — 20260818090000) : branche =========
-- ===== historique, products.default_capacity, même fallback de matérialisation que create_order ==
reset role;
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug,
                       min_qty, max_qty, default_capacity)
values (
  '88920000-0000-4000-8000-000000000091', '88920000-0000-4000-8000-000000000001',
  '88920000-0000-4000-8000-000000000011', 'activity',
  jsonb_build_object('es', 'Actividad Modify Default Capacity'), 50000, true,
  'modify-order-line-default-capacity', 1, null, 2
);
insert into product_availability (product_id, date, capacity, booked) values
  ('88920000-0000-4000-8000-000000000091', '2028-11-01', 5, 1);
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '88920000-0000-4000-8000-000000000092', '88920000-0000-4000-8000-000000000041',
  '88920000-0000-4000-8000-000000000032', '88920000-0000-4000-8000-000000000091',
  '2028-11-01', 1, 'reserved', 'Holder Modify Order Line',
  50000, 50000, 'direct', 0, 0, 0, 0, 0, 0
);
set local role authenticated;
select test_login('88920000-0000-4000-8000-000000000031');

-- Cas 13a : déplacer vers 2028-11-05, JAMAIS configurée — default_capacity=2 comble le vide (même
-- fallback que create_order), matérialise product_availability(capacity=2, booked=0) avant
-- verrouillage puis applique le delta normal (qty 1→2).
create temp table tmp_modify_13a as
  select modify_order_line(
    '88920000-0000-4000-8000-000000000092', '2028-11-05', 2, 'Fecha sin configurar, usa el cupo por defecto'
  ) as result;
select is(
  (select result->>'ok' from tmp_modify_13a), 'true',
  'cas 13a : succès vers une date jamais configurée (default_capacity comble le vide)'
);
select is(
  (select jsonb_build_object('capacity', capacity, 'booked', booked)
     from product_availability
    where product_id = '88920000-0000-4000-8000-000000000091' and date = '2028-11-05'),
  jsonb_build_object('capacity', 2, 'booked', 2),
  'cas 13a : ligne matérialisée avec capacity=default_capacity, booked=nouvelle qty'
);
select is(
  (select booked from product_availability
    where product_id = '88920000-0000-4000-8000-000000000091' and date = '2028-11-01'),
  0,
  'cas 13a : date source libérée (1 → 0)'
);

-- Cas 13b : redéplacer la ligne issue du cas 13a vers 2028-11-08 (jamais configurée non plus) avec
-- qty=3 > default_capacity=2 → capacité insuffisante, même message que la garde existante (cas 10),
-- rien écrit sur 11-08 (jamais matérialisée avec un booked > 0 par erreur).
select throws_ok(
  format(
    $$ select modify_order_line('%s', '2028-11-08', 3, 'Motivo válido') $$,
    (select (result->>'order_line_id')::uuid from tmp_modify_13a)
  ),
  'P0001'::char(5), null,
  'cas 13b : qty=3 > default_capacity=2 sur une date jamais configurée → exception'
);
select is(
  (select count(*) from product_availability
    where product_id = '88920000-0000-4000-8000-000000000091' and date = '2028-11-08')::int,
  0,
  'cas 13b : raise exception annule aussi la matérialisation par défaut (rien ne persiste)'
);
drop table tmp_modify_13a;

-- Cas 13c : override admin déjà posé (capacity=1) sur la date cible — jamais écrasé par
-- default_capacity=2. Ligne source dédiée (2028-11-02), qty demandée=2 tient dans default_capacity
-- mais PAS dans l'override admin (1) : la capacité effectivement utilisée doit être celle de
-- l'admin, pas celle du produit.
reset role;
insert into product_availability (product_id, date, capacity, booked) values
  ('88920000-0000-4000-8000-000000000091', '2028-11-02', 5, 1),
  ('88920000-0000-4000-8000-000000000091', '2028-11-09', 1, 0);
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '88920000-0000-4000-8000-000000000093', '88920000-0000-4000-8000-000000000041',
  '88920000-0000-4000-8000-000000000032', '88920000-0000-4000-8000-000000000091',
  '2028-11-02', 1, 'reserved', 'Holder Modify Order Line',
  50000, 50000, 'direct', 0, 0, 0, 0, 0, 0
);
set local role authenticated;
select test_login('88920000-0000-4000-8000-000000000031');
select throws_ok(
  $$ select modify_order_line('88920000-0000-4000-8000-000000000093', '2028-11-09', 2, 'Motivo válido') $$,
  'P0001'::char(5), null,
  'cas 13c : override admin (capacity=1) jamais écrasé par default_capacity=2 → capacité insuffisante sur qty=2'
);
select is(
  (select capacity from product_availability
    where product_id = '88920000-0000-4000-8000-000000000091' and date = '2028-11-09'),
  1,
  'cas 13c : capacity reste celle posée par l''admin (1), jamais remplacée par default_capacity'
);

-- Cas 14 (spec 18 Tranche 1) : ligne à créneau horaire (slot_start_time non null) explicitement
-- exclue — hors périmètre Tranche 1 (spec 18 §2 Portée-Out), même traitement que la garde camp
-- (cas 6) : sans ce refus, cette ligne tomberait silencieusement dans la branche "date unique" et
-- corromprait product_availability au lieu de product_slot_availability.
reset role;
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug,
                       min_qty, max_qty)
values (
  '88920000-0000-4000-8000-000000000025', '88920000-0000-4000-8000-000000000001',
  '88920000-0000-4000-8000-000000000011', 'activity',
  jsonb_build_object('es', 'Actividad Modify Slot Guard'), 50000, true, 'modify-order-line-slot',
  1, null
);
insert into product_slot_rules (product_id, weekdays, start_time, end_time, slot_duration_minutes, capacity)
values (
  '88920000-0000-4000-8000-000000000025', array[1, 2, 3, 4, 5, 6, 7]::smallint[], '09:00', '10:00', 30, 5
);
insert into order_lines (
  id, order_id, account_id, product_id, date, slot_start_time, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '88920000-0000-4000-8000-000000000054', '88920000-0000-4000-8000-000000000041',
  '88920000-0000-4000-8000-000000000032', '88920000-0000-4000-8000-000000000025',
  '2028-09-01', '09:00', 1, 'reserved', 'Holder Modify Order Line',
  50000, 50000, 'direct', 0, 0, 0, 0, 0, 0
);
set local role authenticated;
select throws_ok(
  $$ select modify_order_line('88920000-0000-4000-8000-000000000054', '2028-09-02', 1, 'Motivo válido') $$,
  'P0001'::char(5),
  'modify_order_line ne gère pas encore les réservations par créneau horaire — annuler puis recréer manuellement',
  'cas 14 : ligne à créneau horaire → exception (hors périmètre Tranche 1)'
);
reset role;
select is(
  (select status from order_lines where id = '88920000-0000-4000-8000-000000000054'),
  'reserved',
  'cas 14 : ligne à créneau inchangée'
);

-- ===== Cas 15-16 (spec 20 §0) : élargissement d'autorisation à l'operator =========================
-- Fixtures dédiées : produit isolé (026), operator actif sur l'établissement propriétaire (035,
-- établissement 011) et operator actif mais sur un AUTRE établissement (036, établissement 013) —
-- même patron que set_order_line_status.test.sql cas 7/8.
reset role;
insert into partners (id, display_name) values
  ('88920000-0000-4000-8000-000000000002', 'Modify Order Line Operator Partner'),
  ('88920000-0000-4000-8000-000000000003', 'Modify Order Line Other Partner');
insert into establishments (id, partner_id, name) values
  ('88920000-0000-4000-8000-000000000013', '88920000-0000-4000-8000-000000000003',
   jsonb_build_object('es', 'Otro Establecimiento Modify'));
insert into auth.users (id, email) values
  ('88920000-0000-4000-8000-000000000035', 'modify-order-line-operator-ok@test.local'),
  ('88920000-0000-4000-8000-000000000036', 'modify-order-line-operator-wrong@test.local');
-- Trigger on_auth_user_created provisionne déjà partner_accounts(id) avec partner_id null — UPDATE,
-- jamais un second INSERT (même piège que set_order_line_status.test.sql).
update partner_accounts set partner_id = '88920000-0000-4000-8000-000000000001'
 where id = '88920000-0000-4000-8000-000000000035';
update partner_accounts set partner_id = '88920000-0000-4000-8000-000000000003'
 where id = '88920000-0000-4000-8000-000000000036';
-- operator ⇒ referrer (trigger enforce_operator_implies_referrer) : capacité referrer active requise
-- avant toute capacité operator sur le même partner_id.
insert into partner_capabilities (partner_id, role, source, status)
values
  ('88920000-0000-4000-8000-000000000001', 'referrer', 'migration', 'active'),
  ('88920000-0000-4000-8000-000000000003', 'referrer', 'migration', 'active');
insert into partner_capabilities (partner_id, role, establishment_id, source, status)
values
  ('88920000-0000-4000-8000-000000000001', 'operator', '88920000-0000-4000-8000-000000000011',
   'migration', 'active'),
  ('88920000-0000-4000-8000-000000000003', 'operator', '88920000-0000-4000-8000-000000000013',
   'migration', 'active');

insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, min_qty, max_qty)
values (
  '88920000-0000-4000-8000-000000000026', '88920000-0000-4000-8000-000000000001',
  '88920000-0000-4000-8000-000000000011', 'activity',
  jsonb_build_object('es', 'Actividad Modify Operator'), 50000, true, 'modify-order-line-operator',
  1, null
);
insert into product_availability (product_id, date, capacity, booked) values
  ('88920000-0000-4000-8000-000000000026', '2028-11-25', 5, 2),
  ('88920000-0000-4000-8000-000000000026', '2028-11-26', 5, 0);
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  ('88920000-0000-4000-8000-000000000094', '88920000-0000-4000-8000-000000000041',
   '88920000-0000-4000-8000-000000000032', '88920000-0000-4000-8000-000000000026',
   '2028-11-25', 1, 'reserved', 'Holder Modify Order Line', 50000, 50000, 'direct', 0, 0, 0, 0, 0, 0),
  ('88920000-0000-4000-8000-000000000095', '88920000-0000-4000-8000-000000000041',
   '88920000-0000-4000-8000-000000000032', '88920000-0000-4000-8000-000000000026',
   '2028-11-25', 1, 'reserved', 'Holder Modify Order Line', 50000, 50000, 'direct', 0, 0, 0, 0, 0, 0);

set local role authenticated;

-- Cas 15 : operator actif sur l'établissement propriétaire (011) → succès (branche date unique déjà
-- couverte sous admin ci-dessus — seule l'autorisation change ici).
select test_login('88920000-0000-4000-8000-000000000035'); -- operator_ok, établissement 011
create temp table tmp_modify_15 as
  select modify_order_line(
    '88920000-0000-4000-8000-000000000094', '2028-11-26', 2, 'Cliente pidió cambiar de día (socio)'
  ) as result;
select is(
  (select result->>'ok' from tmp_modify_15), 'true',
  'cas 15 : operator de l''établissement propriétaire → succès'
);
reset role;
select is(
  (select status from order_lines where id = '88920000-0000-4000-8000-000000000094'),
  'superseded',
  'cas 15 : ancienne ligne marquée superseded par l''appel operator'
);
drop table tmp_modify_15;

-- Cas 16 : operator actif mais sur un AUTRE établissement (013 ≠ 011) → refusé, message mis à jour.
set local role authenticated;
select test_login('88920000-0000-4000-8000-000000000036'); -- operator_wrong, établissement 013
select throws_ok(
  $$ select modify_order_line(
       '88920000-0000-4000-8000-000000000095', '2028-11-26', 2, 'Tentative operator mauvais établissement'
     ) $$,
  '42501'::char(5),
  'modify_order_line réservé au rôle admin (ou à l''operator du même établissement)',
  'cas 16 : operator d''un autre établissement → refusé'
);
-- order_lines_select_operator scope operator_wrong à SON établissement (013) : la ligne 095 lui est
-- invisible — bascule admin pour vérifier l'état réel, même patron que set_order_line_status cas 8.
select test_login('88920000-0000-4000-8000-000000000031'); -- admin
reset role;
select is(
  (select status from order_lines where id = '88920000-0000-4000-8000-000000000095'),
  'reserved',
  'cas 16 : statut inchangé après le refus'
);

select * from finish();
rollback;

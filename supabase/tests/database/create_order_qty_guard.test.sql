-- Migration 20260929112240 — contraintes de bornes (cart_items.qty, order_lines.qty et montants,
-- booked des trois tables de capacité) et garde « qty ≥ 1 pour tout type » de create_order.
--
-- La garde de create_order est DERRIÈRE la contrainte cart_items_qty_positive : un panier ne peut
-- plus porter qty ≤ 0, donc la seule façon de prouver la garde elle-même est de retirer la
-- contrainte le temps du fichier. C'est fait DANS la transaction du test (DDL transactionnel,
-- annulé par le rollback final) — sans ce retrait, la mutation « garde supprimée » resterait verte.
-- Les appels passent par test_try_create_order : sans la garde, create_order ne renvoie pas un
-- motif mais heurte une AUTRE contrainte de la même migration (booked >= 0, montants >= 0) — le
-- helper transforme cette erreur en valeur, l'assertion rougit sans interrompre le fichier.
-- ⚠️ Conséquence : verrou ACCESS EXCLUSIVE sur cart_items de ce retrait jusqu'à la fin du fichier.
-- Sans effet en CI (fichiers exécutés l'un après l'autre) ; sur une base locale partagée, une autre
-- session qui touche cart_items attend la fin de ce fichier (quelques secondes). lock_timeout borne
-- l'attente inverse : si une autre session tient déjà cart_items, le retrait échoue en 5 s (55P03)
-- au lieu de faire patienter derrière lui toute session qui touche le panier. Ces cas vivent dans
-- ce fichier dédié plutôt que dans create_order.test.sql pour garder ce verrou court.
begin;
select plan(23);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Motif de refus de create_order, ou « sqlstate <code> » si elle lève une erreur (cf. en-tête).
create function test_try_create_order(p_holder text) returns text language plpgsql as $$
begin
  return create_order(p_holder, 'qty-guard@test.local')->>'reason';
exception when others then
  return 'sqlstate ' || sqlstate;
end;
$$;

insert into partners (id, display_name) values
  ('89930000-0000-4000-8000-000000000001', 'Qty Guard Test Partner');
insert into establishments (id, partner_id, name, lobby_connector_active, lobby_api_token) values
  ('89930000-0000-4000-8000-000000000011', '89930000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Qty Guard'), true, 'test-token-qty-guard');
insert into auth.users (id, email) values
  ('89930000-0000-4000-8000-000000000021', 'qty-guard-buyer@test.local');

-- 031 : logement local (nuits posées ci-dessous) ; 032 : logement PMS-backed (connecteur actif) ;
-- 033 : activité à min_qty = 0 (aucune contrainte produit ne l'interdit) — sans la garde
-- universelle, qty 0 y passait la borne min_qty ; 034 : activité ordinaire, commande valide de
-- référence (contraintes order_lines) et support des lignes créneau/ressource.
insert into products (
  id, partner_id, establishment_id, type, name, price_cop, sellable, slug,
  lobby_category_id, min_qty, default_capacity
)
values
  ('89930000-0000-4000-8000-000000000031', '89930000-0000-4000-8000-000000000001',
   '89930000-0000-4000-8000-000000000011', 'lodging', jsonb_build_object('es', 'Alojamiento Qty Guard'),
   80000, true, 'qty-guard-lodging', null, null, null),
  ('89930000-0000-4000-8000-000000000032', '89930000-0000-4000-8000-000000000001',
   '89930000-0000-4000-8000-000000000011', 'lodging', jsonb_build_object('es', 'Alojamiento PMS Qty Guard'),
   80000, true, 'qty-guard-lodging-pms', 9731, null, null),
  ('89930000-0000-4000-8000-000000000033', '89930000-0000-4000-8000-000000000001',
   '89930000-0000-4000-8000-000000000011', 'activity', jsonb_build_object('es', 'Actividad Min Cero'),
   50000, true, 'qty-guard-activity-min-zero', null, 0, 5),
  ('89930000-0000-4000-8000-000000000034', '89930000-0000-4000-8000-000000000001',
   '89930000-0000-4000-8000-000000000011', 'activity', jsonb_build_object('es', 'Actividad Qty Guard'),
   50000, true, 'qty-guard-activity', null, null, null);

insert into product_availability (product_id, date, capacity, booked) values
  ('89930000-0000-4000-8000-000000000031', '2029-11-01', 10, 0),
  ('89930000-0000-4000-8000-000000000031', '2029-11-02', 10, 0),
  ('89930000-0000-4000-8000-000000000034', '2029-11-06', 5, 0);
insert into product_slot_availability (
  product_id, slot_date, slot_start_time, slot_duration_minutes, capacity, booked
) values
  ('89930000-0000-4000-8000-000000000034', '2029-11-05', '10:00', 60, 2, 0);
insert into provider_resource_calendar (establishment_id, slot_date, capacity, booked) values
  ('89930000-0000-4000-8000-000000000011', '2029-11-05', 2, 0);

-- 1. cart_items.qty > 0, par le même chemin qu'un vrai client (RLS directe, rôle authenticated).
set local role authenticated;
select test_login('89930000-0000-4000-8000-000000000021');
select throws_ok(
  $$insert into cart_items (account_id, product_id, date, end_date, qty) values
    ('89930000-0000-4000-8000-000000000021', '89930000-0000-4000-8000-000000000031',
     '2029-11-01', '2029-11-03', -10)$$,
  '23514', null,
  'cart_items : qty -10 refusée par cart_items_qty_positive'
);
select throws_ok(
  $$insert into cart_items (account_id, product_id, date, end_date, qty) values
    ('89930000-0000-4000-8000-000000000021', '89930000-0000-4000-8000-000000000031',
     '2029-11-01', '2029-11-03', 0)$$,
  '23514', null,
  'cart_items : qty 0 refusée par cart_items_qty_positive'
);

-- 2. order_lines : qty > 0 et montants >= 0, sur une ligne réellement écrite par create_order.
insert into cart_items (account_id, product_id, date, qty) values
  ('89930000-0000-4000-8000-000000000021', '89930000-0000-4000-8000-000000000034', '2029-11-06', 1);
select is(
  (select create_order('Holder Qty Guard Valid', 'qty-guard-valid@test.local')->>'ok'),
  'true',
  'commande de référence acceptée (activité, qty 1)'
);
reset role;
select throws_ok(
  $$update order_lines set qty = 0 where product_id = '89930000-0000-4000-8000-000000000034'$$,
  '23514', null, 'order_lines : qty 0 refusée par order_lines_qty_positive'
);
select throws_ok(
  $$update order_lines set price_cop = -1 where product_id = '89930000-0000-4000-8000-000000000034'$$,
  '23514', null, 'order_lines : price_cop négatif refusé'
);
select throws_ok(
  $$update order_lines set total_cop = -1 where product_id = '89930000-0000-4000-8000-000000000034'$$,
  '23514', null, 'order_lines : total_cop négatif refusé'
);
select throws_ok(
  $$update order_lines set acompte_cop = -1 where product_id = '89930000-0000-4000-8000-000000000034'$$,
  '23514', null, 'order_lines : acompte_cop négatif refusé'
);
select throws_ok(
  $$update order_lines set referrer_commission_cop = -1 where product_id = '89930000-0000-4000-8000-000000000034'$$,
  '23514', null, 'order_lines : referrer_commission_cop négatif refusé'
);
select throws_ok(
  $$update order_lines set app_commission_cop = -1 where product_id = '89930000-0000-4000-8000-000000000034'$$,
  '23514', null, 'order_lines : app_commission_cop négatif refusé'
);

-- 3. booked >= 0 et booked <= capacity sur les trois tables de capacité (borne haute incluse).
select throws_ok(
  $$update product_availability set booked = capacity + 1
     where product_id = '89930000-0000-4000-8000-000000000031' and date = '2029-11-01'$$,
  '23514', null, 'product_availability : booked > capacity refusé'
);
select throws_ok(
  $$update product_availability set booked = -1
     where product_id = '89930000-0000-4000-8000-000000000031' and date = '2029-11-01'$$,
  '23514', null, 'product_availability : booked négatif refusé'
);
select lives_ok(
  $$update product_availability set booked = capacity
     where product_id = '89930000-0000-4000-8000-000000000031' and date = '2029-11-01'$$,
  'product_availability : booked = capacity accepté (borne incluse)'
);
update product_availability set booked = 0
 where product_id = '89930000-0000-4000-8000-000000000031' and date = '2029-11-01';
select throws_ok(
  $$update product_slot_availability set booked = capacity + 1
     where product_id = '89930000-0000-4000-8000-000000000034' and slot_date = '2029-11-05'$$,
  '23514', null, 'product_slot_availability : booked > capacity refusé'
);
select throws_ok(
  $$update product_slot_availability set booked = -1
     where product_id = '89930000-0000-4000-8000-000000000034' and slot_date = '2029-11-05'$$,
  '23514', null, 'product_slot_availability : booked négatif refusé'
);
select throws_ok(
  $$update provider_resource_calendar set booked = capacity + 1
     where establishment_id = '89930000-0000-4000-8000-000000000011' and slot_date = '2029-11-05'$$,
  '23514', null, 'provider_resource_calendar : booked > capacity refusé'
);
select throws_ok(
  $$update provider_resource_calendar set booked = -1
     where establishment_id = '89930000-0000-4000-8000-000000000011' and slot_date = '2029-11-05'$$,
  '23514', null, 'provider_resource_calendar : booked négatif refusé'
);

-- 4. La garde de create_order elle-même, derrière la contrainte retirée (cf. en-tête).
set local lock_timeout = '5s';
alter table public.cart_items drop constraint cart_items_qty_positive;
reset lock_timeout;
set local role authenticated;

-- 4a. Logement à plage, qty -10 : la branche lodging n'avait aucune borne.
delete from cart_items where account_id = '89930000-0000-4000-8000-000000000021';
insert into cart_items (account_id, product_id, date, end_date, qty) values
  ('89930000-0000-4000-8000-000000000021', '89930000-0000-4000-8000-000000000031',
   '2029-11-01', '2029-11-03', -10);
select is(
  (select test_try_create_order('Holder Guard Lodging Neg')),
  'qty_below_minimum',
  'garde : logement à plage qty -10 → qty_below_minimum'
);
select is(
  (select count(*)::int from cart_items where account_id = '89930000-0000-4000-8000-000000000021'),
  1,
  'garde : panier intact après le refus'
);

-- 4b. Logement à plage, qty 0.
delete from cart_items where account_id = '89930000-0000-4000-8000-000000000021';
insert into cart_items (account_id, product_id, date, end_date, qty) values
  ('89930000-0000-4000-8000-000000000021', '89930000-0000-4000-8000-000000000031',
   '2029-11-01', '2029-11-03', 0);
select is(
  (select test_try_create_order('Holder Guard Lodging Zero')),
  'qty_below_minimum',
  'garde : logement à plage qty 0 → qty_below_minimum'
);

-- 4c. Logement PMS-backed (aucun compteur local) qty -10 : sans la garde, seul le montant de la
-- ligne — et donc l'acompte de la commande — devenait négatif.
delete from cart_items where account_id = '89930000-0000-4000-8000-000000000021';
insert into cart_items (account_id, product_id, date, end_date, qty) values
  ('89930000-0000-4000-8000-000000000021', '89930000-0000-4000-8000-000000000032',
   '2029-11-01', '2029-11-03', -10);
select is(
  (select test_try_create_order('Holder Guard Lodging PMS')),
  'qty_below_minimum',
  'garde : logement PMS-backed qty -10 → qty_below_minimum'
);

-- 4d. Activité à min_qty = 0, qty 0 : la borne min_qty produit ne l'arrêtait pas.
delete from cart_items where account_id = '89930000-0000-4000-8000-000000000021';
insert into cart_items (account_id, product_id, date, qty) values
  ('89930000-0000-4000-8000-000000000021', '89930000-0000-4000-8000-000000000033', '2029-11-07', 0);
select is(
  (select test_try_create_order('Holder Guard Min Zero')),
  'qty_below_minimum',
  'garde : activité à min_qty 0, qty 0 → qty_below_minimum (plancher 1 pour tout type)'
);

reset role;
select is(
  (select coalesce(sum(booked), 0)::int from product_availability
    where product_id = '89930000-0000-4000-8000-000000000031'),
  0,
  'garde : aucune nuit du logement décrémentée'
);
select is(
  (select count(*)::int from orders where holder_name like 'Holder Guard%'),
  0,
  'garde : aucune commande écrite pour les quatre refus'
);

select * from finish();
rollback;

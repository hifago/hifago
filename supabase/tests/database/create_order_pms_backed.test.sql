-- Spec 21 — Connecteur LobbyPMS, Phase 2 : create_order, branche alojamiento PMS-backed.
-- Migration 20260819130000_create_order_pms_backed.sql. Ne rejoue PAS la couverture générale déjà
-- faite par create_order.test.sql (plafonds, atomicité, attribution, snapshot commission...) —
-- uniquement le delta introduit par isPmsBacked : zéro verrou/lecture/écriture sur
-- product_availability pour une ligne dont le produit porte lobby_category_id, comparé côte à côte
-- à une ligne non-PMS-backed identique par ailleurs (qui doit, elle, échouer sans
-- product_availability — non-régression explicite).
--
-- Migration 20260929112240 (CLAUDE.md §4.4) : un logement PMS-backed n'est accepté que si le
-- connecteur Lobby de son établissement est actif ET porte un jeton — sinon pms_unavailable (cas 6).
-- L'établissement 011 des cas 1-5 a donc son connecteur actif.
begin;
select plan(13);

insert into partners (id, display_name) values
  ('88930000-0000-4000-8000-000000000001', 'PMS Order Test Partner');
insert into establishments (id, partner_id, name, lobby_connector_active, lobby_api_token) values
  ('88930000-0000-4000-8000-000000000011', '88930000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento PMS Order'), true, 'test-token-011'),
  -- 012 : connecteur coupé (jeton présent) ; 013 : connecteur actif mais sans jeton (cas 6).
  ('88930000-0000-4000-8000-000000000012', '88930000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento PMS Apagado'), false, 'test-token-012'),
  ('88930000-0000-4000-8000-000000000013', '88930000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento PMS Sin Token'), true, null);

insert into auth.users (id, email) values
  ('88930000-0000-4000-8000-000000000021', 'pms-order-buyer@test.local');

-- 031 : lodging PMS-backed (lobby_category_id renseigné) — Lobby fait foi, aucune ligne
-- product_availability ne sera jamais créée pour ce produit par create_order.
-- 032 : lodging NON PMS-backed (lobby_category_id null) — chemin inchangé, sert de témoin de
-- non-régression : mêmes dates, mais AUCUNE ligne product_availability posée non plus → doit
-- échouer en slot_not_found, exactement comme avant cette migration.
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, lobby_category_id) values
  ('88930000-0000-4000-8000-000000000031', '88930000-0000-4000-8000-000000000001',
   '88930000-0000-4000-8000-000000000011', 'lodging',
   jsonb_build_object('es', 'Alojamiento PMS-backed'), 100000, true, 'pms-order-lodging-backed', 9631),
  ('88930000-0000-4000-8000-000000000032', '88930000-0000-4000-8000-000000000001',
   '88930000-0000-4000-8000-000000000011', 'lodging',
   jsonb_build_object('es', 'Alojamiento no PMS'), 100000, true, 'pms-order-lodging-not-backed', null),
  -- 033 (établissement 012, connecteur coupé) et 034 (013, sans jeton) : PMS-backed → refusés.
  -- 035 (012) : NON PMS-backed dans l'établissement au connecteur coupé → témoin, jamais refusé.
  ('88930000-0000-4000-8000-000000000033', '88930000-0000-4000-8000-000000000001',
   '88930000-0000-4000-8000-000000000012', 'lodging',
   jsonb_build_object('es', 'Alojamiento PMS Apagado'), 100000, true, 'pms-order-lodging-off', 9633),
  ('88930000-0000-4000-8000-000000000034', '88930000-0000-4000-8000-000000000001',
   '88930000-0000-4000-8000-000000000013', 'lodging',
   jsonb_build_object('es', 'Alojamiento PMS Sin Token'), 100000, true, 'pms-order-lodging-no-token', 9634),
  ('88930000-0000-4000-8000-000000000035', '88930000-0000-4000-8000-000000000001',
   '88930000-0000-4000-8000-000000000012', 'lodging',
   jsonb_build_object('es', 'Alojamiento Local Apagado'), 100000, true, 'pms-order-lodging-local-off', null);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '88930000-0000-4000-8000-000000000021', 'role', 'authenticated')::text, true);

-- Cas 1 : ligne PMS-backed, AUCUNE ligne product_availability pour ces dates → succès quand même
-- (Lobby est seul juge, jamais consulté par create_order). Panier posé en cart_items (spec 32) :
-- create_order lit désormais ses propres lignes pour auth.uid(), plus un paramètre.
insert into cart_items (account_id, product_id, date, end_date, qty) values
  ('88930000-0000-4000-8000-000000000021', '88930000-0000-4000-8000-000000000031',
   '2028-09-01', '2028-09-03', 2);
select is(
  (select (create_order(
     'Holder PMS Backed', 'pms-backed@test.local'
   ))->>'ok')::boolean,
  true,
  'cas 1 : ligne lodging PMS-backed réussit sans aucune ligne product_availability'
);

-- Cas 2 : témoin — même scénario mais produit NON PMS-backed, mêmes conditions (aucune
-- product_availability) → doit échouer en slot_not_found, comportement inchangé.
insert into cart_items (account_id, product_id, date, end_date, qty) values
  ('88930000-0000-4000-8000-000000000021', '88930000-0000-4000-8000-000000000032',
   '2028-09-01', '2028-09-03', 2);
select is(
  (select create_order(
     'Holder Non PMS', 'non-pms@test.local'
   )),
  jsonb_build_object('ok', false, 'reason', 'slot_not_found',
    'line', jsonb_build_object('product_id', '88930000-0000-4000-8000-000000000032',
      'date', '2028-09-01', 'end_date', '2028-09-03', 'qty', 2, 'slot_start_time', null),
    'date', '2028-09-01'),
  'cas 2 (témoin) : ligne lodging NON PMS-backed échoue toujours en slot_not_found sans product_availability'
);

-- Cas 3 : après le succès du cas 1, aucune ligne product_availability n'a été créée pour le produit
-- PMS-backed (ni par la matérialisation Phase 2 — qui ne concerne que les dates uniques — ni par
-- un quelconque effet de bord de Phase 4).
select is(
  (select count(*)::int from product_availability where product_id = '88930000-0000-4000-8000-000000000031'),
  0,
  'cas 3 : aucune ligne product_availability créée pour le produit PMS-backed'
);

-- Cas 4 : la ligne order_lines a bien été écrite, avec un prix cohérent (2 nuits à 100000 = 200000
-- par unité, MULTIPLIÉ par qty=2 unités facturables — migration 20260916120000, qty désigne des
-- lits/chambres, jamais des occupants → total_cop = 400000, price_cop reste le prix par unité).
reset role;
select is(
  (select jsonb_build_object('price_cop', price_cop, 'total_cop', total_cop, 'pms_booking_id', pms_booking_id)
     from order_lines where product_id = '88930000-0000-4000-8000-000000000031'),
  jsonb_build_object('price_cop', 200000, 'total_cop', 400000, 'pms_booking_id', null),
  'cas 4 : order_lines écrite avec le bon total, pms_booking_id encore null (rempli hors create_order)'
);

-- Cas 5 : reset — même produit PMS-backed, mais cette fois avec une ligne product_availability
-- déjà présente pour ces dates (ex. reliquat d'avant l'activation du connecteur) → reste ignorée,
-- ni verrouillée ni décrémentée, la réservation réussit toujours et booked ne bouge pas.
-- product_availability est RPC-only (INSERT non accordé à authenticated) : reset le rôle pour
-- poser le reliquat, comme les fixtures amont, puis revenir sur l'identité acheteuse pour l'appel.
reset role;
insert into product_availability (product_id, date, capacity, booked) values
  ('88930000-0000-4000-8000-000000000031', '2028-10-01', 5, 2),
  ('88930000-0000-4000-8000-000000000031', '2028-10-02', 5, 2);
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '88930000-0000-4000-8000-000000000021', 'role', 'authenticated')::text, true);
-- Cas 2 (témoin) a échoué juste au-dessus : sa ligne cart_items reste (create_order ne vide le
-- panier qu'en cas de succès, spec 32 §0) — purgée ici avant de poser celle du cas 5, sans quoi le
-- panier porterait deux lignes et la seconde (produit 032, dates du cas 2) ferait échouer tout le
-- panier en tout-ou-rien.
delete from cart_items where account_id = '88930000-0000-4000-8000-000000000021';
insert into cart_items (account_id, product_id, date, end_date, qty) values
  ('88930000-0000-4000-8000-000000000021', '88930000-0000-4000-8000-000000000031',
   '2028-10-01', '2028-10-03', 1);
select is(
  (select (create_order(
     'Holder PMS Backed Residual', 'pms-backed-residual@test.local'
   ))->>'ok')::boolean,
  true,
  'cas 5 : ligne PMS-backed réussit même avec une ligne product_availability résiduelle préexistante'
);
select is(
  (select booked from product_availability
    where product_id = '88930000-0000-4000-8000-000000000031' and date = '2028-10-01'),
  2,
  'cas 5 : booked résiduel jamais décrémenté pour une ligne PMS-backed'
);
select is(
  (select booked from product_availability
    where product_id = '88930000-0000-4000-8000-000000000031' and date = '2028-10-02'),
  2,
  'cas 5 : booked résiduel jamais décrémenté (2e nuit)'
);

-- Cas 6 (migration 20260929112240, CLAUDE.md §4.4) : un logement PMS-backed dont le connecteur est
-- coupé, ou sans jeton, n'a plus aucun contrôle de capacité (ni local ni Lobby : la route
-- reserve-nights écarte cet établissement) → refusé avant tout verrou, aucune commande, panier
-- intact. Le panier du cas 5 a été vidé par son succès.
select is(
  (select count(*)::int from cart_items where account_id = '88930000-0000-4000-8000-000000000021'),
  0,
  'cas 6 (préalable) : panier vide après le succès du cas 5'
);
insert into cart_items (account_id, product_id, date, end_date, qty) values
  ('88930000-0000-4000-8000-000000000021', '88930000-0000-4000-8000-000000000033',
   '2028-11-01', '2028-11-03', 1);
select is(
  (select create_order('Holder PMS Off', 'pms-off@test.local')->>'reason'),
  'pms_unavailable',
  'cas 6a : logement PMS-backed, connecteur coupé → pms_unavailable'
);
select is(
  (select count(*)::int from cart_items where account_id = '88930000-0000-4000-8000-000000000021'),
  1,
  'cas 6a : panier intact après le refus'
);

delete from cart_items where account_id = '88930000-0000-4000-8000-000000000021';
insert into cart_items (account_id, product_id, date, end_date, qty) values
  ('88930000-0000-4000-8000-000000000021', '88930000-0000-4000-8000-000000000034',
   '2028-11-01', '2028-11-03', 1);
select is(
  (select create_order('Holder PMS No Token', 'pms-no-token@test.local')->>'reason'),
  'pms_unavailable',
  'cas 6b : logement PMS-backed, connecteur actif mais sans jeton → pms_unavailable'
);

-- Cas 6c (témoin) : logement NON PMS-backed du même établissement au connecteur coupé → la garde
-- ne le concerne pas, il passe par son contrôle local habituel (nuits posées ci-dessous).
reset role;
insert into product_availability (product_id, date, capacity, booked) values
  ('88930000-0000-4000-8000-000000000035', '2028-11-01', 5, 0),
  ('88930000-0000-4000-8000-000000000035', '2028-11-02', 5, 0);
set local role authenticated;
delete from cart_items where account_id = '88930000-0000-4000-8000-000000000021';
insert into cart_items (account_id, product_id, date, end_date, qty) values
  ('88930000-0000-4000-8000-000000000021', '88930000-0000-4000-8000-000000000035',
   '2028-11-01', '2028-11-03', 1);
select is(
  (select create_order('Holder Local Off', 'local-off@test.local')->>'ok'),
  'true',
  'cas 6c (témoin) : logement non PMS-backed d''un établissement au connecteur coupé → accepté'
);

reset role;
select is(
  (select count(*)::int from orders where holder_name in ('Holder PMS Off', 'Holder PMS No Token')),
  0,
  'cas 6 : aucune commande écrite pour les deux refus'
);

select * from finish();
rollback;

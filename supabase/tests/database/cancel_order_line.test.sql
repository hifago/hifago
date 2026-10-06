-- Spec 34 Tranche 2 — cancel_order_line : l'annulation d'UNE prestation.
-- Migration 20260911110000_cancel_order_line.sql, seule source de vérité pour les reasons.
--
-- Depuis la migration 20261006192424, l'annulation REND la place (compteur de capacité) sous les
-- verrous `orders` → ligne → capacité : sa concurrence est prouvée par
-- tests/concurrency/cancel_order_line.concurrency.mjs, et ses règles d'argent, de remboursement et
-- d'e-mail par order_line_cancellations.test.sql. Ce fichier garde les gardes et la file LobbyPMS.
--
-- ⚠️ DEUX ASSERTIONS PORTENT TOUT LE LOT :
--   — cas 6 : la prestation SŒUR ne bouge pas. C'est le renversement du cahier §2c fait exécutable ;
--     elle rougit à la seconde où quelqu'un réintroduit « annuler toute la commande ».
--   — cas 12/13 : la file d'annulation LobbyPMS n'enfile QU'AU DERNIER `reserved` du booking
--     partagé. Ce chemin n'avait JAMAIS tourné ligne par ligne (avec cancel_order, toutes les
--     lignes mouraient dans la même instruction) : sans ces deux assertions, retirer une activité
--     d'un séjour pourrait annuler la nuit d'hôtel chez le PMS, et rien ne le dirait.
--
-- Fixtures créées directement en SQL (orders/order_lines RPC-only) : ce fichier tourne en tant que
-- postgres, qui contourne les grants — même geste que cancel_order.test.sql.
begin;
select plan(15);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Cas 1 : rôle authenticated sans aucun claim JWT, AVANT toute fixture.
set local role authenticated;
select is(
  (select public.cancel_order_line('00000000-0000-4000-8000-000000000099'::uuid)->>'reason'),
  'not_authenticated',
  'rôle authenticated sans JWT claims → not_authenticated'
);
reset role;

-- ---------------------------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------------------------
insert into partners (id, display_name) values
  ('88892000-0000-4000-8000-000000000001', 'Cancel Line Test Partner');

-- Deux établissements : un ordinaire, un adossé au PMS (pour les cas 12/13).
insert into establishments (id, partner_id, name, slug) values
  ('88892000-0000-4000-8000-000000000011', '88892000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Cancel Line'), 'est-cancel-line');
insert into establishments (id, partner_id, name, slug, lobby_connector_active) values
  ('88892000-0000-4000-8000-000000000012', '88892000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento PMS Cancel Line'), 'est-pms-cancel-line', true);

insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('88892000-0000-4000-8000-000000000021', '88892000-0000-4000-8000-000000000001',
   '88892000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Actividad Cancel Line'), 50000, true, 'cancel-line-test'),
  ('88892000-0000-4000-8000-000000000022', '88892000-0000-4000-8000-000000000001',
   '88892000-0000-4000-8000-000000000012', 'lodging',
   jsonb_build_object('es', 'Alojamiento PMS Cancel Line'), 80000, true, 'cancel-line-pms-test');

-- `booked` volontairement NON nul : le cas 11 prouve que la place annulée est rendue (3 → 2).
insert into product_availability (product_id, date, capacity, booked) values
  ('88892000-0000-4000-8000-000000000021', '2028-11-01', 10, 3);

insert into auth.users (id, email) values
  ('88892000-0000-4000-8000-000000000031', 'cl-owner@test.local'),
  ('88892000-0000-4000-8000-000000000032', 'cl-other@test.local'),
  ('88892000-0000-4000-8000-000000000033', 'cl-anon@test.local');

update auth.users set is_anonymous = true
 where id = '88892000-0000-4000-8000-000000000033';

insert into orders (id, account_id, holder_name, holder_email) values
  ('88892000-0000-4000-8000-000000000041', '88892000-0000-4000-8000-000000000031', 'CL Owner', 'o@test.local'),
  ('88892000-0000-4000-8000-000000000042', '88892000-0000-4000-8000-000000000032', 'CL Other', 'ot@test.local'),
  ('88892000-0000-4000-8000-000000000043', '88892000-0000-4000-8000-000000000033', 'CL Anon', 'an@test.local'),
  ('88892000-0000-4000-8000-000000000044', '88892000-0000-4000-8000-000000000031', 'CL PMS', 'pms@test.local');

-- Commande OWNER : DEUX prestations reserved (cas 5-8) + une fulfilled (cas 9-10).
-- `qty` distincts : identifie chaque ligne par un attribut d'origine stable, jamais par son statut
-- qui vient justement de changer (même précaution que cancel_order.test.sql).
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  ('88892000-0000-4000-8000-000000000051', '88892000-0000-4000-8000-000000000041',
   '88892000-0000-4000-8000-000000000031', '88892000-0000-4000-8000-000000000021',
   '2028-11-01', 1, 'reserved', 'CL Owner', 50000, 50000, 'direct', 0.17, 0.10, 0.07, 8500, 5000, 3500),
  ('88892000-0000-4000-8000-000000000052', '88892000-0000-4000-8000-000000000041',
   '88892000-0000-4000-8000-000000000031', '88892000-0000-4000-8000-000000000021',
   '2028-11-01', 2, 'reserved', 'CL Owner', 50000, 100000, 'direct', 0.17, 0.10, 0.07, 17000, 10000, 7000),
  ('88892000-0000-4000-8000-000000000053', '88892000-0000-4000-8000-000000000041',
   '88892000-0000-4000-8000-000000000031', '88892000-0000-4000-8000-000000000021',
   '2028-11-01', 3, 'fulfilled', 'CL Owner', 50000, 150000, 'direct', 0.17, 0.10, 0.07, 25500, 15000, 10500),
  -- OTHER : la ligne d'un autre compte (cas 3)
  ('88892000-0000-4000-8000-000000000054', '88892000-0000-4000-8000-000000000042',
   '88892000-0000-4000-8000-000000000032', '88892000-0000-4000-8000-000000000021',
   '2028-11-01', 1, 'reserved', 'CL Other', 50000, 50000, 'direct', 0.17, 0.10, 0.07, 8500, 5000, 3500),
  -- ANON : la ligne d'une identité anonyme (cas 2)
  ('88892000-0000-4000-8000-000000000055', '88892000-0000-4000-8000-000000000043',
   '88892000-0000-4000-8000-000000000033', '88892000-0000-4000-8000-000000000021',
   '2028-11-01', 1, 'reserved', 'CL Anon', 50000, 50000, 'direct', 0.17, 0.10, 0.07, 8500, 5000, 3500);

-- Commande PMS : DEUX lignes qui PARTAGENT le même pms_booking_id, comme en production — une
-- activité hérite du booking de l'hébergement (reserve-nights/route.ts).
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name, pms_booking_id,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  ('88892000-0000-4000-8000-000000000061', '88892000-0000-4000-8000-000000000044',
   '88892000-0000-4000-8000-000000000031', '88892000-0000-4000-8000-000000000022',
   '2028-12-01', 1, 'reserved', 'CL PMS', 'LOBBY-BOOKING-CL-1',
   80000, 80000, 'direct', 0.17, 0.10, 0.07, 13600, 8000, 5600),
  ('88892000-0000-4000-8000-000000000062', '88892000-0000-4000-8000-000000000044',
   '88892000-0000-4000-8000-000000000031', '88892000-0000-4000-8000-000000000022',
   '2028-12-02', 1, 'reserved', 'CL PMS', 'LOBBY-BOOKING-CL-1',
   80000, 80000, 'direct', 0.17, 0.10, 0.07, 13600, 8000, 5600);

-- ---------------------------------------------------------------------------------------------
-- Cas 2 : une session anonyme est refusée, et n'écrit rien
-- ---------------------------------------------------------------------------------------------
set local role authenticated;
select test_login('88892000-0000-4000-8000-000000000033');
select is(
  (select public.cancel_order_line('88892000-0000-4000-8000-000000000055')->>'reason'),
  'anonymous_session',
  'une session anonyme est refusée (décision ⑨), même sur SA PROPRE prestation'
);
reset role;
select is(
  (select status from order_lines where id = '88892000-0000-4000-8000-000000000055'),
  'reserved',
  'et sa prestation est INCHANGÉE — un refus est aussi une absence d''écriture'
);

-- ---------------------------------------------------------------------------------------------
-- Cas 3-4 : non-divulgation — la ligne d'autrui et la ligne inexistante sont indiscernables
-- ---------------------------------------------------------------------------------------------
set local role authenticated;
select test_login('88892000-0000-4000-8000-000000000031');
select is(
  (select public.cancel_order_line('88892000-0000-4000-8000-000000000054')->>'reason'),
  'line_not_found',
  'la prestation d''un AUTRE compte → line_not_found'
);
select is(
  (select public.cancel_order_line('00000000-0000-4000-8000-000000000099')->>'reason'),
  'line_not_found',
  'une prestation INEXISTANTE → la MÊME réponse, jamais un refus qui distinguerait les deux'
);
reset role;
select is(
  (select status from order_lines where id = '88892000-0000-4000-8000-000000000054'),
  'reserved',
  'la prestation d''autrui est inchangée après le refus'
);

-- ---------------------------------------------------------------------------------------------
-- Cas 6-8 : LE renversement — une prestation s'annule, sa sœur ne bouge pas
-- ---------------------------------------------------------------------------------------------
set local role authenticated;
select test_login('88892000-0000-4000-8000-000000000031');

select is(
  (select (public.cancel_order_line('88892000-0000-4000-8000-000000000051') ->> 'remaining_active_lines')::int),
  1,
  'annuler une prestation sur deux rend remaining_active_lines = 1'
);
reset role;
select is(
  (select status from order_lines where id = '88892000-0000-4000-8000-000000000051'),
  'cancelled_by_client',
  'la prestation visée est annulée'
);
select is(
  (select status from order_lines where id = '88892000-0000-4000-8000-000000000052'),
  'reserved',
  'LA PRESTATION SŒUR EST INTACTE — le renversement du cahier §2c, fait exécutable'
);

-- ---------------------------------------------------------------------------------------------
-- Cas 9-10 : une ligne qui n'est plus réservée n'est jamais retouchée
-- ---------------------------------------------------------------------------------------------
set local role authenticated;
select test_login('88892000-0000-4000-8000-000000000031');
select is(
  (select public.cancel_order_line('88892000-0000-4000-8000-000000000053')->>'reason'),
  'line_not_active',
  'une prestation déjà réalisée → line_not_active'
);
select is(
  (select public.cancel_order_line('88892000-0000-4000-8000-000000000051')->>'reason'),
  'line_not_active',
  'un SECOND appel sur la prestation déjà annulée → line_not_active (idempotent pour l''écran)'
);

-- ---------------------------------------------------------------------------------------------
-- Cas 11 : la place annulée est rendue — celle-là seule (migration 20261006192424, G1-bis)
-- ---------------------------------------------------------------------------------------------
reset role;
select is(
  (select booked from product_availability
    where product_id = '88892000-0000-4000-8000-000000000021' and date = '2028-11-01'),
  2,
  'product_availability.booked rend la place de la prestation annulée (qty 1 : 3 → 2), jamais celle de sa sœur'
);

-- ---------------------------------------------------------------------------------------------
-- Cas 12-13 : la file LobbyPMS n'enfile QU'AU DERNIER `reserved` du booking partagé
-- ---------------------------------------------------------------------------------------------
set local role authenticated;
select test_login('88892000-0000-4000-8000-000000000031');
select public.cancel_order_line('88892000-0000-4000-8000-000000000061');
reset role;
select is(
  (select count(*)::int from pms_cancellation_queue where pms_booking_id = 'LOBBY-BOOKING-CL-1'),
  0,
  'annuler UNE des deux prestations du booking n''enfile RIEN — la nuit d''hôtel reste réservée chez le PMS'
);

set local role authenticated;
select test_login('88892000-0000-4000-8000-000000000031');
select public.cancel_order_line('88892000-0000-4000-8000-000000000062');
reset role;
select is(
  (select count(*)::int from pms_cancellation_queue where pms_booking_id = 'LOBBY-BOOKING-CL-1'),
  1,
  'annuler la DERNIÈRE prestation du booking l''enfile, une seule fois'
);

-- ---------------------------------------------------------------------------------------------
-- Cas 14 : les grants, lus sur l'ACL
-- ---------------------------------------------------------------------------------------------
select is(
  array[
    has_function_privilege('anon', 'public.cancel_order_line(uuid)', 'EXECUTE'),
    has_function_privilege('authenticated', 'public.cancel_order_line(uuid)', 'EXECUTE')
  ],
  array[false, true],
  'authenticated seul peut l''exécuter — anon n''a rien à annuler'
);

select * from finish();
rollback;

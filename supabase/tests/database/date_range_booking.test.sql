-- Réservation par PLAGE DE NUITS — spec 17 §0 Tranche 2, migration 20260817210000.
--
-- Ce fichier s'appelait room_type_and_date_range_booking.test.sql et couvrait DEUX branches plage
-- de create_order : la chambre d'hôtel (via room_type_id) et l'alojamiento (via end_date seul).
-- T3 étape 2 (20260827220000) a supprimé la première : plus de product_room_types, plus de
-- room_type_availability, plus de set_room_type_availability. Ne restent ici que la branche
-- alojamiento et resolve_date_price, qui lui survit.
--
-- Le chemin set_date_rate est couvert par set_date_rate_product.test.sql, désormais seul — il
-- n'existe plus qu'un seul type d'entité tarifable.
--
-- Le test de concurrence réelle (plages identiques/imbriquées/adjacentes/qty multiple) vit dans
-- tests/concurrency/create_order_room_range.concurrency.mjs — jamais ici, cf. hifago/CLAUDE.md §6.3
-- (pgTAP tourne en transaction annulée, structurellement incapable de simuler une vraie
-- concurrence).
begin;
select plan(12);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Fixtures : 1 partenaire/établissement, 1 admin (pour modify_order_line), 1 buyer.
insert into partners (id, display_name) values
  ('88930000-0000-4000-8000-000000000001', 'Range Test Partner');
insert into establishments (id, partner_id, name) values
  ('88930000-0000-4000-8000-000000000011', '88930000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Range'));

insert into auth.users (id, email) values
  ('88930000-0000-4000-8000-000000000031', 'range-admin@test.local'),
  ('88930000-0000-4000-8000-000000000034', 'range-buyer@test.local');

insert into partner_capabilities (account_id, role, source, status) values
  ('88930000-0000-4000-8000-000000000031', 'admin', 'migration', 'active');

-- ALOJAMIENTO réservable par plage. stay_rates porte une majoration week-end de 20 % : c'est ce
-- produit qui exerce resolve_date_price, la chambre à paliers qui le faisait avant ayant disparu.
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug,
                      min_qty, max_qty, stay_rates)
values ('88930000-0000-4000-8000-000000000022', '88930000-0000-4000-8000-000000000001',
        '88930000-0000-4000-8000-000000000011', 'lodging', jsonb_build_object('es', 'Casa Range Test'),
        -- min_qty/max_qty NULL : interdits pour un logement (migration 20261025120000).
        200000, true, 'range-lodging', null, null,
        jsonb_build_object(
          'season', jsonb_build_object('months', jsonb_build_array(), 'surcharge_pct', 0, 'note', null),
          'weekend_days', jsonb_build_array(6, 7), -- ISO : 6=samedi, 7=dimanche
          'weekend_surcharge_pct', 0.20,
          'includes', jsonb_build_array(), 'deposit_cop', null, 'extra_note', null
        ));

insert into product_calendar (product_id, date, open)
select '88930000-0000-4000-8000-000000000022', d::date, true
  from generate_series('2028-12-01'::date, '2028-12-05'::date, interval '1 day') as d;
-- '2028-12-04' fermée explicitement pour la garde date_closed d'une plage (PAS 01/02, déjà
-- consommées par le scénario succès plus bas — sinon l'assertion « nuit non consommée » ne
-- prouverait rien, la nuit serait déjà à booked=1 pour une tout autre raison).
update product_calendar set open = false
 where product_id = '88930000-0000-4000-8000-000000000022' and date = '2028-12-04';
insert into product_availability (product_id, date, capacity, booked)
select '88930000-0000-4000-8000-000000000022', d::date, 2, 0
  from generate_series('2028-12-01'::date, '2028-12-05'::date, interval '1 day') as d;

-- === resolve_date_price ==========================================================================
-- Signature à QUATRE paramètres depuis 20260827220000 : p_room_type_id, qui était le premier, a
-- disparu avec les chambres.
set local role authenticated;
select test_login('88930000-0000-4000-8000-000000000034');

select is(
  resolve_date_price(null, '2028-11-01', 20000, null),
  20000::bigint,
  'resolve_date_price : sans stay_rates ni override, retourne le prix palier/base tel quel'
);
select is(
  resolve_date_price(
    '88930000-0000-4000-8000-000000000022', '2028-11-04', 25000,
    (select stay_rates from products where id = '88930000-0000-4000-8000-000000000022')
  ),
  round(25000 * 1.20)::bigint,
  'resolve_date_price : samedi (weekend_days) → majoration stay_rates 20% appliquée sur le prix palier'
);
select is(
  resolve_date_price(
    '88930000-0000-4000-8000-000000000022', '2028-11-06', 25000,
    (select stay_rates from products where id = '88930000-0000-4000-8000-000000000022')
  ),
  25000::bigint,
  'resolve_date_price : jour hors weekend_days → aucune majoration'
);

reset role;
insert into product_date_rates (product_id, date, price_cop) values
  ('88930000-0000-4000-8000-000000000022', '2028-11-04', 99000);
set local role authenticated;
select test_login('88930000-0000-4000-8000-000000000034');

select is(
  resolve_date_price(
    '88930000-0000-4000-8000-000000000022', '2028-11-04', 25000,
    (select stay_rates from products where id = '88930000-0000-4000-8000-000000000022')
  ),
  99000::bigint,
  'resolve_date_price : un override date exact gagne intégralement, ignore stay_rates'
);

-- === create_order — alojamiento par plage : succès ===============================================
-- Panier posé en cart_items (spec 32) : create_order lit désormais ses propres lignes pour
-- auth.uid(), plus un paramètre. test_login('...034') encore actif depuis les appels
-- resolve_date_price ci-dessus.
insert into cart_items (account_id, product_id, date, end_date, qty) values
  ('88930000-0000-4000-8000-000000000034', '88930000-0000-4000-8000-000000000022',
   '2028-12-01', '2028-12-03', 1);
create temp table tmp_lodging_success as
select create_order(
  'Holder Lodging Range Success', p_holder_email => 'lodging-range-success@test.local'
) as result;

select ok(
  (select (result->>'ok')::boolean from tmp_lodging_success),
  'create_order alojamiento par plage : réservation de 2 nuits (01→03/12) acceptée'
);
select is(
  (select booked from product_availability
    where product_id = '88930000-0000-4000-8000-000000000022' and date = '2028-12-01'),
  1,
  'create_order alojamiento par plage : nuit 01/12 décrémentée'
);
-- 01/12 = vendredi, 02/12 = samedi : la majoration week-end de stay_rates s'applique à la SECONDE
-- nuit seulement, ce qui vérifie au passage que le total est bien calculé nuit par nuit et non par
-- une multiplication du prix de base par le nombre de nuits.
reset role;
select is(
  (select total_cop from order_lines where holder_name = 'Holder Lodging Range Success'),
  (200000 + round(200000 * 1.20))::bigint,
  'create_order alojamiento par plage : total_cop = somme nuit par nuit, majoration week-end incluse'
);

-- === create_order — alojamiento par plage, qty > 1 : le total multiplie bien par qty =============
-- Régression du 2026-09-16 (migration 20260916120000_fix_lodging_price_missing_qty) : qty désigne
-- des unités facturables (lits/chambres selon lodging_kind), jamais des occupants — price_tiers
-- redevient donc un prix PAR UNITÉ et par nuit, à multiplier par qty comme les autres branches de
-- create_order. Produit et dates dédiés (jamais ceux du scénario ci-dessus, déjà consommés) pour
-- que ce total ne coïncide pas par accident avec qty=1 (les deux formules donnent le même résultat
-- à qty=1, ce qui avait rendu la régression invisible).
--
-- reset role : le rôle est resté `authenticated` depuis la ligne 94 (dernier `set local role`, pour
-- les appels resolve_date_price/create_order ci-dessus) — un insert catalogue (produit/calendrier/
-- disponibilité) doit repasser par le rôle superuser par défaut de la transaction pgTAP, comme les
-- fixtures du haut de fichier, sous peine de violer la RLS d'écriture sur products.
reset role;
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug,
                      min_qty, max_qty, price_tiers)
values ('88930000-0000-4000-8000-000000000023', '88930000-0000-4000-8000-000000000001',
        '88930000-0000-4000-8000-000000000011', 'lodging', jsonb_build_object('es', 'Casa Range Qty Test'),
        100000, true, 'range-lodging-qty',
        null, null, -- interdits pour un logement (migration 20261025120000) ; les paliers bornent

        jsonb_build_array(
          jsonb_build_object('min_qty', 1, 'max_qty', 1, 'price_cop', 100000),
          jsonb_build_object('min_qty', 2, 'max_qty', 4, 'price_cop', 90000)
        ));
insert into product_calendar (product_id, date, open)
select '88930000-0000-4000-8000-000000000023', d::date, true
  from generate_series('2028-12-10'::date, '2028-12-13'::date, interval '1 day') as d;
insert into product_availability (product_id, date, capacity, booked)
select '88930000-0000-4000-8000-000000000023', d::date, 2, 0
  from generate_series('2028-12-10'::date, '2028-12-13'::date, interval '1 day') as d;

set local role authenticated;
select test_login('88930000-0000-4000-8000-000000000034');
insert into cart_items (account_id, product_id, date, end_date, qty) values
  ('88930000-0000-4000-8000-000000000034', '88930000-0000-4000-8000-000000000023',
   '2028-12-10', '2028-12-12', 2);
create temp table tmp_lodging_qty as
select create_order(
  'Holder Lodging Range Qty', p_holder_email => 'lodging-range-qty@test.local'
) as result;

select ok(
  (select (result->>'ok')::boolean from tmp_lodging_qty),
  'create_order alojamiento par plage, qty=2 : réservation de 2 nuits acceptée'
);
reset role;
select is(
  (select total_cop from order_lines where holder_name = 'Holder Lodging Range Qty'),
  (2 * 90000 * 2)::bigint,
  'create_order alojamiento par plage, qty=2 : total_cop = nuits × tarif du palier (qty=2) × qty, jamais sans le facteur qty'
);
set local role authenticated;
select test_login('88930000-0000-4000-8000-000000000034');

-- === create_order — alojamiento par plage : refus (date fermée) tout-ou-rien =====================
-- Plage 03→05 (nuits 03 ouverte, 04 fermée) : la nuit 03, ouverte et validée en premier, ne doit
-- PAS être consommée puisque la nuit 04 (dans la même plage) échoue ensuite — preuve que Phase 3
-- valide TOUTES les nuits avant que Phase 4 n'en écrive une seule, pas un simple court-circuit sur
-- la première nuit testée.
insert into cart_items (account_id, product_id, date, end_date, qty) values
  ('88930000-0000-4000-8000-000000000034', '88930000-0000-4000-8000-000000000022',
   '2028-12-03', '2028-12-05', 1);
select is(
  (select create_order(
     'Holder Lodging Closed', p_holder_email => 'lodging-range-closed@test.local'
   )->>'reason'),
  'date_closed',
  'create_order alojamiento par plage : la nuit du 04/12 (fermée) refuse toute la plage'
);
select is(
  (select booked from product_availability
    where product_id = '88930000-0000-4000-8000-000000000022' and date = '2028-12-03'),
  0,
  'create_order alojamiento par plage (refus) : nuit 03/12 (ouverte, validée avant la fermée) non consommée (tout ou rien)'
);

-- === modify_order_line exige p_new_end_date pour une ligne à plage ===============================
-- Le refus catégorique posé par la migration 20260817210000 a été remplacé par une prise en charge
-- réelle des lignes à plage (20260817220400_modify_order_line_range_support.sql) — couverture
-- complète (succès nuits/qty, nuit commune aux deux intervalles, tout-ou-rien) dans
-- modify_order_line.test.sql, pas ici. Seule reste ici la preuve que la garde de cohérence
-- p_new_end_date/forme de la ligne s'applique toujours à un appel à 4 arguments positionnels
-- (p_new_end_date par défaut null) sur une ligne à plage.
-- Lu en rôle privilégié puis passé par un GUC de session (comme test_login lui-même) : order_lines
-- n'a plus aucun accès SELECT direct pour authenticated depuis 20260922210000, et cet id doit
-- pourtant être interpolé dans le format() ci-dessous, évalué sous l'identité admin.
reset role;
select set_config(
  'test.lodging_range_line_id',
  (select id::text from order_lines where holder_name = 'Holder Lodging Range Success' limit 1),
  true
);
set local role authenticated;
select test_login('88930000-0000-4000-8000-000000000031'); -- admin
select throws_like(
  format(
    'select modify_order_line(%L, %L, %s, %L)',
    current_setting('test.lodging_range_line_id')::uuid,
    '2028-12-10', 1, 'test'
  ),
  '%p_new_end_date%',
  'modify_order_line : p_new_end_date obligatoire pour modifier une ligne à plage (garde de cohérence Tranche 2)'
);

select * from finish();
rollback;

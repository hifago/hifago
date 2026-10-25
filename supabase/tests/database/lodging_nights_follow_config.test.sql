-- Les nuits déjà ouvertes d'un logement suivent sa configuration (20261024150000, retour Jérôme du
-- 2026-10-24 : RM201, chambre privée en 1 exemplaire, se vendait 3 fois par nuit).
--
-- Ce fichier prouve le COMPORTEMENT du déclencheur et de l'ouverture des nuits. La concurrence avec
-- create_order (un admin baisse le cupo pendant qu'on réserve) n'est PAS testable ici — chaque
-- fichier pgTAP tourne dans une transaction annulée (CLAUDE.md §6.3) : elle est prouvée par
-- tests/concurrency/realign_lodging_nights.concurrency.mjs.
begin;
select plan(16);

insert into partners (id, display_name) values
  ('7a110000-0000-4000-8000-000000000001', 'Nuits Suivent Config');

insert into establishments (id, partner_id, name) values
  ('7a110000-0000-4000-8000-000000000002', '7a110000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Nuits Suivent Config'));

-- A : chambre privée, 3 exemplaires, cupo par défaut 3.
-- B : dortoir, 2 exemplaires de 4 lits (capacité physique 8), cupo par défaut 8.
-- C : logement Lobby — jamais concerné.
-- D : activité — jamais concernée.
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug,
                      lodging_kind, unit_count, capacity, default_capacity, lobby_category_id)
values
  ('7a110000-0000-4000-8000-00000000000a', '7a110000-0000-4000-8000-000000000001',
   '7a110000-0000-4000-8000-000000000002', 'lodging', jsonb_build_object('es', 'Privada A'),
   160000, true, 'nuits-config-a', 'private', 3, 3, 3, null),
  ('7a110000-0000-4000-8000-00000000000b', '7a110000-0000-4000-8000-000000000001',
   '7a110000-0000-4000-8000-000000000002', 'lodging', jsonb_build_object('es', 'Dormitorio B'),
   40000, true, 'nuits-config-b', 'dorm', 2, 4, 8, null),
  ('7a110000-0000-4000-8000-00000000000c', '7a110000-0000-4000-8000-000000000001',
   '7a110000-0000-4000-8000-000000000002', 'lodging', jsonb_build_object('es', 'Lobby C'),
   90000, true, 'nuits-config-c', 'private', 3, 2, 3, 4242),
  ('7a110000-0000-4000-8000-00000000000d', '7a110000-0000-4000-8000-000000000001',
   '7a110000-0000-4000-8000-000000000002', 'activity', jsonb_build_object('es', 'Actividad D'),
   50000, true, 'nuits-config-d', null, null, null, 3, null);

-- Nuits de A : J+10 au défaut, J+11 au défaut mais 2 déjà réservées, J+12 exception à 2,
-- J+13 exception fermée à 0, J-2 dans le passé (jamais touchée).
insert into product_availability (product_id, date, capacity, booked)
select '7a110000-0000-4000-8000-00000000000a', today_in_bogota() + d, c, b
  from (values (10, 3, 0), (11, 3, 2), (12, 2, 0), (13, 0, 0), (-2, 3, 0)) as v(d, c, b);

-- Nuits de B : J+10 au défaut (8), J+11 exception à 5.
insert into product_availability (product_id, date, capacity, booked)
select '7a110000-0000-4000-8000-00000000000b', today_in_bogota() + d, c, 0
  from (values (10, 8), (11, 5)) as v(d, c);

-- C et D : une ligne chacun, à leur défaut.
insert into product_availability (product_id, date, capacity, booked) values
  ('7a110000-0000-4000-8000-00000000000c', today_in_bogota() + 10, 3, 0),
  ('7a110000-0000-4000-8000-00000000000d', today_in_bogota() + 10, 3, 0);

create function nuit(p_product uuid, p_offset int) returns int language sql as $$
  select capacity from product_availability where product_id = p_product and date = today_in_bogota() + p_offset;
$$;

-- ── 1. Le cupo par défaut passe de 3 à 1 ─────────────────────────────────────────────────────
update products set default_capacity = 1 where id = '7a110000-0000-4000-8000-00000000000a';

select is(nuit('7a110000-0000-4000-8000-00000000000a', 10), 1,
  'une nuit au défaut suit le nouveau cupo par défaut — le cas RM201');
select is(nuit('7a110000-0000-4000-8000-00000000000a', 11), 2,
  'jamais sous ce qui est déjà réservé (2 réservées, cupo 1 → 2)');
select is(nuit('7a110000-0000-4000-8000-00000000000a', 12), 2,
  'une exception du calendrier garde sa valeur');
select is(nuit('7a110000-0000-4000-8000-00000000000a', 13), 0,
  'une nuit fermée à 0 reste fermée');
select is(nuit('7a110000-0000-4000-8000-00000000000a', -2), 3,
  'le passé n''est jamais réécrit');

-- ── 2. La quantité passe de 3 à 1 : plus qu'une chambre physique ─────────────────────────────
update products set unit_count = 1 where id = '7a110000-0000-4000-8000-00000000000a';

select is(nuit('7a110000-0000-4000-8000-00000000000a', 12), 1,
  'une exception au-dessus de la capacité physique y est ramenée');
select is(nuit('7a110000-0000-4000-8000-00000000000a', 11), 2,
  'même ramenée à la capacité physique, une nuit ne descend jamais sous booked');

-- ── 3. Remonter le cupo au-delà de ce qui existe : la capacité physique borne ─────────────────
update products set default_capacity = 4 where id = '7a110000-0000-4000-8000-00000000000a';

select is(nuit('7a110000-0000-4000-8000-00000000000a', 10), 1,
  'un cupo par défaut au-dessus de la capacité physique n''ouvre rien de plus');

-- ── 4. Dortoir : on vend des lits (unit_count × capacity) ────────────────────────────────────
update products set default_capacity = 6 where id = '7a110000-0000-4000-8000-00000000000b';

select is(nuit('7a110000-0000-4000-8000-00000000000b', 10), 6,
  'dortoir : la nuit au défaut suit (8 → 6)');
select is(nuit('7a110000-0000-4000-8000-00000000000b', 11), 5,
  'dortoir : l''exception à 5 reste à 5');

update products set capacity = 2 where id = '7a110000-0000-4000-8000-00000000000b';

select is(nuit('7a110000-0000-4000-8000-00000000000b', 10), 4,
  'dortoir : 2 exemplaires de 2 lits, la nuit descend à 4 lits');

-- ── 5. Hors périmètre : Lobby et activité ────────────────────────────────────────────────────
update products set default_capacity = 1, unit_count = 1 where id = '7a110000-0000-4000-8000-00000000000c';
update products set default_capacity = 1 where id = '7a110000-0000-4000-8000-00000000000d';

select is(nuit('7a110000-0000-4000-8000-00000000000c', 10), 3,
  'un logement Lobby n''est jamais réaligné ici');
select is(nuit('7a110000-0000-4000-8000-00000000000d', 10), 3,
  'une activité n''est pas concernée');

-- ── 6. Ouverture automatique des nuits : jamais au-dessus de la capacité physique ─────────────
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug,
                      lodging_kind, unit_count, capacity, default_capacity)
values
  ('7a110000-0000-4000-8000-00000000000e', '7a110000-0000-4000-8000-000000000001',
   '7a110000-0000-4000-8000-000000000002', 'lodging', jsonb_build_object('es', 'Privada E'),
   160000, true, 'nuits-config-e', 'private', 1, 3, 3);

select open_default_lodging_availability('7a110000-0000-4000-8000-00000000000e');

select ok(
  (select count(*) from product_availability where product_id = '7a110000-0000-4000-8000-00000000000e') > 150,
  'la fenêtre de six mois est bien ouverte'
);
select is(
  (select count(*)::int from product_availability
    where product_id = '7a110000-0000-4000-8000-00000000000e' and capacity <> 1),
  0,
  'chambre privée en 1 exemplaire, cupo par défaut 3 : chaque nuit ouverte à 1, jamais à 3'
);

-- ── 7. Personne ne l'appelle de l'extérieur ──────────────────────────────────────────────────
select ok(
  not has_function_privilege('authenticated', 'public.lodging_physical_capacity(text,int,int)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.lodging_physical_capacity(text,int,int)', 'EXECUTE'),
  'lodging_physical_capacity n''est pas exposée à la Data API'
);

select * from finish();
rollback;

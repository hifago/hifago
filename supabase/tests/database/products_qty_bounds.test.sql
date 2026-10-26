-- products_min_qty_positive / products_max_qty_positive (20261001144546) : une borne de quantité,
-- quand elle existe, vaut au moins 1. Avant, seul min_qty <= max_qty était contrôlé (le formulaire
-- est `noValidate`) : un max_qty à 0 rendait le produit invendable (create_order le refuse en
-- qty_cap_exceeded).
--
-- 20261025120000 (décision Jérôme du 2026-10-25) : un produit à cupo — activité, logement, camp —
-- n'a plus de maximum par réservation (products_max_qty_only_without_cupo), un logement n'a plus de
-- minimum (products_min_qty_not_lodging), et public.product_qty_cap rend NULL pour exactement ces
-- trois types. Les bornes « au moins 1 » se testent donc sur un transport, seul type à garder les
-- deux champs à l'écran.
--
-- Insertion en postgres, comme products_vitrine.test.sql : la contrainte est l'objet du test, pas
-- la policy d'écriture. `throws_like` sur le NOM de la contrainte : un 23514 seul pourrait venir
-- d'une autre contrainte de products.
begin;
select plan(13);

insert into partners (id, display_name) values
  ('88a30000-0000-4000-8000-000000000001', 'Qty Bounds Partner');
insert into establishments (id, partner_id, name) values
  ('88a30000-0000-4000-8000-000000000011', '88a30000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Qty Bounds'));

select throws_like(
  $$ insert into products (partner_id, establishment_id, type, name, price_cop, sellable, slug, min_qty)
     values ('88a30000-0000-4000-8000-000000000001', '88a30000-0000-4000-8000-000000000011', 'activity',
             jsonb_build_object('es', 'Min Cero'), 30000, true, 'qty-bounds-min-cero', 0) $$,
  '%products_min_qty_positive%',
  'min_qty 0 refusé'
);
select throws_like(
  $$ insert into products (partner_id, establishment_id, type, name, price_cop, sellable, slug, max_qty)
     values ('88a30000-0000-4000-8000-000000000001', '88a30000-0000-4000-8000-000000000011', 'transport',
             jsonb_build_object('es', 'Max Cero'), 30000, true, 'qty-bounds-max-cero', 0) $$,
  '%products_max_qty_positive%',
  'max_qty 0 refusé (le produit aurait été invendable)'
);
select lives_ok(
  $$ insert into products (partner_id, establishment_id, type, name, price_cop, sellable, slug)
     values ('88a30000-0000-4000-8000-000000000001', '88a30000-0000-4000-8000-000000000011', 'activity',
             jsonb_build_object('es', 'Sin Bornes'), 30000, true, 'qty-bounds-sin-bornes') $$,
  'sans borne (NULL) : accepté'
);
select lives_ok(
  $$ insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, min_qty, max_qty)
     values ('88a30000-0000-4000-8000-000000000021', '88a30000-0000-4000-8000-000000000001',
             '88a30000-0000-4000-8000-000000000011', 'transport',
             jsonb_build_object('es', 'Bornes 2 a 5'), 30000, true, 'qty-bounds-2-a-5', 2, 5) $$,
  'transport, bornes 2 à 5 : acceptées'
);

-- ===== Pas de maximum par réservation sur un produit à cupo ======================================
select throws_like(
  $$ insert into products (partner_id, establishment_id, type, name, price_cop, sellable, slug, max_qty)
     values ('88a30000-0000-4000-8000-000000000001', '88a30000-0000-4000-8000-000000000011', 'activity',
             jsonb_build_object('es', 'Actividad Max'), 30000, true, 'qty-bounds-actividad-max', 5) $$,
  '%products_max_qty_only_without_cupo%',
  'activité : max_qty refusé'
);
select throws_like(
  $$ insert into products (partner_id, establishment_id, type, name, price_cop, sellable, slug, max_qty)
     values ('88a30000-0000-4000-8000-000000000001', '88a30000-0000-4000-8000-000000000011', 'lodging',
             jsonb_build_object('es', 'Alojamiento Max'), 30000, true, 'qty-bounds-alojamiento-max', 5) $$,
  '%products_max_qty_only_without_cupo%',
  'logement : max_qty refusé'
);
select throws_like(
  $$ insert into products (partner_id, establishment_id, type, name, price_cop, sellable, slug, duration_days, max_qty)
     values ('88a30000-0000-4000-8000-000000000001', '88a30000-0000-4000-8000-000000000011', 'camp',
             jsonb_build_object('es', 'Camp Max'), 30000, true, 'qty-bounds-camp-max', 1, 5) $$,
  '%products_max_qty_only_without_cupo%',
  'camp : max_qty refusé'
);
select throws_like(
  $$ insert into products (partner_id, establishment_id, type, name, price_cop, sellable, slug, min_qty)
     values ('88a30000-0000-4000-8000-000000000001', '88a30000-0000-4000-8000-000000000011', 'lodging',
             jsonb_build_object('es', 'Alojamiento Min'), 30000, true, 'qty-bounds-alojamiento-min', 2) $$,
  '%products_min_qty_not_lodging%',
  'logement : min_qty refusé (create_order ne l''a jamais vérifié)'
);
select lives_ok(
  $$ insert into products (partner_id, establishment_id, type, name, price_cop, sellable, slug, min_qty)
     values ('88a30000-0000-4000-8000-000000000001', '88a30000-0000-4000-8000-000000000011', 'activity',
             jsonb_build_object('es', 'Actividad Min'), 30000, true, 'qty-bounds-actividad-min', 2) $$,
  'activité : min_qty 2 accepté (taille de groupe minimale)'
);

-- La règle SQL et ses contraintes disent la même chose : NULL pour exactement les trois types à cupo.
select is(
  (select array_agg(t order by t) from unnest(array['activity', 'camp', 'evento', 'lodging', 'transport']) t
    where public.product_qty_cap(t, 8) is null),
  array['activity', 'camp', 'lodging'],
  'product_qty_cap : aucun plafond pour activité, camp, logement'
);
select is(
  (select array[public.product_qty_cap('evento', null), public.product_qty_cap('transport', 8)]),
  array[20, 8],
  'product_qty_cap : repli 20 sans valeur saisie, sinon max_qty'
);

-- ===== Un changement de type efface ce que le nouveau type n'accepte plus ========================
update products set type = 'activity' where id = '88a30000-0000-4000-8000-000000000021';
select is(
  (select array[min_qty, max_qty] from products where id = '88a30000-0000-4000-8000-000000000021'),
  array[2, null]::int[],
  'transport → activité : max_qty effacé, min_qty gardé'
);
update products set type = 'lodging' where id = '88a30000-0000-4000-8000-000000000021';
select is(
  (select array[min_qty, max_qty] from products where id = '88a30000-0000-4000-8000-000000000021'),
  array[null, null]::int[],
  'activité → logement : min_qty effacé aussi'
);

select * from finish();
rollback;

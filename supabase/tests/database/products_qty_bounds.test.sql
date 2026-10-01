-- products_min_qty_positive / products_max_qty_positive (20261001144546) : une borne de quantité,
-- quand elle existe, vaut au moins 1. Avant, seul min_qty <= max_qty était contrôlé (le formulaire
-- est `noValidate`) : un max_qty à 0 rendait le produit invendable (create_order le refuse en
-- qty_cap_exceeded).
--
-- Insertion en postgres, comme products_vitrine.test.sql : la contrainte est l'objet du test, pas
-- la policy d'écriture. `throws_like` sur le NOM de la contrainte : un 23514 seul pourrait venir
-- d'une autre contrainte de products.
begin;
select plan(4);

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
     values ('88a30000-0000-4000-8000-000000000001', '88a30000-0000-4000-8000-000000000011', 'activity',
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
  $$ insert into products (partner_id, establishment_id, type, name, price_cop, sellable, slug, min_qty, max_qty)
     values ('88a30000-0000-4000-8000-000000000001', '88a30000-0000-4000-8000-000000000011', 'activity',
             jsonb_build_object('es', 'Bornes 2 a 5'), 30000, true, 'qty-bounds-2-a-5', 2, 5) $$,
  'bornes 2 à 5 : acceptées'
);

select * from finish();
rollback;

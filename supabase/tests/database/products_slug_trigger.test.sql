-- Trigger products_set_slug (20261001235031) : deux produits de même nom ne se heurtent plus sur
-- products_slug_key. Même mécanisme que les établissements (set_establishment_slug) : slug absent
-- ou déjà pris → dérivé du nom et suffixé (-2, -3…) ; un slug explicite et libre n'est pas touché.
begin;
select plan(5);

insert into partners (id, display_name) values
  ('88a80000-0000-4000-8000-000000000001', 'Slug Trigger Partner');
insert into establishments (id, partner_id, name) values
  ('88a80000-0000-4000-8000-000000000011', '88a80000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Slug Trigger'));

-- Le formulaire admin envoie slugify(nombre) : deux produits nommés pareil envoient le même slug.
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('88a80000-0000-4000-8000-000000000021', '88a80000-0000-4000-8000-000000000001',
   '88a80000-0000-4000-8000-000000000011', 'activity', jsonb_build_object('es', 'Slug Trigger Test'),
   30000, true, 'slug-trigger-test');
select is(
  (select slug from products where id = '88a80000-0000-4000-8000-000000000021'),
  'slug-trigger-test',
  'premier produit : le slug envoyé est libre, il est gardé'
);

select lives_ok(
  $$ insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
       ('88a80000-0000-4000-8000-000000000022', '88a80000-0000-4000-8000-000000000001',
        '88a80000-0000-4000-8000-000000000011', 'activity', jsonb_build_object('es', 'Slug Trigger Test'),
        30000, true, 'slug-trigger-test') $$,
  'second produit au même slug : plus de 23505 sur products_slug_key'
);
select is(
  (select slug from products where id = '88a80000-0000-4000-8000-000000000022'),
  'slug-trigger-test-2',
  'second produit : slug suffixé'
);

insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('88a80000-0000-4000-8000-000000000023', '88a80000-0000-4000-8000-000000000001',
   '88a80000-0000-4000-8000-000000000011', 'activity', jsonb_build_object('es', 'Slug Trigger Sin Slug'),
   30000, true, null);
select is(
  (select slug from products where id = '88a80000-0000-4000-8000-000000000023'),
  'slug-trigger-sin-slug',
  'slug absent : dérivé du nom'
);

select ok(
  not has_function_privilege('anon', 'public.product_slug_from_name(jsonb, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.product_slug_from_name(jsonb, uuid)', 'EXECUTE'),
  'product_slug_from_name n''est appelable par aucun rôle d''API'
);

select * from finish();
rollback;

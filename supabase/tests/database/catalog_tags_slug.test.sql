-- Slugs des étiquettes : les quatre gammes de prix et le slug jamais vide (20261014210927).
--
-- Les gammes « $ » à « $$$$ » existent dans toute base (20261014160938), chacune une seule fois,
-- sous le slug que l'admin calcule (`precio-N`, apps/admin/lib/tags/tagSlug.ts). Aucun chemin
-- d'écriture ne pose un slug vide ou blanc : c'était le slug de `slugify('$$')`, qui bloquait la
-- création de la gamme suivante.
begin;
select plan(5);

-- Recherche par libellé ET par slug : une gamme posée deux fois (sous un autre slug), ou un
-- `precio-N` sous un autre libellé, ajoute une ligne et rougit.
select is(
  (select array_agg(slug || ' ' || (label ->> 'es') order by slug)
     from catalog_tags
    where label ->> 'es' in ('$', '$$', '$$$', '$$$$')
       or slug in ('precio-1', 'precio-2', 'precio-3', 'precio-4')),
  array['precio-1 $', 'precio-2 $$', 'precio-3 $$$', 'precio-4 $$$$'],
  'les quatre gammes de prix existent, chacune une seule fois, sous le slug precio-N'
);

select throws_ok(
  $$ insert into catalog_tags (label, slug) values ('{"es":"★★"}', '') $$,
  '23514',
  'new row for relation "catalog_tags" violates check constraint "catalog_tags_slug_no_vacio"',
  'un slug vide est refusé'
);

select throws_ok(
  $$ insert into catalog_tags (label, slug) values ('{"es":"★★★"}', E' \t\n') $$,
  '23514',
  'new row for relation "catalog_tags" violates check constraint "catalog_tags_slug_no_vacio"',
  'un slug fait seulement de blancs est refusé'
);

select throws_ok(
  -- Délimiteur nommé : « $$ » fermerait un `$$ … $$`.
  $sql$ insert into catalog_tags (label, slug) values ('{"es":"$$"}', public.slugify('$$')) $sql$,
  '23514',
  'new row for relation "catalog_tags" violates check constraint "catalog_tags_slug_no_vacio"',
  'le slug que slugify rend pour « $$ » (vide) est refusé'
);

select lives_ok(
  $$ insert into catalog_tags (label, slug) values ('{"es":"Slug ordinario CTS"}', 'cts-slug-ordinario') $$,
  'un slug ordinaire passe'
);

select * from finish();
rollback;

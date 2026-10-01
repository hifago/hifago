-- Bucket catalog-media (20261001225658) : public en lecture par chemin, jamais listable par la
-- Data API, borné en taille et en type.
--
-- Ce fichier ne prouve que l'état du catalogue Storage. Le comportement HTTP (listage anonyme
-- vide, photos toujours servies par leur URL publique, téléversement service_role borné) relève de
-- l'API Storage et se vérifie contre la pile locale, pas en pgTAP.
begin;
select plan(4);

select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and cmd in ('SELECT', 'ALL')
      and qual ilike '%catalog-media%'),
  0,
  'aucune policy de lecture sur storage.objects pour catalog-media : le bucket n''est pas listable'
);
select is(
  (select public from storage.buckets where id = 'catalog-media'),
  true,
  'le bucket reste public : les photos sont servies par leur URL publique (spec 04 §3)'
);
select is(
  (select file_size_limit from storage.buckets where id = 'catalog-media'),
  8388608::bigint,
  'taille maximale 8 MiB, comme MAX_IMAGE_BYTES (catalogImage.ts)'
);
select is(
  (select allowed_mime_types from storage.buckets where id = 'catalog-media'),
  array['image/webp', 'image/jpeg', 'image/png'],
  'types admis : webp (Route Handler), jpeg et png (seed-mock-data.mjs)'
);

select * from finish();
rollback;

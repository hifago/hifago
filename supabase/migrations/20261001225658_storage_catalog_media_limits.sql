-- Bucket catalog-media : plus de listage par la Data API, et des limites de taille et de type.
--
-- 1. La policy `catalog_media_read` (SELECT sur storage.objects, sans restriction de rôle) ne
--    servait pas à afficher les photos : pour un bucket `public`, la lecture par chemin
--    (`/storage/v1/object/public/…`, getPublicUrl) ne consulte pas la RLS. Elle ne servait qu'à
--    LISTER le bucket, ce que n'importe quel visiteur pouvait donc faire — énumérer tout son
--    contenu, y compris des photos pas encore modérées. Aucun code applicatif ne liste ce bucket
--    (grep : ni `.list(`, ni `.download(`, ni `createSignedUrl(` dans apps/ et packages/) ; seul
--    supabase/scripts/seed-media.mjs le liste, avec la clé service_role, qui ne passe pas par la
--    RLS. La policy est retirée ; la décision « bucket public en lecture » (spec 04 §3, Jérôme
--    2026-08-14) reste intacte, et `catalog_media_write_admin` (INSERT admin, défense en
--    profondeur) aussi.
--
-- 2. Le bucket n'avait ni `file_size_limit` ni `allowed_mime_types`. L'unique écrivain applicatif
--    est le Route Handler service_role, qui réencode en webp et refuse au-delà de MAX_IMAGE_BYTES
--    (apps/admin/lib/media/catalogImage.ts, 8 MiB) — les limites du bucket en sont la défense en
--    profondeur, et elles s'appliquent aussi à service_role. Type : webp, plus jpeg et png pour
--    supabase/scripts/seed-mock-data.mjs, qui téléverse ses images brutes.
--
-- Le bucket legacy `establishment-photos` (vide, sans policy) n'est pas traité ici : Supabase
-- refuse sa suppression en SQL (cf. 20260815110000), c'est un geste par l'API Storage.

drop policy catalog_media_read on storage.objects;

update storage.buckets
   set file_size_limit = 8388608,
       allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png']
 where id = 'catalog-media';

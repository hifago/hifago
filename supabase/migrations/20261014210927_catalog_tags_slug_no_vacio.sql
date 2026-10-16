-- Une étiquette n'a jamais un slug vide ni blanc.
--
-- Le slug est la clé d'unicité de `catalog_tags` ET l'adresse publique de sa catégorie
-- (`/alojamientos/<slug>`, `/actividades/<slug>`). `slugify` ne garde que lettres et chiffres : un
-- libellé fait de symboles (« $ », « $$ ») donnait un slug VIDE. La première étiquette se créait
-- avec une adresse vide, les suivantes passaient pour son doublon (constaté par Jérôme le
-- 2026-10-13). L'admin calcule désormais le slug par `tagSlug` (gamme de prix → `precio-N`, tout
-- autre nom sans lettre ni chiffre refusé, apps/admin/lib/tags/tagSlug.ts) ; rien n'empêchait
-- encore un autre chemin d'écriture (script, SQL) d'en poser un.
--
-- Les quatre gammes « $ » à « $$$$ » existent déjà dans toute base, créées par
-- `20261014160938_contenu_admin_local_du_13.sql` (slug `precio-N`, rejouable) : rien à créer ici.
--
-- Sur une base peuplée, cet `alter` échoue s'il reste une étiquette au slug vide : la corriger
-- AVANT d'appliquer (même précaution que `catalog_tags_slug_reservado`, 20260908140000).

alter table public.catalog_tags
  add constraint catalog_tags_slug_no_vacio check (slug ~ '[^[:space:]]');

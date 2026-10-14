-- Ce que Jérôme a saisi dans l'admin LOCAL le 2026-10-13, porté vers toute base qui a les mêmes
-- fiches — une migration de DONNÉES, aucun schéma.
--
-- POURQUOI. `/push-db` n'envoie que des migrations : la création d'« Exposición Mirarte », les
-- étiquettes de gamme de prix, les étiquettes des événements et la nouvelle photo d'un transport
-- sont restées dans la base locale, et la préprod ne les montrait pas (constat de Jérôme le
-- 2026-10-14). Inventaire tiré de la base locale depuis le chargement de mockData/ le 2026-10-12 :
-- `audit_log`, puis `created_at` des étiquettes, de leurs rattachements et des photos (ni la
-- création d'une étiquette ni son rattachement à un établissement ne sont audités).
--
-- CLÉS MÉTIER SEULEMENT : slug des fiches et des étiquettes, chemin de la photo. Aucun uuid local.
--
-- REJOUABLE, ET SANS EFFET LÀ OÙ LES FICHES N'EXISTENT PAS. Les étiquettes sont créées partout,
-- prod et CI comprises (une étiquette sans rattachement n'apparaît nulle part sur la vitrine).
-- Tout le reste ne touche que les fiches trouvées par leur slug : sur la prod, qui n'a pas encore
-- de catalogue, et sur la base de CI (`seed.sql` ne connaît aucune de ces fiches), rien d'autre ne
-- bouge. « cultura » vient de `seed.sql`, pas de mockData/ : la préprod ne l'a pas, elle est
-- créée ici avec le même libellé.
--
-- PHOTOS. Une migration ne transporte pas de fichier : une photo n'est rattachée que si son objet
-- est déjà dans le bucket `catalog-media`. `scripts/deploy-preprod.mjs` lit les chemins
-- `products/<uuid>.webp` cités dans les migrations en attente et envoie ceux qui manquent à la
-- préprod AVANT d'appliquer la migration. Ailleurs, la fiche reste sans cette photo plutôt
-- qu'avec une image cassée.
--
-- PAS REPRIS : l'étiquette « Económico » (créée à 15 h 38, posée nulle part — un essai d'avant les
-- « $ ») ; les propositions et leur modération (la fiche approuvée suffit) ; la fiche de test
-- « ZZ Cabaña verificación (temporal) », supprimée en local.
--
-- Délimiteur nommé : les libellés « $$ » à « $$$$ » fermeraient un `do $$ … $$`.

do $contenu$
declare
  c_photo_mirarte constant text := 'products/a78954ca-d5bb-4840-8b72-0be636e380be.webp';
  c_photo_transport constant text := 'products/1f4ae23b-7762-461f-808b-358e20681ab0.webp';
  v_casa_kayam record;
  v_transport uuid;
begin
  -- 1. Étiquettes. Slug `precio-N` : celui que l'admin calcule pour un libellé fait de « $ »
  --    (apps/admin/lib/tags/tagSlug.ts).
  insert into public.catalog_tags (slug, label) values
    ('precio-1', '{"es": "$"}'),
    ('precio-2', '{"es": "$$"}'),
    ('precio-3', '{"es": "$$$"}'),
    ('precio-4', '{"es": "$$$$"}'),
    ('deportes', '{"es": "Deportes"}'),
    ('cultura', '{"es": "Cultura", "en": "Culture"}')
  on conflict (slug) do nothing;

  -- 2. Gamme de prix de deux établissements. Un logement unique en hérite (20261013192000) :
  --    c'est ce qui range Bania Travel sous « $$$ » plutôt que sous « Otros alojamientos ».
  insert into public.establishment_tag_assignments (establishment_id, tag_id)
  select e.id, t.id
    from (values ('casa-kayam', 'precio-1'), ('bania-travel', 'precio-3')) as v (etablissement, etiquette)
    join public.establishments e on e.slug = v.etablissement
    join public.catalog_tags t on t.slug = v.etiquette
  on conflict do nothing;

  -- 3. « Exposición Mirarte », evento ponctuel de Casa Kayam : proposée par le socio, approuvée
  --    par l'admin (21 h 05), puis modifiée par une seconde proposition approuvée (21 h 14). La
  --    ligne est celle de la base locale, colonne par colonne ; seuls l'id, les deux rattachements
  --    et les dates sont posés ici.
  select e.id, e.partner_id into v_casa_kayam from public.establishments e where e.slug = 'casa-kayam';
  if v_casa_kayam.id is not null and not exists (select 1 from public.products where slug = 'exposicion-mirarte') then
    insert into public.products
    select (jsonb_populate_record(null::public.products, $mirarte${
      "name": {"es": "Exposición Mirarte"},
      "description": {"es": "Once artistas abren al público lo que crearon durante dos meses de proceso en el fellowship Mirarte de El Juego. Una tarde para recorrer la muestra y quedarse a las presentaciones en vivo: pintura, fotografía, poesía, danza, stand up, música, performance y yoga."},
      "type": "evento",
      "schedule": "date",
      "qty_unit": "qty",
      "sellable": true,
      "is_free": false,
      "price_label": "gratis",
      "occurrence_type": "once",
      "occurrence_date": "2026-10-15",
      "start_time": "16:00:00",
      "online_bookable": false,
      "calendar_default_open": true,
      "evento_occupies_resource": true,
      "acompte_pct": 0.1500,
      "referral_pct": 0.1000
    }$mirarte$::jsonb || jsonb_build_object(
      'id', gen_random_uuid(),
      'slug', 'exposicion-mirarte',
      'establishment_id', v_casa_kayam.id,
      'partner_id', v_casa_kayam.partner_id,
      'created_at', now(),
      'updated_at', now()
    ))).*;
  end if;

  -- 4. Étiquettes des événements : édition en ligne de la liste admin (19 h 55), et Mirarte.
  insert into public.product_tag_assignments (product_id, tag_id)
  select p.id, t.id
    from (values
      ('fiestas-zocalos-y-flores-silletas-y-colores', 'cultura'),
      ('festival-gastronomico-guatabandeja', 'cultura'),
      ('media-maraton-de-guatape-3-version', 'deportes'),
      ('convocatoria-oficial-guatape-film-fest-2026', 'arte'),
      ('kayam-s-jam', 'musica'),
      ('exposicion-mirarte', 'arte')
    ) as v (produit, etiquette)
    join public.products p on p.slug = v.produit
    join public.catalog_tags t on t.slug = v.etiquette
  on conflict do nothing;

  -- « Kayam's Jam » : « fiesta » retirée une minute après l'ajout de « musica » (19 h 56).
  delete from public.product_tag_assignments a
   using public.products p, public.catalog_tags t
   where a.product_id = p.id and a.tag_id = t.id
     and p.slug = 'kayam-s-jam' and t.slug = 'fiesta';

  -- 5. Photos, seulement si le fichier est déjà dans Storage (voir l'en-tête).
  insert into public.product_media (product_id, storage_path, sort)
  select p.id, c_photo_mirarte, 0
    from public.products p
   where p.slug = 'exposicion-mirarte'
     and exists (select 1 from storage.objects o where o.bucket_id = 'catalog-media' and o.name = c_photo_mirarte)
     and not exists (select 1 from public.product_media m where m.product_id = p.id and m.storage_path = c_photo_mirarte);

  -- Transport privé Medellín ↔ Guatapé, 7 places : la nouvelle photo (21 h 00) REMPLACE celle de
  -- la v1 — en local, c'est la seule qui lui reste.
  select p.id into v_transport from public.products p where p.slug = 'privado-medellin-guatape-hasta-7-pers';
  if v_transport is not null
     and exists (select 1 from storage.objects o where o.bucket_id = 'catalog-media' and o.name = c_photo_transport) then
    delete from public.product_media where product_id = v_transport and storage_path <> c_photo_transport;
    insert into public.product_media (product_id, storage_path, sort)
    select v_transport, c_photo_transport, 0
     where not exists (select 1 from public.product_media m where m.product_id = v_transport and m.storage_path = c_photo_transport);
  end if;
end
$contenu$;

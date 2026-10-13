-- Un logement UNIQUE hérite aussi des étiquettes de son établissement (décision Jérôme, 2026-10-13).
--
-- Constat : Jérôme pose l'étiquette de gamme de prix « $$ » sur l'ÉTABLISSEMENT Bania Travel, et la
-- vitrine continue de ranger Bania sous « Otros alojamientos ». Depuis la bifurcation du 2026-09-14
-- (`20260914110000`, `20260914120000`), un établissement à UN seul couchage vendable s'affiche
-- comme carte PRODUIT, et une carte produit ne lisait que `product_tag_assignments` : les tags
-- de son établissement étaient ignorés — alors que l'admin les laisse poser sans rien dire.
--
-- Règle après cette migration, identique dans les deux fonctions (sinon l'index des catégories et
-- la page `/alojamientos/[categoria]` se contrediraient en silence — même raison que le 09-14) :
--   · carte GROUPÉE (lodging, ≥ 2 couchages vendables) : tags de l'établissement, INCHANGÉ ;
--   · carte produit de type `lodging` (couchage unique) : tags de la fiche ∪ tags de l'établissement ;
--   · tout autre type (activity, transport, camp, evento) : tags de la fiche seulement, INCHANGÉ —
--     une activité n'hérite PAS des tags de son établissement.
--
-- ⚠️ Non couvert, volontairement : la recherche en texte libre (`p_query`) ne lit toujours que les
-- libellés des tags de la FICHE, pour un couchage unique comme pour une carte groupée (comportement
-- préexistant, hors de la demande).
--
-- `create or replace` : signatures STRICTEMENT inchangées (règle §7 de
-- `.claude/rules/supabase.md`), grants conservés. Corps repris des définitions vivantes
-- (`pg_get_functiondef`) par remplacements comptés : deux prédicats dans `search_catalog`, une
-- branche ajoutée à `etiquetas` dans `search_catalog_categorias`. Ni table, ni policy, ni
-- `security definer` : deux lectures `stable` en droits de l'appelant, `search_path = ''`.

CREATE OR REPLACE FUNCTION public.search_catalog(p_query text DEFAULT NULL::text, p_tipos text[] DEFAULT NULL::text[], p_tag_slug text DEFAULT NULL::text, p_sin_tag boolean DEFAULT false, p_personas integer DEFAULT NULL::integer, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_por_tipo integer DEFAULT NULL::integer, p_limite integer DEFAULT 24, p_offset integer DEFAULT 0)
 RETURNS TABLE(tipo text, es_establecimiento boolean, id uuid, slug text, nombre jsonb, descripcion jsonb, precio_cop bigint, precio_desde bigint, precio_label text, establecimiento jsonb, fotos jsonb, total_seccion bigint, rango_seccion bigint, n_alojamientos bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with
conteo_alojamientos as (
  select p.establishment_id, count(*) as n
  from public.products p
  where p.type = 'lodging' and p.sellable and p.establishment_id is not null
  group by p.establishment_id
),

candidatos as (
  select
    p.id,
    p.type,
    p.slug,
    p.name,
    p.description,
    p.price_cop,
    p.price_label,
    p.created_at,
    p.establishment_id,
    e.slug   as est_slug,
    e.name   as est_name,
    coalesce(ca.n, 0) as n_alojamientos,
    p.occurrence_type,
    p.occurrence_date,
    p.recurrence_frequency_days,
    p.recurrence_end_date,
    p.recurrence_end_count
  from public.products p
  join public.establishments e on e.id = p.establishment_id
  left join conteo_alojamientos ca on ca.establishment_id = p.establishment_id
  where p.sellable
    and e.status = 'active'

    and (p_tipos is null or p.type = any (p_tipos))

    -- tag — bifurqué selon la source (cf. en-tête). Un slug ABSENT de catalog_tags est IGNORÉ,
    -- comme tout paramètre invalide de ce dépôt (spec 28 §0 « tipo/tag inconnu → ignoré »).
    and (
      p_tag_slug is null
      or not exists (select 1 from public.catalog_tags ct where ct.slug = p_tag_slug)
      or (
        case
          when p.type = 'lodging' and coalesce(ca.n, 0) >= 2 then
            exists (
              select 1
              from public.establishment_tag_assignments eta
              join public.catalog_tags ct on ct.id = eta.tag_id
              where eta.establishment_id = p.establishment_id and ct.slug = p_tag_slug
            )
          else
            exists (
              select 1
              from public.product_tag_assignments pta
              join public.catalog_tags ct on ct.id = pta.tag_id
              where pta.product_id = p.id and ct.slug = p_tag_slug
            )
            -- Logement UNIQUE (carte produit) : il hérite AUSSI des tags de son établissement.
            or (
              p.type = 'lodging'
              and exists (
                select 1
                from public.establishment_tag_assignments eta
                join public.catalog_tags ct on ct.id = eta.tag_id
                where eta.establishment_id = p.establishment_id and ct.slug = p_tag_slug
              )
            )
        end
      )
    )

    -- sans tag — même bifurcation : un établissement groupé est « sans catégorie » quand AUCUN
    -- tag ne lui est assigné à LUI (pas à une de ses chambres individuellement).
    and (
      not p_sin_tag
      or (
        case
          when p.type = 'lodging' and coalesce(ca.n, 0) >= 2 then
            not exists (
              select 1 from public.establishment_tag_assignments eta
              where eta.establishment_id = p.establishment_id
            )
          else
            not exists (
              select 1 from public.product_tag_assignments pta where pta.product_id = p.id
            )
            -- Logement UNIQUE : un tag hérité de son établissement le classe tout autant.
            and not (
              p.type = 'lodging'
              and exists (
                select 1 from public.establishment_tag_assignments eta
                where eta.establishment_id = p.establishment_id
              )
            )
        end
      )
    )

    and (
      p_personas is null
      or (
        case
          when p.type = 'lodging' then p.capacity is null or p.capacity >= p_personas
          else p.max_qty is null or p.max_qty >= p_personas
        end
      )
    )

    and (
      p_query is null
      or extensions.unaccent(
           coalesce(p.name ->> 'es', '') || ' ' || coalesce(p.name ->> 'en', '') || ' ' ||
           coalesce(e.name ->> 'es', '') || ' ' || coalesce(e.name ->> 'en', '')
         ) ilike '%' || extensions.unaccent(p_query) || '%'
      or exists (
        select 1
        from public.product_tag_assignments pta
        join public.catalog_tags ct on ct.id = pta.tag_id
        where pta.product_id = p.id
          and extensions.unaccent(
                coalesce(ct.label ->> 'es', '') || ' ' || coalesce(ct.label ->> 'en', '')
              ) ilike '%' || extensions.unaccent(p_query) || '%'
      )
    )

    -- Filtre par dates — bifurqué par type (cf. en-tête de cette migration). camp/evento/activity-
    -- à-créneaux ont chacun leur PROPRE modèle de date, jamais écrit dans product_calendar :
    -- product_calendar resterait vacuously "ouvert par défaut" pour eux (bug corrigé ici).
    and (
      p_desde is null or p_hasta is null
      or p.schedule = 'none'
      or (
        case
          -- LOGEMENT ADOSSÉ À LOBBYPMS — la seule branche qui change dans cette migration.
          --
          -- Avant : `or e.lobby_connector_active` court-circuitait le filtre de dates ENTIER, pour
          -- tous les produits d'un établissement connecté. « Il apparaît, sans garantie de
          -- disponibilité » (docs/01 §2f, décision différée le 2026-09-07). Une recherche du 3 au
          -- 5 octobre faisait donc remonter un hôtel complet, et rien ne tenait cette ligne : aucun
          -- test du dépôt ne rougissait si on la retirait.
          --
          -- Maintenant : on lit le miroir (20260917140000), rafraîchi par cron. search_catalog est
          -- du SQL pur, elle ne peut pas appeler Lobby — et un appel à chaud pendant la recherche
          -- ferait suivre le coût au TRAFIC, sans borne, contre un quota de 60 appels par minute.
          --
          -- ⚠️ CHEVAUCHEMENT, pas inclusion : « au moins une nuit disponible dans la plage ». C'est
          -- la règle de TOUS les autres types ici (docs/01 §2a, « Dates = chevauchement »), et elle
          -- évite le cas dégénéré d'une seule date saisie (p_desde = p_hasta, qui ne décrit aucune
          -- nuit et ferait disparaître tous les logements). Le verdict à la nuit près reste posé
          -- plus loin, par le calendrier de la fiche puis par reserve-nights.
          when e.lobby_connector_active and p.type = 'lodging' and p.lobby_category_id is not null then
            exists (
              select 1
              from public.pms_availability_mirror m
              where m.establishment_id = p.establishment_id
                and m.lobby_category_id = p.lobby_category_id
                and m.date between p_desde and p_hasta
                and m.available_units > 0
            )
            -- ÉCHEC OUVERT, et c'est délibéré. Miroir jamais rempli, ou plus rafraîchi depuis six
            -- heures (cron arrêté, Lobby injoignable, jeton révoqué) : on retombe sur la doctrine
            -- optimiste d'avant plutôt que de faire DISPARAÎTRE le partenaire du site. CLAUDE.md
            -- §4.4 impose l'échec fermé sur une RÉSERVATION — jamais sur un affichage, où il
            -- coûterait un chiffre d'affaires sans protéger personne.
            -- ⚠️ `e.lobby_last_synced_at`, PAS un `not exists` sur le miroir. La première version
            -- balayait `pms_availability_mirror` en entier pour CHAQUE chambre invendable (l'`or`
            -- court-circuite, donc ce test n'est atteint que quand le `exists` a échoué) : aucun
            -- index ne couvre `synced_at`, et l'index partiel est filtré `available_units > 0`,
            -- prédicat absent ici. Mesuré sur 10 établissements × 20 catégories × 184 nuits :
            -- 51 ms / 27 475 buffers contre 7,7 ms / 5 030 avec cette forme, résultats identiques.
            -- `e` est DÉJÀ jointe dans `candidatos` : zéro accès de table. Et la colonne est tenue
            -- par `sync_pms_availability_month`, dans la même transaction que l'écriture du mois.
            or e.lobby_last_synced_at is null
            or e.lobby_last_synced_at <= now() - interval '6 hours'
            -- LOT D (20260918180000). L'établissement peut être frais DANS L'ENSEMBLE (un
            -- autre mois vient de réussir) alors que CE mois précis n'a jamais été
            -- synchronisé — horizon qui vient de s'ouvrir (le rang 6 n'entre qu'une fois
            -- par jour), ou couple en échec répété (fail_pms_sync, 20260918170000). La
            -- fraîcheur par établissement ne peut pas le voir : elle ne regarde qu'UNE
            -- colonne, jamais quel mois est derrière. Repli PAR PLAGE : aucune ligne DU
            -- TOUT pour ce (établissement, catégorie, plage) — jamais une ligne à
            -- available_units = 0, qui reste un COMPLET réel et ne doit surtout pas être
            -- ignorée (c'est pour ça que ce n'est pas le même prédicat que le exists()
            -- ci-dessus, qui filtre déjà > 0).
            or not exists (
              select 1
              from public.pms_availability_mirror m2
              where m2.establishment_id = p.establishment_id
                and m2.lobby_category_id = p.lobby_category_id
                and m2.date between p_desde and p_hasta
            )
          -- Les AUTRES produits d'un établissement connecté (activités, transports, camps, eventos)
          -- gardent exactement le comportement d'avant : non filtrés par dates. Élargir le lot à eux
          -- serait un changement de comportement non demandé — ils n'ont rien à voir avec Lobby, qui
          -- ne connaît que des nuits.
          when e.lobby_connector_active then true
          when p.type = 'camp' then
            exists (
              select 1
              from public.product_availability pa
              where pa.product_id = p.id
                -- Arithmétique portée par les PARAMÈTRES, jamais par pa.date : sans ça la borne
                -- basse n'est pas indexable et le scan remonte tous les départs déjà passés.
                and pa.date between p_desde - (p.duration_days - 1) and p_hasta
            )
          when p.type = 'evento' then
            exists (select 1 from public.expand_event_occurrences(p.id, p_desde, p_hasta))
          when p.type = 'activity' and exists (
            select 1 from public.product_slot_rules psr where psr.product_id = p.id
          ) then
            exists (
              select 1
              from public.product_slot_rules psr
              where psr.product_id = p.id
                -- Recouvrement de tableaux plutôt qu'un generate_series corrélé : le sous-select
                -- ne dépend que des paramètres, Postgres l'évalue UNE fois (InitPlan) au lieu de
                -- redérouler la plage par produit candidat. `least(p_desde + 6)` : au-delà de 7
                -- jours consécutifs la plage couvre déjà tous les jours de semaine.
                and psr.weekdays && (
                  select array_agg(distinct extract(isodow from d.jour)::smallint)
                  from generate_series(
                    p_desde, least(p_hasta, p_desde + 6), interval '1 day'
                  ) as d(jour)
                )
            )
          else
            -- Chemin inchangé (lodging, transport, activity sans créneaux) : product_calendar est
            -- CREUX, l'absence de ligne vaut calendar_default_open (true par défaut).
            case
              when p.calendar_default_open then
                (
                  select count(*)
                  from public.product_calendar pc
                  where pc.product_id = p.id
                    and pc.date between p_desde and p_hasta
                    and pc.open = false
                ) < (p_hasta - p_desde + 1)
              else
                exists (
                  select 1
                  from public.product_calendar pc
                  where pc.product_id = p.id
                    and pc.date between p_desde and p_hasta
                    and pc.open
                )
            end
        end
      )
    )
),

filas as (
  select * from (
    select distinct on (c.establishment_id)
      'lodging'::text    as tipo,
      true               as es_establecimiento,
      c.establishment_id as id,
      c.est_slug         as slug,
      c.est_name         as nombre,
      e.description      as descripcion,
      null::bigint       as precio_cop,
      (
        select min(pl.price_cop)::bigint
        from public.products pl
        where pl.establishment_id = c.establishment_id
          and pl.type = 'lodging'
          and pl.sellable
          and pl.price_cop is not null
      )                  as precio_desde,
      null::text         as precio_label,
      null::jsonb        as establecimiento,
      coalesce(
        (
          select jsonb_agg(jsonb_build_object('storage_path', m.storage_path) order by m.sort)
          from public.establishment_media m
          where m.establishment_id = c.establishment_id
        ),
        (
          select jsonb_agg(jsonb_build_object('storage_path', m.storage_path) order by m.sort)
          from public.product_media m
          where m.product_id = c.id
        )
      )                  as fotos,
      c.n_alojamientos::bigint as n_alojamientos,
      c.created_at       as created_at,
      null::date         as next_occurrence
    from candidatos c
    join public.establishments e on e.id = c.establishment_id
    where c.type = 'lodging' and c.n_alojamientos >= 2
    order by c.establishment_id, c.created_at
  ) agrupados

  union all

  select
    c.type             as tipo,
    false              as es_establecimiento,
    c.id               as id,
    c.slug             as slug,
    c.name             as nombre,
    c.description      as descripcion,
    c.price_cop::bigint as precio_cop,
    null::bigint       as precio_desde,
    c.price_label      as precio_label,
    case when c.est_slug is null then null
         else jsonb_build_object('slug', c.est_slug, 'nombre', c.est_name) end as establecimiento,
    (
      select jsonb_agg(jsonb_build_object('storage_path', m.storage_path) order by m.sort)
      from public.product_media m
      where m.product_id = c.id
    )                  as fotos,
    null::bigint       as n_alojamientos,
    c.created_at       as created_at,
    case when c.type = 'evento' then
      public.next_event_occurrence(
        c.occurrence_type, c.occurrence_date, c.recurrence_frequency_days,
        c.recurrence_end_date, c.recurrence_end_count
      )
    end                as next_occurrence
  from candidatos c
  where not (c.type = 'lodging' and c.n_alojamientos >= 2)
),

clasificadas as (
  select
    f.*,
    count(*)     over (partition by f.tipo)                                as total_seccion,
    row_number() over (
      partition by f.tipo
      order by
        case when f.tipo = 'evento' then f.next_occurrence end asc nulls last,
        case when f.tipo = 'evento' then null else f.created_at end desc,
        f.id
    ) as rango_seccion
  from filas f
)
select
  c.tipo, c.es_establecimiento, c.id, c.slug, c.nombre, c.descripcion,
  c.precio_cop, c.precio_desde, c.precio_label, c.establecimiento, c.fotos,
  c.total_seccion, c.rango_seccion, c.n_alojamientos
from clasificadas c
where p_por_tipo is null or c.rango_seccion <= p_por_tipo
order by c.tipo, c.rango_seccion
limit p_limite offset p_offset;
$function$;

CREATE OR REPLACE FUNCTION public.search_catalog_categorias(p_tipo text, p_query text DEFAULT NULL::text, p_personas integer DEFAULT NULL::integer, p_desde date DEFAULT NULL::date, p_hasta date DEFAULT NULL::date, p_por_categoria integer DEFAULT NULL::integer)
 RETURNS TABLE(categoria_slug text, categoria_label jsonb, categoria_description jsonb, categoria_image_path text, es_sin_tag boolean, total_categoria bigint, rango_categoria bigint, tipo text, es_establecimiento boolean, id uuid, slug text, nombre jsonb, descripcion jsonb, precio_cop bigint, precio_desde bigint, precio_label text, establecimiento jsonb, fotos jsonb, n_alojamientos bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with candidatos as (
  select sc.*
  from public.search_catalog(
    p_query    => p_query,
    p_tipos    => array[p_tipo],
    p_personas => p_personas,
    p_desde    => p_desde,
    p_hasta    => p_hasta,
    p_limite   => 1000000
  ) sc
),

-- Une ligne par (candidat, tag) — un candidat portant N tags contribue à N catégories.
etiquetas as (
  select c.id as candidato_id, ct.slug, ct.label, ct.description, ct.image_path
  from candidatos c
  join public.establishment_tag_assignments eta
    on eta.establishment_id = c.id and c.es_establecimiento
  join public.catalog_tags ct on ct.id = eta.tag_id

  union all

  select c.id as candidato_id, ct.slug, ct.label, ct.description, ct.image_path
  from candidatos c
  join public.product_tag_assignments pta
    on pta.product_id = c.id and not c.es_establecimiento
  join public.catalog_tags ct on ct.id = pta.tag_id

  union all

  -- Logement UNIQUE : une carte PRODUIT de type lodging est, par construction de
  -- `search_catalog`, le seul couchage vendable de son établissement — elle hérite AUSSI des tags
  -- de cet établissement. Le `not exists` écarte un tag déjà posé sur la fiche elle-même : sans
  -- lui, la même carte compterait deux fois dans la même catégorie.
  select c.id as candidato_id, ct.slug, ct.label, ct.description, ct.image_path
  from candidatos c
  join public.products p
    on p.id = c.id and not c.es_establecimiento and c.tipo = 'lodging'
  join public.establishment_tag_assignments eta on eta.establishment_id = p.establishment_id
  join public.catalog_tags ct on ct.id = eta.tag_id
  where not exists (
    select 1 from public.product_tag_assignments pta
    where pta.product_id = c.id and pta.tag_id = eta.tag_id
  )
),

con_categoria as (
  select
    e.slug                                                            as categoria_slug,
    e.label                                                           as categoria_label,
    e.description                                                     as categoria_description,
    e.image_path                                                      as categoria_image_path,
    false                                                              as es_sin_tag,
    count(*)     over (partition by e.slug)                           as total_categoria,
    row_number() over (partition by e.slug order by c.rango_seccion)  as rango_categoria,
    c.tipo, c.es_establecimiento, c.id, c.slug as item_slug, c.nombre, c.descripcion,
    c.precio_cop, c.precio_desde, c.precio_label, c.establecimiento, c.fotos, c.n_alojamientos
  from etiquetas e
  join candidatos c on c.id = e.candidato_id
),

-- Le « reste » : un candidat qu'AUCUN tag ne classe (ni établissement, ni produit).
sin_categoria as (
  select
    null::text                              as categoria_slug,
    null::jsonb                             as categoria_label,
    null::jsonb                             as categoria_description,
    null::text                              as categoria_image_path,
    true                                     as es_sin_tag,
    count(*) over ()                        as total_categoria,
    row_number() over (order by c.rango_seccion) as rango_categoria,
    c.tipo, c.es_establecimiento, c.id, c.slug as item_slug, c.nombre, c.descripcion,
    c.precio_cop, c.precio_desde, c.precio_label, c.establecimiento, c.fotos, c.n_alojamientos
  from candidatos c
  where not exists (select 1 from etiquetas e where e.candidato_id = c.id)
)

select
  categoria_slug, categoria_label, categoria_description, categoria_image_path, es_sin_tag,
  total_categoria, rango_categoria, tipo, es_establecimiento, id, item_slug as slug, nombre,
  descripcion, precio_cop, precio_desde, precio_label, establecimiento, fotos, n_alojamientos
from (
  select * from con_categoria
  union all
  select * from sin_categoria
) todo
where p_por_categoria is null or rango_categoria <= p_por_categoria
order by categoria_slug nulls last, rango_categoria;
$function$;

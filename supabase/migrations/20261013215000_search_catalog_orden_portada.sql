-- L'ordre des cartes dans une section de la vitrine (demande Jérôme, 2026-10-13).
--
-- Jusqu'ici : la plus récente d'abord (`created_at desc`), sauf les evento, par prochaine
-- occurrence (20260915110000). Trois règles remplacent cet ordre, une par famille de types :
--
--   · activity, lodging, transport — MÉLANGE DES CATÉGORIES. Jamais deux cartes de la même
--     catégorie de suite tant que c'est évitable (« je ne veux pas deux cartes sport d'eau qui se
--     suivent »). À l'intérieur d'une catégorie, la plus récente d'abord.
--   · camp — PAR PROCHAIN DÉPART, du plus proche au plus lointain. Un camp sans départ à venir
--     passe en dernier.
--   · evento — ALTERNANCE : le ponctuel le plus proche, un récurrent, le ponctuel suivant, un
--     récurrent… Quand une des deux files est vide, l'autre continue seule. Les events qui n'ont
--     plus rien à venir ferment la section.
--
-- ⚠️ L'ordre est décidé ICI, pas dans `buscar.ts`, pour la raison qui a déjà mis le plafond en
-- base (spec 27 §10) : `p_por_tipo` coupe à huit cartes APRÈS le classement. Mélanger en
-- TypeScript ne mélangerait que les huit plus récentes — huit activités nautiques créées la même
-- semaine resteraient huit activités nautiques. Et les listings paginent sur ce même rang
-- (`p_offset`) : un ordre refait côté app ne serait pas le même d'une page à la suivante.
--
-- Il vaut donc pour TOUS les appelants de `search_catalog` (accueil, résultats, listings,
-- `search_catalog_categorias`, qui range chaque catégorie par `rango_seccion`). Dans une page de
-- catégorie toutes les cartes partagent la catégorie : le mélange n'y change rien de visible.
--
-- Décisions prises en écrivant ce lot (pas dans la demande, à signaler) :
--   - La catégorie d'une carte, c'est son étiquette (`catalog_tags`) — celle de l'établissement
--     pour une carte groupée, celles de la fiche (et de l'établissement pour un couchage unique)
--     sinon : exactement les sources du filtre par tag. Une carte à PLUSIEURS étiquettes est
--     rangée sous la première par slug : choix arbitraire mais stable. Aujourd'hui aucune fiche
--     n'en porte plus d'une.
--   - Les cartes SANS étiquette forment une famille à part : elles s'intercalent entre les cartes
--     classées. Une section où rien n'est étiqueté (les transports aujourd'hui) garde donc
--     l'ordre d'avant, la plus récente d'abord.
--   - Quand une catégorie pèse plus de la moitié de la section, des paires sont inévitables :
--     elles sont repoussées en FIN de section, jamais en tête.
--   - Un evento récurrent SANS date d'ancrage (`occurrence_date` nul — « Kayam's Jam ») n'a pas
--     de prochaine date calculable. Il reste un récurrent en cours : il prend son tour dans
--     l'alternance, après les récurrents datés, plutôt que de tomber avec les events passés.
--   - « Prochain départ » d'un camp = première ligne de `product_availability` à partir
--     d'aujourd'hui à Guatapé, complète ou non — la définition de `primeraSalidaIso` sur la fiche.
--
-- Rien ne change dans le RETURNS TABLE ni dans la signature : aucun changement TypeScript, aucun
-- type à régénérer pour `search_catalog`.

-- `interleave_by_category` — fonction PURE (aucune table lue, le résultat ne dépend que de
-- l'argument), donc IMMUTABLE et non SECURITY DEFINER. EXECUTE reste accordé à PUBLIC, comme
-- `next_event_occurrence` et pour la même raison : `search_catalog` est SECURITY INVOKER et
-- l'appelle avec les privilèges du visiteur (anon). Elle n'expose aucune donnée.
--
-- Entrée : la catégorie de chaque carte, dans l'ordre de base. Sortie : à l'indice i, la position
-- (1 = première) de la carte i.
--
-- L'algorithme, à chaque position à remplir :
--   1. si une catégorie pèse PLUS DE LA MOITIÉ de ce qui reste, c'est elle qu'on sert (sauf si
--      elle vient de passer). C'est la seule façon de ne pas se retrouver plus tard avec elle
--      seule : agua×3, arte, musica doit donner agua, arte, agua, musica, agua — un tour de rôle
--      naïf servirait agua, arte, musica, agua, agua.
--   2. sinon, la catégorie servie il y a le plus longtemps (jamais servie d'abord), différente de
--      la précédente ; à égalité, celle dont la prochaine carte est la plus récente. C'est ce qui
--      fait passer TOUTES les catégories avant qu'une ne revienne.
--   3. s'il ne reste que la catégorie précédente, on la sert : la paire est inévitable.
-- La règle 1 suffit à garantir « aucune paire tant que c'est possible » : après avoir servi X, il
-- faut que toute AUTRE catégorie tienne dans la moitié du reste — et une seule catégorie à la fois
-- peut dépasser la moitié.
create or replace function public.interleave_by_category(p_categories text[])
returns int[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_n constant int := coalesce(cardinality(p_categories), 0);
  v_positions int[];
  -- Une case par catégorie distincte, dans l'ordre de première apparition.
  v_names text[] := '{}';
  v_remaining int[] := '{}';  -- cartes pas encore placées
  v_head int[] := '{}';       -- indice de sa prochaine carte à placer
  v_last_used int[] := '{}';  -- position où elle a été servie en dernier (0 = jamais)
  v_count int;
  v_cat text;
  v_k int;
  v_prev int := 0;
  v_pick int;
  v_left int;
begin
  if v_n = 0 then
    return '{}'::int[];
  end if;
  v_positions := array_fill(0, array[v_n]);

  for i in 1..v_n loop
    -- Une carte sans étiquette (null) entre dans la famille '' : un slug n'est jamais vide.
    v_cat := coalesce(p_categories[i], '');
    v_k := array_position(v_names, v_cat);
    if v_k is null then
      v_names := array_append(v_names, v_cat);
      v_remaining := array_append(v_remaining, 1);
      v_head := array_append(v_head, i);
      v_last_used := array_append(v_last_used, 0);
    else
      v_remaining[v_k] := v_remaining[v_k] + 1;
    end if;
  end loop;
  v_count := cardinality(v_names);

  for v_step in 1..v_n loop
    v_left := v_n - v_step + 1;
    v_pick := null;

    -- 1. Une catégorie qui pèse plus de la moitié du reste passe maintenant.
    for k in 1..v_count loop
      if k <> v_prev and 2 * v_remaining[k] > v_left then
        v_pick := k;
        exit;
      end if;
    end loop;

    -- 2. Sinon : la moins récemment servie, puis celle dont la prochaine carte est la plus récente.
    if v_pick is null then
      for k in 1..v_count loop
        if v_remaining[k] > 0 and k <> v_prev and (
          v_pick is null
          or v_last_used[k] < v_last_used[v_pick]
          or (v_last_used[k] = v_last_used[v_pick] and v_head[k] < v_head[v_pick])
        ) then
          v_pick := k;
        end if;
      end loop;
    end if;

    -- 3. Il ne reste que la catégorie précédente : la paire est inévitable.
    if v_pick is null then
      v_pick := v_prev;
    end if;

    v_positions[v_head[v_pick]] := v_step;
    v_remaining[v_pick] := v_remaining[v_pick] - 1;
    v_last_used[v_pick] := v_step;
    if v_remaining[v_pick] > 0 then
      v_k := v_head[v_pick] + 1;
      while coalesce(p_categories[v_k], '') <> v_names[v_pick] loop
        v_k := v_k + 1;
      end loop;
      v_head[v_pick] := v_k;
    end if;
    v_prev := v_pick;
  end loop;

  return v_positions;
end;
$$;

comment on function public.interleave_by_category(text[]) is
  'Ordre qui mélange les catégories d''une section du catalogue : reçoit la catégorie de chaque '
  'carte dans l''ordre de base, rend la position de chacune. Jamais deux cartes de la même '
  'catégorie de suite tant que c''est évitable. Fonction pure, seul appelant : search_catalog.';

-- search_catalog (`create or replace`, signature et RETURNS TABLE strictement inchangés — règle 7
-- de `.claude/rules/supabase.md`, grants conservés). Corps repris de la définition vivante
-- (`pg_get_functiondef`, issue de 20261013192000) par trois remplacements comptés :
--   1. filas, branche groupée : cinq colonnes internes (occurrence_type, occurrence_date,
--      recurrence_end_date, proxima_salida, categoria) — jamais exposées dans le RETURNS TABLE.
--   2. filas, branche produit : les mêmes cinq, dans le même ordre (UNION ALL positionnel).
--   3. clasificadas : précédée de `con_flujo`, `base` et `mezcla` ; le `row_number()` qui décide
--      `rango_seccion` applique les trois règles de l'en-tête. Filtres, regroupement, plafond et
--      pagination : inchangés.

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
      null::date         as next_occurrence,
      null::text         as occurrence_type,
      null::date         as occurrence_date,
      null::date         as recurrence_end_date,
      null::date         as proxima_salida,
      -- La catégorie d'une carte GROUPÉE vient de l'établissement — même source que le filtre
      -- par tag plus haut. Plusieurs tags : le premier par slug, choix arbitraire mais stable.
      (
        select min(ct.slug)
        from public.establishment_tag_assignments eta
        join public.catalog_tags ct on ct.id = eta.tag_id
        where eta.establishment_id = c.establishment_id
      )                  as categoria
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
    end                as next_occurrence,
    c.occurrence_type  as occurrence_type,
    c.occurrence_date  as occurrence_date,
    c.recurrence_end_date as recurrence_end_date,
    -- Prochain départ d'un camp : la première ligne de product_availability à partir
    -- d'aujourd'hui à Guatapé — la même définition que `primeraSalidaIso` sur la fiche.
    case when c.type = 'camp' then
      (
        select min(pa.date)
        from public.product_availability pa
        where pa.product_id = c.id
          and pa.date >= public.today_in_bogota()
      )
    end                as proxima_salida,
    -- Catégorie d'une carte PRODUIT : ses tags, plus ceux de son établissement pour un couchage
    -- unique (20261013192000). Inutile pour camp et evento, classés par date.
    case when c.type not in ('camp', 'evento') then
      (
        select min(t.slug)
        from (
          select ct.slug
          from public.product_tag_assignments pta
          join public.catalog_tags ct on ct.id = pta.tag_id
          where pta.product_id = c.id
          union all
          select ct.slug
          from public.establishment_tag_assignments eta
          join public.catalog_tags ct on ct.id = eta.tag_id
          where eta.establishment_id = c.establishment_id
            and c.type = 'lodging'
        ) t
      )
    end                as categoria
  from candidatos c
  where not (c.type = 'lodging' and c.n_alojamientos >= 2)
),

-- ── L'ORDRE DANS UNE SECTION (demande Jérôme du 2026-10-13, cf. en-tête de 20261013215000) ──────
--
-- Le FLUX d'un evento : 0 = ponctuel à venir, 1 = récurrent en cours, null = plus rien à venir
-- (ponctuel passé, série terminée, ou tout autre type). Un récurrent SANS date d'ancrage n'a pas
-- de prochaine date calculable, mais il reste un récurrent en cours tant que sa série n'est pas
-- close : il prend son tour, après les récurrents datés.
con_flujo as (
  select
    f.*,
    case
      when f.tipo <> 'evento' then null
      when f.occurrence_type = 'once' and f.next_occurrence is not null then 0
      when f.occurrence_type = 'recurring' and (
        f.next_occurrence is not null
        or (
          f.occurrence_date is null
          and (f.recurrence_end_date is null or f.recurrence_end_date >= public.today_in_bogota())
        )
      ) then 1
    end as flujo_evento
  from filas f
),

base as (
  select
    f.*,
    count(*)     over (partition by f.tipo) as total_seccion,
    -- L'ordre de base, inchangé : la plus récente d'abord. C'est lui qui départage tout le reste.
    row_number() over (partition by f.tipo order by f.created_at desc, f.id) as orden_base,
    -- Le TOUR d'un evento dans son flux : 1 = le plus proche des ponctuels, ou des récurrents.
    row_number() over (
      partition by f.tipo, f.flujo_evento
      order by f.next_occurrence asc nulls last, f.created_at desc, f.id
    ) as turno_evento
  from con_flujo f
),

-- Le mélange des catégories, pour tout type qui n'est pas classé par date. UN appel par type :
-- la fonction reçoit les catégories dans l'ordre de base et rend la position de chaque carte.
mezcla as (
  select
    b.tipo,
    public.interleave_by_category(array_agg(b.categoria order by b.orden_base)) as posiciones
  from base b
  where b.tipo not in ('camp', 'evento')
  group by b.tipo
),

clasificadas as (
  select
    b.*,
    row_number() over (
      partition by b.tipo
      order by
        -- camp : par prochain départ ; sans départ à venir, en dernier.
        case when b.tipo = 'camp' then b.proxima_salida end asc nulls last,
        -- evento : par TOUR puis par flux — ponctuel 1, récurrent 1, ponctuel 2, récurrent 2…
        -- Quand un flux est épuisé, l'autre continue seul. Les events sans rien à venir ferment
        -- la section, du plus récemment passé au plus ancien.
        case when b.tipo = 'evento' and b.flujo_evento is not null then b.turno_evento end
          asc nulls last,
        case when b.tipo = 'evento' then b.flujo_evento end asc nulls last,
        case when b.tipo = 'evento' then b.occurrence_date end desc nulls last,
        -- les autres types : la position rendue par le mélange.
        m.posiciones[b.orden_base] asc nulls last,
        b.orden_base
    ) as rango_seccion
  from base b
  left join mezcla m on m.tipo = b.tipo
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

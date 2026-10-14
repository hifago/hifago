-- Connecteur LobbyPMS coupé : logements masqués de la recherche datée, prestataire prévenu
-- (arbitrages de Gabriel au nom de Jérôme, 2026-10-14 : G30 = A, e-mails de coupure et de reprise).
--
-- 1. Types d'e-mail : partner_pms_connector_deactivated et partner_pms_connector_reactivated
--    s'ajoutent à la liste de 20261006192424 (seule définition du CHECK depuis ; 20261014024303 ne
--    le touche pas).
--
-- 2. search_catalog : un logement adossé à Lobby (type lodging, lobby_category_id renseigné) dont
--    l'établissement a lobby_connector_active = false n'apparaît plus dans une recherche AVEC dates.
--    Il retombait jusqu'ici sur les branches génériques du calendrier local et s'affichait
--    disponible. Sans dates, rien ne change : sa fiche dit déjà qu'il ne se réserve pas en ligne.
--    Corps repris de 20261013215000 (dernière définition) par UNE insertion comptée, dans le `case`
--    des dates, après la branche du logement connecté et avant les branches génériques. Signature,
--    RETURNS TABLE et grants inchangés ; aucune écriture (lobby_last_synced_at compris).
--
-- 3. set_establishment_pms_connector : à la transition actif → inactif, et inactif → actif, un
--    e-mail à chaque compte du partenaire propriétaire. Corps repris de 20261006192424 (dernière
--    définition) par deux remplacements comptés (une variable déclarée, un bloc avant le journal).
--    L'ordre des verrous existant (lignes, puis file d'annulation) est inchangé.

-- ============================================================================================
-- 1. Types d'e-mail
-- ============================================================================================
alter table public.notification_emails drop constraint notification_emails_event_type_check;
alter table public.notification_emails
  add constraint notification_emails_event_type_check
  check (event_type in (
    'partner_invitation',
    'admin_new_proposal',
    'admin_new_reconciliation_exception',
    'partner_proposal_decided',
    'partner_commission_earned',
    'partner_payment_confirmed',
    'client_order_confirmed',
    'partner_camp_evento_blocked',
    'client_payment_received_not_honored',
    'client_duplicate_payment_refund',
    'admin_job_stalled',
    'client_order_line_cancelled',
    'partner_order_line_cancelled',
    'partner_pms_connector_deactivated',
    'partner_pms_connector_reactivated'
  ));

-- ============================================================================================
-- 2. search_catalog
-- ============================================================================================
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
          -- LOGEMENT ADOSSÉ À LOBBYPMS, CONNECTEUR COUPÉ (20261014, arbitrage G30 = A) : masqué de la
          -- recherche DATÉE. Atteinte seulement quand la branche du dessus n'a pas pris, donc
          -- quand lobby_connector_active est faux. Sans elle, le logement retombait sur les branches
          -- génériques (calendrier local) et s'affichait disponible, alors que sa fiche le dit non
          -- réservable. Le catalogue sans dates le garde : ce filtre n'est jamais évalué sans dates.
          when p.type = 'lodging' and p.lobby_category_id is not null then false
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

-- ============================================================================================
-- 3. set_establishment_pms_connector
-- ============================================================================================
CREATE OR REPLACE FUNCTION public.set_establishment_pms_connector(p_establishment_id uuid, p_lobby_api_token text DEFAULT NULL::text, p_connector_active boolean DEFAULT false, p_reason text DEFAULT NULL::text, p_same_lobby_account boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_before record;
  v_replaced boolean;
  v_bumped boolean;
  v_changed_at timestamptz;
  v_failed int := 0;
  v_entries int := 0;
  v_name text;
  v_app_base_url text;
  v_account record;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'set_establishment_pms_connector réservé au rôle admin' using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'motif obligatoire pour modifier le connecteur PMS';
  end if;

  -- Migration 20261004005336 : `for no key update`, jamais `for update`. Toute insertion dans la file
  -- d'annulation prend un verrou KEY SHARE sur l'établissement (sa clé étrangère, piège 22) ; un
  -- `for update` la bloquerait — or un écrivain qui tient une ligne bookée (annulation, expiration,
  -- issue du poll) enfile, pendant que le remplacement attend cette ligne pour y accrocher son
  -- entrée de réconciliation : interblocage. NO KEY UPDATE reste incompatible avec le `for share`
  -- des claims de réservation : ils attendent le remplacement (voulu).
  select lobby_connector_active, lobby_has_token, lobby_api_token, name into v_before
    from public.establishments where id = p_establishment_id for no key update;
  if not found then
    raise exception 'établissement introuvable';
  end if;

  -- « Remplacé » se juge sur les jetons normalisés : ni un premier jeton, ni le même jeton recollé
  -- avec des espaces, ni un champ vide. Migration 20261004005336 : un remplacement déclaré sur le MÊME
  -- compte Lobby (rotation du jeton) ne change pas d'époque — par défaut, on suppose un autre compte.
  v_replaced := nullif(btrim(p_lobby_api_token, E' \t\r\n'), '') is not null
     and nullif(btrim(v_before.lobby_api_token, E' \t\r\n'), '') is not null
     and nullif(btrim(p_lobby_api_token, E' \t\r\n'), '') <> nullif(btrim(v_before.lobby_api_token, E' \t\r\n'), '');
  v_bumped := v_replaced and not coalesce(p_same_lobby_account, false);

  update public.establishments
     -- Migration 20261003223900 : un jeton vide ou fait de blancs est ABSENT (jamais écrit), et un jeton
     -- est stocké sans blancs autour (espaces, tabulations, retours à la ligne).
     set lobby_api_token = coalesce(nullif(btrim(p_lobby_api_token, E' \t\r\n'), ''), lobby_api_token),
         lobby_connector_active = p_connector_active,
         -- Migration 20261004005336 : l'instant du remplacement, à l'HORLOGE et après le verrou — un claim
         -- qui a lu l'ancien jeton avant nous date son booking plus tôt, même si notre transaction a
         -- commencé avant la sienne (now() le classerait « nouveau »).
         lobby_token_changed_at = case when v_bumped then clock_timestamp() else lobby_token_changed_at end
   where id = p_establishment_id
  returning lobby_token_changed_at into v_changed_at;

  -- Migration 20261003223900 : un jeton REMPLACÉ peut ouvrir un AUTRE compte Lobby, où un numéro de
  -- booking ne désigne plus la même réservation. Les annulations encore en attente (posées
  -- avec l'ancien jeton, y compris connecteur coupé) passent en échec pour une vérification
  -- manuelle — le contrôle nocturne compte les échecs — au lieu de partir vers ce compte.
  if v_bumped then
    -- Migration 20261004005336 : les bookings VIVANTS posés avec l'ancien jeton ne sont plus jamais
    -- interrogés ni annulés avec le nouveau (claim_pms_poll_batch, claim_pms_cancellation_batch) :
    -- une entrée de réconciliation par booking (commande et numéro, sur sa plus petite ligne) les fait vérifier chez
    -- Lobby et clore à la main. Muette : un seul récapitulatif ci-dessous, au lieu d'un e-mail par
    -- booking et par admin. Aucune en double tant que celle d'un remplacement précédent est ouverte.
    -- Les lignes concernées, en KEY SHARE dans l'ordre des id AVANT l'insertion : ses contrôles
    -- de clé étrangère les prendraient dans l'ordre des bookings, à rebours d'expire_payment_order
    -- et de release_order_after_pms_refusal (lignes par id) — interblocage.
    perform 1
      from public.order_lines ol
      join public.products p on p.id = ol.product_id
     where p.establishment_id = p_establishment_id
       and ol.status = 'reserved'
       and ol.pms_booking_id is not null
       and coalesce(ol.pms_booked_at, ol.created_at) < v_changed_at
     order by ol.id
     for key share of ol;
    -- Migration 20261006192424 : ces verrous de lignes sont pris AVANT la mise en échec de la file
    -- ci-dessous, jamais après. Une annulation tient sa ligne puis son trigger enfile le booking : si
    -- la file était déjà tenue ici, l'insertion attendrait ce remplacement, qui attendrait la ligne —
    -- interblocage. Ordre de tous les écrivains : lignes, puis file.
    update public.pms_cancellation_queue
       set status = 'failed', processed_at = now(),
           last_error = 'jeton Lobby remplacé : annulation à vérifier à la main avant tout renvoi'
     where establishment_id = p_establishment_id and status = 'pending';
    get diagnostics v_failed = row_count;

    insert into public.pms_reconciliation_entries (order_line_id, detail)
    select distinct on (ol.order_id, ol.pms_booking_id) ol.id,
           'jeton Lobby remplacé le ' || to_char(v_changed_at at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI')
             || ' (heure de Colombie) : booking Lobby ' || ol.pms_booking_id
             || ' posé avec l''ancien jeton, plus interrogé ni annulé automatiquement — à vérifier chez '
             || 'Lobby, puis clore la ligne à la main (changement de statut), commande ' || o.reference
      from public.order_lines ol
      join public.products p on p.id = ol.product_id
      join public.orders o on o.id = ol.order_id
     where p.establishment_id = p_establishment_id
       and ol.status = 'reserved'
       and ol.pms_booking_id is not null
       and coalesce(ol.pms_booked_at, ol.created_at) < v_changed_at
       and not exists (
         select 1
           from public.pms_reconciliation_entries r
           join public.order_lines ol2 on ol2.id = r.order_line_id
           join public.products p2 on p2.id = ol2.product_id
          where r.status in ('open', 'retrying')
            and r.detail like 'jeton Lobby remplacé%'
            and strpos(r.detail, ' : booking Lobby ' || ol.pms_booking_id || ' posé ') > 0
            and ol2.order_id = ol.order_id
            and p2.establishment_id = p_establishment_id
       )
     order by ol.order_id, ol.pms_booking_id, ol.id;
    get diagnostics v_entries = row_count;

    -- UN récapitulatif aux admins, seulement si un booking ou une annulation est touché. Sans
    -- related_id : la déduplication des e-mails rendrait muet tout remplacement suivant du même
    -- établissement. Un e-mail en échec ne bloque jamais le remplacement (les entrées restent).
    if v_entries + v_failed > 0 then
      begin
        v_name := coalesce(v_before.name ->> 'es', 'Establecimiento sin nombre');
        select decrypted_secret into v_app_base_url
          from vault.decrypted_secrets where name = 'admin_app_public_url';
        perform public.notify_all_admins(
          'admin_new_reconciliation_exception',
          'Token de Lobby reemplazado: ' || v_entries || ' reserva(s) por verificar — ' || v_name,
          '<p>Se reemplazó el token de Lobby de ' || public.html_text(v_name) || '. ' || v_entries
            || ' reserva(s) hechas con el token anterior ya no se consultan ni se cancelan automáticamente, y '
            || v_failed || ' cancelación(es) pendientes quedaron en error. Revísalas en la conciliación.</p>'
            || '<p><a href="' || coalesce(v_app_base_url, '') || '/admin/reconciliation">Ver reconciliaciones pendientes</a></p>',
          'establishments', null
        );
      exception when others then
        raise warning 'set_establishment_pms_connector : récapitulatif impossible (%) — entrées posées', sqlerrm;
      end;
    end if;
  end if;

  -- Migration 20261014 : le prestataire est prévenu quand la réservation en ligne de ses logements est
  -- COUPÉE ou RÉTABLIE — à la transition seulement, jamais sur un appel qui ne change rien (un
  -- remplacement de jeton connecteur déjà actif reste muet). Un e-mail par compte de connexion du
  -- partenaire propriétaire, chacun isolé (même résolution que partner_order_line_cancelled), jamais
  -- vers une adresse sentinelle (`@hifago.local`). Sans related_id : la déduplication de la file
  -- rendrait muette toute coupure suivante du même établissement. Aucun détail technique, aucun
  -- jeton. Posé APRÈS les verrous et la file d'annulation ci-dessus : l'ordre lignes → file est
  -- inchangé, la file d'e-mails ne verrouille rien de ce qu'ils tiennent.
  if v_before.lobby_connector_active is distinct from p_connector_active then
    v_name := coalesce(v_before.name ->> 'es', 'tu establecimiento');
    for v_account in
      select pa.id as account_id, au.email
        from public.establishments e
        join public.partner_accounts pa on pa.partner_id = e.partner_id
        join auth.users au on au.id = pa.id
       where e.id = p_establishment_id
         and au.email is not null
         and au.email not like '%@hifago.local'
    loop
      begin
        if p_connector_active then
          perform public.enqueue_notification_email(
            'partner_pms_connector_reactivated', v_account.email, v_account.account_id,
            'Tus alojamientos vuelven a reservarse en línea — ' || v_name,
            '<p>Hola,</p><p>La reserva en línea de los alojamientos de <strong>' || public.html_text(v_name)
              || '</strong> está activa de nuevo: tus alojamientos vuelven a reservarse en línea y a aparecer '
              || 'en la búsqueda por fechas.</p><p>Si tienes dudas, contacta al equipo de Hifago.</p>',
            'establishments', null
          );
        else
          perform public.enqueue_notification_email(
            'partner_pms_connector_deactivated', v_account.email, v_account.account_id,
            'Tus alojamientos ya no se reservan en línea — ' || v_name,
            '<p>Hola,</p><p>La reserva en línea de los alojamientos de <strong>' || public.html_text(v_name)
              || '</strong> quedó desactivada: tus alojamientos ya no se pueden reservar en línea y no '
              || 'aparecen en la búsqueda por fechas.</p><p>Si tienes dudas, contacta al equipo de Hifago.</p>',
            'establishments', null
          );
        end if;
      exception
        when query_canceled then
          raise warning 'set_establishment_pms_connector : e-mail prestataire annulé (query_canceled) pour le compte % — %', v_account.account_id, sqlerrm;
        when others then
          raise warning 'set_establishment_pms_connector : échec de l''e-mail prestataire pour le compte % — %', v_account.account_id, sqlerrm;
      end;
    end loop;
  end if;

  perform public.log_admin_action(
    'establishment.set_pms_connector', 'establishments', p_establishment_id,
    jsonb_build_object('connector_active', v_before.lobby_connector_active, 'had_token', v_before.lobby_has_token),
    jsonb_build_object('connector_active', p_connector_active, 'token_replaced', nullif(btrim(p_lobby_api_token, E' \t\r\n'), '') is not null,
                       'same_lobby_account', coalesce(p_same_lobby_account, false), 'token_epoch_bumped', v_bumped,
                       'reconciliation_entries', v_entries, 'cancellations_failed', v_failed),
    p_reason
  );
  return jsonb_build_object('ok', true);
end;
$function$;

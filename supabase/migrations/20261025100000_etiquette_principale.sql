-- L'étiquette PRINCIPALE : seule la première étiquette posée classe une carte dans la vitrine
-- (demande Jérôme, 2026-10-25).
--
-- Constat : « L'expérience viking » porte quatre étiquettes posées par son partenaire — Actividad
-- náutica, Deportes, Tours, Adrenalina — et la vitrine la rangeait dans les QUATRE catégories
-- (décision du 2026-10-14, prise par Gabriel en l'absence de Jérôme). Jérôme : « la seule étiquette
-- qui compte pour le classement, l'apparition dans la vitrine, c'est Actividad náutica. Pour les
-- recherches des clients, les autres étiquettes comptent. » Cette migration remplace donc la
-- décision du 2026-10-14.
--
-- Règle après cette migration :
--   · CLASSEMENT (index des catégories, page /[type]/[categoria], « Otras », mélange des catégories
--     dans une section) : la seule étiquette principale de la carte ;
--   · RECHERCHE en texte libre (`p_query`, et donc les suggestions) : toutes les étiquettes de la
--     fiche, inchangé.
--
-- « Principale » = la première posée. Rien ne retenait cet ordre : les deux tables d'assignation
-- n'avaient qu'un `created_at`, identique pour toutes les étiquettes posées dans la même
-- transaction (approbation d'une proposition, création d'une fiche). D'où :
--   1. une colonne `position` sur `product_tag_assignments` et `establishment_tag_assignments`,
--      reprise de l'ordre existant (`created_at`, puis l'ordre physique d'insertion, qui est l'ordre
--      que l'admin affiche aujourd'hui — sa lecture n'a pas d'`order by`) ;
--   2. un déclencheur qui pose chaque nouvelle étiquette EN FIN de liste : un ajout un par un
--      (sélecteur de l'admin), un `insert` de plusieurs lignes ou une boucle gardent tous l'ordre
--      d'insertion, sans qu'aucun appelant ait à connaître la colonne ;
--   3. `catalog_card_primary_tag_id`, l'unique définition de « l'étiquette principale d'une
--      carte », lue par `search_catalog` (filtre, « sans tag », mélange) et par
--      `search_catalog_categorias` — jamais recopiée ;
--   4. l'ordre voulu par l'auteur, gardé partout où il était perdu : `submit_product_proposal` et
--      `submit_establishment_edit_proposal` retriaient les étiquettes proposées par slug ;
--      `moderate_*_proposal` et `admin_update_product_inline` ne posaient que l'ENSEMBLE. Ils
--      suivent désormais l'ordre du tableau (`catalog_tag_ids_in_order`). Un simple
--      réordonnancement devient donc un changement (proposé, approuvé, audité).
--
-- Décision prise en écrivant ce lot (pas dans la demande, à signaler) : un logement UNIQUE (carte
-- produit) hérite des étiquettes de son établissement depuis le 2026-10-13. Sa principale est celle
-- de l'ÉTABLISSEMENT d'abord, celle de sa fiche à défaut : c'est sur l'établissement que Jérôme
-- classe les logements (« $$ » sur Bania Travel), et la carte garde ainsi la même catégorie si
-- l'établissement gagne ou perd un couchage (carte groupée ↔ carte produit).
--
-- Frontière RLS/RPC-only (CLAUDE.md §3) : inchangée — RLS directe sur les deux tables, aucun des
-- critères RPC-only ne s'applique (pas de capacité, pas d'audit nominatif, contenu public). Les
-- fonctions remplacées le sont par `create or replace`, signatures et RETURNS TABLE strictement
-- inchangés (règle 7 de `.claude/rules/supabase.md`), grants et commentaires conservés ; corps repris
-- des définitions vivantes (`pg_get_functiondef`) par remplacements comptés.

-- ── 1. L'ordre des étiquettes ─────────────────────────────────────────────────────────────────────

alter table public.product_tag_assignments add column if not exists position integer;
alter table public.establishment_tag_assignments add column if not exists position integer;

comment on column public.product_tag_assignments.position is
  'Rang de l''étiquette sur la fiche, 1 = la principale (celle qui classe la carte dans la vitrine). '
  'Toujours posé en fin de liste par le déclencheur à l''insertion (la valeur envoyée est ignorée) ; '
  'réécrit par les RPC qui reçoivent un ordre.';
comment on column public.establishment_tag_assignments.position is
  'Rang de l''étiquette sur l''établissement, 1 = la principale. Même mécanique que '
  'product_tag_assignments.position.';

-- Reprise de l'ordre existant. Idempotente : ne touche que les lignes encore sans rang.
update public.product_tag_assignments a
   set position = o.rang
  from (
    select product_id, tag_id,
           row_number() over (partition by product_id order by created_at, ctid) as rang
      from public.product_tag_assignments
  ) o
 where a.product_id = o.product_id
   and a.tag_id = o.tag_id
   and a.position is null;

update public.establishment_tag_assignments a
   set position = o.rang
  from (
    select establishment_id, tag_id,
           row_number() over (partition by establishment_id order by created_at, ctid) as rang
      from public.establishment_tag_assignments
  ) o
 where a.establishment_id = o.establishment_id
   and a.tag_id = o.tag_id
   and a.position is null;

-- ── 2. Chaque nouvelle étiquette se pose en fin de liste ─────────────────────────────────────────
--
-- BEFORE INSERT FOR EACH ROW : dans un `insert` de plusieurs lignes, chaque déclenchement voit les
-- lignes déjà insérées par la même commande (documentation Postgres, « Visibility of Data
-- Changes »), donc les rangs se suivent dans l'ordre d'insertion. Le rang reçu est TOUJOURS
-- remplacé : une insertion se pose en fin de liste, un réordonnancement passe par un `update`
-- (ce que font les RPC plus bas). SECURITY DEFINER pour que le `max` voie toutes les étiquettes de
-- la fiche quel que soit l'appelant. Deux ajouts SIMULTANÉS sur la même fiche peuvent obtenir le
-- même rang : sans gravité, l'ordre se départage par `created_at` puis `tag_id`, partout où il est
-- lu.

create or replace function public.product_tag_assignment_append()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select coalesce(max(a.position), 0) + 1 into new.position
    from public.product_tag_assignments a
   where a.product_id = new.product_id;
  return new;
end;
$$;

create or replace function public.establishment_tag_assignment_append()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select coalesce(max(a.position), 0) + 1 into new.position
    from public.establishment_tag_assignments a
   where a.establishment_id = new.establishment_id;
  return new;
end;
$$;

revoke all on function public.product_tag_assignment_append() from public, anon, authenticated;
revoke all on function public.establishment_tag_assignment_append() from public, anon, authenticated;

drop trigger if exists product_tag_assignments_append on public.product_tag_assignments;
create trigger product_tag_assignments_append
  before insert on public.product_tag_assignments
  for each row execute function public.product_tag_assignment_append();

drop trigger if exists establishment_tag_assignments_append on public.establishment_tag_assignments;
create trigger establishment_tag_assignments_append
  before insert on public.establishment_tag_assignments
  for each row execute function public.establishment_tag_assignment_append();

-- Après le déclencheur et la reprise : plus aucune ligne sans rang, plus aucune à venir. Le défaut
-- n'est jamais stocké (le déclencheur le remplace) : il dispense seulement les appelants, et le
-- type TypeScript généré, d'envoyer une colonne que la base calcule.
alter table public.product_tag_assignments alter column position set not null;
alter table public.establishment_tag_assignments alter column position set not null;
alter table public.product_tag_assignments alter column position set default 0;
alter table public.establishment_tag_assignments alter column position set default 0;

-- ── 3. Fonctions partagées ───────────────────────────────────────────────────────────────────────

-- Les identifiants d'étiquettes RÉELLES d'un tableau jsonb, dans l'ordre du tableau, sans doublon
-- (premier rang gardé). Même whitelist que l'opérateur `?` sur catalog_tags qu'elle remplace : un
-- identifiant inconnu, mal formé ou supprimé disparaît, aucun texte client n'est casté en uuid.
-- Pas un tableau → tableau vide. Invoker : catalog_tags est lisible par tous.
create or replace function public.catalog_tag_ids_in_order(p_tag_ids jsonb)
returns uuid[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(t.id order by o.rang), '{}'::uuid[])
    from (
      select e.tag_id, min(e.rang) as rang
        from jsonb_array_elements_text(
               case when jsonb_typeof(p_tag_ids) = 'array' then p_tag_ids else '[]'::jsonb end
             ) with ordinality as e(tag_id, rang)
       group by e.tag_id
    ) o
    join public.catalog_tags t on t.id::text = o.tag_id;
$$;

comment on function public.catalog_tag_ids_in_order(jsonb) is
  'Étiquettes réelles d''un tableau jsonb d''identifiants, dans l''ordre du tableau, sans doublon. '
  'L''ordre compte : la première étiquette est la principale (20261025100000).';

-- L'étiquette principale d'une CARTE du catalogue — la seule définition, lue par search_catalog et
-- search_catalog_categorias. `p_grouped` : la carte représente l'établissement entier (logement à
-- deux couchages vendables ou plus), alors seules ses étiquettes à LUI comptent.
--   · tout type sauf lodging : la première étiquette de la fiche ;
--   · carte groupée : la première de l'établissement ;
--   · couchage unique : la première de l'établissement, à défaut celle de la fiche (cf. en-tête).
-- Invoker : mêmes droits que search_catalog qui l'appelle (policies _select des deux tables).
create or replace function public.catalog_card_primary_tag_id(
  p_product_id uuid,
  p_type text,
  p_establishment_id uuid,
  p_grouped boolean
)
returns uuid
language sql
stable
set search_path = ''
as $$
  select case
    when p_type = 'lodging' then coalesce(
      (
        select a.tag_id
          from public.establishment_tag_assignments a
         where a.establishment_id = p_establishment_id
         order by a.position, a.created_at, a.tag_id
         limit 1
      ),
      case when not p_grouped then
        (
          select a.tag_id
            from public.product_tag_assignments a
           where a.product_id = p_product_id
           order by a.position, a.created_at, a.tag_id
           limit 1
        )
      end
    )
    else (
      select a.tag_id
        from public.product_tag_assignments a
       where a.product_id = p_product_id
       order by a.position, a.created_at, a.tag_id
       limit 1
    )
  end;
$$;

comment on function public.catalog_card_primary_tag_id(uuid, text, uuid, boolean) is
  'Étiquette principale (la première posée) d''une carte du catalogue : celle qui la classe dans la '
  'vitrine. Carte groupée → établissement ; couchage unique → établissement puis fiche ; autre type '
  '→ fiche. Seule définition, lue par search_catalog et search_catalog_categorias (20261025100000).';

comment on function public.search_catalog(text, text[], text, boolean, integer, date, date, integer, integer, integer) is
  'Lecture publique du catalogue (spec 27 Lot A / spec 28). security invoker : les policies _select_public s''appliquent d''elles-mêmes. Le filtre par tag (p_tag_slug/p_sin_tag) bifurque entre establishment_tag_assignments (carte groupée) et product_tag_assignments (carte produit) depuis 2026-09-14 ; depuis 2026-10-25 il ne lit que l''étiquette PRINCIPALE de la carte (catalog_card_primary_tag_id) — la recherche en texte libre (p_query), elle, lit toujours toutes les étiquettes de la fiche. Tri par tipo : created_at desc pour 4 types, next_event_occurrence croissant (nulls last) pour evento depuis 2026-09-15. Filtre par dates (p_desde/p_hasta) bifurqué par type depuis 2026-09-16 : product_calendar pour lodging/transport/activity sans créneaux, product_availability (départs) pour camp, expand_event_occurrences pour evento, product_slot_rules (jours de semaine) pour activity à créneaux — cf. 20260916110000_search_catalog_date_filter_by_type.sql. Depuis 2026-09-17, un LOGEMENT adossé à LobbyPMS (lodging + lobby_category_id, établissement lobby_connector_active) est filtré sur pms_availability_mirror — au moins une nuit disponible dans la plage — avec échec OUVERT si le miroir de l''établissement a plus de six heures. Depuis 2026-09-18 (lot D), échec OUVERT AUSSI par plage : aucune ligne du tout pour (établissement, catégorie, p_desde..p_hasta), même si l''établissement est frais par ailleurs (mois nouvellement entré dans l''horizon, ou en échec répété). Les AUTRES produits d''un établissement connecté restent non filtrés par dates, comme avant.';

comment on function public.search_catalog_categorias(text, text, integer, date, date, integer) is
  'Catégories d''un type d''offre, avec leurs items plafonnés par catégorie (remplace search_catalog_tags, 2026-09-14). Appelle search_catalog plutôt que de recopier ses filtres. Depuis 2026-10-25, chaque carte figure dans UNE seule catégorie : celle de son étiquette principale (catalog_card_primary_tag_id, même règle que search_catalog). Ne trie pas par libellé : l''ordre alphabétique dépend de la locale, que la base ne connaît pas.';

-- ── 4. Fonctions remplacées (corps vivants, remplacements comptés) ────────────────────────────────

-- ── search_catalog ──────────────────────────────────────────────────────────────────────────

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

    -- tag = la CATÉGORIE de la carte, c'est-à-dire sa seule étiquette principale (20261025100000 :
    -- « seule la première étiquette compte pour le classement », demande Jérôme du 2026-10-25).
    -- Les autres étiquettes ne classent plus : elles restent cherchables par `p_query`, plus bas.
    -- La source suit la bifurcation groupée/produit, portée par `catalog_card_primary_tag_id` —
    -- la même fonction que `filas` et `search_catalog_categorias`, pour que l'index des
    -- catégories et la page `/[type]/[categoria]` ne puissent pas se contredire. Un slug ABSENT de
    -- catalog_tags est IGNORÉ, comme tout paramètre invalide de ce dépôt (spec 28 §0).
    and (
      p_tag_slug is null
      or not exists (select 1 from public.catalog_tags ct where ct.slug = p_tag_slug)
      or exists (
        select 1
        from public.catalog_tags ct
        where ct.slug = p_tag_slug
          and ct.id = public.catalog_card_primary_tag_id(
                p.id, p.type, p.establishment_id, p.type = 'lodging' and coalesce(ca.n, 0) >= 2)
      )
    )

    -- sans tag : aucune étiquette principale, donc aucune étiquette du tout (même source).
    and (
      not p_sin_tag
      or public.catalog_card_primary_tag_id(
           p.id, p.type, p.establishment_id, p.type = 'lodging' and coalesce(ca.n, 0) >= 2) is null
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
      -- La catégorie d'une carte GROUPÉE : l'étiquette principale de l'établissement — même
      -- source que le filtre par tag plus haut (20261025100000).
      (
        select ct.slug
        from public.catalog_tags ct
        where ct.id = public.catalog_card_primary_tag_id(c.id, 'lodging', c.establishment_id, true)
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
    -- Catégorie d'une carte PRODUIT : son étiquette principale — pour un couchage unique, celle
    -- de son établissement d'abord (20261025100000). Inutile pour camp et evento, classés par date.
    case when c.type not in ('camp', 'evento') then
      (
        select ct.slug
        from public.catalog_tags ct
        where ct.id = public.catalog_card_primary_tag_id(c.id, c.type, c.establishment_id, false)
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

-- ── search_catalog_categorias ───────────────────────────────────────────────────────────────

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

-- UNE ligne au plus par candidat : sa catégorie est sa seule étiquette principale
-- (20261025100000 — jusque-là, un candidat portant N étiquettes figurait dans N catégories). Même
-- fonction que le filtre `p_tag_slug` de `search_catalog` : une carte groupée lit l'établissement,
-- un couchage unique l'établissement puis sa fiche, tout autre type sa fiche.
etiquetas as (
  select c.id as candidato_id, ct.slug, ct.label, ct.description, ct.image_path
  from candidatos c
  left join public.products p on p.id = c.id and not c.es_establecimiento
  join public.catalog_tags ct on ct.id = case
      when c.es_establecimiento then public.catalog_card_primary_tag_id(null, 'lodging', c.id, true)
      else public.catalog_card_primary_tag_id(p.id, p.type, p.establishment_id, false)
    end
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

-- ── submit_product_proposal ──

CREATE OR REPLACE FUNCTION public.submit_product_proposal(p_product_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid := auth.uid();
  v_partner_id uuid;
  v_establishment_id uuid;
  v_type text;
  v_proposal_id uuid;
  v_safe_payload jsonb;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  v_partner_id := (select public.partner_id_for_account(v_account_id));

  select establishment_id, type into v_establishment_id, v_type
    from public.products where id = p_product_id;

  -- Garde-fous 1+2 (identité + propriété) : produit inexistant ou d'un autre partenaire → même
  -- réponse "introuvable" dans les deux cas, jamais un refus explicite qui révèlerait l'existence
  -- du produit d'un tiers (cahier des charges socio §3d).
  if v_establishment_id is null or not exists (
    select 1 from public.establishments
     where id = v_establishment_id and partner_id = v_partner_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'product_not_found');
  end if;

  -- Garde-fou 3 (capacité) : operator actif pour CET établissement précis, pas juste l'identité
  -- (correctif Tranche 1 — has_capability avec le 3e argument).
  if not (select public.has_capability(v_account_id, 'operator', v_establishment_id)) then
    return jsonb_build_object('ok', false, 'reason', 'capability_suspended');
  end if;

  -- Plafond de propositions en attente (cahier des charges socio §3e).
  if (
    select count(*) from public.product_proposals
     where partner_id = v_partner_id and status = 'pending'
  ) >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'pending_cap_exceeded');
  end if;

  -- Ajout de cette migration (20260916140000) : plafond serveur du programme, exactement le motif
  -- de gallery_cap_exceeded. La whitelist ci-dessous ne valide AUCUNE forme — sans ce garde-fou un
  -- socio peut poster plusieurs Mo de JSONB dans product_proposals.payload, qui n'a lui-même
  -- aucune limite de taille. Le plafond par ligne, la borne sur le jour et l'obligation d'un texte
  -- espagnol restent côté app (apps/admin/lib/products/program.ts, testé) : ici on ne borne que
  -- l'abus grossier, le seul que la base puisse constater sans dupliquer la validation métier.
  if jsonb_typeof(p_payload -> 'program') = 'array' and jsonb_array_length(p_payload -> 'program') > 200 then
    return jsonb_build_object('ok', false, 'reason', 'program_cap_exceeded');
  end if;

  -- Whitelist par type — miroir exact du bloc `if (isEditing && product)` de ProductForm
  -- (product-form.tsx), jamais photos/slot_rules (délégués à des blocs séparés à
  -- sauvegarde immédiate côté admin, jamais couverts par ce même submit là non plus). Les
  -- étiquettes (`tag_ids`) entrent depuis 20261013144848 par le bloc gardé en fin de whitelist.
  v_safe_payload := jsonb_build_object('name', p_payload -> 'name', 'description', p_payload -> 'description')
    -- 2026-09-16 (transport informatif) : `transport` RETIRÉ de ce bloc. Un trajet a DEUX
    -- extrémités, donc ses propres colonnes dédiées (transport_departure_*/transport_arrival_*,
    -- bloc ajouté plus bas) ; laisser le trio générique whitelisté pour lui recréerait la double
    -- source de vérité que ces colonnes viennent précisément fermer — une proposition résiduelle
    -- reposerait `address` sur un transport au moment de l'approuver.
    || case when v_type in ('activity', 'lodging') then jsonb_build_object(
         'address', p_payload -> 'address', 'lat', p_payload -> 'lat', 'lon', p_payload -> 'lon'
       ) else '{}'::jsonb end
    || case when v_type <> 'evento' then
         jsonb_build_object('price_cop', p_payload -> 'price_cop') else '{}'::jsonb end
    || case when v_type in ('activity', 'lodging', 'transport') then jsonb_build_object(
         'price_tiers', p_payload -> 'price_tiers', 'min_qty', p_payload -> 'min_qty',
         'max_qty', p_payload -> 'max_qty'
       ) else '{}'::jsonb end
    || case when v_type = 'lodging' then jsonb_build_object(
         'check_in_time', p_payload -> 'check_in_time', 'check_out_time', p_payload -> 'check_out_time'
       ) else '{}'::jsonb end
    -- SEUL CHANGEMENT de cette fonction (2026-08-27, second passage du jour) : `lodging_kind`,
    -- miroir exact de submit_product_creation_proposal ci-dessus — création et édition doivent
    -- whitelister les MÊMES clés, sinon un champ se remplit à la création et disparaît à la
    -- première modification.
    || case when v_type = 'lodging' then
         jsonb_build_object('capacity', p_payload -> 'capacity', 'unit_count', p_payload -> 'unit_count',
                            'lodging_kind', p_payload -> 'lodging_kind', 'unit', p_payload -> 'unit',
                            'stay_rates', p_payload -> 'stay_rates')
       else '{}'::jsonb end
    -- 20261013212500 : `lodging` rejoint cette liste, miroir de submit_product_creation_proposal.
    -- Ici l'oubli EFFAÇAIT : la clé jetée, l'écran de modération affichait un champ vide, renvoyait
    -- null, et l'approbation vidait default_capacity — après quoi roll_lodging_availability_window
    -- (« where default_capacity is not null ») cessait d'ouvrir des nuits pour ce logement.
    || case when v_type in ('activity', 'camp', 'transport', 'lodging') then
         jsonb_build_object('default_capacity', p_payload -> 'default_capacity')
       else '{}'::jsonb end
    -- Ajout de cette migration (20260914140000) : jusqu'ici aucun bloc dédié à camp au-delà de
    -- default_capacity (partagé avec activity/transport) dans ce chemin d'ÉDITION — miroir du bloc
    -- camp déjà présent dans submit_product_creation_proposal (création), même raisonnement.
    || case when v_type = 'camp' then
         jsonb_build_object(
           'group_discount_threshold_qty', p_payload -> 'group_discount_threshold_qty',
           'group_discount_pct', p_payload -> 'group_discount_pct',
           -- Ajout de cette migration (20260916140000) : le programme rejoint le bloc camp déjà
           -- existant — même geste que group_discount_* en 20260914140000. Une clé absente d'ici
           -- est SILENCIEUSEMENT jetée, donc création et édition DOIVENT whitelister les mêmes
           -- clés, sinon le programme se remplirait à la création puis disparaîtrait à la première
           -- modification (précédent vécu : unit_count, lodging_kind, external_booking_url).
           'program', p_payload -> 'program'
         )
       else '{}'::jsonb end
    -- 2026-09-09 : ces deux clés n'étaient whitelistées ici pour AUCUN type, evento compris — un
    -- socio ne pouvait donc pas corriger l'URL d'une vitrine qu'il avait lui-même proposée, ni son
    -- libellé de prix. Défaut antérieur à l'ouverture de la vitrine aux non-eventos, pas une
    -- régression de celle-ci. Whitelistées pour TOUS les types, exactement comme
    -- submit_product_creation_proposal ci-dessus : création et modification doivent whitelister les
    -- MÊMES clés, sinon un champ se remplit à la création et disparaît à la première modification
    -- (c'est la leçon déjà écrite pour `unit_count` et `lodging_kind`).
    -- 2026-09-16 (transport informatif) : miroir EXACT du bloc transport de
    -- submit_product_creation_proposal. Création et édition doivent whitelister les MÊMES clés,
    -- sinon un champ se remplit à la création et disparaît à la première modification — leçon déjà
    -- écrite ici pour unit_count, lodging_kind puis external_booking_url/price_label.
    -- ⚠️ FILTRÉ sur les clés RÉELLEMENT PRÉSENTES, pas un `jsonb_build_object` des 9 clés.
    -- `jsonb_build_object('k', p_payload -> 'k')` produit `{"k": null}` quand la clé est absente
    -- de l'entrée : la clé EXISTE alors dans le payload enregistré, avec la valeur null. Le `?` de
    -- la forme gardée de moderate_product_proposal répondrait « présente » et écrirait ce null —
    -- donc EFFACERAIT les horaires déjà posés, ce que la forme gardée existe précisément pour
    -- empêcher (prouvé par transport_departure_info_proposal_parity.test.sql).
    -- Ici : clé absente ⇒ rien n'entre ⇒ moderate conserve l'existant. Clé présente à null ⇒ elle
    -- entre ⇒ moderate efface, ce qui est bien une demande explicite du prestataire.
    || case when v_type = 'transport'
         then (
           select coalesce(jsonb_object_agg(cle, p_payload -> cle), '{}'::jsonb)
             from unnest(array[
             'transport_first_departure_time', 'transport_last_departure_time',
             'transport_seats_per_departure',
             'transport_departure_address', 'transport_departure_lat', 'transport_departure_lon',
             'transport_arrival_address', 'transport_arrival_lat', 'transport_arrival_lon',
             'transport_contact_phone'
           ]) as cle
            where p_payload ? cle
         )
       else '{}'::jsonb end
    -- 20261013212500 : QUAND un evento a lieu — date, récurrence, heure de début, durée. Ces sept
    -- clés n'étaient whitelistées qu'à la création : en édition, la date et l'heure saisies par le
    -- partenaire disparaissaient avant la modération (constaté sur « Exposición Mirarte »).
    -- Création et édition doivent whitelister les MÊMES clés — leçon déjà écrite plus haut.
    -- ⚠️ FILTRÉ sur les clés RÉELLEMENT PRÉSENTES, comme le bloc transport : une clé absente
    -- n'entre pas (moderate_product_proposal garde alors l'existant), au lieu d'entrer à null.
    || case when v_type = 'evento'
         then (
           select coalesce(jsonb_object_agg(cle, p_payload -> cle), '{}'::jsonb)
             from unnest(array[
             'occurrence_type', 'occurrence_date', 'recurrence_frequency_days',
             'recurrence_end_date', 'recurrence_end_count', 'start_time', 'duration_minutes'
           ]) as cle
            where p_payload ? cle
         )
       else '{}'::jsonb end
    || jsonb_build_object(
         'external_booking_url', p_payload -> 'external_booking_url',
         'price_label', p_payload -> 'price_label'
       )
    -- Ajout de cette migration (20261013144848) : étiquettes proposables en édition, pour TOUS les
    -- types (hasTags de productTypeGating.ts les couvre tous). Clé absente ⇒ rien n'entre ⇒
    -- moderate_product_proposal conserve les étiquettes en place ; tableau présent, même vide ⇒
    -- il entre ⇒ l'approbation REMPLACE l'ensemble. Le tableau stocké est reconstruit depuis
    -- catalog_tags : un identifiant inconnu, mal formé ou supprimé entre-temps est écarté ici, sans
    -- jamais caster en uuid un texte venu du client.
    || case when jsonb_typeof(p_payload -> 'tag_ids') = 'array'
         -- 20261025100000 : l'ORDRE du partenaire est gardé (la première étiquette classe la
         -- carte dans la vitrine) ; il était jusqu'ici retrié par slug.
         then jsonb_build_object('tag_ids',
           to_jsonb(public.catalog_tag_ids_in_order(p_payload -> 'tag_ids')))
       else '{}'::jsonb end
    -- Ajout de cette migration (20261013151206) : équipements d'un LOGEMENT, proposables en édition —
    -- même forme gardée que tag_ids juste au-dessus. Clé absente ⇒ rien n'entre ⇒
    -- moderate_product_proposal conserve les équipements en place ; tableau présent, même vide ⇒
    -- l'approbation REMPLACE l'ensemble.
    || case when v_type = 'lodging' and jsonb_typeof(p_payload -> 'amenity_ids') = 'array'
         then jsonb_build_object('amenity_ids', (
           select coalesce(jsonb_agg(c.id order by c.slug), '[]'::jsonb)
             from public.catalog_amenities c
            where (p_payload -> 'amenity_ids') ? c.id::text
         ))
       else '{}'::jsonb end;

  insert into public.product_proposals (product_id, partner_id, submitted_by, payload)
  values (p_product_id, v_partner_id, v_account_id, v_safe_payload)
  returning id into v_proposal_id;

  return jsonb_build_object('ok', true, 'proposal_id', v_proposal_id);
end;
$function$;

-- ── submit_establishment_edit_proposal ──

CREATE OR REPLACE FUNCTION public.submit_establishment_edit_proposal(p_establishment_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid := auth.uid();
  v_partner_id uuid;
  v_proposal_id uuid;
  v_safe_payload jsonb;
  v_lobby_token text;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  v_partner_id := (select public.partner_id_for_account(v_account_id));

  if not exists (
    select 1 from public.establishments
     where id = p_establishment_id and partner_id = v_partner_id
  ) then
    return jsonb_build_object('ok', false, 'reason', 'establishment_not_found');
  end if;

  if not (select public.has_capability(v_account_id, 'operator', p_establishment_id)) then
    return jsonb_build_object('ok', false, 'reason', 'capability_suspended');
  end if;

  if coalesce(btrim(p_payload -> 'name' ->> 'es'), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'name_required');
  end if;

  if (
    select count(*) from public.establishment_proposals
     where partner_id = v_partner_id and status = 'pending'
  ) >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'pending_cap_exceeded');
  end if;

  v_lobby_token := nullif(btrim(p_payload ->> 'lobby_api_token'), '');

  v_safe_payload := jsonb_build_object(
      'name', p_payload -> 'name', 'description', p_payload -> 'description',
      'address', p_payload -> 'address', 'lat', p_payload -> 'lat', 'lon', p_payload -> 'lon'
    )
    || case when v_lobby_token is not null
         then jsonb_build_object('lobby_api_token', v_lobby_token)
         else '{}'::jsonb end
    -- Ajout de cette migration (20261013144848) : étiquettes proposables en édition — même forme
    -- gardée et même reconstruction depuis catalog_tags que submit_product_proposal.
    || case when jsonb_typeof(p_payload -> 'tag_ids') = 'array'
         -- 20261025100000 : l'ORDRE du partenaire est gardé (la première étiquette classe la
         -- carte dans la vitrine) ; il était jusqu'ici retrié par slug.
         then jsonb_build_object('tag_ids',
           to_jsonb(public.catalog_tag_ids_in_order(p_payload -> 'tag_ids')))
       else '{}'::jsonb end;

  insert into public.establishment_proposals (establishment_id, partner_id, submitted_by, kind, payload)
  values (p_establishment_id, v_partner_id, v_account_id, 'edit', v_safe_payload)
  returning id into v_proposal_id;

  return jsonb_build_object('ok', true, 'proposal_id', v_proposal_id);
end;
$function$;

-- ── moderate_product_proposal ──

CREATE OR REPLACE FUNCTION public.moderate_product_proposal(p_proposal_id uuid, p_decision text, p_expected_version integer, p_corrected_payload jsonb DEFAULT NULL::jsonb, p_rejection_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_proposal record;
  v_final_payload jsonb;
  v_reviewer_email text;
  v_photo jsonb;
  v_next_sort int;
  v_new_product_id uuid;
  v_submitted_by uuid;
  v_submitted_by_email text;
  v_entity_name text;
  v_subject text;
  v_body text;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'moderate_product_proposal réservé au rôle admin' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'décision invalide : %', p_decision;
  end if;
  if p_decision = 'reject' and (p_rejection_reason is null or btrim(p_rejection_reason) = '') then
    raise exception 'motif obligatoire pour un rejet';
  end if;

  select id, product_id, establishment_id, partner_id, type, payload, status, version, reviewed_by, kind
    into v_proposal
    from public.product_proposals where id = p_proposal_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'proposal_not_found');
  end if;
  if v_proposal.status <> 'pending' then
    select email into v_reviewer_email from auth.users where id = v_proposal.reviewed_by;
    return jsonb_build_object('ok', false, 'reason', 'already_handled',
      'status', v_proposal.status, 'reviewed_by_email', v_reviewer_email);
  end if;
  if v_proposal.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'reason', 'version_conflict');
  end if;

  -- 20261019120000 : une activité déposée avec un établissement encore en attente ne peut être
  -- approuvée qu'une fois l'établissement approuvé (establishment_id rattaché par
  -- moderate_establishment_proposal). La rejeter, elle, reste toujours possible.
  if p_decision = 'approve' and v_proposal.kind = 'create' and v_proposal.establishment_id is null then
    return jsonb_build_object('ok', false, 'reason', 'establishment_pending');
  end if;

  if p_decision = 'approve' and v_proposal.kind = 'create' then
    v_final_payload := coalesce(p_corrected_payload, v_proposal.payload)
      || jsonb_build_object('photos', coalesce(v_proposal.payload -> 'photos', '[]'::jsonb));

    v_new_product_id := public.create_product_from_proposal(
      v_proposal.partner_id, v_proposal.establishment_id, v_proposal.type, v_final_payload
    );

    update public.product_proposals
       set status = 'approved', product_id = v_new_product_id, payload = v_final_payload,
           reviewed_by = auth.uid(), reviewed_at = now(), version = version + 1, updated_at = now()
     where id = p_proposal_id;

  elsif p_decision = 'approve' and v_proposal.kind = 'photos' then
    v_final_payload := coalesce(p_corrected_payload, v_proposal.payload);

    select coalesce(max(sort), -1) + 1 into v_next_sort
      from public.product_media where product_id = v_proposal.product_id;

    for v_photo in select * from jsonb_array_elements(v_final_payload -> 'photos')
    loop
      insert into public.product_media (product_id, storage_path, sort)
      values (v_proposal.product_id, v_photo ->> 'storage_path', v_next_sort);
      v_next_sort := v_next_sort + 1;
    end loop;

    update public.product_proposals
       set status = 'approved', payload = v_final_payload, reviewed_by = auth.uid(),
           reviewed_at = now(), version = version + 1, updated_at = now()
     where id = p_proposal_id;

    perform public.log_admin_action('product_proposal.approve_photos', 'product_media',
      v_proposal.product_id, null, v_final_payload, null);

  elsif p_decision = 'approve' then
    v_final_payload := coalesce(p_corrected_payload, v_proposal.payload);

    update public.products
       set name = v_final_payload -> 'name',
           description = v_final_payload -> 'description',
           address = v_final_payload ->> 'address',
           lat = nullif(v_final_payload ->> 'lat', '')::double precision,
           lon = nullif(v_final_payload ->> 'lon', '')::double precision,
           -- 20261013212500 : le prix chiffré d'un evento est un réglage ADMIN (evento réservable
           -- en ligne), jamais proposable — submit_product_proposal l'écarte déjà. Mais le payload
           -- corrigé par l'écran de modération ne repasse pas par cette whitelist et portait null :
           -- approuver une simple correction de texte EFFAÇAIT le prix d'un evento payant.
           price_cop = case when type = 'evento' then price_cop
                            else nullif(v_final_payload ->> 'price_cop', '')::bigint end,
           price_tiers = v_final_payload -> 'price_tiers',
           min_qty = nullif(v_final_payload ->> 'min_qty', '')::int,
           max_qty = nullif(v_final_payload ->> 'max_qty', '')::int,
           check_in_time = nullif(v_final_payload ->> 'check_in_time', '')::time,
           check_out_time = nullif(v_final_payload ->> 'check_out_time', '')::time,
           capacity = nullif(v_final_payload ->> 'capacity', '')::int,
           unit_count = nullif(v_final_payload ->> 'unit_count', '')::int,
           lodging_kind = nullif(v_final_payload ->> 'lodging_kind', ''),
           unit = nullif(v_final_payload ->> 'unit', ''),
           -- 20261013212500 : (1) jamais pour un evento — son aforo est un réglage admin, et le
           -- null du payload corrigé faisait échouer l'approbation sur
           -- products_evento_capacity_mode_requires_capacity ; (2) forme GARDÉE (`?`) pour les
           -- autres : une proposition qui ne porte pas la clé (déposée avant cette migration pour
           -- un logement) ne vide plus le cupo par défaut.
           default_capacity = case when type = 'evento' then default_capacity
                                   when v_final_payload ? 'default_capacity'
                                   then nullif(v_final_payload ->> 'default_capacity', '')::int
                                   else default_capacity end,
           stay_rates = v_final_payload -> 'stay_rates',
           -- Ajout de cette migration (20260914140000) : forme GARDÉE (`?`), même raisonnement que
           -- external_booking_url/price_label juste en dessous — une proposition `pending` créée
           -- AVANT cette migration ne porte pas ces 2 clés ; une écriture inconditionnelle
           -- effacerait un group_discount déjà posé sur le produit au moment de l'approuver.
           group_discount_threshold_qty = case when v_final_payload ? 'group_discount_threshold_qty'
                                               then nullif(v_final_payload ->> 'group_discount_threshold_qty', '')::int
                                               else group_discount_threshold_qty end,
           group_discount_pct = case when v_final_payload ? 'group_discount_pct'
                                     then nullif(v_final_payload ->> 'group_discount_pct', '')::numeric
                                     else group_discount_pct end,
           -- Ajout de cette migration (20260916140000) : GARDÉE comme ses voisines (une proposition
           -- `pending` créée avant cette migration ne porte pas la clé, une écriture
           -- inconditionnelle effacerait le programme posé entre-temps sur le produit), et en plus
           -- NORMALISÉE pour la même raison qu'à l'insert de create_product_from_proposal — sans
           -- quoi une proposition portant {"program": null} ferait échouer l'approbation sur le
           -- CHECK products_program_is_array au lieu d'effacer le programme comme demandé.
           program = case when v_final_payload ? 'program'
                          then case when jsonb_typeof(v_final_payload -> 'program') = 'array'
                                    then v_final_payload -> 'program'
                                    else null end
                          else program end,
           -- 2026-09-09 : sans ces deux colonnes, une proposition qui portait enfin une URL de
           -- vitrine était approuvée SANS elle — la whitelist élargie n'aurait servi à rien.
           -- ⚠️ Forme volontairement différente des lignes ci-dessus (`case when ... ?` plutôt
           -- qu'une écriture inconditionnelle) : une proposition `pending` créée AVANT cette
           -- migration ne porte pas ces clés, et l'écriture inconditionnelle EFFACERAIT l'URL déjà
           -- posée sur le produit au moment de l'approuver. `?` distingue « clé absente » (garder
           -- l'existant) de « clé présente à null » (effacer volontairement) — ce que `->>` seul ne
           -- permet pas. Les autres colonnes ont ce défaut ; on ne le reproduit pas ici.
           external_booking_url = case when v_final_payload ? 'external_booking_url'
                                       then nullif(v_final_payload ->> 'external_booking_url', '')
                                       else external_booking_url end,
           -- 20261013212500 : un evento réservable en ligne n'a jamais de libellé de prix libre
           -- (price_cop fait foi, « jamais les deux en même temps ») — une proposition n'en pose pas.
           price_label = case when online_bookable then price_label
                              when v_final_payload ? 'price_label'
                              then nullif(v_final_payload ->> 'price_label', '')
                              else price_label end,
           -- 2026-09-16 (transport informatif) : forme GARDÉE (`?`), jamais l'écriture
           -- inconditionnelle des lignes address/lat/lon plus haut. Une proposition `pending`
           -- créée AVANT cette migration ne porte pas ces 9 clés, et `->>` seul ne distingue pas
           -- « clé absente » (garder l'existant) de « clé présente à null » (effacer
           -- volontairement) : l'écriture inconditionnelle EFFACERAIT des horaires déjà posés au
           -- moment d'approuver une simple correction de nom.
           transport_first_departure_time = case when v_final_payload ? 'transport_first_departure_time'
                                       then nullif(v_final_payload ->> 'transport_first_departure_time', '')::time
                                       else transport_first_departure_time end,
           transport_last_departure_time = case when v_final_payload ? 'transport_last_departure_time'
                                       then nullif(v_final_payload ->> 'transport_last_departure_time', '')::time
                                       else transport_last_departure_time end,
           transport_seats_per_departure = case when v_final_payload ? 'transport_seats_per_departure'
                                       then nullif(v_final_payload ->> 'transport_seats_per_departure', '')::int
                                       else transport_seats_per_departure end,
           transport_departure_address = case when v_final_payload ? 'transport_departure_address'
                                       then nullif(v_final_payload ->> 'transport_departure_address', '')
                                       else transport_departure_address end,
           transport_departure_lat = case when v_final_payload ? 'transport_departure_lat'
                                       then nullif(v_final_payload ->> 'transport_departure_lat', '')::double precision
                                       else transport_departure_lat end,
           transport_departure_lon = case when v_final_payload ? 'transport_departure_lon'
                                       then nullif(v_final_payload ->> 'transport_departure_lon', '')::double precision
                                       else transport_departure_lon end,
           transport_arrival_address = case when v_final_payload ? 'transport_arrival_address'
                                       then nullif(v_final_payload ->> 'transport_arrival_address', '')
                                       else transport_arrival_address end,
           transport_arrival_lat = case when v_final_payload ? 'transport_arrival_lat'
                                       then nullif(v_final_payload ->> 'transport_arrival_lat', '')::double precision
                                       else transport_arrival_lat end,
           transport_arrival_lon = case when v_final_payload ? 'transport_arrival_lon'
                                       then nullif(v_final_payload ->> 'transport_arrival_lon', '')::double precision
                                       else transport_arrival_lon end,
           transport_contact_phone = case when v_final_payload ? 'transport_contact_phone'
                                       then nullif(v_final_payload ->> 'transport_contact_phone', '')
                                       else transport_contact_phone end,
           -- 20261013212500 : QUAND un evento a lieu. Forme GARDÉE (`?`) comme ses voisines — une
           -- proposition déposée avant cette migration ne porte pas ces clés et ne doit rien
           -- effacer — et réservée au type evento : le payload corrigé par l'admin ne repasse pas
           -- par la whitelist du dépôt. La date et le type d'occurrence ne s'EFFACENT jamais (un
           -- evento sans date disparaît des listes) : une valeur vide garde l'existant.
           -- Si l'evento porte des réservations en cours, le trigger products_capacity_flags_frozen
           -- refuse le changement de date ou de récurrence (voir plus bas dans cette migration).
           occurrence_type = case when type = 'evento'
                                   and nullif(v_final_payload ->> 'occurrence_type', '') is not null
                                  then v_final_payload ->> 'occurrence_type'
                                  else occurrence_type end,
           occurrence_date = case when type = 'evento'
                                   and nullif(v_final_payload ->> 'occurrence_date', '') is not null
                                  then (v_final_payload ->> 'occurrence_date')::date
                                  else occurrence_date end,
           recurrence_frequency_days = case when type = 'evento' and v_final_payload ? 'recurrence_frequency_days'
                                            then nullif(v_final_payload ->> 'recurrence_frequency_days', '')::int
                                            else recurrence_frequency_days end,
           recurrence_end_date = case when type = 'evento' and v_final_payload ? 'recurrence_end_date'
                                      then nullif(v_final_payload ->> 'recurrence_end_date', '')::date
                                      else recurrence_end_date end,
           recurrence_end_count = case when type = 'evento' and v_final_payload ? 'recurrence_end_count'
                                       then nullif(v_final_payload ->> 'recurrence_end_count', '')::int
                                       else recurrence_end_count end,
           start_time = case when type = 'evento' and v_final_payload ? 'start_time'
                             then nullif(v_final_payload ->> 'start_time', '')::time
                             else start_time end,
           duration_minutes = case when type = 'evento' and v_final_payload ? 'duration_minutes'
                                   then nullif(v_final_payload ->> 'duration_minutes', '')::int
                                   else duration_minutes end,
           updated_at = now()
     where id = v_proposal.product_id;

    -- 20261013212500 : un evento à cupo compté dont la date vient de changer n'a aucune ligne de
    -- disponibilité à sa nouvelle date — il serait invendable jusqu'à ce qu'un admin rouvre sa
    -- fiche. Même geste que l'édition admin directe (product-form.tsx). Idempotent
    -- (`on conflict do nothing`), aucun décrément : pas une opération critique au sens de §4.1.
    if exists (
      select 1 from public.products p
       where p.id = v_proposal.product_id and p.type = 'evento' and p.evento_capacity_mode = 'metered'
    ) then
      perform public.provision_evento_availability(v_proposal.product_id);
    end if;

    -- Ajout de cette migration (20261013144848) : étiquettes. Forme GARDÉE comme ses voisines —
    -- une proposition sans la clé (déposée avant cette migration, ou qui ne touche pas aux
    -- étiquettes) ne retire RIEN. Quand la clé est là, l'ensemble est REMPLACÉ : on retire ce qui
    -- n'est plus proposé, on ajoute ce qui manque. La jointure sur catalog_tags écarte une
    -- étiquette supprimée entre le dépôt et l'approbation, qui ferait sinon échouer l'approbation
    -- sur la clé étrangère.
    if jsonb_typeof(v_final_payload -> 'tag_ids') = 'array' then
      delete from public.product_tag_assignments a
       where a.product_id = v_proposal.product_id
         and not ((v_final_payload -> 'tag_ids') ? a.tag_id::text);

      insert into public.product_tag_assignments (product_id, tag_id)
      select v_proposal.product_id, t.id
        from public.catalog_tags t
       where (v_final_payload -> 'tag_ids') ? t.id::text
      on conflict do nothing;

      -- 20261025100000 : l'ORDRE du tableau fait foi — la première étiquette est la principale,
      -- celle qui classe la carte dans la vitrine. Les étiquettes déjà posées y prennent leur rang,
      -- les nouvelles (ajoutées en fin de liste par le déclencheur juste au-dessus) aussi.
      update public.product_tag_assignments a
         set position = o.rang
        from unnest(public.catalog_tag_ids_in_order(v_final_payload -> 'tag_ids'))
             with ordinality as o(tag_id, rang)
       where a.product_id = v_proposal.product_id
         and a.tag_id = o.tag_id;
    end if;

    -- Ajout de cette migration (20261013151206) : équipements, même forme gardée que les étiquettes
    -- ci-dessus (sans la clé, rien n'est retiré). Réservés aux logements : le payload corrigé par
    -- l'admin ne repasse pas par la whitelist du dépôt, d'où la relecture du type ici.
    if jsonb_typeof(v_final_payload -> 'amenity_ids') = 'array'
       and exists (select 1 from public.products p
                    where p.id = v_proposal.product_id and p.type = 'lodging') then
      delete from public.product_amenity_assignments a
       where a.product_id = v_proposal.product_id
         and not ((v_final_payload -> 'amenity_ids') ? a.amenity_id::text);

      insert into public.product_amenity_assignments (product_id, amenity_id)
      select v_proposal.product_id, c.id
        from public.catalog_amenities c
       where (v_final_payload -> 'amenity_ids') ? c.id::text
      on conflict do nothing;
    end if;

    update public.product_proposals
       set status = 'approved', payload = v_final_payload, reviewed_by = auth.uid(),
           reviewed_at = now(), version = version + 1, updated_at = now()
     where id = p_proposal_id;

    perform public.log_admin_action('product_proposal.approve', 'products', v_proposal.product_id,
      null, v_final_payload, null);
  else
    update public.product_proposals
       set status = 'rejected', rejection_reason = p_rejection_reason, reviewed_by = auth.uid(),
           reviewed_at = now(), version = version + 1, updated_at = now()
     where id = p_proposal_id;

    perform public.log_admin_action('product_proposal.reject', 'product_proposals', p_proposal_id,
      null, null, p_rejection_reason);
  end if;

  -- Spec 23 §0/§7 — notification partenaire du verdict, isolée (§8.1). Requête séparée (v_proposal
  -- ne porte pas submitted_by) plutôt qu'élargir le select ci-dessus.
  begin
    select submitted_by into v_submitted_by from public.product_proposals where id = p_proposal_id;
    select email into v_submitted_by_email from auth.users where id = v_submitted_by;
    -- Migration 20261002160349 : v_entity_name ne sert qu'au corps HTML, échappé dès l'affectation ;
    -- le motif, stocké brut, est échappé à l'interpolation (html_text).
    v_entity_name := coalesce(public.html_text(v_proposal.payload -> 'name' ->> 'es'), 'Producto sin nombre');

    if p_decision = 'approve' then
      v_subject := 'Tu propuesta fue aprobada';
      v_body := '<p>Tu propuesta para "' || v_entity_name || '" fue aprobada.</p>';
    else
      v_subject := 'Tu propuesta fue rechazada';
      v_body := '<p>Tu propuesta para "' || v_entity_name || '" fue rechazada.</p>'
        || '<p>Motivo: ' || coalesce(public.html_text(p_rejection_reason), '') || '</p>';
    end if;

    perform public.enqueue_notification_email(
      'partner_proposal_decided', v_submitted_by_email, v_submitted_by, v_subject, v_body,
      'product_proposals', p_proposal_id
    );
  exception
    when query_canceled then
      raise warning 'moderate_product_proposal: notification annulée (query_canceled) pour % — %', p_proposal_id, sqlerrm;
    when others then
      raise warning 'moderate_product_proposal: échec notification pour % — %', p_proposal_id, sqlerrm;
  end;

  return jsonb_build_object('ok', true, 'product_id', v_new_product_id);
end;
$function$;

-- ── moderate_establishment_proposal ──

CREATE OR REPLACE FUNCTION public.moderate_establishment_proposal(p_proposal_id uuid, p_decision text, p_expected_version integer, p_corrected_payload jsonb DEFAULT NULL::jsonb, p_rejection_reason text DEFAULT NULL::text, p_activate_pms_connector boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_proposal record;
  v_final_payload jsonb;
  v_stored_payload jsonb;
  v_reviewer_email text;
  v_current_operated_directly boolean;
  v_new_establishment_id uuid;
  v_photo jsonb;
  v_next_sort int;
  v_submitted_by uuid;
  v_submitted_by_email text;
  v_entity_name text;
  v_subject text;
  v_body text;
  v_lobby_token text;
  v_target_establishment_id uuid;
  v_attached_count int := 0;
  -- 20261019170000 :
  v_contact_phone_saisi text;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'moderate_establishment_proposal réservé au rôle admin' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'décision invalide : %', p_decision;
  end if;
  if p_decision = 'reject' and (p_rejection_reason is null or btrim(p_rejection_reason) = '') then
    raise exception 'motif obligatoire pour un rejet';
  end if;

  select id, establishment_id, partner_id, kind, payload, status, version, reviewed_by
    into v_proposal
    from public.establishment_proposals where id = p_proposal_id for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'proposal_not_found');
  end if;
  if v_proposal.status <> 'pending' then
    select email into v_reviewer_email from auth.users where id = v_proposal.reviewed_by;
    return jsonb_build_object('ok', false, 'reason', 'already_handled',
      'status', v_proposal.status, 'reviewed_by_email', v_reviewer_email);
  end if;
  if v_proposal.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'reason', 'version_conflict');
  end if;

  if p_decision = 'approve' and v_proposal.kind = 'photos' then
    v_final_payload := coalesce(p_corrected_payload, v_proposal.payload);

    select coalesce(max(sort), -1) + 1 into v_next_sort
      from public.establishment_media where establishment_id = v_proposal.establishment_id;

    for v_photo in select * from jsonb_array_elements(v_final_payload -> 'photos')
    loop
      insert into public.establishment_media (establishment_id, storage_path, sort)
      values (v_proposal.establishment_id, v_photo ->> 'storage_path', v_next_sort);
      v_next_sort := v_next_sort + 1;
    end loop;

    update public.establishment_proposals
       set status = 'approved', payload = v_final_payload, reviewed_by = auth.uid(),
           reviewed_at = now(), version = version + 1, updated_at = now()
     where id = p_proposal_id;

    perform public.log_admin_action('establishment_proposal.approve_photos', 'establishment_media',
      v_proposal.establishment_id, null, v_final_payload, null);

  elsif p_decision = 'approve' then
    v_final_payload := jsonb_build_object(
      'name', coalesce(p_corrected_payload -> 'name', v_proposal.payload -> 'name'),
      'description', coalesce(p_corrected_payload -> 'description', v_proposal.payload -> 'description'),
      'address', coalesce(p_corrected_payload -> 'address', v_proposal.payload -> 'address'),
      'lat', coalesce(p_corrected_payload -> 'lat', v_proposal.payload -> 'lat'),
      'lon', coalesce(p_corrected_payload -> 'lon', v_proposal.payload -> 'lon'),
      'photos', coalesce(v_proposal.payload -> 'photos', '[]'::jsonb)
    )
    -- Ajout de cette migration (20261013144848) : étiquettes, édition seulement (une proposition
    -- de création n'en porte pas). Même repli clé par clé que les champs ci-dessus — la correction
    -- de l'admin, sinon la proposition — mais la clé n'entre QUE si un tableau existe : absente,
    -- les étiquettes en place ne bougent pas.
    || case when v_proposal.kind = 'edit'
              and jsonb_typeof(coalesce(p_corrected_payload -> 'tag_ids', v_proposal.payload -> 'tag_ids')) = 'array'
         then jsonb_build_object(
           'tag_ids', coalesce(p_corrected_payload -> 'tag_ids', v_proposal.payload -> 'tag_ids'))
         else '{}'::jsonb end;
    v_lobby_token := nullif(btrim(coalesce(
      p_corrected_payload ->> 'lobby_api_token', v_proposal.payload ->> 'lobby_api_token'
    )), '');

    if v_proposal.kind = 'create' then
      -- 20261019170000 : le WhatsApp — la correction de l'admin, sinon la proposition. Une
      -- proposition déposée avant cette migration n'en porte pas : l'admin le saisit à la
      -- validation (ModerateEstablishmentProposalForm.tsx). Vérifié ICI pour rendre un motif
      -- lisible au lieu de l'exception de create_establishment.
      v_contact_phone_saisi := coalesce(
        nullif(btrim(p_corrected_payload ->> 'contact_phone'), ''), v_proposal.payload ->> 'contact_phone');
      if public.colombian_whatsapp_or_null(v_contact_phone_saisi) is null then
        return jsonb_build_object('ok', false, 'reason',
          case when coalesce(btrim(v_contact_phone_saisi), '') = ''
               then 'contact_phone_required' else 'contact_phone_invalid' end);
      end if;
      v_final_payload := v_final_payload
        || jsonb_build_object('contact_phone', public.colombian_whatsapp_or_null(v_contact_phone_saisi));

      select public.create_establishment(
        v_proposal.partner_id,
        v_final_payload -> 'name',
        v_final_payload -> 'description',
        v_final_payload ->> 'address',
        nullif(v_final_payload ->> 'lat', '')::double precision,
        nullif(v_final_payload ->> 'lon', '')::double precision,
        false,
        v_final_payload ->> 'contact_phone'
      ) into v_new_establishment_id;

      if jsonb_typeof(v_final_payload -> 'photos') = 'array' then
        v_next_sort := 0;
        for v_photo in select * from jsonb_array_elements(v_final_payload -> 'photos') loop
          insert into public.establishment_media (establishment_id, storage_path, sort)
          values (v_new_establishment_id, v_photo ->> 'storage_path', v_next_sort);
          v_next_sort := v_next_sort + 1;
        end loop;
      end if;

      v_target_establishment_id := v_new_establishment_id;

      if v_lobby_token is not null then
        perform public.set_establishment_pms_connector(
          v_new_establishment_id, v_lobby_token, p_activate_pms_connector,
          'Aprobado desde propuesta ' || p_proposal_id
        );
      end if;

      v_stored_payload := v_final_payload - 'lobby_api_token';
      if v_lobby_token is not null then
        v_stored_payload := v_stored_payload || jsonb_build_object('lobby_api_token_provided', true);
      end if;

      update public.establishment_proposals
         set status = 'approved', establishment_id = v_new_establishment_id, payload = v_stored_payload,
             reviewed_by = auth.uid(), reviewed_at = now(), version = version + 1, updated_at = now()
       where id = p_proposal_id;

      -- 20261019120000 : les activités déposées avec cet établissement reçoivent son identifiant
      -- et RESTENT en attente — l'admin les accepte ou les refuse ensuite, une par une. version + 1 :
      -- un écran de modération ouvert avant ce rattachement doit être rechargé.
      update public.product_proposals
         set establishment_id = v_new_establishment_id, version = version + 1, updated_at = now()
       where establishment_proposal_id = p_proposal_id and status = 'pending';
      get diagnostics v_attached_count = row_count;
    else
      select operated_directly into v_current_operated_directly
        from public.establishments where id = v_proposal.establishment_id;

      perform public.update_establishment(
        v_proposal.establishment_id,
        v_final_payload -> 'name',
        v_final_payload -> 'description',
        v_final_payload ->> 'address',
        nullif(v_final_payload ->> 'lat', '')::double precision,
        nullif(v_final_payload ->> 'lon', '')::double precision,
        v_current_operated_directly,
        'Aprobado desde propuesta ' || p_proposal_id
      );

      v_target_establishment_id := v_proposal.establishment_id;

      -- Étiquettes (20261013144848) : écrites ICI et non dans update_establishment, que trois
      -- chemins de modération appellent (.claude/rules/supabase.md). L'ensemble est remplacé, et
      -- la jointure sur catalog_tags écarte une étiquette supprimée depuis le dépôt.
      if jsonb_typeof(v_final_payload -> 'tag_ids') = 'array' then
        delete from public.establishment_tag_assignments a
         where a.establishment_id = v_proposal.establishment_id
           and not ((v_final_payload -> 'tag_ids') ? a.tag_id::text);

        insert into public.establishment_tag_assignments (establishment_id, tag_id)
        select v_proposal.establishment_id, t.id
          from public.catalog_tags t
         where (v_final_payload -> 'tag_ids') ? t.id::text
        on conflict do nothing;

        -- 20261025100000 : l'ORDRE du tableau fait foi (la première étiquette classe la carte).
        update public.establishment_tag_assignments a
           set position = o.rang
          from unnest(public.catalog_tag_ids_in_order(v_final_payload -> 'tag_ids'))
               with ordinality as o(tag_id, rang)
         where a.establishment_id = v_proposal.establishment_id
           and a.tag_id = o.tag_id;
      end if;

      if v_lobby_token is not null then
        perform public.set_establishment_pms_connector(
          v_proposal.establishment_id, v_lobby_token, p_activate_pms_connector,
          'Aprobado desde propuesta ' || p_proposal_id
        );
      end if;

      v_stored_payload := v_final_payload - 'lobby_api_token';
      if v_lobby_token is not null then
        v_stored_payload := v_stored_payload || jsonb_build_object('lobby_api_token_provided', true);
      end if;

      update public.establishment_proposals
         set status = 'approved', payload = v_stored_payload, reviewed_by = auth.uid(),
             reviewed_at = now(), version = version + 1, updated_at = now()
       where id = p_proposal_id;
    end if;
  else
    -- Rejet : rédaction du token avant stockage, même invariant que l'approbation/le retrait.
    v_stored_payload := case when v_proposal.payload ? 'lobby_api_token'
      then (v_proposal.payload - 'lobby_api_token') || jsonb_build_object('lobby_api_token_provided', true)
      else v_proposal.payload end;

    update public.establishment_proposals
       set status = 'rejected', payload = v_stored_payload, rejection_reason = p_rejection_reason,
           reviewed_by = auth.uid(), reviewed_at = now(), version = version + 1, updated_at = now()
     where id = p_proposal_id;

    perform public.log_admin_action('establishment_proposal.reject', 'establishment_proposals',
      p_proposal_id, null, null, p_rejection_reason);

    -- 20261019120000 (arbitrage Jérôme, 2026-10-19 : refus en cascade) : une activité ne peut pas
    -- exister sans son établissement — celles qui attendaient celui-ci sont refusées avec lui,
    -- jamais laissées orphelines dans la file de l'admin.
    update public.product_proposals
       set status = 'rejected', rejection_reason = 'Establecimiento rechazado: ' || p_rejection_reason,
           reviewed_by = auth.uid(), reviewed_at = now(), version = version + 1, updated_at = now()
     where establishment_proposal_id = p_proposal_id and status = 'pending';
    get diagnostics v_attached_count = row_count;

    if v_attached_count > 0 then
      perform public.log_admin_action('product_proposal.reject_with_establishment', 'establishment_proposals',
        p_proposal_id, null, jsonb_build_object('product_proposals_rejected', v_attached_count),
        p_rejection_reason);
    end if;
  end if;

  -- Spec 23 §0/§7 — notification partenaire du verdict, isolée (§8.1).
  begin
    select submitted_by into v_submitted_by from public.establishment_proposals where id = p_proposal_id;
    select email into v_submitted_by_email from auth.users where id = v_submitted_by;
    -- Migration 20261002160349 : v_entity_name ne sert qu'au corps HTML, échappé dès l'affectation ;
    -- le motif, stocké brut, est échappé à l'interpolation (html_text).
    v_entity_name := coalesce(public.html_text(v_proposal.payload -> 'name' ->> 'es'), 'Establecimiento sin nombre');

    if p_decision = 'approve' then
      v_subject := 'Tu propuesta fue aprobada';
      v_body := '<p>Tu propuesta para "' || v_entity_name || '" fue aprobada.</p>'
        -- 20261019120000 : un seul e-mail pour l'établissement et ses activités.
        || case when v_attached_count > 0
             then '<p>' || v_attached_count || ' actividad(es) propuesta(s) con este establecimiento siguen en revisión.</p>'
             else '' end;
    else
      v_subject := 'Tu propuesta fue rechazada';
      v_body := '<p>Tu propuesta para "' || v_entity_name || '" fue rechazada.</p>'
        || '<p>Motivo: ' || coalesce(public.html_text(p_rejection_reason), '') || '</p>'
        || case when v_attached_count > 0
             then '<p>' || v_attached_count || ' actividad(es) propuesta(s) con este establecimiento también fueron rechazadas.</p>'
             else '' end;
    end if;

    perform public.enqueue_notification_email(
      'partner_proposal_decided', v_submitted_by_email, v_submitted_by, v_subject, v_body,
      'establishment_proposals', p_proposal_id
    );
  exception
    when query_canceled then
      raise warning 'moderate_establishment_proposal: notification annulée (query_canceled) pour % — %', p_proposal_id, sqlerrm;
    when others then
      raise warning 'moderate_establishment_proposal: échec notification pour % — %', p_proposal_id, sqlerrm;
  end;

  return jsonb_build_object('ok', true);
end;
$function$;

-- ── admin_update_product_inline ──

CREATE OR REPLACE FUNCTION public.admin_update_product_inline(p_product_id uuid, p_changes jsonb, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_key text;
  -- État stocké, lu sous verrou.
  v_name jsonb;
  v_type text;
  v_establishment_id uuid;
  v_partner_id uuid;
  v_price_cop bigint;
  v_price_tiers jsonb;
  v_is_free boolean;
  v_sellable boolean;
  v_lobby_category_id int;
  v_lobby_product_id int;
  v_duration_days int;
  v_occurrence_date date;
  v_external_booking_url text;
  v_tag_ids uuid[];
  -- État demandé.
  v_new_name_es text;
  v_new_type text;
  v_new_establishment_id uuid;
  v_new_partner_id uuid;
  v_new_price numeric;
  v_new_sellable boolean;
  v_new_tag_ids uuid[];
  v_type_changes boolean := false;
  v_establishment_changes boolean := false;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'admin_update_product_inline réservé au rôle admin' using errcode = '42501';
  end if;

  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'p_changes doit être un objet jsonb';
  end if;

  -- Liste blanche : une clé inconnue est une erreur d'appelant, pas un refus métier — elle lève.
  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key not in ('name_es', 'establishment_id', 'type', 'price_cop', 'sellable', 'tag_ids') then
      raise exception 'clé non autorisée : %', v_key;
    end if;
  end loop;

  -- `for no key update` : verrouille la ligne contre un autre admin sans bloquer l'insert d'une
  -- order_lines (clé étrangère, `for key share`) — create_order tient déjà ses lignes de capacité
  -- quand il insère, un `for update` ici l'aurait fait attendre sans rien protéger de plus.
  select name, type, establishment_id, partner_id, price_cop, price_tiers, is_free, sellable,
         lobby_category_id, lobby_product_id, duration_days, occurrence_date, external_booking_url
    into v_name, v_type, v_establishment_id, v_partner_id, v_price_cop, v_price_tiers, v_is_free,
         v_sellable, v_lobby_category_id, v_lobby_product_id, v_duration_days, v_occurrence_date,
         v_external_booking_url
    from public.products
   where id = p_product_id
     for no key update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- ---------- Validation de chaque clé présente (aucune écriture avant la fin de ce bloc) ------
  if p_changes ? 'name_es' then
    if jsonb_typeof(p_changes -> 'name_es') <> 'string' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_name');
    end if;
    v_new_name_es := btrim(p_changes ->> 'name_es');
    if v_new_name_es = '' or char_length(v_new_name_es) > 200 then
      return jsonb_build_object('ok', false, 'reason', 'invalid_name');
    end if;
  end if;

  if p_changes ? 'price_cop' then
    if jsonb_typeof(p_changes -> 'price_cop') <> 'number' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_price');
    end if;
    v_new_price := (p_changes ->> 'price_cop')::numeric;
    if v_new_price <= 0 or v_new_price <> trunc(v_new_price) or v_new_price > 1000000000000 then
      return jsonb_build_object('ok', false, 'reason', 'invalid_price');
    end if;
  end if;

  if p_changes ? 'sellable' then
    if jsonb_typeof(p_changes -> 'sellable') <> 'boolean' then
      raise exception 'sellable doit être un booléen';
    end if;
    v_new_sellable := (p_changes ->> 'sellable')::boolean;
  end if;

  if p_changes ? 'type' then
    v_new_type := p_changes ->> 'type';
    if v_new_type is null
       or v_new_type not in ('lodging', 'activity', 'transport', 'camp', 'evento') then
      return jsonb_build_object('ok', false, 'reason', 'invalid_type');
    end if;
    v_type_changes := v_new_type <> v_type;
  end if;

  if p_changes ? 'establishment_id' then
    -- Comparaison en texte : aucune chaîne venue du client n'est castée en uuid (une valeur
    -- malformée donne « introuvable », jamais une erreur de cast).
    select e.id, e.partner_id into v_new_establishment_id, v_new_partner_id
      from public.establishments e
     where e.id::text = p_changes ->> 'establishment_id';
    if v_new_establishment_id is null then
      return jsonb_build_object('ok', false, 'reason', 'establishment_not_found');
    end if;
    v_establishment_changes := v_new_establishment_id <> v_establishment_id;
  end if;

  if p_changes ? 'tag_ids' then
    if jsonb_typeof(p_changes -> 'tag_ids') <> 'array' then
      raise exception 'tag_ids doit être un tableau';
    end if;
    -- RECONSTRUIT depuis catalog_tags (opérateur `?`), jamais recopié : un identifiant inconnu
    -- disparaît, aucun texte client n'est casté (même parti pris que 20261013144848).
    -- 20261025100000 : dans l'ORDRE reçu (la première étiquette est la principale), et l'état
    -- stocké dans l'ordre de `position` : un simple réordonnancement est donc un changement,
    -- écrit et audité comme les autres.
    v_new_tag_ids := public.catalog_tag_ids_in_order(p_changes -> 'tag_ids');
    select coalesce(array_agg(a.tag_id order by a.position, a.created_at, a.tag_id), '{}'::uuid[])
      into v_tag_ids
      from public.product_tag_assignments a
     where a.product_id = p_product_id;
  end if;

  -- ---------- Gardes du prix ------------------------------------------------------------------
  if v_new_price is not null and v_new_price is distinct from v_price_cop then
    -- Avec des paliers, price_cop est DÉRIVÉ (le palier le plus bas, productEditPayload.ts) :
    -- l'écrire seul le désynchroniserait de price_tiers. `'null'::jsonb` n'est pas un palier.
    if jsonb_typeof(v_price_tiers) = 'array' and jsonb_array_length(v_price_tiers) > 0 then
      return jsonb_build_object('ok', false, 'reason', 'price_has_tiers');
    end if;
    -- Lu sur le type STOCKÉ : si la fiche quitte `evento` dans ce même appel, is_free repart à
    -- false plus bas et le prix redevient légitime.
    if v_is_free and coalesce(v_new_type, v_type) = 'evento' then
      return jsonb_build_object('ok', false, 'reason', 'price_free_evento');
    end if;
  end if;

  -- ---------- Gardes du changement de type / d'établissement (en-tête, points 1 à 5) ----------
  if v_type_changes or v_establishment_changes then
    if v_sellable then
      return jsonb_build_object('ok', false, 'reason', 'must_unpublish_first');
    end if;
    if exists (select 1 from public.order_lines ol where ol.product_id = p_product_id) then
      return jsonb_build_object('ok', false, 'reason', 'has_orders');
    end if;
    if v_lobby_category_id is not null or v_lobby_product_id is not null then
      return jsonb_build_object('ok', false, 'reason', 'pms_linked');
    end if;
    if exists (
      select 1 from public.product_proposals pp
       where pp.product_id = p_product_id and pp.status = 'pending'
    ) then
      return jsonb_build_object('ok', false, 'reason', 'pending_proposal');
    end if;
  end if;

  if v_type_changes then
    if exists (select 1 from public.product_availability a where a.product_id = p_product_id)
       or exists (select 1 from public.product_slot_availability s where s.product_id = p_product_id)
       or exists (select 1 from public.product_slot_rules r where r.product_id = p_product_id)
       or exists (select 1 from public.product_date_rates d where d.product_id = p_product_id) then
      return jsonb_build_object('ok', false, 'reason', 'has_capacity_config');
    end if;
    -- duration_days et la date d'un evento ne se saisissent qu'à la création (product-form.tsx,
    -- « gap création-only ») : une fiche convertie sans eux resterait incomplète pour toujours.
    if v_new_type = 'camp' and v_duration_days is null then
      return jsonb_build_object('ok', false, 'reason', 'camp_needs_duration');
    end if;
    if v_new_type = 'evento' and v_occurrence_date is null then
      return jsonb_build_object('ok', false, 'reason', 'evento_needs_date');
    end if;
    -- products_price_cop_required_unless_vitrine : hors evento, il faut un prix ou une vitrine.
    if v_new_type <> 'evento'
       and coalesce(v_new_price::bigint, v_price_cop) is null
       and v_external_booking_url is null then
      return jsonb_build_object('ok', false, 'reason', 'type_needs_price');
    end if;
  end if;

  -- ---------- Écritures -----------------------------------------------------------------------
  if v_new_name_es is not null and v_new_name_es is distinct from (v_name ->> 'es') then
    -- Seule la clé `es` bouge : les autres langues du contenu partenaire sont conservées
    -- (CLAUDE.md §5.1). Le slug ne suit pas — il n'est posé qu'à l'insert (products_set_slug),
    -- l'URL publique d'une fiche renommée ne change donc pas.
    update public.products
       set name = coalesce(name, '{}'::jsonb) || jsonb_build_object('es', v_new_name_es)
     where id = p_product_id;
    v_before := v_before || jsonb_build_object('name_es', v_name ->> 'es');
    v_after := v_after || jsonb_build_object('name_es', v_new_name_es);
  end if;

  if v_type_changes then
    update public.products
       set type = v_new_type,
           default_capacity = null,
           -- products_*_evento_only
           online_bookable = false,
           evento_capacity_mode = null,
           is_free = false,
           evento_payment_mode = null,
           evento_occupies_resource = true,
           -- products_group_discount_camp_only / products_program_camp_only
           group_discount_threshold_qty = null,
           group_discount_pct = null,
           program = null,
           -- products_transport_info_transport_only / products_transport_contact_phone_transport_only
           transport_first_departure_time = null,
           transport_last_departure_time = null,
           transport_seats_per_departure = null,
           transport_departure_address = null,
           transport_departure_lat = null,
           transport_departure_lon = null,
           transport_arrival_address = null,
           transport_arrival_lat = null,
           transport_arrival_lon = null,
           transport_contact_phone = null
     where id = p_product_id;
    -- Les équipements structurés n'existent que pour un logement (productTypeGating.hasAmenities).
    if v_type = 'lodging' then
      delete from public.product_amenity_assignments where product_id = p_product_id;
    end if;
    v_before := v_before || jsonb_build_object('type', v_type);
    v_after := v_after || jsonb_build_object('type', v_new_type);
  end if;

  if v_establishment_changes then
    -- partner_id suit l'établissement : products.partner_id = establishments.partner_id est un
    -- invariant du catalogue (transfer_establishment le tient de son côté).
    update public.products
       set establishment_id = v_new_establishment_id,
           partner_id = v_new_partner_id
     where id = p_product_id;
    v_before := v_before
      || jsonb_build_object('establishment_id', v_establishment_id, 'partner_id', v_partner_id);
    v_after := v_after
      || jsonb_build_object('establishment_id', v_new_establishment_id, 'partner_id', v_new_partner_id);
  end if;

  if v_new_price is not null and v_new_price is distinct from v_price_cop then
    update public.products set price_cop = v_new_price::bigint where id = p_product_id;
    v_before := v_before || jsonb_build_object('price_cop', v_price_cop);
    v_after := v_after || jsonb_build_object('price_cop', v_new_price::bigint);
  end if;

  if v_new_tag_ids is not null and v_new_tag_ids is distinct from v_tag_ids then
    delete from public.product_tag_assignments
     where product_id = p_product_id and not (tag_id = any (v_new_tag_ids));
    insert into public.product_tag_assignments (product_id, tag_id)
    select p_product_id, t from unnest(v_new_tag_ids) as t
    on conflict (product_id, tag_id) do nothing;
    update public.product_tag_assignments a
       set position = o.rang
      from unnest(v_new_tag_ids) with ordinality as o(tag_id, rang)
     where a.product_id = p_product_id
       and a.tag_id = o.tag_id;
    v_before := v_before || jsonb_build_object('tag_ids', to_jsonb(v_tag_ids));
    v_after := v_after || jsonb_build_object('tag_ids', to_jsonb(v_new_tag_ids));
  end if;

  if v_after <> '{}'::jsonb then
    update public.products set updated_at = now() where id = p_product_id;
    perform public.log_admin_action(
      'product.update_inline', 'products', p_product_id, v_before, v_after, p_note
    );
  end if;

  -- Publication en DERNIER, sous les mêmes noms d'action que set_product_sellable : le journal
  -- d'audit garde une seule façon de dire « publié / dépublié », quel que soit l'écran.
  if v_new_sellable is not null and v_new_sellable <> v_sellable then
    update public.products set sellable = v_new_sellable, updated_at = now() where id = p_product_id;
    perform public.log_admin_action(
      case when v_new_sellable then 'product.publish' else 'product.unpublish' end,
      'products', p_product_id,
      jsonb_build_object('sellable', v_sellable),
      jsonb_build_object('sellable', v_new_sellable),
      p_note
    );
  end if;

  return jsonb_build_object('ok', true);
end;
$function$;

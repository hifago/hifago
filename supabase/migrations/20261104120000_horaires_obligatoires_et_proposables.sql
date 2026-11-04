-- Horaires d'une activité : obligatoires à la création, proposables en édition (demande Jérôme du
-- 2026-11-04).
--
-- Constat :
--   1. Une activité pouvait être créée SANS horaire (« Horarios — opcional ») : sans règle, aucun
--      créneau n'est dérivé et le client ne peut pas choisir d'heure.
--   2. Une fois sa fiche partagée, le partenaire ne pouvait plus toucher à ses horaires : « Proponer
--      edición » (submit_product_proposal) ne les whitelistait pas — ils vivaient côté admin dans un
--      bloc à sauvegarde immédiate (ProductSlotRulesBlock), écriture admin-only.
--
-- Ce que fait cette migration :
--   * public.proposal_slot_rules relit un tableau de règles venu du client, règle par règle, et le
--     reconstruit dans la forme exacte de product_slot_rules — ou rend NULL s'il est illisible.
--     Aucun texte du client n'est casté ailleurs : une règle invalide est refusée au DÉPÔT, au lieu
--     de faire échouer l'approbation.
--   * submit_product_creation_proposal refuse une activité sans horaire (slot_rules_required).
--   * submit_product_proposal laisse entrer `slot_rules` pour une activité, en forme GARDÉE comme
--     tag_ids (20261013144848) : clé absente ⇒ horaires en place conservés ; présente ⇒ au moins un.
--   * moderate_product_proposal REMPLACE les horaires à l'approbation d'une édition (par
--     replace_product_slot_rules, la même RPC que l'admin), et exige au moins un horaire à
--     l'approbation d'une création d'activité, y compris corrigée par l'admin.
--
-- Frontière RLS / RPC-only (CLAUDE.md §3) : aucune table ni policy nouvelle. product_slot_rules reste
-- RPC-only (20261002000402) ; le partenaire n'y écrit toujours pas — c'est l'approbation d'un admin,
-- dans une RPC security definer existante, qui écrit pour lui. Aucune signature ne change (create or
-- replace suffit, grants conservés). Aucune de ces RPC n'est critique au sens de §4.1 :
-- product_slot_rules ne porte aucun compteur (booked vit dans product_slot_availability).
--
-- Corps repris des définitions vivantes (pg_get_functiondef) par remplacements comptés, jamais
-- retapés — seuls les blocs marqués 20261104120000 sont nouveaux.
-- Prouvé par supabase/tests/database/proposal_edit_slot_rules.test.sql.

-- ── proposal_slot_rules ───────────────────────────────────────────────────────────────────────
-- Même règles que les contraintes de product_slot_rules (jours 1-7 non vides, fin > début, durée
-- et capacité ≥ 1) et que validateSlotRules (apps/admin/lib/products/slotRules.ts). Le
-- chevauchement de deux règles reste vérifié côté écran seulement, comme pour l'admin. Plafond de
-- 50 règles : la whitelist ne borne rien d'autre, et une proposition n'a pas de limite de taille.
create or replace function public.proposal_slot_rules(p_rules jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_rule jsonb;
  v_out jsonb := '[]'::jsonb;
  v_weekdays int[];
  v_start time;
  v_end time;
  v_duration int;
  v_capacity int;
begin
  if jsonb_typeof(p_rules) is distinct from 'array' or jsonb_array_length(p_rules) > 50 then
    return null;
  end if;

  for v_rule in select value from jsonb_array_elements(p_rules) loop
    if jsonb_typeof(v_rule) is distinct from 'object'
       or jsonb_typeof(v_rule -> 'weekdays') is distinct from 'array' then
      return null;
    end if;

    select array_agg(distinct (w)::int order by (w)::int) into v_weekdays
      from jsonb_array_elements_text(v_rule -> 'weekdays') w;
    v_start := (v_rule ->> 'start_time')::time;
    v_end := (v_rule ->> 'end_time')::time;
    v_duration := (v_rule ->> 'slot_duration_minutes')::int;
    v_capacity := (v_rule ->> 'capacity')::int;

    if v_weekdays is null
       or exists (select 1 from unnest(v_weekdays) d where d not between 1 and 7)
       or v_start is null or v_end is null or v_end <= v_start
       or v_duration is null or v_duration < 1
       or v_capacity is null or v_capacity < 1 then
      return null;
    end if;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'weekdays', to_jsonb(v_weekdays),
      'start_time', v_start::text,
      'end_time', v_end::text,
      'slot_duration_minutes', v_duration,
      'capacity', v_capacity
    ));
  end loop;

  return v_out;
exception
  -- Un cast impossible (« 25:00 », « dos », 1.5) : la règle est illisible, jamais une erreur.
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow
       or numeric_value_out_of_range then
    return null;
end;
$$;

revoke all on function public.proposal_slot_rules(jsonb) from public, anon, authenticated;

-- ── submit_product_creation_proposal ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.submit_product_creation_proposal(p_establishment_id uuid DEFAULT NULL::uuid, p_type text DEFAULT NULL::text, p_payload jsonb DEFAULT NULL::jsonb, p_establishment_proposal_id uuid DEFAULT NULL::uuid)
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
  v_safe_photos jsonb;
  v_lobby_connector_active boolean;
  v_slot_rules jsonb;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;
  -- 20261019120000 : p_type a désormais un DEFAULT (contrainte de PostgreSQL : tout paramètre qui
  -- suit un paramètre à défaut en a un) — `null not in (...)` vaut null, jamais vrai : sans le
  -- `is null`, un type absent passerait ce garde.
  if p_type is null or p_type not in ('activity', 'evento', 'camp', 'lodging', 'transport') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_type');
  end if;

  v_partner_id := (select public.partner_id_for_account(v_account_id));

  -- 20261019120000 : la cible est SOIT un établissement existant, SOIT une proposition de création
  -- d'établissement encore en attente — jamais les deux, jamais aucune.
  if (p_establishment_id is null) = (p_establishment_proposal_id is null) then
    return jsonb_build_object('ok', false, 'reason', 'establishment_not_found');
  end if;

  if p_establishment_id is not null then
    if v_partner_id is null or not exists (
      select 1 from public.establishments where id = p_establishment_id and partner_id = v_partner_id
    ) then
      return jsonb_build_object('ok', false, 'reason', 'establishment_not_found');
    end if;

    if not (select public.has_capability(v_account_id, 'operator', p_establishment_id)) then
      return jsonb_build_object('ok', false, 'reason', 'capability_suspended');
    end if;
  else
    -- `for share` : moderate_establishment_proposal et withdraw_establishment_proposal prennent cette
    -- même ligne `for update` AVANT de rattacher, refuser ou retirer les activités qui en dépendent.
    -- Sans ce verrou, une activité déposée pendant l'approbation de son établissement arriverait
    -- après le rattachement et resterait sans établissement, pour toujours. Avec lui, elle attend la
    -- fin de la modération et relit le statut : plus « pending », elle est refusée ci-dessous.
    perform 1 from public.establishment_proposals
      where id = p_establishment_proposal_id and partner_id = v_partner_id
        and kind = 'create' and status = 'pending'
      for share;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'establishment_proposal_not_pending');
    end if;

    -- L'établissement n'existe pas encore : aucune capacité ne le désigne. La capacité operator
    -- du partenaire, quelle qu'elle soit, doit seulement être active — la même règle que
    -- has_capability, sans établissement.
    if not (select public.has_capability(v_account_id, 'operator', null)) then
      return jsonb_build_object('ok', false, 'reason', 'capability_suspended');
    end if;
  end if;

  if coalesce(btrim(p_payload -> 'name' ->> 'es'), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'name_required');
  end if;

  if (
    select count(*) from public.product_proposals where partner_id = v_partner_id and status = 'pending'
  ) >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'pending_cap_exceeded');
  end if;

  if jsonb_typeof(p_payload -> 'photos') = 'array' and jsonb_array_length(p_payload -> 'photos') > 6 then
    return jsonb_build_object('ok', false, 'reason', 'gallery_cap_exceeded');
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

  -- 20261104120000 : une activité naît avec au moins un horaire (demande Jérôme du 2026-11-04).
  -- Les règles sont relues ici, une par une (public.proposal_slot_rules) : une règle illisible est
  -- refusée au dépôt, plutôt que de faire échouer plus tard l'approbation sur un cast.
  if p_type = 'activity' then
    if jsonb_typeof(p_payload -> 'slot_rules') is distinct from 'array'
       or jsonb_array_length(p_payload -> 'slot_rules') = 0 then
      return jsonb_build_object('ok', false, 'reason', 'slot_rules_required');
    end if;
    v_slot_rules := public.proposal_slot_rules(p_payload -> 'slot_rules');
    if v_slot_rules is null then
      return jsonb_build_object('ok', false, 'reason', 'invalid_slot_rules');
    end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('storage_path', photo ->> 'storage_path')), '[]'::jsonb)
    into v_safe_photos
    from jsonb_array_elements(coalesce(p_payload -> 'photos', '[]'::jsonb)) photo
   where coalesce(btrim(photo ->> 'storage_path'), '') <> '';

  select lobby_connector_active into v_lobby_connector_active
    from public.establishments where id = p_establishment_id;

  v_safe_payload := jsonb_build_object(
      'name', p_payload -> 'name', 'description', p_payload -> 'description', 'photos', v_safe_photos
    )
    -- 2026-09-16 (transport informatif) : `transport` RETIRÉ de ce bloc. Un trajet a DEUX
    -- extrémités, donc ses propres colonnes dédiées (transport_departure_*/transport_arrival_*,
    -- bloc ajouté plus bas) ; laisser le trio générique whitelisté pour lui recréerait la double
    -- source de vérité que ces colonnes viennent précisément fermer — une proposition résiduelle
    -- reposerait `address` sur un transport au moment de l'approuver.
    || case when p_type in ('activity', 'lodging') then jsonb_build_object(
         'address', p_payload -> 'address', 'lat', p_payload -> 'lat', 'lon', p_payload -> 'lon'
       ) else '{}'::jsonb end
    -- 20261013212500 : `evento` rejoint cette liste. hasTags (productTypeGating.ts) le couvre depuis
    -- le 2026-09-14 et le formulaire socio affiche le champ, mais cette whitelist jetait la clé :
    -- les étiquettes choisies par le partenaire n'arrivaient jamais jusqu'à la modération.
    || case when p_type in ('activity', 'lodging', 'transport', 'camp', 'evento') then jsonb_build_object(
         'tag_ids', coalesce(p_payload -> 'tag_ids', '[]'::jsonb)
       ) else '{}'::jsonb end
    || case when p_type in ('activity', 'lodging', 'transport') then jsonb_build_object(
         'price_cop', p_payload -> 'price_cop', 'price_tiers', p_payload -> 'price_tiers',
         'min_qty', p_payload -> 'min_qty', 'max_qty', p_payload -> 'max_qty'
       ) else '{}'::jsonb end
    -- Migration 20261025140000 (spec 43) : mode de prix et personnes min/max d'une activité —
    -- mêmes clés à l'édition (submit_product_proposal), sinon elles disparaîtraient à la première
    -- modification.
    || case when p_type = 'activity' then jsonb_build_object(
         'pricing_unit', p_payload -> 'pricing_unit',
         'min_persons', p_payload -> 'min_persons', 'max_persons', p_payload -> 'max_persons'
       ) else '{}'::jsonb end
    -- Ajout de cette migration (20260914140000) : group_discount_threshold_qty/group_discount_pct
    -- rejoignent le bloc whitelist camp déjà existant — même geste que duration_days.
    || case when p_type = 'camp' then
         jsonb_build_object(
           'price_cop', p_payload -> 'price_cop', 'duration_days', p_payload -> 'duration_days',
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
    || case when p_type = 'lodging' then jsonb_build_object(
         'check_in_time', p_payload -> 'check_in_time', 'check_out_time', p_payload -> 'check_out_time'
       ) else '{}'::jsonb end
    -- SEUL CHANGEMENT de cette fonction (2026-08-27, second passage du jour) : `lodging_kind`
    -- rejoint la whitelist des logements. Une clé absente d'ici est SILENCIEUSEMENT jetée — c'est
    -- exactement le rôle de cette whitelist — donc l'oublier ferait disparaître le type de couchage
    -- entre le formulaire du socio et la proposition enregistrée, sans erreur nulle part.
    || case when p_type = 'lodging' then
         jsonb_build_object('capacity', p_payload -> 'capacity', 'unit_count', p_payload -> 'unit_count',
                            'lodging_kind', p_payload -> 'lodging_kind', 'unit', p_payload -> 'unit',
                            'stay_rates', p_payload -> 'stay_rates')
       else '{}'::jsonb end
    -- 20261013212500 : `lodging` rejoint cette liste. Le champ « Cupo diario por defecto » est
    -- affiché pour un logement depuis le 2026-09-13 et create_product_from_proposal sait le lire
    -- (valeur saisie, sinon resolve_lodging_default_capacity) — mais la clé était jetée ici, donc
    -- la valeur du partenaire n'arrivait jamais et c'est toujours le calcul qui s'appliquait.
    || case when p_type in ('activity', 'camp', 'transport', 'lodging') then
         jsonb_build_object('default_capacity', p_payload -> 'default_capacity')
       else '{}'::jsonb end
    -- 2026-09-16 (transport informatif, demande Jérôme) : fenêtre de départs quotidienne, places
    -- annoncées par départ, et les DEUX lieux dédiés. ⚠️ PUREMENT INFORMATIFS — aucune RPC ne les
    -- lit, ils ne décrémentent rien, et ce ne sont surtout pas des `slot_rules` (bloc juste en
    -- dessous, activity seulement), qui rendraient `create_order` bloquant via le refus
    -- `slot_required`. Le cupo réel d'un transport reste `default_capacity`, par date.
    -- Whitelistés pour le socio sans restriction : un transporteur est précisément la personne qui
    -- connaît ses horaires.
    -- ⚠️ FILTRÉ sur les clés RÉELLEMENT PRÉSENTES, pas un `jsonb_build_object` des 9 clés.
    -- `jsonb_build_object('k', p_payload -> 'k')` produit `{"k": null}` quand la clé est absente
    -- de l'entrée : la clé EXISTE alors dans le payload enregistré, avec la valeur null. Le `?` de
    -- la forme gardée de moderate_product_proposal répondrait « présente » et écrirait ce null —
    -- donc EFFACERAIT les horaires déjà posés, ce que la forme gardée existe précisément pour
    -- empêcher (prouvé par transport_departure_info_proposal_parity.test.sql).
    -- Ici : clé absente ⇒ rien n'entre ⇒ moderate conserve l'existant. Clé présente à null ⇒ elle
    -- entre ⇒ moderate efface, ce qui est bien une demande explicite du prestataire.
    || case when p_type = 'transport'
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
    || case when p_type = 'activity' then
         jsonb_build_object('slot_rules', v_slot_rules)
       else '{}'::jsonb end
    -- 2026-09-09 : la VITRINE n'est plus réservée aux eventos. `external_booking_url` est le
    -- mécanisme de vitrine (cahier §2e, spec 30 §3.1) et la contrainte
    -- `products_price_cop_required_unless_vitrine` l'accepte depuis le 2026-09-08 pour TOUS les
    -- types — mais cette whitelist les jetait silencieusement hors evento, donc l'URL saisie par un
    -- socio disparaissait entre son formulaire et la proposition enregistrée, sans erreur nulle
    -- part. `price_label` l'accompagne : sans lui, une vitrine sans prix chiffré n'aurait rien à
    -- afficher. Le bloc `evento` ci-dessous garde les siens (il porte aussi ses occurrences).
    || case when p_type <> 'evento' then jsonb_build_object(
         'external_booking_url', p_payload -> 'external_booking_url',
         'price_label', p_payload -> 'price_label'
       ) else '{}'::jsonb end
    || case when p_type = 'evento' then jsonb_build_object(
         'price_label', p_payload -> 'price_label', 'occurrence_type', p_payload -> 'occurrence_type',
         'occurrence_date', p_payload -> 'occurrence_date',
         'recurrence_frequency_days', p_payload -> 'recurrence_frequency_days',
         'recurrence_end_date', p_payload -> 'recurrence_end_date',
         'recurrence_end_count', p_payload -> 'recurrence_end_count',
         'start_time', p_payload -> 'start_time', 'duration_minutes', p_payload -> 'duration_minutes',
         'external_booking_url', p_payload -> 'external_booking_url'
       ) else '{}'::jsonb end
    -- Refonte LobbyPMS (2026-08-25) : uniquement si l'établissement est déjà connecté — jamais un
    -- ID Lobby arbitraire sur un établissement non connecté (cf. commentaire de tête).
    || case when p_type = 'lodging' and coalesce(v_lobby_connector_active, false) then
         jsonb_build_object('lobby_category_id', nullif(p_payload ->> 'lobby_category_id', '')::int)
       else '{}'::jsonb end
    -- Élargi le 2026-08-26 de 'activity' seul à ('activity', 'transport') — cf. commentaire de tête
    -- de ce fichier pour le raisonnement complet (evento/camp restent exclus, incompatibilité
    -- structurelle avec addLobbyProductService, pas un simple oubli).
    || case when p_type in ('activity', 'transport') and coalesce(v_lobby_connector_active, false) then
         jsonb_build_object('lobby_product_id', nullif(p_payload ->> 'lobby_product_id', '')::int)
       else '{}'::jsonb end
    -- Ajout de cette migration (20261013151206) : équipements d'un LOGEMENT, proposables dès la
    -- création. Le tableau stocké est reconstruit depuis catalog_amenities : un identifiant
    -- inconnu ou mal formé est écarté ici, sans jamais caster en uuid un texte venu du client.
    || case when p_type = 'lodging' and jsonb_typeof(p_payload -> 'amenity_ids') = 'array'
         then jsonb_build_object('amenity_ids', (
           select coalesce(jsonb_agg(c.id order by c.slug), '[]'::jsonb)
             from public.catalog_amenities c
            where (p_payload -> 'amenity_ids') ? c.id::text
         ))
       else '{}'::jsonb end;

  -- 20261019120000 : sur un établissement en attente, v_lobby_connector_active est resté null
  -- (aucune ligne lue) — les identifiants Lobby sont donc écartés, comme pour tout établissement
  -- non connecté.
  insert into public.product_proposals
    (product_id, establishment_id, establishment_proposal_id, partner_id, submitted_by, kind, type, payload)
  values (null, p_establishment_id, p_establishment_proposal_id, v_partner_id, v_account_id, 'create',
          p_type, v_safe_payload)
  returning id into v_proposal_id;

  return jsonb_build_object('ok', true, 'proposal_id', v_proposal_id);
end;
$function$;

-- ── submit_product_proposal ───────────────────────────────────────────────────────────────────

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
  v_slot_rules jsonb;
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

  -- 20261104120000 : les horaires d'une activité deviennent proposables en édition (« Proponer
  -- edición »). Forme GARDÉE comme tag_ids : la clé n'entre que si l'écran l'envoie, c'est-à-dire
  -- quand le partenaire a changé ses horaires. Présente, elle porte au moins un horaire (une
  -- activité sans horaire n'est plus vendable) et chaque règle doit être lisible.
  if v_type = 'activity' and p_payload ? 'slot_rules' then
    if jsonb_typeof(p_payload -> 'slot_rules') is distinct from 'array'
       or jsonb_array_length(p_payload -> 'slot_rules') = 0 then
      return jsonb_build_object('ok', false, 'reason', 'slot_rules_required');
    end if;
    v_slot_rules := public.proposal_slot_rules(p_payload -> 'slot_rules');
    if v_slot_rules is null then
      return jsonb_build_object('ok', false, 'reason', 'invalid_slot_rules');
    end if;
  end if;

  -- Whitelist par type — miroir exact du bloc `if (isEditing && product)` de ProductForm
  -- (product-form.tsx), jamais photos (délégués à des blocs séparés à
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
    -- Migration 20261025140000 (spec 43) : miroir de submit_product_creation_proposal.
    || case when v_type = 'activity' then jsonb_build_object(
         'pricing_unit', p_payload -> 'pricing_unit',
         'min_persons', p_payload -> 'min_persons', 'max_persons', p_payload -> 'max_persons'
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
       else '{}'::jsonb end
    -- 20261104120000 : horaires d'une activité, relus plus haut. Clé absente ⇒ rien n'entre ⇒
    -- moderate_product_proposal garde les horaires en place.
    || case when v_slot_rules is not null
         then jsonb_build_object('slot_rules', v_slot_rules)
       else '{}'::jsonb end;

  insert into public.product_proposals (product_id, partner_id, submitted_by, payload)
  values (p_product_id, v_partner_id, v_account_id, v_safe_payload)
  returning id into v_proposal_id;

  return jsonb_build_object('ok', true, 'proposal_id', v_proposal_id);
end;
$function$;

-- ── moderate_product_proposal ─────────────────────────────────────────────────────────────────

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
  v_slot_rules jsonb;
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

    -- 20261104120000 : une activité naît avec au moins un horaire, y compris quand l'admin corrige
    -- la proposition. Vérifié AVANT toute écriture : un « return » ici n'annule rien d'autre.
    if v_proposal.type = 'activity' then
      if jsonb_typeof(v_final_payload -> 'slot_rules') is distinct from 'array'
         or jsonb_array_length(v_final_payload -> 'slot_rules') = 0 then
        return jsonb_build_object('ok', false, 'reason', 'slot_rules_required');
      end if;
      v_slot_rules := public.proposal_slot_rules(v_final_payload -> 'slot_rules');
      if v_slot_rules is null then
        return jsonb_build_object('ok', false, 'reason', 'invalid_slot_rules');
      end if;
      v_final_payload := v_final_payload || jsonb_build_object('slot_rules', v_slot_rules);
    end if;

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

    -- 20261104120000 : horaires proposés en édition. Forme GARDÉE : sans la clé, les horaires en
    -- place ne bougent pas. Avec elle, ils sont REMPLACÉS — validés d'abord, avant toute écriture
    -- (un « return » plus bas n'annulerait pas une écriture déjà faite). Les anciens sont retirés
    -- AVANT la mise à jour du produit : passer en « por hora » y est refusé tant qu'un horaire
    -- en place ne dure pas 60 minutes (products_pricing_unit_follows_type) ; les nouveaux, posés
    -- après, sont contrôlés contre le mode final (product_slot_rules_hourly_for_per_hour).
    if jsonb_typeof(v_final_payload -> 'slot_rules') = 'array'
       and exists (select 1 from public.products p
                    where p.id = v_proposal.product_id and p.type = 'activity') then
      if jsonb_array_length(v_final_payload -> 'slot_rules') = 0 then
        return jsonb_build_object('ok', false, 'reason', 'slot_rules_required');
      end if;
      v_slot_rules := public.proposal_slot_rules(v_final_payload -> 'slot_rules');
      if v_slot_rules is null then
        return jsonb_build_object('ok', false, 'reason', 'invalid_slot_rules');
      end if;
      v_final_payload := v_final_payload || jsonb_build_object('slot_rules', v_slot_rules);
      delete from public.product_slot_rules where product_id = v_proposal.product_id;
    end if;

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
           -- Migration 20261025140000 (spec 43) : GARDÉES (« ? ») comme leurs voisines — une
           -- proposition déposée avant cette migration ne porte pas ces clés. Le mode, lui, n'est
           -- jamais nul : une valeur nulle (la whitelist pose la clé à null quand l'écran ne l'a pas
           -- envoyée) garde le mode actuel, jamais un retour silencieux à « por persona ». Réservé à
           -- l'activité (products_pricing_unit_activity_only).
           pricing_unit = case when type = 'activity'
                                    and nullif(v_final_payload ->> 'pricing_unit', '') is not null
                               then v_final_payload ->> 'pricing_unit'
                               else pricing_unit end,
           min_persons = case when v_final_payload ? 'min_persons'
                              then nullif(v_final_payload ->> 'min_persons', '')::int
                              else min_persons end,
           max_persons = case when v_final_payload ? 'max_persons'
                              then nullif(v_final_payload ->> 'max_persons', '')::int
                              else max_persons end,
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

    -- 20261104120000 : les nouveaux horaires, par la même RPC que l'édition admin (une seule
    -- définition de l'écriture des règles).
    if v_slot_rules is not null then
      perform public.replace_product_slot_rules(v_proposal.product_id, v_slot_rules);
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

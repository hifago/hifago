-- Une proposition de création refusée se CORRIGE, elle ne se recommence pas.
--
-- Demande de Jérôme (2026-11-04) : « Lorsque je refuse une fiche dans l'admin, le partenaire doit
-- tout recommencer à chaque fois. […] que le partenaire garde sa fiche et puisse avoir accès et
-- juste changer les détails qui sont pas bons. »
--
-- Jusqu'ici, un refus était terminal : la proposition (établissement ou service) disparaissait de
-- l'espace partenaire, qui ressaisissait tout — photos comprises — dans une nouvelle proposition.
--
-- Ce qui change (créations seulement — kind = 'create' ; une proposition de MODIFICATION d'une
-- fiche existante n'est pas concernée, la fiche elle-même n'a jamais disparu) :
--   1. submit_product_creation_proposal / submit_establishment_creation_proposal prennent un
--      p_proposal_id facultatif : la proposition REFUSÉE désignée repasse « pending » avec le
--      contenu corrigé — la même ligne, pas une nouvelle. Elle passe par exactement les mêmes
--      gardes qu'une soumission neuve (le chemin est le même, seul l'insert devient un update).
--      Le motif du refus est conservé : l'admin le voit en relisant la correction.
--   2. Corriger un établissement refusé remet en revue les activités refusées EN CASCADE avec lui
--      (20261019120000) — jamais une activité refusée pour elle-même, que le partenaire corrige à
--      part.
--   3. withdraw_product_proposal / withdraw_establishment_proposal acceptent une proposition
--      refusée : c'est le « Descartar » du partenaire.
--   4. L'admin reçoit un e-mail quand une proposition refusée revient corrigée (trigger sur le
--      passage rejected → pending, même fonction que pour une proposition neuve).
--   5. L'e-mail de refus d'un établissement dit au partenaire qu'il peut le corriger (celui d'une
--      activité n'est pas retouché, cf. section 5).
--   6. Le dédoublonnage des e-mails (notification_emails_dedup_idx) distingue les tours de revue
--      d'une même proposition par sa version : sans cela, une proposition corrigée — qui garde son
--      identifiant — perdait en silence l'avis à l'admin, puis le verdict suivant au partenaire.
--      ⚠️ enqueue_notification_email est appelée par tous les e-mails du projet : seule la portée
--      change, et seulement pour related_table product_proposals/establishment_proposals ; pour
--      tout le reste elle vaut '' et le comportement est inchangé.
--
-- Frontière RLS / RPC-only (CLAUDE.md §3) : product_proposals et establishment_proposals restent
-- RPC-only, aucune policy ni grant de table nouveau. Aucune de ces RPC n'est critique au sens de
-- §4.1 (ni réservation, ni capacité). Ordre de verrouillage inchangé : proposition
-- d'établissement, puis activités.
--
-- ⚠️ Ordonnée APRÈS 20261104120000_horaires_obligatoires_et_proposables (autre session, même jour),
-- dont elle reprend la version de submit_product_creation_proposal (garde slot_rules_required).
--
-- Corps repris des définitions vivantes (pg_get_functiondef) par remplacements comptés, jamais
-- retapés — seuls les blocs marqués 20261104130000 sont nouveaux.
-- Prouvé par supabase/tests/database/proposition_refusee_corrigeable.test.sql.

-- ============================================================================================
-- 0. Dédoublonnage des e-mails par tour de revue (avant tout le reste : les fonctions ci-dessous
--    enfilent des e-mails)
-- ============================================================================================

alter table public.notification_emails add column dedup_scope text not null default '';

comment on column public.notification_emails.dedup_scope is
  'Portée du dédoublonnage (notification_emails_dedup_idx) : version de la proposition pour '
  'related_table product_proposals/establishment_proposals, '''' sinon. Posée par '
  'enqueue_notification_email (20261104130000).';

drop index public.notification_emails_dedup_idx;
create unique index notification_emails_dedup_idx on public.notification_emails (
  event_type, related_table, related_id,
  coalesce(recipient_account_id, '00000000-0000-0000-0000-000000000000'::uuid), dedup_scope
) where related_id is not null;

CREATE OR REPLACE FUNCTION public.enqueue_notification_email(p_event_type text, p_recipient_email text, p_recipient_account_id uuid, p_subject text, p_body_html text, p_related_table text DEFAULT NULL::text, p_related_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  -- 20261104130000 : tour de revue d'une proposition (sa version), '' pour tout le reste.
  v_dedup_scope text := '';
begin
  if p_recipient_email is null or btrim(p_recipient_email) = '' then
    return null;
  end if;

  -- 20261104130000 : une proposition corrigée garde son identifiant. Sans portée, le dédoublonnage
  -- (événement, proposition, destinataire) jetterait en silence l'e-mail « corrigée » à l'admin,
  -- puis le verdict suivant au partenaire — dont l'approbation. La version de la proposition, qui
  -- change à chaque soumission et à chaque décision, distingue les tours ; un même événement
  -- rejoué (même version) reste dédoublonné.
  if p_related_id is not null and p_related_table = 'product_proposals' then
    select version::text into v_dedup_scope from public.product_proposals where id = p_related_id;
  elsif p_related_id is not null and p_related_table = 'establishment_proposals' then
    select version::text into v_dedup_scope from public.establishment_proposals where id = p_related_id;
  end if;
  v_dedup_scope := coalesce(v_dedup_scope, '');

  insert into public.notification_emails (
    event_type, recipient_email, recipient_account_id, subject, body_html, related_table, related_id,
    dedup_scope
  )
  values (
    p_event_type, p_recipient_email, p_recipient_account_id, p_subject, p_body_html, p_related_table, p_related_id,
    v_dedup_scope
  )
  on conflict (
    event_type, related_table, related_id,
    coalesce(recipient_account_id, '00000000-0000-0000-0000-000000000000'::uuid), dedup_scope
  ) where related_id is not null
  do nothing
  returning id into v_id;

  return v_id;
end;
$function$;

-- ============================================================================================
-- 1. submit_product_creation_proposal — nouveau paramètre p_proposal_id (drop explicite, §7)
-- ============================================================================================

drop function public.submit_product_creation_proposal(uuid, text, jsonb, uuid);

CREATE OR REPLACE FUNCTION public.submit_product_creation_proposal(p_establishment_id uuid DEFAULT NULL::uuid, p_type text DEFAULT NULL::text, p_payload jsonb DEFAULT NULL::jsonb, p_establishment_proposal_id uuid DEFAULT NULL::uuid, p_proposal_id uuid DEFAULT NULL::uuid)
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
  -- 20261104130000 : correction d'une proposition refusée.
  v_previous record;
  v_previous_establishment_proposal_id uuid;
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

  -- 20261104130000 : CORRIGER une proposition refusée au lieu d'en déposer une nouvelle. La même
  -- ligne repasse « pending » avec le contenu corrigé ; elle passe ensuite par exactement les
  -- mêmes gardes que ci-dessous (propriété, capacité, plafonds, whitelist).
  -- Le type et la cible ne viennent JAMAIS du client en correction : le type est immuable (spec 15
  -- §0), la cible est relue sur la ligne — l'établissement, ou celui né de la proposition
  -- d'établissement approuvée depuis, ou la proposition d'établissement si elle attend encore.
  -- Verrous : la proposition d'établissement d'abord (for share), la proposition d'activité
  -- ensuite (for update) — le même ordre que moderate/withdraw_establishment_proposal
  -- (20261019120000), jamais l'inverse : pas d'interblocage. establishment_proposal_id n'est
  -- écrit qu'à l'insertion, le lire sans verrou est donc sûr.
  if p_proposal_id is not null then
    select pp.establishment_proposal_id into v_previous_establishment_proposal_id
      from public.product_proposals pp where pp.id = p_proposal_id;
    if v_previous_establishment_proposal_id is not null then
      perform 1 from public.establishment_proposals
        where id = v_previous_establishment_proposal_id for share;
    end if;

    select pp.partner_id, pp.kind, pp.status, pp.type, pp.establishment_id, pp.establishment_proposal_id
      into v_previous
      from public.product_proposals pp where pp.id = p_proposal_id for update;

    if not found or v_previous.partner_id is distinct from v_partner_id or v_previous.kind <> 'create' then
      return jsonb_build_object('ok', false, 'reason', 'proposal_not_found');
    end if;
    if v_previous.status <> 'rejected' then
      return jsonb_build_object('ok', false, 'reason', 'not_rejected');
    end if;
    if p_type is distinct from v_previous.type then
      return jsonb_build_object('ok', false, 'reason', 'invalid_type');
    end if;

    p_establishment_id := v_previous.establishment_id;
    if p_establishment_id is null then
      select ep.establishment_id into p_establishment_id
        from public.establishment_proposals ep
       where ep.id = v_previous.establishment_proposal_id and ep.status = 'approved';
    end if;
    -- Établissement toujours en revue (ou refusé : le garde « pending » ci-dessous répondra
    -- establishment_proposal_not_pending — le partenaire corrige d'abord l'établissement).
    p_establishment_proposal_id := case when p_establishment_id is null
                                        then v_previous.establishment_proposal_id end;
  end if;

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
  if p_proposal_id is not null then
    -- 20261104130000 : la ligne corrigée repasse en revue. rejection_reason est CONSERVÉ : l'écran de
    -- modération le montre comme « motif du refus précédent » (un nouveau refus l'écrase). version
    -- + 1 : un écran de modération ouvert sur l'ancienne version doit être rechargé.
    update public.product_proposals
       set payload = v_safe_payload, status = 'pending', establishment_id = p_establishment_id,
           submitted_by = v_account_id, reviewed_by = null, reviewed_at = null,
           version = version + 1, updated_at = now()
     where id = p_proposal_id;
    v_proposal_id := p_proposal_id;
  else
    insert into public.product_proposals
      (product_id, establishment_id, establishment_proposal_id, partner_id, submitted_by, kind, type, payload)
    values (null, p_establishment_id, p_establishment_proposal_id, v_partner_id, v_account_id, 'create',
            p_type, v_safe_payload)
    returning id into v_proposal_id;
  end if;

  return jsonb_build_object('ok', true, 'proposal_id', v_proposal_id);
end;
$function$;

revoke all on function public.submit_product_creation_proposal(uuid, text, jsonb, uuid, uuid) from public, anon;
grant execute on function public.submit_product_creation_proposal(uuid, text, jsonb, uuid, uuid) to authenticated, service_role;

-- ============================================================================================
-- 2. submit_establishment_creation_proposal — nouveau paramètre p_proposal_id (drop explicite)
-- ============================================================================================

drop function public.submit_establishment_creation_proposal(jsonb);

CREATE OR REPLACE FUNCTION public.submit_establishment_creation_proposal(p_payload jsonb, p_proposal_id uuid DEFAULT NULL::uuid)
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
  v_lobby_token text;
  -- 20261019170000 : le WhatsApp du prestataire, obligatoire.
  v_contact_phone text := public.colombian_whatsapp_or_null(p_payload ->> 'contact_phone');
  -- 20261104130000 : correction d'une proposition refusée.
  v_previous record;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  v_partner_id := (select public.partner_id_for_account(v_account_id));
  if v_partner_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_a_partner');
  end if;

  -- 20261104130000 : CORRIGER une proposition refusée au lieu d'en déposer une nouvelle — même
  -- ligne, mêmes gardes que ci-dessous. Verrouillée for update AVANT les activités qu'elle
  -- réveille plus bas (ordre unique établissement → activités, 20261019120000).
  if p_proposal_id is not null then
    select partner_id, kind, status, reviewed_at, rejection_reason into v_previous
      from public.establishment_proposals where id = p_proposal_id for update;
    if not found or v_previous.partner_id is distinct from v_partner_id or v_previous.kind <> 'create' then
      return jsonb_build_object('ok', false, 'reason', 'proposal_not_found');
    end if;
    if v_previous.status <> 'rejected' then
      return jsonb_build_object('ok', false, 'reason', 'not_rejected');
    end if;
  end if;

  if coalesce(btrim(p_payload -> 'name' ->> 'es'), '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'name_required');
  end if;

  -- 20261019170000 : refusé AVANT tout insert — une proposition sans numéro ne pourrait pas être
  -- approuvée (create_establishment l'exige), elle n'entre donc jamais dans la file.
  if v_contact_phone is null then
    return jsonb_build_object('ok', false, 'reason',
      case when coalesce(btrim(p_payload ->> 'contact_phone'), '') = ''
           then 'contact_phone_required' else 'contact_phone_invalid' end);
  end if;

  if (
    select count(*) from public.establishment_proposals
     where partner_id = v_partner_id and status = 'pending'
  ) >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'pending_cap_exceeded');
  end if;

  if jsonb_typeof(p_payload -> 'photos') = 'array' and jsonb_array_length(p_payload -> 'photos') > 6 then
    return jsonb_build_object('ok', false, 'reason', 'gallery_cap_exceeded');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('storage_path', photo ->> 'storage_path')), '[]'::jsonb)
    into v_safe_photos
    from jsonb_array_elements(coalesce(p_payload -> 'photos', '[]'::jsonb)) photo
   where coalesce(btrim(photo ->> 'storage_path'), '') <> '';

  v_lobby_token := nullif(btrim(p_payload ->> 'lobby_api_token'), '');

  v_safe_payload := jsonb_build_object(
      'name', p_payload -> 'name', 'description', p_payload -> 'description',
      'address', p_payload -> 'address', 'lat', p_payload -> 'lat', 'lon', p_payload -> 'lon',
      'photos', v_safe_photos,
      'contact_phone', v_contact_phone
    )
    || case when v_lobby_token is not null
         then jsonb_build_object('lobby_api_token', v_lobby_token)
         else '{}'::jsonb end;

  if p_proposal_id is not null then
    -- rejection_reason CONSERVÉ (motif du refus précédent, montré à l'admin) ; version + 1.
    update public.establishment_proposals
       set payload = v_safe_payload, status = 'pending', submitted_by = v_account_id,
           reviewed_by = null, reviewed_at = null, version = version + 1, updated_at = now()
     where id = p_proposal_id;
    v_proposal_id := p_proposal_id;

    -- Les activités refusées EN CASCADE avec cet établissement repassent en revue avec lui : elles
    -- n'avaient pas été jugées pour elles-mêmes. Reconnues à deux marques que pose le refus en
    -- cascade (moderate_establishment_proposal, 20261019120000) : le motif « Establecimiento
    -- rechazado: <motif de l'établissement> » et le reviewed_at de l'établissement (même
    -- transaction, now() est l'heure de la transaction). Une activité refusée pour elle-même
    -- reste refusée — le partenaire la corrige à part. Le motif de cascade ne la concerne plus :
    -- effacé.
    update public.product_proposals
       set status = 'pending', rejection_reason = null, reviewed_by = null, reviewed_at = null,
           version = version + 1, updated_at = now()
     where establishment_proposal_id = p_proposal_id and status = 'rejected'
       and establishment_id is null and reviewed_at = v_previous.reviewed_at
       and rejection_reason = 'Establecimiento rechazado: ' || v_previous.rejection_reason;
  else
    insert into public.establishment_proposals (establishment_id, partner_id, submitted_by, kind, payload)
    values (null, v_partner_id, v_account_id, 'create', v_safe_payload)
    returning id into v_proposal_id;
  end if;

  return jsonb_build_object('ok', true, 'proposal_id', v_proposal_id);
end;
$function$;

revoke all on function public.submit_establishment_creation_proposal(jsonb, uuid) from public, anon;
grant execute on function public.submit_establishment_creation_proposal(jsonb, uuid) to authenticated, service_role;

-- ============================================================================================
-- 3. Retraits : une proposition refusée peut être écartée
-- ============================================================================================

CREATE OR REPLACE FUNCTION public.withdraw_product_proposal(p_proposal_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid := auth.uid();
  v_partner_id uuid;
  v_proposal_partner_id uuid;
  v_status text;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;
  v_partner_id := (select public.partner_id_for_account(v_account_id));

  select partner_id, status into v_proposal_partner_id, v_status
    from public.product_proposals where id = p_proposal_id for update;

  if not found or v_proposal_partner_id is distinct from v_partner_id then
    return jsonb_build_object('ok', false, 'reason', 'proposal_not_found');
  end if;
  -- 20261104130000 : une proposition refusée reste chez le partenaire jusqu'à ce qu'il la corrige
  -- ou l'écarte — l'écarter est ce retrait.
  if v_status not in ('pending', 'rejected') then
    return jsonb_build_object('ok', false, 'reason', 'not_pending');
  end if;

  update public.product_proposals set status = 'withdrawn', updated_at = now()
   where id = p_proposal_id;

  return jsonb_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.withdraw_establishment_proposal(p_proposal_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid := auth.uid();
  v_partner_id uuid;
  v_proposal_partner_id uuid;
  v_status text;
  v_payload jsonb;
  v_redacted_payload jsonb;
begin
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;
  v_partner_id := (select public.partner_id_for_account(v_account_id));

  select partner_id, status, payload into v_proposal_partner_id, v_status, v_payload
    from public.establishment_proposals where id = p_proposal_id for update;

  if not found or v_proposal_partner_id is distinct from v_partner_id then
    return jsonb_build_object('ok', false, 'reason', 'proposal_not_found');
  end if;
  -- 20261104130000 : écarter une proposition refusée est ce retrait.
  if v_status not in ('pending', 'rejected') then
    return jsonb_build_object('ok', false, 'reason', 'not_pending');
  end if;

  -- Rédaction du token avant retrait (cf. commentaire de tête) : un socio qui se rétracte après
  -- avoir collé un vrai token ne doit jamais le laisser traîner en clair.
  v_redacted_payload := case when v_payload ? 'lobby_api_token'
    then (v_payload - 'lobby_api_token') || jsonb_build_object('lobby_api_token_provided', true)
    else v_payload end;

  update public.establishment_proposals
     set status = 'withdrawn', payload = v_redacted_payload, updated_at = now()
   where id = p_proposal_id;

  -- 20261019120000 : retirer l'établissement retire les activités déposées avec lui.
  update public.product_proposals
     set status = 'withdrawn', updated_at = now()
   -- 20261104130000 : les activités refusées qui attendaient encore cet établissement (aucun
   -- établissement créé) ne pourront plus être corrigées : retirées avec lui.
   where establishment_proposal_id = p_proposal_id
     and (status = 'pending' or (status = 'rejected' and establishment_id is null));

  return jsonb_build_object('ok', true);
end;
$function$;

-- ============================================================================================
-- 4. L'admin est prévenu quand une proposition refusée revient corrigée
-- ============================================================================================

CREATE OR REPLACE FUNCTION public.notify_admin_new_proposal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_entity_name text;
  v_partner_name text;
  v_subject text;
  v_body text;
  v_app_base_url text;
begin
  begin
    v_entity_name := new.payload -> 'name' ->> 'es';

    if v_entity_name is null then
      -- Migration 20261002160349 : tests imbriqués. PL/pgSQL prépare l'expression entière d'un IF :
      -- `new.product_id` sur une ligne d'establishment_proposals (sans cette colonne) levait une
      -- erreur, avalée par le bloc exception — aucun e-mail pour une proposition d'établissement
      -- sans nom (photos, édition).
      if tg_table_name = 'product_proposals' then
        if new.product_id is not null then
          select p.name ->> 'es' into v_entity_name from public.products p where p.id = new.product_id;
        end if;
      elsif tg_table_name = 'establishment_proposals' and new.establishment_id is not null then
        select e.name ->> 'es' into v_entity_name from public.establishments e where e.id = new.establishment_id;
      end if;
    end if;

    if tg_table_name = 'product_proposals' then
      -- 20261104130000 : déclenché aussi quand une proposition refusée revient corrigée.
      v_subject := case when tg_op = 'UPDATE'
                        then 'Propuesta de producto corregida, pendiente de moderación'
                        else 'Nueva propuesta de producto pendiente de moderación' end;
    else
      v_subject := case when tg_op = 'UPDATE'
                        then 'Propuesta de establecimiento corregida, pendiente de moderación'
                        else 'Nueva propuesta de establecimiento pendiente de moderación' end;
    end if;

    select display_name into v_partner_name from public.partners where id = new.partner_id;

    -- Migration 20261002160349 : lien absolu (secret Vault admin_app_public_url) — sans le secret, on
    -- retombe sur le chemin relatif (jamais un e-mail en moins) ; une proposition d'établissement
    -- s'ouvre avec ?entity=establishment (sans lui, la page cherche une proposition de produit :
    -- 404) ; noms de l'entité et du partenaire échappés (html_text).
    select decrypted_secret into v_app_base_url
      from vault.decrypted_secrets where name = 'admin_app_public_url';
    if v_app_base_url is null then
      raise warning 'notify_admin_new_proposal: secret Vault admin_app_public_url manquant — lien relatif dans l''e-mail';
    end if;

    v_body := '<p>' || coalesce(public.html_text(v_entity_name), 'Sin nombre') || '</p>'
      || '<p>Propuesto por: ' || coalesce(public.html_text(v_partner_name), 'Socio desconocido') || '</p>'
      || '<p><a href="' || coalesce(v_app_base_url, '') || '/admin/proposals/' || new.id
      || case when tg_table_name = 'establishment_proposals' then '?entity=establishment' else '' end
      || '">Ver propuesta</a></p>';

    perform public.notify_all_admins(
      'admin_new_proposal', v_subject, v_body, tg_table_name, new.id
    );
  exception
    when query_canceled then
      raise warning 'notify_admin_new_proposal: annulé (query_canceled) pour % % — %', tg_table_name, new.id, sqlerrm;
    when others then
      raise warning 'notify_admin_new_proposal: échec pour % % — %', tg_table_name, new.id, sqlerrm;
  end;

  return new;
end;
$function$;

-- `new.rejection_reason is not null` : une activité corrigée garde le motif de son refus ; une
-- activité réveillée avec son établissement (motif effacé) n'envoie rien — l'e-mail de
-- l'établissement corrigé suffit, comme un seul e-mail suffit à son refus en cascade.
create trigger product_proposals_notify_admin_resubmitted
  after update of status on public.product_proposals
  for each row when (old.status = 'rejected' and new.status = 'pending' and new.rejection_reason is not null)
  execute function public.notify_admin_new_proposal();

create trigger establishment_proposals_notify_admin_resubmitted
  after update of status on public.establishment_proposals
  for each row when (old.status = 'rejected' and new.status = 'pending')
  execute function public.notify_admin_new_proposal();

-- ============================================================================================
-- 5. E-mails de refus : la proposition se corrige
-- ============================================================================================

-- L'e-mail de refus d'une ACTIVITÉ (moderate_product_proposal) n'est volontairement pas
-- retouché ici : 20261104130000_horaires_obligatoires_et_proposables, écrite le même jour par une
-- autre session, redéfinit cette fonction — la reprendre ici figerait sa version du moment. Le
-- partenaire voit de toute façon sa proposition refusée, avec « Corregir », dans son espacio.

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
        -- 20261104130000 : une création refusée se corrige, elle ne se recommence pas.
        || case when v_proposal.kind = 'create'
             then '<p>Tu propuesta no se ha perdido: puedes corregirla desde tu espacio Hifago y volver a enviarla, sin empezar de nuevo.</p>'
             else '' end
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

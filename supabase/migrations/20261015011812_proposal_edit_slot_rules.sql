-- Horaires d'une activité proposables en ÉDITION par le partenaire (constat du 2026-10-14).
--
-- En comparant les écrans admin et partenaire : le partenaire pose les horaires (product_slot_rules)
-- d'une activité à la création, puis ne peut plus jamais les changer — seul l'admin le peut
-- (ProductSlotRulesBlock, replace_product_slot_rules). La seule justification écrite était un
-- mimétisme technique (« délégués côté admin à des blocs séparés »), la même qui avait tenu les
-- étiquettes et les équipements hors de l'édition jusqu'au 2026-10-13 ; le cahier socio range au
-- contraire la planification dans le contenu proposable.
--
-- Même chemin que les étiquettes (20261013144848) : submit_product_proposal whitelist `slot_rules`
-- pour une activité, en forme gardée ; moderate_product_proposal les REMPLACE à l'approbation, par
-- replace_product_slot_rules — jamais une seconde écriture de product_slot_rules.
--
-- Frontière RLS / RPC-only (CLAUDE.md §3) : product_slot_rules reste RPC-only en écriture ; le socio
-- n'y écrit toujours pas. Aucune table, policy ni grant nouveau ; aucune signature ne change.
-- Pas une opération critique au sens de §4.1 : des règles, jamais un stock ni une réservation.
--
-- Corps repris de 20261013212500 par remplacements comptés, jamais retapés — seuls les blocs
-- marqués 20261015011812 sont nouveaux. Prouvé par supabase/tests/database/proposal_edit_slot_rules.test.sql.

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
  -- (product-form.tsx), jamais photos (délégués à leur propre proposition). Les étiquettes
  -- (`tag_ids`) entrent depuis 20261013144848, et les horaires d'une activité (`slot_rules`)
  -- depuis 20261015011812, par les blocs gardés en fin de whitelist.
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
         then jsonb_build_object('tag_ids', (
           select coalesce(jsonb_agg(t.id order by t.slug), '[]'::jsonb)
             from public.catalog_tags t
            where (p_payload -> 'tag_ids') ? t.id::text
         ))
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
    -- Ajout 20261015011812 : horaires d'une ACTIVITÉ proposables en édition. Ils ne l'étaient qu'à
    -- la création ; après, seul l'admin pouvait les changer (ProductSlotRulesBlock), alors que le
    -- cahier socio range la planification dans le contenu proposable. Même forme gardée que les
    -- étiquettes : clé absente ⇒ rien n'entre ⇒ les horaires en place ne bougent pas ; tableau
    -- présent, même vide ⇒ l'approbation REMPLACE l'ensemble. Même traitement qu'à la création
    -- (submit_product_creation_proposal) : la forme de chaque règle est vérifiée par les
    -- contraintes de product_slot_rules à l'approbation.
    || case when v_type = 'activity' and jsonb_typeof(p_payload -> 'slot_rules') = 'array'
         then jsonb_build_object('slot_rules', p_payload -> 'slot_rules')
       else '{}'::jsonb end;

  insert into public.product_proposals (product_id, partner_id, submitted_by, payload)
  values (p_product_id, v_partner_id, v_account_id, v_safe_payload)
  returning id into v_proposal_id;

  return jsonb_build_object('ok', true, 'proposal_id', v_proposal_id);
end;
$function$;

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
  v_slot_rules_result jsonb;
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

    -- Ajout 20261015011812 : horaires d'une activité, même forme gardée (sans la clé, rien n'est
    -- remplacé), réservés au type activity — le payload corrigé par l'admin ne repasse pas par la
    -- whitelist du dépôt. Écrits par replace_product_slot_rules, la RPC du bloc admin (suppression
    -- et insertion dans la même transaction) : un seul chemin d'écriture de product_slot_rules,
    -- dont la garde is_admin passe ici (l'appelant est l'admin qui modère). Une règle invalide
    -- lève sur les contraintes de la table et annule toute l'approbation, comme à la création.
    if jsonb_typeof(v_final_payload -> 'slot_rules') = 'array'
       and exists (select 1 from public.products p
                    where p.id = v_proposal.product_id and p.type = 'activity') then
      v_slot_rules_result := public.replace_product_slot_rules(v_proposal.product_id, v_final_payload -> 'slot_rules');
      if not coalesce((v_slot_rules_result ->> 'ok')::boolean, false) then
        raise exception 'moderate_product_proposal : horaires refusés (%)', v_slot_rules_result ->> 'reason';
      end if;
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

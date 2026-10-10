-- Époque du jeton Lobby : un booking posé avec un jeton depuis remplacé n'est plus jamais interrogé
-- ni annulé avec le jeton courant (déployée AVANT le code des Edge Functions, qu'elle ne change pas).
--
-- Un jeton remplacé peut ouvrir un AUTRE compte Lobby, où le numéro d'un booking de l'ancien compte
-- n'existe pas ou désigne une autre réservation. Depuis 20261003223900, le remplacement ne fait
-- échouer que les annulations en attente À CET INSTANT ; les jobs continuaient d'interroger (404 →
-- annulation à tort) et d'annuler (404 = succès) les autres bookings de l'ancien compte avec le
-- nouveau jeton. Rien ne datait un booking : l'instant où le claim lit le jeton (claimed_at) traverse
-- déjà claim → route → record_pms_booking.
--
-- Colonnes : establishments.lobby_token_changed_at (instant du dernier remplacement RÉEL, NULL
-- partout à la migration : aucun remplacement antérieur n'est rétroactif) ; order_lines.pms_booked_at
-- (= claimed_at). Un booking est ANCIEN quand coalesce(pms_booked_at, created_at) < lobby_token_changed_at.
-- Un booking = (commande, établissement, numéro).
--
-- Une fonction recréée (un paramètre de plus) et sept redéfinies, une fois chacune, depuis
-- pg_get_functiondef (.claude/rules/supabase.md règle 7, remplacements comptés). Aucune forme de retour
-- ne change ; apply_pms_poll_outcome gagne un motif de refus.
--   - set_establishment_pms_connector(…, p_same_lobby_account default false) : un remplacement réel
--     (hors même compte déclaré) date l'époque à l'horloge, sous `for no key update` ; une entrée de
--     réconciliation MUETTE par booking vivant ancien (vérification et clôture manuelles, les lignes
--     restent `reserved`) ; UN récapitulatif aux admins si un booking ou une annulation est touché ;
--   - claim_order_for_pms_booking : `for share` sur les établissements avant de lire le jeton — un
--     remplacement en cours est attendu ; claimed_at jamais antérieur à l'époque lue ;
--   - record_pms_booking : établissement en `for share` avant la ligne ; pose pms_booked_at ; un
--     booking ancien (remplacement entre le claim et ici) reçoit son entrée muette, ou entre en file
--     d'annulation directement en échec ;
--   - claim_pms_poll_batch, claim_pms_cancellation_batch : jamais un booking ancien (rattrapage des
--     annulations en attente : échec, vérification manuelle ; rattrapages sans attente) ;
--   - apply_pms_poll_outcome : ceinture, `token_replaced` sur un booking ancien, rien ne bouge ;
--   - notify_admin_new_reconciliation_exception : les entrées « jeton Lobby remplacé » sont muettes ;
--   - sync_pms_availability_month : l'établissement avant pms_sync_state (ordre de record_pms_booking).
-- Verrous : orders → lignes → établissement (claim), orders → établissement → ligne (record),
-- établissement → pms_sync_state (record, synchro) ; le remplacement prend l'établissement, la file,
-- puis les lignes déjà bookées par id. Ordres servis par construction et course libre :
-- tests/concurrency/set_establishment_pms_connector.concurrency.mjs.

-- ── Verrous de la migration ────────────────────────────────────────────────────────────────
-- order_lines AVANT establishments, comme les écrivains (une annulation met à jour sa ligne, puis son
-- trigger lit l'établissement) ; un lecteur qui prendrait l'ordre inverse peut encore en faire un
-- interblocage — l'une des deux transactions échoue, à rejouer. Attente bornée : la migration échoue
-- plutôt que de bloquer le catalogue. Tenus jusqu'à la fin de la migration (une seule transaction).
do $$
begin
  perform set_config('lock_timeout', '5s', true);
  lock table public.order_lines, public.establishments in access exclusive mode;
end;
$$;

-- ── Colonnes ───────────────────────────────────────────────────────────────────────────────
alter table public.establishments add column lobby_token_changed_at timestamptz;
comment on column public.establishments.lobby_token_changed_at is
  'Dernier remplacement RÉEL du jeton Lobby (horloge, migration 20261004005336) : un booking posé avec un jeton lu avant n''est plus interrogé ni annulé avec le jeton courant. NULL = jamais remplacé depuis cette migration.';
-- Aucun droit de lecture client (establishments est accordé colonne par colonne) : la politique de
-- lecture publique d'establishments l'ouvrirait à toute session. Seules les fonctions la lisent.

alter table public.order_lines add column pms_booked_at timestamptz;
comment on column public.order_lines.pms_booked_at is
  'Instant où le jeton Lobby qui a posé le booking a été lu (claimed_at du claim, migration 20261004005336). NULL pour un booking antérieur : created_at fait foi (toujours avant le booking).';
-- Aucune reprise : toute lecture fait coalesce(pms_booked_at, created_at) — et un UPDATE en masse
-- d'order_lines déclencherait le trigger d'enfilement des annulations.

-- Les déduplications par booking (entrées ouvertes, file) et le rattrapage de la file.
create index order_lines_pms_booking_idx on public.order_lines (pms_booking_id) where pms_booking_id is not null;
create index pms_reconciliation_entries_open_line_idx on public.pms_reconciliation_entries (order_line_id)
  where status in ('open', 'retrying');

-- ── set_establishment_pms_connector : un paramètre de plus → drop puis create, droits refaits ──
drop function public.set_establishment_pms_connector(uuid, text, boolean, text);
create function public.set_establishment_pms_connector(p_establishment_id uuid, p_lobby_api_token text DEFAULT NULL::text, p_connector_active boolean DEFAULT false, p_reason text DEFAULT NULL::text, p_same_lobby_account boolean DEFAULT false)
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
    update public.pms_cancellation_queue
       set status = 'failed', processed_at = now(),
           last_error = 'jeton Lobby remplacé : annulation à vérifier à la main avant tout renvoi'
     where establishment_id = p_establishment_id and status = 'pending';
    get diagnostics v_failed = row_count;

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

revoke all on function public.set_establishment_pms_connector(uuid, text, boolean, text, boolean) from public, anon;
grant execute on function public.set_establishment_pms_connector(uuid, text, boolean, text, boolean) to authenticated, service_role;

-- ── claim_order_for_pms_booking ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_order_for_pms_booking(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order record;
  v_groups jsonb;
  v_claimed_at timestamptz;
  -- Durée du bail, lue par le bail ET par l'échéance (un claim ne survit jamais à la limite de
  -- paiement).
  c_bail constant interval := interval '5 minutes';
begin
  if p_order_id is null then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  -- Règle 8 : `orders` d'abord.
  select o.payment_status, o.pms_reserve_claimed_at, o.attribution_code, o.attribution_source, o.created_at
    into v_order
    from public.orders o
   where o.id = p_order_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  -- I3 : une commande payée n'est jamais re-réservée par cette voie (ni dé-payée plus loin).
  if v_order.payment_status in ('paid', 'partially_refunded', 'refunded') then
    return jsonb_build_object('ok', false, 'reason', 'order_paid');
  end if;

  -- Bail de 5 minutes (décision du 2026-09-30) : une commande à N nuits enchaîne N appels Lobby de
  -- 15 s au plus ; un second appelant pendant ce temps re-réserverait les mêmes nuits.
  if v_order.pms_reserve_claimed_at is not null
     and v_order.pms_reserve_claimed_at > now() - c_bail then
    return jsonb_build_object('ok', false, 'reason', 'claim_in_progress');
  end if;

  -- Puis les lignes à réserver, dans un ordre stable.
  perform 1
    from public.order_lines ol
   where ol.order_id = p_order_id
     and ol.status = 'reserved'
     and ol.pms_booking_id is null
   order by ol.id
   for update;

  -- Plus aucune ligne vivante (commande relâchée, expirée, annulée) : ce n'est pas « rien à
  -- réserver », c'est une commande morte — jamais un succès renvoyé au tunnel.
  if not exists (
    select 1 from public.order_lines ol where ol.order_id = p_order_id and ol.status = 'reserved'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'order_not_active');
  end if;

  -- Échéance de paiement (migration 20261001194704) : un claim ne survit jamais à la limite de
  -- paiement (`public.order_payment_deadline`, 28 min après la création). Passé limite − bail
  -- (23 min), une reprise poserait chez Lobby un vrai booking avec de moins en moins de temps pour
  -- le payer (plus aucun passé 28 min), resté chez le partenaire jusqu'à l'expiration (32 à 34 min,
  -- jamais si le job de réconciliation est en panne).
  -- Rien n'est posé. Placée APRÈS le bail (un claim vivant d'un autre onglet répond
  -- claim_in_progress : sa reprise peut encore rendre la commande payable) et après
  -- order_not_active (une commande morte le reste), mais AVANT pms_unavailable : trop tard pour
  -- payer, la commande expirera de toute façon, sans que ce refus la relâche en
  -- `cancelled_by_provider`.
  if now() + c_bail >= public.order_payment_deadline(v_order.created_at) then
    return jsonb_build_object('ok', false, 'reason', 'order_expiring');
  end if;

  -- Migration 20261004005336 : les établissements des lignes à réserver, en `for share`, AVANT de lire
  -- leur jeton : un remplacement de jeton en cours (`for no key update`) est attendu, et le jeton
  -- relu après lui. Sans ce verrou, le claim lirait l'ancien jeton d'un remplacement pas encore
  -- validé avec un claimed_at POSTÉRIEUR à l'instant du remplacement : le booking passerait pour
  -- posé avec le nouveau jeton. Ordre : orders → lignes → établissements — le remplacement ne
  -- verrouille que des lignes déjà bookées (ses entrées de réconciliation), jamais celles-ci.
  perform 1
    from public.establishments e
   where e.id in (
     select p.establishment_id
       from public.order_lines ol
       join public.products p on p.id = ol.product_id
      where ol.order_id = p_order_id
        and ol.status = 'reserved'
        and ol.pms_booking_id is null
   )
   order by e.id
   for share;

  -- CLAUDE.md §4.4 : un logement PMS-backed n'a aucun contrôle de capacité local — Lobby est le
  -- seul. Connecteur coupé ou sans jeton (même prédicat que create_order, 20260929112240, relu ici
  -- SOUS le verrou de la commande) → refus, rien n'est posé.
  if exists (
    select 1
      from public.order_lines ol
      join public.products p on p.id = ol.product_id
      join public.establishments e on e.id = p.establishment_id
     where ol.order_id = p_order_id
       and ol.status = 'reserved'
       and ol.pms_booking_id is null
       and p.type = 'lodging' and p.lobby_category_id is not null
       and (not e.lobby_connector_active or e.lobby_api_token is null)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'pms_unavailable');
  end if;

  -- Ce que la route doit réserver, groupé par établissement actif : les nuits PMS-backed (une
  -- réservation Lobby chacune) et les activités/transports liés à un produit Lobby (rattachés à la
  -- première réservation obtenue). Une activité d'un établissement coupé est ignorée, comme avant.
  select coalesce(jsonb_agg(g.grp order by g.establishment_id), '[]'::jsonb)
    into v_groups
    from (
      select e.id as establishment_id,
             jsonb_build_object(
               'establishment_id', e.id,
               'api_token', e.lobby_api_token,
               'lodging_lines', coalesce(jsonb_agg(jsonb_build_object(
                   'id', ol.id, 'product_id', ol.product_id, 'date', ol.date, 'end_date', ol.end_date,
                   'qty', ol.qty, 'holder_name', ol.holder_name, 'holder_email', ol.holder_email,
                   'holder_phone', ol.holder_phone, 'total_cop', ol.total_cop,
                   'lobby_category_id', p.lobby_category_id
                 ) order by ol.id) filter (where p.type = 'lodging'), '[]'::jsonb),
               'activity_lines', coalesce(jsonb_agg(jsonb_build_object(
                   'id', ol.id, 'product_id', ol.product_id, 'qty', ol.qty,
                   'lobby_product_id', p.lobby_product_id
                 ) order by ol.id) filter (where p.type <> 'lodging'), '[]'::jsonb)
             ) as grp
        from public.order_lines ol
        join public.products p on p.id = ol.product_id
        join public.establishments e on e.id = p.establishment_id
       where ol.order_id = p_order_id
         and ol.status = 'reserved'
         and ol.pms_booking_id is null
         and e.lobby_connector_active
         and e.lobby_api_token is not null
         and ((p.type = 'lodging' and p.lobby_category_id is not null)
              or (p.type in ('activity', 'transport') and p.lobby_product_id is not null))
       group by e.id, e.lobby_api_token
    ) g;

  if jsonb_array_length(v_groups) = 0 then
    return jsonb_build_object('ok', true, 'claimed_at', null, 'groups', v_groups);
  end if;

  -- Migration 20261004005336 : jamais antérieur à l'époque des jetons lus. Un claim qui a attendu un
  -- remplacement (for share ci-dessus) a lu le NOUVEAU jeton, alors que now() date le début de sa
  -- transaction : son booking passerait pour ancien. Hors remplacement : now(), comme avant.
  update public.orders
     set pms_reserve_claimed_at = greatest(now(), (
           select max(e.lobby_token_changed_at) + interval '1 microsecond'
             from public.establishments e
            where e.id in (select (g ->> 'establishment_id')::uuid from jsonb_array_elements(v_groups) g)
         ))
   where id = p_order_id
  returning pms_reserve_claimed_at into v_claimed_at;

  return jsonb_build_object(
    'ok', true,
    'claimed_at', v_claimed_at,
    'attribution_code', v_order.attribution_code,
    'attribution_source', v_order.attribution_source,
    'groups', v_groups
  );
end;
$function$;

-- ── record_pms_booking ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_pms_booking(p_order_id uuid, p_claimed_at timestamp with time zone, p_order_line_id uuid, p_pms_booking_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_claimed_at timestamptz;
  v_reference text;
  v_line record;
  v_establishment_id uuid;
  v_changed_at timestamptz;
  v_old boolean;
  v_reason text;
  v_queue_status text;
begin
  -- Le jeton est obligatoire : sans lui, `null is distinct from null` laisserait enregistrer un
  -- booking hors de tout claim.
  if p_order_id is null or p_claimed_at is null or p_order_line_id is null
     or nullif(btrim(p_pms_booking_id), '') is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_arguments');
  end if;

  -- Règle 8 : `orders` d'abord (on écrit une ligne fille et on peut enfiler).
  select o.pms_reserve_claimed_at, o.reference into v_claimed_at, v_reference
    from public.orders o
   where o.id = p_order_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  -- Migration 20261004005336 : l'établissement en `for share` AVANT la ligne (orders → établissement →
  -- ligne) : un remplacement de jeton en cours est attendu, et son instant relu après lui. Jamais
  -- après le verrou de la ligne : le remplacement accroche ses entrées aux lignes bookées (clé
  -- étrangère, KEY SHARE), dont celle-ci quand elle porte déjà un booking — interblocage.
  select p.establishment_id into v_establishment_id
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
   where ol.id = p_order_line_id and ol.order_id = p_order_id;
  select e.lobby_token_changed_at into v_changed_at
    from public.establishments e where e.id = v_establishment_id for share;
  -- Un booking posé avec un jeton lu (au claim, p_claimed_at) AVANT le dernier remplacement est
  -- ANCIEN : il ne sera jamais interrogé ni annulé avec le jeton courant.
  v_old := coalesce(p_claimed_at < v_changed_at, false);

  select ol.status, ol.pms_booking_id, ol.end_date, p.establishment_id
    into v_line
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
   where ol.id = p_order_line_id and ol.order_id = p_order_id
   for update of ol;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'line_not_found');
  end if;

  if v_line.pms_booking_id = p_pms_booking_id then
    -- Rejeu (réponse perdue) ou activité rattachée au booking principal déjà posé : rien à faire.
    return jsonb_build_object('ok', true, 'idempotent', true);
  elsif v_claimed_at is distinct from p_claimed_at then
    -- Le claim a expiré et un autre appelant a la main : ce booking est surnuméraire.
    v_reason := 'claim_stale';
    v_queue_status := 'superseded';
  elsif v_line.pms_booking_id is not null then
    -- I1 : la ligne porte déjà un AUTRE booking ; celui-ci est un doublon.
    v_reason := 'already_booked';
    v_queue_status := 'superseded';
  elsif v_line.status <> 'reserved' then
    -- La ligne est morte entre le claim et ici (expirée, annulée) : on garde la trace du booking
    -- sur la ligne, puis il part en annulation.
    update public.order_lines set pms_booking_id = p_pms_booking_id, pms_booked_at = p_claimed_at where id = p_order_line_id;
    v_reason := 'line_not_reserved';
    v_queue_status := v_line.status;
  else
    update public.order_lines set pms_booking_id = p_pms_booking_id, pms_booked_at = p_claimed_at where id = p_order_line_id;
    -- Le miroir de disponibilité doit savoir tout de suite que ces nuits sont prises chez Lobby
    -- (migration 20260918170000) — dans la même transaction, plus en best-effort séparé.
    -- Best-effort, comme dans la route avant : un échec ici retarde le reflet du miroir, il ne doit
    -- jamais faire échouer l'enregistrement d'un booking déjà acté chez Lobby.
    -- Migration 20261004005336 : le jeton a été remplacé entre le claim et ici — le booking a été posé
    -- avec l'ancien. Une entrée de réconciliation, muette (le remplacement a envoyé son
    -- récapitulatif), le fait vérifier à la main ; claim_pms_poll_batch ne le prendra jamais.
    if v_old then
      insert into public.pms_reconciliation_entries (order_line_id, detail)
      select p_order_line_id,
             'jeton Lobby remplacé le ' || to_char(v_changed_at at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI')
             || ' (heure de Colombie) : booking Lobby ' || p_pms_booking_id
             || ' posé avec l''ancien jeton, plus interrogé ni annulé automatiquement — à vérifier chez '
             || 'Lobby, puis clore la ligne à la main (changement de statut), commande ' || v_reference
       where not exists (
         select 1
           from public.pms_reconciliation_entries r
           join public.order_lines ol2 on ol2.id = r.order_line_id
           join public.products p2 on p2.id = ol2.product_id
          where r.status in ('open', 'retrying')
            and r.detail like 'jeton Lobby remplacé%'
            and strpos(r.detail, ' : booking Lobby ' || p_pms_booking_id || ' posé ') > 0
            and ol2.order_id = p_order_id
            and p2.establishment_id = v_establishment_id
       )
      ;
    end if;
    if v_line.end_date is not null then
      begin
        perform public.mark_pms_sync_due_for_order_line(p_order_line_id);
      exception when others then
        raise warning 'record_pms_booking : invalidation du miroir impossible (%) — reflet retardé', sqlerrm;
      end;
    end if;
    return jsonb_build_object('ok', true);
  end if;

  -- Un booking qu'aucune ligne vivante ne porte part TOUJOURS en file d'annulation, explicitement.
  -- Jamais délégué au seul trigger enqueue_pms_cancellations : il filtre les établissements au
  -- connecteur actif, et un connecteur coupé entre le claim et ici laisserait le booking
  -- orphelin chez Lobby. L'entrée attend alors la réactivation (claim_pms_cancellation_batch ne
  -- prend que les établissements actifs) ; si le trigger l'a déjà posée, l'index partiel absorbe
  -- le doublon.
  -- Migration 20261004005336 : un booking ANCIEN ne part jamais en annulation avec le jeton courant — il
  -- entre en file directement en échec (vérification manuelle), et l'annulation que le trigger
  -- vient peut-être de poser (line_not_reserved) y passe aussi.
  if v_old then
    update public.pms_cancellation_queue
       set status = 'failed', processed_at = now(), last_error = 'jeton Lobby remplacé : annulation à vérifier à la main avant tout renvoi'
     where pms_booking_id = p_pms_booking_id and establishment_id = v_line.establishment_id
       and status = 'pending';
    insert into public.pms_cancellation_queue (pms_booking_id, establishment_id, hifago_status, status, processed_at, last_error)
    select p_pms_booking_id, v_line.establishment_id, v_queue_status, 'failed', now(), 'jeton Lobby remplacé : annulation à vérifier à la main avant tout renvoi'
     where not exists (
       select 1 from public.order_lines ol
        where ol.pms_booking_id = p_pms_booking_id and ol.status = 'reserved'
     )
       and not exists (
       select 1 from public.pms_cancellation_queue q
        where q.pms_booking_id = p_pms_booking_id and q.establishment_id = v_line.establishment_id
          and q.status in ('pending', 'failed')
     );
  else
    insert into public.pms_cancellation_queue (pms_booking_id, establishment_id, hifago_status)
    select p_pms_booking_id, v_line.establishment_id, v_queue_status
     where not exists (
       select 1 from public.order_lines ol
        where ol.pms_booking_id = p_pms_booking_id and ol.status = 'reserved'
     )
    on conflict (pms_booking_id) where status = 'pending' do nothing;
  end if;

  return jsonb_build_object('ok', false, 'reason', v_reason);
end;
$function$;

-- ── claim_pms_poll_batch ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_pms_poll_batch(p_limit integer DEFAULT 20)
 RETURNS TABLE(order_line_id uuid, pms_booking_id text, establishment_id uuid, lobby_api_token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- Migration 20261003223900 : (1) un établissement sans jeton n'est jamais réclamé (même filtre que
  -- claim_pms_cancellation_batch) — sinon un 401 Lobby à chaque passage ; (2) UN appel Lobby par
  -- BOOKING : les lignes d'activité héritent du booking de l'hébergement. Une ligne représentante
  -- par booking (la plus petite) est rendue ; ses lignes vivantes libres sont marquées interrogées
  -- (une sœur tenue par une autre transaction est laissée au passage suivant).
  -- Un booking est identifié par (numéro, établissement) : deux comptes Lobby peuvent porter le
  -- même numéro. Aucune ligne n'est attendue (skip locked) : jamais d'interblocage.
  -- Migration 20261004005336 : jamais une ligne dont le booking a été posé avec un jeton depuis remplacé
  -- (lobby_token_changed_at) — le jeton courant peut ouvrir un autre compte Lobby, où ce numéro
  -- n'existe pas (404 → annulation à tort) ; sa vérification est manuelle (set_establishment_pms_connector).
  return query
    with candidates as (
      select ol.id, ol.pms_booking_id, p.establishment_id
        from public.order_lines ol
        join public.products p on p.id = ol.product_id
        join public.establishments e on e.id = p.establishment_id
       where ol.pms_booking_id is not null
         and ol.status = 'reserved'
         and e.lobby_connector_active = true
         and e.lobby_api_token is not null
         and (e.lobby_token_changed_at is null
              or coalesce(ol.pms_booked_at, ol.created_at) >= e.lobby_token_changed_at)
       order by ol.pms_last_polled_at asc nulls first
       limit p_limit
       for update of ol skip locked
    ),
    siblings as (
      select ol.id
        from public.order_lines ol
        join public.products p on p.id = ol.product_id
        join public.establishments e on e.id = p.establishment_id
       where ol.status = 'reserved'
         and (ol.pms_booking_id, p.establishment_id) in (
           select c.pms_booking_id, c.establishment_id from candidates c
         )
         and (e.lobby_token_changed_at is null
              or coalesce(ol.pms_booked_at, ol.created_at) >= e.lobby_token_changed_at)
       for update of ol skip locked
    ),
    polled as (
      update public.order_lines ol
         set pms_last_polled_at = now()
        from public.products p
       where p.id = ol.product_id
         and ol.id in (select sb.id from siblings sb)
      returning ol.id, ol.pms_booking_id, p.establishment_id
    )
    select distinct on (pl.pms_booking_id, pl.establishment_id)
           pl.id, pl.pms_booking_id, pl.establishment_id, e.lobby_api_token
      from polled pl
      join public.establishments e on e.id = pl.establishment_id
     order by pl.pms_booking_id, pl.establishment_id, pl.id;
end;
$function$;

-- ── claim_pms_cancellation_batch ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_pms_cancellation_batch(p_limit integer DEFAULT 20, p_max_attempts integer DEFAULT 3)
 RETURNS TABLE(entry_id uuid, pms_booking_id text, establishment_id uuid, lobby_api_token text, hifago_status text, attempts integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- Migration 20261004005336 : (a) et (b) sautent une entrée tenue ailleurs (le remplacement d'un jeton qui
  -- la fait échouer, un autre lot) au lieu de l'attendre — deux UPDATE de plusieurs entrées dans
  -- des ordres différents s'interbloqueraient avec celui du remplacement. Elle est reprise au
  -- passage suivant.
  -- (a) Rattrapage : une entrée réclamée mais jamais résolue reste `pending` avec un compteur au
  -- plafond. Sans cette clôture, elle est re-réclamée indéfiniment et n'apparaît dans aucun
  -- rapport. `last_error` n'est écrasé que s'il est vide — le motif du dernier échec réel, s'il
  -- a pu être écrit, vaut mieux que ce message générique.
  update public.pms_cancellation_queue q
     set status = 'failed',
         processed_at = now(),
         last_error = coalesce(
           q.last_error,
           'abandonnée sans résolution après ' || p_max_attempts || ' tentative(s)'
         )
   where q.id in (
     select q2.id from public.pms_cancellation_queue q2
      where q2.status = 'pending'
        and q2.attempts >= p_max_attempts
      for update of q2 skip locked
   );

  return query
    with claimed as (
      select q.id
        from public.pms_cancellation_queue q
        join public.establishments e on e.id = q.establishment_id
       where q.status = 'pending'
         and q.attempts < p_max_attempts
         and e.lobby_connector_active = true
         and e.lobby_api_token is not null
         -- Migration 20261004005336 : jamais l'annulation d'un booking posé avec un jeton depuis remplacé —
         -- le jeton courant peut ouvrir un autre compte Lobby, où ce numéro désigne une autre
         -- réservation, ou rien (et un 404 y compte pour un succès). Dans l'instantané qui lit le
         -- jeton rendu : un remplacement validé pendant l'appel ne peut pas s'intercaler.
         and not exists (
           select 1
             from public.order_lines ol
             join public.products p on p.id = ol.product_id
            where ol.pms_booking_id = q.pms_booking_id
              and p.establishment_id = q.establishment_id
              and coalesce(ol.pms_booked_at, ol.created_at) < e.lobby_token_changed_at
         )
       order by q.created_at asc
       limit p_limit
       for update of q skip locked
    )
    update public.pms_cancellation_queue q
       set attempts = q.attempts + 1
      from claimed c, public.establishments e
     where q.id = c.id and e.id = q.establishment_id
    returning q.id, q.pms_booking_id, e.id, e.lobby_api_token, q.hifago_status, q.attempts;

  -- (b) Migration 20261004005336 : celles que la réclamation vient d'écarter — en attente, d'un booking
  -- ancien — passent en échec pour une vérification manuelle, comme celles qui attendaient au
  -- moment du remplacement (elles ne partiront jamais : sans ça, elles resteraient en attente
  -- pour toujours). Couvre toutes les entrées posées APRÈS lui (trigger, refus PMS). Après la
  -- réclamation, jamais avant : c'est elle qui garantit qu'aucune ne part avec le nouveau jeton.
  update public.pms_cancellation_queue q
     set status = 'failed', processed_at = now(), last_error = 'jeton Lobby remplacé : annulation à vérifier à la main avant tout renvoi'
   where q.id in (
     select q2.id from public.pms_cancellation_queue q2
      where q2.status = 'pending'
        and exists (
          select 1
            from public.order_lines ol
            join public.products p on p.id = ol.product_id
            join public.establishments e on e.id = p.establishment_id
           where ol.pms_booking_id = q2.pms_booking_id
             and p.establishment_id = q2.establishment_id
             and coalesce(ol.pms_booked_at, ol.created_at) < e.lobby_token_changed_at
        )
      for update of q2 skip locked
   );
end;
$function$;

-- ── apply_pms_poll_outcome ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_pms_poll_outcome(p_order_line_id uuid, p_outcome text, p_detail text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order_id uuid;
  v_booking text;
  v_establishment_id uuid;
  v_order record;
  v_line_ids uuid[];
  v_due_ids uuid[];
  v_line_id uuid;
  v_entry_line uuid;
  v_from date;
  v_to date;
begin
  if p_outcome is null or p_outcome not in ('gone', 'realized') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_outcome');
  end if;

  -- Lecture non verrouillante de la ligne, puis le verrou de la COMMANDE d'abord (règle 8 de
  -- .claude/rules/supabase.md) — même ordre qu'expire_payment_order et modify_order_line. Ni la
  -- commande ni le booking d'une ligne ne changent (record_pms_booking n'écrit qu'un booking absent).
  select ol.order_id, ol.pms_booking_id, p.establishment_id into v_order_id, v_booking, v_establishment_id
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
   where ol.id = p_order_line_id;
  if not found or v_booking is null then
    return jsonb_build_object('ok', false, 'reason', 'line_not_found');
  end if;

  select o.id, o.reference, o.payment_status into v_order
    from public.orders o
   where o.id = v_order_id for update;

  -- Les lignes VIVANTES du booking, relues sous ce verrou : un booking Lobby appartient à une
  -- commande et à un établissement (deux comptes Lobby peuvent porter le même numéro) — la nuit, et
  -- les activités qui en héritent (reserve-nights).
  with l as (
    select ol.id from public.order_lines ol
      join public.products p on p.id = ol.product_id
     where ol.order_id = v_order_id and ol.pms_booking_id = v_booking and ol.status = 'reserved'
       and p.establishment_id = v_establishment_id
     order by ol.id
     for update of ol
  )
  select coalesce(array_agg(id), array[]::uuid[]) into v_line_ids from l;

  -- Idempotent : plus aucune ligne vivante sur ce booking (second appel, ou toutes annulées,
  -- expirées, remplacées entre-temps) → rien. Une ligne passée morte dont des sœurs vivent encore
  -- n'empêche pas de traiter le booking : c'est lui qui a disparu ou a été réalisé.
  if array_length(v_line_ids, 1) is null then
    return jsonb_build_object('ok', false, 'reason', 'no_live_line');
  end if;

  -- Migration 20261004005336 : un booking posé avec un jeton depuis remplacé n'est jamais jugé sur une
  -- réponse de Lobby (claim_pms_poll_batch ne le rend plus ; ceinture pour un poll en vol) : rien
  -- ne bouge, sa vérification est manuelle (set_establishment_pms_connector).
  if exists (
    select 1
      from public.order_lines ol, public.establishments e
     where ol.id = any(v_line_ids) and e.id = v_establishment_id
       and coalesce(ol.pms_booked_at, ol.created_at) < e.lobby_token_changed_at
  ) then
    return jsonb_build_object('ok', false, 'reason', 'token_replaced');
  end if;

  if p_outcome = 'realized' then
    -- Le séjour a eu lieu chez Lobby : la nuit ET les activités du même booking sont réalisées
    -- (commission due), mais seulement celles dont la date est passée — une excursion prévue après
    -- le départ reste réservée, et un poll suivant la réalisera à sa date. Aucune place ne revient.
    select coalesce(array_agg(ol.id order by ol.id), array[]::uuid[]) into v_due_ids
      from public.order_lines ol
     where ol.id = any(v_line_ids)
       and coalesce(ol.end_date, ol.date) <= public.today_in_bogota();
    if array_length(v_due_ids, 1) is not null then
      update public.order_lines set status = 'fulfilled' where id = any(v_due_ids);
      perform public.apply_order_line_ledger_transition(v_due_ids, 'fulfilled');
    end if;
    return jsonb_build_object('ok', true, 'outcome', 'realized', 'lines', coalesce(array_length(v_due_ids, 1), 0));
  end if;

  -- 'gone' : le booking n'existe plus chez Lobby.
  perform public.lock_order_capacity_rows(v_line_ids);
  -- G2 : les places des lignes d'ACTIVITÉ reviennent (une nuit PMS n'a jamais été
  -- décrémentée : release_order_line_capacity ne lui rend rien).
  foreach v_line_id in array v_line_ids loop
    perform public.release_order_line_capacity(v_line_id);
  end loop;

  -- UNE SEULE instruction : le trigger d'annulation PMS est FOR EACH STATEMENT.
  update public.order_lines set status = 'cancelled_by_provider' where id = any(v_line_ids);

  perform public.apply_order_line_ledger_transition(v_line_ids, 'cancelled_by_provider');

  -- Le miroir, en UN appel sur la plage du booking : mark_pms_sync_due parcourt les mois dans
  -- l'ordre, jamais un verrou de mois pris à rebours.
  select min(ol.date), max(coalesce(ol.end_date, ol.date)) into v_from, v_to
    from public.order_lines ol
   where ol.id = any(v_line_ids);
  perform public.mark_pms_sync_due(v_establishment_id, v_from, v_to);

  -- La trace de l'admin. Une commande PAYÉE n'est jamais remboursée d'office (pas de
  -- refund_required automatique sur un booking disparu) : l'entrée le dit, et payment_status ne
  -- bouge pas.
  v_entry_line := case when p_order_line_id = any(v_line_ids) then p_order_line_id else v_line_ids[1] end;
  insert into public.pms_reconciliation_entries (order_line_id, detail)
  values (
    v_entry_line,
    'booking Lobby ' || v_booking || ' introuvable chez Lobby'
      || coalesce(' (' || nullif(btrim(p_detail), '') || ')', '')
      || ' — ' || array_length(v_line_ids, 1) || ' ligne(s) annulée(s), commande ' || v_order.reference
      || case when v_order.payment_status in ('paid', 'partially_refunded')
            then ' — commande PAYÉE : remboursement à décider'
            when v_order.payment_status = 'pending'
            then ' — un paiement est en cours : s''il aboutit, il sera à rembourser'
            else '' end
  );

  return jsonb_build_object('ok', true, 'outcome', 'gone', 'lines', array_length(v_line_ids, 1));
end;
$function$;

-- ── sync_pms_availability_month ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_pms_availability_month(p_establishment_id uuid, p_month text, p_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_now timestamptz := now();
  v_debut date;
  v_fin date;
  v_ecrites int;
  v_retirees int;
begin
  if p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_month');
  end if;

  v_debut := (p_month || '-01')::date;
  v_fin := (v_debut + interval '1 month')::date;

  -- Migration 20261004005336 : l'établissement AVANT pms_sync_state, comme record_pms_booking (qui le
  -- tient en partage puis invalide le mois) et le remplacement du jeton (qui le tient puis attend
  -- les lignes d'un booking, dont le poll invalide le mois). Pris en dernier, il fermait un
  -- cycle avec l'un ou l'autre : interblocage.
  update public.establishments set lobby_last_synced_at = v_now where id = p_establishment_id;

  delete from public.pms_availability_mirror
   where establishment_id = p_establishment_id
     and date >= v_debut and date < v_fin;
  get diagnostics v_retirees = row_count;

  insert into public.pms_availability_mirror as m (
    establishment_id, lobby_category_id, date, available_units, min_stay, max_stay, lead_days, synced_at
  )
  select p_establishment_id,
         (r->>'category_id')::int,
         (r->>'date')::date,
         greatest((r->>'available_units')::int, 0),
         nullif(r->>'min_stay', '')::int,
         nullif(r->>'max_stay', '')::int,
         nullif(r->>'lead_days', '')::int,
         v_now
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as r
   where (r->>'date')::date >= v_debut and (r->>'date')::date < v_fin
   on conflict do nothing;
  get diagnostics v_ecrites = row_count;

  delete from public.pms_availability_mirror
   where establishment_id = p_establishment_id
     and date < public.today_in_bogota();

  insert into public.pms_sync_state as st (establishment_id, month, synced_at, attempts, last_error, next_attempt_at)
  values (p_establishment_id, p_month, v_now, 0, null, null)
  on conflict on constraint pms_sync_state_pkey
  do update set synced_at = v_now, attempts = 0, last_error = null, next_attempt_at = null;


  return jsonb_build_object('ok', true, 'written', v_ecrites, 'removed', v_retirees);
end;
$function$;

-- ── notify_admin_new_reconciliation_exception ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_admin_new_reconciliation_exception()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_label text;
  v_subject text;
  v_body text;
  v_app_base_url text;
begin
  begin
    -- Migration 20261004005336 : les entrées « jeton Lobby remplacé » (set_establishment_pms_connector,
    -- record_pms_booking) sont muettes — le remplacement envoie UN récapitulatif aux admins, au
    -- lieu d'un e-mail par booking et par admin. IF imbriqué : `new.detail` n'existe que sur
    -- pms_reconciliation_entries.
    if tg_table_name = 'pms_reconciliation_entries' then
      if new.detail like 'jeton Lobby remplacé%' then
        return new;
      end if;
    end if;

    -- Migration 20261002125023 — étranglement des échecs de signature du webhook (`failure_reason`
    -- « signature invalide (…) », écrit par apps/web/app/api/payments/webhook/route.ts, sans
    -- payment_id). Leur nombre ne dépend d'aucun paiement réel : au plus UNE entrée de cette classe
    -- est notifiée par HEURE GLISSANTE (donc au plus un e-mail par admin). La fenêtre compte les
    -- e-mails de la classe MIS EN FILE, quel que soit leur statut — elle est donc par classe : un
    -- admin ajouté pendant l'heure attend la suivante, et un envoi raté n'est pas rejoué. L'entrée,
    -- elle, est toujours écrite (matériel de rejeu). Une seule transaction décide à la fois : verrou
    -- consultatif NON bloquant — les autres, sans attendre, se taisent (sans lui, chaque insertion
    -- concurrente passerait avant que la première notification soit validée) ; si celle qui le
    -- tient est annulée, la prochaine entrée de la classe notifie. Testé AVANT la lecture du secret
    -- Vault, qu'une entrée étranglée ne lit donc pas. Jamais étranglés : refund_required, une entrée
    -- corrélée (payment_id), les autres échecs du webhook, refunded_externally, et tout ce qui vient
    -- de pms_reconciliation_entries.
    if tg_table_name = 'payment_reconciliation_entries' then
      if new.kind = 'webhook_failure' and new.payment_id is null
         and new.failure_reason like 'signature invalide (%' then
        -- Le verrou AVANT la fenêtre, en deux instructions : l'`exists` prend alors un instantané
        -- postérieur au verrou, et voit la notification de la transaction qui le tenait.
        if not pg_try_advisory_xact_lock(hashtext('notify_admin_new_reconciliation_exception:signature')) then
          return new;
        end if;
        if exists (
             select 1
               from public.notification_emails ne
               join public.payment_reconciliation_entries e on e.id = ne.related_id
              where ne.event_type = 'admin_new_reconciliation_exception'
                and ne.related_table = 'payment_reconciliation_entries'
                and ne.created_at > now() - interval '1 hour'
                and e.kind = 'webhook_failure' and e.payment_id is null
                and e.failure_reason like 'signature invalide (%'
           ) then
          return new;
        end if;
      end if;
    end if;

    -- Lien absolu : sans le secret, on retombe sur le chemin relatif (jamais un e-mail en moins).
    select decrypted_secret into v_app_base_url
      from vault.decrypted_secrets where name = 'admin_app_public_url';
    if v_app_base_url is null then
      raise warning 'notify_admin_new_reconciliation_exception: secret Vault admin_app_public_url manquant — lien relatif dans l''e-mail';
    end if;

    if tg_table_name = 'pms_reconciliation_entries' then
      select coalesce(public.html_text(p.name ->> 'es'), 'Producto sin nombre')
        into v_label
        from public.order_lines ol
        join public.products p on p.id = ol.product_id
       where ol.id = new.order_line_id;
      v_subject := 'Nueva excepción de reconciliación PMS';
    else
      -- payment_id nullable (spec 23 §9, cas limite) : un webhook peut échouer avant même d'être
      -- corrélé à un payments connu — libellé générique plutôt qu'un crash de construction.
      -- Migration 20261002125023 : valeurs tierces échappées (html_text) — le nom du
      -- titulaire vient d'un visiteur, le nom d'un produit d'un partenaire.
      select 'Pedido ' || public.html_text(o.reference) || ' de ' || public.html_text(o.holder_name) || ' — ' || pay.amount_cop || ' COP'
        into v_label
        from public.payments pay
        join public.orders o on o.id = pay.order_id
       where pay.id = new.payment_id;
      v_label := coalesce(v_label, 'Pedido no identificado');
      if new.kind = 'refund_required' then
        v_subject := 'Pago recibido sin reserva que honrar — reembolso requerido';
      else
        v_subject := 'Nueva excepción de reconciliación de pago';
      end if;
    end if;

    v_body := '<p>' || coalesce(v_label, 'Sin identificar') || '</p>'
      || '<p><a href="' || coalesce(v_app_base_url, '') || '/admin/reconciliation">Ver reconciliaciones pendientes</a></p>';

    perform public.notify_all_admins(
      'admin_new_reconciliation_exception', v_subject, v_body, tg_table_name, new.id
    );
  exception
    when query_canceled then
      raise warning 'notify_admin_new_reconciliation_exception: annulé (query_canceled) pour % % — %', tg_table_name, new.id, sqlerrm;
    when others then
      raise warning 'notify_admin_new_reconciliation_exception: échec pour % % — %', tg_table_name, new.id, sqlerrm;
  end;

  return new;
end;
$function$;

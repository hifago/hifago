-- Lobby après l'acompte — correctifs de la revue du 2026-10-23. Migration ADDITIVE, après
-- 20261023120000, qu'elle ne modifie pas. Trois manques :
--
-- 1. AUCUN LEVIER ADMIN SUR UNE DEMANDE BLOQUÉE. order_for_client_jsonb.pms_confirmation vaut 'failed'
--    dès qu'une demande pms_booking_requests est failed / needs_human : le client restait
--    « paid_unconfirmed » pour toujours, même relogé à la main ; les e-mails 5/6/7/8, différés
--    jusqu'au booking, ne partaient jamais ; une nuit tenue sans booking d'une demande needs_human
--    (le booking existe peut-être chez Lobby) comptait « en vol » sans limite dans hold_pms_nights.
--    → admin_resolve_pms_booking_request (retry / confirm / cancel, admin seul, journal d'audit) et
--    admin_pms_booking_requests (l'écran /admin/reconciliation y lit quelle demande reprendre).
--
-- 2. « UNE ISSUE INCONNUE N'EST JAMAIS RETENTÉE » N'ÉTAIT PAS GARANTI. Si resolve_pms_booking_request
--    (needs_human) échouait après un POST /bookings sans réponse (erreur passagère, fonction tuée),
--    la demande restait pending et repartait au bout de son bail : second booking PAYÉ chez Lobby,
--    que l'API ne sait pas annuler (RESTRICTED_RESERVATION). → un marqueur DURABLE,
--    order_lines.pms_attempt_started_at, posé EN BASE avant chaque POST (mark_pms_booking_attempt) et
--    effacé seulement quand l'appel n'a pas pu créer de booking (clear_pms_booking_attempt) ; tant
--    qu'il reste sur une nuit sans booking, claim_paid_order_for_pms_booking refuse
--    (attempt_unresolved) — l'Edge Function en fait un needs_human, jamais un second POST.
--
-- 3. resolve_pms_cancellation_restricted FERMAIT EN SILENCE ('done') une annulation refusée dont
--    aucune ligne hifago ne porte le booking : la chambre restait prise chez le partenaire, sans
--    personne pour le voir. → 'failed', motif explicite (claim_pms_cancellation_batch ne reprend
--    jamais un failed ; le contrôle nocturne compte les échecs).
--
-- COMPATIBILITÉ avec le code en production (cette migration part AVANT l'Edge Function qui l'utilise) :
-- une colonne et quatre fonctions neuves ; deux fonctions redéfinies depuis leur définition VIVANTE
-- (pg_get_functiondef, remplacements comptés — .claude/rules/supabase.md règle 7), signatures et
-- droits inchangés. La pms-book-paid-orders déployée ne pose jamais le marqueur : le nouveau refus
-- attempt_unresolved ne peut pas l'atteindre.
--
-- ORDRE DES VERROUS (règle 8 de .claude/rules/supabase.md) : `orders` d'abord, partout. Puis, dans la
-- reprise admin : la demande ; les établissements en `for share` AVANT toute ligne qui porte ou reçoit
-- un booking (ordre de record_pms_booking : un remplacement de jeton tient l'établissement, puis
-- accroche ses entrées aux lignes bookées) ; les lignes par id ; les entrées de réconciliation.
--
-- Grants : PostgreSQL accorde EXECUTE à PUBLIC (et ce projet à anon/authenticated) sur toute fonction
-- neuve — chacune est refermée explicitement. mark / clear : service_role seul (pms-book-paid-orders ;
-- service_role_only_functions.test.sql les nomme). Les deux RPC admin : authenticated, garde is_admin
-- interne (security_definer_exposure.test.sql la lit dans leur source).

-- Attente bornée : la migration échoue plutôt que de bloquer order_lines en production derrière une
-- longue transaction (même posture que 20261023120000).
select set_config('lock_timeout', '5s', true);

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 1. Le marqueur de tentative
-- ════════════════════════════════════════════════════════════════════════════════════════════
alter table public.order_lines add column pms_attempt_started_at timestamptz;
comment on column public.order_lines.pms_attempt_started_at is
  'Marqueur DURABLE d''un POST /bookings Lobby parti pour cette nuit (migration 20261023150000) : posé AVANT l''appel par mark_pms_booking_attempt, effacé seulement quand l''appel n''a pas pu créer de booking (clear_pms_booking_attempt), ou par l''admin qui atteste qu''aucun booking n''existe (admin_resolve_pms_booking_request). Sur une nuit sans booking, claim_paid_order_for_pms_booking refuse tant qu''il est posé (attempt_unresolved) : une issue inconnue n''est jamais rejouée.';
-- Aucun grant de colonne : order_lines n'a aucun SELECT pour anon/authenticated (20260922210000).

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 2. mark_pms_booking_attempt / clear_pms_booking_attempt — appelées par pms-book-paid-orders
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- mark : AVANT chaque POST /bookings d'une nuit. Sous le verrou de la commande (tous les écrivains du
-- marqueur le prennent, comme ceux du booking), vérifie que le claim est celui de l'appelant
-- (orders.pms_reserve_claimed_at, posé par claim_paid_order_for_pms_booking), que la ligne est
-- `reserved` et sans booking, puis pose le marqueur — ou refuse s'il l'est déjà : un appel précédent
-- n'a jamais eu d'issue connue, le booking existe PEUT-ÊTRE chez Lobby (ni clé d'idempotence, ni
-- recherche de booking), un second POST serait un second booking payé. Deux appels simultanés sur
-- la même ligne se sérialisent sur `orders` : le second relit la ligne (nouvel instantané, read
-- committed) et voit le marqueur du premier ; sous repeatable read, son `for update` sur la ligne
-- modifiée échoue (erreur de sérialisation) — jamais deux ok
-- (tests/concurrency/mark_pms_booking_attempt.concurrency.mjs).
-- Refus : invalid_arguments, order_not_found, claim_stale (bail repris ou rendu), line_not_found,
-- already_booked, line_not_reserved, already_attempted.
create function public.mark_pms_booking_attempt(p_order_id uuid, p_claimed_at timestamptz, p_order_line_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claimed_at timestamptz;
  v_line record;
begin
  -- Le jeton est obligatoire : sans lui, `null is distinct from null` laisserait marquer hors claim.
  if p_order_id is null or p_claimed_at is null or p_order_line_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_arguments');
  end if;

  -- Règle 8 : `orders` d'abord.
  select o.pms_reserve_claimed_at into v_claimed_at
    from public.orders o
   where o.id = p_order_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;
  if v_claimed_at is distinct from p_claimed_at then
    return jsonb_build_object('ok', false, 'reason', 'claim_stale');
  end if;

  select ol.status, ol.pms_booking_id, ol.pms_attempt_started_at into v_line
    from public.order_lines ol
   where ol.id = p_order_line_id and ol.order_id = p_order_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'line_not_found');
  end if;
  -- Même ordre que record_pms_booking : un booking déjà posé d'abord, puis une ligne morte.
  if v_line.pms_booking_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_booked');
  end if;
  if v_line.status <> 'reserved' then
    return jsonb_build_object('ok', false, 'reason', 'line_not_reserved');
  end if;
  if v_line.pms_attempt_started_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_attempted');
  end if;

  update public.order_lines set pms_attempt_started_at = now() where id = p_order_line_id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.mark_pms_booking_attempt(uuid, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.mark_pms_booking_attempt(uuid, timestamptz, uuid) to service_role;

-- clear : quand l'appel n'a PAS pu créer de booking (connexion jamais établie, 4xx de relais, refus
-- explicite 400/422 — dont le premier essai avec `payment`, avant le second sans lui). Même contrôle
-- du claim. Idempotent (`cleared` false si rien n'était posé). Ne regarde ni le statut ni le booking
-- de la ligne : effacer le marqueur d'une ligne morte entre-temps est sans effet.
create function public.clear_pms_booking_attempt(p_order_id uuid, p_claimed_at timestamptz, p_order_line_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claimed_at timestamptz;
  v_started_at timestamptz;
begin
  if p_order_id is null or p_claimed_at is null or p_order_line_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_arguments');
  end if;

  -- Règle 8 : `orders` d'abord.
  select o.pms_reserve_claimed_at into v_claimed_at
    from public.orders o
   where o.id = p_order_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;
  if v_claimed_at is distinct from p_claimed_at then
    return jsonb_build_object('ok', false, 'reason', 'claim_stale');
  end if;

  select ol.pms_attempt_started_at into v_started_at
    from public.order_lines ol
   where ol.id = p_order_line_id and ol.order_id = p_order_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'line_not_found');
  end if;
  if v_started_at is null then
    return jsonb_build_object('ok', true, 'cleared', false);
  end if;

  update public.order_lines set pms_attempt_started_at = null where id = p_order_line_id;
  return jsonb_build_object('ok', true, 'cleared', true);
end;
$$;
revoke all on function public.clear_pms_booking_attempt(uuid, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.clear_pms_booking_attempt(uuid, timestamptz, uuid) to service_role;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 3. claim_paid_order_for_pms_booking — redéfinie depuis la vivante (20261023120000), remplacements
--    comptés, signature et droits inchangés. SEUL ajout : le refus attempt_unresolved, AVANT le bail.
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- Le refus est lu APRÈS celui du bail (claim_in_progress) : un marqueur posé sous un bail VIVANT est
-- une tentative en cours, pas une issue inconnue. Et AVANT pms_unavailable : un connecteur coupé ne
-- doit pas faire passer une issue inconnue pour une panne (six essais, puis « Lobby a refusé »).
-- Seules les nuits PMS sont marquées (bookClaimedOrder) : le refus porte sur elles.
CREATE OR REPLACE FUNCTION public.claim_paid_order_for_pms_booking(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order record;
  v_groups jsonb;
  v_claimed_at timestamptz;
  -- Migration 20261023150000 : la nuit dont un POST /bookings précédent n'a pas d'issue connue.
  v_unresolved_line_id uuid;
  -- Durée du bail, la même que claim_order_for_pms_booking : une commande à N nuits enchaîne N
  -- appels Lobby de 15 s au plus.
  c_bail constant interval := interval '5 minutes';
begin
  if p_order_id is null then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  -- Règle 8 : `orders` d'abord.
  select o.payment_status, o.pms_reserve_claimed_at, o.attribution_code, o.attribution_source
    into v_order
    from public.orders o
   where o.id = p_order_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  -- L'inverse d'I3 : cette voie ne réserve QUE des commandes payées (remboursée, rejetée, partiellement
  -- remboursée : plus rien à réserver automatiquement).
  if v_order.payment_status <> 'paid' then
    return jsonb_build_object('ok', false, 'reason', 'order_not_paid');
  end if;

  -- Bail de 5 minutes : deux passages (trigger immédiat et cron) ne réservent jamais la même
  -- commande ensemble — LobbyPMS n'a ni clé d'idempotence ni recherche de booking.
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

  -- Plus aucune ligne vivante (toutes annulées après le paiement) : rien à réserver, jamais un
  -- succès « vide » qui passerait pour une confirmation.
  if not exists (
    select 1 from public.order_lines ol where ol.order_id = p_order_id and ol.status = 'reserved'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'order_not_active');
  end if;

  -- Migration 20261023150000 : une nuit PMS dont un POST /bookings précédent n'a JAMAIS eu d'issue
  -- connue (marqueur posé par mark_pms_booking_attempt, jamais effacé, aucun booking enregistré) : le
  -- booking existe PEUT-ÊTRE chez Lobby. Jamais rendue, la commande jamais rejouée — refus AVANT le
  -- bail ; pms-book-paid-orders en fait un needs_human (entrée de réconciliation sur cette ligne).
  -- Lu après le bail : sous un bail vivant, le marqueur est une tentative EN COURS.
  select ol.id into v_unresolved_line_id
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
   where ol.order_id = p_order_id
     and ol.status = 'reserved'
     and ol.pms_booking_id is null
     and ol.pms_attempt_started_at is not null
     and p.type = 'lodging' and p.lobby_category_id is not null
   order by ol.date, ol.id
   limit 1;
  if v_unresolved_line_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'attempt_unresolved', 'order_line_id', v_unresolved_line_id);
  end if;

  -- Aucune échéance de paiement ici (claim_order_for_pms_booking en a une) : la commande est payée.

  -- Les établissements des lignes à réserver, en `for share`, AVANT de lire leur jeton (migration
  -- 20261004005336) : un remplacement de jeton en cours est attendu, le jeton relu après lui.
  -- Ordre : orders → lignes → établissements, comme claim_order_for_pms_booking.
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

  -- CLAUDE.md §4.4 : connecteur coupé ou sans jeton → refus, rien n'est posé.
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

  select coalesce(jsonb_agg(g.grp order by g.establishment_id), '[]'::jsonb)
    into v_groups
    from (
      select e.id as establishment_id,
             jsonb_build_object(
               'establishment_id', e.id,
               'api_token', e.lobby_api_token,
               'primary_booking_id', (
                 select b.pms_booking_id
                   from public.order_lines b
                   join public.products bp on bp.id = b.product_id
                  where b.order_id = p_order_id
                    and b.status = 'reserved'
                    and b.pms_booking_id is not null
                    and bp.type = 'lodging' and bp.lobby_category_id is not null
                    and bp.establishment_id = e.id
                  order by b.date, b.id
                  limit 1
               ),
               'lodging_lines', coalesce(jsonb_agg(jsonb_build_object(
                   'id', ol.id, 'product_id', ol.product_id, 'date', ol.date, 'end_date', ol.end_date,
                   'qty', ol.qty, 'holder_name', ol.holder_name, 'holder_email', ol.holder_email,
                   'holder_phone', ol.holder_phone, 'total_cop', ol.total_cop,
                   'acompte_cop', ol.acompte_cop,
                   'lobby_category_id', p.lobby_category_id,
                   'lodging_kind', p.lodging_kind, 'unit', p.unit, 'capacity', p.capacity
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

  -- Jamais antérieur à l'époque des jetons lus (migration 20261004005336).
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

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 4. resolve_pms_cancellation_restricted — redéfinie depuis la vivante (20261023120000),
--    remplacements comptés, signature et droits inchangés. SEUL changement : quand AUCUNE ligne ne
--    porte le booking, l'entrée de file est close en 'failed' avec un motif explicite, jamais 'done'.
--    Le cas « ligne trouvée » (done + entrée de réconciliation) ne change pas.
-- ════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.resolve_pms_cancellation_restricted(p_entry_id uuid, p_lobby_status_code integer, p_error text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_pms_booking_id text;
  v_establishment_id uuid;
  v_line_id uuid;
  v_order_id uuid;
  v_reference text;
begin
  select q.pms_booking_id, q.establishment_id into v_pms_booking_id, v_establishment_id
    from public.pms_cancellation_queue q where q.id = p_entry_id;
  if not found then
    return;
  end if;

  select ol.id, ol.order_id, o.reference into v_line_id, v_order_id, v_reference
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
    join public.orders o on o.id = ol.order_id
   where ol.pms_booking_id = v_pms_booking_id
     and p.establishment_id = v_establishment_id
   order by ol.date, ol.id
   limit 1;
  if v_order_id is not null then
    perform 1 from public.orders where id = v_order_id for update;
  end if;

  update public.pms_cancellation_queue
     -- Migration 20261023150000 : aucune ligne hifago ne porte le booking → jamais close en silence.
     set status = case when v_line_id is null then 'failed' else 'done' end,
         lobby_status_code = p_lobby_status_code,
         last_error = case
           when v_line_id is null then
             coalesce(p_lobby_status_code::text || ' ', '') || 'RESTRICTED_RESERVATION — aucune ligne hifago ne porte le booking '
               || v_pms_booking_id || ' : annulation à vérifier à la main dans Lobby'
           else p_error
         end,
         processed_at = now()
   where id = p_entry_id;

  if v_line_id is not null then
    insert into public.pms_reconciliation_entries (order_line_id, detail)
    select v_line_id,
           'annuler à la main dans Lobby : le booking ' || v_pms_booking_id
             || ' porte un paiement (RESTRICTED_RESERVATION) — commande ' || v_reference
             || coalesce(' — ' || left(p_error, 300), '')
     where not exists (
       select 1
         from public.pms_reconciliation_entries r
         join public.order_lines ol2 on ol2.id = r.order_line_id
         join public.products p2 on p2.id = ol2.product_id
        where r.status in ('open', 'retrying')
          and ol2.pms_booking_id = v_pms_booking_id
          and p2.establishment_id = v_establishment_id
          and r.detail like 'annuler à la main dans Lobby : le booking %'
     );
  end if;
end;
$function$;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 5. admin_pms_booking_requests — la demande de chaque commande, pour l'écran de réconciliation
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- pms_booking_requests est RPC-only (aucun droit pour authenticated) : l'écran /admin/reconciliation
-- y lit, pour les commandes de ses entrées, quelle demande reprendre et dans quel état. Lecture admin
-- seule, sur le modèle d'admin_order_line_summaries (20260922140000).
create function public.admin_pms_booking_requests(p_order_ids uuid[])
returns table (
  request_id uuid,
  order_id uuid,
  status text,
  attempts int,
  last_error text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'admin_pms_booking_requests réservé au rôle admin' using errcode = '42501';
  end if;

  return query
  select r.id, r.order_id, r.status, r.attempts, r.last_error, r.updated_at
    from public.pms_booking_requests r
   where r.order_id = any(p_order_ids)
   order by r.order_id;
end;
$$;
revoke all on function public.admin_pms_booking_requests(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_pms_booking_requests(uuid[]) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 6. admin_resolve_pms_booking_request — la reprise d'une demande qu'un humain tient
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- Seule une demande `failed` ou `needs_human` se reprend (sinon not_resolvable, avec son statut :
-- jamais une demande en cours, jamais un second geste sur une demande close). Trois gestes :
--   retry   — failed/needs_human → pending, 0 tentative, due maintenant : le trigger de la file
--             appelle pms-book-paid-orders au commit (le cron la reprend sinon). PAR CE GESTE L'ADMIN
--             ATTESTE avoir vérifié chez Lobby qu'aucun booking n'existe pour ces nuits : le marqueur
--             de tentative des lignes réservées sans booking est effacé (sinon le claim refuserait
--             encore, attempt_unresolved). Les nuits restent tenues (« en vol ») : elles vont être
--             réservées. Les entrées de réconciliation restent ouvertes (l'issue n'est pas connue).
--   confirm — la réservation est résolue à la main (relogée, ou créée dans Lobby). p_bookings,
--             facultatif : [{"order_line_id": "<uuid>", "pms_booking_id": "<id Lobby>"}, …] — lignes
--             de CETTE commande, réservées, liées à Lobby ; chaque id est posé par le chemin de
--             record_pms_booking (branche « ligne vivante » : pms_booked_at jamais antérieur à
--             l'époque du jeton, pms_recorded_at = l'heure réelle, miroir invalidé en best-effort) ;
--             une ligne qui porte déjà CE booking est idempotente, un AUTRE est refusé (I1, jamais
--             écrasé). Les nuits PMS restées sans booking (relogées hors Lobby) ne sont plus tenues ni
--             marquées : elles ne comptent plus « en vol ». La demande passe `done`, puis
--             notify_order_confirmed envoie les e-mails 5/6/7/8 — une fois : notification_emails les
--             dédoublonne, et un second confirm est refusé (not_resolvable).
--   cancel  — rien ne partira chez Lobby : la demande passe `cancelled` (son erreur gardée), les
--             lignes sans booking ne sont plus tenues ni marquées. N'annule AUCUNE ligne
--             (set_order_line_status) et ne rembourse rien (remboursements suspendus).
-- confirm et cancel résolvent aussi les entrées de réconciliation OUVERTES des lignes de la commande
-- nées de cette demande (« commande PAYÉE … », « … issue inconnue … », « remise à saisir … ») — jamais
-- une entrée « jeton Lobby remplacé », ni celles des activités ou d'une annulation refusée. Dans les
-- deux cas pms_confirmation n'est plus 'failed' (ni 'pending' : la demande n'est plus en cours).
-- Refus métier rendus (ok:false, reason), toute validation AVANT la première écriture ; une action
-- inconnue, ou des bookings hors confirm, sont des erreurs d'appelant et lèvent. Une ligne d'audit_log
-- par geste réussi (action « pms_booking_request.<geste> », cible la demande).
create function public.admin_resolve_pms_booking_request(
  p_request_id uuid,
  p_action text,
  p_bookings jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Un id de booking Lobby est l'entier que rend POST /bookings (parseLobbyBookingResponse), stocké en
  -- texte : un id saisi à la main doit lui ressembler. Un id mal recopié serait interrogé par le poll,
  -- déclaré introuvable chez Lobby, et la ligne annulée comme « disparue ».
  c_booking_id constant text := '^[0-9]{1,20}$';
  c_uuid constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_order_id uuid;
  v_reference text;
  v_request record;
  v_item jsonb;
  v_bookings jsonb := '[]'::jsonb;
  v_booking_line_ids uuid[] := '{}'::uuid[];
  v_line record;
  v_recorded jsonb := '[]'::jsonb;
  v_released uuid[] := '{}'::uuid[];
  v_cleared uuid[] := '{}'::uuid[];
  v_entries uuid[] := '{}'::uuid[];
  v_status text;
  v_note text;
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'admin_resolve_pms_booking_request réservé au rôle admin' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('retry', 'confirm', 'cancel') then
    raise exception 'admin_resolve_pms_booking_request : action invalide %', p_action;
  end if;
  if p_bookings is not null and p_action <> 'confirm' then
    raise exception 'admin_resolve_pms_booking_request : des bookings n''accompagnent que confirm (action %)', p_action;
  end if;

  select r.order_id into v_order_id from public.pms_booking_requests r where r.id = p_request_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'request_not_found');
  end if;

  -- Règle 8 : `orders` d'abord, puis la demande, relue sous son verrou.
  select o.reference into v_reference from public.orders o where o.id = v_order_id for update;

  select r.status, r.attempts, r.last_error into v_request
    from public.pms_booking_requests r
   where r.id = p_request_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'request_not_found');
  end if;
  if v_request.status not in ('failed', 'needs_human') then
    return jsonb_build_object('ok', false, 'reason', 'not_resolvable', 'status', v_request.status);
  end if;

  -- Les bookings saisis : leur forme d'abord (un tableau d'objets, un uuid de ligne, un id Lobby
  -- numérique, une ligne une seule fois).
  if p_bookings is not null then
    if jsonb_typeof(p_bookings) <> 'array' then
      return jsonb_build_object('ok', false, 'reason', 'invalid_bookings');
    end if;
    for v_item in select b.value from jsonb_array_elements(p_bookings) b loop
      if jsonb_typeof(v_item) <> 'object'
         or jsonb_typeof(v_item -> 'order_line_id') is distinct from 'string'
         or jsonb_typeof(v_item -> 'pms_booking_id') is distinct from 'string'
         or not ((v_item ->> 'order_line_id') ~ c_uuid)
         or not (btrim(v_item ->> 'pms_booking_id') ~ c_booking_id) then
        return jsonb_build_object('ok', false, 'reason', 'invalid_bookings');
      end if;
      if (v_item ->> 'order_line_id')::uuid = any(v_booking_line_ids) then
        -- Deux bookings pour une même ligne : refusé plutôt que choisi.
        return jsonb_build_object('ok', false, 'reason', 'invalid_bookings');
      end if;
      v_booking_line_ids := v_booking_line_ids || (v_item ->> 'order_line_id')::uuid;
      v_bookings := v_bookings || jsonb_build_array(jsonb_build_object(
        'order_line_id', (v_item ->> 'order_line_id')::uuid,
        'pms_booking_id', btrim(v_item ->> 'pms_booking_id')));
    end loop;
  end if;

  -- Les établissements des lignes qui reçoivent un booking, `for share`, AVANT ces lignes (ordre de
  -- record_pms_booking : un remplacement de jeton en cours est attendu, son époque relue après lui).
  if cardinality(v_booking_line_ids) > 0 then
    perform 1
      from public.establishments e
     where e.id in (
       select p.establishment_id
         from public.order_lines ol
         join public.products p on p.id = ol.product_id
        where ol.order_id = v_order_id and ol.id = any(v_booking_line_ids)
     )
     order by e.id
     for share;
  end if;

  -- Puis les lignes que ce geste peut écrire, par id : celles sans booking, celles des bookings saisis.
  perform 1
    from public.order_lines ol
   where ol.order_id = v_order_id
     and (ol.pms_booking_id is null or ol.id = any(v_booking_line_ids))
   order by ol.id
   for update;

  -- Les lignes des bookings saisis, relues sous verrou — toute validation avant la première écriture.
  for v_item in select b.value from jsonb_array_elements(v_bookings) b loop
    select ol.status, ol.pms_booking_id, p.type, p.lobby_category_id, p.lobby_product_id into v_line
      from public.order_lines ol
      join public.products p on p.id = ol.product_id
     where ol.id = (v_item ->> 'order_line_id')::uuid and ol.order_id = v_order_id;
    if not found then
      return jsonb_build_object('ok', false, 'reason', 'line_not_in_order', 'order_line_id', v_item -> 'order_line_id');
    end if;
    if v_line.pms_booking_id is not null and v_line.pms_booking_id <> v_item ->> 'pms_booking_id' then
      -- I1 : la ligne porte déjà un AUTRE booking — jamais écrasé.
      return jsonb_build_object('ok', false, 'reason', 'already_booked', 'order_line_id', v_item -> 'order_line_id',
                                'pms_booking_id', v_line.pms_booking_id);
    end if;
    if v_line.pms_booking_id is null and v_line.status <> 'reserved' then
      return jsonb_build_object('ok', false, 'reason', 'line_not_reserved', 'order_line_id', v_item -> 'order_line_id',
                                'status', v_line.status);
    end if;
    -- Une ligne liée à Lobby (le prédicat des groupes de claim_paid_order_for_pms_booking).
    if not ((v_line.type = 'lodging' and v_line.lobby_category_id is not null)
            or (v_line.type in ('activity', 'transport') and v_line.lobby_product_id is not null)) then
      return jsonb_build_object('ok', false, 'reason', 'line_not_pms', 'order_line_id', v_item -> 'order_line_id');
    end if;
  end loop;

  if p_action = 'retry' then
    with cleared as (
      update public.order_lines ol
         set pms_attempt_started_at = null
       where ol.order_id = v_order_id
         and ol.status = 'reserved'
         and ol.pms_booking_id is null
         and ol.pms_attempt_started_at is not null
      returning ol.id
    )
    select coalesce(array_agg(c.id order by c.id), '{}'::uuid[]) into v_cleared from cleared c;

    update public.pms_booking_requests
       set status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null,
           processed_at = null, updated_at = now()
     where id = p_request_id;
    v_status := 'pending';
    v_note := 'relance vers Lobby — l''admin atteste avoir vérifié chez Lobby qu''aucun booking n''existe pour la commande '
              || coalesce(v_reference, v_order_id::text);

  elsif p_action = 'confirm' then
    -- (a) Les bookings saisis — branche « ligne vivante » de record_pms_booking.
    for v_item in select b.value from jsonb_array_elements(v_bookings) b order by b.value ->> 'order_line_id' loop
      select ol.pms_booking_id, ol.end_date, e.lobby_token_changed_at into v_line
        from public.order_lines ol
        join public.products p on p.id = ol.product_id
        join public.establishments e on e.id = p.establishment_id
       where ol.id = (v_item ->> 'order_line_id')::uuid;
      if v_line.pms_booking_id is null then
        update public.order_lines
           -- Saisi par l'admin, sans jeton lu : le booking appartient au compte Lobby COURANT, jamais
           -- « ancien » (coalesce(pms_booked_at, created_at) < lobby_token_changed_at le rendrait
           -- invisible au poll et aux annulations). GREATEST ignore une époque nulle.
           set pms_booking_id = v_item ->> 'pms_booking_id',
               pms_booked_at = greatest(now(), v_line.lobby_token_changed_at + interval '1 microsecond'),
               pms_recorded_at = clock_timestamp()
         where id = (v_item ->> 'order_line_id')::uuid;
        v_recorded := v_recorded || jsonb_build_array(v_item);
        -- Best-effort, comme record_pms_booking : un échec retarde le reflet du miroir, il ne fait
        -- jamais échouer la reprise.
        if v_line.end_date is not null then
          begin
            perform public.mark_pms_sync_due_for_order_line((v_item ->> 'order_line_id')::uuid);
          exception when others then
            raise warning 'admin_resolve_pms_booking_request : invalidation du miroir impossible (%) — reflet retardé', sqlerrm;
          end;
        end if;
      end if;
    end loop;

    -- (b) Les nuits PMS restées sans booking (relogées hors Lobby) : plus tenues, plus marquées.
    with released as (
      update public.order_lines ol
         set pms_held_at = null, pms_attempt_started_at = null
        from public.products p
       where p.id = ol.product_id
         and ol.order_id = v_order_id
         and ol.status = 'reserved'
         and ol.pms_booking_id is null
         and p.type = 'lodging' and p.lobby_category_id is not null
         and (ol.pms_held_at is not null or ol.pms_attempt_started_at is not null)
      returning ol.id
    )
    select coalesce(array_agg(r.id order by r.id), '{}'::uuid[]) into v_released from released r;

    -- (c) La demande close, son erreur gardée (pourquoi un humain l'a tenue).
    update public.pms_booking_requests
       set status = 'done', processed_at = now(), updated_at = now()
     where id = p_request_id;
    v_status := 'done';
    v_note := 'réservation résolue à la main (relogée, ou booking saisi dans Lobby) — e-mails de confirmation envoyés, commande '
              || coalesce(v_reference, v_order_id::text);

  else
    -- cancel : les lignes sans booking ne sont plus tenues ni marquées ; aucune n'est annulée.
    with released as (
      update public.order_lines ol
         set pms_held_at = null, pms_attempt_started_at = null
       where ol.order_id = v_order_id
         and ol.pms_booking_id is null
         and (ol.pms_held_at is not null or ol.pms_attempt_started_at is not null)
      returning ol.id
    )
    select coalesce(array_agg(r.id order by r.id), '{}'::uuid[]) into v_released from released r;

    update public.pms_booking_requests
       set status = 'cancelled', processed_at = now(), updated_at = now()
     where id = p_request_id;
    v_status := 'cancelled';
    v_note := 'demande annulée : rien ne part chez Lobby — aucune ligne annulée, aucun remboursement, commande '
              || coalesce(v_reference, v_order_id::text);
  end if;

  -- Les entrées de réconciliation nées de cette demande, résolues avec elle (confirm, cancel).
  if p_action in ('confirm', 'cancel') then
    with resolved as (
      update public.pms_reconciliation_entries e
         set status = 'resolved',
             resolution_note = 'résolue par ' || p_action || ' de la demande ' || p_request_id::text
                               || ' (reprise admin, commande ' || coalesce(v_reference, v_order_id::text) || ')',
             resolved_by = (select auth.uid()),
             resolved_at = now()
       where e.status in ('open', 'retrying')
         and e.order_line_id in (select ol.id from public.order_lines ol where ol.order_id = v_order_id)
         and coalesce(e.detail, '') not like 'jeton Lobby remplacé%'
         and (coalesce(e.detail, '') like 'commande PAYÉE%'
              or strpos(coalesce(e.detail, ''), 'issue inconnue') > 0
              or strpos(coalesce(e.detail, ''), 'remise à saisir') > 0)
      returning e.id
    )
    select coalesce(array_agg(r.id order by r.id), '{}'::uuid[]) into v_entries from resolved r;
  end if;

  -- Les e-mails 5/6/7/8 différés jusqu'ici — isolés (spec 23 §8.1) : une notification ne fait jamais
  -- échouer la reprise. notify_order_confirmed n'envoie rien pour une commande qui n'est pas `paid`.
  if p_action = 'confirm' then
    begin
      perform public.notify_order_confirmed(v_order_id);
    exception
      when query_canceled then
        raise warning 'admin_resolve_pms_booking_request: notifications annulées (query_canceled) pour commande % — %', v_order_id, sqlerrm;
      when others then
        raise warning 'admin_resolve_pms_booking_request: échec des notifications pour commande % — %', v_order_id, sqlerrm;
    end;
  end if;

  perform public.log_admin_action(
    'pms_booking_request.' || p_action,
    'pms_booking_requests',
    p_request_id,
    jsonb_build_object('status', v_request.status, 'attempts', v_request.attempts, 'last_error', v_request.last_error),
    jsonb_build_object('status', v_status, 'order_id', v_order_id, 'bookings', v_recorded,
                       'lines_released', to_jsonb(v_released), 'markers_cleared', to_jsonb(v_cleared),
                       'entries_resolved', to_jsonb(v_entries)),
    v_note
  );

  return jsonb_build_object(
    'ok', true,
    'status', v_status,
    'bookings_recorded', jsonb_array_length(v_recorded),
    'lines_released', cardinality(v_released),
    'markers_cleared', cardinality(v_cleared),
    'entries_resolved', cardinality(v_entries)
  );
end;
$$;
revoke all on function public.admin_resolve_pms_booking_request(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.admin_resolve_pms_booking_request(uuid, text, jsonb) to authenticated;

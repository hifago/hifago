-- Lobby APRÈS l'acompte (décision de Gabriel, 2026-10-23) — la réservation LobbyPMS d'une nuit
-- n'est plus écrite avant le paiement mais après l'acompte encaissé.
--
-- POURQUOI. Jusqu'ici : create_order → /api/pms/reserve-nights (POST /bookings chez Lobby, bail
-- claim_order_for_pms_booking) → paiement. Trois défauts : un paiement refusé laissait un booking
-- vivant chez le partenaire ; l'e-mail 8 « Reserva confirmada — recurso bloqueado » partait de
-- create_order, avant tout paiement ; le booking ne portait pas l'acompte.
--
-- LE NOUVEAU FLUX (tout est ici sauf l'appel réseau, écrit par la route check-nights et l'Edge
-- Function pms-book-paid-orders) :
--   1. check-nights LIT Lobby à chaud (get_pms_check_payload), puis hold_pms_nights TIENT les nuits
--      sous un verrou de catégorie : dispo lue − nuits « en vol » des autres commandes ≥ demandé ;
--   2. create_payment_intent accepte une nuit tenue depuis moins de 5 min (D3) ;
--   3. apply_payment_webhook (approved) passe la commande à paid et pose UNE demande
--      pms_booking_requests ; les e-mails de confirmation attendent le booking (D4) ;
--   4. pms-book-paid-orders : claim_pms_booking_requests → claim_paid_order_for_pms_booking →
--      POST /bookings (avec le paiement) → record_pms_booking → resolve_pms_booking_request ;
--   5. Lobby refuse alors que le client a payé → demande `failed`, entrée « commande PAYÉE » dans
--      pms_reconciliation_entries (son trigger envoie l'e-mail admin 3). AUCUN remboursement
--      automatique (les remboursements sont suspendus).
--
-- COMPATIBILITÉ avec le code en production (cette migration part AVANT le déploiement du code) :
-- purement additive. claim_order_for_pms_booking et release_order_after_pms_refusal ne bougent
-- pas ; aucune signature publique ne change. L'ancien flux (booking avant paiement) arrive au
-- webhook avec ses nuits bookées : aucune demande n'est posée, les e-mails partent comme avant —
-- sauf le 8, désormais à la confirmation du paiement au lieu de la création (le correctif voulu).
-- ⚠️ Déployer l'Edge Function pms-book-paid-orders AVANT ou juste après cette migration : le cron
-- `pms-book-paid-orders` est posé ici et job_expectations alerte au bout de 10 min sans passage.
--
-- ORDRE DES VERROUS (règle 8 de .claude/rules/supabase.md) : `orders` d'abord, partout. Puis, dans
-- hold_pms_nights seulement, pms_category_locks triés (établissement, catégorie), puis les lignes de
-- la commande par id. Aucune autre fonction ne prend pms_category_locks.
--
-- Grants : toute fonction neuve est fermée à public, anon et authenticated (PostgreSQL accorde
-- EXECUTE à PUBLIC par défaut, et ce projet l'accorde aussi à anon/authenticated) ; service_role
-- pour celles qu'appellent la route ou l'Edge Function ; les helpers internes (notify_*) à personne
-- (appelés en propriétaire par d'autres fonctions SECURITY DEFINER). service_role_only_functions
-- .test.sql les nomme.

-- Attente bornée : la migration échoue plutôt que de bloquer orders/order_lines en production
-- derrière une longue transaction (même posture que 20261004005336).
select set_config('lock_timeout', '5s', true);

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 1. Colonnes
-- ════════════════════════════════════════════════════════════════════════════════════════════
alter table public.orders add column pms_checked_at timestamptz;
comment on column public.orders.pms_checked_at is
  'Dernière vérification Lobby réussie de la commande (hold_pms_nights, migration 20261023120000).';

alter table public.order_lines add column pms_held_at timestamptz;
comment on column public.order_lines.pms_held_at is
  'Nuit PMS TENUE par hold_pms_nights (Lobby lu à chaud, place comptée « en vol » pour les autres commandes) — migration 20261023120000. create_payment_intent exige moins de 5 min.';
alter table public.order_lines add column pms_recorded_at timestamptz;
comment on column public.order_lines.pms_recorded_at is
  'Heure RÉELLE (clock_timestamp) de l''enregistrement du booking par record_pms_booking — migration 20261023120000. Ne pas confondre avec pms_booked_at, l''heure du CLAIM, repère d''époque du jeton Lobby.';
-- Aucun grant de colonne : order_lines n'a aucun SELECT pour anon/authenticated (20260922210000) ;
-- orders.pms_checked_at suit le grant de table d'orders (RLS : sa propre commande), sans enjeu.

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 2. pms_booking_requests — la file des commandes PAYÉES à réserver chez Lobby (RPC-only)
-- ════════════════════════════════════════════════════════════════════════════════════════════
create table public.pms_booking_requests (
  id uuid primary key default gen_random_uuid(),
  -- UNE demande par commande : un webhook en double ne peut pas en poser deux. Cascade : aucune
  -- commande n'est supprimée en production ; les nettoyages de tests suppriment des commandes.
  order_id uuid not null unique references public.orders(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'done', 'failed', 'needs_human', 'cancelled')),
  attempts int not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz
);
comment on table public.pms_booking_requests is
  'Commandes PAYÉES dont une nuit PMS attend son booking Lobby (migration 20261023120000). Écrite par apply_payment_webhook ; traitée par pms-book-paid-orders via claim_pms_booking_requests / resolve_pms_booking_request. RPC-only.';
create index pms_booking_requests_pending_idx on public.pms_booking_requests (next_attempt_at)
  where status = 'pending';
alter table public.pms_booking_requests enable row level security;
-- RPC-only (CLAUDE.md §3.1) : aucune policy, aucun droit pour anon/authenticated. service_role garde
-- les droits par défaut du projet, comme pms_cancellation_queue.
revoke all on table public.pms_booking_requests from anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 3. pms_category_locks — le verrou anti-survente d'une catégorie Lobby (RPC-only)
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- Une ligne par (établissement, catégorie Lobby), matérialisée à la demande par hold_pms_nights
-- (`insert … on conflict do nothing`) puis prise `for update`. Elle ne porte AUCUN compteur : la
-- disponibilité vient de Lobby (lue à chaud), le verrou sérialise seulement les décisions de tenue
-- d'une même catégorie — c'est lui qui garantit qu'une seconde tenue voit la première.
create table public.pms_category_locks (
  establishment_id uuid not null references public.establishments(id) on delete cascade,
  -- Même type que products.lobby_category_id.
  lobby_category_id integer not null,
  created_at timestamptz not null default now(),
  primary key (establishment_id, lobby_category_id)
);
comment on table public.pms_category_locks is
  'Verrou de tenue d''une catégorie Lobby (hold_pms_nights, migration 20261023120000) : sérialise les décisions, ne compte rien. RPC-only.';
alter table public.pms_category_locks enable row level security;
revoke all on table public.pms_category_locks from anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 4. record_pms_booking — redéfinie depuis la vivante (20261006235357), remplacement compté :
--    SEUL changement, pms_recorded_at = clock_timestamp() dans les DEUX UPDATE qui posent le
--    booking. pms_booked_at garde l'heure du claim (époque du jeton, inchangée).
-- ════════════════════════════════════════════════════════════════════════════════════════════
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
    update public.order_lines set pms_booking_id = p_pms_booking_id, pms_booked_at = p_claimed_at, pms_recorded_at = clock_timestamp() where id = p_order_line_id;
    v_reason := 'line_not_reserved';
    v_queue_status := v_line.status;
  else
    update public.order_lines set pms_booking_id = p_pms_booking_id, pms_booked_at = p_claimed_at, pms_recorded_at = clock_timestamp() where id = p_order_line_id;
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
  -- Jamais délégué au seul trigger enqueue_pms_cancellations : pour un booking surnuméraire
  -- (claim_stale, already_booked), aucune ligne n'est mise à jour et le trigger ne part pas.
  -- L'entrée attend la réactivation d'un connecteur coupé (claim_pms_cancellation_batch ne prend
  -- que les établissements actifs) ; si le trigger l'a déjà posée (line_not_reserved), l'index
  -- partiel absorbe le doublon. Migration 20261006235357 : un booking, c'est un numéro DANS un
  -- établissement — les lignes vivantes et l'index se lisent sur les deux.
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
         join public.products p on p.id = ol.product_id
        where ol.pms_booking_id = p_pms_booking_id and p.establishment_id = v_line.establishment_id
          and ol.status = 'reserved'
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
         join public.products p on p.id = ol.product_id
        where ol.pms_booking_id = p_pms_booking_id and p.establishment_id = v_line.establishment_id
          and ol.status = 'reserved'
     )
    on conflict (pms_booking_id, establishment_id) where status = 'pending' do nothing;
  end if;

  return jsonb_build_object('ok', false, 'reason', v_reason);
end;
$function$;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 5. get_pms_check_payload — ce que check-nights doit lire chez Lobby (sans verrou ni bail)
-- ════════════════════════════════════════════════════════════════════════════════════════════
create function public.get_pms_check_payload(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_payment_status text;
  v_groups jsonb;
begin
  if p_order_id is null then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  select o.payment_status into v_payment_status from public.orders o where o.id = p_order_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;
  -- Même règle que claim_order_for_pms_booking (I3) et hold_pms_nights : une commande payée ne se
  -- revérifie pas, ses nuits sont réservées par pms-book-paid-orders.
  if v_payment_status in ('paid', 'partially_refunded', 'refunded') then
    return jsonb_build_object('ok', false, 'reason', 'order_paid');
  end if;
  if not exists (
    select 1 from public.order_lines ol where ol.order_id = p_order_id and ol.status = 'reserved'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'order_not_active');
  end if;

  -- CLAUDE.md §4.4 : connecteur coupé ou sans jeton → aucune lecture possible, refus (même prédicat
  -- que create_order et claim_order_for_pms_booking).
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

  -- Les nuits PMS-backed sans booking, groupées par établissement (un jeton chacun).
  select coalesce(jsonb_agg(g.grp order by g.establishment_id), '[]'::jsonb)
    into v_groups
    from (
      select e.id as establishment_id,
             jsonb_build_object(
               'establishment_id', e.id,
               'api_token', e.lobby_api_token,
               'lines', jsonb_agg(jsonb_build_object(
                   'id', ol.id, 'lobby_category_id', p.lobby_category_id, 'date', ol.date,
                   'end_date', ol.end_date, 'qty', ol.qty
                 ) order by ol.id)
             ) as grp
        from public.order_lines ol
        join public.products p on p.id = ol.product_id
        join public.establishments e on e.id = p.establishment_id
       where ol.order_id = p_order_id
         and ol.status = 'reserved'
         and ol.pms_booking_id is null
         and p.type = 'lodging' and p.lobby_category_id is not null
       group by e.id, e.lobby_api_token
    ) g;

  return jsonb_build_object('ok', true, 'groups', v_groups);
end;
$$;
-- Renvoie le JETON LOBBY en clair : service_role seul (route check-nights).
revoke all on function public.get_pms_check_payload(uuid) from public, anon, authenticated;
grant execute on function public.get_pms_check_payload(uuid) to service_role;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 6. hold_pms_nights — LA RPC anti-survente du nouveau flux (squelette docs/05 §1/§1bis)
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- Appelée par check-nights APRÈS sa lecture à chaud de Lobby, en UN aller-retour. p_snapshot :
--   {"<establishment_id>": {"<lobby_category_id>": {"YYYY-MM-DD": <unités libres>, …}}}
-- (unités déjà converties en quantité hifago). p_read_at : l'instant pris AVANT l'envoi de la
-- lecture à Lobby, horloge de l'app.
--
-- RÈGLE (décision D2) — sous le verrou de (établissement, catégorie), pour chaque nuit [date,
-- end_date) de chaque ligne à tenir :
--     dispo lue(nuit) − Σ qty « en vol » des AUTRES commandes(nuit) ≥ Σ qty de CETTE commande(nuit)
-- « En vol » = ligne `reserved` d'une autre commande, même établissement, même catégorie, nuit
-- couverte, ET
--   (a) TENUE sans booking (pms_held_at non nul, pms_booking_id nul) : elle a passé ce contrôle et
--       sera réservée (ou l'est en ce moment même) — y compris une commande payée en attente de
--       l'Edge Function, ou dont la demande a échoué (un humain la tient, la place reste prise) ;
--   (b) ou bookée RÉCEMMENT : coalesce(pms_recorded_at, pms_booked_at) > p_read_at − 30 s.
-- Une ligne NON tenue (créée, pas encore vérifiée) ne compte PAS : sinon deux paniers concurrents
-- sur la dernière unité se refuseraient l'un l'autre. Les lignes mortes (expirées, annulées,
-- relâchées) ne comptent plus. Les lignes de la commande elle-même ne sont jamais « en vol » ; ses
-- lignes déjà bookées ne sont pas re-vérifiées.
--
-- CAS LIMITES (pourquoi (a) et (b) suffisent) :
--   - booking d'une commande A enregistré ENTRE la lecture de B et le verrou de B : la lecture ne le
--     reflète pas, et la ligne de A n'est plus « tenue sans booking ». (b) la compte : son
--     pms_recorded_at (heure réelle de record_pms_booking, POSTÉRIEURE au POST Lobby) est après la
--     lecture. La requête « en vol » s'exécute APRÈS les verrous ; en read committed elle voit donc
--     tout ce qui a commité pendant l'attente (garde d'isolation ci-dessous) ;
--   - lecture qui reflète DÉJÀ un booking enregistré moins de 30 s avant elle : compté deux fois
--     (lecture + en vol) — double comptage PRUDENT, un refus de trop, jamais une survente ;
--   - booking enregistré plus de 30 s avant la lecture : Lobby l'avait (le POST précède le record),
--     la lecture le reflète, il ne compte plus en vol ;
--   - dérive d'horloge app/base jusqu'à 30 s : couverte par la même marge (au-delà côté app en
--     avance, la lecture passe pour « future » et est refusée, stale_read) ;
--   - lignes expirées ou relâchées : leur statut n'est plus `reserved`, elles ne comptent plus.
-- Une nuit absente de la lecture = échec fermé (`not_quoted`), jamais « complet » ni « libre ».
-- ⚠️ Un booking que Lobby refuserait malgré tout (catégorie vendue ailleurs entre-temps) reste
-- possible : Lobby est l'arbitre final au POST, après paiement → réconciliation « commande PAYÉE ».
create function public.hold_pms_nights(p_order_id uuid, p_snapshot jsonb, p_read_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Marge de dérive d'horloge entre l'app (qui date p_read_at) et la base (qui date
  -- pms_recorded_at), et avance maximale tolérée d'une lecture sur la base.
  c_clock_drift constant interval := interval '30 seconds';
  -- Âge maximal d'une lecture Lobby au moment de tenir.
  c_max_read_age constant interval := interval '60 seconds';
  v_payment_status text;
  -- Les lignes à tenir, capturées UNE fois sous le verrou de la commande (tableaux parallèles).
  v_ids uuid[];
  v_establishments uuid[];
  v_categories int[];
  v_starts date[];
  v_ends date[];
  v_qtys int[];
  v_key record;
  v_fail jsonb;
begin
  -- La requête « en vol » doit voir ce qui a commité pendant l'attente des verrous : vrai en read
  -- committed (un instantané par instruction), faux en repeatable read / serializable (instantané
  -- figé au début) — refusé plutôt que décidé sur un état périmé.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'hold_pms_nights : isolation read committed requise (actuelle : %)',
      current_setting('transaction_isolation');
  end if;

  if p_order_id is null then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  -- (1) Règle 8 : `orders` d'abord. Tous les écrivains de ses lignes le prennent aussi : sous ce
  -- verrou, l'ensemble des lignes de la commande ne bouge plus.
  select o.payment_status into v_payment_status
    from public.orders o
   where o.id = p_order_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;
  if v_payment_status in ('paid', 'partially_refunded', 'refunded') then
    return jsonb_build_object('ok', false, 'reason', 'order_paid');
  end if;
  if not exists (
    select 1 from public.order_lines ol where ol.order_id = p_order_id and ol.status = 'reserved'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'order_not_active');
  end if;

  if p_read_at is null
     or p_read_at < now() - c_max_read_age
     or p_read_at > now() + c_clock_drift then
    return jsonb_build_object('ok', false, 'reason', 'stale_read', 'read_at', p_read_at, 'db_now', now());
  end if;

  select coalesce(array_agg(ol.id order by ol.id), '{}'::uuid[]),
         coalesce(array_agg(p.establishment_id order by ol.id), '{}'::uuid[]),
         coalesce(array_agg(p.lobby_category_id order by ol.id), '{}'::int[]),
         coalesce(array_agg(ol.date order by ol.id), '{}'::date[]),
         coalesce(array_agg(ol.end_date order by ol.id), '{}'::date[]),
         coalesce(array_agg(ol.qty order by ol.id), '{}'::int[])
    into v_ids, v_establishments, v_categories, v_starts, v_ends, v_qtys
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
   where ol.order_id = p_order_id
     and ol.status = 'reserved'
     and ol.pms_booking_id is null
     and p.type = 'lodging' and p.lobby_category_id is not null;

  if cardinality(v_ids) = 0 then
    -- Rien à tenir (aucune nuit PMS sans booking) : vérifiée, trivialement.
    update public.orders set pms_checked_at = now() where id = p_order_id;
    return jsonb_build_object('ok', true, 'held_lines', 0, 'checked_at', now());
  end if;

  -- CLAUDE.md §4.4 : un connecteur coupé (ou un jeton retiré) depuis la lecture → refus, rien n'est
  -- tenu sur une lecture qu'on ne pourrait plus honorer.
  if exists (
    select 1 from public.establishments e
     where e.id = any(v_establishments)
       and (not e.lobby_connector_active or e.lobby_api_token is null)
  ) then
    return jsonb_build_object('ok', false, 'reason', 'pms_unavailable');
  end if;

  -- (2) Les verrous de catégorie, dans l'ordre global (établissement, catégorie) : deux tenues
  -- multi-catégories ne s'interbloquent jamais. Chaque ligne de verrou est matérialisée au besoin
  -- (une insertion concurrente de la même clé attend la première, puis ne fait rien), puis prise.
  for v_key in
    select distinct k.establishment_id, k.lobby_category_id
      from unnest(v_establishments, v_categories) as k(establishment_id, lobby_category_id)
     order by k.establishment_id, k.lobby_category_id
  loop
    insert into public.pms_category_locks (establishment_id, lobby_category_id)
    values (v_key.establishment_id, v_key.lobby_category_id)
    on conflict (establishment_id, lobby_category_id) do nothing;

    perform 1
      from public.pms_category_locks l
     where l.establishment_id = v_key.establishment_id
       and l.lobby_category_id = v_key.lobby_category_id
       for update;
    if not found then
      raise exception 'hold_pms_nights : verrou de catégorie introuvable (%, %)',
        v_key.establishment_id, v_key.lobby_category_id;
    end if;
  end loop;

  -- (3) Les lignes de la commande, par id.
  perform 1 from public.order_lines ol where ol.id = any(v_ids) order by ol.id for update;

  -- (4) Décision — tout ce qui suit lit APRÈS les verrous.
  -- Une ligne sans plage exploitable n'a aucune nuit cotable : échec fermé, jamais ignorée.
  select jsonb_build_object('ok', false, 'reason', 'not_quoted', 'line_id', l.id, 'night', l.date_debut,
                            'invalid_range', true)
    into v_fail
    from unnest(v_ids, v_starts, v_ends) as l(id, date_debut, date_fin)
   where l.date_fin is null or l.date_fin <= l.date_debut
   order by l.id
   limit 1;
  if v_fail is not null then
    return v_fail;
  end if;

  with nuits as (
    select l.id, l.establishment_id, l.lobby_category_id, l.qty, n.nuit::date as night
      from unnest(v_ids, v_establishments, v_categories, v_starts, v_ends, v_qtys)
             as l(id, establishment_id, lobby_category_id, date_debut, date_fin, qty)
     cross join lateral generate_series(l.date_debut::timestamp, (l.date_fin - 1)::timestamp,
                                        interval '1 day') as n(nuit)
  ),
  demande as (
    -- Plusieurs lignes de la commande sur la même nuit s'additionnent.
    select d.establishment_id, d.lobby_category_id, d.night,
           sum(d.qty) as requested,
           (array_agg(d.id order by d.id))[1] as line_id
      from nuits d
     group by d.establishment_id, d.lobby_category_id, d.night
  ),
  cotation as (
    select d.*,
           p_snapshot -> d.establishment_id::text -> d.lobby_category_id::text
                      -> to_char(d.night, 'YYYY-MM-DD') as brut
      from demande d
  ),
  bilan as (
    select c.establishment_id, c.lobby_category_id, c.night, c.requested, c.line_id,
           -- Seul un entier positif ou nul est une cotation ; tout le reste vaut « non cotée ».
           -- CASE : le transtypage n'est évalué que sur un nombre.
           case
             when c.brut is null or jsonb_typeof(c.brut) <> 'number' then null
             when (c.brut)::numeric < 0 or (c.brut)::numeric <> trunc((c.brut)::numeric) then null
             else (c.brut)::numeric
           end as available,
           (select coalesce(sum(o2.qty), 0)
              from public.order_lines o2
              join public.products p2 on p2.id = o2.product_id
             where p2.establishment_id = c.establishment_id
               and p2.lobby_category_id = c.lobby_category_id
               and p2.type = 'lodging'
               and o2.order_id <> p_order_id
               and o2.status = 'reserved'
               and o2.date <= c.night and o2.end_date > c.night
               and ((o2.pms_held_at is not null and o2.pms_booking_id is null)
                    or (o2.pms_booking_id is not null
                        and coalesce(o2.pms_recorded_at, o2.pms_booked_at) > p_read_at - c_clock_drift))
           ) as in_flight
      from cotation c
  )
  select case
           when b.available is null then
             jsonb_build_object('ok', false, 'reason', 'not_quoted', 'line_id', b.line_id, 'night', b.night,
                                'lobby_category_id', b.lobby_category_id)
           else
             jsonb_build_object('ok', false, 'reason', 'full', 'line_id', b.line_id, 'night', b.night,
                                'available', b.available, 'in_flight', b.in_flight,
                                'requested', b.requested, 'lobby_category_id', b.lobby_category_id)
         end
    into v_fail
    from bilan b
   where b.available is null or b.available - b.in_flight < b.requested
   -- Une nuit non cotée d'abord (échec fermé), puis la première nuit complète, dans l'ordre global.
   order by (b.available is not null), b.establishment_id, b.lobby_category_id, b.night
   limit 1;
  if v_fail is not null then
    return v_fail;
  end if;

  -- (5) Une seule phase d'écriture.
  update public.order_lines set pms_held_at = now() where id = any(v_ids);
  update public.orders set pms_checked_at = now() where id = p_order_id;
  return jsonb_build_object('ok', true, 'held_lines', cardinality(v_ids), 'checked_at', now());
end;
$$;
revoke all on function public.hold_pms_nights(uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.hold_pms_nights(uuid, jsonb, timestamptz) to service_role;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 7. Les e-mails de confirmation, sortis de create_order (8) et d'apply_payment_webhook (5/6/7)
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- E-mail 8 « Reserva confirmada — recurso bloqueado », REPRIS TEL QUEL du bloc de create_order
-- (20261019180000) : même sujet, même corps échappé, related ('order_lines', ligne), une fois par
-- compte du partenaire propriétaire, pour chaque ligne camp ou evento réservable qui occupe la
-- ressource (le prédicat du blocage de create_order). Lignes vivantes (`reserved`) seulement : une
-- ligne annulée entre la création et la confirmation n'est plus « réservée ». Dédoublonnage par
-- notification_emails_dedup_idx (un e-mail par ligne et par compte, quel que soit le nombre
-- d'appels). Aucune garde de paiement : appelée par notify_order_confirmed (commande payée et
-- confirmée) et par create_order quand rien n'est dû en ligne. INTERNE.
create function public.notify_partner_camp_evento_blocked(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line record;
  v_camp_partner_account record;
begin
  for v_line in
    select ol.id, ol.date, p.partner_id, p.name ->> 'es' as product_name, p.duration_days
      from public.order_lines ol
      join public.products p on p.id = ol.product_id
     where ol.order_id = p_order_id
       and ol.status = 'reserved'
       and (p.type = 'camp' or (p.type = 'evento' and p.online_bookable and p.evento_occupies_resource))
     order by ol.created_at, ol.id
  loop
    for v_camp_partner_account in
      select pa.id as account_id, au.email
        from public.partner_accounts pa
        join auth.users au on au.id = pa.id
       where pa.partner_id = v_line.partner_id
    loop
      begin
        perform public.enqueue_notification_email(
          'partner_camp_evento_blocked',
          v_camp_partner_account.email,
          v_camp_partner_account.account_id,
          'Reserva confirmada — recurso bloqueado',
          '<p>Se reservó "' || coalesce(public.html_text(v_line.product_name), 'tu producto') || '".</p>'
            || '<p>Período bloqueado: ' || v_line.date
            || ' a ' || (v_line.date + coalesce(v_line.duration_days, 1) - 1) || '.</p>'
            || '<p>Otras actividades que comparten este recurso pueden haber quedado no disponibles durante ese período.</p>',
          'order_lines', v_line.id
        );
      exception
        when query_canceled then
          raise warning 'notify_partner_camp_evento_blocked: notification camp annulée (query_canceled) pour compte % — %', v_camp_partner_account.account_id, sqlerrm;
        when others then
          raise warning 'notify_partner_camp_evento_blocked: échec notification camp pour compte % — %', v_camp_partner_account.account_id, sqlerrm;
      end;
    end loop;
  end loop;
end;
$$;
revoke all on function public.notify_partner_camp_evento_blocked(uuid) from public, anon, authenticated, service_role;

-- E-mails 5 (commission), 6 (paiement), 7 (client), EXTRAITS À L'IDENTIQUE d'apply_payment_webhook
-- (vivante 20261019170000) — corps, échappements html_text, WhatsApp des prestataires, lien du Vault ;
-- seules substitutions : la commande vient du paramètre, l'étiquette des avertissements nomme cette
-- fonction. Puis l'e-mail 8. Chaque envoi reste isolé dans son bloc (spec 23 §8.1). Sans effet sur une
-- commande qui n'est pas `paid`. Appelée par apply_payment_webhook (commande sans nuit PMS à réserver)
-- et par resolve_pms_booking_request ('done' : tous les bookings Lobby obtenus). INTERNE.
create function public.notify_order_confirmed(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_referrer_account record;
  v_owner_account record;
  v_order record;
  v_order_summary text;
  v_site_url text;
  v_contacts text;
begin
  if not exists (select 1 from public.orders o where o.id = p_order_id and o.payment_status = 'paid') then
    return;
  end if;

  -- (a) commission attribuée — un email par compte du/des référent(s) externe(s) distinct(s).
  for v_referrer_account in
    select distinct pa.id as account_id, au.email
      from public.order_lines ol
      join public.partner_accounts pa on pa.partner_id = ol.referrer_partner_id
      join auth.users au on au.id = pa.id
     where ol.order_id = p_order_id and ol.commission_case = 'external_referrer'
  loop
    begin
      perform public.enqueue_notification_email(
        'partner_commission_earned', v_referrer_account.email, v_referrer_account.account_id,
        'Nueva comisión asignada',
        '<p>Se te asignó una comisión por una reserva confirmada.</p>',
        'orders', p_order_id
      );
    exception
      when query_canceled then
        raise warning 'notify_order_confirmed: notification commission annulée (query_canceled) pour compte % — %', v_referrer_account.account_id, sqlerrm;
      when others then
        raise warning 'notify_order_confirmed: échec notification commission pour compte % — %', v_referrer_account.account_id, sqlerrm;
    end;
  end loop;

  -- (b) paiement effectué — un email par compte du/des partenaire(s) propriétaire(s) distinct(s)
  -- des produits commandés (spec 23 §10 point 8 : lecture retenue, à confirmer par Jérôme).
  for v_owner_account in
    select distinct pa.id as account_id, au.email
      from public.order_lines ol
      join public.products p on p.id = ol.product_id
      join public.partner_accounts pa on pa.partner_id = p.partner_id
      join auth.users au on au.id = pa.id
     where ol.order_id = p_order_id
  loop
    begin
      perform public.enqueue_notification_email(
        'partner_payment_confirmed', v_owner_account.email, v_owner_account.account_id,
        'Pago confirmado',
        '<p>Se confirmó el pago de una reserva en tu establecimiento.</p>',
        'orders', p_order_id
      );
    exception
      when query_canceled then
        raise warning 'notify_order_confirmed: notification paiement annulée (query_canceled) pour compte % — %', v_owner_account.account_id, sqlerrm;
      when others then
        raise warning 'notify_order_confirmed: échec notification paiement pour compte % — %', v_owner_account.account_id, sqlerrm;
    end;
  end loop;

  -- (c) confirmation de réservation au client — un seul email par commande.
  --
  -- ⚠️ SPEC 33 : CET EMAIL PORTE DÉSORMAIS LE NUMÉRO ET LE LIEN. Le commentaire qu'il remplace
  -- disait « lien vers /orders/[id]/status non ajouté en v1, à confirmer par Jérôme » — c'est
  -- confirmé et tranché (cahier client §2b.9, 2026-09-07) : l'adresse de la commande « part aussi
  -- dans l'email de confirmation, ce qui la rend retrouvable des mois plus tard ». Pour un client
  -- sans compte, cet email EST le canal de suivi : le WhatsApp pré-rempli a été retiré le même
  -- jour, et la zone tunnel n'a pas de pied de page.
  --
  -- ⚠️ L'URL publique du site vient du VAULT, comme `admin_app_public_url` pour l'email
  -- d'invitation partenaire (20260824040000) et `pms_functions_base_url` pour les crons
  -- (20260819140000). Une première version de la spec 33 avait inventé un jeton de gabarit
  -- `{{SITE_URL}}` résolu à l'envoi par l'Edge Function, en justifiant que « Postgres ne connaît
  -- pas l'URL publique du site » — c'était FAUX : ce dépôt a déjà ce mécanisme, pour exactement
  -- cette raison (« seedée par environnement, jamais une valeur en dur, elle diffère
  -- local/preprod/prod »). Deux patrons concurrents pour mettre un lien dans un email, c'est un
  -- de trop.
  --
  -- ⚠️ DIFFÉRENCE ASSUMÉE avec l'invitation partenaire : là-bas, un secret manquant fait SAUTER
  -- l'email (le lien reste affiché à l'écran, donc rien n'est perdu). Ici le client a PAYÉ et
  -- n'a plus l'écran sous les yeux : on envoie la confirmation dans tous les cas, avec le lien
  -- si le secret existe, sans lui sinon. Un email de confirmation sans lien reste utile ; pas
  -- d'email du tout ne l'est pas.
  begin
    select holder_name, holder_email, reference, access_token into v_order
      from public.orders where id = p_order_id;

    select decrypted_secret into v_site_url
      from vault.decrypted_secrets where name = 'web_app_public_url';
    if v_site_url is null then
      raise warning 'notify_order_confirmed: secret Vault web_app_public_url manquant — email de confirmation envoyé SANS lien vers la réserve (commande %)', p_order_id;
    end if;

    -- Migration 20261002160349 : valeurs venues des données échappées (html_text) — nom de
    -- produit, nom du titulaire, référence. Le sujet est du texte brut.
    select string_agg(
      '<li>' || coalesce(public.html_text(p.name ->> 'es'), 'Producto') || ' — ' || ol.date
        || coalesce(' a ' || ol.end_date, '') || ' — $' || ol.total_cop || ' COP</li>',
      ''
    ) into v_order_summary
    from public.order_lines ol join public.products p on p.id = ol.product_id
    where ol.order_id = p_order_id;

    -- 20261019170000 (décision Jérôme) : le WhatsApp de chaque prestataire de la commande, une
    -- fois par établissement — c'est ce numéro qui sert de contact pour tous ses services. Les
    -- lignes mortes n'en donnent pas : un service annulé ne justifie plus le contact.
    select string_agg(
      '<li>' || coalesce(public.html_text(c.name ->> 'es'), 'Prestador') || ' — <a href="https://wa.me/'
        || substr(c.contact_phone, 2) || '">' || public.html_text(c.contact_phone) || '</a></li>',
      '' order by c.name ->> 'es'
    ) into v_contacts
    from (
      select distinct e.id, e.name, e.contact_phone
        from public.order_lines ol
        join public.products p on p.id = ol.product_id
        join public.establishments e on e.id = p.establishment_id
       where ol.order_id = p_order_id and e.contact_phone is not null
         and ol.status not in ('cancelled_by_client', 'cancelled_by_provider', 'expired', 'superseded')
    ) c;

    perform public.enqueue_notification_email(
      'client_order_confirmed', v_order.holder_email, null,
      'Reserva ' || v_order.reference || ' confirmada',
      '<p>Hola ' || coalesce(public.html_text(v_order.holder_name), '') || ', tu reserva fue confirmada.</p>'
        || '<p>Número de reserva : <strong>' || public.html_text(v_order.reference) || '</strong></p>'
        || '<ul>' || coalesce(v_order_summary, '') || '</ul>'
        || coalesce('<p>Para coordinar tus servicios, escríbele directamente a tu prestador por WhatsApp:</p><ul>'
             || v_contacts || '</ul>', '')
        || coalesce(
             '<p><a href="' || v_site_url || '/reserva/' || v_order.access_token || '">'
               || 'Ver tu reserva</a> — guarda este enlace, puedes volver a abrirlo cuando quieras.</p>',
             ''
           ),
      'orders', p_order_id
    );
  exception
    when query_canceled then
      raise warning 'notify_order_confirmed: notification client annulée (query_canceled) pour commande % — %', p_order_id, sqlerrm;
    when others then
      raise warning 'notify_order_confirmed: échec notification client pour commande % — %', p_order_id, sqlerrm;
  end;

  -- (d) Migration 20261023120000 : l'e-mail 8, à la confirmation (cf. notify_partner_camp_evento_blocked).
  perform public.notify_partner_camp_evento_blocked(p_order_id);
end;
$$;
revoke all on function public.notify_order_confirmed(uuid) from public, anon, authenticated, service_role;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 8. claim_paid_order_for_pms_booking — miroir de claim_order_for_pms_booking, commandes PAYÉES
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- Même bail de 5 min (orders.pms_reserve_claimed_at, rendu par release_pms_reserve_claim), même
-- `for share` des établissements avant la lecture du jeton, même max(lobby_token_changed_at) + 1 µs,
-- même refus d'un connecteur coupé. Différences : refuse une commande NON payée (order_not_paid),
-- aucune échéance de paiement (l'acompte est encaissé), et la charge utile porte en plus, par nuit,
-- l'acompte (relu ici, jamais venu d'un client), le type de logement, l'unité et la capacité du
-- produit ; par établissement, primary_booking_id : le booking d'une nuit DÉJÀ réservée de la
-- commande (la plus ancienne, par date puis id), pour rattacher les activités restantes d'un second
-- passage. Un groupe d'activités seules est rendu comme avant (avec ou sans primary_booking_id) :
-- l'appelant ne vend jamais un service Lobby sans booking.
create function public.claim_paid_order_for_pms_booking(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_groups jsonb;
  v_claimed_at timestamptz;
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
$$;
-- Renvoie le JETON LOBBY en clair et pose le bail : service_role seul (pms-book-paid-orders).
revoke all on function public.claim_paid_order_for_pms_booking(uuid) from public, anon, authenticated;
grant execute on function public.claim_paid_order_for_pms_booking(uuid) to service_role;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 9. La file : résolution et réclamation
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- resolve_pms_booking_request — l'issue d'un passage de pms-book-paid-orders sur une demande :
--   'done'        → close, puis notify_order_confirmed (e-mails 5/6/7/8 différés jusqu'ici) ;
--   'retry'       → reste pending, nouvel essai dans p_retry_after (défaut 1 min, plancher 10 s) ;
--                   p_keep_attempt = false (bail occupé, budget épuisé, aucun appel parti) rend la
--                   tentative ; une tentative consommée qui atteint 6 → 'failed' ;
--   'failed'      → Lobby a refusé : entrée de réconciliation « commande PAYÉE — Lobby a refusé » ;
--   'needs_human' → issue inconnue (le booking a pu naître) : entrée « vérifier chez Lobby par la
--                   note « hifago order_line <id> » » ; jamais retentée ;
--   'cancelled'   → la commande n'est plus à réserver (remboursée, rejetée, lignes annulées).
-- L'entrée (une par demande, jamais un doublon ouvert sur la même ligne, une entrée muette « jeton
-- Lobby remplacé » mise à part) va sur p_order_line_id si c'est une ligne de la commande, sinon sur
-- sa première nuit PMS vivante sans booking (date, id), à défaut sa première ligne. Son trigger
-- envoie l'e-mail admin 3. AUCUN remboursement automatique. Une demande qui n'est plus `pending` :
-- no-op typé (rejeu, ou deux passages concurrents). Règle 8 : orders d'abord (l'entrée est une ligne
-- fille d'une commande), puis la demande.
create function public.resolve_pms_booking_request(
  p_request_id uuid,
  p_outcome text,
  p_error text default null,
  p_order_line_id uuid default null,
  p_retry_after interval default null,
  p_keep_attempt boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_attempts constant int := 6;
  c_default_retry constant interval := interval '1 minute';
  -- Jamais un nouvel essai immédiat : le trigger relancerait l'Edge Function en boucle.
  c_min_retry constant interval := interval '10 seconds';
  v_order_id uuid;
  v_reference text;
  v_request record;
  v_outcome text := p_outcome;
  v_error text := left(p_error, 500);
  v_line_id uuid;
  v_detail text;
begin
  if p_outcome is null or p_outcome not in ('done', 'retry', 'failed', 'needs_human', 'cancelled') then
    raise exception 'resolve_pms_booking_request : issue invalide %', p_outcome;
  end if;

  select r.order_id into v_order_id from public.pms_booking_requests r where r.id = p_request_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'request_not_found');
  end if;

  -- Règle 8 : `orders` d'abord.
  select o.reference into v_reference from public.orders o where o.id = v_order_id for update;

  select r.status, r.attempts into v_request
    from public.pms_booking_requests r
   where r.id = p_request_id
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'request_not_found');
  end if;
  if v_request.status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', 'not_pending', 'status', v_request.status);
  end if;

  if v_outcome = 'retry' then
    if not coalesce(p_keep_attempt, true) then
      update public.pms_booking_requests
         set attempts = greatest(attempts - 1, 0),
             next_attempt_at = now() + greatest(coalesce(p_retry_after, c_default_retry), c_min_retry),
             last_error = v_error, updated_at = now()
       where id = p_request_id;
      return jsonb_build_object('ok', true, 'status', 'pending');
    elsif v_request.attempts < c_max_attempts then
      update public.pms_booking_requests
         set next_attempt_at = now() + greatest(coalesce(p_retry_after, c_default_retry), c_min_retry),
             last_error = v_error, updated_at = now()
       where id = p_request_id;
      return jsonb_build_object('ok', true, 'status', 'pending');
    end if;
    -- Six tentatives consommées sans booking : on arrête, un humain prend la main.
    v_outcome := 'failed';
    v_error := left('aucun booking après ' || c_max_attempts || ' tentatives — dernière erreur : '
                    || coalesce(p_error, 'inconnue'), 500);
  end if;

  if v_outcome = 'done' then
    update public.pms_booking_requests
       set status = 'done', processed_at = now(), last_error = v_error, updated_at = now()
     where id = p_request_id;
    -- Isolé (spec 23 §8.1) : une notification ne fait jamais échouer la clôture.
    begin
      perform public.notify_order_confirmed(v_order_id);
    exception
      when query_canceled then
        raise warning 'resolve_pms_booking_request: notifications annulées (query_canceled) pour commande % — %', v_order_id, sqlerrm;
      when others then
        raise warning 'resolve_pms_booking_request: échec des notifications pour commande % — %', v_order_id, sqlerrm;
    end;
    return jsonb_build_object('ok', true, 'status', 'done');
  end if;

  if v_outcome = 'cancelled' then
    update public.pms_booking_requests
       set status = 'cancelled', processed_at = now(), last_error = v_error, updated_at = now()
     where id = p_request_id;
    return jsonb_build_object('ok', true, 'status', 'cancelled');
  end if;

  -- 'failed' / 'needs_human' : la commande est PAYÉE et Lobby ne l'a pas réservée.
  update public.pms_booking_requests
     set status = v_outcome, processed_at = now(), last_error = v_error, updated_at = now()
   where id = p_request_id;

  select coalesce(
    (select ol.id from public.order_lines ol
      where ol.id = p_order_line_id and ol.order_id = v_order_id),
    (select ol.id from public.order_lines ol
       join public.products p on p.id = ol.product_id
      where ol.order_id = v_order_id and ol.status = 'reserved' and ol.pms_booking_id is null
        and p.type = 'lodging' and p.lobby_category_id is not null
      order by ol.date, ol.id limit 1),
    (select ol.id from public.order_lines ol
      where ol.order_id = v_order_id
      order by ol.created_at, ol.id limit 1)
  ) into v_line_id;

  if v_line_id is not null then
    v_detail := case v_outcome
      when 'failed' then
        'commande PAYÉE — Lobby a refusé — reloger ou rembourser à la main : '
      else
        'commande PAYÉE — issue inconnue — vérifier chez Lobby par la note « hifago order_line '
          || v_line_id || ' », puis reloger ou rembourser à la main : '
    end || coalesce(v_error, 'motif inconnu') || ' (commande ' || v_reference || ')';
    insert into public.pms_reconciliation_entries (order_line_id, detail)
    select v_line_id, v_detail
     where not exists (
       select 1 from public.pms_reconciliation_entries e
        where e.order_line_id = v_line_id
          and e.status in ('open', 'retrying')
          and coalesce(e.detail, '') not like 'jeton Lobby remplacé%'
     );
  else
    raise warning 'resolve_pms_booking_request : commande % sans ligne — aucune entrée de réconciliation possible', v_order_id;
  end if;

  return jsonb_build_object('ok', true, 'status', v_outcome);
end;
$$;
revoke all on function public.resolve_pms_booking_request(uuid, text, text, uuid, interval, boolean) from public, anon, authenticated;
grant execute on function public.resolve_pms_booking_request(uuid, text, text, uuid, interval, boolean) to service_role;

-- claim_pms_booking_requests — les demandes dues (pending, next_attempt_at ≤ now()), `for update
-- skip locked` (deux passages concurrents ne prennent jamais la même), dans l'ordre de leur
-- échéance ; incrémente attempts. Chaque demande réclamée est mise SOUS BAIL (next_attempt_at
-- repoussé de 5 min, la durée du bail de commande) jusqu'à sa résolution : un autre passage ne la
-- reprend pas pendant son traitement, et le trigger de la file ne relance pas l'Edge Function sur
-- cette écriture (elle n'est plus « due »). Un passage interrompu (fonction tuée) la retrouve due au
-- bout du bail. Rattrapage d'abord : une demande réclamée 6 fois sans jamais être résolue est close
-- en needs_human (issue inconnue : le passage a pu être coupé pendant un POST). Le jeton Lobby n'est
-- pas rendu ici : il est lu par claim_paid_order_for_pms_booking.
create function public.claim_pms_booking_requests(p_limit int default 3)
returns table(request_id uuid, order_id uuid, attempts int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_bail constant interval := interval '5 minutes';
  c_max_attempts constant int := 6;
  v_exhausted uuid;
begin
  -- Rattrapage, SANS verrou ici : resolve_pms_booking_request prend orders puis la demande (règle 8).
  for v_exhausted in
    select q.id from public.pms_booking_requests q
     where q.status = 'pending' and q.attempts >= c_max_attempts and q.next_attempt_at <= now()
     order by q.next_attempt_at, q.id
  loop
    perform public.resolve_pms_booking_request(
      v_exhausted, 'needs_human',
      'demande réclamée ' || c_max_attempts || ' fois sans résolution (passage interrompu ?)'
    );
  end loop;

  return query
    with claimed as (
      select q.id
        from public.pms_booking_requests q
       where q.status = 'pending'
         and q.next_attempt_at <= now()
         and q.attempts < c_max_attempts
       order by q.next_attempt_at, q.id
       limit greatest(coalesce(p_limit, 3), 0)
       for update of q skip locked
    )
    update public.pms_booking_requests q
       set attempts = q.attempts + 1,
           next_attempt_at = now() + c_bail,
           updated_at = now()
      from claimed c
     where q.id = c.id
    returning q.id, q.order_id, q.attempts;
end;
$$;
revoke all on function public.claim_pms_booking_requests(int) from public, anon, authenticated;
grant execute on function public.claim_pms_booking_requests(int) to service_role;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 10. Déclenchement : pg_net tout de suite (trigger) + cron toutes les minutes (filet)
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- Miroir exact de invoke_pms_cancel_bookings (20260827170000), y compris son garde-fou « secrets
-- Vault manquants » ; délai de 55 s : l'Edge Function tient son budget (45 s) en dessous.
create function public.invoke_pms_book_paid_orders()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base_url text;
  v_key text;
begin
  select decrypted_secret into v_base_url from vault.decrypted_secrets where name = 'pms_functions_base_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'pms_service_role_key';
  if v_base_url is null or v_key is null then
    raise warning 'pms_book_paid_orders : secrets Vault manquants — job ignoré (cf. supabase/scripts/seed_pms_vault_secrets.example.sql)';
    return;
  end if;
  perform net.http_post(
    url := v_base_url || '/functions/v1/pms-book-paid-orders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;
-- Comme ses jumelles : appelée par pg_cron (rôle propriétaire) et par le trigger ci-dessous.
revoke all on function public.invoke_pms_book_paid_orders() from public, anon, authenticated;

-- Patron 20261014123021 (envoi immédiat des e-mails) : un trigger PAR INSTRUCTION, un seul appel par
-- transaction (drapeau local), seulement si l'instruction laisse une demande DUE (pending et
-- next_attempt_at ≤ now() : une insertion du webhook, un réarmement — jamais une réclamation, mise
-- sous bail, ni un nouvel essai, daté dans le futur). pg_net ne part qu'APRÈS le commit (et pas du
-- tout sur un rollback). Une panne de l'appel ne fait jamais échouer l'écriture : la demande reste
-- pending, le cron la reprend. Deux triggers : une table de transition ne sert qu'un événement.
create function public.dispatch_pms_book_paid_orders_now()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from nouvelles where status = 'pending' and next_attempt_at <= now()) then
    return null;
  end if;
  if current_setting('hifago.reservas_pms_demandees', true) = 'on' then
    return null;
  end if;
  perform set_config('hifago.reservas_pms_demandees', 'on', true);

  begin
    perform public.invoke_pms_book_paid_orders();
  exception
    when query_canceled then
      raise warning 'dispatch_pms_book_paid_orders_now : appel annulé (query_canceled), le cron reprendra — %', sqlerrm;
    when others then
      raise warning 'dispatch_pms_book_paid_orders_now : appel impossible, le cron reprendra — %', sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.dispatch_pms_book_paid_orders_now() from public, anon, authenticated;

create trigger pms_booking_requests_dispatch_now_insert
  after insert on public.pms_booking_requests
  referencing new table as nouvelles
  for each statement
  execute function public.dispatch_pms_book_paid_orders_now();
create trigger pms_booking_requests_dispatch_now_update
  after update on public.pms_booking_requests
  referencing new table as nouvelles
  for each statement
  execute function public.dispatch_pms_book_paid_orders_now();

-- Le filet : toutes les minutes (cadence fixée par la décision du 2026-10-23 ; cron_jobs.test.sql
-- la vérifie). Supervision : job_expectations, 10 minutes sans passage réussi → alerte admin.
select cron.schedule('pms-book-paid-orders', '* * * * *', $$select invoke_pms_book_paid_orders();$$);
insert into public.job_expectations (job_name, stale_after) values ('pms-book-paid-orders', interval '10 minutes');

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 11. resolve_pms_cancellation_restricted — une annulation que Lobby refuse (booking payé)
-- ════════════════════════════════════════════════════════════════════════════════════════════
-- Depuis que le booking porte l'acompte (POST /bookings avec `payment`), Lobby refuse toute
-- annulation par API (422 RESTRICTED_RESERVATION). pms-cancel-bookings la close comme avant ('done',
-- l'erreur gardée : la retenter ne sert à rien), MAIS la chambre reste prise chez le partenaire —
-- d'où une entrée de réconciliation « annuler à la main dans Lobby » sur une ligne portant ce booking
-- (même numéro, même établissement : la plus ancienne), jamais en double tant qu'une entrée de ce
-- booking est ouverte. Son trigger envoie l'e-mail admin 3. Aucune ligne ne porte le booking : la
-- file seule est close. Règle 8 : la commande de cette ligne d'abord.
create function public.resolve_pms_cancellation_restricted(
  p_entry_id uuid,
  p_lobby_status_code int,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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
     set status = 'done',
         lobby_status_code = p_lobby_status_code,
         last_error = p_error,
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
$$;
revoke all on function public.resolve_pms_cancellation_restricted(uuid, int, text) from public, anon, authenticated;
grant execute on function public.resolve_pms_cancellation_restricted(uuid, int, text) to service_role;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 12. apply_payment_webhook — redéfinie depuis la vivante (20261019170000), remplacements comptés,
--     signature et droits inchangés. Toutes les gardes conservées SAUF (i) la garde I2
--     pms_booking_missing ; (ii) les e-mails 5/6/7 partent dans notify_order_confirmed, différés par
--     une demande pms_booking_requests quand une nuit PMS n'a pas de booking (D4).
-- ════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.apply_payment_webhook(p_mp_payment_id text, p_external_reference uuid, p_status text, p_raw_event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_payment record;
  -- Migration 20261023120000 : v_order, v_referrer_account, v_owner_account, v_order_summary, v_site_url et
  -- v_contacts sont partis avec les e-mails dans notify_order_confirmed.
  -- Ajout 20260920120000 (durcissement) :
  v_order_id uuid;
  v_has_honorable_line boolean;
  v_other_approved_payment_id uuid;
  v_refund_code text;
  v_refund_reason text;
  -- Ajout 20261002185102 :
  v_prior_refund_code text;
begin
  if p_status not in ('pending', 'approved', 'rejected', 'cancelled', 'refunded', 'charged_back') then
    raise exception 'statut de paiement Mercado Pago inconnu : %', p_status;
  end if;

  -- (1) ORDRE DES VERROUS : `orders` d'abord, toujours (cf. en-tête) — lecture non verrouillante de
  -- la commande, verrou sur `orders`, PUIS verrou sur `payments`, dont le statut est relu après.
  select order_id into v_order_id
    from public.payments
   where id = p_external_reference;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'payment_not_found');
  end if;

  perform 1 from public.orders where id = v_order_id for update;

  select id, order_id, status, mp_payment_id, created_at into v_payment
    from public.payments
   where id = p_external_reference
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'payment_not_found');
  end if;

  -- Idempotent par construction : un webhook dupliqué ou reçu hors-ordre après approbation est un
  -- no-op — Mercado Pago retente un webhook qui ne renvoie pas 2xx, un no-op DOIT donc renvoyer
  -- ok:true (jamais une erreur), sans quoi le Route Handler entrerait en boucle de retry infinie.
  -- (6) Lot B — `refunded`/`charged_back` (20260921100000). Jusqu'ici le mapper les envoyait sur
  -- `cancelled` : une commande PAYÉE redevenait `unpaid`, lignes toujours `reserved`. Trois cas :
  -- déjà remboursé → no-op ; NOTRE remboursement (payment_refunds vivant, B2) → no-op, jamais une
  -- entrée ; externe (panel MP, contracargo) → entrée `refunded_externally` pour l'admin, et les
  -- statuts ne bougent QUE si ce paiement MP est celui qui a payé la commande. Jamais `unpaid`.
  if p_status in ('refunded', 'charged_back') then
    if v_payment.status in ('refunded', 'charged_back') then
      return jsonb_build_object('ok', true, 'reason', 'already_refunded');
    end if;
    if exists (
      select 1 from public.payment_refunds r
       where r.mp_payment_id = p_mp_payment_id and r.status in ('pending', 'approved')
    ) then
      return jsonb_build_object('ok', true, 'reason', 'own_refund');
    end if;
    insert into public.payment_reconciliation_entries (
      payment_id, mp_payment_id, external_reference, raw_event, failure_reason, kind, reason_code
    )
    values (
      v_payment.id, p_mp_payment_id, p_external_reference::text, p_raw_event,
      case when p_status = 'charged_back'
           then 'contracargo (charged_back) reçu de Mercado Pago — litige à documenter'
           else 'remboursement effectué hors hifago (panel Mercado Pago)' end,
      'refunded_externally',
      case when p_status = 'charged_back' then 'charged_back' else 'refunded_externally' end
    )
    on conflict (mp_payment_id) where kind = 'refunded_externally' do nothing;

    if v_payment.status = 'approved' and v_payment.mp_payment_id = p_mp_payment_id then
      update public.payments
         set status = p_status, raw_last_event = p_raw_event, updated_at = now()
       where id = v_payment.id;
      update public.orders set payment_status = 'refunded' where id = v_payment.order_id;
    end if;
    return jsonb_build_object('ok', true, 'reason', p_status);
  end if;

  if v_payment.status = 'approved' then
    -- (7) Lot B — double paiement sur le MÊME external_reference : le client a payé deux fois dans
    -- la même session Checkout Pro (m1 puis m2 sous P1). Sans ceci, m2 tombait dans
    -- `already_applied` et l'argent en double restait invisible.
    if p_status = 'approved'
       and v_payment.mp_payment_id is not null
       and v_payment.mp_payment_id <> p_mp_payment_id then
      insert into public.payment_reconciliation_entries (
        payment_id, mp_payment_id, external_reference, raw_event, failure_reason, kind, reason_code
      )
      values (
        v_payment.id, p_mp_payment_id, p_external_reference::text, p_raw_event,
        'double paiement : ce paiement Mercado Pago double le paiement ' || v_payment.mp_payment_id
          || ' déjà appliqué à la commande',
        'refund_required', 'double_payment'
      )
      on conflict (mp_payment_id) where kind = 'refund_required' do nothing;
      return jsonb_build_object('ok', true, 'reason', 'double_payment');
    end if;
    return jsonb_build_object('ok', true, 'reason', 'already_applied');
  end if;

  -- (5) Un paiement `cancelled` (par le cron d'expiration) ne bouge plus, sauf pour un `approved`
  -- qui est traité par la garde (2) ci-dessous : un `pending` PSE tardif, un `rejected` en retard
  -- ne ressuscitent jamais une commande morte.
  if v_payment.status = 'cancelled' and p_status <> 'approved' then
    return jsonb_build_object('ok', true, 'reason', 'already_cancelled');
  end if;

  -- (2) GARDE « RIEN À HONORER » — cf. en-tête, points (a) (b) (c).
  if p_status = 'approved' then
    -- Migration 20261002185102 — UNE DÉCISION DE REMBOURSEMENT EST DÉFINITIVE par paiement Mercado Pago.
    -- Le job de réconciliation rejoue l'`approved` tant que la commande n'est pas payée, et l'état
    -- qui a fondé le refus peut changer entre-temps (un booking Lobby posé après un refus I2).
    -- Appliquer alors un paiement dont l'admin a déjà la demande de remboursement ferait payer ET
    -- rembourser la même commande.
    select e.reason_code into v_prior_refund_code
      from public.payment_reconciliation_entries e
     where e.mp_payment_id = p_mp_payment_id and e.kind = 'refund_required';
    if found then
      return jsonb_build_object('ok', true, 'reason', v_prior_refund_code);
    end if;

    select exists (
      select 1 from public.order_lines ol
       where ol.order_id = v_payment.order_id
         and ol.status in ('reserved', 'fulfilled', 'no_show')
    ) into v_has_honorable_line;

    select id into v_other_approved_payment_id
      from public.payments
     where order_id = v_payment.order_id
       and status = 'approved'
       and id <> v_payment.id
     limit 1;

    if v_other_approved_payment_id is not null then
      v_refund_code := 'double_payment';
      v_refund_reason := 'double paiement : la commande est déjà payée par le paiement '
        || v_other_approved_payment_id;
    -- Migration 20261002185102 — INTENT REMPLACÉ : create_payment_intent annule le pending quand le
    -- montant de la commande change et en crée un nouveau ; l'ancien onglet Checkout Pro peut encore
    -- payer l'ancien. La commande VIT (une ligne à honorer) et un intent plus récent existe : ce
    -- n'est pas un paiement « après expiration » (texte client faux), c'est un intent remplacé — à
    -- rembourser, comme avant (paid_after_expiry). Un `cancelled` venu de Mercado Pago suivi d'un
    -- nouvel intent tombe aussi ici. Sans intent plus récent : paid_after_expiry, comme avant.
    elsif v_payment.status = 'cancelled' and v_has_honorable_line
                   and exists (
                     select 1 from public.payments newer
                      where newer.order_id = v_payment.order_id and newer.id <> v_payment.id
                        and newer.created_at > v_payment.created_at
                   ) then
      v_refund_code := 'superseded_intent';
      v_refund_reason := 'paiement approuvé sur un intent remplacé par un intent plus récent — '
        || 'rien n''est appliqué, remboursement à traiter';
    elsif v_payment.status = 'cancelled' or not v_has_honorable_line then
      v_refund_code := 'paid_after_expiry';
      v_refund_reason := case
        when exists (select 1 from public.order_lines ol
                      where ol.order_id = v_payment.order_id and ol.status = 'expired')
          then 'paiement approuvé après expiration de la commande'
        when exists (select 1 from public.order_lines ol
                      where ol.order_id = v_payment.order_id and ol.status = 'cancelled_by_client')
          then 'paiement approuvé après annulation par le client'
        when exists (select 1 from public.order_lines ol
                      where ol.order_id = v_payment.order_id and ol.status = 'cancelled_by_provider')
          then 'paiement approuvé après annulation par le prestataire'
        else 'paiement approuvé sans aucune prestation à honorer'
      end;
    -- Migration 20261023120000 : la garde I2 du webhook (pms_booking_missing, 20261002185102) est RETIRÉE.
    -- L'alternative qu'elle laissait ouverte, « appliquer, puis réserver chez Lobby », est retenue
    -- (décision du 2026-10-23, Lobby après l'acompte) : une nuit PMS sans booking est l'état normal
    -- d'une commande qui vient d'être payée — tenue par hold_pms_nights, elle est réservée par
    -- pms-book-paid-orders (demande posée plus bas). Un refus de Lobby part en réconciliation
    -- « commande PAYÉE », jamais en remboursement automatique.
    end if;

    if v_refund_code is not null then
      -- L'argent est chez Mercado Pago : on garde de quoi le rembourser (identifiant MP, événement
      -- brut), sans jamais toucher au statut du paiement ni à celui de la commande.
      update public.payments
         set mp_payment_id = p_mp_payment_id, raw_last_event = p_raw_event, updated_at = now()
       where id = v_payment.id;

      -- (3) Une seule entrée par paiement Mercado Pago, quel que soit le nombre de livraisons.
      insert into public.payment_reconciliation_entries (
        payment_id, mp_payment_id, external_reference, raw_event, failure_reason, kind, reason_code
      )
      values (
        v_payment.id, p_mp_payment_id, p_external_reference::text, p_raw_event, v_refund_reason,
        'refund_required', v_refund_code
      )
      on conflict (mp_payment_id) where kind = 'refund_required' do nothing;

      return jsonb_build_object('ok', true, 'reason', v_refund_code);
    end if;
  end if;

  -- Migration 20261002185102 — JAMAIS RÉTROGRADER VERS `pending` un paiement qui ne l'est plus quand un
  -- AUTRE intent de la commande est déjà `pending` (retentative dans l'ancienne session Checkout
  -- Pro après un nouvel intent) : l'index payments_one_pending_per_order le refuserait (23505 →
  -- webhook en échec, retenté sans fin), et ce paiement-là n'est plus celui que le client doit
  -- régler. Décidé sous le verrou de la commande (1), comme dans create_payment_intent : ce sont
  -- les deux seuls écrivains d'un `pending`.
  if p_status = 'pending' and v_payment.status <> 'pending' and exists (
    select 1 from public.payments other
     where other.order_id = v_payment.order_id and other.id <> v_payment.id and other.status = 'pending'
  ) then
    return jsonb_build_object('ok', true, 'reason', 'other_intent_pending');
  end if;

  update public.payments
     set status = p_status, mp_payment_id = p_mp_payment_id, raw_last_event = p_raw_event, updated_at = now()
   where id = v_payment.id;

  if p_status = 'approved' then
    update public.orders set payment_status = 'paid' where id = v_payment.order_id;

    -- (4) Les autres paiements de cette commande n'ont plus lieu d'être : un `rejected` retenté
    -- plus tard chez Mercado Pago tombera dans la garde (2c) au lieu d'être appliqué à son tour.
    update public.payments
       set status = 'cancelled', updated_at = now()
     where order_id = v_payment.order_id
       and id <> v_payment.id
       and status in ('pending', 'rejected');

    -- Migration 20261023120000 (D4, Lobby après l'acompte) — une nuit PMS-backed `reserved` sans booking
    -- Lobby (le cas normal désormais : TENUE par hold_pms_nights, pas encore réservée) → UNE demande
    -- pms_booking_requests, que pms-book-paid-orders traite tout de suite (trigger, après le commit)
    -- ou au cron. Aucun appel réseau ici. Les e-mails de confirmation (5 commission, 6 paiement,
    -- 7 client, 8 « recurso bloqueado ») sont DIFFÉRÉS jusqu'au booking (resolve_pms_booking_request
    -- 'done'), commandes mixtes comprises : rien n'annonce « confirmé » avant le oui de Lobby. Un
    -- webhook en double ne crée qu'une demande (order_id unique) ; une demande close (done,
    -- cancelled) est réarmée, jamais une demande en cours ni une demande qu'un humain tient
    -- (failed, needs_human). Même prédicat qu'isPmsBacked et que create_payment_intent.
    if exists (
      select 1
        from public.order_lines ol
        join public.products p on p.id = ol.product_id
       where ol.order_id = v_payment.order_id
         and ol.status = 'reserved'
         and ol.pms_booking_id is null
         and p.type = 'lodging' and p.lobby_category_id is not null
    ) then
      insert into public.pms_booking_requests as r (order_id)
      values (v_payment.order_id)
      on conflict (order_id) do update
         set status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null,
             processed_at = null, updated_at = now()
       where r.status in ('done', 'cancelled');
    else
      -- Les trois e-mails d'avant (et le 8, quittant create_order), à l'identique. Isolés en plus ici
      -- (spec 23 §8.1) : une notification ne fait jamais échouer un paiement.
      begin
        perform public.notify_order_confirmed(v_payment.order_id);
      exception
        when query_canceled then
          raise warning 'apply_payment_webhook: notifications de confirmation annulées (query_canceled) pour commande % — %', v_payment.order_id, sqlerrm;
        when others then
          raise warning 'apply_payment_webhook: échec des notifications de confirmation pour commande % — %', v_payment.order_id, sqlerrm;
      end;
    end if;
  elsif p_status in ('rejected', 'cancelled') then
    -- (5) Jamais rétrograder une commande qu'un AUTRE paiement porte encore (pending) ou a déjà
    -- réglée (approved) — une notification `rejected` en retard sur P1 ne doit pas effacer P2.
    update public.orders
       set payment_status = 'unpaid'
     where id = v_payment.order_id
       and not exists (
         select 1 from public.payments other
          where other.order_id = v_payment.order_id
            and other.id <> v_payment.id
            and other.status in ('pending', 'approved')
       );
  end if;
  -- p_status = 'pending' : orders.payment_status reste 'pending' (déjà posé par create_payment_intent).

  return jsonb_build_object('ok', true);
end;
$function$;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 13. create_payment_intent — redéfinie depuis la vivante (20261002185102) : pms_booking_missing
--     seulement pour une nuit PMS sans booking ET sans tenue de moins de 5 min (D3).
-- ════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_payment_intent(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid := auth.uid();
  v_order_account_id uuid;
  v_payer_email text;
  v_existing_status text;
  v_existing_payment_id uuid;
  v_existing_amount_cop bigint;
  v_amount_cop bigint;
  v_payment_id uuid;
  v_order_created_at timestamptz;
begin
  select account_id, holder_email, created_at into v_order_account_id, v_payer_email, v_order_created_at
    from public.orders
   where id = p_order_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  -- 2026-09-09 — CORRECTIF DE SÉCURITÉ. La condition `v_account_id is not null and` a été RETIRÉE :
  -- elle désarmait la garde pour tout appelant SANS session. Prouvé en réel sous le rôle `anon`
  -- sans aucun JWT, sur la commande d'un autre compte : retour {"ok": true, "amount_cop": 45000,
  -- "payer_email": "<email du titulaire>"} — donc fuite de PII, écriture d'une ligne `payments`
  -- 'pending' et bascule de `orders.payment_status` sur la commande d'autrui, plus un déni de
  -- service (l'idempotence `payment_already_pending` empêchait ensuite le VRAI titulaire de créer
  -- son intent). Le test pgTAP couvrait « un autre compte AUTHENTIFIÉ » (cas 5) et passait : c'est
  -- le cas sans session qui n'était testé nulle part (CLAUDE.md §11.20). Cas 5bis ajouté.
  --
  -- `is distinct from` traite NULL correctement : appelant sans session (v_account_id null) sur une
  -- commande qui A un propriétaire → distinct → refusé. Ce qui reste ouvert, DÉLIBÉRÉMENT et sans
  -- changement : une commande INVITÉ (v_order_account_id null) reste payable par le porteur de son
  -- order_id — c'est le parcours invité d'aujourd'hui (CheckoutForm appelle cette RPC depuis le
  -- navigateur juste après create_order). L'identité anonyme refermera ce dernier cas d'elle-même :
  -- toute commande portera alors un account_id.
  if v_order_account_id is not null and v_order_account_id is distinct from v_account_id then
    -- Même réponse qu'une commande inexistante, jamais un refus distinct qui confirmerait
    -- l'existence d'une commande d'un autre compte (même logique que cancel_order).
    return jsonb_build_object('ok', false, 'reason', 'order_not_found');
  end if;

  select id, status, amount_cop into v_existing_payment_id, v_existing_status, v_existing_amount_cop
    from public.payments
   where order_id = p_order_id and status in ('pending', 'approved')
   order by created_at desc
   limit 1
   for update;

  if v_existing_status = 'approved' then
    return jsonb_build_object('ok', false, 'reason', 'already_paid');
  end if;

  -- Échéance de paiement (migration 20261001194704) : passé `public.order_payment_deadline`
  -- (28 min après la création), payments/create refuse `order_expiring` et la préférence
  -- Mercado Pago est morte.
  -- Refusé ICI, avant tout `payments` et avant `pms_booking_missing` : sinon un `pending` était créé
  -- et `orders.payment_status` basculé (l'écran disait « confirmando tu pago » sur une commande
  -- condamnée), et la reprise rappelait Lobby pour un booking qu'on ne pourrait plus payer. Une
  -- commande déjà morte (expirée, annulée) garde sa réponse d'avant, `nothing_to_pay`.
  -- Migration 20261002185102 — MARGE DE 30 s : le navigateur appelle cette fonction PUIS payments/create,
  -- qui revérifie la limite (28 min) avant de créer la préférence. Un intent accepté dans les
  -- toutes dernières secondes posait un `pending` (écran « confirmando ») que payments/create
  -- refusait aussitôt. Jamais une fonction d'abandon du pending : un écrivain de plus de
  -- payments.status pour un défaut d'écran.
  if now() >= public.order_payment_deadline(v_order_created_at) - interval '30 seconds'
     and exists (select 1 from public.order_lines where order_id = p_order_id and status = 'reserved') then
    return jsonb_build_object('ok', false, 'reason', 'order_expiring');
  end if;

  -- Ajout de la migration 20260930221837 (CLAUDE.md §4.4, I2) : aucun paiement tant qu'une
  -- nuit PMS-backed n'a pas son booking Lobby. Même prédicat qu'isPmsBacked et que create_order
  -- (20260929112240). Une activité liée à Lobby sans booking ne bloque pas : Lobby refuse une vente
  -- de service isolée, c'est une limite connue, pas un manque de réservation.
  if exists (
    select 1
      from public.order_lines ol
      join public.products p on p.id = ol.product_id
     where ol.order_id = p_order_id
       and ol.status = 'reserved'
       and ol.pms_booking_id is null
       and p.type = 'lodging' and p.lobby_category_id is not null
       -- Migration 20261023120000 (D3, Lobby après l'acompte) : une nuit TENUE depuis moins de 5 min par
       -- hold_pms_nights (Lobby lu à chaud, la place comptée « en vol ») se paie — son booking est
       -- écrit APRÈS l'acompte. Une ligne bookée (ancien flux) passe toujours ; une tenue plus
       -- vieille, ou absente, renvoie pms_booking_missing comme avant (nouvelle vérification).
       and (ol.pms_held_at is null or ol.pms_held_at < now() - interval '5 minutes')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'pms_booking_missing');
  end if;

  -- Seulement les lignes ENCORE actives (status = 'reserved') : une ligne déjà superseded par
  -- modify_order_line, ou déjà annulée/expirée, ne doit jamais gonfler l'acompte demandé — même
  -- discipline que cancel_order (« seulement les lignes ENCORE actives »).
  select coalesce(sum(acompte_cop), 0) into v_amount_cop
    from public.order_lines
   where order_id = p_order_id and status = 'reserved';

  if v_amount_cop <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'nothing_to_pay');
  end if;

  -- Ajout de la migration 20260930221837 : un intent `pending` ne bloque plus le client. Même
  -- montant → le même payment (la préférence Mercado Pago est rejouée par son idempotencyKey =
  -- payment_id, apps/web/lib/mercadopago/client.ts) ; montant changé (une ligne annulée
  -- entre-temps) → l'ancien est annulé et un nouveau est créé. Un `approved` tardif sur l'ancien
  -- est remboursé : refund_required superseded_intent (migration 20261002185102). Avant :
  -- payment_already_pending sans payment_id, et un seul 503 de Mercado Pago bloquait la
  -- réservation jusqu'à son expiration.
  if v_existing_status = 'pending' then
    if v_existing_amount_cop = v_amount_cop then
      update public.orders set payment_status = 'pending' where id = p_order_id;
      return jsonb_build_object(
        'ok', true, 'payment_id', v_existing_payment_id, 'amount_cop', v_amount_cop,
        'payer_email', v_payer_email, 'reused', true
      );
    end if;
    -- Tous les pending de la commande, pas seulement le dernier : un ancien paiement redevenu
    -- `pending` (retentative Checkout Pro) ne doit pas survivre à l'ancien montant.
    update public.payments set status = 'cancelled', updated_at = now()
     where order_id = p_order_id and status = 'pending';
  end if;

  insert into public.payments (order_id, amount_cop, payer_email)
  values (p_order_id, v_amount_cop, v_payer_email)
  returning id into v_payment_id;

  update public.orders set payment_status = 'pending' where id = p_order_id;

  return jsonb_build_object(
    'ok', true, 'payment_id', v_payment_id, 'amount_cop', v_amount_cop, 'payer_email', v_payer_email
  );
end;
$function$;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 14. create_order — redéfinie depuis la vivante (20261019180000) : l'e-mail 8 quitte la boucle ; il
--     ne part ici que si rien n'est dû en ligne. Rien d'autre ne change.
-- ════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_order(p_holder_name text, p_holder_email text DEFAULT NULL::text, p_holder_phone text DEFAULT NULL::text, p_marketing_consent boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_account_id uuid := auth.uid();
  -- Migration 20261014031656 (G8a) : « aujourd'hui » en Colombie, résolu une fois pour toutes les
  -- lignes — jamais current_date (le serveur tourne en UTC).
  v_today constant date := public.today_in_bogota();
  v_order_id uuid;
  -- Spec 32 (panier en base) : plus un paramètre — construites depuis cart_items/carts
  -- pour ce compte, côté serveur, un client ne pouvant plus jamais les falsifier.
  v_lines jsonb;
  v_cart_attribution_code text;
  v_cart_attribution_source text;
  v_line jsonb;
  v_line_idx int;
  v_product_type text;
  v_min_qty int;
  v_max_qty int;
  v_price_tiers jsonb;
  v_lodging_lines int := 0;
  v_lodging_units int := 0;
  v_prestation_lines int := 0;
  v_avail record;
  v_attribution_code text;
  v_attribution_source text;
  v_referrer_partner_id uuid;
  -- 2026-09-10 (/simplify) : la condition « identité durable non anonyme » était calculée
  -- deux fois (lecture + écriture de saved_attribution_code) — une seule fois ici, réutilisée.
  v_identified_account boolean := v_account_id is not null and not (select public.is_anonymous_session());
  v_products_type text[];
  v_products_sellable boolean[];
  v_products_price_cop bigint[];
  v_products_price_tiers jsonb[];
  v_products_establishment_id uuid[];
  v_products_duration_days int[];
  v_products_partner_id uuid[];
  v_products_calendar_default_open boolean[];
  v_products_stay_rates jsonb[];
  v_products_lobby_category_id int[];
  -- Ajout de la migration 20260914130000 — remise par seuil de remplissage cumulé (camps).
  v_products_group_discount_threshold_qty int[];
  v_products_group_discount_pct numeric(5, 4)[];
  v_camp_fill_before_qty int[];
  -- Ajout migration evento_online_bookable (20260915130000).
  v_products_online_bookable boolean[];
  v_products_is_free boolean[];
  v_products_evento_capacity_mode text[];
  v_products_evento_payment_mode text[];
  v_products_evento_occupies_resource boolean[];
begin
  -- 2026-09-10 (spec 31, Tranche 1) — garde RÉINTRODUITE, en connaissance de son historique.
  -- Elle avait été retirée le 2026-08-13 (migration 20260814090000_create_order_guest_checkout.sql)
  -- pour que la réservation invité reste possible SANS COMPTE, décision de Jérôme documentée là-bas
  -- (cahier §1/§2 : « forcer un compte avant achat fait perdre des ventes »). Cette décision N'EST
  -- PAS renversée ici : elle porte sur le MOT DE PASSE, jamais exigé. Ce qui change, c'est qu'après
  -- ce lot, CartContext (apps/web) crée une session anonyme Supabase dès le premier ajout au panier
  -- (spec 31 invariant 1) — donc au moment où cette RPC est atteinte depuis l'écran réel, auth.uid()
  -- n'est PLUS jamais nul. La garde ne bloque que ce qui n'a plus aucun chemin légitime : un appel
  -- direct à la RPC sans passer par le panier. Elle prépare aussi `orders.account_id` NOT NULL
  -- (Tranche 2, spec 31) : sans elle, cette contrainte future remonterait une erreur Postgres brute
  -- (23502) au navigateur au lieu d'un motif exploitable par l'écran.
  if v_account_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  end if;

  -- Spec 32 : les lignes viennent de cart_items pour CE compte, jamais d'un paramètre. Un
  -- product_id/qty/date passé par le client ne peut plus jamais diverger de ce qu'il a
  -- réellement dans son panier au moment du checkout.
  select coalesce(jsonb_agg(jsonb_build_object(
           'product_id', product_id,
           'date', date,
           'end_date', end_date,
           'slot_start_time', slot_start_time,
           'qty', qty
         ) order by created_at), '[]'::jsonb)
    into v_lines
    from public.cart_items
   where account_id = v_account_id;

  select attribution_code, attribution_source
    into v_cart_attribution_code, v_cart_attribution_source
    from public.carts
   where account_id = v_account_id;

  if jsonb_array_length(v_lines) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty_cart');
  end if;

  if p_holder_email is null or btrim(p_holder_email) = '' then
    return jsonb_build_object('ok', false, 'reason', 'email_required');
  end if;
  if p_holder_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return jsonb_build_object('ok', false, 'reason', 'email_invalid');
  end if;

  for v_line, v_line_idx in
    select elem, ord::int from jsonb_array_elements(v_lines) with ordinality as t(elem, ord)
  loop
    declare
      v_line_end_date date := (v_line->>'end_date')::date;
      v_line_qty int := (v_line->>'qty')::int;
      v_line_slot_start_time time := (v_line->>'slot_start_time')::time;
      v_p_sellable boolean;
      v_p_price_cop bigint;
      v_p_establishment_id uuid;
      v_p_duration_days int;
      v_p_partner_id uuid;
      v_p_calendar_default_open boolean;
      v_p_stay_rates jsonb;
      v_p_lobby_category_id int;
      v_p_group_discount_threshold_qty int;
      v_p_group_discount_pct numeric(5, 4);
      v_p_online_bookable boolean;
      v_p_is_free boolean;
      v_p_evento_capacity_mode text;
      v_p_evento_payment_mode text;
      v_p_evento_occupies_resource boolean;
      v_p_external_booking_url text;
    begin
      select type, coalesce(min_qty, 1), coalesce(max_qty, 20), price_tiers,
             sellable, price_cop, establishment_id, duration_days, partner_id,
             calendar_default_open, stay_rates, lobby_category_id,
             group_discount_threshold_qty, group_discount_pct,
             online_bookable, is_free, evento_capacity_mode, evento_payment_mode, evento_occupies_resource,
             external_booking_url
        into v_product_type, v_min_qty, v_max_qty, v_price_tiers,
             v_p_sellable, v_p_price_cop, v_p_establishment_id, v_p_duration_days, v_p_partner_id,
             v_p_calendar_default_open, v_p_stay_rates, v_p_lobby_category_id,
             v_p_group_discount_threshold_qty, v_p_group_discount_pct,
             v_p_online_bookable, v_p_is_free, v_p_evento_capacity_mode, v_p_evento_payment_mode, v_p_evento_occupies_resource,
             v_p_external_booking_url
        from public.products where id = (v_line->>'product_id')::uuid;
      if not found then
        return jsonb_build_object('ok', false, 'reason', 'product_not_found', 'line', v_line);
      end if;

      -- Migration 20261014031656 (G8b, arbitrage du 2026-10-14) : ce que la vitrine ne vend pas en
      -- ligne ne se commande pas. Même prédicat que resolverModoReserva et resolverUrlContacto
      -- (apps/web/lib/catalog/producto.ts) : un evento non réservable en ligne est informatif ; hors
      -- evento, une URL de réservation externe — ou un transport, dont le contact a toujours un
      -- repli — fait de la fiche une vitrine.
      if (v_product_type = 'evento' and not v_p_online_bookable)
         or (v_product_type <> 'evento' and (v_p_external_booking_url is not null or v_product_type = 'transport')) then
        return jsonb_build_object('ok', false, 'reason', 'not_sellable', 'line', v_line);
      end if;

      -- Migration 20261014031656 (G8a) : jamais une date passée — le début d'un séjour, la date d'une
      -- occurrence ou d'un créneau sinon. Le jour même reste ouvert.
      if (v_line->>'date')::date < v_today then
        return jsonb_build_object('ok', false, 'reason', 'date_in_past', 'line', v_line);
      end if;

      v_products_type[v_line_idx] := v_product_type;
      v_products_sellable[v_line_idx] := v_p_sellable;
      v_products_price_cop[v_line_idx] := v_p_price_cop;
      v_products_price_tiers[v_line_idx] := v_price_tiers;
      v_products_establishment_id[v_line_idx] := v_p_establishment_id;
      v_products_duration_days[v_line_idx] := v_p_duration_days;
      v_products_partner_id[v_line_idx] := v_p_partner_id;
      v_products_calendar_default_open[v_line_idx] := v_p_calendar_default_open;
      v_products_stay_rates[v_line_idx] := v_p_stay_rates;
      v_products_lobby_category_id[v_line_idx] := v_p_lobby_category_id;
      v_products_group_discount_threshold_qty[v_line_idx] := v_p_group_discount_threshold_qty;
      v_products_group_discount_pct[v_line_idx] := v_p_group_discount_pct;
      v_products_online_bookable[v_line_idx] := v_p_online_bookable;
      v_products_is_free[v_line_idx] := v_p_is_free;
      v_products_evento_capacity_mode[v_line_idx] := v_p_evento_capacity_mode;
      v_products_evento_payment_mode[v_line_idx] := v_p_evento_payment_mode;
      v_products_evento_occupies_resource[v_line_idx] := v_p_evento_occupies_resource;

      -- Ajout migration evento_online_bookable : défense en profondeur — une date hors calendrier
      -- d'occurrence de l'evento (jamais une vraie occurrence once/recurring) est refusée ici,
      -- avant tout verrou. Peu coûteux, complète (sans remplacer) la vérification calendar_open/
      -- capacity plus bas, qui reste la vraie barrière anti-survente. Scopé à online_bookable :
      -- un evento non activé n'a structurellement aucune occurrence exploitable par ce chemin
      -- (occurrence_type/occurrence_date jamais renseignés avant activation) — et depuis la
      -- migration 20261014031656, il est refusé plus haut (not_sellable).
      if v_product_type = 'evento' and v_p_online_bookable then
        -- Migration 20261014204354 : la ligne de l'evento sous verrou PARTAGÉ avant de lire ses
        -- occurrences. Un changement de date ou de récurrence (UPDATE, verrou exclusif) attend
        -- donc la fin de cette commande — et la trouve si elle orpheline une réservation —, ou
        -- cette commande attend la fin du changement et lit les nouvelles occurrences. Ordre
        -- global : produit, puis capacité (product_availability, ressource, créneaux).
        perform 1 from public.products where id = (v_line->>'product_id')::uuid for share;
        if not exists (
          select 1 from public.expand_event_occurrences(
            (v_line->>'product_id')::uuid, (v_line->>'date')::date, (v_line->>'date')::date
          )
        ) then
          return jsonb_build_object('ok', false, 'reason', 'invalid_occurrence_date', 'line', v_line);
        end if;
      end if;

      v_price_tiers := public.normalize_price_tiers(v_price_tiers);

      if v_line_end_date is not null and v_product_type <> 'lodging' then
        return jsonb_build_object('ok', false, 'reason', 'unsupported_date_range', 'line', v_line);
      end if;
      if v_line_end_date is not null and v_line_end_date <= (v_line->>'date')::date then
        return jsonb_build_object('ok', false, 'reason', 'invalid_date_range', 'line', v_line);
      end if;

      -- Ajout de la migration 20260929112240 : un logement se réserve toujours par plage de
      -- nuits. Sans end_date, il tombait dans la branche « date unique » (prix palier × qty sans
      -- tarif par nuit, ligne product_availability créée même pour un PMS-backed). Aucun écran
      -- n'emprunte ce chemin (LodgingReservationForm envoie toujours endDate).
      if v_product_type = 'lodging' and v_line_end_date is null then
        return jsonb_build_object('ok', false, 'reason', 'date_range_required', 'line', v_line);
      end if;

      if v_line_slot_start_time is not null then
        if v_line_end_date is not null then
          return jsonb_build_object('ok', false, 'reason', 'unsupported_slot_combination', 'line', v_line);
        end if;
      elsif v_line_end_date is null and exists (
        select 1 from public.product_slot_rules where product_id = (v_line->>'product_id')::uuid
      ) then
        return jsonb_build_object('ok', false, 'reason', 'slot_required', 'line', v_line);
      end if;

      -- Ajout de la migration 20260929112240 : quantité ≥ 1 pour TOUT type, avant le
      -- branchement — la branche lodging n'avait aucune borne, et un min_qty produit ≤ 0
      -- n'abaisse jamais ce plancher.
      if v_line_qty < 1 then
        return jsonb_build_object('ok', false, 'reason', 'qty_below_minimum', 'line', v_line);
      end if;

      if v_product_type = 'lodging' then
        -- Ajout de la migration 20260929112240 : plafond coalesce(max_qty, 20), le même que
        -- les autres types et que la vitrine (apps/web/lib/catalog/producto.ts). Pas de min_qty
        -- pour un logement : la vitrine le réserve avec un minimum fixé à 1
        -- (apps/web/lib/reservas/cantidad.ts).
        if v_line_qty > v_max_qty then
          return jsonb_build_object('ok', false, 'reason', 'qty_cap_exceeded', 'line', v_line);
        end if;
        -- Migration 20261014031656 (G17, arbitrage du 2026-10-14) : une quantité qu'aucun palier ne
        -- couvre est refusée, comme modify_order_line — jamais facturée au prix de base.
        if v_price_tiers is not null and not exists (
          select 1 from jsonb_to_recordset(v_price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
           where v_line_qty between t.min_qty and t.max_qty
        ) then
          return jsonb_build_object('ok', false, 'reason', 'no_matching_tier', 'line', v_line);
        end if;
        -- Ajout de la migration 20260929112240 (CLAUDE.md §4.4, échec fermé) : un logement
        -- PMS-backed (lobby_category_id non nul, même prédicat qu'isPmsBacked) n'a aucun contrôle
        -- de capacité local — Lobby, appelé ensuite par /api/pms/reserve-nights, est son seul
        -- contrôle, et cette route écarte un établissement dont le connecteur est coupé. Refusé
        -- ici, avant tout verrou.
        if v_p_lobby_category_id is not null and not exists (
          select 1 from public.establishments e
           where e.id = v_p_establishment_id
             and e.lobby_connector_active
             and e.lobby_api_token is not null
        ) then
          return jsonb_build_object('ok', false, 'reason', 'pms_unavailable', 'line', v_line);
        end if;
        v_lodging_lines := v_lodging_lines + 1;
        v_lodging_units := v_lodging_units + v_line_qty;
      else
        v_prestation_lines := v_prestation_lines + 1;
        if v_line_qty < v_min_qty then
          return jsonb_build_object('ok', false, 'reason', 'qty_below_minimum', 'line', v_line);
        end if;
        if v_line_qty > v_max_qty then
          return jsonb_build_object('ok', false, 'reason', 'qty_cap_exceeded', 'line', v_line);
        end if;
        if v_price_tiers is not null and not exists (
          select 1 from jsonb_to_recordset(v_price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
           where v_line_qty between t.min_qty and t.max_qty
        ) then
          return jsonb_build_object('ok', false, 'reason', 'no_matching_tier', 'line', v_line);
        end if;
      end if;
    end;
  end loop;
  -- Valeurs relevées le 2026-09-07 (cahier §3e) pour la commande multi-établissements, jamais
  -- codées jusqu'ici (trouvé en préparant spec 32 §10) : 4/12/20 étaient encore celles de l'ère
  -- un-seul-établissement.
  if v_lodging_lines > 12 or v_lodging_units > 36 then
    return jsonb_build_object('ok', false, 'reason', 'lodging_cap_exceeded');
  end if;
  if v_prestation_lines > 40 then
    return jsonb_build_object('ok', false, 'reason', 'prestation_cap_exceeded');
  end if;

  -- Ajout de la migration 20260915100000 : un camp de plus d'un jour (duration_days > 1, donc au
  -- moins 1 nuit requise) exige, dans ce MÊME panier, au moins une ligne lodging qui couvre à elle
  -- seule la totalité des nuits requises — "camp du 1 au 5" = les nuits 1,2,3,4, donc dernier jour
  -- du camp = date_depart + duration_days - 1 (même formule que provider_resource_calendar/
  -- availability_blocks plus bas). Vérifie UNIQUEMENT la couverture des dates, jamais une
  -- comparaison de quantité (cf. en-tête de 20260915100000). Emplacement délibéré : juste après
  -- les plafonds de composition ci-dessus, avant tout verrou — aucun nouveau tableau, aucune
  -- requête ni verrou supplémentaire, v_lines/v_products_type[]/v_products_duration_days[] étant
  -- déjà entièrement peuplés par la boucle Phase 1 ci-dessus.
  for v_line, v_line_idx in
    select elem, ord::int from jsonb_array_elements(v_lines) with ordinality as t(elem, ord)
  loop
    if v_products_type[v_line_idx] = 'camp' and v_products_duration_days[v_line_idx] > 1 then
      declare
        v_camp_arrival date := (v_line->>'date')::date;
        v_camp_last_day date := v_camp_arrival + v_products_duration_days[v_line_idx] - 1;
      begin
        if not exists (
          select 1
            from jsonb_array_elements(v_lines) as lodging_elem
           where lodging_elem->>'end_date' is not null
             and (lodging_elem->>'date')::date <= v_camp_arrival
             and (lodging_elem->>'end_date')::date >= v_camp_last_day
        ) then
          return jsonb_build_object('ok', false, 'reason', 'camp_missing_lodging', 'line', v_line);
        end if;
      end;
    end if;
  end loop;

  insert into public.product_availability (product_id, date, capacity, booked)
  select distinct p.id, (elem->>'date')::date, p.default_capacity, 0
    from jsonb_array_elements(v_lines) elem
    join public.products p on p.id = (elem->>'product_id')::uuid
   where elem->>'end_date' is null
     and p.default_capacity is not null
     -- Ajout migration evento_online_bookable : un evento 'rsvp' PORTE un default_capacity
     -- informatif (dénominateur du compteur) — ne jamais le matérialiser en product_availability,
     -- qui serait alors lu/verrouillé comme s'il fallait le décompter.
     and (p.type <> 'evento' or p.evento_capacity_mode = 'metered')
  on conflict (product_id, date) do nothing;

  insert into public.product_slot_availability (
    product_id, slot_date, slot_start_time, slot_duration_minutes, capacity, booked
  )
  select distinct p.id, (elem->>'date')::date, v.slot_start_time, v.slot_duration_minutes, v.capacity, 0
    from jsonb_array_elements(v_lines) elem
    join public.products p on p.id = (elem->>'product_id')::uuid
    cross join lateral public.expand_product_slots(p.id, (elem->>'date')::date) v
   where elem->>'slot_start_time' is not null
     and v.slot_start_time = (elem->>'slot_start_time')::time
  on conflict (product_id, slot_date, slot_start_time) do nothing;

  for v_avail in
    select pa.product_id, pa.date
      from public.product_availability pa
     where (pa.product_id, pa.date) in (
       select (elem->>'product_id')::uuid, (elem->>'date')::date
         from jsonb_array_elements(v_lines) elem
        where elem->>'end_date' is null
       union
       select (elem->>'product_id')::uuid, (elem->>'date')::date + gs
         from jsonb_array_elements(v_lines) elem
         join public.products p2 on p2.id = (elem->>'product_id')::uuid
         cross join lateral generate_series(0, ((elem->>'end_date')::date - (elem->>'date')::date) - 1) as gs
        where elem->>'end_date' is not null
          and p2.lobby_category_id is null
     )
     order by pa.product_id, pa.date
     for update
  loop
    null;
  end loop;

  for v_avail in
    select prc.establishment_id, prc.slot_date
      from public.provider_resource_calendar prc
     where (prc.establishment_id, prc.slot_date) in (
       -- Ajout migration evento_online_bookable : un evento réservable qui occupe la ressource
       -- (evento_occupies_resource, défaut true) verrouille désormais ce même calendrier partagé,
       -- traité comme « un camp d'un seul jour » (coalesce(duration_days, 1) — toujours NULL pour
       -- un evento, jamais pour un camp, donc bascule naturellement sur 1 jour).
       select p.establishment_id, (elem->>'date')::date + gs
         from jsonb_array_elements(v_lines) elem
         join public.products p on p.id = (elem->>'product_id')::uuid
         cross join generate_series(0, coalesce(p.duration_days, 1) - 1) as gs
        where p.type = 'camp' or (p.type = 'evento' and p.online_bookable and p.evento_occupies_resource)
     )
     order by prc.establishment_id, prc.slot_date
     for update
  loop
    null;
  end loop;

  for v_avail in
    select psa.product_id, psa.slot_date, psa.slot_start_time
      from public.product_slot_availability psa
     where (psa.product_id, psa.slot_date, psa.slot_start_time) in (
       select (elem->>'product_id')::uuid, (elem->>'date')::date, (elem->>'slot_start_time')::time
         from jsonb_array_elements(v_lines) elem
        where elem->>'slot_start_time' is not null
     )
     order by psa.product_id, psa.slot_date, psa.slot_start_time
     for update
  loop
    null;
  end loop;

  for v_line, v_line_idx in
    select elem, ord::int from jsonb_array_elements(v_lines) with ordinality as t(elem, ord)
  loop
    declare
      v_sellable boolean;
      v_calendar_open boolean;
      v_capacity int;
      v_booked int;
      v_line_type text;
      v_line_establishment_id uuid;
      v_line_duration_days int;
      v_gs int;
      v_resource_capacity int;
      v_resource_booked int;
      v_line_price_cop bigint;
      v_line_price_tiers jsonb;
      v_line_end_date date := (v_line->>'end_date')::date;
      v_line_slot_start_time time := (v_line->>'slot_start_time')::time;
      v_night date;
      v_cart_qty int;
      v_night_row record;
    begin
      if v_line_end_date is not null then
        v_sellable := v_products_sellable[v_line_idx];
        v_line_type := v_products_type[v_line_idx];
        v_line_price_cop := v_products_price_cop[v_line_idx];
        v_line_price_tiers := v_products_price_tiers[v_line_idx];
        if not v_sellable then
          return jsonb_build_object('ok', false, 'reason', 'not_sellable', 'line', v_line);
        end if;
        if v_line_price_tiers is null and v_line_price_cop is null then
          return jsonb_build_object('ok', false, 'reason', 'price_missing', 'line', v_line);
        end if;
        if v_products_lobby_category_id[v_line_idx] is null then
          for v_night_row in
            select gs.night::date as night,
                   coalesce(pc.open, v_products_calendar_default_open[v_line_idx]) as calendar_open,
                   pa.capacity as capacity,
                   pa.booked as booked,
                   (select coalesce(sum((l->>'qty')::int), 0)
                      from jsonb_array_elements(v_lines) l
                     where (l->>'product_id')::uuid = (v_line->>'product_id')::uuid
                       and l->>'end_date' is not null
                       and gs.night::date >= (l->>'date')::date
                       and gs.night::date < (l->>'end_date')::date
                   ) as cart_qty
              from generate_series(
                     (v_line->>'date')::date::timestamp,
                     v_line_end_date::timestamp - interval '1 day',
                     interval '1 day'
                   ) as gs(night)
              left join public.product_calendar pc
                on pc.product_id = (v_line->>'product_id')::uuid and pc.date = gs.night::date
              left join public.product_availability pa
                on pa.product_id = (v_line->>'product_id')::uuid and pa.date = gs.night::date
             order by gs.night
          loop
            if not v_night_row.calendar_open then
              return jsonb_build_object('ok', false, 'reason', 'date_closed', 'line', v_line, 'date', v_night_row.night);
            end if;
            if v_night_row.capacity is null then
              return jsonb_build_object('ok', false, 'reason', 'slot_not_found', 'line', v_line, 'date', v_night_row.night);
            end if;
            if v_night_row.booked + v_night_row.cart_qty > v_night_row.capacity then
              return jsonb_build_object('ok', false, 'reason', 'full', 'line', v_line, 'date', v_night_row.night);
            end if;
          end loop;
        end if;

      elsif v_line_slot_start_time is not null then
        v_sellable := v_products_sellable[v_line_idx];
        select coalesce(
          (select pc.open from public.product_calendar pc
            where pc.product_id = (v_line->>'product_id')::uuid and pc.date = (v_line->>'date')::date),
          v_products_calendar_default_open[v_line_idx]
        ) into v_calendar_open;
        if not v_sellable then
          return jsonb_build_object('ok', false, 'reason', 'not_sellable', 'line', v_line);
        end if;
        if not v_calendar_open then
          return jsonb_build_object('ok', false, 'reason', 'date_closed', 'line', v_line);
        end if;

        select capacity, booked into v_capacity, v_booked
          from public.product_slot_availability
         where product_id = (v_line->>'product_id')::uuid
           and slot_date = (v_line->>'date')::date
           and slot_start_time = v_line_slot_start_time;
        if not found then
          return jsonb_build_object('ok', false, 'reason', 'slot_not_found', 'line', v_line);
        end if;

        if v_booked + (
          select coalesce(sum((l->>'qty')::int), 0) from jsonb_array_elements(v_lines) l
           where (l->>'product_id')::uuid = (v_line->>'product_id')::uuid
             and (l->>'date')::date = (v_line->>'date')::date
             and (l->>'slot_start_time')::time = v_line_slot_start_time
        ) > v_capacity then
          return jsonb_build_object('ok', false, 'reason', 'full', 'line', v_line);
        end if;

      else
        v_sellable := v_products_sellable[v_line_idx];
        v_line_type := v_products_type[v_line_idx];
        v_line_establishment_id := v_products_establishment_id[v_line_idx];
        v_line_duration_days := v_products_duration_days[v_line_idx];
        v_line_price_cop := v_products_price_cop[v_line_idx];
        v_line_price_tiers := v_products_price_tiers[v_line_idx];
        select coalesce(
          (select pc.open from public.product_calendar pc
            where pc.product_id = (v_line->>'product_id')::uuid and pc.date = (v_line->>'date')::date),
          v_products_calendar_default_open[v_line_idx]
        ) into v_calendar_open;

        if not v_sellable then
          return jsonb_build_object('ok', false, 'reason', 'not_sellable', 'line', v_line);
        end if;
        if not v_calendar_open then
          return jsonb_build_object('ok', false, 'reason', 'date_closed', 'line', v_line);
        end if;

        -- Ajout migration evento_online_bookable : un evento gratuit (is_free) n'a jamais de prix
        -- à vérifier — price_cop/price_tiers restent NULL par construction (contrainte DB
        -- products_evento_is_free_price_null), ce n'est jamais une fiche mal remplie.
        if not (v_line_type = 'evento' and v_products_is_free[v_line_idx]) then
          if v_line_price_tiers is null and v_line_price_cop is null then
            return jsonb_build_object('ok', false, 'reason', 'price_missing', 'line', v_line);
          end if;
        end if;

        -- Ajout migration evento_online_bookable : les modes 'unlimited'/'rsvp' n'ont, par
        -- construction, aucune ressource rare à protéger (aucune ligne product_availability
        -- n'existe pour eux, cf. provisionnement plus haut) — aucune lecture ni verrou ici. Le
        -- mode 'metered' retombe dans le bloc existant, inchangé, qui couvre déjà activity/camp.
        -- Migration 20260929112240 : une ligne peut pourtant exister pour ces modes (ancien mode
        -- 'metered', modify_order_line, create_manual_order_line) — la Phase 4 ne l'écrit plus non
        -- plus, par le même prédicat.
        if not (v_line_type = 'evento' and v_products_evento_capacity_mode[v_line_idx] in ('unlimited', 'rsvp')) then
          select capacity, booked into v_capacity, v_booked
            from public.product_availability
           where product_id = (v_line->>'product_id')::uuid and date = (v_line->>'date')::date;
          if not found then
            return jsonb_build_object('ok', false, 'reason', 'slot_not_found', 'line', v_line);
          end if;

          -- Ajout de 20260914130000 : remplissage AVANT cette commande, capturé sous le même verrou
          -- que v_booked ci-dessus (aucune requête supplémentaire) — sert en Phase 4 à décider si la
          -- ligne franchit le seuil de remise (camps uniquement, group_discount_threshold_qty null
          -- pour tout autre type). Valeur déjà cohérente avec la vérification de capacité qui suit.
          v_camp_fill_before_qty[v_line_idx] := v_booked;

          if v_booked + (
            select coalesce(sum((l->>'qty')::int), 0) from jsonb_array_elements(v_lines) l
             where (l->>'product_id')::uuid = (v_line->>'product_id')::uuid
               and (l->>'date')::date = (v_line->>'date')::date
          ) > v_capacity then
            return jsonb_build_object('ok', false, 'reason', 'full', 'line', v_line);
          end if;
        end if;
      end if;

      -- Ajout migration evento_online_bookable : la ressource partagée du prestataire (déjà
      -- verrouillée plus haut) protège désormais aussi un evento réservable qui l'occupe.
      -- Ajout de la migration 20260929112240 : (1) contrôle sorti de la seule branche « date
      -- unique » — la Phase 4 écrit la ressource pour toute ligne camp/evento occupant, quelle que
      -- soit sa branche, elle est donc vérifiée dans les mêmes conditions ; (2) booked + la SOMME
      -- des lignes du panier qui occupent cette ressource ce jour-là (même établissement, même
      -- prédicat et même plage que l'écriture de Phase 4), et non plus la seule qty de la ligne
      -- courante — deux lignes d'un même panier qui se chevauchent s'additionnent, comme
      -- product_availability le fait déjà par produit et date. Aucun verrou de plus : ces lignes
      -- sont celles verrouillées en Phase 2.
      if v_products_type[v_line_idx] = 'camp'
         or (v_products_type[v_line_idx] = 'evento'
             and v_products_online_bookable[v_line_idx]
             and v_products_evento_occupies_resource[v_line_idx])
      then
        for v_gs in 0..(coalesce(v_products_duration_days[v_line_idx], 1) - 1) loop
          select capacity, booked into v_resource_capacity, v_resource_booked
            from public.provider_resource_calendar
           where establishment_id = v_products_establishment_id[v_line_idx]
             and slot_date = (v_line->>'date')::date + v_gs;
          if not found or v_resource_booked + (
            select coalesce(sum((l.elem->>'qty')::int), 0)
              from jsonb_array_elements(v_lines) with ordinality as l(elem, ord)
             where v_products_establishment_id[l.ord::int] = v_products_establishment_id[v_line_idx]
               and (v_products_type[l.ord::int] = 'camp'
                    or (v_products_type[l.ord::int] = 'evento'
                        and v_products_online_bookable[l.ord::int]
                        and v_products_evento_occupies_resource[l.ord::int]))
               and (v_line->>'date')::date + v_gs
                   between (l.elem->>'date')::date
                       and (l.elem->>'date')::date
                           + coalesce(v_products_duration_days[l.ord::int], 1) - 1
          ) > v_resource_capacity then
            return jsonb_build_object('ok', false, 'reason', 'resource_unavailable', 'line', v_line);
          end if;
        end loop;
      end if;
    end;
  end loop;

  -- 2026-09-10 (spec 31 invariant 3) — `and not is_anonymous_session()` ajouté aux DEUX endroits
  -- de ce bloc (lecture ci-dessous, écriture plus bas). Sans cette exclusion, la préférence
  -- d'attribution durable se serait mise à s'écrire sur une IDENTITÉ ANONYME dès l'invariant 1 en
  -- vigueur — chaque commande invité avec ?ref= aurait estampillé le code sur l'identité, et les
  -- commandes suivantes de ce même visiteur l'auraient réutilisé sans ?ref=, source='account'.
  -- Exactement ce que la décision ② interdit (« jamais sur l'identité »), et ce que le §3c du
  -- cahier client (validé 2026-08-13) interdit déjà pour un invité (« vaut pour la réservation en
  -- cours, jamais une préférence durable »). v_account_id seul ne suffit plus à distinguer : après
  -- ce lot, un invité EST v_account_id is not null (son identité anonyme), donc c'est précisément
  -- le test qui aurait laissé passer la régression.
  -- Spec 32 : la source n'est plus un paramètre client mais carts.attribution_code, capté par
  -- CartContext dès le premier ajout au panier (spec 32 §4) — jamais l'identité elle-même (spec
  -- 31 invariant 3). Repli inchangé pour un compte réel sans attribution de panier :
  -- partner_accounts.saved_attribution_code, sa durée de vie dépassant celle d'un panier.
  if v_cart_attribution_code is not null then
    v_attribution_code := v_cart_attribution_code;
    v_attribution_source := v_cart_attribution_source;
  elsif v_identified_account then
    select saved_attribution_code into v_attribution_code
      from public.partner_accounts where id = v_account_id;
    v_attribution_source := 'account';
  end if;

  if v_attribution_code is not null then
    select partner_id into v_referrer_partner_id
      from public.partner_codes
     where code = v_attribution_code and active = true;
  end if;

  if v_referrer_partner_id is null then
    v_attribution_code := null;
    v_attribution_source := null;
  end if;

  if v_identified_account and v_cart_attribution_code is not null and v_referrer_partner_id is not null then
    update public.partner_accounts set saved_attribution_code = v_cart_attribution_code
     where id = v_account_id;
  end if;

  insert into public.orders (
    account_id, holder_name, holder_email, holder_phone, marketing_consent,
    referrer_partner_id, attribution_code, attribution_source
  )
  values (
    v_account_id, p_holder_name, p_holder_email, p_holder_phone, p_marketing_consent,
    v_referrer_partner_id, v_attribution_code, v_attribution_source
  )
  returning id into v_order_id;

  -- Spec 32 : le panier de ce compte n'a plus lieu d'exister dès qu'une commande le remplace —
  -- seulement à partir d'ici (tout retour 'ok', false plus haut laisse cart_items intact, cas
  -- limite de la spec 32 §0).
  delete from public.cart_items where account_id = v_account_id;
  delete from public.carts where account_id = v_account_id;

  for v_line, v_line_idx in
    select elem, ord::int from jsonb_array_elements(v_lines) with ordinality as t(elem, ord)
  loop
    declare
      v_line_partner_id uuid;
      v_line_price_cop bigint;
      v_line_price_tiers jsonb;
      v_total_cop bigint;
      v_commission_case text;
      v_referrer_pct numeric(5, 4);
      v_app_pct numeric(5, 4);
      v_acompte_pct numeric(5, 4);
      v_line_type text;
      v_line_establishment_id uuid;
      v_line_duration_days int;
      v_order_line_id uuid;
      v_line_end_date date := (v_line->>'end_date')::date;
      v_line_qty int := (v_line->>'qty')::int;
      v_line_slot_start_time time := (v_line->>'slot_start_time')::time;
      v_night date;
      v_gs int;
      v_nights int;
      v_sum_nightly bigint;
      v_tier_price bigint;
      v_stay_rates jsonb;
    begin
      if v_line_end_date is not null then
        v_line_partner_id := v_products_partner_id[v_line_idx];
        v_line_price_cop := v_products_price_cop[v_line_idx];
        v_line_price_tiers := v_products_price_tiers[v_line_idx];
        v_line_type := v_products_type[v_line_idx];
        v_line_establishment_id := v_products_establishment_id[v_line_idx];
        v_stay_rates := v_products_stay_rates[v_line_idx];
        select public.resolve_tier_price(v_line_price_tiers, v_line_price_cop, v_line_qty) into v_tier_price;

        v_nights := v_line_end_date - (v_line->>'date')::date;
        v_sum_nightly := 0;
        for v_gs in 0..(v_nights - 1) loop
          v_night := (v_line->>'date')::date + v_gs;
          v_sum_nightly := v_sum_nightly + public.resolve_date_price((v_line->>'product_id')::uuid, v_night, v_tier_price, v_stay_rates);
        end loop;
        if v_products_lobby_category_id[v_line_idx] is null then
          update public.product_availability set booked = booked + v_line_qty
           where product_id = (v_line->>'product_id')::uuid
             and date >= (v_line->>'date')::date and date < v_line_end_date;
        end if;
        v_line_price_cop := v_sum_nightly;
        v_total_cop := v_sum_nightly * v_line_qty;

      elsif v_line_slot_start_time is not null then
        v_line_partner_id := v_products_partner_id[v_line_idx];
        v_line_price_cop := v_products_price_cop[v_line_idx];
        v_line_price_tiers := v_products_price_tiers[v_line_idx];
        v_line_type := v_products_type[v_line_idx];
        v_line_establishment_id := v_products_establishment_id[v_line_idx];
        v_line_duration_days := v_products_duration_days[v_line_idx];
        v_line_price_tiers := public.normalize_price_tiers(v_line_price_tiers);

        if v_line_price_tiers is not null then
          select t.price_cop into v_line_price_cop
            from jsonb_to_recordset(v_line_price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
           where v_line_qty between t.min_qty and t.max_qty
           limit 1;
        end if;

        v_total_cop := v_line_price_cop * v_line_qty;

        update public.product_slot_availability set booked = booked + v_line_qty
         where product_id = (v_line->>'product_id')::uuid
           and slot_date = (v_line->>'date')::date
           and slot_start_time = v_line_slot_start_time;

      else
        v_line_partner_id := v_products_partner_id[v_line_idx];
        v_line_price_cop := v_products_price_cop[v_line_idx];
        v_line_price_tiers := v_products_price_tiers[v_line_idx];
        v_line_type := v_products_type[v_line_idx];
        v_line_establishment_id := v_products_establishment_id[v_line_idx];
        v_line_duration_days := v_products_duration_days[v_line_idx];

        -- Ajout migration evento_online_bookable : un evento gratuit n'a ni price_tiers ni
        -- price_cop (contrainte DB products_evento_is_free_price_null) — prix et total à 0
        -- directement, sans passer par la résolution de palier ni la remise de groupe
        -- (structurellement sans objet pour un evento : group_discount_threshold_qty est
        -- toujours null hors camp).
        if v_line_type = 'evento' and v_products_is_free[v_line_idx] then
          v_line_price_cop := 0;
          v_total_cop := 0;
        else
          v_line_price_tiers := public.normalize_price_tiers(v_line_price_tiers);

          if v_line_price_tiers is not null then
            select t.price_cop into v_line_price_cop
              from jsonb_to_recordset(v_line_price_tiers) as t(min_qty int, max_qty int, price_cop bigint)
             where v_line_qty between t.min_qty and t.max_qty
             limit 1;
          end if;

          -- Ajout de la migration 20260914130000 : remise par seuil de remplissage cumulé, camps
          -- uniquement. Comparaison sur le remplissage APRÈS cette ligne (fill_avant + qty), pas
          -- juste avant — décision actée avec Jérôme : la réservation qui fait elle-même franchir le
          -- seuil en bénéficie (sinon un groupe qui réserve d'un coup assez de places pour franchir
          -- le seuil n'en bénéficierait jamais lui-même). group_discount_threshold_qty est
          -- structurellement null pour tout type autre que camp, donc cette branche n'a aucun effet
          -- en dehors des camps configurés.
          if v_line_type = 'camp'
             and v_products_group_discount_threshold_qty[v_line_idx] is not null
             and v_camp_fill_before_qty[v_line_idx] + v_line_qty
                 >= v_products_group_discount_threshold_qty[v_line_idx]
          then
            v_total_cop := round(
              v_line_price_cop * v_line_qty * (1 - v_products_group_discount_pct[v_line_idx])
            );
          else
            v_total_cop := v_line_price_cop * v_line_qty;
          end if;
        end if;

        -- Ajout de la migration 20260929112240 : même prédicat que la Phase 3, qui ne vérifie jamais
        -- la capacité d'un evento 'unlimited'/'rsvp' — n'écrire que ce qui a été vérifié. Une ligne
        -- product_availability peut subsister pour un tel evento (ancien mode 'metered', lignes
        -- posées par modify_order_line ou create_manual_order_line) : l'incrémenter sans contrôle
        -- heurterait booked <= capacity sur une vente que ces modes ne bloquent jamais.
        if not (v_line_type = 'evento' and v_products_evento_capacity_mode[v_line_idx] in ('unlimited', 'rsvp')) then
          update public.product_availability set booked = booked + v_line_qty
           where product_id = (v_line->>'product_id')::uuid and date = (v_line->>'date')::date;
        end if;
      end if;

      if v_referrer_partner_id is null then
        v_commission_case := 'direct';        v_referrer_pct := 0;    v_app_pct := 0.17;
      elsif v_referrer_partner_id = v_line_partner_id then
        v_commission_case := 'self_referral'; v_referrer_pct := 0;    v_app_pct := 0.09;
      else
        v_commission_case := 'external_referrer'; v_referrer_pct := 0.08; v_app_pct := 0.09;
      end if;

      -- Ajout migration evento_online_bookable : un evento gratuit ou payable sur place ne fait
      -- transiter AUCUN argent par l'app — annuler referrer_pct/app_pct (pas seulement l'acompte)
      -- pour ces deux cas, sinon une commission serait due sans aucune contrepartie financière
      -- réelle collectée en ligne pour la financer (contrairement à toute autre réservation, où
      -- c'est justement l'acompte en ligne qui finance ces commissions). Le prestataire garde
      -- 100 % du prix pour ces lignes. commission_case n'est PAS réécrit (reste
      -- direct/self_referral/external_referrer selon la relation de référencement réelle) — seuls
      -- les pourcentages sont annulés.
      if v_line_type = 'evento'
         and (v_products_is_free[v_line_idx] or v_products_evento_payment_mode[v_line_idx] = 'on_site')
      then
        v_referrer_pct := 0;
        v_app_pct := 0;
      end if;
      v_acompte_pct := v_referrer_pct + v_app_pct;

      -- Ajout de la migration 20260910160000 : holder_phone, holder_email dans la liste de colonnes
      -- et de valeurs (jusqu'ici seul holder_name était dupliqué depuis p_holder_name/
      -- p_holder_email/p_holder_phone déjà disponibles comme paramètres de cette fonction).
      insert into public.order_lines (
        order_id, account_id, product_id, date, end_date, slot_start_time, qty,
        referrer_partner_id, holder_name, holder_phone, holder_email, price_cop, total_cop,
        commission_case, acompte_pct, referrer_pct, app_pct, acompte_cop, referrer_commission_cop,
        app_commission_cop
      )
      values (
        v_order_id, v_account_id, (v_line->>'product_id')::uuid, (v_line->>'date')::date,
        v_line_end_date, v_line_slot_start_time, v_line_qty,
        v_referrer_partner_id, p_holder_name, p_holder_phone, p_holder_email,
        v_line_price_cop, v_total_cop, v_commission_case, v_acompte_pct, v_referrer_pct, v_app_pct,
        round(v_total_cop * v_acompte_pct), round(v_total_cop * v_referrer_pct), round(v_total_cop * v_app_pct)
      )
      returning id into v_order_line_id;

      -- Ajout migration evento_online_bookable : gardé sur le MONTANT réellement calculé (pas
      -- seulement v_referrer_pct > 0) — sans ça, un evento gratuit (v_total_cop = 0, referrer_pct
      -- resté à 0.08 non modifié ci-dessus) violerait quand même ledger_entries_amount_cop_check
      -- (amount_cop > 0) : round(0 * 0.08) = 0.
      if v_commission_case = 'external_referrer' and round(v_total_cop * v_referrer_pct) > 0 then
        insert into public.ledger_entries (
          order_line_id, beneficiary_type, referrer_partner_id, entry_type, amount_cop, status
        )
        values (
          v_order_line_id, 'referrer', v_referrer_partner_id, 'referral_earned',
          round(v_total_cop * v_referrer_pct), 'estimated'
        );
      end if;

      -- Ajout migration evento_online_bookable : un evento réservable qui occupe la ressource
      -- (evento_occupies_resource) suit désormais exactement le même chemin qu'un camp — traité
      -- comme un camp d'un seul jour (coalesce(duration_days, 1) — toujours NULL pour un evento,
      -- jamais pour un camp).
      if v_line_type = 'camp'
         or (v_line_type = 'evento' and v_products_online_bookable[v_line_idx] and v_products_evento_occupies_resource[v_line_idx])
      then
        update public.provider_resource_calendar
           set booked = booked + v_line_qty
         where establishment_id = v_line_establishment_id
           and slot_date between (v_line->>'date')::date
                              and (v_line->>'date')::date + coalesce(v_line_duration_days, 1) - 1;

        insert into public.availability_blocks (
          establishment_id, start_date, end_date, source_order_line_id
        )
        values (
          v_line_establishment_id,
          (v_line->>'date')::date,
          (v_line->>'date')::date + coalesce(v_line_duration_days, 1) - 1,
          v_order_line_id
        );

        -- Migration 20261023120000 (Lobby après l'acompte) : l'e-mail 8 « Reserva confirmada — recurso
        -- bloqueado » (spec 23 §10 point 3) ne part plus d'ici, avant tout paiement — il annonçait une
        -- réservation confirmée pour une commande peut-être jamais payée. Le blocage, lui, reste posé
        -- ici, inchangé. L'e-mail part à la confirmation (notify_order_confirmed : webhook, ou booking
        -- Lobby obtenu), ou plus bas quand rien n'est dû en ligne — même corps, même destinataire,
        -- même dédoublonnage (notify_partner_camp_evento_blocked).
      end if;
    end;
  end loop;

  -- Migration 20261023120000 : rien à payer en ligne (evento gratuit ou payable sur place, seul ou avec
  -- d'autres lignes sans acompte) — la réservation est ferme dès maintenant, l'e-mail 8 part ici.
  -- Sinon il attend la confirmation du paiement (et du booking Lobby). Isolé (spec 23 §8.1) : un
  -- échec de notification ne fait jamais échouer la commande.
  if (select coalesce(sum(ol.acompte_cop), 0) from public.order_lines ol where ol.order_id = v_order_id) = 0 then
    begin
      perform public.notify_partner_camp_evento_blocked(v_order_id);
    exception
      when query_canceled then
        raise warning 'create_order: notification camp annulée (query_canceled) pour commande % — %', v_order_id, sqlerrm;
      when others then
        raise warning 'create_order: échec notification camp pour commande % — %', v_order_id, sqlerrm;
    end;
  end if;

  return jsonb_build_object('ok', true, 'order_id', v_order_id);
end;
$function$;

-- ════════════════════════════════════════════════════════════════════════════════════════════
-- 15. order_for_client_jsonb — redéfinie depuis la vivante (20261019170000) : pms_confirmation, et le
--     WhatsApp du prestataire masqué tant qu'il vaut 'pending' ou 'failed' (D9).
-- ════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.order_for_client_jsonb(p_order orders)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- Migration 20261023120000 (Lobby après l'acompte) : l'état de la réservation chez Lobby d'une commande
  -- PAYÉE dont une nuit PMS n'a pas encore son booking. 'pending' : demande en cours (ou pas encore
  -- posée) ; 'failed' : Lobby a refusé ou l'issue est inconnue, un humain la tient
  -- (pms_reconciliation_entries) ; null sinon. Une commande non payée n'est jamais 'pending'.
  with etat_pms as (
    select case
      when exists (select 1 from public.pms_booking_requests r
                    where r.order_id = (p_order).id and r.status in ('failed', 'needs_human'))
        then 'failed'
      when (p_order).payment_status in ('paid', 'partially_refunded')
           and exists (
             select 1 from public.order_lines ol
               join public.products p on p.id = ol.product_id
              where ol.order_id = (p_order).id
                and ol.status not in ('cancelled_by_client', 'cancelled_by_provider', 'expired', 'superseded')
                and ol.pms_booking_id is null
                and p.type = 'lodging' and p.lobby_category_id is not null)
           and not exists (select 1 from public.pms_booking_requests r
                            where r.order_id = (p_order).id and r.status <> 'pending')
        then 'pending'
    end as pms_confirmation
  ),
  lignes as (
    select
      jsonb_build_object(
        'id', ol.id,
        'product_name', p.name,
        'product_type', p.type,
        'product_slug', p.slug,
        'establishment_name', e.name,
        'establishment_slug', case when e.is_place then null else e.slug end,
        -- 20261019170000 (décision Jérôme) : le WhatsApp du prestataire n'apparaît JAMAIS avant
        -- que la réservation soit finalisée — ligne vivante, ET commande payée, OU rien n'y est dû
        -- en ligne (evento gratuit / payable sur place : l'état « confirmed » d'orderState.ts).
        -- Une commande « unpaid » avec un acompte dû, ou « pending », rend null.
        'establishment_contact_phone', case
          -- Migration 20261023120000 (D9) : jamais tant que Lobby n'a pas confirmé la commande entière
          -- (pms_confirmation 'pending' ou 'failed').
          when (select e2.pms_confirmation from etat_pms e2) is null
           and ol.status not in ('cancelled_by_client', 'cancelled_by_provider', 'expired', 'superseded')
           and ((p_order).payment_status in ('paid', 'partially_refunded')
                or ((p_order).payment_status = 'unpaid'
                    and not exists (
                      select 1 from public.order_lines due
                       where due.order_id = (p_order).id and due.acompte_cop > 0
                         and due.status not in ('cancelled_by_client', 'cancelled_by_provider', 'expired', 'superseded'))))
          then e.contact_phone
        end,
        'date', ol.date,
        'end_date', ol.end_date,
        -- `duration_days` — NUL pour tout ce qui n'est pas `camp` (contrainte
        -- `products_duration_days_required_for_camp`, 20260814220000). L'écran reconstitue la
        -- date de fin d'un camp à partir de `date` + cette valeur, jamais l'inverse.
        'duration_days', p.duration_days,
        'slot_start_time', ol.slot_start_time,
        'qty', ol.qty,
        'price_cop', ol.price_cop,
        'total_cop', ol.total_cop,
        'acompte_cop', ol.acompte_cop,
        'status', ol.status
      ) as ligne,
      ol.created_at as ligne_created_at,
      ol.id as ligne_id,
      ol.total_cop as ligne_total_cop,
      ol.acompte_cop as ligne_acompte_cop,
      (ol.status not in ('cancelled_by_client', 'cancelled_by_provider', 'expired', 'superseded'))
        as vivante
    from public.order_lines ol
    join public.products p on p.id = ol.product_id
    left join public.establishments e on e.id = p.establishment_id
    where ol.order_id = (p_order).id
  )
  select jsonb_build_object(
    'id', (p_order).id,
    'reference', (p_order).reference,
    'payment_status', (p_order).payment_status,
    'created_at', (p_order).created_at,
    'holder_name', (p_order).holder_name,
    'holder_phone', (p_order).holder_phone,
    'holder_email', (p_order).holder_email,
    'total_cop', coalesce(sum(ligne_total_cop) filter (where vivante), 0),
    'acompte_cop', coalesce(sum(ligne_acompte_cop) filter (where vivante), 0),
    -- Spec 39 D3 (20260922100000) : le client a payé, rien n'est honoré — vrai tant qu'une entrée
    -- refund_required (payé après expiration/annulation, écart de montant ; nuit PMS sans booking,
    -- intent remplacé : migration 20261002185102) est ouverte. Un DOUBLE
    -- paiement n'y entre pas : sa réservation EST honorée, seul le doublon est remboursé.
    'payment_received_not_honored', exists (
      select 1 from public.payment_reconciliation_entries e
      join public.payments pay on pay.id = e.payment_id
      where pay.order_id = (p_order).id and e.kind = 'refund_required'
        and e.reason_code in ('paid_after_expiry', 'amount_mismatch', 'pms_booking_missing', 'superseded_intent')
        and e.status in ('open', 'retrying')
    ),
    -- Le dernier remboursement lié à ces mêmes entrées : pending → « en cours », approved → « te
    -- reembolsamos », rejected → l'admin reprend la main (le client reste sur « te contactamos »).
    'refund_status', (
      select r.status from public.payment_refunds r
      join public.payment_reconciliation_entries e on e.id = r.entry_id
      join public.payments pay on pay.id = e.payment_id
      where pay.order_id = (p_order).id
        and e.reason_code in ('paid_after_expiry', 'amount_mismatch', 'pms_booking_missing', 'superseded_intent')
      -- Par PRIORITÉ, pas par date : approved (l'argent est rendu) prime sur pending, qui prime
      -- sur rejected — plusieurs entrées peuvent viser la même commande.
      order by case r.status when 'approved' then 0 when 'pending' then 1 else 2 end, r.created_at desc
      limit 1
    ),
    -- Migration 20261023120000 : 'pending' | 'failed' | null (cf. etat_pms).
    'pms_confirmation', (select e2.pms_confirmation from etat_pms e2),
    -- Ordre INCHANGÉ (20260911100000) : les assertions pgTAP indexent `lines,0`.
    'lines', coalesce(jsonb_agg(ligne order by ligne_created_at, ligne_id), '[]'::jsonb)
  )
  from lignes;
$function$;

-- Avertissements des jobs, et le premier : un paiement traité sans contrôle d'identité Mercado Pago.
--
-- La garde d'identité de reconcile_order / record_mp_payment_status ne joue que si le paiement porte
-- son compte encaisseur (`payments.mp_collector_id`, écrit au mieux par la route de création). Sans
-- lui, la décision est prise quand même — c'est voulu (arbitrage du 2026-10-14 : on garde le
-- comportement, on le signale). Désormais :
--   - les deux fonctions ajoutent `identity_checked: false` à leur résultat dans ce cas (sorties
--     qui suivent la garde seulement : rien n'est décidé avant) ; décisions inchangées ;
--   - le job compte ces décisions par passage et les journalise, sans e-mail ;
--   - un canal d'AVERTISSEMENT générique, distinct de l'erreur : heartbeat_job(…, p_warning) écrit
--     job_heartbeats.last_warning / last_warning_at, effacés au premier passage sans avertissement
--     (comme last_error au premier succès) ; `ok` reste celui du passage ;
--   - admin_jobs_status rend ces deux colonnes, AJOUTÉES en fin : le front actuel lit les autres par
--     leur nom, rien n'est renommé ni retiré.

-- ACCESS EXCLUSIVE sur job_heartbeats le temps de l'ALTER : jamais d'attente sans borne.
select set_config('lock_timeout', '5s', true);

alter table public.job_heartbeats
  add column last_warning text,
  add column last_warning_at timestamptz;
comment on column public.job_heartbeats.last_warning is
  'Avertissement du dernier passage (ce qui s''est déroulé mais mérite d''être vu) ; effacé au premier passage sans avertissement.';

drop function public.heartbeat_job(text, boolean, jsonb, text);
CREATE FUNCTION public.heartbeat_job(p_job text, p_ok boolean, p_stats jsonb DEFAULT '{}'::jsonb, p_error text DEFAULT NULL::text, p_warning text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  -- Migration 20261007003627 : l'instant réel du passage, jamais le début de la transaction de
  -- l'appelant. Les jobs l'appellent par PostgREST (transaction propre, les deux se confondent) ;
  -- un appelant SQL dans une transaction plus longue l'aurait daté de son départ. Un seul instant
  -- pour les deux colonnes.
  v_at constant timestamptz := clock_timestamp();
begin
  insert into public.job_heartbeats as h (job_name, last_run_at, last_ok_at, last_error, stats, last_warning, last_warning_at)
  values (p_job, v_at, case when p_ok then v_at end, case when p_ok then null else left(p_error, 500) end, coalesce(p_stats, '{}'::jsonb),
          left(p_warning, 500), case when p_warning is not null then v_at end)
  on conflict (job_name) do update
    set last_run_at = v_at,
        last_ok_at = case when p_ok then v_at else h.last_ok_at end,
        last_error = case when p_ok then null else left(p_error, 500) end,
        stats = coalesce(p_stats, '{}'::jsonb),
        -- Migration 20261014030249 : un avertissement n'est pas une panne (`ok` reste celui du
        -- passage). Effacé au premier passage qui n'en porte pas, comme last_error au premier
        -- succès (arbitrage du 2026-10-14).
        last_warning = left(p_warning, 500),
        last_warning_at = case when p_warning is not null then v_at end;
end;
$function$;
revoke all on function public.heartbeat_job(text, boolean, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.heartbeat_job(text, boolean, jsonb, text, text) to service_role;

drop function public.admin_jobs_status();
CREATE FUNCTION public.admin_jobs_status()
 RETURNS TABLE(job_name text, stale_after_minutes integer, last_run_at timestamp with time zone, last_ok_at timestamp with time zone, last_error text, alerted_at timestamp with time zone, state text, alert_active boolean, checked_at timestamp with time zone, last_warning text, last_warning_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not (select public.is_admin((select auth.uid()))) then
    raise exception 'admin_jobs_status réservé au rôle admin' using errcode = '42501';
  end if;

  -- Une ligne par job ATTENDU, heartbeat ou pas. Sans ligne de heartbeat (le watchdog la crée à son
  -- prochain passage), l'ancrage est la déclaration de l'attente — celui que le watchdog lui donnera.
  return query
  select
    e.job_name,
    round(extract(epoch from e.stale_after) / 60)::int,
    h.last_run_at,
    h.last_ok_at,
    h.last_error,
    h.alerted_at,
    case
      -- Le prédicat des watchdogs : `stale` exactement quand ils alertent.
      when coalesce(h.last_ok_at, h.created_at, e.created_at) < now() - e.stale_after then 'stale'
      when h.last_run_at is null then 'never'
      -- Migration 20261007003627 : a tourné, n'a encore jamais réussi, dans sa grâce — jamais `ok`.
      when h.last_ok_at is null then 'failing'
      else 'ok'
    end,
    -- Alerte partie, rien de réussi depuis : le watchdog est désarmé jusqu'au prochain succès.
    coalesce(h.alerted_at >= coalesce(h.last_ok_at, h.created_at), false),
    now(),
    h.last_warning,
    h.last_warning_at
  from public.job_expectations e
  left join public.job_heartbeats h on h.job_name = e.job_name
  order by e.job_name;
end;
$function$;
comment on function public.admin_jobs_status() is
  'État des jobs attendus (bandeau admin) : seuil, derniers passages, state ok | failing | stale | never '
  '(failing : a tourné sans jamais réussir, dans sa grâce — 20261007003627), alerte en cours, dernier '
  'avertissement (last_warning, last_warning_at — 20261014030249). Admin seul (42501 sinon).';
revoke all on function public.admin_jobs_status() from public, anon, authenticated;
grant execute on function public.admin_jobs_status() to authenticated;

create or replace function public.reconcile_order(
  p_order_id uuid,
  p_mp_payments jsonb,
  p_checked_at timestamptz,
  p_collector_id text,
  p_expiry_margin interval default interval '2 minutes'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_local record;
  v_mp record;
  v_live boolean;
  v_pending_ids text[] := array[]::text[];
  v_pending_anchor timestamptz;
  v_result jsonb;
  v_applied boolean := false;
  v_status_after text;
  v_identity jsonb;
begin
  select id, payment_status, created_at into v_order
    from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('action', 'noop', 'reason', 'order_not_found');
  end if;

  select exists (
    select 1 from public.order_lines ol
     where ol.order_id = p_order_id and ol.status in ('reserved', 'fulfilled', 'no_show')
  ) into v_live;

  if v_order.payment_status not in ('unpaid', 'pending') then
    update public.orders set reconcile_checked_at = now() where id = p_order_id;
    return jsonb_build_object('action', 'noop', 'reason', 'not_candidate');
  end if;

  -- Identité du token : une recherche vide avec le token d'un AUTRE compte MP est exactement
  -- l'incident du 2026-09-20 — elle ne vaut jamais « pas payé ».
  if exists (
    select 1 from public.payments p
     where p.order_id = p_order_id and p.mp_collector_id is not null
       and p_collector_id is not null and p.mp_collector_id <> p_collector_id
  ) then
    return jsonb_build_object('action', 'identity_mismatch');
  end if;
  -- Migration 20261014030249 : cette garde ne joue que sur un paiement qui porte son compte
  -- (mp_collector_id, écrit au mieux à la création). La décision est prise quand même (arbitrage du
  -- 2026-10-14) ; chaque sortie ci-dessous le dit, et le job le rend visible.
  v_identity := case
    when p_collector_id is null or exists (
      select 1 from public.payments p where p.order_id = p_order_id and p.mp_collector_id is null)
    then jsonb_build_object('identity_checked', false)
    else '{}'::jsonb
  end;

  -- Dernier statut MP connu par paiement local ('none' si MP n'a rien renvoyé).
  for v_local in select p.id from public.payments p where p.order_id = p_order_id loop
    select m->>'status' as status into v_mp
      from jsonb_array_elements(coalesce(p_mp_payments, '[]'::jsonb)) m
     where (m->>'payment_id')::uuid = v_local.id
     order by m->>'date_created' desc nulls last
     limit 1;
    update public.payments
       set mp_last_status = coalesce(v_mp.status, 'none'), mp_last_checked_at = p_checked_at
     where id = v_local.id;
  end loop;

  -- Paiements approuvés OU remboursés/contestés après coup, du plus ancien au plus récent : la
  -- garde du Lot A (rien à honorer, double paiement) et la branche refunded/charged_back du Lot B
  -- décident toutes deux dans apply_payment_webhook_checked ; ici on ne fait que transmettre le
  -- statut réel de chaque paiement, jamais un statut supposé.
  for v_mp in
    select m from jsonb_array_elements(coalesce(p_mp_payments, '[]'::jsonb)) m
     where m->>'status' in ('approved', 'refunded', 'charged_back')
     order by m->>'date_created' asc nulls last
  loop
    v_result := public.apply_payment_webhook_checked(
      v_mp.m->>'mp_payment_id', (v_mp.m->>'payment_id')::uuid, v_mp.m->>'status',
      (v_mp.m->>'transaction_amount')::numeric, v_mp.m
    );
    v_applied := true;
  end loop;

  select payment_status into v_status_after from public.orders where id = p_order_id;
  if v_status_after = 'paid' then
    update public.orders set reconcile_checked_at = now() where id = p_order_id;
    return jsonb_build_object('action', 'applied') || v_identity;
  end if;

  select array_agg(m->>'mp_payment_id'), min((select p.created_at from public.payments p where p.id = (m->>'payment_id')::uuid))
    into v_pending_ids, v_pending_anchor
    from jsonb_array_elements(coalesce(p_mp_payments, '[]'::jsonb)) m
   where m->>'status' in ('pending', 'in_process', 'authorized', 'in_mediation');

  if not v_live then
    -- Plus rien à honorer : on ferme localement (les paiements approuvés ont déjà produit leurs
    -- entrées refund_required ci-dessus) ; un pending chez MP est annulé en meilleur effort par
    -- l'Edge Function (rien à attendre, D2 sans délai).
    update public.payments set status = 'cancelled', updated_at = now()
     where order_id = p_order_id and status = 'pending';
    update public.orders set payment_status = 'unpaid', reconcile_checked_at = now()
     where id = p_order_id;
    return jsonb_build_object('action', 'closed',
      'refund_flagged', v_applied,
      'mp_cancel_ids', coalesce(to_jsonb(v_pending_ids), '[]'::jsonb)) || v_identity;
  end if;

  if v_pending_ids is not null and array_length(v_pending_ids, 1) > 0 then
    update public.orders set reconcile_checked_at = now() where id = p_order_id;
    if v_pending_anchor + interval '2 hours' > now() then
      return jsonb_build_object('action', 'kept_pending') || v_identity;
    end if;
    return jsonb_build_object('action', 'cancel_at_mp', 'mp_cancel_ids', to_jsonb(v_pending_ids)) || v_identity;
  end if;

  if v_order.created_at + interval '30 minutes' + p_expiry_margin < now() then
    v_result := public.expire_payment_order(p_order_id, p_checked_at);
    return jsonb_build_object('action', case when (v_result->>'ok')::boolean then 'expired' else 'kept' end,
                              'expire', v_result) || v_identity;
  end if;

  update public.orders set reconcile_checked_at = now() where id = p_order_id;
  return jsonb_build_object('action', 'kept') || v_identity;
end;
$$;

create or replace function public.record_mp_payment_status(
  p_payment_id uuid,
  p_mp_payments jsonb,
  p_checked_at timestamptz,
  p_collector_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment record;
  v_mp record;
  v_result jsonb := jsonb_build_object('action', 'recorded');
begin
  select p.id, p.order_id, p.mp_collector_id into v_payment
    from public.payments p where p.id = p_payment_id;
  if not found then
    return jsonb_build_object('action', 'noop', 'reason', 'payment_not_found');
  end if;
  perform 1 from public.orders where id = v_payment.order_id for update;

  -- Identité du token : même garde que reconcile_order, symétrique — absente jusqu'ici de ce
  -- chemin (piège 19). Une réponse MP sous un token d'un AUTRE compte ne doit jamais être appliquée.
  if v_payment.mp_collector_id is not null and p_collector_id is not null
     and v_payment.mp_collector_id <> p_collector_id then
    return jsonb_build_object('action', 'identity_mismatch');
  end if;

  -- Approuvés OU remboursés/contestés après coup : même raisonnement que reconcile_order, le vrai
  -- statut de chaque paiement est transmis, jamais 'approved' supposé.
  for v_mp in
    select m from jsonb_array_elements(coalesce(p_mp_payments, '[]'::jsonb)) m
     where m->>'status' in ('approved', 'refunded', 'charged_back')
     order by m->>'date_created' asc nulls last
  loop
    v_result := public.apply_payment_webhook_checked(
      v_mp.m->>'mp_payment_id', p_payment_id, v_mp.m->>'status',
      (v_mp.m->>'transaction_amount')::numeric, v_mp.m
    );
  end loop;

  update public.payments
     set mp_last_status = coalesce(
           (select m->>'status' from jsonb_array_elements(coalesce(p_mp_payments, '[]'::jsonb)) m
             order by m->>'date_created' desc nulls last limit 1),
           'none'),
         mp_last_checked_at = p_checked_at
   where id = p_payment_id;
  -- Migration 20261014030249 : même marqueur que reconcile_order quand la garde n'a pas pu jouer.
  return v_result || case when v_payment.mp_collector_id is null or p_collector_id is null
                          then jsonb_build_object('identity_checked', false) else '{}'::jsonb end;
end;
$$;

-- Bandeau d'état des jobs (lot validé le 2026-10-04) : les attentes de supervision deviennent une
-- TABLE, source unique du watchdog et de l'écran admin.
--
-- ⚠️ ORDRE DE DÉPLOIEMENT. Cette migration fait surveiller les jobs qui n'ont JAMAIS écrit de
-- heartbeat : là où les Edge Functions de P6b-2 (serveJob, heartbeat à chaque passage) ne sont pas
-- déployées, les 5 jobs PMS/e-mails alertent « jamais exécuté » au bout de 20 à 45 min (36 h pour le
-- contrôle nocturne). En PROD : 20261006124933 (les fonctions de P6b-2 appellent ses deux rendus),
-- puis `functions deploy` de P6b-2, puis CETTE migration. Si un même `db push` applique les deux
-- migrations, déployer les fonctions dans les 20 min qui suivent (la grâce la plus courte). En
-- préprod, sans objet au 2026-10-06 (fonctions v7 déployées, 5 heartbeats écrits, le nocturne a 36 h
-- de grâce).
-- Sur une pile locale sans Vault, l'alerte « jamais exécuté » est attendue (payments-reconcile le
-- faisait déjà : sa ligne de heartbeat est pré-créée depuis 20260921100000).
--
-- Avant : les seuils vivaient en dur dans jobs_watchdog (cinq littéraux) et dans
-- payments_reconcile_watchdog (15 min, au prédicat et au sujet de l'e-mail), et un job qui n'avait
-- jamais écrit de heartbeat n'était pas surveillé — une Edge Function qui refuse chaque appel dès le
-- premier (clé du Vault ≠ clé de l'environnement) restait muette pour toujours.
--
-- 1. job_expectations(job_name, stale_after) : un job attendu par cron, son seuil. Ne bouge que par
--    migration (RLS sans policy ; aucune écriture pour anon, authenticated ni service_role). Ses noms
--    sont exactement ceux des crons qui
--    appellent une Edge Function (`invoke_*`) — jobs_watchdog.test.sql le vérifie.
-- 2. MÊME prédicat partout (watchdogs et admin_jobs_status) :
--      coalesce(last_ok_at, created_at) < now() - stale_after
--    Un job attendu sans ligne de heartbeat la reçoit au premier passage du watchdog, datée de la
--    DÉCLARATION de l'attente (job_expectations.created_at) : son délai de grâce est son seuil. Passé,
--    une alerte — une seule, dédupliquée par alerted_at comme les autres — qui dit « nunca se
--    ejecutó ». heartbeat_job ne touche jamais created_at.
-- 3. admin_jobs_status() : une ligne par job attendu, même sans heartbeat. `state` vaut `stale`
--    exactement quand le watchdog alerterait, `never` quand le job n'a jamais tourné et reste dans
--    sa grâce, `ok` sinon ; `alert_active` : l'alerte est partie et rien n'a réussi depuis (le
--    watchdog est alors désarmé, jusqu'au prochain succès).

-- ============================================================================================
-- 1. job_expectations
-- ============================================================================================
create table public.job_expectations (
  job_name text primary key,
  stale_after interval not null check (stale_after > interval '0'),
  created_at timestamptz not null default now()
);
comment on table public.job_expectations is
  'Jobs attendus par cron et leur seuil de silence : source unique de jobs_watchdog, payments_reconcile_watchdog et admin_jobs_status. Ne bouge que par migration.';
alter table public.job_expectations enable row level security;
-- Aucune policy : lue par les fonctions SECURITY DEFINER seulement. service_role garde la lecture
-- (privilèges par défaut du projet), jamais l'écriture : personne n'écrit cette table hors migration.
revoke all on table public.job_expectations from anon, authenticated;
revoke insert, update, delete, truncate on table public.job_expectations from service_role;

-- Seuils de 20261003223900 (3 à 4 passages manqués ; le quotidien : 36 h) et de 20260921100000.
insert into public.job_expectations (job_name, stale_after) values
  ('pms-poll-bookings', interval '45 minutes'),
  ('pms-cancel-bookings', interval '40 minutes'),
  ('pms-sync-availability', interval '20 minutes'),
  ('send-notification-emails', interval '20 minutes'),
  ('pms-nightly-contract-check', interval '36 hours'),
  ('payments-reconcile', interval '15 minutes');

-- ============================================================================================
-- 2. Watchdogs — redéfinis depuis pg_get_functiondef (signatures inchangées, droits conservés)
-- ============================================================================================
create or replace function public.job_watchdog(p_job text, p_stale interval)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_hb record;
  v_subject text;
  v_sent integer;
begin
  -- Verrouillée : un heartbeat en cours d'écriture est attendu, jamais lu dans son état d'avant.
  select * into v_hb from public.job_heartbeats where job_name = p_job for update;
  -- Migration 20261006143045 : un job attendu qui n'a JAMAIS écrit de heartbeat est surveillé lui
  -- aussi. Sa ligne est créée ici, datée de la déclaration de l'attente (à défaut : maintenant) — le
  -- prédicat ci-dessous lui laisse donc son seuil comme délai de grâce.
  if not found then
    insert into public.job_heartbeats (job_name, created_at)
    values (p_job, coalesce((select e.created_at from public.job_expectations e where e.job_name = p_job), now()))
    on conflict (job_name) do nothing;
    select * into v_hb from public.job_heartbeats where job_name = p_job for update;
  end if;

  -- Une alerte par panne : rien de plus tant qu'aucun run n'a réussi depuis la dernière alerte.
  if coalesce(v_hb.last_ok_at, v_hb.created_at) < now() - p_stale
     and (v_hb.alerted_at is null or v_hb.alerted_at < coalesce(v_hb.last_ok_at, v_hb.created_at)) then
    v_subject := 'El job ' || p_job || ' no responde (sin ejecución exitosa desde hace más de '
      || case when p_stale >= interval '1 hour'
              then round(extract(epoch from p_stale) / 3600)::int || ' h'
              else round(extract(epoch from p_stale) / 60)::int || ' min' end
      || ')';
    perform public.notify_all_admins(
      'admin_job_stalled',
      v_subject,
      '<p>Job: ' || public.html_text(p_job) || '.</p>'
        || '<p>Última ejecución exitosa: '
        || coalesce(to_char(v_hb.last_ok_at at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') || ' (hora de Colombia)', 'nunca')
        || '.</p>'
        || '<p>Último error: ' || coalesce(public.html_text(v_hb.last_error), '—') || '.</p>'
        -- Jamais exécuté : des NOMS à vérifier, jamais une valeur (aucun secret, aucune URL).
        || case when v_hb.last_run_at is null
                then '<p>El job nunca se ejecutó: revisar el despliegue de la Edge Function '
                  || public.html_text(p_job) || ', los secretos ' || public.html_text('pms_service_role_key')
                  || ' y ' || public.html_text('pms_functions_base_url') || ' del Vault y '
                  || public.html_text('net._http_response') || '.</p>'
                else '' end,
      'job_heartbeats', null
    );
    -- « Alertée » seulement si un e-mail est réellement parti en file (aucun admin actif, ou
    -- tous les envois en échec → on réessaiera au prochain passage).
    select count(*) into v_sent from public.notification_emails
     where event_type = 'admin_job_stalled' and related_table = 'job_heartbeats'
       and subject = v_subject and created_at = now();
    if v_sent = 0 then
      return false;
    end if;
    update public.job_heartbeats set alerted_at = now() where job_name = p_job;
    return true;
  end if;
  return false;
end;
$function$;

create or replace function public.jobs_watchdog()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_job record;
begin
  -- Migration 20261006143045 : les jobs et leurs seuils viennent de job_expectations (source
  -- unique, lue aussi par admin_jobs_status) — plus aucun littéral ici. payments-reconcile garde son
  -- propre watchdog (payments_reconcile_watchdog, message dédié), qui lit son seuil dans la même
  -- table. Ordre stable : chaque job_watchdog verrouille sa ligne de heartbeat. ⚠️ L'alerte part par
  -- e-mail : celle du job send-notification-emails lui-même ne part qu'une fois l'envoi rétabli.
  for v_job in
    select e.job_name, e.stale_after
      from public.job_expectations e
     where e.job_name <> 'payments-reconcile'
     order by e.job_name
  loop
    perform public.job_watchdog(v_job.job_name, v_job.stale_after);
  end loop;
end;
$function$;

create or replace function public.payments_reconcile_watchdog()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_hb record;
  v_stale interval;
  v_label text;
begin
  -- Migration 20261006143045 : le seuil vient de job_expectations (15 min, inchangé) ; sans attente
  -- déclarée, pas de surveillance (jobs_watchdog.test.sql garantit qu'elle existe).
  select e.stale_after into v_stale from public.job_expectations e where e.job_name = 'payments-reconcile';
  if v_stale is null then
    return;
  end if;
  select * into v_hb from public.job_heartbeats where job_name = 'payments-reconcile';
  -- Sa ligne est pré-créée depuis 20260921100000 ; si elle manque, même règle que job_watchdog.
  if not found then
    insert into public.job_heartbeats (job_name, created_at)
    values ('payments-reconcile',
            coalesce((select e.created_at from public.job_expectations e where e.job_name = 'payments-reconcile'), now()))
    on conflict (job_name) do nothing;
    select * into v_hb from public.job_heartbeats where job_name = 'payments-reconcile';
  end if;
  if coalesce(v_hb.last_ok_at, v_hb.created_at) < now() - v_stale
     and (v_hb.alerted_at is null or v_hb.alerted_at < coalesce(v_hb.last_ok_at, v_hb.created_at)) then
    v_label := case when v_stale >= interval '1 hour'
                    then round(extract(epoch from v_stale) / 3600)::int || ' h'
                    else round(extract(epoch from v_stale) / 60)::int || ' min' end;
    -- Migration 20261002160349 : last_error, texte d'origine externe, échappé (html_text).
    perform public.notify_all_admins(
      'admin_job_stalled',
      'El job de conciliación de pagos no responde desde hace ' || v_label,
      '<p>Última ejecución exitosa: ' || coalesce(v_hb.last_ok_at::text, 'nunca') || '.</p>'
        || '<p>Último error: ' || coalesce(public.html_text(v_hb.last_error), '—') || '.</p>'
        || '<p>Mientras esté detenido, ninguna reserva expira y ningún pago tardío se concilia: revisar secrets, despliegue de la Edge Function y net._http_response.</p>',
      'job_heartbeats', null
    );
    update public.job_heartbeats set alerted_at = now() where job_name = 'payments-reconcile';
  end if;
end;
$function$;

-- ============================================================================================
-- 3. admin_jobs_status() — l'état des jobs pour l'écran admin (bandeau)
-- ============================================================================================
create function public.admin_jobs_status()
returns table (
  job_name text,
  stale_after_minutes integer,
  last_run_at timestamptz,
  last_ok_at timestamptz,
  last_error text,
  alerted_at timestamptz,
  state text,
  alert_active boolean,
  checked_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
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
      else 'ok'
    end,
    -- Alerte partie, rien de réussi depuis : le watchdog est désarmé jusqu'au prochain succès.
    coalesce(h.alerted_at >= coalesce(h.last_ok_at, h.created_at), false),
    now()
  from public.job_expectations e
  left join public.job_heartbeats h on h.job_name = e.job_name
  order by e.job_name;
end;
$$;

comment on function public.admin_jobs_status() is
  'État des jobs attendus (bandeau admin) : seuil, derniers passages, state ok | stale | never, alerte en cours. Admin seul (42501 sinon).';
revoke all on function public.admin_jobs_status() from public, anon, authenticated;
grant execute on function public.admin_jobs_status() to authenticated;

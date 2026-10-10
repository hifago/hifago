-- Rendre une réclamation de job que le passage n'a pas traitée (budget de temps épuisé), sans lui
-- faire payer ce qu'elle n'a pas tenté — appelées par les Edge Functions de jobs (P6b, 2026-10).
--
-- Sans elles :
--   - pms-cancel-bookings : claim_pms_cancellation_batch compte une tentative à chaque entrée
--     réclamée ; une entrée sautée faute de temps la payait quand même, et partait en `failed` au
--     plafond (3) sans avoir été envoyée une seule fois — « chambres possiblement encore bloquées »
--     pour rien, dernier vrai motif écrasé ;
--   - pms-poll-bookings : claim_pms_poll_batch marque interrogées toutes les lignes du lot ; un
--     booking sauté faute de temps restait donc derrière les autres, et dans un lot stable c'étaient
--     toujours les mêmes qui étaient sautés — jamais interrogés.
-- Même contrat que release_notification_email_claim (20261003223900) : appelées par le passage qui
-- détient la réclamation, dans son budget (20 s), très en deçà de l'intervalle de son cron (10 et
-- 15 min) — jamais sur une réclamation d'un autre passage.

create function public.release_pms_cancellation_claim(p_entry_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- La tentative comptée par le claim est rendue ; seules les entrées encore en attente (une entrée
  -- close entre-temps garde son compte). `last_error` n'est pas touché : il garde le dernier motif réel.
  -- Jamais d'attente (skip locked, ordre stable) : set_establishment_pms_connector met en échec les
  -- entrées en attente d'un établissement par un UPDATE multi-lignes — deux UPDATE de lignes communes
  -- dans des ordres différents s'interbloqueraient (même raison que 20261004005336). Une entrée tenue
  -- ailleurs garde sa tentative : elle est en train d'être close.
  update public.pms_cancellation_queue q
     set attempts = greatest(q.attempts - 1, 0)
   where q.id in (
     select q2.id
       from public.pms_cancellation_queue q2
      where q2.id = any(p_entry_ids)
        and q2.status = 'pending'
      order by q2.id
      for update skip locked
   );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.release_pms_cancellation_claim(uuid[]) is
  'Rend des annulations réclamées mais non tentées (budget du passage épuisé) : la tentative du claim est rendue. service_role seul.';
revoke all on function public.release_pms_cancellation_claim(uuid[]) from public, anon, authenticated;
grant execute on function public.release_pms_cancellation_claim(uuid[]) to service_role;

create function public.release_pms_poll_claim(p_order_line_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- La ligne représentante redevient « jamais interrogée » : claim_pms_poll_batch la prend en tête au
  -- passage suivant (nulls first), sœurs comprises. Seules les lignes encore vivantes et bookées.
  -- Règle 8 (`orders` d'abord) : cette fonction écrit order_lines SANS jamais attendre — une ligne
  -- tenue ailleurs (issue du poll, annulation en cours) est sautée et garde son tour —, et ne prend
  -- aucun autre verrou : elle ne peut entrer dans aucun cycle.
  update public.order_lines ol
     set pms_last_polled_at = null
   where ol.id in (
     select l.id
       from public.order_lines l
      where l.id = any(p_order_line_ids)
        and l.status = 'reserved'
        and l.pms_booking_id is not null
      order by l.id
      for update skip locked
   );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.release_pms_poll_claim(uuid[]) is
  'Rend leur tour aux bookings réclamés mais non interrogés (budget du passage épuisé). service_role seul.';
revoke all on function public.release_pms_poll_claim(uuid[]) from public, anon, authenticated;
grant execute on function public.release_pms_poll_claim(uuid[]) to service_role;

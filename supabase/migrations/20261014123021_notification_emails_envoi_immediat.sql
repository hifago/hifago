-- E-mails métier : envoi immédiat dès la mise en file, le cron de 5 minutes reste le filet.
--
-- Constaté en recette de prod le 2026-10-14 : l'invitation de « Nuevo socio » est arrivée au bout de
-- plusieurs minutes — la file notification_emails (spec 23) n'était vidée que par le cron
-- `send-notification-emails` (*/5). Décision de Gabriel : l'e-mail part tout de suite.
--
-- Mécanisme : un trigger PAR INSTRUCTION sur notification_emails appelle le même wrapper que le cron
-- (invoke_send_notification_emails : net.http_post vers l'Edge Function, secrets Vault). pg_net ne
-- fait que mettre la requête en file, dans la transaction : elle ne part qu'APRÈS le commit, et pas
-- du tout si la transaction est annulée — un e-mail d'une opération défaite ne part jamais.
--   - Couvre TOUS les chemins d'écriture (enqueue_notification_email, notify_all_admins, inserts
--     directs) sans toucher à aucun d'eux.
--   - Un seul appel par transaction (drapeau local `hifago.envoi_emails_demande`) : une commande qui
--     enfile plusieurs e-mails ne déclenche qu'un passage, qui les réclame tous après le commit.
--   - Rien n'est appelé si l'instruction n'a inséré aucune ligne `pending` (doublon absorbé par
--     `on conflict do nothing`, ligne insérée déjà envoyée).
--   - Isolation de la spec 23 §8.1 : une panne de l'appel ne fait jamais échouer l'écriture ; la
--     ligne reste `pending` et le cron la reprend.
-- Deux passages simultanés (immédiat + cron) ne s'envoient rien en double : la réclamation est
-- exclusive (claim_notification_email_batch, bail de 10 min).
-- Sans les secrets Vault (tests, CI, pile locale vierge) le wrapper avertit et ne fait rien, comme
-- le cron — tests/support/edgeJobIntegration.mjs exige justement leur absence.

create or replace function public.dispatch_notification_emails_now()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from nouvelles where status = 'pending') then
    return null;
  end if;
  if current_setting('hifago.envoi_emails_demande', true) = 'on' then
    return null;
  end if;
  perform set_config('hifago.envoi_emails_demande', 'on', true);

  begin
    perform public.invoke_send_notification_emails();
  exception
    when query_canceled then
      raise warning 'dispatch_notification_emails_now : appel annulé (query_canceled), le cron reprendra — %', sqlerrm;
    when others then
      raise warning 'dispatch_notification_emails_now : appel impossible, le cron reprendra — %', sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.dispatch_notification_emails_now() from public, anon, authenticated;

create trigger notification_emails_dispatch_now
  after insert on public.notification_emails
  referencing new table as nouvelles
  for each statement
  execute function public.dispatch_notification_emails_now();

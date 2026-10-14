-- Envoi immédiat des e-mails métier (20261014123021) : la mise en file déclenche l'Edge Function
-- par pg_net, une seule fois par transaction, jamais sans ligne `pending`, et jamais au prix de
-- l'écriture. Le compte se lit dans net.http_request_queue (la requête n'y est qu'en file : le
-- rollback final l'annule, rien ne part).
begin;
select plan(9);

create function nb_appels() returns int language sql as $$
  select count(*)::int from net.http_request_queue
   where url = 'https://fonctions.immediat.test/functions/v1/send-notification-emails';
$$;

-- Sans secrets Vault (CI, pile vierge) : l'écriture passe, aucun appel.
delete from vault.secrets where name in ('pms_functions_base_url', 'pms_service_role_key');
select lives_ok(
  $$ select enqueue_notification_email('partner_invitation', 'sans-vault@immediat.test', null, 'S', '<p>C</p>') $$,
  'sans secrets Vault : la mise en file réussit (le cron reprendra)');
select is(nb_appels(), 0, 'sans secrets Vault : aucun appel');

select vault.create_secret('https://fonctions.immediat.test', 'pms_functions_base_url');
select vault.create_secret('cle-factice-immediat', 'pms_service_role_key');
-- La transaction du test a déjà enfilé une ligne : le drapeau « un appel par transaction » est
-- remis à zéro pour mesurer chaque cas séparément.
select set_config('hifago.envoi_emails_demande', '', true);

select enqueue_notification_email('partner_invitation', 'a@immediat.test', null, 'S', '<p>C</p>');
select is(nb_appels(), 1, 'une mise en file → un appel immédiat de send-notification-emails');
select is(
  (select headers->>'Authorization' from net.http_request_queue
    where url = 'https://fonctions.immediat.test/functions/v1/send-notification-emails' limit 1),
  'Bearer cle-factice-immediat',
  'l''appel porte la clé du Vault, comme celui du cron');

select enqueue_notification_email('partner_invitation', 'b@immediat.test', null, 'S', '<p>C</p>');
select is(nb_appels(), 1, 'une seconde mise en file dans la MÊME transaction : pas de second appel');

-- Instruction sans ligne pending : aucun appel, même drapeau remis à zéro.
select set_config('hifago.envoi_emails_demande', '', true);
insert into notification_emails (event_type, recipient_email, subject, body_html, status, sent_at)
values ('partner_invitation', 'deja-envoye@immediat.test', 'S', '<p>C</p>', 'sent', now());
select is(nb_appels(), 1, 'une ligne insérée déjà envoyée ne déclenche rien');

insert into notification_emails (event_type, recipient_email, subject, body_html, status)
values ('partner_invitation', 'direct@immediat.test', 'S', '<p>C</p>', 'pending');
select is(nb_appels(), 2, 'un insert direct pending déclenche aussi l''appel (tous les chemins)');

-- Panne de l'appel : l'écriture n'échoue pas et la ligne attend le cron. Le wrapper est redéfini
-- pour lever (un renommage ne suffirait pas : le plan en cache le retrouve par son OID) ; le
-- rollback final rend la vraie définition.
select set_config('hifago.envoi_emails_demande', '', true);
create or replace function public.invoke_send_notification_emails() returns void
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'panne simulée';
end;
$$;
select lives_ok(
  $$ select enqueue_notification_email('partner_invitation', 'panne@immediat.test', null, 'S', '<p>C</p>') $$,
  'appel en panne : la mise en file réussit quand même');
select is(
  (select status from notification_emails where recipient_email = 'panne@immediat.test'), 'pending',
  'appel en panne : la ligne reste pending, le cron la reprendra');

select * from finish();
rollback;

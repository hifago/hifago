-- Spec 23 Tranche 1 — notification_emails (file + journal), enqueue_notification_email,
-- notify_all_admins, claim_notification_email_batch, mark_notification_email_sent/failed.
-- Migration 20260824020000_notification_emails.sql, seule source de vérité pour la logique.
--
-- Couvre en particulier l'invariant §8.1 (une notification cassée ne doit JAMAIS faire échouer
-- l'opération métier appelante) via fault-injection réelle (redéfinir enqueue_notification_email
-- pour qu'elle lève systématiquement, puis appeler une vraie RPC métier et vérifier qu'elle réussit
-- quand même) — pas une supposition sur le comportement du `exception when others`. Toute
-- redéfinition de fonction faite ici est annulée par le `rollback;` final (transaction unique par
-- fichier pgTAP, cf. hifago/CLAUDE.md §6.3).
begin;
select plan(24);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function test_logout() returns void language sql as $$
  reset request.jwt.claims;
$$;

-- Fixtures : 2 admins actifs (pour notify_all_admins), 1 partenaire/établissement/produit pour le
-- fault-injection sur moderate_product_proposal.
insert into auth.users (id, email) values
  ('99990000-0000-4000-8000-000000000001', 'notif-admin-1@test.local'),
  ('99990000-0000-4000-8000-000000000002', 'notif-admin-2@test.local'),
  ('99990000-0000-4000-8000-000000000003', 'notif-owner@test.local');
insert into partner_capabilities (account_id, role, source, status) values
  ('99990000-0000-4000-8000-000000000001', 'admin', 'migration', 'active'),
  ('99990000-0000-4000-8000-000000000002', 'admin', 'migration', 'active');

insert into partners (id, display_name) values
  ('99990000-0000-4000-8000-000000000011', 'Notification Test Partner');
insert into establishments (id, partner_id, name) values
  ('99990000-0000-4000-8000-000000000012', '99990000-0000-4000-8000-000000000011',
   jsonb_build_object('es', 'Establecimiento Notification Test'));
update partner_accounts set partner_id = '99990000-0000-4000-8000-000000000011'
 where id = '99990000-0000-4000-8000-000000000003';
insert into partner_capabilities (partner_id, role, source, status) values
  ('99990000-0000-4000-8000-000000000011', 'referrer', 'migration', 'active');
insert into partner_capabilities (partner_id, role, source, status, establishment_id) values
  ('99990000-0000-4000-8000-000000000011', 'operator', 'migration', 'active',
   '99990000-0000-4000-8000-000000000012');
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('99990000-0000-4000-8000-000000000013', '99990000-0000-4000-8000-000000000011',
   '99990000-0000-4000-8000-000000000012', 'activity',
   jsonb_build_object('es', 'Producto Notification Test'), 30000, false, 'notif-test-product');

-- enqueue_notification_email — comportement de base -----------------------------------------
-- Appelée en instruction top-level (jamais dans une clause WHERE scannant notification_emails
-- elle-même) : sur une table vide, le planificateur peut ne jamais évaluer une fonction à effet de
-- bord placée dans un WHERE faute de ligne à filtrer — piège constaté en écrivant ce test.
select enqueue_notification_email('partner_invitation', 'a@test.local', null, 'Sujet', '<p>Corps</p>');
select is(
  (select recipient_email from notification_emails where recipient_email = 'a@test.local'),
  'a@test.local',
  'cas 1 : enqueue_notification_email insère une ligne pending avec le bon destinataire'
);
select is(
  (select status from notification_emails where recipient_email = 'a@test.local'),
  'pending',
  'cas 2 : statut initial pending'
);
select is(
  enqueue_notification_email('partner_invitation', null, null, 'Sujet', '<p>Corps</p>'),
  null,
  'cas 3 : destinataire manquant → no-op silencieux (retourne null, aucune exception)'
);
select is(
  enqueue_notification_email('partner_invitation', '  ', null, 'Sujet', '<p>Corps</p>'),
  null,
  'cas 4 : destinataire vide (espaces) → no-op silencieux'
);

-- Dédup (spec 23 §10 point 4, corrigée après challenge — coalesce sur recipient_account_id) ---
select is(
  (select count(*)::int from notification_emails
    where event_type = 'partner_proposal_decided' and related_id = '99990000-0000-4000-8000-000000000099'),
  0,
  'cas 5 (avant) : aucune ligne pour cette entité avant le test de dédup'
);
select enqueue_notification_email(
  'partner_proposal_decided', 'dup@test.local', '99990000-0000-4000-8000-000000000003'::uuid,
  'Sujet', '<p>Corps</p>', 'product_proposals', '99990000-0000-4000-8000-000000000099'::uuid
);
select enqueue_notification_email(
  'partner_proposal_decided', 'dup@test.local', '99990000-0000-4000-8000-000000000003'::uuid,
  'Sujet', '<p>Corps</p>', 'product_proposals', '99990000-0000-4000-8000-000000000099'::uuid
);
select is(
  (select count(*)::int from notification_emails
    where event_type = 'partner_proposal_decided' and related_id = '99990000-0000-4000-8000-000000000099'),
  1,
  'cas 6 : deux enqueue identiques (même event/related/recipient_account_id) → une seule ligne'
);

select enqueue_notification_email(
  'partner_invitation', 'dup-null@test.local', null,
  'Sujet', '<p>Corps</p>', 'partner_invitations', '99990000-0000-4000-8000-000000000098'::uuid
);
select enqueue_notification_email(
  'partner_invitation', 'dup-null@test.local', null,
  'Sujet', '<p>Corps</p>', 'partner_invitations', '99990000-0000-4000-8000-000000000098'::uuid
);
select is(
  (select count(*)::int from notification_emails
    where event_type = 'partner_invitation' and related_id = '99990000-0000-4000-8000-000000000098'),
  1,
  'cas 7 : dédup fonctionne aussi avec recipient_account_id NULL (coalesce, spec 23 §10 point 4)'
);

-- claim_notification_email_batch — SKIP LOCKED, reprise des lignes 'sending' bloquées --------
-- Purge d'abord les lignes pending accumulées par les cas 1-7 : claim_notification_email_batch
-- réclame par ordre de created_at, un p_limit trop bas piocherait sinon une ligne plus ancienne
-- que celle visée par ce cas précis.
delete from notification_emails;
insert into notification_emails (id, event_type, recipient_email, subject, body_html, status)
values ('99990000-0000-4000-8000-000000000201', 'partner_invitation', 'claim-pending@test.local', 'S', '<p>C</p>', 'pending');
select is(
  (select status from claim_notification_email_batch(1) where id = '99990000-0000-4000-8000-000000000201'),
  'sending',
  'cas 8 : claim_notification_email_batch réclame une ligne pending et passe son statut à sending'
);
select is(
  (select attempts from notification_emails where id = '99990000-0000-4000-8000-000000000201'),
  1,
  'cas 9 : claim incrémente attempts'
);

insert into notification_emails (id, event_type, recipient_email, subject, body_html, status, last_attempt_at)
values ('99990000-0000-4000-8000-000000000202', 'partner_invitation', 'claim-recent-sending@test.local', 'S', '<p>C</p>', 'sending', now());
select is(
  (select count(*)::int from claim_notification_email_batch(50) where id = '99990000-0000-4000-8000-000000000202'),
  0,
  'cas 10 : une ligne sending récente (< 10 min) n''est jamais reprise'
);

insert into notification_emails (id, event_type, recipient_email, subject, body_html, status, last_attempt_at)
values ('99990000-0000-4000-8000-000000000203', 'partner_invitation', 'claim-stale-sending@test.local', 'S', '<p>C</p>', 'sending', now() - interval '11 minutes');
select is(
  (select count(*)::int from claim_notification_email_batch(50) where id = '99990000-0000-4000-8000-000000000203'),
  1,
  'cas 11 : une ligne sending bloquée depuis >10 min est reprise (spec 23 §8.4 — crash Edge Function)'
);

-- mark_notification_email_sent / mark_notification_email_failed ------------------------------
select mark_notification_email_sent('99990000-0000-4000-8000-000000000201', 'resend-msg-id-1');
select results_eq(
  $$ select status, provider_message_id from notification_emails where id = '99990000-0000-4000-8000-000000000201' $$,
  $$ values ('sent'::text, 'resend-msg-id-1'::text) $$,
  'cas 12 : mark_notification_email_sent renseigne status/provider_message_id/sent_at'
);
select isnt(
  (select sent_at from notification_emails where id = '99990000-0000-4000-8000-000000000201'),
  null,
  'cas 13 : sent_at renseigné'
);

select mark_notification_email_failed('99990000-0000-4000-8000-000000000202', 'boom', 5);
select is(
  (select status from notification_emails where id = '99990000-0000-4000-8000-000000000202'),
  'pending',
  'cas 14 : échec avec attempts(1) < max(5) → repasse pending pour retry'
);

update notification_emails set attempts = 5 where id = '99990000-0000-4000-8000-000000000202';
select mark_notification_email_failed('99990000-0000-4000-8000-000000000202', 'boom encore', 5);
select is(
  (select status from notification_emails where id = '99990000-0000-4000-8000-000000000202'),
  'abandoned',
  'cas 15 : échec avec attempts >= max → abandoned, plus jamais repris'
);

-- Grants (défense en profondeur, spec 23 §8.3/§10 point 7) -----------------------------------
select is(
  has_function_privilege('authenticated', 'claim_notification_email_batch(int)', 'execute'),
  false,
  'cas 16 : claim_notification_email_batch inexécutable par authenticated'
);
select is(
  has_function_privilege('service_role', 'claim_notification_email_batch(int)', 'execute'),
  true,
  'cas 17 : claim_notification_email_batch exécutable par service_role'
);
select is(
  has_function_privilege('authenticated', 'enqueue_notification_email(text,text,uuid,text,text,text,uuid,text)', 'execute'),
  false,
  'cas 18 : enqueue_notification_email inexécutable par authenticated (nested-call only, spec 23 §8.3)'
);
select is(
  has_function_privilege('anon', 'notify_all_admins(text,text,text,text,uuid)', 'execute'),
  false,
  'cas 19 : notify_all_admins inexécutable par anon'
);

-- notify_all_admins — fan-out + isolation PAR ADMIN (spec 23 §8.2) ---------------------------
-- Filtré sur les 2 admins de fixture (pas un count total) : le seed local porte déjà un admin
-- (admin@hifago.test), notify_all_admins doit légitimement le notifier aussi — pas l'objet de
-- ce cas précis.
select notify_all_admins('admin_new_proposal', 'Sujet fan-out', '<p>Corps</p>', 'products', '99990000-0000-4000-8000-000000000013'::uuid);
select is(
  (select count(*)::int from notification_emails
    where event_type = 'admin_new_proposal' and related_id = '99990000-0000-4000-8000-000000000013'
      and recipient_email in ('notif-admin-1@test.local', 'notif-admin-2@test.local')),
  2,
  'cas 20 : notify_all_admins enqueue une ligne pour chacun des 2 admins de fixture'
);

-- Fault-injection ciblée : enqueue_notification_email échoue UNIQUEMENT pour un destinataire
-- précis ("admin empoisonné") — prouve que l'isolation est posée PAR ITÉRATION (spec 23 §8.2), pas
-- autour de toute la boucle (un begin/exception entourant la boucle entière aurait, lui, empêché
-- l'admin suivant de recevoir sa notification).
-- security definer + search_path='' + schéma qualifié : identique à la vraie définition (nested
-- depuis notify_all_admins, qui exécute déjà sous search_path=''), sinon "relation notification_
-- emails does not exist" pour TOUS les admins, pas seulement celui volontairement empoisonné —
-- piège rencontré en écrivant ce test, corrigé ici.
create or replace function enqueue_notification_email(
  p_event_type text, p_recipient_email text, p_recipient_account_id uuid,
  p_subject text, p_body_html text, p_related_table text default null, p_related_id uuid default null,
  p_reply_to text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_recipient_email = 'notif-admin-1@test.local' then
    raise exception 'fault injection : admin empoisonné';
  end if;
  insert into public.notification_emails (
    event_type, recipient_email, recipient_account_id, subject, body_html, related_table, related_id
  ) values (
    p_event_type, p_recipient_email, p_recipient_account_id, p_subject, p_body_html, p_related_table, p_related_id
  ) returning id into v_id;
  return v_id;
end;
$$;

select lives_ok(
  $$ select notify_all_admins('admin_new_proposal', 'Sujet poisoned', '<p>Corps</p>', 'products', '99990000-0000-4000-8000-000000000014'::uuid) $$,
  'cas 21 : notify_all_admins ne lève jamais, même si un admin fait échouer son enqueue'
);
select is(
  (select count(*)::int from notification_emails
    where event_type = 'admin_new_proposal' and related_id = '99990000-0000-4000-8000-000000000014'
      and recipient_email = 'notif-admin-2@test.local'),
  1,
  'cas 22 : l''admin NON empoisonné reçoit quand même sa notification (isolation par itération, pas par boucle)'
);

-- Fault-injection sur l'invariant §8.1 : une VRAIE RPC métier (moderate_product_proposal) doit
-- réussir même si enqueue_notification_email échoue TOUJOURS — pas une supposition sur le
-- comportement du `exception when others`, une preuve concrète (technique recommandée par le
-- challenge adversarial du 2026-08-24).
create or replace function enqueue_notification_email(
  p_event_type text, p_recipient_email text, p_recipient_account_id uuid,
  p_subject text, p_body_html text, p_related_table text default null, p_related_id uuid default null,
  p_reply_to text default null
) returns uuid language plpgsql as $$
begin
  raise exception 'fault injection : enqueue_notification_email toujours en échec';
end;
$$;

set local role authenticated;
select test_login('99990000-0000-4000-8000-000000000003'); -- operator du produit de test
select submit_product_proposal(
  '99990000-0000-4000-8000-000000000013'::uuid,
  jsonb_build_object('name', jsonb_build_object('es', 'Nom corrigé'), 'price_cop', 30000)
);
reset role;

select test_login('99990000-0000-4000-8000-000000000001'); -- admin
set local role authenticated;
select lives_ok(
  format(
    $$ select moderate_product_proposal(%L::uuid, 'approve', 1) $$,
    (select id from product_proposals order by created_at desc limit 1)
  ),
  'cas 23 : moderate_product_proposal réussit MÊME QUAND enqueue_notification_email échoue systématiquement (spec 23 §8.1)'
);
select is(
  (select status from product_proposals order by created_at desc limit 1),
  'approved',
  'cas 24 : la proposition est bien passée approved malgré l''échec systématique de la notification'
);
reset role;

select * from finish();
rollback;

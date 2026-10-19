-- create_partner_direct (« Nuevo socio ») : l'invitation part aussi par e-mail quand un e-mail est
-- saisi (20261014024303). Même mécanisme et même isolation que create_partner_invitation : sans
-- secret Vault, sans e-mail ou sans invitation demandée, le socio est créé et rien n'est enfilé.
-- Comptages scopés par les identifiants des fixtures (base locale partagée).
begin;
select plan(21);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into auth.users (id, email) values ('7d1e0000-0000-4000-8000-000000000001', 'direct-admin@test.local');
insert into partner_capabilities (account_id, role, source, status)
  values ('7d1e0000-0000-4000-8000-000000000001', 'admin', 'migration', 'active');

-- Sans le secret d'abord (recréé plus bas ; tout est annulé par le rollback).
delete from vault.secrets where name = 'admin_app_public_url';

create temp table resultats (cas text primary key, r jsonb);
grant all on resultats to authenticated;

set local role authenticated;
select test_login('7d1e0000-0000-4000-8000-000000000001');
insert into resultats values ('sans_secret', create_partner_direct(
  'Direct sans secret', array['referrer'], p_email => 'sans-secret@test.local', p_code => 'DIRECT-T1'));
reset role;

select ok((select (r->>'ok')::boolean from resultats where cas = 'sans_secret'),
  'sans secret Vault : le socio est quand même créé');
select is((select (r->>'invitation_email_enqueued')::boolean from resultats where cas = 'sans_secret'), false,
  'sans secret Vault : drapeau invitation_email_enqueued = false');
select is((select count(*)::int from notification_emails
            where related_id = (select (r->>'invitation_id')::uuid from resultats where cas = 'sans_secret')), 0,
  'sans secret Vault : aucun e-mail enfilé');

select vault.create_secret('https://admin.direct.test', 'admin_app_public_url');

set local role authenticated;
select test_login('7d1e0000-0000-4000-8000-000000000001');
insert into resultats values ('avec_email', create_partner_direct(
  'Direct avec email', array['operator'], p_email => '  socio@test.local ', p_code => 'DIRECT-T2'));
insert into resultats values ('sans_email', create_partner_direct(
  'Direct sans email', array['referrer'], p_email => '   ', p_code => 'DIRECT-T3'));
insert into resultats values ('sans_invitation', create_partner_direct(
  'Direct sans invitation', array['referrer'], p_email => 'pas-invite@test.local', p_send_invitation => false));
insert into resultats values ('referent', create_partner_direct(
  '<b>Ana</b> & co', array['referrer'], p_email => 'referent@test.local', p_code => 'DIRECT-T5',
  p_invitation_expires_days => 1));
reset role;

-- Cas nominal : un e-mail d'invitation au socio, lié à son invitation, avec le lien du jeton rendu.
select is((select (r->>'invitation_email_enqueued')::boolean from resultats where cas = 'avec_email'), true,
  'avec e-mail : drapeau invitation_email_enqueued = true');
select is(
  (select count(*)::int from notification_emails
    where event_type = 'partner_invitation' and related_table = 'partner_invitations'
      and related_id = (select (r->>'invitation_id')::uuid from resultats where cas = 'avec_email')), 1,
  'avec e-mail : exactement un e-mail partner_invitation lié à l''invitation');
select is(
  (select recipient_email from notification_emails
    where related_id = (select (r->>'invitation_id')::uuid from resultats where cas = 'avec_email')),
  'socio@test.local',
  'avec e-mail : destinataire = l''e-mail saisi, espaces retirés');
select ok(
  strpos(
    (select body_html from notification_emails
      where related_id = (select (r->>'invitation_id')::uuid from resultats where cas = 'avec_email')),
    'https://admin.direct.test/partner/join?token=' || (select r->>'invitation_token' from resultats where cas = 'avec_email')
  ) > 0,
  'avec e-mail : le corps porte le lien admin du secret Vault et le jeton rendu à l''écran');
select is(
  (select email from partner_invitations
    where id = (select (r->>'invitation_id')::uuid from resultats where cas = 'avec_email')),
  'socio@test.local',
  'avec e-mail : l''invitation porte l''e-mail, comme celles de create_partner_invitation');
select is(
  (select onboarding_path from partner_invitations
    where id = (select (r->>'invitation_id')::uuid from resultats where cas = 'avec_email')),
  'provider',
  'avec e-mail : parcours inchangé (opérateur → provider)');

-- E-mail vide : invitation créée, lien à l'écran seulement.
select isnt((select r->>'invitation_id' from resultats where cas = 'sans_email'), null,
  'e-mail blanc : l''invitation est créée');
select is((select (r->>'invitation_email_enqueued')::boolean from resultats where cas = 'sans_email'), false,
  'e-mail blanc : aucun e-mail (drapeau false)');
select is((select count(*)::int from notification_emails
            where related_id = (select (r->>'invitation_id')::uuid from resultats where cas = 'sans_email')), 0,
  'e-mail blanc : rien enfilé');

-- Invitation non demandée : ni invitation ni e-mail, même avec un e-mail saisi.
select is((select r->>'invitation_id' from resultats where cas = 'sans_invitation'), null,
  'sans invitation : aucune invitation créée');
select is((select count(*)::int from notification_emails where recipient_email = 'pas-invite@test.local'), 0,
  'sans invitation : aucun e-mail au socio');

-- Contenu de l'e-mail de bienvenue (20261019130000) : sujet, nom, puces selon le parcours, durée.
create temp view corps as
  select cas, (select body_html from notification_emails where related_id = (r->>'invitation_id')::uuid) as html,
         (select subject from notification_emails where related_id = (r->>'invitation_id')::uuid) as sujet
    from resultats;
select is((select sujet from corps where cas = 'avec_email'), 'Te damos la bienvenida a Hifago',
  'bienvenue : sujet');
select ok(strpos((select html from corps where cas = 'avec_email'), 'Hola Direct avec email,') > 0,
  'bienvenue : salutation au nom de la fiche socio');
select ok(strpos((select html from corps where cas = 'avec_email'), 'gestionar tu disponibilidad y tus reservas') > 0,
  'bienvenue prestataire : puce établissement/réservations');
select ok(strpos((select html from corps where cas = 'avec_email'), 'vence en 14 días') > 0,
  'bienvenue : durée réelle de l''invitation');
select ok(strpos((select html from corps where cas = 'referent'), 'gestionar tu disponibilidad') = 0
          and strpos((select html from corps where cas = 'referent'), 'seguir las comisiones que generan tus recomendaciones') > 0,
  'bienvenue référent : seulement lien/QR et commissions');
select ok(strpos((select html from corps where cas = 'referent'), 'Hola &lt;b&gt;Ana&lt;/b&gt; &amp; co,') > 0,
  'bienvenue : nom du socio échappé');
select ok(strpos((select html from corps where cas = 'referent'), 'vence en 1 día.') > 0,
  'bienvenue : singulier pour un jour');

select * from finish();
rollback;

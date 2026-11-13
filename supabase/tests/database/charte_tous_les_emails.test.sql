-- Charte Hifago sur TOUS les e-mails (migration 20261112150000, décision Jérôme du 2026-11-12).
--
-- CE QUE CE FICHIER DOIT PROUVER :
--   - le point de passage unique tient : aucune fonction de public n'écrit dans notification_emails
--     sauf enqueue_notification_email (sinon un e-mail échapperait à l'habillage) ;
--   - un corps nu reçoit l'habillage : en-tête image à adresse absolue (bandeau texte sans le secret
--     Vault), titre = sujet échappé avec le point or, liens nus au bleu moyen, pied marine ;
--   - un corps qui porte son <h2> garde son titre (pas de second) ; un corps déjà habillé ne l'est
--     pas deux fois ;
--   - les e-mails réels de la file l'ont : invitation partenaire, alerte admin (notify_all_admins).
-- Le client et le prestataire : client_order_confirmed_email / partner_order_confirmed_email.
begin;
select plan(13);

delete from vault.secrets where name = 'web_app_public_url';
select vault.create_secret('https://web.cte.test', 'web_app_public_url');

-- Seuls les e-mails de ce fichier comptent (la base locale est partagée).
create temp table cte_ids (cas text primary key, id uuid);

-- Le point de passage unique
select is(
  array(select p.proname::text
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prokind = 'f' and p.proname <> 'enqueue_notification_email'
           and regexp_replace(pg_get_functiondef(p.oid), E'--[^\n]*', '', 'g') ~* 'insert[[:space:]]+into[[:space:]]+(public\.)?notification_emails'
         order by 1),
  '{}'::text[],
  'seule enqueue_notification_email écrit dans la file : aucun e-mail n''échappe à l''habillage');

-- Un corps nu, comme celui des alertes et des verdicts
insert into cte_ids values ('nu', enqueue_notification_email(
  'admin_new_reconciliation_exception', 'cte-admin@test.local', null,
  'Nueva excepción <b>x</b>', '<p>Detalle</p><p><a href="https://admin.cte.test/x">Ver</a></p>',
  'orders', 'c7e00000-0000-4000-8000-000000000001'));
create temp view cte_nu as select body_html from notification_emails where id = (select id from cte_ids where cas = 'nu');

select ok((select body_html from cte_nu) like '<div data-hifago-email="1"%', 'un corps nu est habillé');
select ok((select body_html from cte_nu) like '%<img src="https://web.cte.test/brand/email-cabecera.jpg"%alt="Hifago · Guatapé merece más de un día."%',
  'en-tête : l''image de la charte, adresse absolue, texte alternatif');
select ok((select body_html from cte_nu) like '%Nueva excepción &lt;b&gt;x&lt;/b&gt;<span style="color:#ddae09">.</span></h2>%',
  'titre = le sujet, échappé, avec le point or');
select ok((select body_html from cte_nu) like '%<a href="https://admin.cte.test/x" style="color:#2a618e;text-decoration:underline">Ver</a>%',
  'un lien nu prend le bleu moyen souligné');
select ok((select body_html from cte_nu) like '%background:#132f61%Hifago · Guatapé, Antioquia · <a href="https://web.cte.test"%web.cte.test</a>%',
  'pied de page marine avec le lien du site');

-- Un corps qui porte son titre ; un corps déjà habillé
insert into cte_ids values ('titre', enqueue_notification_email(
  'admin_new_reconciliation_exception', 'cte-admin@test.local', null,
  'Sujet ignoré', email_titulo('Mi título') || '<p>x</p>', 'orders', 'c7e00000-0000-4000-8000-000000000002'));
select ok((select body_html from notification_emails where id = (select id from cte_ids where cas = 'titre')) like '%Mi título%'
          and (select body_html from notification_emails where id = (select id from cte_ids where cas = 'titre')) not like '%Sujet ignoré%',
  'un corps qui commence par son <h2> garde son titre, le sujet n''en ajoute pas un second');

insert into cte_ids values ('double', enqueue_notification_email(
  'admin_new_reconciliation_exception', 'cte-admin@test.local', null,
  'Doble', (select body_html from cte_nu), 'orders', 'c7e00000-0000-4000-8000-000000000003'));
select is((select (length(body_html) - length(replace(body_html, 'data-hifago-email', ''))) / length('data-hifago-email')
             from notification_emails where id = (select id from cte_ids where cas = 'double')), 1,
  'un corps déjà habillé ne l''est pas deux fois');

-- Sujet qui finit par une ponctuation : pas de second point
select ok(email_titulo('¿Listo?') not like '%#ddae09%', 'titre déjà ponctué : pas de point or ajouté');

-- Sans le secret Vault
delete from vault.secrets where name = 'web_app_public_url';
insert into cte_ids values ('sans', enqueue_notification_email(
  'admin_new_reconciliation_exception', 'cte-admin@test.local', null,
  'Sin secreto', '<p>x</p>', 'orders', 'c7e00000-0000-4000-8000-000000000004'));
select ok((select body_html from notification_emails where id = (select id from cte_ids where cas = 'sans')) not like '%<img%'
          and (select body_html from notification_emails where id = (select id from cte_ids where cas = 'sans')) like '%hifago · Guatapé</div>%',
  'sans le secret : bandeau texte, jamais une image à adresse relative');
select vault.create_secret('https://web.cte.test', 'web_app_public_url');

-- E-mails réels : l'invitation partenaire, une alerte aux admins (notify_all_admins)
insert into cte_ids values ('invit', enqueue_notification_email(
  'partner_invitation', 'cte-socio@test.local', null, 'Te damos la bienvenida a Hifago',
  partner_invitation_email_html('https://admin.cte.test/partner/join?token=abc', 'provider', 'Ana', 14),
  'orders', 'c7e00000-0000-4000-8000-000000000005'));
select ok((select body_html from notification_emails where id = (select id from cte_ids where cas = 'invit'))
            like '%email-cabecera.jpg%Te damos la bienvenida a Hifago<span%Hola Ana,%href="https://admin.cte.test/partner/join?token=abc" style="display:inline-block;background:#ddae09%Crear mi cuenta%',
  'invitation partenaire : habillée, titre, bouton or');
select ok((select body_html from notification_emails where id = (select id from cte_ids where cas = 'invit')) not like '%HIFAGO</div>%',
  'invitation partenaire : l''ancien bandeau « HIFAGO » a disparu');

insert into auth.users (id, email) values ('c7e00000-0000-4000-8000-000000000011', 'cte-admin2@test.local');
insert into partner_capabilities (account_id, role, source, status) values
  ('c7e00000-0000-4000-8000-000000000011', 'admin', 'migration', 'active');
select notify_all_admins('admin_new_reconciliation_exception', 'Alerta CTE', '<p>Algo</p>',
  'orders', 'c7e00000-0000-4000-8000-000000000006');
select ok((select body_html from notification_emails
            where recipient_email = 'cte-admin2@test.local' and related_id = 'c7e00000-0000-4000-8000-000000000006')
            like '<div data-hifago-email="1"%Alerta CTE<span%',
  'une alerte aux admins (notify_all_admins) est habillée');

select * from finish();
rollback;

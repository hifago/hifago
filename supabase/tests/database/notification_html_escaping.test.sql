-- Corps HTML des e-mails (migration 20261002160349) : chaque valeur venue des données passe par
-- public.html_text, et l'e-mail admin d'une nouvelle proposition porte un lien absolu.
--
-- CE QUE CE FICHIER DOIT PROUVER :
--   - site par site, la valeur piégée arrive échappée dans le corps (une assertion par site, pour
--     qu'une mutation qui retire UN échappement rougisse) ;
--   - un sujet (confirmation client) reste du texte brut (S1) ;
--   - le lien de notify_admin_new_proposal est relatif sans le secret Vault, absolu avec, et porte
--     ?entity=establishment pour une proposition d'établissement ;
--   - une proposition d'établissement sans nom (photos) notifie, avec le nom de l'établissement ;
--   - méta-test du catalogue : toute fonction de public qui émet un e-mail HTML appelle html_text
--     ou figure dans la liste blanche ; chaque entrée de la liste blanche existe et en émet encore ;
--     tout appelant de html_text est SECURITY DEFINER (html_text est révoquée pour anon et
--     authenticated). C'est un filet PAR FONCTION : une valeur brute ajoutée dans une fonction qui
--     échappe déjà ailleurs ne s'y voit pas — les assertions site par site couvrent les sites
--     existants, la revue couvre les nouveaux. Ne le voient pas non plus : un commentaire /* */
--     (seuls les commentaires -- sont retirés ; aucun /* */ dans public aujourd'hui), une procédure
--     (prokind 'p'), enqueue_notification_email et notify_all_admins elles-mêmes (elles transportent
--     le corps), un insert direct dans notification_emails sans balise de la liste.
-- Le nom de produit de create_order (« recurso bloqueado ») est couvert par create_order.test.sql,
-- cas 24k.
begin;
select plan(21);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Le lien admin part SANS secret (il est créé plus bas pour la branche absolue ; tout est annulé
-- par le rollback).
delete from vault.secrets where name = 'admin_app_public_url';

insert into auth.users (id, email) values
  ('9a5c0000-0000-4000-8000-000000000001', 'esc-admin@test.local'),
  ('9a5c0000-0000-4000-8000-000000000002', 'esc-partner@test.local'),
  ('9a5c0000-0000-4000-8000-000000000003', 'esc-client@test.local');
insert into partner_capabilities (account_id, role, source, status) values
  ('9a5c0000-0000-4000-8000-000000000001', 'admin', 'migration', 'active');
insert into partners (id, display_name) values
  ('9a5c0000-0000-4000-8000-000000000011', '<u>Socio</u> & co');
update partner_accounts set partner_id = '9a5c0000-0000-4000-8000-000000000011'
 where id = '9a5c0000-0000-4000-8000-000000000002';
insert into establishments (id, partner_id, name) values
  ('9a5c0000-0000-4000-8000-000000000012', '9a5c0000-0000-4000-8000-000000000011',
   jsonb_build_object('es', '<q>Sitio</q> & co'));
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('9a5c0000-0000-4000-8000-000000000013', '9a5c0000-0000-4000-8000-000000000011',
   '9a5c0000-0000-4000-8000-000000000012', 'activity',
   jsonb_build_object('es', '<i>Prod</i> & ''co'''), 100000, true, 'esc-test-product');

-- Trois commandes : la référence est posée à la main, piégée (aucune contrainte ne la borne).
insert into orders (id, account_id, holder_name, holder_email, reference) values
  ('9a5c0000-0000-4000-8000-000000000021', '9a5c0000-0000-4000-8000-000000000003',
   '<b>Holder</b> & "q"', 'esc-client@test.local', '<em>REF-1</em>'),
  ('9a5c0000-0000-4000-8000-000000000022', '9a5c0000-0000-4000-8000-000000000003',
   '<b>Holder</b> & "q"', 'esc-client@test.local', '<em>REF-2</em>'),
  ('9a5c0000-0000-4000-8000-000000000023', '9a5c0000-0000-4000-8000-000000000003',
   '<b>Holder</b> & "q"', 'esc-client@test.local', '<em>REF-3</em>');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '9a5c0000-0000-4000-8000-000000000031', '9a5c0000-0000-4000-8000-000000000021',
  '9a5c0000-0000-4000-8000-000000000003', '9a5c0000-0000-4000-8000-000000000013',
  '2029-03-01', 1, 'reserved', 'Holder', 100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000
);
insert into payments (id, order_id, status, amount_cop) values
  ('9a5c0000-0000-4000-8000-000000000041', '9a5c0000-0000-4000-8000-000000000021', 'pending', 17000),
  ('9a5c0000-0000-4000-8000-000000000042', '9a5c0000-0000-4000-8000-000000000022', 'approved', 17000),
  ('9a5c0000-0000-4000-8000-000000000043', '9a5c0000-0000-4000-8000-000000000023', 'approved', 17000);

-- ── apply_payment_webhook : confirmation au client ───────────────────────
set local role service_role;
select apply_payment_webhook('mp-esc-1', '9a5c0000-0000-4000-8000-000000000041'::uuid, 'approved',
  jsonb_build_object('id', 'mp-esc-1', 'status', 'approved'));
reset role;

select ok(strpos((select body_html from notification_emails where event_type = 'client_order_confirmed'
                   and related_id = '9a5c0000-0000-4000-8000-000000000021'),
                 '&lt;i&gt;Prod&lt;/i&gt; &amp; &#39;co&#39;') > 0,
  'W1 : confirmation client — nom de produit échappé');
select ok(strpos((select body_html from notification_emails where event_type = 'client_order_confirmed'
                   and related_id = '9a5c0000-0000-4000-8000-000000000021'),
                 'Hola &lt;b&gt;Holder&lt;/b&gt; &amp; &quot;q&quot;,') > 0,
  'W2 : confirmation client — nom du titulaire échappé');
select ok(strpos((select body_html from notification_emails where event_type = 'client_order_confirmed'
                   and related_id = '9a5c0000-0000-4000-8000-000000000021'),
                 '<strong>&lt;em&gt;REF-1&lt;/em&gt;</strong>') > 0,
  'W3 : confirmation client — référence échappée');
select is((select subject from notification_emails where event_type = 'client_order_confirmed'
            and related_id = '9a5c0000-0000-4000-8000-000000000021'),
  'Reserva <em>REF-1</em> confirmada',
  'S1 : le sujet reste du texte brut (jamais échappé)');

-- ── notify_client_refund_required : paiement en double / non honoré ──────
insert into payment_reconciliation_entries (id, payment_id, mp_payment_id, raw_event, failure_reason, kind, reason_code) values
  ('9a5c0000-0000-4000-8000-000000000051', '9a5c0000-0000-4000-8000-000000000042', 'mp-esc-2', '{}'::jsonb,
   'test', 'refund_required', 'double_payment'),
  ('9a5c0000-0000-4000-8000-000000000052', '9a5c0000-0000-4000-8000-000000000043', 'mp-esc-3', '{}'::jsonb,
   'test', 'refund_required', 'amount_mismatch');

select ok(strpos((select body_html from notification_emails where event_type = 'client_duplicate_payment_refund'
                   and related_id = '9a5c0000-0000-4000-8000-000000000051'),
                 'Hola &lt;b&gt;Holder&lt;/b&gt; &amp; &quot;q&quot;,') > 0,
  'R1 : paiement en double — nom du titulaire échappé');
select ok(strpos((select body_html from notification_emails where event_type = 'client_duplicate_payment_refund'
                   and related_id = '9a5c0000-0000-4000-8000-000000000051'),
                 '<strong>&lt;em&gt;REF-2&lt;/em&gt;</strong>') > 0,
  'R2 : paiement en double — référence échappée');
select ok(strpos((select body_html from notification_emails where event_type = 'client_payment_received_not_honored'
                   and related_id = '9a5c0000-0000-4000-8000-000000000052'),
                 'Hola &lt;b&gt;Holder&lt;/b&gt; &amp; &quot;q&quot;,') > 0,
  'R3 : paiement non honoré — nom du titulaire échappé');
select ok(strpos((select body_html from notification_emails where event_type = 'client_payment_received_not_honored'
                   and related_id = '9a5c0000-0000-4000-8000-000000000052'),
                 '<strong>&lt;em&gt;REF-3&lt;/em&gt;</strong>') > 0,
  'R4 : paiement non honoré — référence échappée');

-- ── notify_admin_new_proposal : nouvelle proposition aux admins ──────────
insert into product_proposals (id, product_id, partner_id, submitted_by, payload) values (
  '9a5c0000-0000-4000-8000-000000000061', '9a5c0000-0000-4000-8000-000000000013',
  '9a5c0000-0000-4000-8000-000000000011', '9a5c0000-0000-4000-8000-000000000002',
  jsonb_build_object('name', jsonb_build_object('es', '<s>Nom</s> ''x'''))
);

select ok(strpos((select body_html from notification_emails where event_type = 'admin_new_proposal'
                   and related_id = '9a5c0000-0000-4000-8000-000000000061' and recipient_email = 'esc-admin@test.local'),
                 '<p>&lt;s&gt;Nom&lt;/s&gt; &#39;x&#39;</p>') > 0,
  'P1 : nouvelle proposition — nom de l''entité échappé');
select ok(strpos((select body_html from notification_emails where event_type = 'admin_new_proposal'
                   and related_id = '9a5c0000-0000-4000-8000-000000000061' and recipient_email = 'esc-admin@test.local'),
                 'Propuesto por: &lt;u&gt;Socio&lt;/u&gt; &amp; co') > 0,
  'P2 : nouvelle proposition — nom du partenaire échappé');
select ok(strpos((select body_html from notification_emails where event_type = 'admin_new_proposal'
                   and related_id = '9a5c0000-0000-4000-8000-000000000061' and recipient_email = 'esc-admin@test.local'),
                 'href="/admin/proposals/9a5c0000-0000-4000-8000-000000000061"') > 0,
  'P3a : sans le secret Vault, le lien reste relatif (jamais un e-mail en moins)');

select vault.create_secret('https://admin.esc.test', 'admin_app_public_url');
insert into establishment_proposals (id, establishment_id, partner_id, submitted_by, kind, payload) values (
  '9a5c0000-0000-4000-8000-000000000062', null, '9a5c0000-0000-4000-8000-000000000011',
  '9a5c0000-0000-4000-8000-000000000002', 'create',
  jsonb_build_object('name', jsonb_build_object('es', '<s>Lugar</s> ''y'''))
);
select ok(strpos((select body_html from notification_emails where event_type = 'admin_new_proposal'
                   and related_id = '9a5c0000-0000-4000-8000-000000000062' and recipient_email = 'esc-admin@test.local'),
                 'href="https://admin.esc.test/admin/proposals/9a5c0000-0000-4000-8000-000000000062?entity=establishment"') > 0,
  'P3b : avec le secret Vault, le lien est absolu — et ouvre une proposition d''établissement');

-- Proposition d'établissement SANS nom (photos) : le nom vient de l'établissement.
insert into establishment_proposals (id, establishment_id, partner_id, submitted_by, kind, payload) values (
  '9a5c0000-0000-4000-8000-000000000063', '9a5c0000-0000-4000-8000-000000000012',
  '9a5c0000-0000-4000-8000-000000000011', '9a5c0000-0000-4000-8000-000000000002', 'photos',
  jsonb_build_object('photos', jsonb_build_array(jsonb_build_object('storage_path', 'esc/1.webp')))
);
select ok(strpos((select body_html from notification_emails where event_type = 'admin_new_proposal'
                   and related_id = '9a5c0000-0000-4000-8000-000000000063' and recipient_email = 'esc-admin@test.local'),
                 '<p>&lt;q&gt;Sitio&lt;/q&gt; &amp; co</p>') > 0,
  'P4 : une proposition d''établissement sans nom notifie, nom de l''établissement échappé');

-- ── moderate_*_proposal : verdict au partenaire ──────────────────────────
select test_login('9a5c0000-0000-4000-8000-000000000001');
set local role authenticated;
select moderate_establishment_proposal('9a5c0000-0000-4000-8000-000000000062'::uuid, 'reject', 1,
  p_rejection_reason => '<script>r</script> & "m"');
select moderate_product_proposal('9a5c0000-0000-4000-8000-000000000061'::uuid, 'reject', 1,
  p_rejection_reason => '<script>r</script> & "m"');
reset role;

select ok(strpos((select body_html from notification_emails where event_type = 'partner_proposal_decided'
                   and related_table = 'establishment_proposals' and related_id = '9a5c0000-0000-4000-8000-000000000062'),
                 'Tu propuesta para "&lt;s&gt;Lugar&lt;/s&gt; &#39;y&#39;"') > 0,
  'M1 : verdict établissement — nom de la proposition échappé');
select ok(strpos((select body_html from notification_emails where event_type = 'partner_proposal_decided'
                   and related_table = 'establishment_proposals' and related_id = '9a5c0000-0000-4000-8000-000000000062'),
                 'Motivo: &lt;script&gt;r&lt;/script&gt; &amp; &quot;m&quot;') > 0,
  'M2 : verdict établissement — motif de rejet échappé');
select ok(strpos((select body_html from notification_emails where event_type = 'partner_proposal_decided'
                   and related_table = 'product_proposals' and related_id = '9a5c0000-0000-4000-8000-000000000061'),
                 'Tu propuesta para "&lt;s&gt;Nom&lt;/s&gt; &#39;x&#39;"') > 0,
  'M3 : verdict produit — nom de la proposition échappé');
select ok(strpos((select body_html from notification_emails where event_type = 'partner_proposal_decided'
                   and related_table = 'product_proposals' and related_id = '9a5c0000-0000-4000-8000-000000000061'),
                 'Motivo: &lt;script&gt;r&lt;/script&gt; &amp; &quot;m&quot;') > 0,
  'M4 : verdict produit — motif de rejet échappé');

-- ── payments_reconcile_watchdog : alerte « job arrêté » aux admins ───────
update job_heartbeats
   set last_ok_at = now() - interval '20 minutes', alerted_at = null, last_error = '<h1>err</h1> & ''e'''
 where job_name = 'payments-reconcile';
select payments_reconcile_watchdog();
select ok(strpos((select body_html from notification_emails where event_type = 'admin_job_stalled'
                   and recipient_email = 'esc-admin@test.local' and created_at = now()),
                 'Último error: &lt;h1&gt;err&lt;/h1&gt; &amp; &#39;e&#39;.') > 0,
  'D1 : alerte du watchdog — dernier message d''erreur échappé');

-- ── Méta-test du catalogue ───────────────────────────────────────────────
-- Les commentaires -- sont retirés avant tout contrôle (un commentaire ne doit ni satisfaire ni
-- déclencher une règle ; les /* */ ne le sont pas, voir l'en-tête). « Émet un e-mail HTML » = une balise littérale, OU un appel à
-- enqueue_notification_email / notify_all_admins (attrape un corps construit sans balise
-- littérale : format, chr, modèle lu en table). Liste blanche : fonctions qui n'interpolent AUCUNE
-- valeur venue des données dans leur HTML (à justifier ici, une par une) :
--   - create_partner_invitation : URL du secret Vault et jeton généré (encode(gen_random_bytes)).
create temp table liste_blanche_html (proname text primary key);
insert into liste_blanche_html values ('create_partner_invitation');

create temp view emetteurs_html as
  select p.proname::text as proname, p.prosecdef, d.def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral (select regexp_replace(pg_get_functiondef(p.oid), E'--[^\n]*', '', 'g') as def) d
   where n.nspname = 'public' and p.prokind = 'f'
     and p.proname not in ('enqueue_notification_email', 'notify_all_admins')
     and (d.def ~* '<(p|a|li|ul|ol|strong|em|b|i|u|s|q|br|hr|div|span|table|tr|td|th|h[1-6]|img|html|body|head|pre|code|blockquote|small|font|center|section|header|footer|button|form|input|label|style|title)[[:space:]>/]'
          or d.def ~ '(enqueue_notification_email|notify_all_admins)[[:space:]]*\(');

select is(
  array(select proname from emetteurs_html
         where def !~ 'public\.html_text[[:space:]]*\('
           and proname not in (select proname from liste_blanche_html)
         order by 1),
  '{}'::text[],
  'X1 : toute fonction de public qui émet un e-mail HTML appelle public.html_text ou figure dans la liste blanche');
select is(
  array(select w.proname from liste_blanche_html w
         where not exists (select 1 from emetteurs_html e where e.proname = w.proname)
         order by 1),
  '{}'::text[],
  'X2 : chaque entrée de la liste blanche existe et émet encore un e-mail HTML (une liste qui ne pourrit pas)');
select is(
  array(select p.proname::text
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prokind = 'f' and p.proname <> 'html_text' and not p.prosecdef
           and regexp_replace(pg_get_functiondef(p.oid), E'--[^\n]*', '', 'g') ~ 'html_text[[:space:]]*\('
         order by 1),
  '{}'::text[],
  'X3 : tout appelant de html_text est SECURITY DEFINER (html_text est révoquée pour anon et authenticated)');

select * from finish();
rollback;

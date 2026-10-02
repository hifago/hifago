-- E-mails admin des exceptions de paiement (migration 20261002125023) : étranglement des échecs de
-- signature du webhook, échappement HTML des valeurs tierces, et public.html_text.
--
-- CE QUE CE FICHIER DOIT PROUVER :
--   - la classe des échecs de signature (webhook_failure, sans payment_id, « signature invalide (…) »)
--     n'a qu'UNE entrée notifiée par heure glissante, donc un e-mail par admin — l'entrée, elle, est
--     toujours écrite ;
--   - la fenêtre est glissante : passé une heure, la classe renotifie (ralentir, jamais taire) ;
--   - rien d'autre n'est étranglé : refund_required, entrée corrélée, autre échec du webhook,
--     refunded_externally, exception PMS ;
--   - les valeurs du corps venues des données (titulaire, nom de produit, référence) sont échappées ;
--   - le verrou est pris seul, avant la fenêtre (T18). La concurrence elle-même se prouve hors
--     pgTAP : tests/concurrency/notify_reconciliation_throttle.concurrency.mjs.
--
-- ⚠️ `now()` est constant dans la transaction : on vieillit la DONNÉE (created_at des e-mails),
-- jamais l'horloge.
begin;
select plan(21);

-- Toute notification préexistante de cette classe sort de la fenêtre (annulé par le rollback).
update notification_emails set created_at = now() - interval '2 hours'
 where event_type = 'admin_new_reconciliation_exception';

insert into auth.users (id, email) values
  ('9a5b0000-0000-4000-8000-000000000001', 'throttle-admin-1@test.local'),
  ('9a5b0000-0000-4000-8000-000000000002', 'throttle-admin-2@test.local'),
  ('9a5b0000-0000-4000-8000-000000000003', 'throttle-holder@test.local');
insert into partner_capabilities (account_id, role, source, status) values
  ('9a5b0000-0000-4000-8000-000000000001', 'admin', 'migration', 'active'),
  ('9a5b0000-0000-4000-8000-000000000002', 'admin', 'migration', 'active');

insert into partners (id, display_name) values ('9a5b0000-0000-4000-8000-000000000011', 'Throttle Partner');
insert into establishments (id, partner_id, name) values
  ('9a5b0000-0000-4000-8000-000000000012', '9a5b0000-0000-4000-8000-000000000011', jsonb_build_object('es', 'Throttle Est'));
-- Valeurs piégées : un nom de produit (partenaire) et un nom de titulaire (visiteur).
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('9a5b0000-0000-4000-8000-000000000013', '9a5b0000-0000-4000-8000-000000000011', '9a5b0000-0000-4000-8000-000000000012',
   'activity', jsonb_build_object('es', '<img src=x> & Co'), 30000, false, 'throttle-product');
insert into orders (id, account_id, holder_name, holder_email) values
  ('9a5b0000-0000-4000-8000-000000000014', '9a5b0000-0000-4000-8000-000000000003',
   '<a href="https://x.test">clic</a> & co', 'throttle-holder@test.local');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '9a5b0000-0000-4000-8000-000000000015', '9a5b0000-0000-4000-8000-000000000014', '9a5b0000-0000-4000-8000-000000000003',
  '9a5b0000-0000-4000-8000-000000000013', '2029-01-01', 1, 'reserved', 'Throttle Holder',
  30000, 30000, 'direct', 0, 0, 0, 0, 0, 0
);
insert into payments (id, order_id, amount_cop, status) values
  ('9a5b0000-0000-4000-8000-000000000016', '9a5b0000-0000-4000-8000-000000000014', 30000, 'pending');

-- Le nombre d'e-mails de cette classe reçus par un admin de test, pour une liste d'entrées.
create function test_mails(p_admin text, p_entries uuid[]) returns int language sql as $$
  select count(*)::int from notification_emails
   where event_type = 'admin_new_reconciliation_exception' and related_table = 'payment_reconciliation_entries'
     and related_id = any (p_entries) and recipient_email = p_admin;
$$;

-- ── Étranglement ──────────────────────────────────────────────────────────────────────────────
-- Trois échecs de signature, trois data.id différents (l'index unique ne les déduplique donc pas).
insert into payment_reconciliation_entries (id, mp_payment_id, raw_event, failure_reason) values
  ('9a5b0000-0000-4000-8000-0000000000a1', 'sig-1', '{}'::jsonb, 'signature invalide (SignatureMismatch)');
insert into payment_reconciliation_entries (id, mp_payment_id, raw_event, failure_reason) values
  ('9a5b0000-0000-4000-8000-0000000000a2', 'sig-2', '{}'::jsonb, 'signature invalide (MissingSignatureHeader)'),
  ('9a5b0000-0000-4000-8000-0000000000a3', 'sig-3', '{}'::jsonb, 'signature invalide (SignatureMismatch)');

select is(test_mails('throttle-admin-1@test.local', array['9a5b0000-0000-4000-8000-0000000000a1'::uuid]), 1,
  'T1 : le premier échec de signature de l''heure notifie l''admin');
select is(test_mails('throttle-admin-1@test.local', array['9a5b0000-0000-4000-8000-0000000000a2', '9a5b0000-0000-4000-8000-0000000000a3']::uuid[]), 0,
  'T2 : les suivants dans l''heure ne notifient pas (au plus un e-mail par admin et par heure)');
select is(test_mails('throttle-admin-2@test.local', array['9a5b0000-0000-4000-8000-0000000000a1', '9a5b0000-0000-4000-8000-0000000000a2', '9a5b0000-0000-4000-8000-0000000000a3']::uuid[]), 1,
  'T3 : chaque admin en reçoit un, et un seul');
select is((select count(*)::int from payment_reconciliation_entries where mp_payment_id in ('sig-1', 'sig-2', 'sig-3')), 3,
  'T4 : les entrées sont toujours écrites (matériel de rejeu) — seul l''e-mail est étranglé');

-- Borne basse : à 59 minutes, la notification de T1 étrangle ENCORE.
update notification_emails set created_at = now() - interval '59 minutes'
 where related_id = '9a5b0000-0000-4000-8000-0000000000a1';
insert into payment_reconciliation_entries (id, mp_payment_id, raw_event, failure_reason) values
  ('9a5b0000-0000-4000-8000-0000000000a6', 'sig-6', '{}'::jsonb, 'signature invalide (SignatureMismatch)');
select is(test_mails('throttle-admin-1@test.local', array['9a5b0000-0000-4000-8000-0000000000a6'::uuid]), 0,
  'T16 : à 59 min, la fenêtre étrangle encore (borne basse de l''heure glissante)');

-- Fenêtre GLISSANTE : la notification de T1 a plus d'une heure → la classe renotifie.
update notification_emails set created_at = now() - interval '61 minutes'
 where related_id = '9a5b0000-0000-4000-8000-0000000000a1';
insert into payment_reconciliation_entries (id, mp_payment_id, raw_event, failure_reason) values
  ('9a5b0000-0000-4000-8000-0000000000a4', 'sig-4', '{}'::jsonb, 'signature invalide (SignatureMismatch)');
select is(test_mails('throttle-admin-1@test.local', array['9a5b0000-0000-4000-8000-0000000000a4'::uuid]), 1,
  'T5 : passé une heure, un nouvel échec de signature notifie à nouveau (ralentir, jamais taire)');

-- ── Jamais étranglés (la fenêtre est saturée par T5) ─────────────────────────────────────────
insert into payment_reconciliation_entries (id, payment_id, mp_payment_id, raw_event, failure_reason, kind, reason_code) values
  ('9a5b0000-0000-4000-8000-0000000000b1', '9a5b0000-0000-4000-8000-000000000016', 'mp-b1', '{}'::jsonb,
   'montant ≠ acompte', 'refund_required', 'amount_mismatch');
select is(test_mails('throttle-admin-1@test.local', array['9a5b0000-0000-4000-8000-0000000000b1'::uuid]), 1,
  'T6 : refund_required (argent encaissé) notifie toujours');
insert into payment_reconciliation_entries (id, payment_id, mp_payment_id, raw_event, failure_reason) values
  ('9a5b0000-0000-4000-8000-0000000000b2', '9a5b0000-0000-4000-8000-000000000016', 'mp-b2', '{}'::jsonb, 'signature invalide (SignatureMismatch)');
select is(test_mails('throttle-admin-1@test.local', array['9a5b0000-0000-4000-8000-0000000000b2'::uuid]), 1,
  'T7 : une entrée corrélée (payment_id renseigné) notifie toujours, même au texte d''un échec de signature');
insert into payment_reconciliation_entries (id, mp_payment_id, raw_event, failure_reason) values
  ('9a5b0000-0000-4000-8000-0000000000b3', 'mp-b3', '{}'::jsonb, 'external_reference absent de la réponse Mercado Pago re-confirmée');
select is(test_mails('throttle-admin-1@test.local', array['9a5b0000-0000-4000-8000-0000000000b3'::uuid]), 1,
  'T8 : un autre échec du webhook (authentifié) notifie toujours');
insert into payment_reconciliation_entries (id, mp_payment_id, raw_event, failure_reason, kind) values
  ('9a5b0000-0000-4000-8000-0000000000b4', 'mp-b4', '{}'::jsonb, 'signature invalide (SignatureMismatch)', 'refunded_externally');
select is(test_mails('throttle-admin-1@test.local', array['9a5b0000-0000-4000-8000-0000000000b4'::uuid]), 1,
  'T9 : refunded_externally notifie toujours (seul webhook_failure est étranglé)');
insert into pms_reconciliation_entries (id, order_line_id) values
  ('9a5b0000-0000-4000-8000-0000000000b5', '9a5b0000-0000-4000-8000-000000000015');
select is((select count(*)::int from notification_emails
            where event_type = 'admin_new_reconciliation_exception' and related_table = 'pms_reconciliation_entries'
              and related_id = '9a5b0000-0000-4000-8000-0000000000b5' and recipient_email = 'throttle-admin-1@test.local'), 1,
  'T10 : une exception PMS notifie toujours');

-- La fenêtre ne compte QUE sa classe : on sort la notification de T5, il ne reste dans l'heure que
-- des e-mails d'autres classes (T6 à T10) — un nouvel échec de signature doit notifier.
update notification_emails set created_at = now() - interval '2 hours'
 where related_id = '9a5b0000-0000-4000-8000-0000000000a4';
insert into payment_reconciliation_entries (id, mp_payment_id, raw_event, failure_reason) values
  ('9a5b0000-0000-4000-8000-0000000000a7', 'sig-7', '{}'::jsonb, 'signature invalide (SignatureMismatch)');
select is(test_mails('throttle-admin-1@test.local', array['9a5b0000-0000-4000-8000-0000000000a7'::uuid]), 1,
  'T17 : des e-mails d''autres classes dans l''heure n''étranglent pas un échec de signature');

-- ── Échappement ──────────────────────────────────────────────────────────────────────────────
select ok((select strpos(body_html, '&lt;a href=&quot;https://x.test&quot;&gt;clic&lt;/a&gt; &amp; co') > 0
             from notification_emails where related_id = '9a5b0000-0000-4000-8000-0000000000b1'
              and recipient_email = 'throttle-admin-1@test.local'),
  'T11a : le nom du titulaire est échappé dans le corps');
select ok((select strpos(body_html, '<a href="https://x.test">') = 0
             from notification_emails where related_id = '9a5b0000-0000-4000-8000-0000000000b1'
              and recipient_email = 'throttle-admin-1@test.local'),
  'T11b : aucune balise du titulaire n''arrive brute dans le corps');
select ok((select strpos(body_html, '&lt;img src=x&gt; &amp; Co') > 0 and strpos(body_html, '<img') = 0
             from notification_emails where related_id = '9a5b0000-0000-4000-8000-0000000000b5'
              and recipient_email = 'throttle-admin-1@test.local'),
  'T12 : le nom de produit (branche PMS) est échappé');

-- ── public.html_text ─────────────────────────────────────────────────────────────────────────
select is(public.html_text('& < > " '' x'), '&amp; &lt; &gt; &quot; &#39; x', 'T13a : html_text échappe les cinq caractères');
select is(public.html_text(null), null, 'T13b : html_text(NULL) = NULL (STRICT)');
select is(public.html_text('Nom proposé, señal'), 'Nom proposé, señal', 'T13c : les accents passent intacts');
select ok((select provolatile = 'i' and proisstrict from pg_proc where oid = 'public.html_text(text)'::regprocedure),
  'T14 : html_text est IMMUTABLE et STRICT');
select ok(not has_function_privilege('anon', 'public.html_text(text)', 'execute')
          and not has_function_privilege('authenticated', 'public.html_text(text)', 'execute'),
  'T15 : ni anon ni authenticated n''exécutent html_text');

-- L'ordre du verrou et de la fenêtre ne se voit pas en une seule session : on l'épingle sur la
-- définition. Fusionnés (une instruction, un seul instantané) ou inversés, une insertion dont
-- l'instantané précède la validation du détenteur du verrou notifierait une seconde fois.
select ok(
  pg_get_functiondef('public.notify_admin_new_reconciliation_exception'::regproc)
    ~ 'if not pg_try_advisory_xact_lock\(hashtext\(''notify_admin_new_reconciliation_exception:signature''\)\) then\s+return new;\s+end if;\s+if exists \(',
  'T18 : le verrou est pris seul, dans sa propre instruction, juste avant la fenêtre');

select * from finish();
rollback;

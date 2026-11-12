-- E-mail de réservation au prestataire (migration 20261112120000, décision Jérôme du 2026-11-12).
--
-- CE QUE CE FICHIER DOIT PROUVER :
--   - un e-mail par compte de chaque partenaire propriétaire d'une prestation vivante, et chacun ne
--     voit que SES prestations (jamais celles d'un autre prestataire de la commande, jamais une
--     ligne annulée) ;
--   - le contenu : client (nom, WhatsApp, e-mail), dates en toutes lettres, heure du créneau,
--     quantité, montants (total, acompte, solde), note du client, lien absolu vers la fiche ;
--   - chaque valeur tierce est échappée (nom du client, du partenaire, du produit, note) ; le sujet
--     reste du texte brut ;
--   - Reply-To = e-mail du client, jamais une adresse sentinelle @hifago.local ;
--   - un camp qui bloque la ressource porte la mention de l'ex-e-mail 8 ;
--   - rejoué, il ne double pas (dédoublonnage) ;
--   - create_order enregistre la note (rognée, vide → NULL) et refuse au-delà de 1 000 caractères ;
--   - les formateurs (date, heure, montant).
begin;
select plan(31);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

delete from vault.secrets where name = 'admin_app_public_url';
select vault.create_secret('https://admin.poc.test', 'admin_app_public_url');

-- Partenaire A (2 comptes) : un hébergement, une activité à l'heure, une activité annulée, un camp.
-- Partenaire B (1 compte) : une activité dans la même commande.
insert into auth.users (id, email) values
  ('9c0e0000-0000-4000-8000-000000000001', 'poc-a1@test.local'),
  ('9c0e0000-0000-4000-8000-000000000002', 'poc-a2@test.local'),
  ('9c0e0000-0000-4000-8000-000000000003', 'poc-b1@test.local'),
  ('9c0e0000-0000-4000-8000-000000000004', 'poc-client@test.local');
insert into partners (id, display_name) values
  ('9c0e0000-0000-4000-8000-000000000011', '<u>Casa</u> & co'),
  ('9c0e0000-0000-4000-8000-000000000012', 'Kayak POC');
update partner_accounts set partner_id = '9c0e0000-0000-4000-8000-000000000011'
 where id in ('9c0e0000-0000-4000-8000-000000000001', '9c0e0000-0000-4000-8000-000000000002');
update partner_accounts set partner_id = '9c0e0000-0000-4000-8000-000000000012'
 where id = '9c0e0000-0000-4000-8000-000000000003';
insert into establishments (id, partner_id, name) values
  ('9c0e0000-0000-4000-8000-000000000021', '9c0e0000-0000-4000-8000-000000000011', jsonb_build_object('es', 'Estab POC A')),
  ('9c0e0000-0000-4000-8000-000000000022', '9c0e0000-0000-4000-8000-000000000012', jsonb_build_object('es', 'Estab POC B'));
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, pricing_unit, duration_days) values
  ('9c0e0000-0000-4000-8000-000000000031', '9c0e0000-0000-4000-8000-000000000011', '9c0e0000-0000-4000-8000-000000000021',
   'lodging', jsonb_build_object('es', '<i>Cabaña</i> POC'), 240000, true, 'poc-cabana', null, null),
  ('9c0e0000-0000-4000-8000-000000000032', '9c0e0000-0000-4000-8000-000000000011', '9c0e0000-0000-4000-8000-000000000021',
   'activity', jsonb_build_object('es', 'Bote POC'), 420000, true, 'poc-bote', 'per_hour', null),
  ('9c0e0000-0000-4000-8000-000000000033', '9c0e0000-0000-4000-8000-000000000011', '9c0e0000-0000-4000-8000-000000000021',
   'activity', jsonb_build_object('es', 'Anulada POC'), 50000, true, 'poc-anulada', 'per_person', null),
  ('9c0e0000-0000-4000-8000-000000000034', '9c0e0000-0000-4000-8000-000000000011', '9c0e0000-0000-4000-8000-000000000021',
   'camp', jsonb_build_object('es', 'Camp POC'), 300000, true, 'poc-camp', 'per_person', 3),
  ('9c0e0000-0000-4000-8000-000000000035', '9c0e0000-0000-4000-8000-000000000012', '9c0e0000-0000-4000-8000-000000000022',
   'activity', jsonb_build_object('es', 'Kayak de B'), 90000, true, 'poc-kayak-b', 'per_person', null);

-- Commande 1 : payée, client réel, note piégée sur deux lignes.
insert into orders (id, account_id, holder_name, holder_email, holder_phone, reference, payment_status, client_note) values
  ('9c0e0000-0000-4000-8000-000000000041', '9c0e0000-0000-4000-8000-000000000004',
   '<b>Laura</b> & "G"', 'laura.poc@test.local', '+57 300 123 4567', 'HFG-POC1', 'paid',
   E'Llegamos tarde <script>x</script>\nSomos 2');
-- Commande 2 : adresse sentinelle (ligne manuelle, reprise legacy).
insert into orders (id, account_id, holder_name, holder_email, holder_phone, reference, payment_status) values
  ('9c0e0000-0000-4000-8000-000000000042', '9c0e0000-0000-4000-8000-000000000004',
   'Sentinelle POC', 'manual-x@hifago.local', null, 'HFG-POC2', 'paid');

insert into order_lines (
  id, order_id, account_id, product_id, date, end_date, slot_start_time, qty, pricing_unit, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  ('9c0e0000-0000-4000-8000-000000000051', '9c0e0000-0000-4000-8000-000000000041', '9c0e0000-0000-4000-8000-000000000004',
   '9c0e0000-0000-4000-8000-000000000031', '2028-12-15', '2028-12-17', null, 1, null, 'reserved', 'x',
   240000, 480000, 'direct', 0.3, 0, 0.3, 144000, 0, 144000),
  ('9c0e0000-0000-4000-8000-000000000052', '9c0e0000-0000-4000-8000-000000000041', '9c0e0000-0000-4000-8000-000000000004',
   '9c0e0000-0000-4000-8000-000000000032', '2028-12-16', null, '16:30', 2, 'per_hour', 'reserved', 'x',
   420000, 840000, 'direct', 0.3, 0, 0.3, 252000, 0, 252000),
  ('9c0e0000-0000-4000-8000-000000000053', '9c0e0000-0000-4000-8000-000000000041', '9c0e0000-0000-4000-8000-000000000004',
   '9c0e0000-0000-4000-8000-000000000033', '2028-12-16', null, null, 1, 'per_person', 'cancelled_by_client', 'x',
   50000, 50000, 'direct', 0.3, 0, 0.3, 15000, 0, 15000),
  ('9c0e0000-0000-4000-8000-000000000054', '9c0e0000-0000-4000-8000-000000000041', '9c0e0000-0000-4000-8000-000000000004',
   '9c0e0000-0000-4000-8000-000000000034', '2028-12-20', null, null, 1, 'per_person', 'reserved', 'x',
   300000, 300000, 'direct', 0.3, 0, 0.3, 90000, 0, 90000),
  ('9c0e0000-0000-4000-8000-000000000055', '9c0e0000-0000-4000-8000-000000000041', '9c0e0000-0000-4000-8000-000000000004',
   '9c0e0000-0000-4000-8000-000000000035', '2028-12-16', null, '09:00', 3, 'per_person', 'reserved', 'x',
   90000, 270000, 'direct', 0.3, 0, 0.3, 81000, 0, 81000),
  ('9c0e0000-0000-4000-8000-000000000056', '9c0e0000-0000-4000-8000-000000000042', '9c0e0000-0000-4000-8000-000000000004',
   '9c0e0000-0000-4000-8000-000000000035', '2028-12-18', null, null, 1, 'per_person', 'reserved', 'x',
   90000, 90000, 'direct', 0.3, 0, 0.3, 27000, 0, 27000);

-- Seuls les e-mails de ce fichier comptent (la base locale est partagée).
create temp view poc_mails as
  select n.* from notification_emails n
   where n.event_type = 'partner_payment_confirmed' and n.related_table = 'orders'
     and n.related_id in ('9c0e0000-0000-4000-8000-000000000041', '9c0e0000-0000-4000-8000-000000000042');
create temp view poc_a as select * from poc_mails
  where related_id = '9c0e0000-0000-4000-8000-000000000041' and recipient_email = 'poc-a1@test.local';
create temp view poc_b as select * from poc_mails
  where related_id = '9c0e0000-0000-4000-8000-000000000041' and recipient_email = 'poc-b1@test.local';

select lives_ok(
  $$ select notify_partner_order_confirmed('9c0e0000-0000-4000-8000-000000000041') $$,
  'notify_partner_order_confirmed s''exécute'
);

-- Destinataires et cloisonnement
select is((select count(*)::int from poc_mails where related_id = '9c0e0000-0000-4000-8000-000000000041'), 3,
  'un e-mail par compte : 2 pour le partenaire A, 1 pour B');
select ok((select body_html from poc_a) like '%Cabaña%' and (select body_html from poc_a) like '%Bote POC%',
  'A voit ses deux prestations vivantes');
select ok((select body_html from poc_a) not like '%Kayak de B%',
  'A ne voit jamais la prestation d''un autre prestataire de la commande');
select ok((select body_html from poc_b) not like '%Cabaña%' and (select body_html from poc_b) like '%Kayak de B%',
  'B ne voit que la sienne');
select ok((select body_html from poc_a) not like '%Anulada POC%',
  'une prestation annulée n''apparaît pas');
select ok((select body_html from poc_a) like '%Tus reservas (3)%' and (select body_html from poc_b) like '%>Tu reserva<span%',
  'titre au pluriel avec le nombre, au singulier pour une seule prestation');

-- Contenu
select ok((select body_html from poc_a) like '%Llegada%viernes 15 dic. 2028%Salida%domingo 17 dic. 2028 · 2 noches%',
  'hébergement : arrivée, départ en toutes lettres et nombre de nuits');
select ok((select body_html from poc_a) like '%sábado 16 dic. 2028 · 4:30 p. m.%' and (select body_html from poc_a) like '%2 horas%',
  'activité : date, heure du créneau, quantité en heures');
select ok((select body_html from poc_b) like '%3 personas%' and (select body_html from poc_a) like '%1 unidad%',
  'quantité : personnes, unités d''hébergement');
select ok((select body_html from poc_a) like '%$480.000 COP%$144.000 COP%Saldo a cobrar%$336.000 COP%',
  'montants : total, acompte payé sur Hifago, solde à encaisser');
select ok((select body_html from poc_a) like '%Fechas%del miércoles 20 dic. 2028 al viernes 22 dic. 2028%Recurso bloqueado durante esas fechas%',
  'camp : période et mention du blocage (ex-e-mail 8)');
select ok((select body_html from poc_a) like '%href="https://wa.me/573001234567"%+57 300 123 4567%',
  'WhatsApp du client, lien wa.me en chiffres seuls');
select ok((select body_html from poc_a) like '%mailto:laura.poc@test.local%',
  'e-mail du client');
select ok((select body_html from poc_a) like '%href="https://admin.poc.test/partner/reservations/9c0e0000-0000-4000-8000-000000000051"%',
  'lien absolu vers la fiche de la prestation dans l''espace partenaire');
select ok((select body_html from poc_a) like '%HFG-POC1%' and (select body_html from poc_a) like '%reservó y pagó en Hifago%',
  'référence de la commande, et « pagó » pour une commande payée');

-- Échappement
select ok((select body_html from poc_a) like '%&lt;b&gt;Laura&lt;/b&gt;%' and (select body_html from poc_a) not like '%<b>Laura%',
  'nom du client échappé');
select ok((select body_html from poc_a) like '%Hola &lt;u&gt;Casa&lt;/u&gt; &amp; co,%',
  'nom du partenaire échappé');
select ok((select body_html from poc_a) like '%&lt;i&gt;Cabaña&lt;/i&gt;%',
  'nom du produit échappé');
select ok((select body_html from poc_a) like '%Nota del cliente%Llegamos tarde &lt;script&gt;x&lt;/script&gt;<br>Somos 2%'
          and (select body_html from poc_a) not like '%<script>%',
  'note du client échappée, retours à la ligne en <br>');
select is((select subject from poc_a), 'Nueva reserva confirmada · HFG-POC1 · <b>Laura</b> & "G"',
  'le sujet reste du texte brut');

-- Reply-To
select is((select reply_to from poc_a), 'laura.poc@test.local', 'Reply-To = e-mail du client');

select notify_partner_order_confirmed('9c0e0000-0000-4000-8000-000000000042');
select is((select reply_to from poc_mails where related_id = '9c0e0000-0000-4000-8000-000000000042'), null,
  'adresse sentinelle @hifago.local : aucun Reply-To');
select ok((select body_html from poc_mails where related_id = '9c0e0000-0000-4000-8000-000000000042') not like '%mailto:%'
          and (select body_html from poc_mails where related_id = '9c0e0000-0000-4000-8000-000000000042') not like '%Nota del cliente%',
  'adresse sentinelle : ni e-mail affiché, ni bloc de note quand il n''y en a pas');

-- Dédoublonnage
select notify_partner_order_confirmed('9c0e0000-0000-4000-8000-000000000041');
select is((select count(*)::int from poc_mails where related_id = '9c0e0000-0000-4000-8000-000000000041'), 3,
  'rejoué : aucun e-mail en double');

-- create_order : la note
insert into product_availability (product_id, date, capacity, booked) values
  ('9c0e0000-0000-4000-8000-000000000035', '2028-12-19', 50, 0);
insert into auth.users (id, email) values ('9c0e0000-0000-4000-8000-000000000005', 'poc-buyer@test.local');
set local role authenticated;
select test_login('9c0e0000-0000-4000-8000-000000000005');
insert into cart_items (account_id, product_id, date, qty) values
  ('9c0e0000-0000-4000-8000-000000000005', '9c0e0000-0000-4000-8000-000000000035', '2028-12-19', 1);
select is(
  (select create_order('Buyer POC', 'buyer.poc@test.local', '+573001112233', false, repeat('x', 1001)) ->> 'reason'),
  'client_note_too_long',
  'create_order refuse une note de plus de 1 000 caractères'
);
create temp table poc_co as
  select create_order('Buyer POC', 'buyer.poc@test.local', '+573001112233', false, E'  Hola,\nllego a las 8  ') as r;
reset role;
select is((select client_note from orders where id = ((select r ->> 'order_id' from poc_co))::uuid), E'Hola,\nllego a las 8',
  'create_order enregistre la note, rognée');

set local role authenticated;
select test_login('9c0e0000-0000-4000-8000-000000000005');
insert into cart_items (account_id, product_id, date, qty) values
  ('9c0e0000-0000-4000-8000-000000000005', '9c0e0000-0000-4000-8000-000000000035', '2028-12-19', 1);
create temp table poc_co2 as
  select create_order('Buyer POC', 'buyer.poc@test.local', '+573001112233', false, '   ') as r;
reset role;
select is((select client_note from orders where id = ((select r ->> 'order_id' from poc_co2))::uuid), null,
  'une note vide est enregistrée NULL');
select is((select count(*)::int from notification_emails where event_type = 'partner_payment_confirmed'
            and related_id = ((select r ->> 'order_id' from poc_co))::uuid), 0,
  'commande à payer : aucun e-mail au prestataire avant le paiement');

-- Formateurs
select is(email_fecha_es('2028-12-15'), 'viernes 15 dic. 2028', 'email_fecha_es');
select is(email_hora_es('09:05') || ' / ' || email_hora_es('12:00'), '9:05 a. m. / 12:00 p. m.', 'email_hora_es');

select * from finish();
rollback;

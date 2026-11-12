-- E-mail de confirmation au client (migration 20261112140000, décision Jérôme du 2026-11-12) : remis
-- au niveau de l'e-mail prestataire (partner_order_confirmed_email.test.sql).
--
-- CE QUE CE FICHIER DOIT PROUVER :
--   - un seul e-mail au client, pour une commande payée seulement, jamais doublé si rejoué ;
--   - une carte par prestation VIVANTE (jamais une ligne annulée, ni le contact de son établissement) ;
--   - dates en toutes lettres (séjour : arrivée, départ, nuits ; camp de plusieurs jours : période ;
--     créneau : heure), quantité, montants formatés (total, anticipo, à payer sur place) ;
--   - le récapitulatif quand il y a plusieurs prestations (pluriel « los establecimientos » quand
--     plusieurs établissements), absent pour une seule ;
--   - aucune mention réservée au prestataire (« Recurso bloqueado ») ;
--   - le lien absolu vers /reserva/<jeton> avec le secret Vault, l'e-mail part sans lien sinon ;
--   - l'en-tête de la charte : l'image servie par le site avec le secret, un bandeau texte sinon
--     (jamais une image à adresse relative, qu'aucune messagerie ne chargerait).
-- L'échappement des valeurs tierces est couvert par notification_html_escaping.test.sql (W1-W3b, S1).
begin;
select plan(21);

delete from vault.secrets where name = 'web_app_public_url';
select vault.create_secret('https://web.coc.test', 'web_app_public_url');

insert into auth.users (id, email) values
  ('9c0f0000-0000-4000-8000-000000000001', 'coc-a1@test.local'),
  ('9c0f0000-0000-4000-8000-000000000002', 'coc-b1@test.local'),
  ('9c0f0000-0000-4000-8000-000000000003', 'coc-c1@test.local'),
  ('9c0f0000-0000-4000-8000-000000000004', 'coc-client@test.local');
insert into partners (id, display_name) values
  ('9c0f0000-0000-4000-8000-000000000011', 'Casa COC'),
  ('9c0f0000-0000-4000-8000-000000000012', 'Kayak COC'),
  ('9c0f0000-0000-4000-8000-000000000013', 'Anulado COC');
update partner_accounts set partner_id = '9c0f0000-0000-4000-8000-000000000011' where id = '9c0f0000-0000-4000-8000-000000000001';
update partner_accounts set partner_id = '9c0f0000-0000-4000-8000-000000000012' where id = '9c0f0000-0000-4000-8000-000000000002';
update partner_accounts set partner_id = '9c0f0000-0000-4000-8000-000000000013' where id = '9c0f0000-0000-4000-8000-000000000003';
insert into establishments (id, partner_id, name, contact_phone) values
  ('9c0f0000-0000-4000-8000-000000000021', '9c0f0000-0000-4000-8000-000000000011', jsonb_build_object('es', 'Estab COC A'), '+573001234567'),
  ('9c0f0000-0000-4000-8000-000000000022', '9c0f0000-0000-4000-8000-000000000012', jsonb_build_object('es', 'Estab COC B'), '+573109876543'),
  ('9c0f0000-0000-4000-8000-000000000023', '9c0f0000-0000-4000-8000-000000000013', jsonb_build_object('es', 'Estab COC C'), '+573205551234');
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug, pricing_unit, duration_days) values
  ('9c0f0000-0000-4000-8000-000000000031', '9c0f0000-0000-4000-8000-000000000011', '9c0f0000-0000-4000-8000-000000000021',
   'lodging', jsonb_build_object('es', 'Cabaña COC'), 240000, true, 'coc-cabana', null, null),
  ('9c0f0000-0000-4000-8000-000000000032', '9c0f0000-0000-4000-8000-000000000011', '9c0f0000-0000-4000-8000-000000000021',
   'activity', jsonb_build_object('es', 'Bote COC'), 420000, true, 'coc-bote', 'per_hour', null),
  ('9c0f0000-0000-4000-8000-000000000033', '9c0f0000-0000-4000-8000-000000000013', '9c0f0000-0000-4000-8000-000000000023',
   'activity', jsonb_build_object('es', 'Anulada COC'), 50000, true, 'coc-anulada', 'per_person', null),
  ('9c0f0000-0000-4000-8000-000000000034', '9c0f0000-0000-4000-8000-000000000011', '9c0f0000-0000-4000-8000-000000000021',
   'camp', jsonb_build_object('es', 'Camp COC'), 300000, true, 'coc-camp', 'per_person', 3),
  ('9c0f0000-0000-4000-8000-000000000035', '9c0f0000-0000-4000-8000-000000000012', '9c0f0000-0000-4000-8000-000000000022',
   'activity', jsonb_build_object('es', 'Kayak COC'), 90000, true, 'coc-kayak', 'per_person', null);

-- Commande 1 : payée, quatre prestations vivantes sur deux établissements, une annulée sur un troisième.
-- Commande 2 : payée, une seule prestation. Commande 3 : non payée.
insert into orders (id, account_id, holder_name, holder_email, reference, payment_status) values
  ('9c0f0000-0000-4000-8000-000000000041', '9c0f0000-0000-4000-8000-000000000004', 'Laura COC', 'laura.coc@test.local', 'HFG-COC1', 'paid'),
  ('9c0f0000-0000-4000-8000-000000000042', '9c0f0000-0000-4000-8000-000000000004', 'Laura COC', 'laura.coc@test.local', 'HFG-COC2', 'paid'),
  ('9c0f0000-0000-4000-8000-000000000043', '9c0f0000-0000-4000-8000-000000000004', 'Laura COC', 'laura.coc@test.local', 'HFG-COC3', 'unpaid');

insert into order_lines (
  id, order_id, account_id, product_id, date, end_date, slot_start_time, qty, pricing_unit, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  ('9c0f0000-0000-4000-8000-000000000051', '9c0f0000-0000-4000-8000-000000000041', '9c0f0000-0000-4000-8000-000000000004',
   '9c0f0000-0000-4000-8000-000000000031', '2028-12-15', '2028-12-17', null, 1, null, 'reserved', 'x',
   240000, 480000, 'direct', 0.3, 0, 0.3, 144000, 0, 144000),
  ('9c0f0000-0000-4000-8000-000000000052', '9c0f0000-0000-4000-8000-000000000041', '9c0f0000-0000-4000-8000-000000000004',
   '9c0f0000-0000-4000-8000-000000000032', '2028-12-16', null, '16:30', 2, 'per_hour', 'reserved', 'x',
   420000, 840000, 'direct', 0.3, 0, 0.3, 252000, 0, 252000),
  ('9c0f0000-0000-4000-8000-000000000053', '9c0f0000-0000-4000-8000-000000000041', '9c0f0000-0000-4000-8000-000000000004',
   '9c0f0000-0000-4000-8000-000000000033', '2028-12-16', null, null, 1, 'per_person', 'cancelled_by_client', 'x',
   50000, 50000, 'direct', 0.3, 0, 0.3, 15000, 0, 15000),
  ('9c0f0000-0000-4000-8000-000000000054', '9c0f0000-0000-4000-8000-000000000041', '9c0f0000-0000-4000-8000-000000000004',
   '9c0f0000-0000-4000-8000-000000000034', '2028-12-20', null, null, 1, 'per_person', 'reserved', 'x',
   300000, 300000, 'direct', 0.3, 0, 0.3, 90000, 0, 90000),
  ('9c0f0000-0000-4000-8000-000000000055', '9c0f0000-0000-4000-8000-000000000041', '9c0f0000-0000-4000-8000-000000000004',
   '9c0f0000-0000-4000-8000-000000000035', '2028-12-16', null, '09:00', 3, 'per_person', 'reserved', 'x',
   90000, 270000, 'direct', 0.3, 0, 0.3, 81000, 0, 81000),
  ('9c0f0000-0000-4000-8000-000000000056', '9c0f0000-0000-4000-8000-000000000042', '9c0f0000-0000-4000-8000-000000000004',
   '9c0f0000-0000-4000-8000-000000000035', '2028-12-18', null, null, 1, 'per_person', 'reserved', 'x',
   90000, 90000, 'direct', 0.3, 0, 0.3, 27000, 0, 27000),
  ('9c0f0000-0000-4000-8000-000000000057', '9c0f0000-0000-4000-8000-000000000043', '9c0f0000-0000-4000-8000-000000000004',
   '9c0f0000-0000-4000-8000-000000000035', '2028-12-19', null, null, 1, 'per_person', 'reserved', 'x',
   90000, 90000, 'direct', 0.3, 0, 0.3, 27000, 0, 27000);

-- Seuls les e-mails de ce fichier comptent (la base locale est partagée).
create temp view coc_mails as
  select n.* from notification_emails n
   where n.event_type = 'client_order_confirmed' and n.related_table = 'orders'
     and n.related_id in ('9c0f0000-0000-4000-8000-000000000041', '9c0f0000-0000-4000-8000-000000000042',
                          '9c0f0000-0000-4000-8000-000000000043');
create temp view coc_1 as select * from coc_mails where related_id = '9c0f0000-0000-4000-8000-000000000041';
create temp view coc_2 as select * from coc_mails where related_id = '9c0f0000-0000-4000-8000-000000000042';

select lives_ok(
  $$ select notify_order_confirmed('9c0f0000-0000-4000-8000-000000000041') $$,
  'notify_order_confirmed s''exécute'
);

-- Destinataire et lignes
select is((select count(*)::int from coc_1), 1, 'un seul e-mail au client');
select is((select recipient_email from coc_1), 'laura.coc@test.local', 'adressé au titulaire de la commande');
select ok((select body_html from coc_1) like '%Tus reservas (4)%', 'titre au pluriel avec le nombre de prestations vivantes');
select ok((select body_html from coc_1) not like '%Anulada COC%', 'une prestation annulée n''apparaît pas');
select ok((select body_html from coc_1) not like '%573205551234%',
  'ni le WhatsApp de l''établissement de la prestation annulée');

-- Contenu des cartes
select ok((select body_html from coc_1) like '%Llegada%viernes 15 dic. 2028%Salida%domingo 17 dic. 2028 · 2 noches%',
  'hébergement : arrivée, départ en toutes lettres et nombre de nuits');
select ok((select body_html from coc_1) like '%sábado 16 dic. 2028 · 4:30 p. m.%' and (select body_html from coc_1) like '%2 horas%',
  'activité : date, heure du créneau, quantité en heures');
select ok((select body_html from coc_1) like '%3 personas%' and (select body_html from coc_1) like '%1 unidad%',
  'quantité : personnes, unités d''hébergement');
select ok((select body_html from coc_1) like '%Total%$480.000 COP%Anticipo (pago en línea)%$144.000 COP%A pagar en el establecimiento%$336.000 COP%',
  'montants d''une carte : total, anticipo, à payer sur place');
select ok((select body_html from coc_1) like '%Fechas%del miércoles 20 dic. 2028 al viernes 22 dic. 2028%',
  'camp de plusieurs jours : la période');
select ok((select body_html from coc_1) not like '%Recurso bloqueado%',
  'aucune mention réservée au prestataire');

-- Récapitulatif et contacts
select ok((select body_html from coc_1) like '%Resumen%$1.890.000 COP%$567.000 COP%A pagar en los establecimientos%$1.323.000 COP%',
  'récapitulatif des prestations vivantes, pluriel pour plusieurs établissements');
select ok((select body_html from coc_1) like '%Estab COC A%href="https://wa.me/573001234567"%'
          and (select body_html from coc_1) like '%Estab COC B%href="https://wa.me/573109876543"%',
  'le WhatsApp de chaque établissement');
select ok((select body_html from coc_1) like '%href="https://web.coc.test/reserva/' || (select access_token from orders where id = '9c0f0000-0000-4000-8000-000000000041') || '"%Ver tu reserva%',
  'lien absolu vers /reserva/<jeton>');
select ok((select body_html from coc_1) like '%<img src="https://web.coc.test/brand/email-cabecera.jpg"%alt="Hifago · Guatapé merece más de un día."%',
  'en-tête : l''image de la charte, à adresse absolue, avec son texte alternatif');

-- Une seule prestation, sans le secret Vault
delete from vault.secrets where name = 'web_app_public_url';
select notify_order_confirmed('9c0f0000-0000-4000-8000-000000000042');
select ok((select body_html from coc_2) like '%>Tu reserva<span%' and (select body_html from coc_2) not like '%Resumen%',
  'une seule prestation : titre au singulier, aucun récapitulatif');
select ok((select body_html from coc_2) not like '%Ver tu reserva%' and (select body_html from coc_2) like '%HFG-COC2%',
  'sans le secret Vault : l''e-mail part quand même, sans lien');
select ok((select body_html from coc_2) not like '%<img%' and (select body_html from coc_2) like '%hifago · Guatapé</div>%',
  'sans le secret Vault : bandeau texte, jamais une image à adresse relative');

-- Commande non payée, rejeu
select notify_order_confirmed('9c0f0000-0000-4000-8000-000000000043');
select is((select count(*)::int from coc_mails where related_id = '9c0f0000-0000-4000-8000-000000000043'), 0,
  'commande non payée : aucun e-mail');
select notify_order_confirmed('9c0f0000-0000-4000-8000-000000000041');
select is((select count(*)::int from coc_1), 1, 'rejoué : aucun e-mail en double');

select * from finish();
rollback;

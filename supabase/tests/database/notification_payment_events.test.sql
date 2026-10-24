-- Spec 23 Tranche 2 — les 3 notifications branchées dans apply_payment_webhook (commission
-- attribuée, paiement effectué, confirmation client) + le blocage camp/evento branché dans
-- create_order. Migrations 20260824110000/120000, seules sources de vérité pour la logique.
-- Depuis la migration 20261023120000 (Lobby après l'acompte), les quatre partent de
-- notify_order_confirmed — le blocage camp/evento à la confirmation du paiement, plus à la création.
--
-- Contient LE test le plus important de toute la spec 23 (cas 5) : fault-injection prouvant que
-- l'invariant §8.1 tient VRAIMENT sur apply_payment_webhook — pas une supposition sur le
-- comportement du `exception when others`, une preuve concrète qu'un bug de notification ne peut
-- structurellement pas bloquer une confirmation de paiement Mercado Pago réelle (technique
-- recommandée par le challenge adversarial du 2026-08-24, appliquée ici sur la RPC pour laquelle
-- elle compte le plus).
begin;
select plan(10);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Fixtures : partenaire propriétaire (owner) + partenaire référent externe, chacun avec 1 compte
-- de connexion, 1 client, 1 commande à 2 lignes (1 direct, 1 external_referrer) sur le MÊME
-- produit, pour que les 3 notifications aient toutes matière à se déclencher en un seul appel.
insert into partners (id, display_name) values
  ('99992000-0000-4000-8000-000000000001', 'Notif Payment Owner Partner'),
  ('99992000-0000-4000-8000-000000000002', 'Notif Payment Referrer Partner');
insert into establishments (id, partner_id, name) values
  ('99992000-0000-4000-8000-000000000011', '99992000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Notif Payment'));
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('99992000-0000-4000-8000-000000000012', '99992000-0000-4000-8000-000000000001',
   '99992000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Producto Notif Payment'), 100000, true, 'notif-payment-test');

insert into auth.users (id, email) values
  ('99992000-0000-4000-8000-000000000021', 'notif-payment-owner@test.local'),
  ('99992000-0000-4000-8000-000000000022', 'notif-payment-referrer@test.local'),
  -- RÉVISÉ 2026-09-10 (spec 31, Tranche 2) : orders.account_id est NOT NULL — les deux commandes
  -- client ci-dessous ont désormais besoin d'une identité (aucune assertion de ce fichier n'en
  -- dépend).
  ('99992000-0000-4000-8000-000000000025', 'notif-payment-client@test.local'),
  ('99992000-0000-4000-8000-000000000024', 'notif-payment-client-2@test.local');
insert into partner_capabilities (partner_id, role, source, status) values
  ('99992000-0000-4000-8000-000000000001', 'referrer', 'migration', 'active'),
  ('99992000-0000-4000-8000-000000000002', 'referrer', 'migration', 'active');
update partner_accounts set partner_id = '99992000-0000-4000-8000-000000000001'
 where id = '99992000-0000-4000-8000-000000000021';
update partner_accounts set partner_id = '99992000-0000-4000-8000-000000000002'
 where id = '99992000-0000-4000-8000-000000000022';

insert into orders (id, account_id, holder_name, holder_email) values
  ('99992000-0000-4000-8000-000000000031', '99992000-0000-4000-8000-000000000025',
   'Notif Payment Holder', 'notif-payment-client@test.local');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, referrer_partner_id, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  ('99992000-0000-4000-8000-000000000041', '99992000-0000-4000-8000-000000000031',
   '99992000-0000-4000-8000-000000000025',
   '99992000-0000-4000-8000-000000000012', '2028-12-10', 1, 'reserved', 'Notif Payment Holder',
   100000, 100000, 'direct', null, 0.17, 0, 0.17, 17000, 0, 17000),
  ('99992000-0000-4000-8000-000000000042', '99992000-0000-4000-8000-000000000031',
   '99992000-0000-4000-8000-000000000025',
   '99992000-0000-4000-8000-000000000012', '2028-12-11', 1, 'reserved', 'Notif Payment Holder',
   100000, 100000, 'external_referrer', '99992000-0000-4000-8000-000000000002', 0.17, 0.1, 0.07,
   17000, 10000, 7000);
insert into payments (id, order_id, status, amount_cop) values
  ('99992000-0000-4000-8000-000000000051', '99992000-0000-4000-8000-000000000031', 'pending', 34000);

------------------------------------------------------------------------------------------------
-- apply_payment_webhook — les 3 notifications (spec 23 §0/§4)
------------------------------------------------------------------------------------------------
set local role service_role;
select is(
  (select apply_payment_webhook(
     'mp-notif-1', '99992000-0000-4000-8000-000000000051'::uuid, 'approved',
     jsonb_build_object('id', 'mp-notif-1', 'status', 'approved')
   ) ->> 'ok'),
  'true',
  'cas 1 : webhook approved réussit normalement'
);
reset role;

select is(
  (select count(*)::int from notification_emails
    where event_type = 'partner_commission_earned' and related_table = 'orders'
      and related_id = '99992000-0000-4000-8000-000000000031'
      and recipient_email = 'notif-payment-referrer@test.local'),
  1,
  'cas 2 : commission attribuée → notifie le compte du référent externe'
);
select is(
  (select count(*)::int from notification_emails
    where event_type = 'partner_payment_confirmed' and related_table = 'orders'
      and related_id = '99992000-0000-4000-8000-000000000031'
      and recipient_email = 'notif-payment-owner@test.local'),
  1,
  'cas 3 : paiement effectué → notifie le compte du partenaire propriétaire du produit'
);
select ok(
  ((select body_html from notification_emails
    where event_type = 'client_order_confirmed' and related_table = 'orders'
      and related_id = '99992000-0000-4000-8000-000000000031') like '%Producto Notif Payment%'),
  'cas 4 : confirmation client → un email à orders.holder_email listant les prestations commandées'
);

------------------------------------------------------------------------------------------------
-- Fault-injection sur l'invariant §8.1 — LE test le plus important de cette spec.
------------------------------------------------------------------------------------------------
insert into orders (id, account_id, holder_name, holder_email) values
  ('99992000-0000-4000-8000-000000000032', '99992000-0000-4000-8000-000000000024',
   'Notif Payment Holder 2', 'notif-payment-client-2@test.local');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  '99992000-0000-4000-8000-000000000043', '99992000-0000-4000-8000-000000000032',
  '99992000-0000-4000-8000-000000000024',
  '99992000-0000-4000-8000-000000000012', '2028-12-12', 1, 'reserved', 'Notif Payment Holder 2',
  100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000
);
insert into payments (id, order_id, status, amount_cop) values
  ('99992000-0000-4000-8000-000000000052', '99992000-0000-4000-8000-000000000032', 'pending', 17000);

create or replace function enqueue_notification_email(
  p_event_type text, p_recipient_email text, p_recipient_account_id uuid,
  p_subject text, p_body_html text, p_related_table text default null, p_related_id uuid default null
) returns uuid language plpgsql as $$
begin
  raise exception 'fault injection : enqueue_notification_email toujours en échec (test apply_payment_webhook)';
end;
$$;

set local role service_role;
select lives_ok(
  $$
    select apply_payment_webhook(
      'mp-notif-2', '99992000-0000-4000-8000-000000000052'::uuid, 'approved',
      jsonb_build_object('id', 'mp-notif-2', 'status', 'approved')
    )
  $$,
  'cas 5 : apply_payment_webhook réussit MÊME QUAND enqueue_notification_email échoue systématiquement (spec 23 §8.1 — le plus important de cette spec)'
);
reset role;
select is(
  (select status::text from payments where id = '99992000-0000-4000-8000-000000000052'),
  'approved',
  'cas 6 : le paiement est bien passé approved malgré l''échec systématique de la notification'
);
select is(
  (select payment_status from orders where id = '99992000-0000-4000-8000-000000000032'),
  'paid',
  'cas 7 : orders.payment_status est bien passé paid malgré l''échec systématique de la notification'
);

------------------------------------------------------------------------------------------------
-- Trigger "blocage camp/evento" (create_order, spec 23 §7/§10 point 3)
------------------------------------------------------------------------------------------------
insert into partners (id, display_name) values ('99992000-0000-4000-8000-000000000003', 'Notif Camp Partner');
insert into establishments (id, partner_id, name) values
  ('99992000-0000-4000-8000-000000000013', '99992000-0000-4000-8000-000000000003',
   jsonb_build_object('es', 'Establecimiento Notif Camp'));
insert into products (
  id, partner_id, establishment_id, type, name, price_cop, sellable, slug, duration_days
) values (
  '99992000-0000-4000-8000-000000000014', '99992000-0000-4000-8000-000000000003',
  '99992000-0000-4000-8000-000000000013', 'camp',
  jsonb_build_object('es', 'Camp Notif Test'), 100000, true, 'notif-camp-test', 2
);
insert into provider_resource_calendar (establishment_id, slot_date, capacity, booked) values
  ('99992000-0000-4000-8000-000000000013', '2028-12-20', 5, 0),
  ('99992000-0000-4000-8000-000000000013', '2028-12-21', 5, 0);
-- Un camp passe par la branche générique de validation (product_availability), EN PLUS de la
-- ressource partagée provider_resource_calendar ci-dessus — même fixture que
-- tests/concurrency/create_order_camp.concurrency.mjs.
insert into product_availability (product_id, date, capacity, booked) values
  ('99992000-0000-4000-8000-000000000014', '2028-12-20', 5, 0);
-- Produit 015 (lodging, 2026-09-15) — migration 20260915100000_camp_requires_compatible_lodging :
-- un camp de plus d'un jour (duration_days=2 ici) exige désormais une ligne lodging compatible
-- dans le même panier, sans quoi cet appel serait rejeté (camp_missing_lodging) avant même
-- d'atteindre le sujet de ce cas (déclenchement de la notification prestataire).
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug)
values (
  '99992000-0000-4000-8000-000000000015', '99992000-0000-4000-8000-000000000003',
  '99992000-0000-4000-8000-000000000013', 'lodging',
  jsonb_build_object('es', 'Alojamiento Notif Camp'), 50000, true, 'notif-camp-lodging'
);
insert into product_availability (product_id, date, capacity, booked) values
  ('99992000-0000-4000-8000-000000000015', '2028-12-20', 5, 0);
insert into auth.users (id, email) values ('99992000-0000-4000-8000-000000000023', 'notif-camp-owner@test.local');
update partner_accounts set partner_id = '99992000-0000-4000-8000-000000000003'
 where id = '99992000-0000-4000-8000-000000000023';
insert into partner_capabilities (partner_id, role, source, status) values
  ('99992000-0000-4000-8000-000000000003', 'referrer', 'migration', 'active');

-- Restaure la vraie fonction (la version "toujours en échec" ci-dessus casserait ce cas aussi) —
-- rollback global en fin de fichier de toute façon, mais explicite ici pour ne pas dépendre de
-- l'ordre des cas suivants si le fichier est un jour réorganisé.
create or replace function enqueue_notification_email(
  p_event_type text, p_recipient_email text, p_recipient_account_id uuid,
  p_subject text, p_body_html text, p_related_table text default null, p_related_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_recipient_email is null or btrim(p_recipient_email) = '' then
    return null;
  end if;
  insert into public.notification_emails (
    event_type, recipient_email, recipient_account_id, subject, body_html, related_table, related_id
  ) values (
    p_event_type, p_recipient_email, p_recipient_account_id, p_subject, p_body_html, p_related_table, p_related_id
  )
  on conflict (
    event_type, related_table, related_id,
    coalesce(recipient_account_id, '00000000-0000-0000-0000-000000000000'::uuid)
  ) where related_id is not null
  do nothing
  returning id into v_id;
  return v_id;
end;
$$;

set local role authenticated;
select test_login('99992000-0000-4000-8000-000000000023');
-- Panier posé en cart_items (spec 32) : create_order lit désormais ses propres lignes pour
-- auth.uid(), plus un paramètre.
insert into cart_items (account_id, product_id, date, qty) values
  ('99992000-0000-4000-8000-000000000023', '99992000-0000-4000-8000-000000000014', '2028-12-20', 1);
insert into cart_items (account_id, product_id, date, end_date, qty) values
  ('99992000-0000-4000-8000-000000000023', '99992000-0000-4000-8000-000000000015',
   '2028-12-20', '2028-12-21', 1);
select create_order(
  'Notif Camp Holder', 'notif-camp-holder@test.local'
) as v_create_order_result \gset
reset role;
select is(
  (:'v_create_order_result')::jsonb ->> 'ok',
  'true',
  'cas 8 : create_order (camp) réussit'
);
-- ADAPTÉ (migration 20261023120000, Lobby après l'acompte) : ce cas affirmait l'e-mail « recurso
-- bloqueado » AVANT tout paiement (spec 23 §10 point 3, branché dans create_order). Décision du
-- 2026-10-23 : « si pas payé, pas réservé » — il annonçait « Reserva confirmada » pour une commande
-- peut-être jamais payée. Le blocage, lui, reste posé à la création ; l'e-mail part à la
-- confirmation (notify_order_confirmed), sauf commande sans rien à payer en ligne
-- (lobby_apres_acompte_paiement.test.sql).
select is(
  (select count(*)::int from notification_emails
    where event_type = 'partner_camp_evento_blocked' and related_table = 'order_lines'
      and recipient_email = 'notif-camp-owner@test.local'),
  0,
  'cas 9 : blocage camp → AUCUN e-mail « recurso bloqueado » à la création, avant tout paiement'
);
insert into payments (id, order_id, status, amount_cop)
values ('99992000-0000-4000-8000-000000000053', ((:'v_create_order_result')::jsonb ->> 'order_id')::uuid, 'pending', 1);
set local role service_role;
select apply_payment_webhook(
  'mp-notif-camp', '99992000-0000-4000-8000-000000000053'::uuid, 'approved',
  jsonb_build_object('id', 'mp-notif-camp', 'status', 'approved')
);
reset role;
select is(
  (select count(*)::int from notification_emails
    where event_type = 'partner_camp_evento_blocked' and related_table = 'order_lines'
      and recipient_email = 'notif-camp-owner@test.local'),
  1,
  'cas 10 : paiement approuvé → l''e-mail « recurso bloqueado » part, au compte du partenaire propriétaire'
);

select * from finish();
rollback;

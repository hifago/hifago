-- Migration 20261019170000 — le WhatsApp du prestataire : obligatoire à la création, colombien, et
-- PRIVÉ jusqu'à ce que le client ait finalisé sa réservation (décision Jérôme du 2026-10-19).
--
-- Ce fichier prouve les trois moitiés de la règle, chacune là où elle est tenue :
--   1. la colonne n'est plus lisible par `anon` ni `authenticated` (lue sur l'ACL, jamais déduite) ;
--   2. aucune des trois portes de création ne laisse passer un établissement sans numéro valide ;
--   3. `order_for_client_jsonb` ne rend le numéro que sur une ligne vivante d'une commande
--      finalisée — payée, ou sans rien à payer en ligne.
begin;
select plan(21);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('c0570000-0000-4000-8000-000000000001', 'WhatsApp Prive Partner');
insert into auth.users (id, email) values
  ('c0570000-0000-4000-8000-000000000021', 'whatsapp-prive-partner@test.local'),
  ('c0570000-0000-4000-8000-000000000022', 'whatsapp-prive-admin@test.local'),
  ('c0570000-0000-4000-8000-000000000031', 'whatsapp-prive-buyer@test.local');
update partner_accounts set partner_id = 'c0570000-0000-4000-8000-000000000001'
 where id = 'c0570000-0000-4000-8000-000000000021';
-- enforce_operator_implies_referrer : create_establishment attache une capacité operator.
insert into partner_capabilities (partner_id, role, source, status) values
  ('c0570000-0000-4000-8000-000000000001', 'referrer', 'migration', 'active');
insert into partner_capabilities (account_id, role, source, status) values
  ('c0570000-0000-4000-8000-000000000022', 'admin', 'migration', 'active');

-- Une proposition de création déposée AVANT la migration : sans numéro.
insert into establishment_proposals (id, establishment_id, partner_id, submitted_by, kind, payload) values (
  'c0570000-0000-4000-8000-000000000061', null, 'c0570000-0000-4000-8000-000000000001',
  'c0570000-0000-4000-8000-000000000021', 'create',
  jsonb_build_object('name', jsonb_build_object('es', 'Hostal Sin WhatsApp')));

-- ── 1. La lecture ─────────────────────────────────────────────────────────────────────────────
select ok(
  not has_column_privilege('anon', 'public.establishments', 'contact_phone', 'SELECT'),
  'anon ne lit plus contact_phone'
);
select ok(
  not has_column_privilege('authenticated', 'public.establishments', 'contact_phone', 'SELECT'),
  'authenticated non plus : un client connecté à la vitrine est authenticated'
);
select ok(
  has_column_privilege('anon', 'public.establishments', 'name', 'SELECT'),
  'les autres colonnes publiques restent lisibles (le revoke est colonne par colonne)'
);
select ok(
  not has_function_privilege('anon', 'public.get_establishment_contact_phone(uuid)', 'EXECUTE'),
  'anon ne peut pas appeler get_establishment_contact_phone'
);

-- ── La forme ──────────────────────────────────────────────────────────────────────────────────
select is(public.colombian_whatsapp_or_null('+57 300-123 4567'), '+573001234567',
  'espaces et tirets ôtés, forme canonique rendue');
select is(public.colombian_whatsapp_or_null('+33612345678'), null, 'un numéro étranger est refusé');
select is(public.colombian_whatsapp_or_null('3001234567'), null,
  'sans +57, rien n''est deviné (c''est l''écran qui porte le préfixe)');

-- ── 2. Les portes de création ─────────────────────────────────────────────────────────────────
set local role authenticated;
select test_login('c0570000-0000-4000-8000-000000000022');

select throws_ok(
  $$ select create_establishment('c0570000-0000-4000-8000-000000000001',
       jsonb_build_object('es', 'Sin Numero')) $$,
  '22023', 'contact_phone_required',
  'create_establishment refuse un établissement sans WhatsApp'
);
select throws_ok(
  $$ select create_establishment('c0570000-0000-4000-8000-000000000001',
       jsonb_build_object('es', 'Numero Frances'), p_contact_phone => '+33612345678') $$,
  '22023', 'contact_phone_invalid',
  'create_establishment refuse un numéro non colombien'
);

create temp table t_cree as
  select create_establishment('c0570000-0000-4000-8000-000000000001',
    jsonb_build_object('es', 'Con Numero'), p_contact_phone => '+57 300 111 2233') as id;

select is(
  public.get_establishment_contact_phone((select id from t_cree)), '+573001112233',
  'créé avec son numéro, stocké sous forme canonique, rendu à l''admin'
);
select is(
  public.update_establishment_contact((select id from t_cree), '') ->> 'reason', 'phone_required',
  'update_establishment_contact n''efface plus le numéro'
);

select test_login('c0570000-0000-4000-8000-000000000021');
select is(
  public.get_establishment_contact_phone((select id from t_cree)), null,
  'un non-admin reçoit null de get_establishment_contact_phone'
);
select is(
  submit_establishment_creation_proposal(jsonb_build_object('name', jsonb_build_object('es', 'Prop Sin'))) ->> 'reason',
  'contact_phone_required',
  'une proposition sans WhatsApp est refusée avant d''entrer dans la file'
);
select is(
  submit_establishment_creation_proposal(jsonb_build_object(
    'name', jsonb_build_object('es', 'Prop Mal'), 'contact_phone', '+57 300')) ->> 'reason',
  'contact_phone_invalid',
  'une proposition au numéro incomplet est refusée'
);

select test_login('c0570000-0000-4000-8000-000000000022');
select is(
  moderate_establishment_proposal('c0570000-0000-4000-8000-000000000061', 'approve', 1) ->> 'reason',
  'contact_phone_required',
  'une ancienne proposition sans numéro ne s''approuve pas telle quelle'
);
select is(
  moderate_establishment_proposal('c0570000-0000-4000-8000-000000000061', 'approve', 1,
    jsonb_build_object('contact_phone', '+573004445566')) ->> 'ok',
  'true',
  'l''admin la valide en saisissant le numéro'
);
select is(
  public.get_establishment_contact_phone(
    (select establishment_id from establishment_proposals where id = 'c0570000-0000-4000-8000-000000000061')),
  '+573004445566',
  'l''établissement né de la proposition porte le numéro saisi par l''admin'
);

-- ── 3. Le numéro ne sort qu'après une réservation finalisée ───────────────────────────────────
reset role;

insert into establishments (id, partner_id, name, contact_phone) values
  ('c0570000-0000-4000-8000-000000000011', 'c0570000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Lugar Pedido'), '+573007778899');
insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('c0570000-0000-4000-8000-000000000041', 'c0570000-0000-4000-8000-000000000001',
   'c0570000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Actividad WhatsApp'), 100000, true, 'whatsapp-prive-test');
insert into orders (id, account_id, holder_name, holder_email) values
  ('c0570000-0000-4000-8000-000000000051', 'c0570000-0000-4000-8000-000000000031',
   'Cliente', 'cliente-whatsapp@test.local');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  ('c0570000-0000-4000-8000-000000000071', 'c0570000-0000-4000-8000-000000000051',
   'c0570000-0000-4000-8000-000000000031', 'c0570000-0000-4000-8000-000000000041',
   '2026-11-01', 1, 'reserved', 'Cliente', 100000, 100000, 'direct', 0.17, 0, 0.17, 17000, 0, 17000);

create function telephone_ligne() returns text language sql as $$
  select public.order_for_client_jsonb(o) #>> '{lines,0,establishment_contact_phone}'
    from orders o where o.id = 'c0570000-0000-4000-8000-000000000051';
$$;

select is(telephone_ligne(), null, 'commande non payée, acompte dû : aucun numéro');

update orders set payment_status = 'paid' where id = 'c0570000-0000-4000-8000-000000000051';
select is(telephone_ligne(), '+573007778899', 'commande payée : le numéro du prestataire sort');

update order_lines set status = 'cancelled_by_client' where id = 'c0570000-0000-4000-8000-000000000071';
select is(telephone_ligne(), null, 'une ligne annulée ne rend plus le numéro, même payée');

-- Evento gratuit / payable sur place : rien n'est dû en ligne, la réservation est finalisée dès
-- sa création (état « confirmed » d'orderState.ts).
update orders set payment_status = 'unpaid' where id = 'c0570000-0000-4000-8000-000000000051';
update order_lines set status = 'reserved', acompte_cop = 0 where id = 'c0570000-0000-4000-8000-000000000071';
select is(telephone_ligne(), '+573007778899', 'rien à payer en ligne : le numéro sort');

select * from finish();
rollback;

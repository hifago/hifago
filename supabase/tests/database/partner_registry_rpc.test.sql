-- Feature 23 (Admin : registre d'identité partenaire) — grant_capability, set_capability_status,
-- transfer_establishment, set_partner_code_active.
begin;
select plan(44);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Fixtures : partenaire A (déjà referrer+operator actifs, pour la symétrie set_capability_status
-- et le cas doublon) ; partenaire B (aucune capacité, pour "operator sans referrer existant") ;
-- un établissement par partenaire (B sert au cas "déjà rattaché à un autre partenaire").
insert into partners (id, display_name) values
  ('a2000000-0000-4000-8000-000000000001', 'Registry Test A'),
  ('a2000000-0000-4000-8000-000000000002', 'Registry Test B');

insert into establishments (id, partner_id, name) values
  ('a2000000-0000-4000-8000-000000000011', 'a2000000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento A')),
  ('a2000000-0000-4000-8000-000000000012', 'a2000000-0000-4000-8000-000000000002',
   jsonb_build_object('es', 'Establecimiento B'));

insert into auth.users (id, email) values
  ('a2000000-0000-4000-8000-000000000021', 'registry-admin@test.local'),
  ('a2000000-0000-4000-8000-000000000022', 'registry-nonadmin@test.local');

insert into partner_capabilities (account_id, role, source, status) values
  ('a2000000-0000-4000-8000-000000000021', 'admin', 'migration', 'active');

insert into partner_capabilities (id, partner_id, role, source, status) values
  ('a2000000-0000-4000-8000-000000000031', 'a2000000-0000-4000-8000-000000000001',
   'referrer', 'migration', 'active');
insert into partner_capabilities (id, partner_id, establishment_id, role, source, status) values
  ('a2000000-0000-4000-8000-000000000032', 'a2000000-0000-4000-8000-000000000001',
   'a2000000-0000-4000-8000-000000000011', 'operator', 'migration', 'active');

insert into partner_codes (code, partner_id, active) values
  ('REGTEST-A', 'a2000000-0000-4000-8000-000000000001', true);

set local role authenticated;
select test_login('a2000000-0000-4000-8000-000000000022');

-- Chaque RPC refusée pour un non-admin ------------------------------------------------------------
select throws_ok(
  $$ select grant_capability('a2000000-0000-4000-8000-000000000002'::uuid, 'referrer') $$,
  '42501'::char(5), 'grant_capability réservé au rôle admin',
  'grant_capability refuse un appelant non-admin'
);
select throws_ok(
  $$ select set_capability_status('a2000000-0000-4000-8000-000000000031'::uuid, 'active') $$,
  '42501'::char(5), 'set_capability_status réservé au rôle admin',
  'set_capability_status refuse un appelant non-admin'
);
-- SECURITY DEFINER depuis 20261006182227 : garde is_admin explicite, comme les autres RPC du
-- registre (la RLS ne protège plus rien dans une fonction DEFINER).
select throws_ok(
  $$ select transfer_establishment('a2000000-0000-4000-8000-000000000011'::uuid,
       'a2000000-0000-4000-8000-000000000002'::uuid) $$,
  '42501'::char(5), 'transfer_establishment réservé au rôle admin',
  'transfer_establishment refuse un appelant non-admin'
);
select throws_ok(
  $$ select set_partner_code_active('REGTEST-A', false) $$,
  '42501'::char(5), 'set_partner_code_active réservé au rôle admin',
  'set_partner_code_active refuse un appelant non-admin'
);

select test_login('a2000000-0000-4000-8000-000000000021');

-- grant_capability : operator sans referrer existant → les deux lignes créées, dans cet ordre ----
select lives_ok(
  $$ select grant_capability('a2000000-0000-4000-8000-000000000002'::uuid, 'operator',
       'a2000000-0000-4000-8000-000000000012'::uuid) $$,
  'grant_capability (operator, partenaire sans aucune capacité) réussit'
);
select is(
  (select array_agg(role order by created_at) from partner_capabilities
    where partner_id = 'a2000000-0000-4000-8000-000000000002')::text[],
  array['referrer', 'operator'],
  'la ligne referrer est créée avant la ligne operator (invariant operator ⇒ referrer)'
);

-- grant_capability : doublon exact (même partenaire/rôle/établissement) → exception -------------
select throws_ok(
  $$ select grant_capability('a2000000-0000-4000-8000-000000000001'::uuid, 'referrer') $$,
  'P0001'::char(5), null,
  'grant_capability refuse un doublon exact partenaire/rôle/établissement'
);

-- set_capability_status : statut invalide / capacité inexistante → exception chacun -------------
select throws_ok(
  $$ select set_capability_status('a2000000-0000-4000-8000-000000000031'::uuid, 'bogus') $$,
  'P0001'::char(5), null,
  'set_capability_status refuse un statut invalide'
);
select throws_ok(
  $$ select set_capability_status('00000000-0000-4000-8000-000000000099'::uuid, 'active') $$,
  'P0001'::char(5), 'capacité introuvable',
  'set_capability_status refuse un capability_id inexistant'
);

-- set_capability_status : admin valide, testé sur les DEUX rôles (preuve de la symétrie) --------
select lives_ok(
  $$ select set_capability_status('a2000000-0000-4000-8000-000000000031'::uuid, 'suspended', 'note-referrer') $$,
  'set_capability_status réussit sur une capacité referrer'
);
select is(
  (select status from partner_capabilities where id = 'a2000000-0000-4000-8000-000000000031'),
  'suspended',
  'statut referrer mis à jour'
);
select is(
  (select count(*) from audit_log where note = 'note-referrer')::int, 1,
  'une ligne audit_log créée pour la transition referrer'
);

select lives_ok(
  $$ select set_capability_status('a2000000-0000-4000-8000-000000000032'::uuid, 'suspended', 'note-operator') $$,
  'set_capability_status réussit sur une capacité operator (même fonction, symétrie)'
);
select is(
  (select status from partner_capabilities where id = 'a2000000-0000-4000-8000-000000000032'),
  'suspended',
  'statut operator mis à jour'
);
select is(
  (select count(*) from audit_log where note = 'note-operator')::int, 1,
  'une ligne audit_log créée pour la transition operator'
);

-- transfer_establishment : établissement déjà rattaché à un AUTRE partenaire → transfert, pas
-- un doublon --------------------------------------------------------------------------------
select lives_ok(
  $$ select transfer_establishment('a2000000-0000-4000-8000-000000000012'::uuid,
       'a2000000-0000-4000-8000-000000000001'::uuid, 'note-transfer') $$,
  'transfer_establishment réussit sur un établissement déjà rattaché à un autre partenaire'
);
select is(
  (select partner_id from establishments where id = 'a2000000-0000-4000-8000-000000000012'),
  'a2000000-0000-4000-8000-000000000001'::uuid,
  'partner_id transféré vers le nouveau partenaire (pas de doublon)'
);
-- before porte la ligne operator retirée à B (créée plus haut par grant_capability, id inconnu
-- ici) : comparée par ses champs stables, le détail des cas vit dans la section suivante.
select is(
  (select jsonb_build_object(
            'action', action,
            'before_partner_id', before ->> 'partner_id',
            'before_capability', jsonb_build_object(
              'partner_id', before -> 'operator_capability' ->> 'partner_id',
              'role', before -> 'operator_capability' ->> 'role',
              'establishment_id', before -> 'operator_capability' ->> 'establishment_id'),
            'after_partner_id', after ->> 'partner_id',
            'after_origin', after ->> 'operator_capability_origin')
     from audit_log where note = 'note-transfer'),
  jsonb_build_object(
    'action', 'establishment.transfer',
    'before_partner_id', 'a2000000-0000-4000-8000-000000000002',
    'before_capability', jsonb_build_object(
      'partner_id', 'a2000000-0000-4000-8000-000000000002',
      'role', 'operator',
      'establishment_id', 'a2000000-0000-4000-8000-000000000012'),
    'after_partner_id', 'a2000000-0000-4000-8000-000000000001',
    'after_origin', 'created'
  ),
  'audit_log enregistre before/after corrects pour le transfert'
);

-- set_partner_code_active : admin bascule → actif mis à jour + audit_log ------------------------
select lives_ok(
  $$ select set_partner_code_active('REGTEST-A', false, 'note-code') $$,
  'set_partner_code_active réussit pour l''admin'
);
select is(
  (select active from partner_codes where code = 'REGTEST-A'),
  false,
  'active basculé à false'
);
select is(
  (select jsonb_build_object('entity_id', entity_id, 'before', before, 'after', after)
     from audit_log where note = 'note-code'),
  jsonb_build_object(
    'entity_id', null,
    'before', jsonb_build_object('code', 'REGTEST-A', 'active', true),
    'after', jsonb_build_object('code', 'REGTEST-A', 'active', false)
  ),
  'audit_log enregistre entity_id=null (clé texte) et le code dans before/after'
);

-- transfer_establishment : capacités, produits, propositions (20261006182227) -------------------
-- C possède quatre établissements (E1-E4) et opère E1 et E2 ; D n'a aucune capacité ; E a un
-- referrer, une ligne operator SUSPENDUE déjà scopée à E3 et une ligne operator en attente
-- (establishment_id null). P1 est sur E1, P2 sur E2. Une réservation sur P1. Propositions de C :
-- comptées sur E1 (content sur P1, create sur E1, edit d'établissement sur E1), non comptées
-- (content sur P2 = autre établissement, content rejetée, edit retirée).
reset role;

insert into partners (id, display_name) values
  ('a2000000-0000-4000-8000-000000000101', 'Registry Transfer C'),
  ('a2000000-0000-4000-8000-000000000102', 'Registry Transfer D'),
  ('a2000000-0000-4000-8000-000000000103', 'Registry Transfer E');

insert into establishments (id, partner_id, name) values
  ('a2000000-0000-4000-8000-000000000111', 'a2000000-0000-4000-8000-000000000101',
   jsonb_build_object('es', 'Establecimiento Transfer E1')),
  ('a2000000-0000-4000-8000-000000000112', 'a2000000-0000-4000-8000-000000000101',
   jsonb_build_object('es', 'Establecimiento Transfer E2')),
  ('a2000000-0000-4000-8000-000000000113', 'a2000000-0000-4000-8000-000000000101',
   jsonb_build_object('es', 'Establecimiento Transfer E3')),
  ('a2000000-0000-4000-8000-000000000114', 'a2000000-0000-4000-8000-000000000101',
   jsonb_build_object('es', 'Establecimiento Transfer E4'));

insert into auth.users (id, email) values
  ('a2000000-0000-4000-8000-000000000131', 'registry-transfer-c@test.local'),
  ('a2000000-0000-4000-8000-000000000132', 'registry-transfer-d@test.local'),
  ('a2000000-0000-4000-8000-000000000133', 'registry-transfer-buyer@test.local');
update partner_accounts set partner_id = 'a2000000-0000-4000-8000-000000000101'
 where id = 'a2000000-0000-4000-8000-000000000131';
update partner_accounts set partner_id = 'a2000000-0000-4000-8000-000000000102'
 where id = 'a2000000-0000-4000-8000-000000000132';

insert into partner_capabilities (id, partner_id, role, establishment_id, source, status) values
  ('a2000000-0000-4000-8000-000000000141', 'a2000000-0000-4000-8000-000000000101', 'referrer',
   null, 'migration', 'active'),
  ('a2000000-0000-4000-8000-000000000142', 'a2000000-0000-4000-8000-000000000101', 'operator',
   'a2000000-0000-4000-8000-000000000111', 'migration', 'active'),
  ('a2000000-0000-4000-8000-000000000143', 'a2000000-0000-4000-8000-000000000101', 'operator',
   'a2000000-0000-4000-8000-000000000112', 'migration', 'active'),
  ('a2000000-0000-4000-8000-000000000144', 'a2000000-0000-4000-8000-000000000103', 'referrer',
   null, 'migration', 'active'),
  ('a2000000-0000-4000-8000-000000000145', 'a2000000-0000-4000-8000-000000000103', 'operator',
   'a2000000-0000-4000-8000-000000000113', 'migration', 'suspended'),
  ('a2000000-0000-4000-8000-000000000146', 'a2000000-0000-4000-8000-000000000103', 'operator',
   null, 'migration', 'active');

insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('a2000000-0000-4000-8000-000000000121', 'a2000000-0000-4000-8000-000000000101',
   'a2000000-0000-4000-8000-000000000111', 'activity',
   jsonb_build_object('es', 'Actividad Transfer P1'), 50000, true, 'registry-transfer-p1-test'),
  ('a2000000-0000-4000-8000-000000000122', 'a2000000-0000-4000-8000-000000000101',
   'a2000000-0000-4000-8000-000000000112', 'activity',
   jsonb_build_object('es', 'Actividad Transfer P2'), 50000, true, 'registry-transfer-p2-test');

insert into orders (id, account_id, holder_name, holder_email) values
  ('a2000000-0000-4000-8000-000000000151', 'a2000000-0000-4000-8000-000000000133',
   'Registry Transfer Holder', 'registry-transfer-holder@test.local');
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  ('a2000000-0000-4000-8000-000000000152', 'a2000000-0000-4000-8000-000000000151',
   'a2000000-0000-4000-8000-000000000133', 'a2000000-0000-4000-8000-000000000121',
   '2029-08-20', 1, 'reserved', 'Registry Transfer Holder',
   50000, 50000, 'direct', 0, 0, 0, 0, 0, 0);

insert into product_proposals (id, kind, product_id, establishment_id, type, partner_id, submitted_by, payload, status) values
  ('a2000000-0000-4000-8000-000000000161', 'content', 'a2000000-0000-4000-8000-000000000121', null, null,
   'a2000000-0000-4000-8000-000000000101', 'a2000000-0000-4000-8000-000000000131',
   jsonb_build_object('name', jsonb_build_object('es', 'Contenido P1')), 'pending'),
  ('a2000000-0000-4000-8000-000000000162', 'create', null, 'a2000000-0000-4000-8000-000000000111', 'activity',
   'a2000000-0000-4000-8000-000000000101', 'a2000000-0000-4000-8000-000000000131',
   jsonb_build_object('name', jsonb_build_object('es', 'Actividad Transfer Propuesta'), 'price_cop', 40000), 'pending'),
  ('a2000000-0000-4000-8000-000000000163', 'content', 'a2000000-0000-4000-8000-000000000122', null, null,
   'a2000000-0000-4000-8000-000000000101', 'a2000000-0000-4000-8000-000000000131',
   jsonb_build_object('name', jsonb_build_object('es', 'Contenido P2')), 'pending'),
  ('a2000000-0000-4000-8000-000000000164', 'content', 'a2000000-0000-4000-8000-000000000121', null, null,
   'a2000000-0000-4000-8000-000000000101', 'a2000000-0000-4000-8000-000000000131',
   jsonb_build_object('name', jsonb_build_object('es', 'Contenido P1 rechazado')), 'rejected');
insert into establishment_proposals (id, kind, establishment_id, partner_id, submitted_by, payload, status) values
  ('a2000000-0000-4000-8000-000000000171', 'edit', 'a2000000-0000-4000-8000-000000000111',
   'a2000000-0000-4000-8000-000000000101', 'a2000000-0000-4000-8000-000000000131', '{}'::jsonb, 'pending'),
  ('a2000000-0000-4000-8000-000000000172', 'edit', 'a2000000-0000-4000-8000-000000000111',
   'a2000000-0000-4000-8000-000000000101', 'a2000000-0000-4000-8000-000000000131', '{}'::jsonb, 'withdrawn');

set local role authenticated;

-- Témoin : avant le transfert, C voit la réservation de P1 (sinon « 0 après » ne prouverait rien).
select test_login('a2000000-0000-4000-8000-000000000131');
select is(
  (select count(*)::int from partner_reservations_list(p_limit => 20, p_offset => 0)),
  1,
  'témoin : avant le transfert, C voit la réservation de E1'
);

select test_login('a2000000-0000-4000-8000-000000000021');
select is(
  transfer_establishment('a2000000-0000-4000-8000-000000000111'::uuid,
    'a2000000-0000-4000-8000-000000000102'::uuid, 'note-p13-transfer'),
  jsonb_build_object(
    'ok', true, 'resync', false, 'operator_capability_origin', 'created', 'products_moved', 1,
    'pending_product_proposals', 2, 'pending_establishment_proposals', 1),
  'transfert E1 C → D : capacité créée, 1 produit basculé, propositions en attente de C comptées (2 + 1)'
);

select test_login('a2000000-0000-4000-8000-000000000131');
select is(
  (select count(*)::int from partner_reservations_list(p_limit => 20, p_offset => 0)),
  0,
  'après le transfert, C ne voit plus la réservation de E1'
);
select test_login('a2000000-0000-4000-8000-000000000132');
select is(
  (select count(*)::int from partner_reservations_list(p_limit => 20, p_offset => 0)),
  1,
  'après le transfert, D voit la réservation de E1'
);

select test_login('a2000000-0000-4000-8000-000000000021');
select is(
  transfer_establishment('a2000000-0000-4000-8000-000000000113'::uuid,
    'a2000000-0000-4000-8000-000000000103'::uuid) ->> 'operator_capability_origin',
  'reactivated',
  'transfert E3 → E : la ligne operator suspendue déjà scopée à E3 est réactivée'
);
select is(
  transfer_establishment('a2000000-0000-4000-8000-000000000114'::uuid,
    'a2000000-0000-4000-8000-000000000103'::uuid) ->> 'operator_capability_origin',
  'rescoped',
  'transfert E4 → E : la ligne operator en attente est rattachée à E4'
);
select throws_ok(
  $$ select transfer_establishment('00000000-0000-4000-8000-000000000099'::uuid,
       'a2000000-0000-4000-8000-000000000102'::uuid) $$,
  'P0001'::char(5), 'établissement introuvable',
  'transfer_establishment refuse un établissement inexistant'
);

-- Resynchronisation (ancien = nouveau) : produit et capacité de D désalignés à la main.
reset role;
update products set partner_id = 'a2000000-0000-4000-8000-000000000101'
 where id = 'a2000000-0000-4000-8000-000000000121';
update partner_capabilities set status = 'suspended'
 where partner_id = 'a2000000-0000-4000-8000-000000000102' and role = 'operator'
   and establishment_id = 'a2000000-0000-4000-8000-000000000111';
set local role authenticated;
select test_login('a2000000-0000-4000-8000-000000000021');
select is(
  transfer_establishment('a2000000-0000-4000-8000-000000000111'::uuid,
    'a2000000-0000-4000-8000-000000000102'::uuid, 'note-p13-resync'),
  jsonb_build_object(
    'ok', true, 'resync', true, 'operator_capability_origin', 'reactivated', 'products_moved', 1,
    'pending_product_proposals', 0, 'pending_establishment_proposals', 0),
  'resynchronisation E1 → D (déjà propriétaire) : capacité réactivée, produit réaligné'
);

-- Proposition de création déposée par C AVANT le transfert, approuvée après.
select is(
  moderate_product_proposal('a2000000-0000-4000-8000-000000000162'::uuid, 'approve', 1) ->> 'ok',
  'true',
  'la proposition de création de C sur E1 est approuvable après le transfert'
);

reset role;
select is(
  (select partner_id from products
    where id = (select product_id from product_proposals where id = 'a2000000-0000-4000-8000-000000000162')),
  'a2000000-0000-4000-8000-000000000102'::uuid,
  'create_product_from_proposal : le produit approuvé appartient au propriétaire actuel (D), pas à l''auteur (C)'
);
select is(
  (select partner_id from establishments where id = 'a2000000-0000-4000-8000-000000000111'),
  'a2000000-0000-4000-8000-000000000102'::uuid,
  'E1 appartient à D'
);
select is(
  (select count(*)::int from partner_capabilities
    where partner_id = 'a2000000-0000-4000-8000-000000000101' and role = 'operator'
      and establishment_id = 'a2000000-0000-4000-8000-000000000111'),
  0,
  'la ligne operator de C sur E1 est retirée'
);
select is(
  array[
    has_capability('a2000000-0000-4000-8000-000000000131', 'operator', 'a2000000-0000-4000-8000-000000000111'),
    has_capability('a2000000-0000-4000-8000-000000000131', 'operator', 'a2000000-0000-4000-8000-000000000112')
  ],
  array[false, true],
  'C n''opère plus E1 mais garde sa capacité sur E2'
);
select is(
  (select jsonb_build_object('referrer', count(*) filter (where role = 'referrer' and status = 'active'),
                             'operator_e1', count(*) filter (where role = 'operator' and status = 'active'
                               and establishment_id = 'a2000000-0000-4000-8000-000000000111'))
     from partner_capabilities where partner_id = 'a2000000-0000-4000-8000-000000000102'),
  jsonb_build_object('referrer', 1, 'operator_e1', 1),
  'D (sans capacité au départ) reçoit un referrer puis une ligne operator active sur E1'
);
select ok(
  has_capability('a2000000-0000-4000-8000-000000000132', 'operator', 'a2000000-0000-4000-8000-000000000111'),
  'D opère E1'
);
select is(
  (select array_agg(partner_id::text order by id) from products
    where id in ('a2000000-0000-4000-8000-000000000121', 'a2000000-0000-4000-8000-000000000122')),
  array['a2000000-0000-4000-8000-000000000102', 'a2000000-0000-4000-8000-000000000101'],
  'P1 (E1) suit D, P2 (E2, non transféré) reste à C'
);
select is(
  (select jsonb_agg(jsonb_build_object('id', id, 'status', status) order by id) from partner_capabilities
    where partner_id = 'a2000000-0000-4000-8000-000000000103' and role = 'operator'
      and establishment_id = 'a2000000-0000-4000-8000-000000000113'),
  jsonb_build_array(jsonb_build_object('id', 'a2000000-0000-4000-8000-000000000145', 'status', 'active')),
  'E3 : la ligne suspendue est réactivée, sans doublon'
);
select is(
  (select jsonb_build_object(
            'line', (select jsonb_build_object('establishment_id', establishment_id, 'status', status)
                       from partner_capabilities where id = 'a2000000-0000-4000-8000-000000000146'),
            'pending_left', (select count(*) from partner_capabilities
                              where partner_id = 'a2000000-0000-4000-8000-000000000103' and role = 'operator'
                                and establishment_id is null))),
  jsonb_build_object(
    'line', jsonb_build_object('establishment_id', 'a2000000-0000-4000-8000-000000000114', 'status', 'active'),
    'pending_left', 0),
  'E4 : la ligne en attente de E est rattachée à E4 (aucune ligne en attente ne reste)'
);
select is(
  (select array_agg(status order by id) from (
     select id, status from product_proposals
      where id in ('a2000000-0000-4000-8000-000000000161', 'a2000000-0000-4000-8000-000000000163')
     union all
     select id, status from establishment_proposals where id = 'a2000000-0000-4000-8000-000000000171') s),
  array['pending', 'pending', 'pending'],
  'les propositions en attente de C sont conservées telles quelles (ni rejetées ni transférées)'
);
select is(
  (select jsonb_build_object(
            'partner_id', before ->> 'partner_id',
            'capability', jsonb_build_object(
              'id', before -> 'operator_capability' ->> 'id',
              'partner_id', before -> 'operator_capability' ->> 'partner_id',
              'establishment_id', before -> 'operator_capability' ->> 'establishment_id',
              'status', before -> 'operator_capability' ->> 'status',
              'source', before -> 'operator_capability' ->> 'source'))
     from audit_log where note = 'note-p13-transfer'),
  jsonb_build_object(
    'partner_id', 'a2000000-0000-4000-8000-000000000101',
    'capability', jsonb_build_object(
      'id', 'a2000000-0000-4000-8000-000000000142',
      'partner_id', 'a2000000-0000-4000-8000-000000000101',
      'establishment_id', 'a2000000-0000-4000-8000-000000000111',
      'status', 'active',
      'source', 'migration')),
  'audit_log.before : ancien propriétaire et ligne operator retirée, entière'
);
select is(
  (select after from audit_log where note = 'note-p13-transfer'),
  jsonb_build_object(
    'partner_id', 'a2000000-0000-4000-8000-000000000102',
    'resync', false,
    'operator_capability_id', (select id from partner_capabilities
                                where partner_id = 'a2000000-0000-4000-8000-000000000102' and role = 'operator'
                                  and establishment_id = 'a2000000-0000-4000-8000-000000000111'),
    'operator_capability_origin', 'created',
    'products_moved', 1,
    'pending_product_proposals', 2,
    'pending_establishment_proposals', 1),
  'audit_log.after : nouveau propriétaire, ligne posée, produits basculés, propositions en attente comptées'
);
select is(
  array[
    has_function_privilege('anon', 'public.transfer_establishment(uuid, uuid, text)', 'execute'),
    exists (select 1 from pg_proc p, aclexplode(p.proacl) a
             where p.oid = 'public.transfer_establishment(uuid, uuid, text)'::regprocedure
               and a.grantee = 0),
    has_function_privilege('authenticated', 'public.transfer_establishment(uuid, uuid, text)', 'execute')
  ],
  array[false, false, true],
  'transfer_establishment : aucun EXECUTE pour anon ni PUBLIC, EXECUTE pour authenticated'
);
-- Seul appelant : moderate_product_proposal (SECURITY DEFINER, exécutée en propriétaire).
select is(
  array[
    has_function_privilege('anon', 'public.create_product_from_proposal(uuid, uuid, text, jsonb)', 'execute'),
    has_function_privilege('authenticated', 'public.create_product_from_proposal(uuid, uuid, text, jsonb)', 'execute'),
    exists (select 1 from pg_proc p, aclexplode(p.proacl) a
             where p.oid = 'public.create_product_from_proposal(uuid, uuid, text, jsonb)'::regprocedure
               and a.grantee = 0)
  ],
  array[false, false, false],
  'create_product_from_proposal : aucun EXECUTE pour anon, authenticated ni PUBLIC'
);

select * from finish();
rollback;

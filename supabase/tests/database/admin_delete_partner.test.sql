-- admin_delete_partner / admin_partner_deletion_check (20261019150000).
--
-- Trois partenaires : 001 « propre » (supprimé, tout ce qui en dépend doit disparaître), 002 avec
-- une ligne de commande (refusé, rien ne bouge), 004 plateforme (propriétaire d'un lieu is_place,
-- refusé). Une photo partagée avec un autre partenaire (003) ne doit pas partir de Storage.
begin;
select plan(20);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('a5d00000-0000-4000-8000-000000000001', 'Delete Partner Propre'),
  ('a5d00000-0000-4000-8000-000000000002', 'Delete Partner Commande'),
  ('a5d00000-0000-4000-8000-000000000003', 'Delete Partner Voisin'),
  ('a5d00000-0000-4000-8000-000000000004', 'Delete Partner Plateforme');

insert into establishments (id, partner_id, name) values
  ('a5d00000-0000-4000-8000-000000000011', 'a5d00000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Propre')),
  ('a5d00000-0000-4000-8000-000000000012', 'a5d00000-0000-4000-8000-000000000002',
   jsonb_build_object('es', 'Establecimiento Commande')),
  ('a5d00000-0000-4000-8000-000000000013', 'a5d00000-0000-4000-8000-000000000003',
   jsonb_build_object('es', 'Establecimiento Voisin'));
insert into establishments (id, partner_id, name, is_place) values
  ('a5d00000-0000-4000-8000-000000000014', 'a5d00000-0000-4000-8000-000000000004',
   jsonb_build_object('es', 'Lugar Plateforme'), true);

insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('a5d00000-0000-4000-8000-000000000021', 'a5d00000-0000-4000-8000-000000000001',
   'a5d00000-0000-4000-8000-000000000011', 'activity', jsonb_build_object('es', 'Actividad Propre'),
   30000, true, 'delete-partner-propre'),
  ('a5d00000-0000-4000-8000-000000000022', 'a5d00000-0000-4000-8000-000000000002',
   'a5d00000-0000-4000-8000-000000000012', 'activity', jsonb_build_object('es', 'Actividad Commande'),
   30000, true, 'delete-partner-commande'),
  ('a5d00000-0000-4000-8000-000000000023', 'a5d00000-0000-4000-8000-000000000003',
   'a5d00000-0000-4000-8000-000000000013', 'activity', jsonb_build_object('es', 'Actividad Voisin'),
   30000, true, 'delete-partner-voisin');

insert into establishment_media (establishment_id, storage_path) values
  ('a5d00000-0000-4000-8000-000000000011', 'test-delete-partner/propre.webp');
insert into product_media (product_id, storage_path) values
  ('a5d00000-0000-4000-8000-000000000021', 'test-delete-partner/partagee.webp'),
  ('a5d00000-0000-4000-8000-000000000023', 'test-delete-partner/partagee.webp');

-- 031 admin, 032 socio de 001, 033 client qui a enregistré le code de 001, 034 acheteur.
insert into auth.users (id, email) values
  ('a5d00000-0000-4000-8000-000000000031', 'delete-partner-admin@test.local'),
  ('a5d00000-0000-4000-8000-000000000032', 'delete-partner-socio@test.local'),
  ('a5d00000-0000-4000-8000-000000000033', 'delete-partner-client@test.local'),
  ('a5d00000-0000-4000-8000-000000000034', 'delete-partner-buyer@test.local');
insert into partner_capabilities (account_id, role, source, status)
values ('a5d00000-0000-4000-8000-000000000031', 'admin', 'migration', 'active');

insert into partner_codes (code, partner_id) values
  ('DELPARTNER1', 'a5d00000-0000-4000-8000-000000000001');
update partner_accounts set partner_id = 'a5d00000-0000-4000-8000-000000000001'
 where id = 'a5d00000-0000-4000-8000-000000000032';
update partner_accounts set saved_attribution_code = 'DELPARTNER1'
 where id = 'a5d00000-0000-4000-8000-000000000033';

insert into partner_capabilities (partner_id, role, source, status) values
  ('a5d00000-0000-4000-8000-000000000001', 'referrer', 'migration', 'active');
insert into partner_capabilities (partner_id, establishment_id, role, source, status) values
  ('a5d00000-0000-4000-8000-000000000001', 'a5d00000-0000-4000-8000-000000000011',
   'operator', 'migration', 'active');

insert into partner_invitations (
  id, token_hash, promo_code, onboarding_path, expires_at, created_by, status,
  consumed_at, consumed_by_account_id
) values (
  'a5d00000-0000-4000-8000-000000000051', 'delete-partner-token-hash', 'DELPARTNER1', 'provider',
  now() + interval '7 days', 'a5d00000-0000-4000-8000-000000000031', 'consumed',
  now(), 'a5d00000-0000-4000-8000-000000000032'
);

insert into orders (id, account_id, holder_name, holder_email) values
  ('a5d00000-0000-4000-8000-000000000041', 'a5d00000-0000-4000-8000-000000000034',
   'Delete Partner Holder', 'delete-partner-holder@test.local');
insert into order_lines (
  order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values (
  'a5d00000-0000-4000-8000-000000000041', 'a5d00000-0000-4000-8000-000000000034',
  'a5d00000-0000-4000-8000-000000000022', '2029-10-21', 1, 'cancelled_by_client', 'Delete Partner Holder',
  30000, 30000, 'direct', 0, 0, 0, 0, 0, 0
);

set local role authenticated;

-- Non-admin : refusé avant toute lecture ------------------------------------------------------
select test_login('a5d00000-0000-4000-8000-000000000032');
select throws_ok(
  $$ select admin_partner_deletion_check('a5d00000-0000-4000-8000-000000000001'::uuid) $$,
  '42501'::char(5), 'admin_partner_deletion_check réservé au rôle admin',
  'admin_partner_deletion_check refuse un non-admin'
);
select throws_ok(
  $$ select admin_delete_partner('a5d00000-0000-4000-8000-000000000001'::uuid) $$,
  '42501'::char(5), 'admin_delete_partner réservé au rôle admin',
  'admin_delete_partner refuse un non-admin'
);

select test_login('a5d00000-0000-4000-8000-000000000031');

-- Refus ----------------------------------------------------------------------------------------
select is(
  admin_partner_deletion_check('a5d00000-0000-4000-8000-000000000002'::uuid),
  '{"deletable": false, "reason": "has_orders"}'::jsonb,
  'un partenaire dont une activité a été commandée (même annulée) n''est pas supprimable'
);
select is(
  admin_delete_partner('a5d00000-0000-4000-8000-000000000002'::uuid),
  '{"ok": false, "reason": "has_orders"}'::jsonb,
  'admin_delete_partner refuse ce partenaire'
);
select is(
  admin_partner_deletion_check('a5d00000-0000-4000-8000-000000000004'::uuid) ->> 'reason',
  'platform_partner',
  'le partenaire plateforme (propriétaire d''un lieu) n''est jamais supprimable'
);
select is(
  admin_partner_deletion_check('a5d00000-0000-4000-8000-000000000001'::uuid),
  '{"deletable": true, "reason": null}'::jsonb,
  'un partenaire sans aucune commande est supprimable'
);

-- Suppression ----------------------------------------------------------------------------------
create temp table delete_result on commit drop as
  select admin_delete_partner('a5d00000-0000-4000-8000-000000000001'::uuid) as r;

reset role;

select is((select r ->> 'ok' from delete_result), 'true', 'la suppression réussit');
select is(
  (select r -> 'account_ids' from delete_result),
  '["a5d00000-0000-4000-8000-000000000032"]'::jsonb,
  'elle rend le compte du socio, à supprimer par l''API Admin'
);
select is(
  (select r -> 'storage_paths' from delete_result),
  '["test-delete-partner/propre.webp"]'::jsonb,
  'elle rend la photo devenue orpheline, jamais celle qu''un autre partenaire utilise encore'
);

select is(
  (select count(*)::int from partners where id = 'a5d00000-0000-4000-8000-000000000001'),
  0, 'le partenaire n''existe plus'
);
select is(
  (select count(*)::int from establishments where id = 'a5d00000-0000-4000-8000-000000000011'),
  0, 'son établissement n''existe plus'
);
select is(
  (select count(*)::int from products where id = 'a5d00000-0000-4000-8000-000000000021'),
  0, 'son activité n''existe plus'
);
select is(
  (select count(*)::int from partner_capabilities
    where partner_id = 'a5d00000-0000-4000-8000-000000000001'
       or establishment_id = 'a5d00000-0000-4000-8000-000000000011'),
  0, 'ses capacités n''existent plus'
);
select is(
  (select count(*)::int from partner_codes where code = 'DELPARTNER1'),
  0, 'son code est libéré'
);
select is(
  (select count(*)::int from partner_invitations where id = 'a5d00000-0000-4000-8000-000000000051'),
  0, 'son invitation n''existe plus'
);
select is(
  (select partner_id from partner_accounts where id = 'a5d00000-0000-4000-8000-000000000032'),
  null, 'le compte du socio est détaché (l''API Admin le supprime ensuite)'
);
select is(
  (select saved_attribution_code from partner_accounts where id = 'a5d00000-0000-4000-8000-000000000033'),
  null, 'un client qui avait enregistré son code le perd'
);
select is(
  (select count(*)::int from product_media where storage_path = 'test-delete-partner/partagee.webp'),
  1, 'la photo partagée reste sur l''activité du voisin'
);
select is(
  (select count(*)::int from audit_log
    where action = 'partner.delete'
      and entity_id = 'a5d00000-0000-4000-8000-000000000001'
      and actor_id = 'a5d00000-0000-4000-8000-000000000031'),
  1, 'la suppression laisse une trace nominative dans audit_log'
);

set local role authenticated;
select test_login('a5d00000-0000-4000-8000-000000000031');
select is(
  admin_partner_deletion_check('a5d00000-0000-4000-8000-000000000001'::uuid) ->> 'reason',
  'not_found',
  'un partenaire supprimé est introuvable'
);

select * from finish();
rollback;

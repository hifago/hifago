-- Feature 24 (Admin : offboarding partenaire, workflow 4 étapes) — start_offboarding,
-- offboarding_unpublish, offboarding_attest_payments, offboarding_revoke_capability.
begin;
select plan(25);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Fixtures : partenaire A avec referrer+operator actifs (pour prouver que seul operator est
-- suspendu à l'étape 4), un établissement, deux produits (un vendible, un déjà non-vendible — pour
-- prouver que celui déjà false n'est pas recompté).
insert into partners (id, display_name) values
  ('a4000000-0000-4000-8000-000000000001', 'Offboarding Test A');

insert into establishments (id, partner_id, name) values
  ('a4000000-0000-4000-8000-000000000011', 'a4000000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Offboarding A'));

insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('a4000000-0000-4000-8000-000000000021', 'a4000000-0000-4000-8000-000000000001',
   'a4000000-0000-4000-8000-000000000011', 'activity', jsonb_build_object('es', 'Actividad vendible'),
   50000, true, 'actividad-offboarding-vendible'),
  ('a4000000-0000-4000-8000-000000000022', 'a4000000-0000-4000-8000-000000000001',
   'a4000000-0000-4000-8000-000000000011', 'activity', jsonb_build_object('es', 'Actividad ya no vendible'),
   50000, false, 'actividad-offboarding-ya-no-vendible');

insert into auth.users (id, email) values
  ('a4000000-0000-4000-8000-000000000031', 'offboarding-admin@test.local'),
  ('a4000000-0000-4000-8000-000000000032', 'offboarding-nonadmin@test.local');

insert into partner_capabilities (account_id, role, source, status) values
  ('a4000000-0000-4000-8000-000000000031', 'admin', 'migration', 'active');

insert into partner_capabilities (id, partner_id, role, source, status) values
  ('a4000000-0000-4000-8000-000000000041', 'a4000000-0000-4000-8000-000000000001',
   'referrer', 'migration', 'active');
insert into partner_capabilities (id, partner_id, establishment_id, role, source, status) values
  ('a4000000-0000-4000-8000-000000000042', 'a4000000-0000-4000-8000-000000000001',
   'a4000000-0000-4000-8000-000000000011', 'operator', 'migration', 'active');

set local role authenticated;
select test_login('a4000000-0000-4000-8000-000000000032');

-- Chaque RPC refusée pour un non-admin (id fictif : le contrôle is_admin() est la toute première
-- chose vérifiée par chacune des 4 fonctions, avant toute lecture de partner_offboarding) --------
select throws_ok(
  $$ select start_offboarding('a4000000-0000-4000-8000-000000000001'::uuid) $$,
  '42501'::char(5), 'start_offboarding réservé au rôle admin',
  'start_offboarding refuse un appelant non-admin'
);
select throws_ok(
  $$ select offboarding_unpublish('00000000-0000-4000-8000-000000000099'::uuid) $$,
  '42501'::char(5), 'offboarding_unpublish réservé au rôle admin',
  'offboarding_unpublish refuse un appelant non-admin'
);
select throws_ok(
  $$ select offboarding_attest_payments('00000000-0000-4000-8000-000000000099'::uuid, 'note') $$,
  '42501'::char(5), 'offboarding_attest_payments réservé au rôle admin',
  'offboarding_attest_payments refuse un appelant non-admin'
);
select throws_ok(
  $$ select offboarding_revoke_capability('00000000-0000-4000-8000-000000000099'::uuid) $$,
  '42501'::char(5), 'offboarding_revoke_capability réservé au rôle admin',
  'offboarding_revoke_capability refuse un appelant non-admin'
);

select test_login('a4000000-0000-4000-8000-000000000031');

-- start_offboarding : idempotente — deuxième appel sur le même partenaire, même id, pas de doublon
select lives_ok(
  $$ select start_offboarding('a4000000-0000-4000-8000-000000000001'::uuid) $$,
  'start_offboarding réussit pour l''admin'
);
select is(
  (select count(*) from partner_offboarding where partner_id = 'a4000000-0000-4000-8000-000000000001')::int,
  1,
  'une seule ligne partner_offboarding créée'
);
select is(
  ((select start_offboarding('a4000000-0000-4000-8000-000000000001'::uuid))->>'offboarding_id')::uuid,
  (select id from partner_offboarding where partner_id = 'a4000000-0000-4000-8000-000000000001'),
  'un deuxième appel retourne le même offboarding_id (idempotent)'
);
select is(
  (select count(*) from partner_offboarding where partner_id = 'a4000000-0000-4000-8000-000000000001')::int,
  1,
  'toujours une seule ligne après le deuxième appel (pas de doublon)'
);

-- offboarding_attest_payments avant l'étape 1 → exception explicite ------------------------------
select throws_ok(
  $$ select offboarding_attest_payments(
       (select id from partner_offboarding where partner_id = 'a4000000-0000-4000-8000-000000000001'::uuid
          and capability_revoked_at is null),
       'note prématurée'
     ) $$,
  'P0001'::char(5), 'étape 1 (dépublier) requise avant l''étape 3',
  'offboarding_attest_payments refuse tant que l''étape 1 n''est pas faite'
);

-- offboarding_unpublish : tous les produits sellable du partenaire passent à false, celui déjà
-- false n'est pas recompté (v_count = 1, pas 2) — un seul appel, sa valeur de retour prouve à la
-- fois le succès et le compte exact.
select is(
  ((select offboarding_unpublish(
     (select id from partner_offboarding where partner_id = 'a4000000-0000-4000-8000-000000000001'::uuid
        and capability_revoked_at is null)
   ))->>'products_unpublished')::int,
  1,
  'offboarding_unpublish dépublie exactement 1 produit (celui qui était sellable=true)'
);
select is(
  (select sellable from products where id = 'a4000000-0000-4000-8000-000000000021'),
  false,
  'le produit vendible passe à sellable=false'
);
select is(
  (select sellable from products where id = 'a4000000-0000-4000-8000-000000000022'),
  false,
  'le produit déjà non-vendible reste sellable=false'
);
select is(
  (select unpublished_at is not null from partner_offboarding
    where partner_id = 'a4000000-0000-4000-8000-000000000001'),
  true,
  'unpublished_at renseigné'
);
select is(
  (select count(*) from audit_log where action = 'partner.offboarding_unpublish'
     and after ->> 'partner_id' = 'a4000000-0000-4000-8000-000000000001')::int,
  1,
  'une seule ligne audit_log consolidée pour l''action groupée (pas une par produit)'
);

-- offboarding_revoke_capability avant l'étape 3 → exception explicite (étape 1 déjà faite ici,
-- prouve que c'est bien payments_settled_at qui est vérifié, pas unpublished_at) -----------------
select throws_ok(
  $$ select offboarding_revoke_capability(
       (select id from partner_offboarding where partner_id = 'a4000000-0000-4000-8000-000000000001'::uuid
          and capability_revoked_at is null)
     ) $$,
  'P0001'::char(5), 'étape 3 (paiements) requise avant l''étape 4',
  'offboarding_revoke_capability refuse tant que l''étape 3 n''est pas faite'
);

-- offboarding_attest_payments : motif vide → exception ; motif renseigné → succès ----------------
select throws_ok(
  $$ select offboarding_attest_payments(
       (select id from partner_offboarding where partner_id = 'a4000000-0000-4000-8000-000000000001'::uuid
          and capability_revoked_at is null),
       '   '
     ) $$,
  'P0001'::char(5), 'motif obligatoire pour attester un règlement',
  'offboarding_attest_payments refuse un motif vide'
);
select lives_ok(
  $$ select offboarding_attest_payments(
       (select id from partner_offboarding where partner_id = 'a4000000-0000-4000-8000-000000000001'::uuid
          and capability_revoked_at is null),
       'Pago verificado por Jerome fuera de la plataforma'
     ) $$,
  'offboarding_attest_payments réussit avec un motif non vide'
);
select is(
  (select payments_settled_at is not null from partner_offboarding
    where partner_id = 'a4000000-0000-4000-8000-000000000001'),
  true,
  'payments_settled_at renseigné'
);
select is(
  (select payments_settled_note from partner_offboarding
    where partner_id = 'a4000000-0000-4000-8000-000000000001'),
  'Pago verificado por Jerome fuera de la plataforma',
  'payments_settled_note enregistre le motif'
);
select is(
  (select count(*) from audit_log where action = 'partner.offboarding_attest_payments'
     and entity_id in (select id from partner_offboarding
                        where partner_id = 'a4000000-0000-4000-8000-000000000001'))::int,
  1,
  'une ligne audit_log pour l''attestation de paiement'
);

-- offboarding_revoke_capability : suspend UNIQUEMENT operator, jamais referrer (preuve du scope) -
select lives_ok(
  $$ select offboarding_revoke_capability(
       (select id from partner_offboarding where partner_id = 'a4000000-0000-4000-8000-000000000001'::uuid
          and capability_revoked_at is null),
       'offboarding complet'
     ) $$,
  'offboarding_revoke_capability réussit une fois l''étape 3 faite'
);
select is(
  (select status from partner_capabilities where id = 'a4000000-0000-4000-8000-000000000042'),
  'suspended',
  'la capacité operator est suspendue'
);
select is(
  (select status from partner_capabilities where id = 'a4000000-0000-4000-8000-000000000041'),
  'active',
  'la capacité referrer N''est PAS suspendue (scope operator uniquement)'
);
select is(
  (select capability_revoked_at is not null from partner_offboarding
    where partner_id = 'a4000000-0000-4000-8000-000000000001'),
  true,
  'capability_revoked_at renseigné'
);
select is(
  (select jsonb_build_object('action', action, 'after', after) from audit_log
    where action = 'partner.offboarding_revoke_capability'
      and after ->> 'partner_id' = 'a4000000-0000-4000-8000-000000000001'),
  jsonb_build_object(
    'action', 'partner.offboarding_revoke_capability',
    'after', jsonb_build_object(
      'partner_id', 'a4000000-0000-4000-8000-000000000001',
      'capabilities_suspended', 1
    )
  ),
  'audit_log enregistre le nombre de capacités suspendues'
);

select * from finish();
rollback;

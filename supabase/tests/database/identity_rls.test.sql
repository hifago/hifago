-- Tranche 1 (identité composable) — RLS : écriture directe refusée sur les tables RPC-only,
-- token d'invitation jamais exposé à un non-admin, lecture propre organisation + miroir admin.
begin;
select plan(15);

-- Helper local à cette transaction (jamais persisté, rollback en fin de fichier) : simule un
-- compte authentifié sans répéter le json_build_object à chaque changement de rôle.
create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- fixtures (rôle postgres, contourne la RLS)
insert into partners (id, display_name) values
  ('11111111-1111-1111-1111-111111111111', 'Partner A'),
  ('22222222-2222-2222-2222-222222222222', 'Partner B');

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a@test.local'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b@test.local'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'admin@test.local');

update partner_accounts set partner_id = '11111111-1111-1111-1111-111111111111'
  where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
update partner_accounts set partner_id = '22222222-2222-2222-2222-222222222222'
  where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

insert into partner_capabilities (account_id, role, source, status)
  values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'admin', 'migration', 'active');
insert into partner_capabilities (partner_id, role, source)
  values ('11111111-1111-1111-1111-111111111111', 'referrer', 'migration');

insert into partner_codes (code, partner_id)
  values ('TESTCODE', '11111111-1111-1111-1111-111111111111');
insert into partner_invitations (token_hash, promo_code, onboarding_path, expires_at)
  values ('deadbeefdeadbeef', 'TESTCODE', 'referrer', now() + interval '7 days');
insert into role_agreements (partner_id, account_id, role, document_version, signer_name, explicit_consent)
  values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'referrer', 'v1', 'A Test', true);

-- écriture directe refusée sur les tables RPC-only --------------------------
set local role authenticated;
select test_login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

select throws_ok(
  $$ insert into partner_capabilities (partner_id, role, source)
     values ('11111111-1111-1111-1111-111111111111', 'referrer', 'self_upgrade') $$,
  '42501'::char(5), null, 'authenticated ne peut pas insérer directement dans partner_capabilities'
);
select throws_ok(
  $$ update partner_capabilities set status = 'active'
     where partner_id = '11111111-1111-1111-1111-111111111111' $$,
  '42501'::char(5), null, 'authenticated ne peut pas modifier directement partner_capabilities'
);
select throws_ok(
  $$ delete from partner_capabilities where partner_id = '11111111-1111-1111-1111-111111111111' $$,
  '42501'::char(5), null, 'authenticated ne peut pas supprimer directement dans partner_capabilities'
);
select throws_ok(
  $$ insert into partner_invitations (token_hash, promo_code, onboarding_path, expires_at)
     values ('x', 'TESTCODE', 'referrer', now() + interval '1 day') $$,
  '42501'::char(5), null, 'authenticated ne peut pas insérer directement dans partner_invitations'
);
select throws_ok(
  $$ insert into role_agreements (partner_id, account_id, role, document_version, signer_name, explicit_consent)
     values ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'referrer', 'v2', 'A Test', true) $$,
  '42501'::char(5), null, 'authenticated ne peut pas insérer directement dans role_agreements'
);
select throws_ok(
  $$ insert into partner_codes (code, partner_id) values ('HACK', '11111111-1111-1111-1111-111111111111') $$,
  '42501'::char(5), null, 'authenticated ne peut pas insérer directement dans partner_codes'
);

-- token jamais exposé en SELECT à un non-admin -------------------------------
select is(
  (select count(*) from partner_invitations)::int, 0,
  'un compte non-admin ne voit aucune invitation (token jamais exposé)'
);

select test_login('cccccccc-cccc-cccc-cccc-cccccccccccc');
select ok(
  (select count(*) from partner_invitations) > 0,
  'l''admin voit les invitations'
);

-- partner_codes : aucune lecture pour anon, un code se vérifie à l'unité ------
-- Lecture publique retirée (20261014025905 puis 20261014073414) : seuls le propriétaire et l'admin
-- lisent les lignes ; un visiteur vérifie UN code par partner_code_is_active.
reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);
select throws_ok(
  $$ select count(*) from partner_codes where code = 'TESTCODE' $$,
  '42501'::char(5), null,
  'anon ne lit plus partner_codes (permission refusée)'
);
select is(
  partner_code_is_active('TESTCODE'), true,
  'anon vérifie un code actif à l''unité (partner_code_is_active)'
);

-- partners / partner_accounts / role_agreements : propre organisation + miroir admin --
reset role;
set local role authenticated;
select test_login('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select is((select count(*) from partners)::int, 1, 'le compte A ne voit que son propre partenaire');
select is((select count(*) from partner_accounts)::int, 1, 'le compte A ne voit que sa propre ligne partner_accounts');
select is((select count(*) from role_agreements)::int, 1, 'le compte A voit son propre role_agreement');

select test_login('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select is((select count(*) from role_agreements)::int, 0, 'le compte B ne voit pas le role_agreement du compte A');

select test_login('cccccccc-cccc-cccc-cccc-cccccccccccc');
-- Scopé aux fixtures de ce test (pas un count(*) global) : robuste même si la base contient déjà
-- d'autres partenaires (seed ou autres tests), l'admin doit voir A ET B, jamais moins.
select is(
  (select count(*) from partners
    where id in ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'))::int,
  2,
  'l''admin voit les deux partenaires de fixture (miroir)'
);

select * from finish();
rollback;

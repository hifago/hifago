-- 20261112180000 — les deux RPC admin du lot « acompte 17 %, auto-référence payée » :
-- set_partner_self_referral_full_rebate (option « reverser les 17 % ») et add_partner_code (un code
-- de plus pour un partenaire existant, un QR par hôtel d'un même groupe). Le calcul de commission
-- lui-même est prouvé dans create_order.test.sql (cas 16c, 16g).
begin;
select plan(17);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('a3000000-0000-4000-8000-000000000001', 'Rebate Test Group'),
  ('a3000000-0000-4000-8000-000000000002', 'Rebate Test Other');
insert into auth.users (id, email) values
  ('a3000000-0000-4000-8000-000000000021', 'rebate-admin@test.local'),
  ('a3000000-0000-4000-8000-000000000022', 'rebate-partner@test.local');
insert into partner_capabilities (account_id, role, source, status) values
  ('a3000000-0000-4000-8000-000000000021', 'admin', 'migration', 'active');
-- Le compte 022 est un utilisateur du partenaire 001 : il ne doit jamais pouvoir s'attribuer l'option.
update partner_accounts set partner_id = 'a3000000-0000-4000-8000-000000000001'
 where id = 'a3000000-0000-4000-8000-000000000022';
insert into partner_codes (code, partner_id, active) values
  ('REBATE-TEST-A', 'a3000000-0000-4000-8000-000000000001', true),
  ('REBATE-TEST-OTHER', 'a3000000-0000-4000-8000-000000000002', true);

-- Non-admin (le partenaire lui-même) ---------------------------------------------------------------
set local role authenticated;
select test_login('a3000000-0000-4000-8000-000000000022');

select throws_ok(
  $$ select set_partner_self_referral_full_rebate('a3000000-0000-4000-8000-000000000001'::uuid, true) $$,
  '42501'::char(5), 'set_partner_self_referral_full_rebate réservé au rôle admin',
  'set_partner_self_referral_full_rebate refuse le partenaire lui-même'
);
select throws_ok(
  $$ select add_partner_code('a3000000-0000-4000-8000-000000000001'::uuid, 'REBATE-TEST-B') $$,
  '42501'::char(5), 'add_partner_code réservé au rôle admin',
  'add_partner_code refuse un appelant non-admin'
);
select throws_ok(
  $$ insert into partner_self_referral_rebates (partner_id, created_by)
     values ('a3000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000022') $$,
  '42501'::char(5), null,
  'aucune écriture directe sur partner_self_referral_rebates (RPC-only)'
);
select is(
  (select count(*)::int from partner_self_referral_rebates),
  0,
  'un partenaire ne lit pas la table de l''option (lecture admin seulement)'
);

-- Admin : l'option -----------------------------------------------------------------------------------
select test_login('a3000000-0000-4000-8000-000000000021');

select is(
  set_partner_self_referral_full_rebate('a3000000-0000-4000-8000-000000000001'::uuid, true, 'pilote Soy Local') ->> 'ok',
  'true',
  'l''admin active l''option'
);
select is(
  set_partner_self_referral_full_rebate('a3000000-0000-4000-8000-000000000001'::uuid, true) ->> 'ok',
  'true',
  'réactiver une option déjà active ne lève rien (idempotent)'
);
select is(
  (select count(*)::int from partner_self_referral_rebates where partner_id = 'a3000000-0000-4000-8000-000000000001'),
  1,
  'l''option est posée une seule fois, lisible par l''admin'
);
select is(
  set_partner_self_referral_full_rebate('a3000000-0000-4000-8000-000000000099'::uuid, true) ->> 'reason',
  'partner_not_found',
  'partenaire inconnu → partner_not_found'
);
select is(
  set_partner_self_referral_full_rebate('a3000000-0000-4000-8000-000000000001'::uuid, false) ->> 'ok',
  'true',
  'l''admin désactive l''option'
);
select is(
  (select count(*)::int from partner_self_referral_rebates where partner_id = 'a3000000-0000-4000-8000-000000000001'),
  0,
  'option retirée'
);

-- Admin : un code de plus ----------------------------------------------------------------------------
select is(
  add_partner_code('a3000000-0000-4000-8000-000000000001'::uuid, '  REBATE-TEST-B  ', 'QR hôtel 2') ->> 'code',
  'REBATE-TEST-B',
  'l''admin ajoute un code, espaces de bord retirés'
);
select is(
  add_partner_code('a3000000-0000-4000-8000-000000000001'::uuid, 'REBATE-TEST-OTHER') ->> 'reason',
  'code_taken',
  'un code déjà attribué à un autre partenaire est refusé'
);
select is(
  add_partner_code('a3000000-0000-4000-8000-000000000001'::uuid, '   ') ->> 'reason',
  'code_required',
  'un code vide est refusé'
);
select is(
  add_partner_code('a3000000-0000-4000-8000-000000000001'::uuid, repeat('X', 65)) ->> 'reason',
  'code_too_long',
  'un code de plus de 64 caractères est refusé (la vitrine l''ignorerait)'
);

reset role;

select is(
  (select jsonb_build_object('partner_id', partner_id, 'active', active)
     from partner_codes where code = 'REBATE-TEST-B'),
  jsonb_build_object('partner_id', 'a3000000-0000-4000-8000-000000000001', 'active', true),
  'le nouveau code appartient au partenaire et attribue tout de suite'
);
select is(
  (select partner_id from partner_codes where code = 'REBATE-TEST-OTHER'),
  'a3000000-0000-4000-8000-000000000002'::uuid,
  'le code refusé reste à son partenaire d''origine'
);
select is(
  (select array_agg(action order by action collate "C") from audit_log
    where actor_id = 'a3000000-0000-4000-8000-000000000021'),
  array['partner.self_referral_full_rebate', 'partner.self_referral_full_rebate',
        'partner.self_referral_full_rebate', 'partner_code.add'],
  'chaque changement réussi est journalisé au nom de l''admin'
);

select * from finish();
rollback;

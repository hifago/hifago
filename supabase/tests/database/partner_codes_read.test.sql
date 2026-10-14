-- Codes partenaires : un code se vérifie à l'unité, la lecture des lignes est limitée à leur
-- propriétaire et à l'admin (20261014025905 puis 20261014030255).
--
-- La fonction partner_code_is_active ne rend qu'un booléen « existe et actif » : jamais une ligne,
-- une liste ni un partenaire. Les lignes de partner_codes ne se lisent plus que par leur
-- propriétaire (son organisation) et par l'admin ; anon n'a plus aucun accès à la table. Les comptes
-- sont SCOPÉS aux codes de ce fichier (préfixe CODLECT-), jamais en absolu.
begin;
select plan(15);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('a6000000-0000-4000-8000-000000000001', 'Codes Lectura A'),
  ('a6000000-0000-4000-8000-000000000002', 'Codes Lectura B');
insert into partner_codes (code, partner_id, active) values
  ('CODLECT-A', 'a6000000-0000-4000-8000-000000000001', true),
  ('CODLECT-A-OFF', 'a6000000-0000-4000-8000-000000000001', false),
  ('CODLECT-B', 'a6000000-0000-4000-8000-000000000002', true);
insert into auth.users (id, email) values
  ('a6000000-0000-4000-8000-000000000021', 'codes-lectura-a@test.local'),
  ('a6000000-0000-4000-8000-000000000022', 'codes-lectura-b@test.local'),
  ('a6000000-0000-4000-8000-000000000023', 'codes-lectura-admin@test.local'),
  ('a6000000-0000-4000-8000-000000000024', 'codes-lectura-cliente@test.local');
update partner_accounts set partner_id = 'a6000000-0000-4000-8000-000000000001'
 where id = 'a6000000-0000-4000-8000-000000000021';
update partner_accounts set partner_id = 'a6000000-0000-4000-8000-000000000002'
 where id = 'a6000000-0000-4000-8000-000000000022';
insert into partner_capabilities (account_id, role, source, status) values
  ('a6000000-0000-4000-8000-000000000023', 'admin', 'migration', 'active');

-- Vérification à l'unité, sans compte ------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '', true);
select is(partner_code_is_active('CODLECT-A'), true, 'anon : un code actif est reconnu');
select is(partner_code_is_active('CODLECT-A-OFF'), false, 'anon : un code inactif est refusé');
select is(partner_code_is_active('CODLECT-INCONNU'), false, 'anon : un code inconnu est refusé');

-- Un partenaire vérifie le code d'un autre : la validité seule, rien sur son propriétaire --------
reset role;
set local role authenticated;
select test_login('a6000000-0000-4000-8000-000000000021');
select is(partner_code_is_active('CODLECT-B'), true,
  'un partenaire connecté vérifie le code actif d''un autre partenaire (booléen seul)');
reset role;

-- Contrat de la fonction : un booléen, jamais un ensemble ; DEFINER, STABLE, search_path vide ----
select is(
  (select prorettype::regtype::text || '|' || proretset || '|' || pg_get_function_identity_arguments(oid)
          || '|' || prosecdef || '|' || provolatile || '|' || coalesce(array_to_string(proconfig, ','), '')
     from pg_proc where oid = 'public.partner_code_is_active(text)'::regprocedure),
  'boolean|false|p_code text|true|s|search_path=""',
  'partner_code_is_active rend un booléen (jamais une liste), SECURITY DEFINER, STABLE, search_path vide'
);
select is(
  array[
    has_function_privilege('anon', 'public.partner_code_is_active(text)', 'execute'),
    has_function_privilege('authenticated', 'public.partner_code_is_active(text)', 'execute'),
    exists (select 1 from pg_proc p, aclexplode(p.proacl) a
             where p.oid = 'public.partner_code_is_active(text)'::regprocedure and a.grantee = 0)
  ],
  array[true, true, false],
  'partner_code_is_active : EXECUTE pour anon et authenticated, rien pour PUBLIC'
);

-- Les deux policies de lecture : propriétaire et admin, pour authenticated seulement ---------------
select is(
  (select string_agg(policyname || '|' || cmd || '|' || array_to_string(roles, ','), ', ' order by policyname)
     from pg_policies
    where schemaname = 'public' and tablename = 'partner_codes'
      and policyname in ('partner_codes_select_admin', 'partner_codes_select_own')),
  'partner_codes_select_admin|SELECT|authenticated, partner_codes_select_own|SELECT|authenticated',
  'partner_codes porte une policy de lecture propriétaire et une policy admin, réservées à authenticated'
);
select ok(
  (select bool_and(case policyname
                     when 'partner_codes_select_own'
                       then qual ~ 'partner_id = \( SELECT (public\.)?partner_id_for_account\(auth\.uid\(\)\)'
                     when 'partner_codes_select_admin'
                       then qual ~ '\( SELECT (public\.)?is_admin\(auth\.uid\(\)\)'
                   end)
     from pg_policies
    where schemaname = 'public' and tablename = 'partner_codes'
      and policyname in ('partner_codes_select_admin', 'partner_codes_select_own')),
  'propriétaire : partner_id = son organisation ; admin : is_admin — prédicats enveloppés en ( SELECT … )'
);

-- Lecture des lignes : aucune pour anon, son organisation pour un partenaire, tout pour l'admin ---
select is(
  array[
    has_table_privilege('anon', 'public.partner_codes', 'select'),
    has_table_privilege('authenticated', 'public.partner_codes', 'select')
  ],
  array[false, true],
  'partner_codes : aucun SELECT pour anon ; authenticated filtré par les policies'
);
select is(
  (select string_agg(policyname, ', ' order by policyname)
     from pg_policies
    where schemaname = 'public' and tablename = 'partner_codes' and cmd in ('SELECT', 'ALL')),
  'partner_codes_select_admin, partner_codes_select_own',
  'les seules policies de lecture de partner_codes sont celles du propriétaire et de l''admin (plus de lecture publique)'
);

set local role anon;
select set_config('request.jwt.claims', '', true);
select throws_ok(
  $$ select code from partner_codes where code like 'CODLECT-%' $$,
  '42501'::char(5), null,
  'anon ne lit aucune ligne de partner_codes (permission refusée)'
);
reset role;

set local role authenticated;
select test_login('a6000000-0000-4000-8000-000000000021');
select is(
  (select array_agg(code order by code) from partner_codes where code like 'CODLECT-%'),
  array['CODLECT-A', 'CODLECT-A-OFF'],
  'le partenaire A lit ses codes (actifs ou non) et jamais ceux de B'
);
select test_login('a6000000-0000-4000-8000-000000000022');
select is(
  (select array_agg(code order by code) from partner_codes where code like 'CODLECT-%'),
  array['CODLECT-B'],
  'le partenaire B ne lit que le sien'
);
select test_login('a6000000-0000-4000-8000-000000000024');
select is(
  (select count(*)::int from partner_codes where code like 'CODLECT-%'),
  0,
  'un compte sans organisation (client) ne lit aucun code'
);
select test_login('a6000000-0000-4000-8000-000000000023');
select is(
  (select array_agg(code order by code) from partner_codes where code like 'CODLECT-%'),
  array['CODLECT-A', 'CODLECT-A-OFF', 'CODLECT-B'],
  'l''admin lit tous les codes'
);
reset role;

select * from finish();
rollback;

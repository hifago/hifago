-- Codes partenaires : un code se vérifie à l'unité, la lecture des lignes est limitée à leur
-- propriétaire et à l'admin (20261014025905, étape additive).
--
-- La fonction partner_code_is_active ne rend qu'un booléen « existe et actif » : jamais une ligne,
-- une liste ni un partenaire. Les deux policies de lecture (propriétaire, admin) sont posées ici ;
-- leur comportement isolé se prouve à l'étape 2, une fois la lecture publique retirée (tant qu'elle
-- existe, les policies se cumulent et tout le monde lit tout).
begin;
select plan(8);

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
  ('a6000000-0000-4000-8000-000000000021', 'codes-lectura-a@test.local');
update partner_accounts set partner_id = 'a6000000-0000-4000-8000-000000000001'
 where id = 'a6000000-0000-4000-8000-000000000021';

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

select * from finish();
rollback;

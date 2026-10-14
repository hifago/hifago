-- Fonctions d'identité lues sur l'appelant, sans paramètre (20261014204210, puis 20261014204647 :
-- versions à paramètre réservées aux fonctions SECURITY DEFINER).
--
-- STRUCTUREL (l'EXECUTE des versions à paramètre est retiré à anon et authenticated : un appel
-- encore exécuté sous ces rôles casserait) : aucune policy de public
-- ou de storage, aucune vue ne dépend d'une version à paramètre (pg_depend), et aucune fonction
-- SECURITY INVOKER de public n'en appelle une. Les fonctions SECURITY DEFINER peuvent continuer :
-- elles s'exécutent en propriétaire.
--
-- COMPORTEMENT : chaque surcharge répond pour l'APPELANT. La résolution des surcharges est prouvée
-- en appelant, sous un compte X, la forme à paramètre pour un compte Y et la forme sans paramètre :
-- elles répondent différemment, donc Postgres a bien choisi deux fonctions distinctes.
begin;
select plan(15);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- ── Structurel ──────────────────────────────────────────────────────────────────────────────────
create temp table versions_a_parametre (oid oid primary key);
insert into versions_a_parametre values
  ('public.is_admin(uuid)'::regprocedure),
  ('public.has_admin_capability(uuid)'::regprocedure),
  ('public.partner_id_for_account(uuid)'::regprocedure),
  ('public.has_capability(uuid, text, uuid)'::regprocedure);

select is(
  (select coalesce(string_agg(n.nspname || '.' || c.relname || '.' || pol.polname, ', '
                              order by n.nspname, c.relname, pol.polname), '')
     from pg_depend d
     join pg_policy pol on pol.oid = d.objid
     join pg_class c on c.oid = pol.polrelid
     join pg_namespace n on n.oid = c.relnamespace
    where d.classid = 'pg_policy'::regclass and d.refclassid = 'pg_proc'::regclass
      and d.refobjid in (select oid from versions_a_parametre)),
  '',
  'aucune policy (public, storage) n''appelle une fonction d''identité à paramètre'
);
select is(
  (select coalesce(string_agg(distinct r.ev_class::regclass::text, ', '), '')
     from pg_depend d
     join pg_rewrite r on r.oid = d.objid
    where d.classid = 'pg_rewrite'::regclass and d.refclassid = 'pg_proc'::regclass
      and d.refobjid in (select oid from versions_a_parametre)),
  '',
  'aucune vue n''appelle une fonction d''identité à paramètre'
);
-- Une forme à paramètre : is_admin / has_admin_capability / partner_id_for_account avec un
-- argument, ou has_capability dont le premier argument n'est pas un rôle littéral.
select is(
  (select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by p.proname), '')
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and not p.prosecdef
      and regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~*
          '(\m(is_admin|has_admin_capability|partner_id_for_account)\s*\(\s*[^)\s])|(\mhas_capability\s*\(\s*[^''\s])'),
  '',
  'aucune fonction SECURITY INVOKER de public n''appelle une fonction d''identité à paramètre'
);

-- ── Comportement ────────────────────────────────────────────────────────────────────────────────
insert into partners (id, display_name) values ('ab000000-0000-4000-8000-000000000001', 'Identite Appelant');
insert into establishments (id, partner_id, name) values
  ('ab000000-0000-4000-8000-000000000011', 'ab000000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Identite Appelant'));
insert into auth.users (id, email) values
  ('ab000000-0000-4000-8000-000000000021', 'identite-admin@test.local'),
  ('ab000000-0000-4000-8000-000000000022', 'identite-operador@test.local'),
  ('ab000000-0000-4000-8000-000000000023', 'identite-cliente@test.local');
insert into partner_capabilities (account_id, role, source, status) values
  ('ab000000-0000-4000-8000-000000000021', 'admin', 'migration', 'active');
update partner_accounts set partner_id = 'ab000000-0000-4000-8000-000000000001'
 where id = 'ab000000-0000-4000-8000-000000000022';
insert into partner_capabilities (partner_id, role, establishment_id, source, status) values
  ('ab000000-0000-4000-8000-000000000001', 'referrer', null, 'migration', 'active'),
  ('ab000000-0000-4000-8000-000000000001', 'operator', 'ab000000-0000-4000-8000-000000000011', 'migration', 'active');

set local role authenticated;
select test_login('ab000000-0000-4000-8000-000000000021');
select is(array[is_admin(), has_admin_capability()], array[true, true],
  'admin : is_admin() et has_admin_capability() répondent pour l''appelant');

select test_login('ab000000-0000-4000-8000-000000000022');
select is(
  jsonb_build_object('admin', is_admin(), 'partenaire', partner_id_for_account(),
                     'operator', has_capability('operator'::text, 'ab000000-0000-4000-8000-000000000011'::uuid),
                     'referrer', has_capability('referrer'::text)),
  jsonb_build_object('admin', false, 'partenaire', 'ab000000-0000-4000-8000-000000000001',
                     'operator', true, 'referrer', true),
  'opérateur : non admin, son organisation, ses capacités'
);

select test_login('ab000000-0000-4000-8000-000000000023');
select is(
  jsonb_build_object('admin', is_admin(), 'partenaire', partner_id_for_account(),
                     'operator', has_capability('operator'::text, 'ab000000-0000-4000-8000-000000000011'::uuid)),
  jsonb_build_object('admin', false, 'partenaire', null, 'operator', false),
  'compte sans organisation : rien'
);
-- Les versions à paramètre ne sont plus exécutables sous un rôle d'API.
select throws_ok(
  $$ select is_admin('ab000000-0000-4000-8000-000000000021'::uuid) $$,
  '42501'::char(5), null,
  'authenticated n''exécute plus is_admin(uuid)'
);
select throws_ok(
  $$ select has_capability('ab000000-0000-4000-8000-000000000022'::uuid, 'operator') $$,
  '42501'::char(5), null,
  'authenticated n''exécute plus has_capability(uuid, text, uuid)'
);

-- Résolution, en propriétaire (seul rôle qui exécute encore les versions à paramètre), avec
-- l'identité du compte sans organisation : la forme À PARAMÈTRE pour l'opérateur répond « vrai »,
-- la forme sans paramètre « faux » — deux fonctions distinctes ont été choisies.
reset role;
select test_login('ab000000-0000-4000-8000-000000000023');
select is(
  array[
    has_capability('ab000000-0000-4000-8000-000000000022'::uuid, 'operator', 'ab000000-0000-4000-8000-000000000011'::uuid),
    has_capability('ab000000-0000-4000-8000-000000000022'::uuid, 'operator'),
    has_capability('operator'::text, 'ab000000-0000-4000-8000-000000000011'::uuid)
  ],
  array[true, true, false],
  'résolution : forme à paramètre (3 puis 2 arguments) pour un autre compte, forme sans paramètre pour l''appelant'
);
select is(
  (select array[is_admin('ab000000-0000-4000-8000-000000000021'::uuid), is_admin()]),
  array[true, false],
  'résolution : is_admin(uuid) et is_admin() sont deux fonctions distinctes'
);

set local role anon;
select set_config('request.jwt.claims', '', true);
select is(
  jsonb_build_object('admin', is_admin(), 'admin_cap', has_admin_capability(), 'partenaire', partner_id_for_account(),
                     'referrer', has_capability('referrer'::text)),
  jsonb_build_object('admin', false, 'admin_cap', false, 'partenaire', null, 'referrer', false),
  'anon : les surcharges ne parlent que de lui (rien)'
);
select throws_ok(
  $$ select partner_id_for_account('ab000000-0000-4000-8000-000000000022'::uuid) $$,
  '42501'::char(5), null,
  'anon n''exécute plus partner_id_for_account(uuid)'
);
reset role;

-- ── Droits des surcharges ───────────────────────────────────────────────────────────────────────
select is(
  (select string_agg(p.oid::regprocedure::text || ':' ||
                     has_function_privilege('anon', p.oid, 'execute')::text || ',' ||
                     has_function_privilege('authenticated', p.oid, 'execute')::text, ' ' order by p.proname)
     from pg_proc p
    where p.oid in ('public.is_admin()'::regprocedure, 'public.has_admin_capability()'::regprocedure,
                    'public.partner_id_for_account()'::regprocedure, 'public.has_capability(text, uuid)'::regprocedure)),
  'has_admin_capability():true,true has_capability(text,uuid):true,true is_admin():true,true partner_id_for_account():true,true',
  'les quatre surcharges : EXECUTE pour anon et authenticated'
);
select is(
  (select count(*)::int
     from pg_proc p, aclexplode(p.proacl) a
    where p.oid in ('public.is_admin()'::regprocedure, 'public.has_admin_capability()'::regprocedure,
                    'public.partner_id_for_account()'::regprocedure, 'public.has_capability(text, uuid)'::regprocedure)
      and a.grantee = 0),
  0,
  'les quatre surcharges : rien pour PUBLIC'
);

select is(
  (select count(*)::int
     from pg_proc p
    where p.oid in ('public.is_admin(uuid)'::regprocedure, 'public.has_admin_capability(uuid)'::regprocedure,
                    'public.partner_id_for_account(uuid)'::regprocedure,
                    'public.has_capability(uuid, text, uuid)'::regprocedure)
      and (has_function_privilege('anon', p.oid, 'execute')
           or has_function_privilege('authenticated', p.oid, 'execute')
           or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))),
  0,
  'les quatre versions à paramètre : rien pour anon, authenticated ni PUBLIC'
);

select * from finish();
rollback;

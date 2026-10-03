-- Garde-fou automatique — checklist RLS/RPC-only de .claude/skills/hifago-migration/SKILL.md.
-- Contrairement aux autres fichiers de ce dossier (qui testent une feature précise), celui-ci
-- interroge le catalogue système : il vérifie l'INVARIANT sur TOUT le schéma `public`, pas une
-- table nommée — donc il n'a besoin d'aucune mise à jour quand une nouvelle table/fonction est
-- ajoutée en respectant la checklist.
--
-- Couvre 3 des 5 points de la checklist automatiquement :
--   (2) STABLE — toute fonction référencée dans une policy RLS n'est jamais VOLATILE.
--   (3) auth.uid() enveloppé — toute comparaison DIRECTE avec auth.uid() dans une policy est
--       wrappée en (select auth.uid()) ; un appel indirect (ex. is_admin(auth.uid())) n'est pas
--       concerné par cette règle (convention déjà en usage dans tout le schéma).
--   (4) search_path='' — toute fonction de `public`, SECURITY DEFINER ou INVOKER, le fixe sans
--       exception (étendu aux INVOKER le 2026-10-02, 20261002123023).
-- Les 2 points restants ne sont PAS automatisés ici :
--   (1) "quelle table doit être RPC-only" est un jugement métier (capacité, audit, vue miroir) —
--       seule une approximation de défense en profondeur est vérifiée (voir test grants ci-dessous).
--   (5) le squelette anti-survente exact suppose une convention de marquage machine-lisible des
--       RPC critiques qui n'existe pas encore (cf. plan de restructuration doc/process, Tier 3 —
--       à trancher avec Jérôme avant d'automatiser ce point précis).

begin;
select plan(4);

-- (4) Toute fonction de public fixe search_path='' ---------------------------------------------
-- DEFINER comme INVOKER : une fonction INVOKER sans search_path résout ses noms dans le chemin de
-- l'appelant. Hors champ, à juste titre : les fonctions d'une extension (elle gère leur définition)
-- et les fonctions en C ou internes (aucune résolution de nom SQL).
select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where n.nspname = 'public'
      and l.lanname not in ('c', 'internal')
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
      )
      and not exists (
        -- Postgres stocke `SET search_path = ''` sous forme de `search_path=""` dans proconfig
        -- (guillemets littéraux représentant la chaîne vide) — accepter aussi `search_path=` nu.
        select 1 from unnest(coalesce(p.proconfig, '{}')) cfg
        where cfg in ('search_path=', 'search_path=""')
      )
  ),
  0,
  'toute fonction de public, DEFINER ou INVOKER, fixe search_path=vide (hifago/CLAUDE.md §3.3)'
);

-- (2) Toute fonction référencée dans une policy RLS n'est jamais VOLATILE -----------------------
select is(
  (
    select count(*)::int
    from pg_policies pol
    join pg_proc pr on pr.pronamespace = 'public'::regnamespace
    where pol.schemaname = 'public'
      and pr.provolatile = 'v'
      and (
        pol.qual ~ ('\m' || pr.proname || '\(')
        or coalesce(pol.with_check, '') ~ ('\m' || pr.proname || '\(')
      )
  ),
  0,
  'aucune fonction VOLATILE n''est appelée depuis une policy RLS (hifago/CLAUDE.md §3.3)'
);

-- (3) auth.uid() jamais comparé directement sans (select auth.uid()) ----------------------------
-- Ne flague QUE la comparaison directe (= auth.uid() / auth.uid() =), pas un appel indirect
-- (is_admin(auth.uid()), partner_id_for_account(auth.uid())) — convention déjà en usage partout
-- dans ce schéma et volontairement hors du périmètre de cette règle précise.
select is(
  (
    select count(*)::int
    from pg_policies pol
    where pol.schemaname = 'public'
      and (
        (pol.qual ~ '[=<>] *auth\.uid\(\)' or pol.qual ~ 'auth\.uid\(\) *[=<>]')
        and pol.qual !~ 'SELECT auth\.uid'
      )
      or (
        pol.with_check is not null
        and (pol.with_check ~ '[=<>] *auth\.uid\(\)' or pol.with_check ~ 'auth\.uid\(\) *[=<>]')
        and pol.with_check !~ 'SELECT auth\.uid'
      )
  ),
  0,
  'auth.uid() n''est jamais comparé directement sans (select auth.uid()) dans une policy (hifago/CLAUDE.md §3.4)'
);

-- (1, défense en profondeur) table RLS sans policy d'écriture pour authenticated
--    → authenticated ne doit avoir AUCUN grant INSERT/UPDATE/DELETE non plus. Ne décide pas
--    quelle table DOIT être RPC-only (jugement métier), vérifie seulement que quand une table
--    n'a aucune policy d'écriture, le grant est bien révoqué en plus (la RLS default-deny ne
--    doit jamais être le SEUL filet, cf. hifago/CLAUDE.md §3.1).
select is(
  (
    select count(*)::int
    from pg_class t
    join pg_namespace n on n.oid = t.relnamespace and n.nspname = 'public'
    join information_schema.role_table_grants g
      on g.table_schema = 'public' and g.table_name = t.relname and g.grantee = 'authenticated'
      and g.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    where t.relkind = 'r'
      and t.relrowsecurity = true
      and not exists (
        -- Une policy sans clause `TO <role>` explicite est enregistrée avec roles = {public}
        -- (s'applique à tout rôle, authenticated compris) — convention dominante dans ce schéma.
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = t.relname
          and p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
          and ('authenticated' = any(p.roles) or 'public' = any(p.roles))
      )
  ),
  0,
  'une table RLS sans policy d''écriture pour authenticated n''a pas non plus de grant d''écriture (défense en profondeur, hifago/CLAUDE.md §3.1)'
);

select * from finish();
rollback;

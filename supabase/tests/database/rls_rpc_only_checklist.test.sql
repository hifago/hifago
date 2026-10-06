-- Garde-fou automatique — checklist RLS/RPC-only de .claude/skills/hifago-migration/SKILL.md.
-- Contrairement aux autres fichiers de ce dossier (qui testent une feature précise), celui-ci
-- interroge le catalogue système : il vérifie l'INVARIANT sur TOUT le schéma `public`, pas une
-- table nommée — donc il n'a besoin d'aucune mise à jour quand une nouvelle table/fonction est
-- ajoutée en respectant la checklist.
--
-- Couvre 3 des 5 points de la checklist automatiquement, plus un préalable :
--   (0) RLS activée — toute table de `public` l'active ; sans elle, aucune des policies vérifiées
--       ci-dessous ne s'applique, et les grants deviennent le seul rempart (audit P12c, 2026-10-06).
--   (2) STABLE — toute fonction référencée dans une policy RLS n'est jamais VOLATILE.
--   (3) auth.uid() enveloppé — dans une policy, TOUTE occurrence d'auth.uid() est sous un
--       `( SELECT … )` : soit `(select auth.uid())`, soit l'appel d'un prédicat entier
--       `(select is_admin(auth.uid()))`. Avant le 2026-10-06, seule la comparaison directe
--       (`= auth.uid()`) était cherchée : `= any (array[auth.uid()])` ou un `is_admin(auth.uid())` nu
--       passaient, évalués ligne par ligne au lieu d'une fois par requête.
--   (4) search_path='' — toute fonction de `public`, SECURITY DEFINER ou INVOKER, le fixe sans
--       exception (étendu aux INVOKER le 2026-10-02, 20261002123023).
-- (2) et (3) portent sur `public` ET `storage` (policies de storage.objects) depuis le 2026-10-06.
-- Les 2 points restants ne sont PAS automatisés ici :
--   (1) "quelle table doit être RPC-only" est un jugement métier (capacité, audit, vue miroir) —
--       seule une approximation de défense en profondeur est vérifiée (voir test grants ci-dessous).
--   (5) le squelette anti-survente exact suppose une convention de marquage machine-lisible des
--       RPC critiques qui n'existe pas encore (cf. plan de restructuration doc/process, Tier 3 —
--       à trancher avec Jérôme avant d'automatiser ce point précis).

begin;
select plan(5);

-- (0) Toute table de public active la RLS ---------------------------------------------------------
select is(
  (
    select coalesce(string_agg(c.relname, ', ' order by c.relname), '')
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
  ),
  '',
  'toute table de public active la RLS (hifago/CLAUDE.md §3)'
);

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
    where pol.schemaname in ('public', 'storage')
      and pr.provolatile = 'v'
      and (
        pol.qual ~ ('\m' || pr.proname || '\(')
        or coalesce(pol.with_check, '') ~ ('\m' || pr.proname || '\(')
      )
  ),
  0,
  'aucune fonction VOLATILE n''est appelée depuis une policy RLS (hifago/CLAUDE.md §3.3)'
);

-- (3) auth.uid() toujours sous un ( SELECT … ) --------------------------------------------------
-- Postgres réécrit une policy sous une forme canonique : `( SELECT auth.uid() AS uid)` pour
-- l'enveloppe directe, `( SELECT is_admin(auth.uid()) AS is_admin)` pour un prédicat enveloppé
-- entier. On retire ces deux formes, et tout `auth.uid()` restant est une occurrence nue.
select is(
  (
    select coalesce(string_agg(pol.schemaname || '.' || pol.tablename || '.' || pol.policyname, ', '
                               order by pol.schemaname, pol.tablename, pol.policyname), '')
    from pg_policies pol
    cross join lateral (
      select e from unnest(array[pol.qual, pol.with_check]) as e where e is not null
    ) expr
    where pol.schemaname in ('public', 'storage')
      and regexp_replace(
            regexp_replace(expr.e, '\( SELECT auth\.uid\(\) AS uid\)', '', 'g'),
            '\( SELECT [a-z_]+\(auth\.uid\(\)(, [^)]*)?\) AS [a-z_]+\)', '', 'g'
          ) ~ 'auth\.uid\(\)'
  ),
  '',
  'auth.uid() n''apparaît jamais nu dans une policy de public ou storage, toujours sous un ( SELECT … ) (hifago/CLAUDE.md §3.4)'
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

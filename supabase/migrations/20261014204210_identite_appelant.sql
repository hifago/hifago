-- Fonctions d'identité lues sur l'appelant, sans paramètre (étape 1 sur 2, ADDITIVE).
--
-- is_admin, has_admin_capability, partner_id_for_account et has_capability prenaient l'identifiant
-- du compte en paramètre, alors que tous leurs appelants passent l'appelant lui-même (auth.uid() :
-- 82 appels SQL, toutes les policies, les 19 appels de l'application). Arbitrage du 2026-10-14 :
-- elles lisent désormais l'appelant elles-mêmes.
--
-- Cette migration AJOUTE seulement, rien n'est retiré : le code déployé avant elle continue
-- d'appeler les versions à paramètre pendant la mise en ligne.
--   1. Quatre surcharges SANS identifiant : is_admin(), has_admin_capability(),
--      partner_id_for_account(), has_capability(p_role, p_establishment_id). Elles délèguent aux
--      versions existantes avec (select auth.uid()) : une seule définition de chaque règle.
--      STABLE, SECURITY DEFINER, search_path vide ; EXECUTE pour anon et authenticated (une policy
--      de lecture publique, products_select_public, évalue is_admin pour un visiteur anonyme).
--   2. Toutes les policies de public et de storage qui appellent une version à paramètre sont
--      réécrites sur la surcharge, à partir de leur définition VIVANTE (pg_get_expr), sans en
--      recopier aucune à la main. Forme (select …) conservée. Le bloc échoue si une seule policy
--      reste liée à une version à paramètre (pg_depend).
-- Étape 2, migration séparée poussée APRÈS le déploiement du code qui appelle les surcharges : les
-- versions à paramètre ne sont plus exécutables par anon ni authenticated. Elles restent appelées
-- par les fonctions SECURITY DEFINER (82 appels, exécutés en propriétaire), qui n'en dépendent pas.

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin((select auth.uid()));
$$;

create function public.has_admin_capability()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_admin_capability((select auth.uid()));
$$;

create function public.partner_id_for_account()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select public.partner_id_for_account((select auth.uid()));
$$;

create function public.has_capability(p_role text, p_establishment_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_capability((select auth.uid()), p_role, p_establishment_id);
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.has_admin_capability() from public;
revoke all on function public.partner_id_for_account() from public;
revoke all on function public.has_capability(text, uuid) from public;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.has_admin_capability() to anon, authenticated;
grant execute on function public.partner_id_for_account() to anon, authenticated;
grant execute on function public.has_capability(text, uuid) to anon, authenticated;

-- Policies : réécriture des appels à paramètre sur les surcharges, à partir du texte vivant.
-- pg_get_expr rend l'appelant sous l'une de deux formes — auth.uid() nu, ou ( SELECT auth.uid() AS
-- uid) — avec ou sans le schéma public : les deux sont couvertes.
do $$
declare
  r record;
  v_qual text;
  v_check text;
  v_restant text;
begin
  for r in
    select pol.polname, n.nspname, c.relname,
           pg_get_expr(pol.polqual, pol.polrelid) as qual,
           pg_get_expr(pol.polwithcheck, pol.polrelid) as wcheck
      from pg_policy pol
      join pg_class c on c.oid = pol.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public', 'storage')
  loop
    v_qual := r.qual;
    v_check := r.wcheck;
    v_qual := regexp_replace(v_qual,
      '((public\.)?(is_admin|has_admin_capability|partner_id_for_account))\((auth\.uid\(\)|\( SELECT auth\.uid\(\) AS uid\))\)',
      '\1()', 'g');
    v_qual := regexp_replace(v_qual,
      '((public\.)?has_capability)\((auth\.uid\(\)|\( SELECT auth\.uid\(\) AS uid\)), ', '\1(', 'g');
    v_check := regexp_replace(v_check,
      '((public\.)?(is_admin|has_admin_capability|partner_id_for_account))\((auth\.uid\(\)|\( SELECT auth\.uid\(\) AS uid\))\)',
      '\1()', 'g');
    v_check := regexp_replace(v_check,
      '((public\.)?has_capability)\((auth\.uid\(\)|\( SELECT auth\.uid\(\) AS uid\)), ', '\1(', 'g');
    if v_qual is distinct from r.qual or v_check is distinct from r.wcheck then
      execute format('alter policy %I on %I.%I%s%s', r.polname, r.nspname, r.relname,
        case when r.qual is not null then ' using (' || v_qual || ')' else '' end,
        case when r.wcheck is not null then ' with check (' || v_check || ')' else '' end);
    end if;
  end loop;

  -- Échec fermé : aucune policy ne doit rester liée à une version à paramètre.
  select string_agg(n.nspname || '.' || c.relname || '.' || pol.polname, ', ') into v_restant
    from pg_depend d
    join pg_policy pol on pol.oid = d.objid
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where d.classid = 'pg_policy'::regclass
     and d.refclassid = 'pg_proc'::regclass
     and d.refobjid in ('public.is_admin(uuid)'::regprocedure,
                        'public.has_admin_capability(uuid)'::regprocedure,
                        'public.partner_id_for_account(uuid)'::regprocedure,
                        'public.has_capability(uuid, text, uuid)'::regprocedure);
  if v_restant is not null then
    raise exception 'policies encore liées à une fonction d''identité à paramètre : %', v_restant;
  end if;
end;
$$;

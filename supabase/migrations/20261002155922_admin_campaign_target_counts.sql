-- Compteurs de campagne (/admin/campaigns et /admin/campaigns/[id]) agrégés en SQL.
--
-- Les deux pages lisaient comm_campaign_targets ligne à ligne et comptaient en TypeScript : une
-- ligne par destinataire, tronquée par `max_rows` (supabase/config.toml) au-delà de 1000. Une
-- campagne d'audience `all` dépasse ce seuil, et ses compteurs devenaient faux sans aucun signal —
-- même classe de défaut que les KPI de l'accueil corrigés par 20260930221527. Ici, une ligne par
-- (campagne, statut) : au plus cinq par campagne.
--
-- SECURITY INVOKER : la lecture reste filtrée par la RLS de la table
-- (comm_campaign_targets_select_admin, admin seul). Un non-admin obtient zéro ligne, comme il en
-- obtenait zéro en lisant la table. Même modèle que search_catalog (security invoker, lit avec les
-- droits de l'appelant). `stable` : lecture pure.
create or replace function public.admin_campaign_target_counts(p_campaign_ids uuid[])
returns table (
  campaign_id uuid,
  status text,
  n bigint
)
language sql
stable
set search_path = ''
as $$
  select t.campaign_id, t.status, count(*)
    from public.comm_campaign_targets t
   where t.campaign_id = any(p_campaign_ids)
   group by t.campaign_id, t.status;
$$;

revoke all on function public.admin_campaign_target_counts(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_campaign_target_counts(uuid[]) to authenticated;

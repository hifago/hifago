-- Accueil admin (/admin) : quatre agrégats SQL à la place des cinq lectures ligne à ligne de
-- 20260922160000 (`admin_order_lines_*`).
--
-- CE QUE CELA CORRIGE.
--   1. Le statut mort. Quatre des cinq fonctions de 20260922160000 filtraient `'confirmed'`, que le
--      CHECK `order_lines_status_check` n'admet plus depuis 20260814161500 (renommé `'reserved'`) :
--      « Pedidos pendientes de acción » valait toujours 0, et les revenus, la série des ventes et le
--      top partenaires ignoraient toutes les réservations en cours. Bug antérieur au 2026-09-22,
--      reproduit tel quel ce jour-là (le chantier était une fermeture de fuite, pas une correction).
--   2. La troncature. Chaque fonction rendait UNE LIGNE PAR `order_line`, sommée ensuite en
--      TypeScript : PostgREST borne le retour d'une fonction à `max_rows` (supabase/config.toml),
--      donc au-delà de 1000 lignes les totaux auraient été faux sans aucun signal. Ici la somme se
--      fait en SQL : `admin_dashboard_totals` rend une ligne, la série une ligne par jour, les deux
--      autres une ligne par partenaire.
--
-- STATUTS COMPTÉS COMME VENTE : `reserved`, `fulfilled`, `no_show`. C'est la spec 02 §5.2
-- (docs/specs/02-admin-accueil-et-navigation.md, statut `implemente`) : KPI 1 = `total_cop` des
-- lignes « non annulées » ; KPI 4 = lignes `reserved` dont la date de service est passée. Les
-- statuts exclus sont les annulations (`cancelled_by_client`, `cancelled_by_provider`), l'expiration
-- d'une commande impayée (`expired`) et la ligne remplacée par une modification (`superseded`).
-- Ce littéral est répété aux trois endroits qui en dépendent (totaux, série, top partenaires) : un
-- changement de définition s'y fait en trois lignes, relues ensemble.
--
-- Commissions : lignes `fulfilled` seulement (spec 02 §5.2 KPI 2), comme avant — une commission
-- n'est « générée » qu'une fois la prestation rendue.
--
-- `p_today`/`p_since` restent des PARAMÈTRES, jamais recalculés en SQL : todayInBogota()/
-- computeDateWindow() (apps/admin/app/admin/dateWindow.ts) sont la seule source de « aujourd'hui »
-- (deux calculs indépendants ont déjà divergé, 2026-08-28). Les séries groupent par
-- `order_lines.date`, une date civile : aucun fuseau n'entre en jeu côté SQL.
--
-- Les cinq `admin_order_lines_*` restent en place : leur suppression est une migration séparée,
-- poussée seulement APRÈS le déploiement du code qui ne les appelle plus.
--
-- Garde admin identique à 20260922160000 et admin_orders_list (20260922190000).

-- ── KPI 1, 2, 4 : une ligne ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_dashboard_totals(p_today date)
returns table (
  revenue_cop bigint,
  referrer_commission_cop bigint,
  app_commission_cop bigint,
  pending_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'admin_dashboard_totals réservé au rôle admin' using errcode = '42501';
  end if;

  return query
  select
    -- Statuts de vente : spec 02 §5.2, KPI 1 (« non annulées »).
    coalesce(sum(ol.total_cop) filter (
      where ol.status = any(array['reserved', 'fulfilled', 'no_show'])), 0)::bigint,
    coalesce(sum(ol.referrer_commission_cop) filter (where ol.status = 'fulfilled'), 0)::bigint,
    coalesce(sum(ol.app_commission_cop) filter (where ol.status = 'fulfilled'), 0)::bigint,
    count(*) filter (where ol.status = 'reserved' and ol.date < p_today)
  from public.order_lines ol;
end;
$$;

-- ── Graphiques ventes et commissions : une ligne par jour de service à partir de p_since ────────
-- Les jours sans vente n'ont pas de ligne : la page remplit la fenêtre à zéro (computeDateWindow).
-- Les dates de service postérieures à aujourd'hui sont rendues aussi (la page ne garde que les
-- jours de la fenêtre) : au plus quelques centaines de lignes, l'horizon de vente étant de six mois.
create or replace function public.admin_dashboard_daily_series(p_since date)
returns table (
  date date,
  sales_cop bigint,
  referrer_commission_cop bigint,
  app_commission_cop bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'admin_dashboard_daily_series réservé au rôle admin' using errcode = '42501';
  end if;

  return query
  select
    ol.date,
    sum(ol.total_cop)::bigint,
    coalesce(sum(ol.referrer_commission_cop) filter (where ol.status = 'fulfilled'), 0)::bigint,
    coalesce(sum(ol.app_commission_cop) filter (where ol.status = 'fulfilled'), 0)::bigint
  from public.order_lines ol
  where ol.date >= p_since
    -- Statuts de vente : spec 02 §5.2, KPI 1 (« non annulées »).
    and ol.status = any(array['reserved', 'fulfilled', 'no_show'])
  group by ol.date;
end;
$$;

-- ── Chips « Comisiones generadas » : commission référent par partenaire référent ────────────────
-- Lignes `fulfilled` attribuées à un référent ; une ligne par référent, la page garde les trois
-- premiers. Tri par montant décroissant, puis id pour un ordre stable.
create or replace function public.admin_dashboard_referrer_commissions()
returns table (
  referrer_partner_id uuid,
  referrer_commission_cop bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'admin_dashboard_referrer_commissions réservé au rôle admin' using errcode = '42501';
  end if;

  return query
  select ol.referrer_partner_id, sum(ol.referrer_commission_cop)::bigint as total
  from public.order_lines ol
  where ol.status = 'fulfilled'
    and ol.referrer_partner_id is not null
  group by ol.referrer_partner_id
  order by total desc, ol.referrer_partner_id;
end;
$$;

-- ── Graphique « top partenaires » : volume de ventes par partenaire VENDEUR ─────────────────────
-- Le partenaire propriétaire de l'établissement du produit, pas le référent — lecture « qui a
-- généré le plus » du cahier admin §2, comme la table « Détail par Hostel » du legacy.
create or replace function public.admin_dashboard_top_partners(p_limit int default 8)
returns table (
  partner_id uuid,
  partner_display_name text,
  total_cop bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'admin_dashboard_top_partners réservé au rôle admin' using errcode = '42501';
  end if;

  return query
  select pt.id, pt.display_name, sum(ol.total_cop)::bigint as total
  from public.order_lines ol
  join public.products p on p.id = ol.product_id
  join public.establishments e on e.id = p.establishment_id
  join public.partners pt on pt.id = e.partner_id
  -- Statuts de vente : spec 02 §5.2, KPI 1 (« non annulées »).
  where ol.status = any(array['reserved', 'fulfilled', 'no_show'])
  group by pt.id, pt.display_name
  order by total desc, pt.id
  limit p_limit;
end;
$$;

revoke all on function public.admin_dashboard_totals(date) from public, anon, authenticated;
revoke all on function public.admin_dashboard_daily_series(date) from public, anon, authenticated;
revoke all on function public.admin_dashboard_referrer_commissions() from public, anon, authenticated;
revoke all on function public.admin_dashboard_top_partners(int) from public, anon, authenticated;

grant execute on function public.admin_dashboard_totals(date) to authenticated;
grant execute on function public.admin_dashboard_daily_series(date) to authenticated;
grant execute on function public.admin_dashboard_referrer_commissions() to authenticated;
grant execute on function public.admin_dashboard_top_partners(int) to authenticated;

-- Ledger admin et commissions du référent : trois lectures RPC à la place des embeds
-- `order_lines!inner` que le revoke du 2026-09-22 (20260922210000) a cassés.
--
-- CE QUI ÉTAIT CASSÉ. 20260922210000 a retiré le SELECT d'`order_lines` à `authenticated` et ses
-- trois policies de lecture. Les dix lectures directes recensées alors avaient été converties en
-- RPC le même jour (migrations « site N/10 ») ; quatre autres sont passées à travers parce
-- qu'elles partent de `ledger_entries` et n'atteignent `order_lines` que par un EMBED PostgREST
-- (`order_line:order_lines!inner(...)`), invisible à une recherche de `.from("order_lines")` :
-- apps/admin/app/admin/ledger/page.tsx, apps/admin/app/partner/(app)/commissions/page.tsx (liste
-- et totaux) et apps/admin/app/partner/(app)/commissions/[id]/page.tsx. Un embed est une jointure
-- SQL : Postgres vérifie le grant de table avant toute RLS, donc chaque requête rendait
-- `permission denied for table order_lines`, avalé par `?? []` côté page — ledger vide, bouton
-- « Marcar pagado » absent, commissions et totaux à 0, fiche en 404. `ledger_entries` lui-même
-- était resté lisible (ses deux policies vivent toujours) : seul le saut vers `order_lines` tombait.
-- Le garde-fou scripts/check-order-lines-access.sh empêche désormais un embed de revenir.
--
-- POURQUOI DES RPC, et pas une vue ni un grant. Même méthode que les dix sites du 2026-09-22 :
-- une RPC `security definer` par écran, qui rend exactement les colonnes affichées. Un grant
-- colonne rouvrirait la lecture de la ligne entière (plus aucune policy ne la borne) ; une vue
-- `security_invoker` échouerait à l'identique (l'appelant n'a pas SELECT) ; le client
-- `service_role` est réservé aux Route Handlers (packages/supabase/src/service.ts) et déplacerait
-- le périmètre en TypeScript.
--
-- Squelette : partner_reservations_list (20260922175000) — `stable`, `security definer`,
-- `search_path = ''`, périmètre calculé dans le WHERE depuis `auth.uid()` (jamais un paramètre de
-- confiance), `count(*) over()` pour la pagination, tri par CASE statique sur une liste blanche.

-- ── 1. /admin/ledger ─────────────────────────────────────────────────────────────────────────────
-- Garde admin identique à admin_orders_list (20260922190000). Les filtres type/établissement
-- portent sur le produit de la ligne : ils remplacent la pré-requête `products` que la page
-- faisait pour éviter un filtre sur un embed à deux niveaux. Clés de tri = LEDGER_SORT_WHITELIST
-- (apps/admin/lib/lists/sortable-columns.ts).
create or replace function public.admin_ledger_entries_list(
  p_date_from date default null,
  p_date_to date default null,
  p_status text default null,
  p_type text default null,
  p_referrer_partner_id uuid default null,
  p_establishment_id uuid default null,
  p_sort_key text default 'created_at',
  p_sort_desc boolean default true,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  amount_cop bigint,
  status text,
  date date,
  product_type text,
  establishment_name jsonb,
  referrer_display_name text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin(auth.uid())) then
    raise exception 'admin_ledger_entries_list réservé au rôle admin' using errcode = '42501';
  end if;

  return query
  select
    le.id, le.amount_cop, le.status,
    ol.date, p.type, e.name, rp.display_name,
    count(*) over()
  from public.ledger_entries le
  join public.order_lines ol on ol.id = le.order_line_id
  join public.products p on p.id = ol.product_id
  join public.establishments e on e.id = p.establishment_id
  left join public.partners rp on rp.id = le.referrer_partner_id
  where (p_date_from is null or ol.date >= p_date_from)
    and (p_date_to is null or ol.date <= p_date_to)
    and (p_status is null or le.status = p_status)
    and (p_type is null or p.type = p_type)
    and (p_referrer_partner_id is null or le.referrer_partner_id = p_referrer_partner_id)
    and (p_establishment_id is null or p.establishment_id = p_establishment_id)
  order by
    case when p_sort_key = 'created_at' and not p_sort_desc then le.created_at end asc nulls last,
    case when p_sort_key = 'created_at' and p_sort_desc then le.created_at end desc nulls last,
    case when p_sort_key = 'status' and not p_sort_desc then le.status end asc nulls last,
    case when p_sort_key = 'status' and p_sort_desc then le.status end desc nulls last,
    case when p_sort_key = 'amount_cop' and not p_sort_desc then le.amount_cop end asc nulls last,
    case when p_sort_key = 'amount_cop' and p_sort_desc then le.amount_cop end desc nulls last
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.admin_ledger_entries_list(date, date, text, text, uuid, uuid, text, boolean, int, int)
  from public, anon, authenticated;
grant execute on function public.admin_ledger_entries_list(date, date, text, text, uuid, uuid, text, boolean, int, int)
  to authenticated;

-- ── 2. /partner/commissions (liste) et /partner/commissions/[id] (fiche) ─────────────────────────
-- Périmètre = prédicat de la policy ledger_entries_select_referrer (20260818120000), plus le
-- filtre `beneficiary_type = 'referrer'` que la page posait explicitement : un référent ne voit
-- jamais une entrée `establishment_compensation`, ni celle d'un autre référent. Le partenaire est
-- résolu UNE fois depuis `auth.uid()` ; un compte sans partenaire (anonyme compris) obtient zéro
-- ligne, comme avant. La fiche passe `p_entry_id` avec `p_limit => 1` : elle n'affiche que des
-- colonnes déjà présentes sur la ligne de liste. Colonnes rendues = celles que l'écran montre,
-- jamais `app_commission_cop`, `acompte_cop`, `commission_case` ni `app_pct` (spec 22).
create or replace function public.partner_commissions_list(
  p_entry_id uuid default null,
  p_date_from date default null,
  p_date_to date default null,
  p_status text default null,
  p_sort_key text default 'created_at',
  p_sort_desc boolean default true,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  amount_cop bigint,
  status text,
  date date,
  total_cop bigint,
  holder_name text,
  referrer_pct numeric,
  product_name jsonb,
  establishment_name jsonb,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_partner_id uuid := public.partner_id_for_account(auth.uid());
begin
  return query
  select
    le.id, le.amount_cop, le.status,
    ol.date, ol.total_cop, ol.holder_name, ol.referrer_pct,
    p.name, e.name,
    count(*) over()
  from public.ledger_entries le
  join public.order_lines ol on ol.id = le.order_line_id
  join public.products p on p.id = ol.product_id
  join public.establishments e on e.id = p.establishment_id
  where le.beneficiary_type = 'referrer'
    and le.referrer_partner_id = v_partner_id
    and (p_entry_id is null or le.id = p_entry_id)
    and (p_date_from is null or ol.date >= p_date_from)
    and (p_date_to is null or ol.date <= p_date_to)
    and (p_status is null or le.status = p_status)
  order by
    case when p_sort_key = 'created_at' and not p_sort_desc then le.created_at end asc nulls last,
    case when p_sort_key = 'created_at' and p_sort_desc then le.created_at end desc nulls last
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.partner_commissions_list(uuid, date, date, text, text, boolean, int, int)
  from public, anon, authenticated;
grant execute on function public.partner_commissions_list(uuid, date, date, text, text, boolean, int, int)
  to authenticated;

-- ── 3. Totaux de /partner/commissions ────────────────────────────────────────────────────────────
-- Une ligne par statut, sur TOUTES les entrées qui passent les filtres (pas seulement la page
-- affichée). La page sommait en JS une ligne par entrée, donc tronquée par `max_rows`
-- (supabase/config.toml) au-delà de 1000 entrées d'un même référent ; ici la somme se fait en SQL
-- et le résultat tient en au plus cinq lignes. Même périmètre et mêmes filtres que la liste.
create or replace function public.partner_commission_totals(
  p_date_from date default null,
  p_date_to date default null,
  p_status text default null
)
returns table (
  status text,
  amount_cop bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_partner_id uuid := public.partner_id_for_account(auth.uid());
begin
  return query
  select le.status, sum(le.amount_cop)::bigint
  from public.ledger_entries le
  join public.order_lines ol on ol.id = le.order_line_id
  where le.beneficiary_type = 'referrer'
    and le.referrer_partner_id = v_partner_id
    and (p_date_from is null or ol.date >= p_date_from)
    and (p_date_to is null or ol.date <= p_date_to)
    and (p_status is null or le.status = p_status)
  group by le.status;
end;
$$;

revoke all on function public.partner_commission_totals(date, date, text)
  from public, anon, authenticated;
grant execute on function public.partner_commission_totals(date, date, text)
  to authenticated;

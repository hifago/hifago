-- Les nuits déjà ouvertes d'un logement suivent sa configuration (retour Jérôme, 2026-10-24).
--
-- LE CONSTAT, en prod : RM201 (chambre privée, « Cantidad » 1, « Cupo diario por defecto » 1) se
-- vendait 3 fois par nuit — ses 183 nuits (24/10/2026 → 24/04/2027) portaient toutes capacity = 3.
-- Le cupo par défaut valait 3 quand le logement a été créé ; Jérôme l'a ramené à 1, sans effet.
--
-- DEUX DÉFAUTS, une seule cause : `open_default_lodging_availability` (20260913100000) matérialise
-- six mois de nuits À LA CRÉATION, en `on conflict do nothing` — choix voulu pour ne jamais écraser
-- une exception posée par le socio au calendrier. Conséquences :
--   1. changer ensuite le cupo par défaut ne touche que les nuits ouvertes APRÈS (le roulement
--      quotidien en ajoute une par jour), alors que l'écran promet « Cuántas unidades hay disponibles
--      cada día por defecto (antes de excepciones en el calendario) » ;
--   2. ces nuits contournent le garde-fou physique de `set_product_availability` (20260827250000) :
--      une chambre privée en 1 exemplaire ne peut pas ouvrir 3 places par nuit à la main, mais
--      l'ouverture automatique le faisait sans rien vérifier.
--
-- CE QUI CHANGE
--   1. `lodging_physical_capacity` : la capacité physique d'un logement, formule EXACTE du garde de
--      `set_product_availability` (unit_count × capacity pour un dortoir ou un type inconnu,
--      unit_count sinon, NULL quand unit_count est vide). Ce garde garde sa copie en ligne : la
--      réécrire pour l'appeler toucherait une RPC de capacité sans rien corriger.
--   2. `open_default_lodging_availability` n'ouvre jamais plus que cette capacité physique.
--   3. Déclencheur `products_realign_lodging_nights` : quand le cupo par défaut, la quantité, le type
--      de couchage ou la capacité d'un logement hors Lobby CHANGENT, ses nuits futures se réalignent :
--        - une nuit qui portait l'ANCIEN cupo par défaut prend le nouveau (elle suivait le défaut) ;
--        - une nuit différente est une exception du calendrier : elle garde sa valeur ;
--        - aucune nuit ne dépasse la capacité physique ;
--        - aucune nuit ne descend sous ce qui y est déjà réservé (`booked`).
--      Limite assumée : une exception posée exactement à la valeur de l'ancien défaut est
--      indiscernable d'une nuit par défaut — elle suit le nouveau, comme elle.
--   4. Correction unique : les nuits futures déjà au-dessus de la capacité physique y sont ramenées
--      (jamais sous `booked`). C'est ce qui répare RM201 en prod.
--
-- ANTI-SURVENTE (CLAUDE.md §4). Baisser une capacité est l'opération de `set_product_availability`,
-- en plusieurs nuits : même discipline. Les nuits sont verrouillées `for update` dans l'ordre de
-- `create_order` (product_id, date) AVANT toute écriture, et la nouvelle valeur ne descend jamais
-- sous `booked`, relu sous verrou. `create_order` ne verrouille pas `products` pour un logement :
-- aucune attente croisée possible avec le verrou de ligne que prend l'UPDATE du produit. Prouvé par
-- tests/concurrency/realign_lodging_nights.concurrency.mjs (un admin baisse le cupo pendant que des
-- clients réservent la même nuit).
--
-- Rien ne change pour un logement Lobby (`lobby_category_id` non nul) : il n'a pas de nuits ici.

-- ── 1. Capacité physique ──────────────────────────────────────────────────────────────────────
create or replace function public.lodging_physical_capacity(
  p_lodging_kind text,
  p_unit_count int,
  p_capacity int
)
returns int
language sql
immutable
set search_path = ''
as $$
  select case
    when p_unit_count is null then null
    when p_lodging_kind is null or p_lodging_kind = 'dorm' then p_unit_count * coalesce(p_capacity, 1)
    else p_unit_count
  end;
$$;

revoke all on function public.lodging_physical_capacity(text, int, int) from public, anon, authenticated;

-- ── 2. Ouverture des nuits : jamais au-dessus de la capacité physique ───────────────────────────
-- Définition vivante extraite par pg_get_functiondef (20260919100000) ; seule la valeur insérée
-- change. `least` ignore un NULL : sans unit_count, c'est le cupo par défaut seul, comme avant.
create or replace function public.open_default_lodging_availability(
  p_product_id uuid,
  p_horizon interval default '6 months'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.product_availability (product_id, date, capacity, booked)
  select p.id, d::date,
         least(p.default_capacity, public.lodging_physical_capacity(p.lodging_kind, p.unit_count, p.capacity)),
         0
    from public.products p
    cross join generate_series(
      public.today_in_bogota(), public.today_in_bogota() + p_horizon, interval '1 day'
    ) as d
   where p.id = p_product_id
     and p.default_capacity is not null
     and p.lobby_category_id is null
  on conflict (product_id, date) do nothing;
end;
$$;

revoke all on function public.open_default_lodging_availability(uuid, interval) from public, anon, authenticated;

-- ── 3. Réalignement des nuits futures quand la configuration change ─────────────────────────────
-- SECURITY DEFINER : l'UPDATE du produit vient d'un admin (rôle `authenticated`), qui n'a aucun
-- droit d'écriture sur `product_availability` (RPC-only, CLAUDE.md §3.1).
create or replace function public.realign_lodging_nights_on_config_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := public.today_in_bogota();
  v_physical int := public.lodging_physical_capacity(new.lodging_kind, new.unit_count, new.capacity);
begin
  -- Verrouiller d'abord, dans l'ordre de create_order : la valeur cible se calcule ensuite sur des
  -- lignes que plus personne ne peut modifier, `booked` compris.
  perform 1
     from public.product_availability
    where product_id = new.id
      and date >= v_today
    order by date
    for update;

  with cible as (
    select pa.date,
           greatest(
             least(
               case
                 when new.default_capacity is not null and pa.capacity = old.default_capacity
                   then new.default_capacity
                 else pa.capacity
               end,
               v_physical
             ),
             pa.booked
           ) as capacity
      from public.product_availability pa
     where pa.product_id = new.id
       and pa.date >= v_today
  )
  update public.product_availability pa
     set capacity = cible.capacity
    from cible
   where pa.product_id = new.id
     and pa.date = cible.date
     and pa.capacity <> cible.capacity;

  return null;
end;
$$;

revoke all on function public.realign_lodging_nights_on_config_change() from public, anon, authenticated;

drop trigger if exists products_realign_lodging_nights on public.products;
create trigger products_realign_lodging_nights
  after update of default_capacity, unit_count, lodging_kind, capacity on public.products
  for each row
  when (
    new.type = 'lodging'
    and new.lobby_category_id is null
    and (
      old.default_capacity is distinct from new.default_capacity
      or old.unit_count is distinct from new.unit_count
      or old.lodging_kind is distinct from new.lodging_kind
      or old.capacity is distinct from new.capacity
    )
  )
  execute function public.realign_lodging_nights_on_config_change();

-- ── 4. Correction unique : nuits futures au-dessus de la capacité physique ─────────────────────
-- Idempotente (une seconde passe ne trouve plus rien). Même verrouillage ordonné qu'en 3.
do $$
declare
  v_nuits int;
begin
  perform 1
     from public.product_availability pa
     join public.products p on p.id = pa.product_id
    where p.type = 'lodging'
      and p.lobby_category_id is null
      and pa.date >= public.today_in_bogota()
      and pa.capacity > public.lodging_physical_capacity(p.lodging_kind, p.unit_count, p.capacity)
    order by pa.product_id, pa.date
    for update of pa;

  update public.product_availability pa
     set capacity = greatest(public.lodging_physical_capacity(p.lodging_kind, p.unit_count, p.capacity), pa.booked)
    from public.products p
   where p.id = pa.product_id
     and p.type = 'lodging'
     and p.lobby_category_id is null
     and pa.date >= public.today_in_bogota()
     and greatest(public.lodging_physical_capacity(p.lodging_kind, p.unit_count, p.capacity), pa.booked) < pa.capacity;

  get diagnostics v_nuits = row_count;
  raise notice 'nuits_logement_suivent_la_config : % nuit(s) ramenée(s) à la capacité physique', v_nuits;
end;
$$;

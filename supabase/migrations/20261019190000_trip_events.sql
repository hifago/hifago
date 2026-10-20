-- Mi viaje — un evento non réservable s'y ajoute sans réservation (spec 42, décisions de Jérôme du
-- 2026-10-19).
--
-- Une table À PART, jamais une ligne de cart_items : un evento non réservable y serait refusé
-- (not_sellable) par cart_lines_availability et create_order — tout le voyage deviendrait
-- impayable — et create_order vide cart_items dès qu'une commande existe. Ici, rien de ce chemin
-- ne change : ni create_order, ni cart_lines_availability, ni /pago.
--
-- RLS directe (CLAUDE.md §3.2) : une identité gère ses propres eventos notés, aucun compteur de
-- capacité, rien n'est réservé. Insert limité à un evento non réservable en ligne et visible
-- (sous la RLS de products : products_select_public, sellable seulement) — un evento réservable
-- passe par le panier comme toute activité.
--
-- `on delete cascade` sur les deux FK, contre la règle de la spec 31 (inv. 9, « zéro CASCADE vers
-- partner_accounts ») : cette règle protège une identité qui a laissé une TRACE ; un evento noté
-- n'en est pas une, pas plus que cart_items, que les quatre fonctions de suppression
-- (purge_expired_anonymous_identities, delete_product, admin_delete_partner, delete_my_account)
-- vident déjà à la main. La cascade évite de les réécrire toutes les quatre.
--
-- L'occurrence n'est PAS vérifiée à l'écriture : le calcul de récurrence n'existe qu'une fois
-- (expand_event_occurrences), et la lecture doit de toute façon voir une date que l'admin a
-- changée après coup — trip_events_status() le dit ligne par ligne. « Passé » est filtré côté
-- front (todayInBogota) : today_in_bogota() est fermée aux rôles de la Data API.

create table public.trip_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.partner_accounts(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  date date not null,
  created_at timestamptz not null default now(),
  -- Noter deux fois le même evento à la même date n'a pas de sens : le doublon est refusé (23505),
  -- et le front le traite comme un succès. Sert aussi l'accès par account_id (colonne de tête).
  constraint trip_events_account_product_date_key unique (account_id, product_id, date)
);

-- Index de la FK product_id : la cascade d'un delete products balaierait sinon toute la table.
create index trip_events_product_id_idx on public.trip_events(product_id);

-- Aucun update : changer de date = retirer puis ajouter.
grant select, insert, delete on public.trip_events to authenticated;
revoke update on public.trip_events from authenticated, anon;
revoke all on public.trip_events from anon;
alter table public.trip_events enable row level security;

create policy trip_events_select on public.trip_events
  for select
  using (account_id = (select auth.uid()));

create policy trip_events_insert on public.trip_events
  for insert
  with check (
    account_id = (select auth.uid())
    and exists (
      select 1
        from public.products p
       where p.id = product_id
         and p.type = 'evento'
         and not p.online_bookable
    )
  );

create policy trip_events_delete on public.trip_events
  for delete
  using (account_id = (select auth.uid()));

-- Chaque evento noté de l'appelant : sa date est-elle encore une occurrence ? Un confort
-- d'affichage (même posture que cart_lines_availability) — invoker, la RLS de trip_events et de
-- products s'applique ; expand_event_occurrences reste le seul calcul de récurrence.
create function public.trip_events_status()
returns table (id uuid, on_occurrence boolean)
language sql
stable
set search_path = ''
as $$
  select te.id,
         exists (
           select 1 from public.expand_event_occurrences(te.product_id, te.date, te.date)
         )
    from public.trip_events te
   where te.account_id = (select auth.uid());
$$;

revoke all on function public.trip_events_status() from public, anon;
grant execute on function public.trip_events_status() to authenticated;

comment on function public.trip_events_status() is
  'Spec 42 — pour chaque evento noté dans Mi viaje par l''appelant, si sa date est encore une '
  'occurrence (expand_event_occurrences). Lecture seule, confort d''affichage.';

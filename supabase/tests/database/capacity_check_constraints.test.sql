-- Garde-fou (audit P12c, décision D7 du 2026-10-06) : les contraintes CHECK qui bornent la
-- capacité et les montants existent, sont VALIDÉES et gardent leur définition exacte. Ce sont le
-- dernier filet de l'invariant anti-survente (CLAUDE.md §4) : une RPC qui oublierait un contrôle
-- (`booked` au-delà de `capacity`, `qty` nulle ou négative, montant négatif) échoue sur elles
-- plutôt que d'écrire. Une migration qui en retirerait une, ou la poserait `NOT VALID`, ne casserait
-- aucun autre test.
-- Ajouter ici toute nouvelle contrainte de la même famille (capacité, quantité, montant, bornes).
begin;
select plan(1);

create temp table tmp_expected_checks (table_name text, constraint_name text, definition text);
insert into tmp_expected_checks values
  ('cart_items', 'cart_items_qty_positive', 'CHECK ((qty > 0))'),
  ('order_lines', 'order_lines_amounts_non_negative', 'CHECK (((price_cop >= 0) AND (total_cop >= 0) AND (acompte_cop >= 0) AND (referrer_commission_cop >= 0) AND (app_commission_cop >= 0)))'),
  ('order_lines', 'order_lines_qty_positive', 'CHECK ((qty > 0))'),
  ('product_availability', 'product_availability_booked_within_capacity', 'CHECK (((booked >= 0) AND (booked <= capacity)))'),
  ('product_slot_availability', 'product_slot_availability_booked_within_capacity', 'CHECK (((booked >= 0) AND (booked <= capacity)))'),
  ('products', 'products_external_booking_url_scheme', 'CHECK (((external_booking_url IS NULL) OR (external_booking_url ~* ''^https?://''::text)))'),
  ('products', 'products_max_qty_positive', 'CHECK (((max_qty IS NULL) OR (max_qty >= 1)))'),
  ('products', 'products_min_qty_positive', 'CHECK (((min_qty IS NULL) OR (min_qty >= 1)))'),
  ('products', 'products_qty_bounds_order', 'CHECK (((min_qty IS NULL) OR (max_qty IS NULL) OR (min_qty <= max_qty)))'),
  ('provider_resource_calendar', 'provider_resource_calendar_booked_within_capacity', 'CHECK (((booked >= 0) AND (booked <= capacity)))')
;

-- Liste des écarts : contrainte absente, non validée, ou de définition différente.
select is(
  (
    select coalesce(string_agg(e.table_name || '.' || e.constraint_name, ', '
                               order by e.table_name, e.constraint_name), '')
    from tmp_expected_checks e
    where not exists (
      select 1 from pg_constraint c
      where c.conrelid = ('public.' || e.table_name)::regclass
        and c.conname = e.constraint_name
        and c.contype = 'c'
        and c.convalidated
        and pg_get_constraintdef(c.oid) = e.definition
    )
  ),
  '',
  'les CHECK de capacité, quantité, montants et bornes existent, validées, à l''identique'
);

select * from finish();
rollback;

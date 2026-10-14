-- Date et récurrence d'un evento qui porte des réservations (migration 20261014204354, arbitrage
-- du 2026-10-14). Un changement est ACCEPTÉ si chaque ligne `reserved` à venir tombe encore sur une
-- occurrence ; sinon refusé (HF002), avec le nombre de réservations et leurs dates, en espagnol.
-- Lignes passées et lignes annulées ignorées ; evento informatif non contrôlé ; heure libre ;
-- les drapeaux de capacité restent gelés. Dates relatives à today_in_bogota().
-- La course modification / commande : tests/concurrency/evento_occurrence_change.concurrency.mjs.
begin;
select plan(16);

-- Exécute une instruction et rend « ok », ou « SQLSTATE | message | détail ».
create function test_try(p_sql text) returns text language plpgsql as $$
declare
  v_detail text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return sqlstate || ' | ' || sqlerrm || ' | ' || coalesce(v_detail, '');
end;
$$;
create function d(p_offset int) returns date language sql stable as $$ select public.today_in_bogota() + p_offset $$;
create function fr(p_offset int) returns text language sql stable as $$ select to_char(public.today_in_bogota() + p_offset, 'DD/MM/YYYY') $$;

insert into auth.users (id, email) values ('a0c50000-0000-4000-8000-000000000031', 'occurrence-change@test.local');
insert into partners (id, display_name) values ('a0c50000-0000-4000-8000-000000000001', 'Occurrence Change');
insert into establishments (id, partner_id, name) values
  ('a0c50000-0000-4000-8000-000000000011', 'a0c50000-0000-4000-8000-000000000001', jsonb_build_object('es', 'Occurrence Change'));

-- Eventos vendus en ligne, metered, hebdomadaires à partir de J+7 (sauf 25 : informatif ; 26 : une
-- seule date, passée).
insert into products (id, partner_id, establishment_id, type, name, slug, sellable, price_cop, online_bookable,
                      evento_capacity_mode, evento_payment_mode, default_capacity, evento_occupies_resource,
                      occurrence_type, occurrence_date, recurrence_frequency_days)
select ('a0c50000-0000-4000-8000-0000000000' || n)::uuid, 'a0c50000-0000-4000-8000-000000000001',
       'a0c50000-0000-4000-8000-000000000011', 'evento', jsonb_build_object('es', 'Evento ' || n), 'occ-change-' || n, true,
       30000, n <> '25', case when n <> '25' then 'metered' end, case when n <> '25' then 'online' end,
       case when n <> '25' then 10 end, false,
       case when n = '26' then 'once' else 'recurring' end,
       case when n = '26' then d(-7) else d(7) end,
       case when n = '26' then null else 7 end
  from unnest(array['21', '22', '23', '24', '25', '26']) n;

insert into orders (id, account_id, holder_name, holder_email) values
  ('a0c50000-0000-4000-8000-000000000041', 'a0c50000-0000-4000-8000-000000000031', 'Occurrence', 'occurrence-change@test.local');
create function test_line(p_product text, p_offset int, p_status text default 'reserved') returns void language sql as $$
  insert into order_lines (order_id, account_id, product_id, date, qty, status, holder_name,
    price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct, acompte_cop, referrer_commission_cop, app_commission_cop)
  values ('a0c50000-0000-4000-8000-000000000041', 'a0c50000-0000-4000-8000-000000000031',
          ('a0c50000-0000-4000-8000-0000000000' || p_product)::uuid, public.today_in_bogota() + p_offset, 1, p_status, 'Occurrence',
          30000, 30000, 'direct', 0.17, 0, 0.17, 5100, 0, 5100);
$$;
-- 21 : une réservation à J+14 (deuxième occurrence).
select test_line('21', 14);
-- 22 : deux réservations, J+14 et J+28.
select test_line('22', 14);
select test_line('22', 28);
-- 23 : onze réservations, une par semaine de J+14 à J+84.
select test_line('23', 7 * g) from generate_series(2, 12) g;
-- 24 : une seule ligne, ANNULÉE, à J+14.
select test_line('24', 14, 'cancelled_by_client');
-- 25 : evento informatif, une présence saisie à la main, à J+3 (aucune occurrence).
select test_line('25', 3);
-- 26 : une réservation restée `reserved` sur sa date PASSÉE (J-7).
select test_line('26', -7);

-- ── Refus : une réservation à venir sortirait des dates ─────────────────────
select is(
  test_try($$update products set recurrence_frequency_days = 14 where id = 'a0c50000-0000-4000-8000-000000000021'$$),
  'HF002 | occurrence_change_orphans_reservations | 1 reserva en curso quedaría fuera de las nuevas fechas: ' || fr(14),
  'tous les 14 jours au lieu de 7 : la réservation de J+14 sortirait → HF002, détail au singulier avec sa date');
select is(
  (select recurrence_frequency_days from products where id = 'a0c50000-0000-4000-8000-000000000021'), 7,
  'refus : rien n''a changé');
select is(
  test_try($$update products set occurrence_type = 'once', recurrence_frequency_days = null where id = 'a0c50000-0000-4000-8000-000000000022'$$),
  'HF002 | occurrence_change_orphans_reservations | 2 reservas en curso quedarían fuera de las nuevas fechas: ' || fr(14) || ', ' || fr(28),
  'une seule date au lieu d''une série : deux réservations sortiraient → détail au pluriel, dates triées');
select is(
  test_try($$update products set occurrence_date = public.today_in_bogota() + 8 where id = 'a0c50000-0000-4000-8000-000000000023'$$),
  'HF002 | occurrence_change_orphans_reservations | 11 reservas en curso quedarían fuera de las nuevas fechas: '
    || (select string_agg(fr(7 * g), ', ' order by g) from generate_series(2, 11) g) || ', …',
  'onze réservations hors dates : dix dates citées, puis « … »');

-- ── Acceptation : chaque réservation à venir reste sur une occurrence ───────
select is(
  test_try($$update products set occurrence_date = public.today_in_bogota(), recurrence_end_count = 10 where id = 'a0c50000-0000-4000-8000-000000000021'$$),
  'ok', 'série avancée d''une semaine, J+14 reste une occurrence → accepté');
select is(
  (select occurrence_date from products where id = 'a0c50000-0000-4000-8000-000000000021'), d(0),
  'acceptation : la nouvelle date est écrite');
select is(
  test_try($$update products set recurrence_end_count = null, recurrence_end_date = public.today_in_bogota() + 14
              where id = 'a0c50000-0000-4000-8000-000000000021'$$),
  'ok', 'série arrêtée à J+14, qui en reste la dernière occurrence → accepté');
select is(
  test_try($$update products set start_time = '18:30', duration_minutes = 90 where id = 'a0c50000-0000-4000-8000-000000000022'$$),
  'ok', 'heure et durée : libres, même avec des réservations');
select is(
  test_try($$update products set recurrence_frequency_days = 14 where id = 'a0c50000-0000-4000-8000-000000000024'$$),
  'ok', 'une ligne ANNULÉE ne retient pas l''ancienne série');
select is(
  test_try($$update products set occurrence_date = public.today_in_bogota() + 30 where id = 'a0c50000-0000-4000-8000-000000000026'$$),
  'ok', 'une réservation PASSÉE (J-7, jamais marquée réalisée) ne bloque pas un changement d''avenir');
select is(
  test_try($$update products set occurrence_type = 'once', occurrence_date = public.today_in_bogota() + 40, recurrence_frequency_days = null
              where id = 'a0c50000-0000-4000-8000-000000000025'$$),
  'ok', 'evento informatif : ses présences manuelles ne sont pas tenues à ses dates');

-- ── Les drapeaux de capacité restent gelés ──────────────────────────────────
select is(
  test_try($$update products set evento_capacity_mode = 'rsvp' where id = 'a0c50000-0000-4000-8000-000000000021'$$),
  'P0001 | capacity_flags_frozen_while_reserved | Ce produit porte des réservations en cours : lobby_category_id, evento_capacity_mode et evento_occupies_resource ne peuvent pas changer tant qu''elles ne sont pas réalisées ou annulées. La date et la récurrence d''un evento relèvent de products_occurrence_change_guard.',
  'mode de cupo : toujours gelé tant qu''une ligne est réservée');
select is(
  test_try($$update products set evento_occupies_resource = true where id = 'a0c50000-0000-4000-8000-000000000022'$$),
  'P0001 | capacity_flags_frozen_while_reserved | Ce produit porte des réservations en cours : lobby_category_id, evento_capacity_mode et evento_occupies_resource ne peuvent pas changer tant qu''elles ne sont pas réalisées ou annulées. La date et la récurrence d''un evento relèvent de products_occurrence_change_guard.',
  'occupation de la ressource : toujours gelée');

-- ── Triggers en place ───────────────────────────────────────────────────────
select is(
  (select array_agg(tgname::text order by tgname) from pg_trigger
    where tgrelid = 'public.products'::regclass and tgname like 'products_%occurrence%' or (tgrelid = 'public.products'::regclass and tgname = 'products_capacity_flags_frozen')),
  array['products_capacity_flags_frozen', 'products_occurrence_change_guard'],
  'deux triggers : le gel des drapeaux (BEFORE) et la garde d''occurrence (AFTER)');
select ok(
  not exists (select 1 from pg_trigger t join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = any(t.tgattr::smallint[])
               where t.tgname = 'products_capacity_flags_frozen' and a.attname like '%occurrence%'),
  'le trigger BEFORE ne se déclenche plus sur les colonnes d''occurrence');
select ok(
  (select bool_and(prosrc ~ 'for share') from pg_proc
    where proname in ('create_order', 'create_manual_order_line') and pronamespace = 'public'::regnamespace),
  'create_order et create_manual_order_line lisent les occurrences d''un evento sous verrou partagé');

select * from finish();
rollback;

-- Date et récurrence d'un evento qui porte des réservations (migration 20261014204354, arbitrage
-- du 2026-10-14). Un changement est ACCEPTÉ si chaque ligne `reserved` à venir tombe encore sur une
-- occurrence ; sinon refusé (HF002), avec le nombre de réservations et leurs dates, en espagnol.
-- Lignes tenues : toute ligne vendue en ligne (même si l'evento ne l'est plus) et toute ligne d'un
-- evento vendu en ligne ; libres : présences manuelles d'un evento informatif. Contrôle sur un VRAI
-- changement (ou l'activation de la vente en ligne), jamais sur un réenregistrement à l'identique.
-- Lignes passées et annulées ignorées ; heure libre ; les drapeaux de capacité restent gelés.
-- Chaque cas tue une mutation précise (indiquée). Dates relatives à today_in_bogota().
-- La course modification / commande : tests/concurrency/evento_occurrence_change.concurrency.mjs.
begin;
select plan(23);

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
create function fr(p_offset int) returns text language sql stable as $$ select to_char(public.today_in_bogota() + p_offset, 'DD/MM/YYYY') $$;
create function pid(p_n text) returns uuid language sql immutable as $$ select ('a0c50000-0000-4000-8000-0000000000' || p_n)::uuid $$;
-- UPDATE d'un evento par son suffixe : « ok » ou le refus.
create function test_update(p_n text, p_set text) returns text language sql as $$
  select test_try(format('update products set %s where id = %L', p_set, pid(p_n)));
$$;
-- Le refus HF002 attendu pour n réservations sur ces dates.
create function hf002(p_count int, p_dates text) returns text language sql as $$
  select 'HF002 | occurrence_change_orphans_reservations | '
         || case when p_count = 1 then '1 reserva en curso quedaría fuera de las nuevas fechas: '
                 else p_count || ' reservas en curso quedarían fuera de las nuevas fechas: ' end
         || p_dates;
$$;

insert into auth.users (id, email) values ('a0c50000-0000-4000-8000-000000000031', 'occurrence-change@test.local');
insert into partners (id, display_name) values ('a0c50000-0000-4000-8000-000000000001', 'Occurrence Change');
insert into establishments (id, partner_id, name) values
  ('a0c50000-0000-4000-8000-000000000011', 'a0c50000-0000-4000-8000-000000000001', jsonb_build_object('es', 'Occurrence Change'));

-- Evento : en ligne ou non, première date à J+start, tous les `freq` jours (NULL : une seule date),
-- cupo compté (metered) sauf informatif sans mode.
create function test_evento(p_n text, p_online boolean, p_start int, p_freq int, p_mode text default 'metered') returns void
language sql as $$
  insert into products (id, partner_id, establishment_id, type, name, slug, sellable, price_cop, online_bookable,
                        evento_capacity_mode, evento_payment_mode, default_capacity, evento_occupies_resource,
                        occurrence_type, occurrence_date, recurrence_frequency_days)
  values (pid(p_n), 'a0c50000-0000-4000-8000-000000000001', 'a0c50000-0000-4000-8000-000000000011', 'evento',
          jsonb_build_object('es', 'Evento ' || p_n), 'occ-change-' || p_n, true, 30000, p_online,
          p_mode, case when p_mode is not null then 'online' end, case when p_mode is not null then 10 end, false,
          case when p_freq is null then 'once' else 'recurring' end, public.today_in_bogota() + p_start, p_freq);
$$;
insert into orders (id, account_id, holder_name, holder_email) values
  ('a0c50000-0000-4000-8000-000000000041', 'a0c50000-0000-4000-8000-000000000031', 'Occurrence', 'occurrence-change@test.local');
-- Ligne vendue en ligne (direct) ou présence saisie à la main (operator_manual).
create function test_line(p_n text, p_offset int, p_status text default 'reserved', p_case text default 'direct') returns void
language sql as $$
  insert into order_lines (order_id, account_id, product_id, date, qty, status, holder_name,
    price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct, acompte_cop, referrer_commission_cop, app_commission_cop)
  values ('a0c50000-0000-4000-8000-000000000041', 'a0c50000-0000-4000-8000-000000000031', pid(p_n),
          public.today_in_bogota() + p_offset, 1, p_status, 'Occurrence', 30000, 30000, p_case,
          case when p_case = 'direct' then 0.17 else 0 end, 0, case when p_case = 'direct' then 0.17 else 0 end,
          case when p_case = 'direct' then 5100 else 0 end, 0, case when p_case = 'direct' then 5100 else 0 end);
$$;

-- 21 : hebdomadaire dès J+7, une réservation à J+14.
select test_evento('21', true, 7, 7);  select test_line('21', 14);
-- 22 : trois réservations, deux à J+14 et une à J+28.
select test_evento('22', true, 7, 7);  select test_line('22', 14); select test_line('22', 14); select test_line('22', 28);
-- 23 : onze réservations, une par semaine de J+14 à J+84.
select test_evento('23', true, 7, 7);  select test_line('23', 7 * g) from generate_series(2, 12) g;
-- 24 : une seule ligne, ANNULÉE.
select test_evento('24', true, 7, 7);  select test_line('24', 14, 'cancelled_by_client');
-- 25 : evento informatif, une présence manuelle à J+3.
select test_evento('25', false, 7, 7, null); select test_line('25', 3, 'reserved', 'operator_manual');
-- 26 : une seule date, PASSÉE (J-7), sa ligne toujours `reserved`.
select test_evento('26', true, -7, null); select test_line('26', -7);
-- 27 : une réservation à J+21, pour les fins de série.
select test_evento('27', true, 7, 7);  select test_line('27', 21);
-- 28 : hebdomadaire dès AUJOURD'HUI, une réservation aujourd'hui.
select test_evento('28', true, 0, 7);  select test_line('28', 0);
-- 29 : une réservation vendue en ligne à J+14 (contournement en deux enregistrements).
select test_evento('29', true, 7, 7);  select test_line('29', 14);
-- 30 : evento en ligne, une ligne manuelle à J+14.
select test_evento('30', true, 7, 7);  select test_line('30', 14, 'reserved', 'operator_manual');
-- 31 : une réservation déjà HORS date (J+10), comme laissée par un déplacement de ligne.
select test_evento('31', true, 7, 7);  select test_line('31', 10);
-- 32 : evento informatif à cupo compté, une présence manuelle à J+3 hors de ses dates.
select test_evento('32', false, 7, 7); select test_line('32', 3, 'reserved', 'operator_manual');

-- ── Refus : une réservation à venir sortirait des dates ─────────────────────
select is(test_update('21', 'recurrence_frequency_days = 14'), hf002(1, fr(14)),
  'tous les 14 jours au lieu de 7 : la réservation de J+14 sortirait → HF002, singulier, sa date');
select is((select recurrence_frequency_days from products where id = pid('21')), 7, 'refus : rien n''a changé');
select is(test_update('22', 'occurrence_type = ''once'', recurrence_frequency_days = null'), hf002(3, fr(14) || ', ' || fr(28)),
  'une seule date au lieu d''une série : trois réservations, chaque date citée une fois [mutation : sans distinct]');
select is(test_update('23', 'occurrence_date = public.today_in_bogota() + 8'),
  hf002(11, (select string_agg(fr(7 * g), ', ' order by g) from generate_series(2, 11) g) || ', …'),
  'onze dates hors série : dix citées, puis « … »');
update order_lines set status = 'cancelled_by_client' where product_id = pid('23') and date = public.today_in_bogota() + 84;
select is(test_update('23', 'occurrence_date = public.today_in_bogota() + 8'),
  hf002(10, (select string_agg(fr(7 * g), ', ' order by g) from generate_series(2, 11) g)),
  'exactement dix dates : toutes citées, sans « … » [mutation : > 10 devenu >= 10]');
select is(test_update('27', 'recurrence_end_date = public.today_in_bogota() + 14'), hf002(1, fr(21)),
  'série arrêtée à J+14 par une date de fin : J+21 sortirait [mutation : colonne retirée du trigger]');
select is(test_update('27', 'recurrence_end_count = 2'), hf002(1, fr(21)),
  'série arrêtée à deux occurrences : J+21 sortirait [mutation : colonne retirée du trigger]');
select is(test_update('28', 'occurrence_date = public.today_in_bogota() + 1'), hf002(1, fr(0)),
  'la réservation d''AUJOURD''HUI compte [mutation : >= devenu >]');
select is(test_update('30', 'recurrence_frequency_days = 14'), hf002(1, fr(14)),
  'evento en ligne : une ligne manuelle est tenue aussi [mutation : sans « evento en ligne »]');
select is(test_update('29', 'online_bookable = false'), 'ok',
  'décocher la vente en ligne, dates inchangées : accepté');
select is(test_update('29', 'recurrence_frequency_days = 14'), hf002(1, fr(14)),
  'puis changer la date : la ligne vendue en ligne reste tenue [mutation : sans origine de ligne]');
select is(test_update('32', 'online_bookable = true'), hf002(1, fr(3)),
  'activer la vente en ligne avec une présence hors date : refusé [mutation : sans activation]');

-- ── Acceptation ─────────────────────────────────────────────────────────────
select is(test_update('21', 'occurrence_date = public.today_in_bogota(), recurrence_end_count = 10'), 'ok',
  'série avancée d''une semaine, J+14 reste une occurrence → accepté');
select is((select occurrence_date from products where id = pid('21')), public.today_in_bogota(),
  'acceptation : la nouvelle date est écrite');
select is(test_update('21', 'recurrence_end_count = null, recurrence_end_date = public.today_in_bogota() + 14'), 'ok',
  'série arrêtée à J+14, qui en reste la dernière occurrence → accepté');
select is(
  test_update('31', 'name = jsonb_build_object(''es'', ''Evento 31 corregido''), occurrence_type = occurrence_type,
    occurrence_date = occurrence_date, recurrence_frequency_days = recurrence_frequency_days,
    recurrence_end_date = recurrence_end_date, recurrence_end_count = recurrence_end_count, online_bookable = online_bookable'),
  'ok', 'formulaire réenregistré, dates identiques : une ligne déjà hors date ne bloque rien [mutation : sans WHEN]');
select is(test_update('24', 'recurrence_frequency_days = 14'), 'ok', 'une ligne ANNULÉE ne retient pas l''ancienne série');
select is(test_update('26', 'occurrence_date = public.today_in_bogota() + 30'), 'ok',
  'une réservation PASSÉE (J-7, jamais marquée réalisée) ne bloque pas un changement d''avenir');
select is(
  test_update('25', 'occurrence_type = ''once'', occurrence_date = public.today_in_bogota() + 40, recurrence_frequency_days = null'),
  'ok', 'evento informatif : ses présences manuelles ne sont pas tenues à ses dates');

-- ── Les drapeaux de capacité restent gelés ──────────────────────────────────
select is(test_update('21', 'evento_capacity_mode = ''rsvp'''),
  'P0001 | capacity_flags_frozen_while_reserved | Ce produit porte des réservations en cours : lobby_category_id, evento_capacity_mode, evento_occupies_resource et pricing_unit ne peuvent pas changer tant qu''elles ne sont pas réalisées ou annulées. La date et la récurrence d''un evento relèvent de products_occurrence_change_guard.',
  'mode de cupo : toujours gelé tant qu''une ligne est réservée');
select is(test_update('22', 'evento_occupies_resource = true'),
  'P0001 | capacity_flags_frozen_while_reserved | Ce produit porte des réservations en cours : lobby_category_id, evento_capacity_mode, evento_occupies_resource et pricing_unit ne peuvent pas changer tant qu''elles ne sont pas réalisées ou annulées. La date et la récurrence d''un evento relèvent de products_occurrence_change_guard.',
  'occupation de la ressource : toujours gelée');

-- ── Triggers et verrous en place ────────────────────────────────────────────
select is(
  (select array_agg(t.tgname::text || ':' || a.attname::text order by t.tgname, a.attname)
     from pg_trigger t join pg_attribute a on a.attrelid = t.tgrelid and a.attnum = any(t.tgattr::smallint[])
    where t.tgrelid = 'public.products'::regclass
      and t.tgname in ('products_capacity_flags_frozen', 'products_occurrence_change_guard')),
  array['products_capacity_flags_frozen:evento_capacity_mode', 'products_capacity_flags_frozen:evento_occupies_resource',
        'products_capacity_flags_frozen:lobby_category_id',
        -- Spec 43 (20261025140000) : le mode de prix d'une activité est gelé de la même façon.
        'products_capacity_flags_frozen:pricing_unit',
        'products_occurrence_change_guard:occurrence_date', 'products_occurrence_change_guard:occurrence_type',
        'products_occurrence_change_guard:online_bookable', 'products_occurrence_change_guard:recurrence_end_count',
        'products_occurrence_change_guard:recurrence_end_date', 'products_occurrence_change_guard:recurrence_frequency_days'],
  'colonnes exactes des deux triggers : le gel des drapeaux (BEFORE), la garde d''occurrence (AFTER)');
select ok(
  (select bool_and(prosrc ~ 'for share') from pg_proc
    where proname in ('create_order', 'create_manual_order_line') and pronamespace = 'public'::regnamespace),
  'create_order et create_manual_order_line lisent les occurrences d''un evento sous verrou partagé');

select * from finish();
rollback;

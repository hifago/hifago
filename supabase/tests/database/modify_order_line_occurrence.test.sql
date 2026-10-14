-- modify_order_line ne déplace plus la ligne d'un evento hors de ses dates (migration 20261014211700,
-- suite de 20261014204354). Ligne tenue : toute ligne d'un evento vendu en ligne, toute ligne vendue
-- en ligne ; libre : présence manuelle d'un evento informatif. Refus `invalid_occurrence_date` rendu
-- avant toute écriture. Chaque cas tue une mutation précise (indiquée).
-- La course déplacement / changement de date :
-- tests/concurrency/modify_order_line_occurrence.concurrency.mjs.
begin;
select plan(9);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create function pid(p_n text) returns uuid language sql immutable as $$ select ('a0c70000-0000-4000-8000-0000000000' || p_n)::uuid $$;

insert into partners (id, display_name) values (pid('01'), 'Modify Occurrence');
insert into establishments (id, partner_id, name) values (pid('11'), pid('01'), jsonb_build_object('es', 'Modify Occurrence'));
insert into auth.users (id, email) values
  (pid('31'), 'modify-occurrence-admin@test.local'),
  (pid('32'), 'modify-occurrence-buyer@test.local');
insert into partner_capabilities (account_id, role, source, status) values (pid('31'), 'admin', 'migration', 'active');

-- Eventos hebdomadaires à partir du lundi 2029-06-04 (le 11 est une occurrence, les 5 et 6 non).
-- 21 et 24 : vendus en ligne, cupo compté ; 22 et 23 : informatifs.
insert into products (id, partner_id, establishment_id, type, name, slug, sellable, price_cop, online_bookable,
                      evento_capacity_mode, evento_payment_mode, default_capacity, evento_occupies_resource,
                      occurrence_type, occurrence_date, recurrence_frequency_days)
select pid(n), pid('01'), pid('11'), 'evento', jsonb_build_object('es', 'Evento ' || n), 'modify-occ-' || n, true, 30000,
       n in ('21', '24'), case when n in ('21', '24') then 'metered' end, case when n in ('21', '24') then 'online' end,
       case when n in ('21', '24') then 10 end, false, 'recurring', '2029-06-04', 7
  from unnest(array['21', '22', '23', '24']) n;
insert into product_availability (product_id, date, capacity, booked) values
  (pid('21'), '2029-06-04', 10, 1), (pid('24'), '2029-06-04', 10, 1), (pid('24'), '2029-06-05', 10, 1);

insert into orders (id, account_id, holder_name, holder_email) values
  (pid('41'), pid('32'), 'Holder Occurrence', 'modify-occurrence-buyer@test.local');
-- 51 : vendue en ligne, evento en ligne. 52 : présence manuelle, evento informatif.
-- 53 : vendue en ligne quand 23 l'était (il ne l'est plus). 54 : ligne manuelle, evento en ligne.
-- 55 : vendue en ligne, déjà HORS date (le 5), comme laissée avant ce contrôle.
insert into order_lines (
  id, order_id, account_id, product_id, date, qty, status, holder_name,
  price_cop, total_cop, commission_case, acompte_pct, referrer_pct, app_pct,
  acompte_cop, referrer_commission_cop, app_commission_cop
) values
  (pid('51'), pid('41'), pid('32'), pid('21'), '2029-06-04', 1, 'reserved', 'Holder', 30000, 30000, 'direct', 0, 0, 0, 0, 0, 0),
  (pid('52'), pid('41'), pid('32'), pid('22'), '2029-06-05', 1, 'reserved', 'Holder', 30000, 30000, 'operator_manual', 0, 0, 0, 0, 0, 0),
  (pid('53'), pid('41'), pid('32'), pid('23'), '2029-06-04', 1, 'reserved', 'Holder', 30000, 30000, 'direct', 0, 0, 0, 0, 0, 0),
  (pid('54'), pid('41'), pid('32'), pid('24'), '2029-06-04', 1, 'reserved', 'Holder', 30000, 30000, 'operator_manual', 0, 0, 0, 0, 0, 0),
  (pid('55'), pid('41'), pid('32'), pid('24'), '2029-06-05', 1, 'reserved', 'Holder', 30000, 30000, 'direct', 0, 0, 0, 0, 0, 0);

create temp table r (k text primary key, res jsonb);
grant select, insert on r to authenticated;

set local role authenticated;
select test_login(pid('31'));
insert into r values ('hors_date', modify_order_line(pid('51'), '2029-06-05', 1, 'Motivo'));
reset role;
select is((select res->>'reason' from r where k = 'hors_date'), 'invalid_occurrence_date',
  'evento en ligne : déplacer sa ligne hors occurrence → invalid_occurrence_date [mutation : sans contrôle]');
select is(
  (select jsonb_build_object(
     'ligne', (select status from order_lines where id = pid('51')),
     'lignes', (select count(*)::int from order_lines where product_id = pid('21')),
     'place', (select booked from product_availability where product_id = pid('21') and date = '2029-06-04'),
     'cupo_du_5', (select count(*)::int from product_availability where product_id = pid('21') and date = '2029-06-05'))),
  jsonb_build_object('ligne', 'reserved', 'lignes', 1, 'place', 1, 'cupo_du_5', 0),
  'refus avant toute écriture : ligne intacte, aucun remplacement, place tenue, aucun cupo matérialisé au 5');

set local role authenticated;
-- Un appel par instruction : chacun voit les écritures du précédent.
insert into r values ('occurrence', modify_order_line(pid('51'), '2029-06-11', 1, 'Motivo'));
insert into r values ('meme_date', modify_order_line(pid('55'), '2029-06-05', 2, 'Motivo'));
insert into r values ('informatif_manuelle', modify_order_line(pid('52'), '2029-06-06', 1, 'Motivo'));
insert into r values ('informatif_vendue', modify_order_line(pid('53'), '2029-06-06', 1, 'Motivo'));
insert into r values ('en_ligne_manuelle', modify_order_line(pid('54'), '2029-06-06', 1, 'Motivo'));
reset role;

select is((select res->>'ok' from r where k = 'occurrence'), 'true', 'vers une occurrence (le 11) : accepté');
select is(
  (select date from order_lines where id = (select (res->>'order_line_id')::uuid from r where k = 'occurrence')),
  '2029-06-11'::date, 'la ligne de remplacement est au 11');
select is((select res->>'ok' from r where k = 'meme_date'), 'true',
  'ligne tenue déjà hors date : changer sa seule quantité, à la même date, reste permis [mutation : contrôle sans « date changée »]');
select is((select res->>'ok' from r where k = 'informatif_manuelle'), 'true',
  'evento informatif : une présence manuelle se déplace librement');
select is((select res->>'reason' from r where k = 'informatif_vendue'), 'invalid_occurrence_date',
  'ligne vendue en ligne, evento devenu informatif : toujours tenue [mutation : sans origine de ligne]');
select is((select res->>'reason' from r where k = 'en_ligne_manuelle'), 'invalid_occurrence_date',
  'evento en ligne : une ligne manuelle est tenue aussi [mutation : sans « evento en ligne »]');
select ok(
  (select prosrc ~ 'select online_bookable into v_online_bookable\s+from public\.products where id = v_old_line\.product_id for share'
     from pg_proc where proname = 'modify_order_line' and pronamespace = 'public'::regnamespace),
  'modify_order_line lit les occurrences sous verrou partagé de l''evento');

select * from finish();
rollback;

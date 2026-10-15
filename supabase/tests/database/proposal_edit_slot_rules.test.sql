-- Horaires d'une activité proposables en ÉDITION par le partenaire (migration 20261015011812,
-- constat du 2026-10-14).
--
-- `slot_rules` traverse la whitelist de submit_product_proposal PUIS une écriture explicite à
-- l'approbation (moderate_product_proposal → replace_product_slot_rules). Un oubli dans l'une ou
-- l'autre jette les horaires EN SILENCE, entièrement côté Postgres.
--
-- Ce fichier prouve aussi :
--   * la FORME GARDÉE — une proposition sans la clé ne remplace aucun horaire ;
--   * un tableau VIDE, lui, les retire tous (demande explicite) ;
--   * la clé n'entre que pour une ACTIVITÉ ;
--   * une règle invalide fait échouer l'approbation entière, sans rien écrire.
begin;
select plan(12);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('5107a000-0000-4000-8000-000000000001', 'Horarios Test');

insert into establishments (id, partner_id, name) values
  ('5107a000-0000-4000-8000-000000000011', '5107a000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Hostal Horarios'));

insert into auth.users (id, email) values
  ('5107a000-0000-4000-8000-000000000021', 'horarios-socio@test.local'),
  ('5107a000-0000-4000-8000-000000000024', 'horarios-admin@test.local');

update partner_accounts set partner_id = '5107a000-0000-4000-8000-000000000001'
 where id = '5107a000-0000-4000-8000-000000000021';

insert into partner_capabilities (partner_id, role, source, status, establishment_id) values
  ('5107a000-0000-4000-8000-000000000001', 'operator', 'migration', 'active',
   '5107a000-0000-4000-8000-000000000011');
insert into partner_capabilities (account_id, role, source, status) values
  ('5107a000-0000-4000-8000-000000000024', 'admin', 'migration', 'active');

insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('5107a000-0000-4000-8000-000000000031', '5107a000-0000-4000-8000-000000000001',
   '5107a000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Caminata Horarios'), 50000, false, 'horarios-test-caminata'),
  ('5107a000-0000-4000-8000-000000000032', '5107a000-0000-4000-8000-000000000001',
   '5107a000-0000-4000-8000-000000000011', 'lodging',
   jsonb_build_object('es', 'Cabaña Horarios'), 120000, false, 'horarios-test-cabana');

-- État de départ : l'activité a un horaire, lundi 08:00-10:00, tours de 60 minutes, 6 places.
insert into product_slot_rules (product_id, weekdays, start_time, end_time, slot_duration_minutes, capacity) values
  ('5107a000-0000-4000-8000-000000000031', array[1]::smallint[], '08:00', '10:00', 60, 6);

-- Les horaires en place, lisibles d'un coup : « jours début-fin/durée×places », triés.
create function horarios() returns text language sql as $$
  select coalesce(string_agg(
           array_to_string(weekdays, ',') || ' ' || to_char(start_time, 'HH24:MI') || '-'
             || to_char(end_time, 'HH24:MI') || '/' || slot_duration_minutes || 'x' || capacity,
           '; ' order by start_time), '')
    from public.product_slot_rules where product_id = '5107a000-0000-4000-8000-000000000031';
$$;

create function nombre_activite() returns jsonb language sql as $$
  select jsonb_build_object('name', jsonb_build_object('es', 'Caminata Horarios'), 'price_cop', 50000);
$$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- A. Dépôt puis approbation : l'ensemble est REMPLACÉ
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('5107a000-0000-4000-8000-000000000021');
create temp table tmp_a as
  select (submit_product_proposal(
    '5107a000-0000-4000-8000-000000000031'::uuid,
    nombre_activite() || jsonb_build_object('slot_rules', jsonb_build_array(
      jsonb_build_object('weekdays', jsonb_build_array(6, 7), 'start_time', '14:00', 'end_time', '16:00',
                         'slot_duration_minutes', 30, 'capacity', 4),
      jsonb_build_object('weekdays', jsonb_build_array(1, 2, 3), 'start_time', '09:00', 'end_time', '12:00',
                         'slot_duration_minutes', 60, 'capacity', 8)
    ))
  )->>'proposal_id')::uuid as id;

select is(
  (select jsonb_array_length(payload -> 'slot_rules') from product_proposals where id = (select id from tmp_a)),
  2, 'dépôt : les horaires d''une activité traversent la whitelist');

select is(horarios(), '1 08:00-10:00/60x6', 'dépôt : rien n''est écrit avant l''approbation');

select test_login('5107a000-0000-4000-8000-000000000024');
select is(
  (select moderate_product_proposal((select id from tmp_a), 'approve', 1)->>'ok'),
  'true', 'approbation : réussit');

select is(horarios(), '1,2,3 09:00-12:00/60x8; 6,7 14:00-16:00/30x4',
  'approbation : l''horaire d''origine est retiré, les deux proposés sont posés');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- B. Forme gardée : sans la clé, rien ne bouge
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('5107a000-0000-4000-8000-000000000021');
create temp table tmp_b as
  select (submit_product_proposal('5107a000-0000-4000-8000-000000000031'::uuid, nombre_activite())
          ->>'proposal_id')::uuid as id;

select is(
  (select payload ? 'slot_rules' from product_proposals where id = (select id from tmp_b)),
  false, 'forme gardée, dépôt : la clé n''entre pas dans le payload (ni même à null)');

select test_login('5107a000-0000-4000-8000-000000000024');
select is(
  (select moderate_product_proposal((select id from tmp_b), 'approve', 1)->>'ok'),
  'true', 'forme gardée : l''approbation réussit');
select is(horarios(), '1,2,3 09:00-12:00/60x8; 6,7 14:00-16:00/30x4',
  'forme gardée : une simple correction de nom ne touche à AUCUN horaire');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- C. Réservé aux activités
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('5107a000-0000-4000-8000-000000000021');
create temp table tmp_c as
  select (submit_product_proposal(
    '5107a000-0000-4000-8000-000000000032'::uuid,
    jsonb_build_object('name', jsonb_build_object('es', 'Cabaña Horarios'), 'price_cop', 120000,
                       'slot_rules', jsonb_build_array(
                         jsonb_build_object('weekdays', jsonb_build_array(1), 'start_time', '09:00',
                                            'end_time', '10:00', 'slot_duration_minutes', 60, 'capacity', 1)))
  )->>'proposal_id')::uuid as id;

select is(
  (select payload ? 'slot_rules' from product_proposals where id = (select id from tmp_c)),
  false, 'un logement : la clé est écartée au dépôt');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- D. Une règle invalide fait échouer l'approbation ENTIÈRE
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
create temp table tmp_d as
  select (submit_product_proposal(
    '5107a000-0000-4000-8000-000000000031'::uuid,
    jsonb_build_object('name', jsonb_build_object('es', 'Caminata Renombrada'), 'price_cop', 50000,
                       'slot_rules', jsonb_build_array(
                         jsonb_build_object('weekdays', jsonb_build_array(4), 'start_time', '18:00',
                                            'end_time', '17:00', 'slot_duration_minutes', 30, 'capacity', 2)))
  )->>'proposal_id')::uuid as id;

select test_login('5107a000-0000-4000-8000-000000000024');
select throws_ok(
  format('select moderate_product_proposal(%L::uuid, ''approve'', 1)', (select id from tmp_d)),
  '23514', null,
  'règle invalide (fin avant début) : l''approbation lève sur product_slot_rules_time_order');

select is(
  (select concat_ws(' | ', p.status, pr.name ->> 'es', horarios())
     from product_proposals p join products pr on pr.id = p.product_id
    where p.id = (select id from tmp_d)),
  'pending | Caminata Horarios | 1,2,3 09:00-12:00/60x8; 6,7 14:00-16:00/30x4',
  'règle invalide : la proposition reste en attente, ni le nom ni les horaires ne sont écrits');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- E. Un tableau VIDE retire tous les horaires (demande explicite, pas une absence)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('5107a000-0000-4000-8000-000000000021');
create temp table tmp_e as
  select (submit_product_proposal(
    '5107a000-0000-4000-8000-000000000031'::uuid,
    nombre_activite() || jsonb_build_object('slot_rules', '[]'::jsonb)
  )->>'proposal_id')::uuid as id;

select test_login('5107a000-0000-4000-8000-000000000024');
select is(
  (select moderate_product_proposal((select id from tmp_e), 'approve', 1)->>'ok'),
  'true', 'tableau vide : l''approbation réussit');
select is(horarios(), '', 'tableau vide : tous les horaires sont retirés');

select * from finish();
rollback;

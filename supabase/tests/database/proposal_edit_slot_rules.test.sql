-- Horaires d'une activité : obligatoires à la création, proposables en édition par le partenaire
-- (migration 20261104120000, demande Jérôme du 2026-11-04).
--
-- `slot_rules` traverse une relecture (public.proposal_slot_rules), une whitelist
-- (submit_product_proposal) PUIS un remplacement explicite à l'approbation
-- (moderate_product_proposal). Un oubli dans l'une des trois jette la valeur EN SILENCE, entièrement
-- côté Postgres : aucun test TypeScript ne peut le voir (même classe de panne que
-- proposal_edit_tags.test.sql).
--
-- Ce fichier prouve aussi :
--   * la FORME GARDÉE — une proposition sans la clé ne touche à aucun horaire ;
--   * un tableau VIDE ou une règle illisible est refusé au dépôt, jamais à l'approbation ;
--   * une correction admin illisible est refusée AVANT toute écriture (horaires intacts) ;
--   * passer en « por hora » avec de nouveaux horaires d'une heure, dans la même proposition, réussit
--     (les anciens horaires de 90 minutes sont retirés avant la mise à jour du produit) ;
--   * une création d'activité sans horaire est refusée, au dépôt comme à l'approbation.
begin;
select plan(27);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('7b110000-0000-4000-8000-000000000001', 'Horarios Test');

insert into establishments (id, partner_id, name) values
  ('7b110000-0000-4000-8000-000000000011', '7b110000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Hostal Horarios'));

insert into auth.users (id, email) values
  ('7b110000-0000-4000-8000-000000000021', 'horarios-socio@test.local'),
  ('7b110000-0000-4000-8000-000000000024', 'horarios-admin@test.local');

update partner_accounts set partner_id = '7b110000-0000-4000-8000-000000000001'
 where id = '7b110000-0000-4000-8000-000000000021';

insert into partner_capabilities (partner_id, role, source, status) values
  ('7b110000-0000-4000-8000-000000000001', 'referrer', 'migration', 'active');
insert into partner_capabilities (partner_id, role, source, status, establishment_id) values
  ('7b110000-0000-4000-8000-000000000001', 'operator', 'migration', 'active',
   '7b110000-0000-4000-8000-000000000011');
insert into partner_capabilities (account_id, role, source, status) values
  ('7b110000-0000-4000-8000-000000000024', 'admin', 'migration', 'active');

insert into products (id, partner_id, establishment_id, type, name, price_cop, sellable, slug) values
  ('7b110000-0000-4000-8000-000000000031', '7b110000-0000-4000-8000-000000000001',
   '7b110000-0000-4000-8000-000000000011', 'activity',
   jsonb_build_object('es', 'Kayak Horarios'), 50000, false, 'horarios-test-kayak');

-- État de départ : lundi 09:00-12:00, tours de 90 minutes, 4 places.
insert into product_slot_rules (product_id, weekdays, start_time, end_time, slot_duration_minutes, capacity)
values ('7b110000-0000-4000-8000-000000000031', array[1]::smallint[], '09:00', '12:00', 90, 4);

-- Les horaires de la fiche, en une chaîne lisible : une seule lecture pour toutes les assertions.
create function horarios_ficha(p_product_id uuid default '7b110000-0000-4000-8000-000000000031')
returns text language sql as $$
  select coalesce(string_agg(
    array_to_string(weekdays, '-') || ' ' || to_char(start_time, 'HH24:MI') || '-' ||
    to_char(end_time, 'HH24:MI') || '/' || slot_duration_minutes || 'x' || capacity,
    ', ' order by start_time), '')
    from public.product_slot_rules where product_id = p_product_id;
$$;

create function regla(p_weekdays jsonb, p_start text, p_end text, p_duration int, p_capacity int)
returns jsonb language sql as $$
  select jsonb_build_object('weekdays', p_weekdays, 'start_time', p_start, 'end_time', p_end,
                            'slot_duration_minutes', p_duration, 'capacity', p_capacity);
$$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- A. proposal_slot_rules — relecture règle par règle
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select is(
  public.proposal_slot_rules(jsonb_build_array(
    regla('[3, 1, 3]', '09:00', '12:00', 60, 4) || jsonb_build_object('intrus', 'x'))),
  jsonb_build_array(jsonb_build_object('weekdays', jsonb_build_array(1, 3), 'start_time', '09:00:00',
    'end_time', '12:00:00', 'slot_duration_minutes', 60, 'capacity', 4)),
  'relecture : jours triés et dédoublonnés, heures normalisées, clé inconnue écartée');

select is(public.proposal_slot_rules(jsonb_build_array(regla('[1]', '25:00', '26:00', 60, 4))), null,
  'relecture : une heure impossible rend NULL, jamais une erreur de cast');
select is(public.proposal_slot_rules(jsonb_build_array(regla('[8]', '09:00', '12:00', 60, 4))), null,
  'relecture : un jour hors 1-7 est refusé');
select is(public.proposal_slot_rules(jsonb_build_array(regla('[]', '09:00', '12:00', 60, 4))), null,
  'relecture : une règle sans jour est refusée');
select is(public.proposal_slot_rules(jsonb_build_array(regla('[1]', '12:00', '09:00', 60, 4))), null,
  'relecture : une fin avant le début est refusée');
select is(public.proposal_slot_rules(jsonb_build_array(regla('[1]', '09:00', '12:00', 60, 0))), null,
  'relecture : une capacité nulle est refusée');
select is(public.proposal_slot_rules('{"a": 1}'::jsonb), null,
  'relecture : autre chose qu''un tableau est refusé');
select is(
  public.proposal_slot_rules((select jsonb_agg(regla('[1]', '09:00', '10:00', 60, 1)) from generate_series(1, 51))),
  null, 'relecture : plus de 50 règles est refusé');
select ok(not has_function_privilege('authenticated', 'public.proposal_slot_rules(jsonb)', 'EXECUTE'),
  'proposal_slot_rules n''est appelable par aucun rôle d''API');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- B. ÉDITION — dépôt : la clé entre, relue ; rien n'est écrit avant l'approbation
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('7b110000-0000-4000-8000-000000000021');
create temp table tmp_b as
  select (submit_product_proposal(
    '7b110000-0000-4000-8000-000000000031'::uuid,
    jsonb_build_object('name', jsonb_build_object('es', 'Kayak Horarios'), 'price_cop', 50000,
      'slot_rules', jsonb_build_array(regla('[2, 4]', '14:00', '17:00', 60, 6),
                                      regla('[6]', '08:00', '10:00', 120, 2)))
  )->>'proposal_id')::uuid as id;

select is(
  (select jsonb_array_length(payload -> 'slot_rules') from product_proposals where id = (select id from tmp_b)),
  2, 'édition, dépôt : slot_rules traverse la whitelist');
select is(horarios_ficha(), '1 09:00-12:00/90x4', 'édition, dépôt : rien n''est écrit avant l''approbation');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- C. ÉDITION — approbation : les horaires sont REMPLACÉS
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('7b110000-0000-4000-8000-000000000024');
select is((select moderate_product_proposal((select id from tmp_b), 'approve', 1)->>'ok'), 'true',
  'édition : l''approbation réussit');
select is(horarios_ficha(), '6 08:00-10:00/120x2, 2-4 14:00-17:00/60x6',
  'édition, approbation : l''ancien horaire est retiré, les deux proposés posés');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- D. ÉDITION — forme gardée : sans la clé, rien ne bouge
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('7b110000-0000-4000-8000-000000000021');
create temp table tmp_d as
  select (submit_product_proposal(
    '7b110000-0000-4000-8000-000000000031'::uuid,
    jsonb_build_object('name', jsonb_build_object('es', 'Solo cambio de nombre'), 'price_cop', 50000)
  )->>'proposal_id')::uuid as id;

select is((select payload ? 'slot_rules' from product_proposals where id = (select id from tmp_d)), false,
  'édition, dépôt sans slot_rules : la clé n''entre PAS dans le payload');

select test_login('7b110000-0000-4000-8000-000000000024');
select moderate_product_proposal((select id from tmp_d), 'approve', 1);
select is(horarios_ficha(), '6 08:00-10:00/120x2, 2-4 14:00-17:00/60x6',
  'édition, forme gardée : une simple correction de nom ne touche à aucun horaire');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- E. ÉDITION — refus au dépôt
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('7b110000-0000-4000-8000-000000000021');
select is(
  (select submit_product_proposal('7b110000-0000-4000-8000-000000000031'::uuid,
     jsonb_build_object('name', jsonb_build_object('es', 'Kayak Horarios'), 'slot_rules', '[]'::jsonb))->>'reason'),
  'slot_rules_required', 'édition : un tableau vide est refusé (une activité garde au moins un horaire)');
select is(
  (select submit_product_proposal('7b110000-0000-4000-8000-000000000031'::uuid,
     jsonb_build_object('name', jsonb_build_object('es', 'Kayak Horarios'),
       'slot_rules', jsonb_build_array(jsonb_build_object('weekdays', jsonb_build_array(1),
         'start_time', '09:00', 'end_time', '12:00', 'slot_duration_minutes', 'dos', 'capacity', 4))))->>'reason'),
  'invalid_slot_rules', 'édition : une règle illisible est refusée au dépôt');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- F. ÉDITION — une correction admin illisible est refusée AVANT toute écriture
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
create temp table tmp_f as
  select (submit_product_proposal(
    '7b110000-0000-4000-8000-000000000031'::uuid,
    jsonb_build_object('name', jsonb_build_object('es', 'Kayak Horarios'), 'price_cop', 50000,
      'slot_rules', jsonb_build_array(regla('[5]', '10:00', '11:00', 60, 3)))
  )->>'proposal_id')::uuid as id;

select test_login('7b110000-0000-4000-8000-000000000024');
select is(
  (select moderate_product_proposal((select id from tmp_f), 'approve', 1,
     jsonb_build_object('name', jsonb_build_object('es', 'Kayak Horarios'), 'price_cop', 50000,
       'slot_rules', jsonb_build_array(regla('[5]', '11:00', '10:00', 60, 3))))->>'reason'),
  'invalid_slot_rules', 'édition : une correction admin illisible est refusée');
select is(horarios_ficha(), '6 08:00-10:00/120x2, 2-4 14:00-17:00/60x6',
  'édition : après ce refus, les horaires en place sont intacts');
select is((select status from product_proposals where id = (select id from tmp_f)), 'pending',
  'édition : après ce refus, la proposition reste en attente');
-- Nettoyage : rejeter pour ne pas encombrer la suite.
select moderate_product_proposal((select id from tmp_f), 'reject', 1, null, 'test');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- G. ÉDITION — passer en « por hora » avec des horaires d'une heure, dans la même proposition
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('7b110000-0000-4000-8000-000000000021');
create temp table tmp_g as
  select (submit_product_proposal(
    '7b110000-0000-4000-8000-000000000031'::uuid,
    jsonb_build_object('name', jsonb_build_object('es', 'Kayak Horarios'), 'price_cop', 80000,
      'pricing_unit', 'per_hour',
      'slot_rules', jsonb_build_array(regla('[1, 2, 3, 4, 5]', '08:00', '12:00', 60, 2)))
  )->>'proposal_id')::uuid as id;

select test_login('7b110000-0000-4000-8000-000000000024');
select is((select moderate_product_proposal((select id from tmp_g), 'approve', 1)->>'ok'), 'true',
  'por hora : l''approbation réussit alors qu''un ancien horaire durait 120 minutes');
select is((select pricing_unit from products where id = '7b110000-0000-4000-8000-000000000031'), 'per_hour',
  'por hora : le mode est posé');
select is(horarios_ficha(), '1-2-3-4-5 08:00-12:00/60x2', 'por hora : seuls les horaires d''une heure restent');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════
-- H. CRÉATION — une activité sans horaire est refusée, au dépôt comme à l'approbation
-- ═══════════════════════════════════════════════════════════════════════════════════════════════
select test_login('7b110000-0000-4000-8000-000000000021');
select is(
  (select submit_product_creation_proposal('7b110000-0000-4000-8000-000000000011'::uuid, 'activity',
     jsonb_build_object('name', jsonb_build_object('es', 'Sin horario'), 'price_cop', 50000))->>'reason'),
  'slot_rules_required', 'création : une activité sans horaire est refusée au dépôt');

create temp table tmp_h as
  select (submit_product_creation_proposal('7b110000-0000-4000-8000-000000000011'::uuid, 'activity',
    jsonb_build_object('name', jsonb_build_object('es', 'Paddle Horarios'), 'price_cop', 50000,
      'slot_rules', jsonb_build_array(regla('[7]', '07:00', '09:00', 60, 5))))->>'proposal_id')::uuid as id;

select test_login('7b110000-0000-4000-8000-000000000024');
select is(
  (select moderate_product_proposal((select id from tmp_h), 'approve', 1,
     jsonb_build_object('name', jsonb_build_object('es', 'Paddle Horarios'), 'price_cop', 50000))->>'reason'),
  'slot_rules_required', 'création : une correction admin qui retire les horaires est refusée');

select is((select moderate_product_proposal((select id from tmp_h), 'approve', 1)->>'ok'), 'true',
  'création : l''approbation avec ses horaires réussit');
select is(
  horarios_ficha((select product_id from product_proposals where id = (select id from tmp_h))),
  '7 07:00-09:00/60x5', 'création : l''activité naît avec son horaire');

select * from finish();
rollback;

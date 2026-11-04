-- Programme d'un camp (spec 37) — migrations 20260916130000 (colonne + 2 CHECK) et 20260916140000
-- (parité proposition socio sur les 4 RPC). Ce fichier couvre les deux règles que rien d'autre ne
-- vérifie, et dont l'histoire du dépôt montre qu'elles se cassent en silence :
--   - le littéral JSON `null` (`p_payload -> 'program'` sur {"program": null}) doit être normalisé
--     en SQL NULL AVANT le CHECK products_program_is_array, sinon toute création de camp sans
--     programme part en 23514 (précédent price_tiers : 20260818240000, « 11 produits » pollués) ;
--   - une proposition d'édition qui NE PORTE PAS la clé program ne doit jamais effacer le
--     programme déjà posé sur le produit (garde `? 'program'`).
begin;
select plan(14);

-- Les retours des RPC atterrissent ici plutôt que d'être ré-imbriqués dans chaque assertion :
-- `select is((select (fn(...)) ->> 'k'), ...)` est illisible et se casse à une parenthèse près.
create temporary table rpc_res (k text primary key, v jsonb);
-- Les appels RPC se font sous `set local role authenticated` : sans ce grant, l'insertion
-- échoue en « permission denied for table rpc_res » — la table appartient à postgres.
grant select, insert on rpc_res to authenticated;

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name) values
  ('77770000-0000-4000-8000-000000000001', 'Program Test Partner');

insert into establishments (id, partner_id, name) values
  ('77770000-0000-4000-8000-000000000011', '77770000-0000-4000-8000-000000000001',
   jsonb_build_object('es', 'Establecimiento Program'));

insert into auth.users (id, email) values
  ('77770000-0000-4000-8000-000000000021', 'program-socio@test.local'),
  ('77770000-0000-4000-8000-000000000024', 'program-admin@test.local');

update partner_accounts set partner_id = '77770000-0000-4000-8000-000000000001'
 where id = '77770000-0000-4000-8000-000000000021';

insert into partner_capabilities (partner_id, role, source, status) values
  ('77770000-0000-4000-8000-000000000001', 'referrer', 'migration', 'active');
insert into partner_capabilities (partner_id, role, source, status, establishment_id) values
  ('77770000-0000-4000-8000-000000000001', 'operator', 'migration', 'active',
   '77770000-0000-4000-8000-000000000011');
insert into partner_capabilities (account_id, role, source, status) values
  ('77770000-0000-4000-8000-000000000024', 'admin', 'migration', 'active');

-- Un camp et une activité déjà publiés, pour les CHECK et le chemin d'édition.
insert into products (id, partner_id, establishment_id, type, name, slug, price_cop, duration_days) values
  ('77770000-0000-4000-8000-000000000031', '77770000-0000-4000-8000-000000000001',
   '77770000-0000-4000-8000-000000000011', 'camp', jsonb_build_object('es', 'Camp Program'),
   'camp-program-test', 500000, 3);
insert into products (id, partner_id, establishment_id, type, name, slug, price_cop) values
  ('77770000-0000-4000-8000-000000000032', '77770000-0000-4000-8000-000000000001',
   '77770000-0000-4000-8000-000000000011', 'activity', jsonb_build_object('es', 'Actividad Program'),
   'actividad-program-test', 90000);

-- ————————————————————————————————————————————————————————— 1. les deux CHECK de la colonne

select throws_ok(
  $$update products set program = '[{"day":1,"text":{"es":"x"}}]'::jsonb
     where id = '77770000-0000-4000-8000-000000000032'$$,
  '23514',
  null,
  'products_program_camp_only : un programme sur une activité est refusé en base, pas seulement dans l''UI'
);

select throws_ok(
  $$update products set program = '"no soy un arreglo"'::jsonb
     where id = '77770000-0000-4000-8000-000000000031'$$,
  '23514',
  null,
  'products_program_is_array : une valeur jsonb non-tableau est refusée'
);

select lives_ok(
  $$update products set program = '[{"day":1,"text":{"es":"Recogida","en":"Pickup"}},
                                    {"day":1,"text":{"es":"Fogata"}},
                                    {"day":2,"text":{"es":"Lancha"}}]'::jsonb
     where id = '77770000-0000-4000-8000-000000000031'$$,
  'un programme valide s''écrit sur un camp — plusieurs entrées portant le même day comprises'
);

select is(
  (select count(*)::int from products p, jsonb_array_elements(p.program) e
    where p.id = '77770000-0000-4000-8000-000000000031' and (e ->> 'day')::int = 1),
  2,
  'plusieurs lignes le même jour sont conservées telles quelles (le cas normal, pas une anomalie)'
);

select is(
  (select p.program -> 0 -> 'text' ->> 'es' from products p
    where p.id = '77770000-0000-4000-8000-000000000031'),
  'Recogida',
  'l''ordre du tableau est préservé : c''est lui qui fait foi pour l''affichage'
);

set local role authenticated;

-- ————————————————————————————————————— 2. whitelist de la proposition de CRÉATION (camp)

select test_login('77770000-0000-4000-8000-000000000021');

insert into rpc_res
select 'crea_camp', public.submit_product_creation_proposal(
  '77770000-0000-4000-8000-000000000011', 'camp',
  jsonb_build_object('name', jsonb_build_object('es', 'Camp propuesto'),
                     'price_cop', 400000, 'duration_days', 2,
                     'program', jsonb_build_array(
                       jsonb_build_object('day', 1, 'text', jsonb_build_object('es', 'Llegada')))));

select is(
  (select v ->> 'ok' from rpc_res where k = 'crea_camp'),
  'true',
  'un socio peut proposer la création d''un camp avec son programme'
);

select is(
  (select payload -> 'program' -> 0 -> 'text' ->> 'es' from product_proposals
    where kind = 'create' and payload -> 'name' ->> 'es' = 'Camp propuesto'),
  'Llegada',
  'la clé program survit à la whitelist par type (sans elle, elle serait silencieusement jetée)'
);

insert into rpc_res
select 'crea_act', public.submit_product_creation_proposal(
  '77770000-0000-4000-8000-000000000011', 'activity',
  jsonb_build_object('name', jsonb_build_object('es', 'Actividad propuesta'), 'price_cop', 50000,
                     'program', jsonb_build_array(
                       jsonb_build_object('day', 1, 'text', jsonb_build_object('es', 'No deberia pasar'))),
                     'slot_rules', jsonb_build_array(jsonb_build_object('weekdays', jsonb_build_array(1), 'start_time', '09:00', 'end_time', '10:00', 'slot_duration_minutes', 60, 'capacity', 1))));

select is(
  (select v ->> 'ok' from rpc_res where k = 'crea_act'),
  'true',
  'une proposition d''activité portant un programme est acceptée…'
);

select ok(
  (select not (payload ? 'program') from product_proposals
    where kind = 'create' and payload -> 'name' ->> 'es' = 'Actividad propuesta'),
  '…mais la clé y est jetée : le programme reste réservé au camp jusque dans la whitelist'
);

insert into rpc_res
select 'cap', public.submit_product_creation_proposal(
  '77770000-0000-4000-8000-000000000011', 'camp',
  jsonb_build_object('name', jsonb_build_object('es', 'Camp abusivo'), 'price_cop', 400000,
                     'duration_days', 2, 'program', abuso.lignes))
from (
  select jsonb_agg(jsonb_build_object('day', 1, 'text', jsonb_build_object('es', 'x'))) as lignes
    from generate_series(1, 201)
) abuso;

select is(
  (select v ->> 'reason' from rpc_res where k = 'cap'),
  'program_cap_exceeded',
  'plafond serveur : product_proposals.payload n''a aucune limite de taille propre'
);

reset role;

-- ——————————————— 3. approbation d'une création : le piège du littéral JSON `null`

select test_login('77770000-0000-4000-8000-000000000024');
set local role authenticated;

-- LE test anti-régression : sans la normalisation de create_product_from_proposal, ce payload
-- ({"program": null}, exactement ce qu'émet buildProductCreationPayload pour un camp sans
-- programme, et ce qu'écrit seed-mock-data.mjs avec `item.program ?? null`) produirait le littéral
-- JSON `null`, que products_program_is_array rejetterait en 23514.
select lives_ok(
  $$select public.moderate_product_proposal(
      (select id from product_proposals where kind = 'create' and status = 'pending'
        and payload -> 'name' ->> 'es' = 'Camp propuesto'),
      'approve',
      (select version from product_proposals where kind = 'create' and status = 'pending'
        and payload -> 'name' ->> 'es' = 'Camp propuesto'),
      jsonb_build_object('name', jsonb_build_object('es', 'Camp aprobado'),
                         'price_cop', 400000, 'duration_days', 2, 'program', null))$$,
  'un camp SANS programme s''approuve sans violer le CHECK (littéral JSON null normalisé)'
);

select is(
  (select program from products where slug like 'camp-aprobado%' limit 1),
  null,
  'et il atterrit en SQL NULL, jamais en littéral JSON null — la garantie que price_tiers n''a jamais eue'
);

reset role;

-- ————————————————— 4. édition : la garde `? 'program'` et le remplacement

-- ⚠️ Ce que ce test a révélé, et qui n'est PAS évident : la whitelist de submit_product_proposal
-- construit `jsonb_build_object('program', p_payload -> 'program')`, donc pour un camp la clé est
-- TOUJOURS présente dans le payload stocké — à null si le client ne l'a pas envoyée. La garde
-- `v_final_payload ? 'program'` ne protège donc QUE les propositions créées AVANT la migration
-- 20260916140000 (payload stocké sans la clé). Conséquence directe côté app : buildProductEditPayload
-- DOIT émettre program pour un camp, sinon chaque édition socio approuvée efface le programme.
-- C'est exactement le défaut que porte aujourd'hui group_discount_* (whitelisté en SQL depuis le
-- 20260914140000, jamais émis par buildProductEditPayload) — cf. docs/backlog.md.

set local role authenticated;
select test_login('77770000-0000-4000-8000-000000000021');
insert into rpc_res
select 'edit_sans', public.submit_product_proposal(
  '77770000-0000-4000-8000-000000000031',
  jsonb_build_object('name', jsonb_build_object('es', 'Camp Program'), 'price_cop', 500000));
reset role;

-- Ramène la proposition à la forme qu'elle aurait si elle avait été déposée AVANT cette migration :
-- payload sans la clé. C'est le seul cas que la garde protège, donc le seul qui mérite un test.
update product_proposals set payload = payload - 'program'
 where kind = 'content' and status = 'pending' and product_id = '77770000-0000-4000-8000-000000000031';

select test_login('77770000-0000-4000-8000-000000000024');
set local role authenticated;
insert into rpc_res
select 'mod_sans', public.moderate_product_proposal(
  (select id from product_proposals where kind = 'content' and status = 'pending'
    and product_id = '77770000-0000-4000-8000-000000000031'),
  'approve',
  (select version from product_proposals where kind = 'content' and status = 'pending'
    and product_id = '77770000-0000-4000-8000-000000000031'));
reset role;

select is(
  (select jsonb_array_length(program) from products
    where id = '77770000-0000-4000-8000-000000000031'),
  3,
  'une proposition d''édition SANS la clé program (déposée avant la migration) n''efface pas le programme déjà posé'
);

-- Et le chemin nominal : une proposition QUI porte un programme le remplace bien.
set local role authenticated;
select test_login('77770000-0000-4000-8000-000000000021');
insert into rpc_res
select 'edit_avec', public.submit_product_proposal(
  '77770000-0000-4000-8000-000000000031',
  jsonb_build_object('name', jsonb_build_object('es', 'Camp Program'), 'price_cop', 500000,
                     'program', jsonb_build_array(
                       jsonb_build_object('day', 1, 'text', jsonb_build_object('es', 'Nuevo plan')))));
reset role;

select test_login('77770000-0000-4000-8000-000000000024');
set local role authenticated;
insert into rpc_res
select 'mod_avec', public.moderate_product_proposal(
  (select id from product_proposals where kind = 'content' and status = 'pending'
    and product_id = '77770000-0000-4000-8000-000000000031'),
  'approve',
  (select version from product_proposals where kind = 'content' and status = 'pending'
    and product_id = '77770000-0000-4000-8000-000000000031'));
reset role;

select is(
  (select program -> 0 -> 'text' ->> 'es' from products
    where id = '77770000-0000-4000-8000-000000000031'),
  'Nuevo plan',
  'une proposition d''édition qui porte un programme le remplace à l''approbation'
);

select * from finish();
rollback;

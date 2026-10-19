-- Migration 20261019120000 — un partenaire propose ses activités pendant que son établissement
-- attend la revue ; l'admin modère l'établissement et chaque activité séparément.
--   - soumission sur une proposition d'établissement en attente (gardes : propriété, statut,
--     capacité, exactement une cible) ;
--   - approbation de l'activité refusée tant que l'établissement attend (establishment_pending) ;
--   - approbation de l'établissement : activités rattachées, toujours en attente ;
--   - refus de l'établissement : activités refusées avec lui (arbitrage Jérôme, 2026-10-19) ;
--   - retrait de l'établissement : activités retirées avec lui ;
--   - une activité refusée seule n'est jamais rattachée ni ressuscitée ensuite.
begin;
select plan(31);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Fixtures : "nuevo" (capacité operator active, aucun établissement — le cas d'un partenaire qui
-- vient de s'inscrire), "otro" (un tiers), "suspendido" (capacité operator suspendue), un admin.
insert into partners (id, display_name) values
  ('8a1e0000-0000-4000-8000-000000000001', 'Pendiente Nuevo'),
  ('8a1e0000-0000-4000-8000-000000000002', 'Pendiente Otro'),
  ('8a1e0000-0000-4000-8000-000000000003', 'Pendiente Suspendido');

insert into auth.users (id, email) values
  ('8a1e0000-0000-4000-8000-000000000021', 'pendiente-nuevo@test.local'),
  ('8a1e0000-0000-4000-8000-000000000022', 'pendiente-otro@test.local'),
  ('8a1e0000-0000-4000-8000-000000000023', 'pendiente-suspendido@test.local'),
  ('8a1e0000-0000-4000-8000-000000000024', 'pendiente-admin@test.local');

update partner_accounts set partner_id = '8a1e0000-0000-4000-8000-000000000001'
 where id = '8a1e0000-0000-4000-8000-000000000021';
update partner_accounts set partner_id = '8a1e0000-0000-4000-8000-000000000002'
 where id = '8a1e0000-0000-4000-8000-000000000022';
update partner_accounts set partner_id = '8a1e0000-0000-4000-8000-000000000003'
 where id = '8a1e0000-0000-4000-8000-000000000023';

insert into partner_capabilities (partner_id, role, source, status) values
  ('8a1e0000-0000-4000-8000-000000000001', 'referrer', 'migration', 'active'),
  ('8a1e0000-0000-4000-8000-000000000002', 'referrer', 'migration', 'active'),
  ('8a1e0000-0000-4000-8000-000000000003', 'referrer', 'migration', 'active');
insert into partner_capabilities (partner_id, role, source, status) values
  ('8a1e0000-0000-4000-8000-000000000001', 'operator', 'migration', 'active'),
  ('8a1e0000-0000-4000-8000-000000000002', 'operator', 'migration', 'active'),
  ('8a1e0000-0000-4000-8000-000000000003', 'operator', 'migration', 'suspended');
insert into partner_capabilities (account_id, role, source, status) values
  ('8a1e0000-0000-4000-8000-000000000024', 'admin', 'migration', 'active');

create temp table ids (cle text primary key, id uuid);
grant all on ids to authenticated;

create function propose_establishment(p_cle text, p_nombre text) returns void language sql as $$
  insert into ids values (p_cle,
    (select (submit_establishment_creation_proposal(
       jsonb_build_object('name', jsonb_build_object('es', p_nombre))) ->> 'proposal_id')::uuid));
$$;
create function propose_activity(p_cle text, p_establishment_proposal text, p_nombre text) returns jsonb
language plpgsql as $$
declare v_result jsonb;
begin
  v_result := submit_product_creation_proposal(
    p_type => 'activity',
    p_payload => jsonb_build_object('name', jsonb_build_object('es', p_nombre), 'price_cop', 20000),
    p_establishment_proposal_id => (select id from ids where cle = p_establishment_proposal));
  if v_result ->> 'proposal_id' is not null then
    insert into ids values (p_cle, (v_result ->> 'proposal_id')::uuid);
  end if;
  return v_result;
end;
$$;
grant execute on function propose_establishment(text, text), propose_activity(text, text, text) to authenticated;
create function pid(p_cle text) returns uuid language sql as $$ select id from ids where cle = p_cle $$;
grant execute on function pid(text) to authenticated;

set local role authenticated;

-- 1. Soumission ---------------------------------------------------------------------------------
select test_login('8a1e0000-0000-4000-8000-000000000021');
select propose_establishment('est1', 'Finca Nueva');

select is((propose_activity('act1', 'est1', 'Cabalgata') ->> 'ok'), 'true',
  'une activité se propose sur un établissement encore en attente');

reset role;
select is(
  (select row(establishment_id, establishment_proposal_id, status)::text from product_proposals where id = pid('act1')),
  row(null::uuid, pid('est1'), 'pending')::text,
  'elle vise la proposition d''établissement, sans établissement, en attente');
set local role authenticated;
select test_login('8a1e0000-0000-4000-8000-000000000021');

select is(
  (select submit_product_creation_proposal(
     p_type => 'activity', p_payload => jsonb_build_object('name', jsonb_build_object('es', 'X'))) ->> 'reason'),
  'establishment_not_found', 'aucune cible → establishment_not_found');

reset role;
insert into establishments (id, partner_id, name) values
  ('8a1e0000-0000-4000-8000-000000000011', '8a1e0000-0000-4000-8000-000000000001', jsonb_build_object('es', 'Ya existe'));
set local role authenticated;
select test_login('8a1e0000-0000-4000-8000-000000000021');
select is(
  (select submit_product_creation_proposal(
     '8a1e0000-0000-4000-8000-000000000011'::uuid, 'activity',
     jsonb_build_object('name', jsonb_build_object('es', 'X')), pid('est1')) ->> 'reason'),
  'establishment_not_found', 'deux cibles à la fois → establishment_not_found');

select is(
  (select submit_product_creation_proposal(
     p_payload => jsonb_build_object('name', jsonb_build_object('es', 'X')),
     p_establishment_proposal_id => pid('est1')) ->> 'reason'),
  'invalid_type', 'type absent → invalid_type (le DEFAULT null ne passe pas le garde)');

select test_login('8a1e0000-0000-4000-8000-000000000022');
select is((propose_activity('intrus', 'est1', 'Intrusa') ->> 'reason'), 'establishment_proposal_not_pending',
  'la proposition d''établissement d''un autre partenaire est introuvable');

select test_login('8a1e0000-0000-4000-8000-000000000023');
select propose_establishment('est_susp', 'Finca Suspendida');
select is((propose_activity('act_susp', 'est_susp', 'Nada') ->> 'reason'), 'capability_suspended',
  'capacité operator suspendue → capability_suspended');

-- 2. L'activité attend son établissement --------------------------------------------------------
select test_login('8a1e0000-0000-4000-8000-000000000024');
select is((select moderate_product_proposal(pid('act1'), 'approve', 1) ->> 'reason'), 'establishment_pending',
  'approuver l''activité avant son établissement → establishment_pending');
select is((select status from product_proposals where id = pid('act1')), 'pending',
  'l''activité reste en attente');

-- 3. Approbation de l'établissement seul ---------------------------------------------------------
select is((select moderate_establishment_proposal(pid('est1'), 'approve', 1) ->> 'ok'), 'true',
  'l''établissement est approuvé seul');
select is(
  (select pp.establishment_id from product_proposals pp where pp.id = pid('act1')),
  (select ep.establishment_id from establishment_proposals ep where ep.id = pid('est1')),
  'l''activité reçoit l''établissement créé');
select is((select row(status, version)::text from product_proposals where id = pid('act1')), '(pending,2)',
  'elle reste en attente, version incrémentée');

reset role;
select ok(
  (select body_html like '%1 actividad(es) propuesta(s) con este establecimiento siguen en revisión%'
     from notification_emails where event_type = 'partner_proposal_decided' and related_table = 'establishment_proposals' and related_id = pid('est1')),
  'l''e-mail d''approbation mentionne l''activité encore en revue');
set local role authenticated;

select test_login('8a1e0000-0000-4000-8000-000000000024');
select is((select moderate_product_proposal(pid('act1'), 'approve', 2) ->> 'ok'), 'true',
  'l''activité s''approuve ensuite, séparément');
select is(
  (select p.establishment_id from products p
     join product_proposals pp on pp.product_id = p.id where pp.id = pid('act1')),
  (select ep.establishment_id from establishment_proposals ep where ep.id = pid('est1')),
  'le produit créé appartient au nouvel établissement');

select test_login('8a1e0000-0000-4000-8000-000000000021');
select is((propose_activity('tarde', 'est1', 'Tardía') ->> 'reason'), 'establishment_proposal_not_pending',
  'plus de dépôt sur une proposition d''établissement déjà décidée');

-- 4. Établissement accepté, activité refusée ------------------------------------------------------
select propose_establishment('est2', 'Finca Dos');
select propose_activity('act2', 'est2', 'Parapente');
select test_login('8a1e0000-0000-4000-8000-000000000024');
select moderate_establishment_proposal(pid('est2'), 'approve', 1);
select is((select moderate_product_proposal(pid('act2'), 'reject', 2, null, 'Faltan fotos') ->> 'ok'), 'true',
  'l''activité se refuse, l''établissement reste accepté');
select is(
  (select row(ep.status, pp.status)::text from establishment_proposals ep, product_proposals pp
    where ep.id = pid('est2') and pp.id = pid('act2')),
  '(approved,rejected)', 'établissement approuvé, activité refusée');

-- 5. Activité refusée pendant que l'établissement attend : jamais rattachée ensuite ---------------
select test_login('8a1e0000-0000-4000-8000-000000000021');
select propose_establishment('est3', 'Finca Tres');
select propose_activity('act3', 'est3', 'Rafting');
select test_login('8a1e0000-0000-4000-8000-000000000024');
select is((select moderate_product_proposal(pid('act3'), 'reject', 1, null, 'No aplica') ->> 'ok'), 'true',
  'une activité se refuse même si son établissement attend encore');
select moderate_establishment_proposal(pid('est3'), 'approve', 1);
select is((select row(status, establishment_id is null, version)::text from product_proposals where id = pid('act3')),
  '(rejected,t,2)', 'l''approbation de l''établissement ne touche pas une activité déjà refusée');

-- 6. Refus en cascade -----------------------------------------------------------------------------
select test_login('8a1e0000-0000-4000-8000-000000000021');
select propose_establishment('est4', 'Finca Cuatro');
select propose_activity('act4a', 'est4', 'Senderismo');
select propose_activity('act4b', 'est4', 'Kayak');
select test_login('8a1e0000-0000-4000-8000-000000000024');
select is((select moderate_establishment_proposal(pid('est4'), 'reject', 1, null, 'Dirección inválida') ->> 'ok'),
  'true', 'refus de l''établissement');
select is(
  (select count(*)::int from product_proposals
    where establishment_proposal_id = pid('est4') and status = 'rejected'
      and rejection_reason = 'Establecimiento rechazado: Dirección inválida'
      and reviewed_by = '8a1e0000-0000-4000-8000-000000000024'),
  2, 'ses deux activités sont refusées avec lui, motif et relecteur posés');

reset role;
select is(
  (select count(*)::int from audit_log
    where action = 'product_proposal.reject_with_establishment' and entity_id = pid('est4')
      and after ->> 'product_proposals_rejected' = '2'),
  1, 'le refus en cascade est journalisé une fois, avec le nombre d''activités');
select ok(
  (select body_html like '%2 actividad(es) propuesta(s) con este establecimiento también fueron rechazadas%'
     from notification_emails where event_type = 'partner_proposal_decided' and related_table = 'establishment_proposals' and related_id = pid('est4')),
  'un seul e-mail de refus, qui mentionne les activités');
select is(
  (select count(*)::int from notification_emails
    where event_type = 'partner_proposal_decided' and related_table = 'product_proposals' and related_id in (pid('act4a'), pid('act4b'))),
  0, 'aucun e-mail séparé par activité refusée en cascade');
set local role authenticated;

-- 7. Retrait en cascade ---------------------------------------------------------------------------
select test_login('8a1e0000-0000-4000-8000-000000000021');
select propose_establishment('est5', 'Finca Cinco');
select propose_activity('act5', 'est5', 'Ciclismo');
select is((select withdraw_establishment_proposal(pid('est5')) ->> 'ok'), 'true', 'retrait de l''établissement');
select is((select status from product_proposals where id = pid('act5')), 'withdrawn',
  'son activité est retirée avec lui');

-- 8. Contrainte et droits ------------------------------------------------------------------------
reset role;
select throws_ok(
  $$ insert into product_proposals (partner_id, submitted_by, kind, type, payload)
     values ('8a1e0000-0000-4000-8000-000000000001', '8a1e0000-0000-4000-8000-000000000021',
             'create', 'activity', '{}'::jsonb) $$,
  '23514', null, 'une création sans établissement ni proposition d''établissement viole product_proposals_scope');
select throws_ok(
  format($$ update product_proposals set status = 'approved' where id = %L $$, pid('act5')),
  '23514', null, 'approuvée sans établissement viole product_proposals_scope');
select ok(not has_function_privilege('anon', 'submit_product_creation_proposal(uuid,text,jsonb,uuid)', 'EXECUTE'),
  'anon ne peut pas appeler submit_product_creation_proposal');
select ok(has_function_privilege('authenticated', 'submit_product_creation_proposal(uuid,text,jsonb,uuid)', 'EXECUTE'),
  'authenticated peut appeler submit_product_creation_proposal');

select * from finish();
rollback;

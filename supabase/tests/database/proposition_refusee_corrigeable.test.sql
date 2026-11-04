-- Migration 20261104130000 — une proposition de création refusée se corrige au lieu de se
-- recommencer (demande Jérôme, 2026-11-04).
--   - établissement refusé corrigé : même ligne, de nouveau en revue, motif précédent conservé ;
--     ses activités refusées EN CASCADE reviennent avec lui, jamais une activité refusée seule ;
--   - activité refusée corrigée : type immuable, cible relue sur la ligne (jamais celle du client),
--     y compris l'établissement né depuis de la proposition approuvée ;
--   - activité refusée avec un établissement toujours refusé : à corriger après lui ;
--   - « Descartar » : retrait d'une proposition refusée (avec ses activités pour un établissement) ;
--   - e-mails : l'admin est prévenu d'une correction, le partenaire apprend qu'il peut corriger.
-- Les activités sont des `transport` : le type n'exige ni horaire ni établissement connecté.
begin;
select plan(34);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Fixtures : "socio" (capacité operator active, aucun établissement), "otro" (un tiers), un admin.
insert into partners (id, display_name) values
  ('8b2e0000-0000-4000-8000-000000000001', 'Corrige Socio'),
  ('8b2e0000-0000-4000-8000-000000000002', 'Corrige Otro');

insert into auth.users (id, email) values
  ('8b2e0000-0000-4000-8000-000000000021', 'corrige-socio@test.local'),
  ('8b2e0000-0000-4000-8000-000000000022', 'corrige-otro@test.local'),
  ('8b2e0000-0000-4000-8000-000000000024', 'corrige-admin@test.local');

update partner_accounts set partner_id = '8b2e0000-0000-4000-8000-000000000001'
 where id = '8b2e0000-0000-4000-8000-000000000021';
update partner_accounts set partner_id = '8b2e0000-0000-4000-8000-000000000002'
 where id = '8b2e0000-0000-4000-8000-000000000022';

insert into partner_capabilities (partner_id, role, source, status) values
  ('8b2e0000-0000-4000-8000-000000000001', 'referrer', 'migration', 'active'),
  ('8b2e0000-0000-4000-8000-000000000002', 'referrer', 'migration', 'active');
insert into partner_capabilities (partner_id, role, source, status) values
  ('8b2e0000-0000-4000-8000-000000000001', 'operator', 'migration', 'active'),
  ('8b2e0000-0000-4000-8000-000000000002', 'operator', 'migration', 'active');
insert into partner_capabilities (account_id, role, source, status) values
  ('8b2e0000-0000-4000-8000-000000000024', 'admin', 'migration', 'active');

create temp table ids (cle text primary key, id uuid);
grant all on ids to authenticated;

create function pid(p_cle text) returns uuid language sql as $$ select id from ids where cle = p_cle $$;
create function est_payload(p_nombre text) returns jsonb language sql as $$
  select jsonb_build_object('name', jsonb_build_object('es', p_nombre), 'contact_phone', '+573001234567');
$$;
create function trans_payload(p_nombre text) returns jsonb language sql as $$
  select jsonb_build_object('name', jsonb_build_object('es', p_nombre), 'price_cop', 30000);
$$;
create function propose_establishment(p_cle text, p_nombre text) returns void language sql as $$
  insert into ids values (p_cle,
    (select (submit_establishment_creation_proposal(est_payload(p_nombre)) ->> 'proposal_id')::uuid));
$$;
create function propose_transport(p_cle text, p_establishment_proposal text, p_nombre text) returns void
language sql as $$
  insert into ids values (p_cle,
    (select (submit_product_creation_proposal(
       p_type => 'transport', p_payload => trans_payload(p_nombre),
       p_establishment_proposal_id => pid(p_establishment_proposal)) ->> 'proposal_id')::uuid));
$$;
create function resubmit_transport(p_cle text, p_nombre text) returns jsonb language sql as $$
  select submit_product_creation_proposal(
    p_type => 'transport', p_payload => trans_payload(p_nombre), p_proposal_id => pid(p_cle));
$$;
create function version_of(p_cle text) returns int language sql security definer as $$
  select coalesce(
    (select version from product_proposals where id = pid(p_cle)),
    (select version from establishment_proposals where id = pid(p_cle)));
$$;
grant execute on function pid(text), est_payload(text), trans_payload(text),
  propose_establishment(text, text), propose_transport(text, text, text),
  resubmit_transport(text, text), version_of(text) to authenticated;

set local role authenticated;

-- 1. Établissement refusé, puis corrigé -----------------------------------------------------------
select test_login('8b2e0000-0000-4000-8000-000000000021');
select propose_establishment('est1', 'Finca Mal Escrita');
select propose_transport('t1a', 'est1', 'Traslado aeropuerto');
select propose_transport('t1b', 'est1', 'Traslado caro');

select test_login('8b2e0000-0000-4000-8000-000000000024');
select moderate_product_proposal(pid('t1b'), 'reject', 1, null, 'Precio');
select moderate_establishment_proposal(pid('est1'), 'reject', 1, null, 'Dirección');

reset role;
select ok(
  (select body_html like '%puedes corregirla desde tu espacio Hifago%'
     from notification_emails where event_type = 'partner_proposal_decided'
      and related_table = 'establishment_proposals' and related_id = pid('est1')),
  'l''e-mail de refus dit au partenaire qu''il peut corriger sa proposition');
set local role authenticated;

select test_login('8b2e0000-0000-4000-8000-000000000022');
select is(
  (select submit_establishment_creation_proposal(est_payload('Intrusa'), pid('est1')) ->> 'reason'),
  'proposal_not_found', 'un autre partenaire ne corrige pas cette proposition');

select test_login('8b2e0000-0000-4000-8000-000000000021');
select is(
  (select submit_establishment_creation_proposal(est_payload('Finca Corregida'), pid('est1')) ->> 'proposal_id')::uuid,
  pid('est1'), 'la correction renvoie la MÊME proposition, pas une nouvelle');

reset role;
select is(
  (select row(status, payload -> 'name' ->> 'es', rejection_reason, reviewed_by is null, version)::text
     from establishment_proposals where id = pid('est1')),
  row('pending', 'Finca Corregida', 'Dirección', true, 3)::text,
  'de nouveau en revue, contenu corrigé, motif précédent conservé, version incrémentée');
select is(
  (select count(*)::int from establishment_proposals
    where partner_id = '8b2e0000-0000-4000-8000-000000000001' and kind = 'create'),
  1, 'aucune proposition d''établissement en plus');
select is(
  (select row(status, rejection_reason, reviewed_at is null)::text from product_proposals where id = pid('t1a')),
  row('pending', null::text, true)::text,
  'l''activité refusée en cascade revient en revue, sans le motif de l''établissement');
select is(
  (select row(status, rejection_reason)::text from product_proposals where id = pid('t1b')),
  row('rejected', 'Precio')::text,
  'l''activité refusée pour elle-même reste refusée');
select ok(
  exists(select 1 from notification_emails where event_type = 'admin_new_proposal'
          and related_table = 'establishment_proposals' and related_id = pid('est1')
          and subject = 'Propuesta de establecimiento corregida, pendiente de moderación'),
  'l''admin est prévenu de la correction');
select is(
  (select count(*)::int from notification_emails where event_type = 'admin_new_proposal'
     and related_id = pid('t1a') and subject like '%corregida%'),
  0, 'aucun e-mail séparé pour l''activité réveillée avec son établissement');
set local role authenticated;

select test_login('8b2e0000-0000-4000-8000-000000000021');
select is(
  (select submit_establishment_creation_proposal(est_payload('Otra vez'), pid('est1')) ->> 'reason'),
  'not_rejected', 'une proposition en revue ne se « corrige » pas');

-- 2. Activité refusée, corrigée -------------------------------------------------------------------
select is((resubmit_transport('t1b', 'Traslado corregido') ->> 'ok'), 'true',
  'l''activité refusée se corrige pendant que son établissement attend');
reset role;
select is(
  (select row(status, payload -> 'name' ->> 'es', rejection_reason, establishment_proposal_id)::text
     from product_proposals where id = pid('t1b')),
  row('pending', 'Traslado corregido', 'Precio', pid('est1'))::text,
  'en revue, contenu corrigé, même cible, motif précédent conservé');
select ok(
  exists(select 1 from notification_emails where event_type = 'admin_new_proposal'
          and related_table = 'product_proposals' and related_id = pid('t1b')
          and subject = 'Propuesta de producto corregida, pendiente de moderación'),
  'l''admin est prévenu de la correction de l''activité');
set local role authenticated;

select test_login('8b2e0000-0000-4000-8000-000000000024');
select moderate_establishment_proposal(pid('est1'), 'approve', 3);
reset role;
select ok(
  exists(select 1 from notification_emails where event_type = 'partner_proposal_decided'
          and related_table = 'establishment_proposals' and related_id = pid('est1')
          and subject = 'Tu propuesta fue aprobada'),
  'après une correction, l''e-mail d''approbation part malgré celui du refus précédent');
select is(
  (select count(*)::int from notification_emails where event_type = 'partner_proposal_decided'
     and related_id = pid('est1')),
  2, 'le partenaire a reçu deux verdicts : le refus, puis l''approbation');
set local role authenticated;
select test_login('8b2e0000-0000-4000-8000-000000000024');
select moderate_product_proposal(pid('t1b'), 'reject', version_of('t1b'), null, 'Falta foto');
reset role;
select is(
  (select count(*)::int from notification_emails where event_type = 'partner_proposal_decided'
     and related_id = pid('t1b')),
  2, 'deux refus de la même activité, deux e-mails');
-- Le dédoublonnage reste entier pour un même tour : rejouer l'enfilement à version égale n'ajoute rien.
select is(
  (select enqueue_notification_email('partner_proposal_decided', 'corrige-socio@test.local',
     '8b2e0000-0000-4000-8000-000000000021', 'x', 'x', 'product_proposals', pid('t1b'))),
  null, 'un même événement, au même tour, n''est enfilé qu''une fois');
set local role authenticated;

select test_login('8b2e0000-0000-4000-8000-000000000021');
select is(
  (select submit_product_creation_proposal(
     p_type => 'activity', p_payload => trans_payload('Otro tipo'), p_proposal_id => pid('t1b')) ->> 'reason'),
  'invalid_type', 'le type ne change jamais en corrigeant');

reset role;
insert into establishments (id, partner_id, name) values
  ('8b2e0000-0000-4000-8000-000000000012', '8b2e0000-0000-4000-8000-000000000002', jsonb_build_object('es', 'De otro'));
set local role authenticated;
select test_login('8b2e0000-0000-4000-8000-000000000021');
select is(
  (select submit_product_creation_proposal(
     p_establishment_id => '8b2e0000-0000-4000-8000-000000000012', p_type => 'transport',
     p_payload => trans_payload('Desviado'), p_proposal_id => pid('t1b')) ->> 'ok'),
  'true', 'une cible passée par le client est ignorée…');
reset role;
select is(
  (select pp.establishment_id from product_proposals pp where pp.id = pid('t1b')),
  (select ep.establishment_id from establishment_proposals ep where ep.id = pid('est1')),
  '… la proposition garde son établissement');
set local role authenticated;

-- 3. Refusée seule pendant que l'établissement attendait, établissement approuvé depuis ------------
select test_login('8b2e0000-0000-4000-8000-000000000021');
select propose_establishment('est2', 'Finca Dos');
select propose_transport('t2', 'est2', 'Lancha');
select test_login('8b2e0000-0000-4000-8000-000000000024');
select moderate_product_proposal(pid('t2'), 'reject', 1, null, 'Sin horario');
select moderate_establishment_proposal(pid('est2'), 'approve', 1);
select test_login('8b2e0000-0000-4000-8000-000000000021');
select is((resubmit_transport('t2', 'Lancha corregida') ->> 'ok'), 'true',
  'l''activité se corrige après l''approbation de son établissement');
reset role;
select is(
  (select row(pp.status, pp.establishment_id = ep.establishment_id)::text
     from product_proposals pp join establishment_proposals ep on ep.id = pp.establishment_proposal_id
    where pp.id = pid('t2')),
  '(pending,t)', 'elle vise l''établissement né de la proposition approuvée');
set local role authenticated;

-- 4. Établissement toujours refusé : l'activité attend sa correction ------------------------------
select test_login('8b2e0000-0000-4000-8000-000000000021');
select propose_establishment('est3', 'Finca Tres');
select propose_transport('t3', 'est3', 'Chiva');
select test_login('8b2e0000-0000-4000-8000-000000000024');
select moderate_establishment_proposal(pid('est3'), 'reject', 1, null, 'Duplicado');
select test_login('8b2e0000-0000-4000-8000-000000000021');
select is((resubmit_transport('t3', 'Chiva bis') ->> 'reason'), 'establishment_proposal_not_pending',
  'une activité ne se corrige pas tant que son établissement reste refusé');

-- 5. Descartar ------------------------------------------------------------------------------------
select is((select withdraw_establishment_proposal(pid('est3')) ->> 'ok'), 'true',
  'un établissement refusé s''écarte');
reset role;
select is(
  (select row(ep.status, pp.status)::text from establishment_proposals ep, product_proposals pp
    where ep.id = pid('est3') and pp.id = pid('t3')),
  '(withdrawn,withdrawn)', 'ses activités refusées avec lui sont écartées aussi');
set local role authenticated;

select test_login('8b2e0000-0000-4000-8000-000000000024');
select moderate_product_proposal(pid('t2'), 'reject', version_of('t2'), null, 'Definitivo');
select test_login('8b2e0000-0000-4000-8000-000000000021');
select is((select withdraw_product_proposal(pid('t2')) ->> 'ok'), 'true', 'une activité refusée s''écarte');
select is((select withdraw_product_proposal(pid('t2')) ->> 'reason'), 'not_pending',
  'une proposition déjà écartée ne s''écarte pas deux fois');
select is((resubmit_transport('t2', 'Revivida') ->> 'reason'), 'not_rejected',
  'une proposition écartée ne se corrige plus');
select test_login('8b2e0000-0000-4000-8000-000000000022');
select is((select withdraw_product_proposal(pid('t1b')) ->> 'reason'), 'proposal_not_found',
  'un autre partenaire n''écarte pas la proposition');

-- 6. Droits ---------------------------------------------------------------------------------------
reset role;
select ok(not has_function_privilege('anon', 'submit_product_creation_proposal(uuid,text,jsonb,uuid,uuid)', 'EXECUTE'),
  'anon ne peut pas appeler submit_product_creation_proposal');
select ok(has_function_privilege('authenticated', 'submit_product_creation_proposal(uuid,text,jsonb,uuid,uuid)', 'EXECUTE'),
  'authenticated peut appeler submit_product_creation_proposal');
select ok(not has_function_privilege('anon', 'submit_establishment_creation_proposal(jsonb,uuid)', 'EXECUTE'),
  'anon ne peut pas appeler submit_establishment_creation_proposal');
select ok(has_function_privilege('authenticated', 'submit_establishment_creation_proposal(jsonb,uuid)', 'EXECUTE'),
  'authenticated peut appeler submit_establishment_creation_proposal');
select is(
  (select count(*)::int from pg_proc where proname in ('submit_product_creation_proposal', 'submit_establishment_creation_proposal')),
  2, 'aucune ancienne signature ne survit à côté de la nouvelle');

select * from finish();
rollback;

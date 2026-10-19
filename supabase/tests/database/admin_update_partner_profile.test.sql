-- admin_update_partner_profile (20261019160000).
--
-- La fiche admin d'un socio enregistre identité, contact, réseaux et profil commercial en UN appel.
-- Ce fichier prouve : la garde de rôle et la liste blanche ; chaque refus métier, sans rien écrire
-- même quand une autre clé du même appel était valide ; l'écriture des deux tables (profil créé
-- s'il manque) ; chaîne vide = null ; étiquettes nettoyées ; le moyen de paiement remplacé puis
-- effacé, jamais recopié dans l'audit ; un appel sans changement ne journalise rien.
begin;
select plan(20);

create function test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

insert into partners (id, display_name, email, phone, partner_city) values
  ('a7e00000-0000-4000-8000-000000000001', 'Profile Partner', 'viejo@test.local', '+573000000000', 'Guatapé');

-- 031 admin, 032 compte ordinaire.
insert into auth.users (id, email) values
  ('a7e00000-0000-4000-8000-000000000031', 'profile-partner-admin@test.local'),
  ('a7e00000-0000-4000-8000-000000000032', 'profile-partner-intruso@test.local');
insert into partner_capabilities (account_id, role, source, status)
values ('a7e00000-0000-4000-8000-000000000031', 'admin', 'migration', 'active');

select is(
  has_function_privilege('anon', 'admin_update_partner_profile(uuid, jsonb, text)', 'EXECUTE'),
  false, 'anon ne peut pas appeler la RPC'
);

set local role authenticated;

-- ---------- Garde de rôle, liste blanche ---------------------------------------------------------
select test_login('a7e00000-0000-4000-8000-000000000032');
select throws_ok(
  $$ select admin_update_partner_profile('a7e00000-0000-4000-8000-000000000001', '{"display_name": "Pirate"}') $$,
  '42501', 'admin_update_partner_profile réservé au rôle admin',
  'un compte non admin est refusé'
);

select test_login('a7e00000-0000-4000-8000-000000000031');
select throws_ok(
  $$ select admin_update_partner_profile('a7e00000-0000-4000-8000-000000000001', '{"id": "x"}') $$,
  'P0001', 'clé non autorisée : id',
  'une clé hors liste blanche lève'
);
select throws_ok(
  $$ select admin_update_partner_profile('a7e00000-0000-4000-8000-000000000001', '{"email": 12}') $$,
  'P0001', 'email doit être une chaîne ou null',
  'un type JSON faux lève'
);

-- ---------- Refus métier : rien n'est écrit ------------------------------------------------------
select is(
  admin_update_partner_profile('a7e00000-0000-4000-8000-000000000099', '{"phone": "1"}') ->> 'reason',
  'not_found', 'un partenaire inconnu est refusé'
);
select is(
  admin_update_partner_profile('a7e00000-0000-4000-8000-000000000001',
    '{"display_name": "   ", "phone": "+573111111111"}') ->> 'reason',
  'invalid_name', 'le nom ne peut pas être vidé'
);
select is(
  admin_update_partner_profile('a7e00000-0000-4000-8000-000000000001',
    '{"email": "pas-un-email", "phone": "+573111111111"}') ->> 'reason',
  'invalid_email', 'un email malformé est refusé'
);
select is(
  admin_update_partner_profile('a7e00000-0000-4000-8000-000000000001',
    '{"commercial_status": "vip", "barrio": "Centro"}') ->> 'reason',
  'invalid_commercial_status', 'un état commercial hors liste est refusé'
);
select is(
  admin_update_partner_profile('a7e00000-0000-4000-8000-000000000001',
    '{"bank": {"bancolombia": {}, "nequi": {}}}') ->> 'reason',
  'invalid_bank', 'deux moyens de paiement à la fois sont refusés'
);

-- ---------- Écriture complète ------------------------------------------------------------------
select is(
  admin_update_partner_profile('a7e00000-0000-4000-8000-000000000001', jsonb_build_object(
    'display_name', '  Profile Partner Nuevo ',
    'legal_name', 'Profile SAS',
    'identification_type', 'NIT',
    'identification_number', '900123456',
    'partner_city', 'El Peñol',
    'email', 'nuevo@test.local',
    'phone', '',
    'instagram', '@profilepartner',
    'facebook', 'https://facebook.com/profilepartner',
    'website', 'https://profile.test',
    'barrio', 'Centro',
    'notes', 'Llamar el lunes',
    'commercial_status', 'activo',
    'tags', jsonb_build_array(' kayak ', 'lago', 'kayak', ''),
    'bank', jsonb_build_object('nombre', 'Ana', 'nequi', jsonb_build_object('telefono', '3001234567'))
  ), 'revisión de ficha') ->> 'changed',
  'true', 'tous les champs passent en un appel'
);

-- ⚠️ Lectures APRÈS `reset role` : audit_log n'est lisible que par l'admin.
reset role;

select is(
  (select concat_ws('|', display_name, legal_name, identification_type, identification_number,
                    partner_city, email, coalesce(phone, 'null'), instagram, facebook, website)
     from partners where id = 'a7e00000-0000-4000-8000-000000000001'),
  'Profile Partner Nuevo|Profile SAS|NIT|900123456|El Peñol|nuevo@test.local|null|@profilepartner|https://facebook.com/profilepartner|https://profile.test',
  'partners : valeurs rognées, chaîne vide = null'
);
select is(
  (select concat_ws('|', barrio, notes, commercial_status, array_to_string(tags, ','),
                    bank ->> 'nombre', bank -> 'nequi' ->> 'telefono', (bank ? 'received_at')::text)
     from partner_crm_profile where partner_id = 'a7e00000-0000-4000-8000-000000000001'),
  'Centro|Llamar el lunes|activo|kayak,lago|Ana|3001234567|true',
  'profil commercial créé ; étiquettes rognées et dédoublonnées ; reçu daté côté serveur'
);
select is(
  (select count(*)::int from audit_log
    where entity_id = 'a7e00000-0000-4000-8000-000000000001' and action = 'partner.update_profile'),
  1, 'une seule trace pour l''appel réussi, aucune pour les refus'
);
select is(
  (select after ->> 'bank' from audit_log
    where entity_id = 'a7e00000-0000-4000-8000-000000000001' and action = 'partner.update_profile'),
  '[oculto]', 'le moyen de paiement n''est jamais recopié dans l''audit'
);
select is(
  (select concat_ws('|', before ->> 'email', after ->> 'email', before ->> 'phone',
                    coalesce(after ->> 'phone', 'null'), note)
     from audit_log
    where entity_id = 'a7e00000-0000-4000-8000-000000000001' and action = 'partner.update_profile'),
  'viejo@test.local|nuevo@test.local|+573000000000|null|revisión de ficha',
  'l''audit garde l''avant, l''après et la note'
);

-- ---------- Sans changement, puis effacement du moyen de paiement -------------------------------
set local role authenticated;
select test_login('a7e00000-0000-4000-8000-000000000031');
select is(
  admin_update_partner_profile('a7e00000-0000-4000-8000-000000000001',
    '{"email": "nuevo@test.local", "barrio": "Centro", "tags": ["kayak", "lago"]}') ->> 'changed',
  'false', 'renvoyer les mêmes valeurs ne change rien'
);
select is(
  admin_update_partner_profile('a7e00000-0000-4000-8000-000000000001', '{"bank": null}') ->> 'changed',
  'true', 'le moyen de paiement s''efface'
);
reset role;

select is(
  (select bank from partner_crm_profile where partner_id = 'a7e00000-0000-4000-8000-000000000001'),
  null, 'bank vaut NULL SQL, pas le JSON null'
);
select is(
  (select count(*)::int from audit_log
    where entity_id = 'a7e00000-0000-4000-8000-000000000001' and action = 'partner.update_profile'),
  2, 'l''appel sans changement n''a rien journalisé, l''effacement oui'
);
select is(
  (select (before ->> 'bank') || '|' || coalesce(after ->> 'bank', 'null') from audit_log
    -- Même transaction : created_at identique, la seconde trace se reconnaît à son contenu.
    where entity_id = 'a7e00000-0000-4000-8000-000000000001' and action = 'partner.update_profile'
      and not (after ? 'email')),
  '[oculto]|null', 'l''effacement est tracé sans le numéro'
);

select * from finish();
rollback;

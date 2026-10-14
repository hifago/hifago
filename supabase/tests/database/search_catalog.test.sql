-- Spec 27 Lot A — `search_catalog`, la seule lecture publique du catalogue.
--
-- ⚠️ CHAQUE assertion est SCOPÉE sur les fixtures de ce fichier (identifiants fixes, préfixe
-- `aaaa1111-`), jamais sur un comptage global. La base locale accumule des données d'e2e au fil des
-- exécutions — six fichiers pgTAP de ce dossier en souffrent déjà (cf. docs/backlog.md). Un test
-- qui compte le catalogue entier serait vert aujourd'hui et rouge demain sans qu'une ligne de code
-- ait bougé.
--
-- ⚠️ ET LE SCOPAGE NE SUFFIT PAS — corrigé le 2026-09-07, après que ce fichier soit passé de vert à
-- SIX assertions rouges sans qu'aucune ligne de SQL ait bougé. `search_catalog()` porte un
-- `p_limite` par DÉFAUT de 24 et un `order by tipo`, et `activity` trie en premier : le jour où la
-- base locale a dépassé 24 activités accumulées, la fenêtre s'est refermée avant les couchages et
-- le `where id = …` d'ici filtrait un ensemble qui ne les contenait déjà plus. D'où le
-- `p_limite => 100000` explicite sur CHAQUE appel : le filtre de l'assertion doit s'appliquer au
-- catalogue entier, jamais à une page de résultats. Ne jamais appeler `search_catalog()` nu ici.
--
-- Tout tourne en `anon` : c'est le rôle réel d'un visiteur de la vitrine, et ça vérifie du même
-- geste que les policies `_select_public` laissent bien passer ce qu'il faut.

begin;
select plan(47);

-- ── Fixtures ────────────────────────────────────────────────────────────────────────────────────
insert into partners (id, display_name) values
  ('aaaa1111-0000-0000-0000-000000000001', 'Search Catalog Test Partner');

-- Établissement A : DEUX couchages vendables → doit être groupé en UNE carte.
-- Établissement B : UN seul couchage vendable → ne doit PAS être groupé.
-- Établissement C : archivé → rien de lui ne doit sortir.
-- Établissement D : DEUX couchages vendables aussi, mais JAMAIS taggé (chantier "catégories
-- partout", 2026-09-14) — sert à distinguer, sous p_sin_tag, une carte groupée non classée d'une
-- carte groupée classée (A, ci-dessous).
insert into establishments (id, partner_id, name, status) values
  ('aaaa1111-0000-0000-0000-00000000000a', 'aaaa1111-0000-0000-0000-000000000001',
   '{"es":"Hotel Agrupado"}'::jsonb, 'active'),
  ('aaaa1111-0000-0000-0000-00000000000b', 'aaaa1111-0000-0000-0000-000000000001',
   '{"es":"Cabaña Sola"}'::jsonb, 'active'),
  ('aaaa1111-0000-0000-0000-00000000000c', 'aaaa1111-0000-0000-0000-000000000001',
   '{"es":"Archivado"}'::jsonb, 'archived'),
  ('aaaa1111-0000-0000-0000-00000000000d', 'aaaa1111-0000-0000-0000-000000000001',
   '{"es":"Hotel Agrupado Sin Tag"}'::jsonb, 'active');

insert into products
  (id, partner_id, establishment_id, type, slug, name, price_cop, sellable, capacity, max_qty, schedule)
values
  -- A : deux couchages, prix 200000 et 90000 → « desde » doit valoir 90000
  ('aaaa1111-0000-0000-0000-000000000101', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000a', 'lodging', 'sc-hab-cara',
   '{"es":"Habitación cara"}'::jsonb, 200000, true, 4, null, 'date'),
  ('aaaa1111-0000-0000-0000-000000000102', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000a', 'lodging', 'sc-hab-barata',
   '{"es":"Habitación barata"}'::jsonb, 90000, true, 2, null, 'date'),
  -- A : un troisième NON vendable — ne doit compter ni dans le seuil ni dans le « desde »
  ('aaaa1111-0000-0000-0000-000000000103', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000a', 'lodging', 'sc-hab-oculta',
   '{"es":"Habitación oculta"}'::jsonb, 10, false, 8, null, 'date'),
  -- B : couchage unique
  ('aaaa1111-0000-0000-0000-000000000104', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000b', 'lodging', 'sc-cabana',
   '{"es":"Cabaña Guatapé"}'::jsonb, 150000, true, 6, null, 'date'),
  -- C : archivé
  ('aaaa1111-0000-0000-0000-000000000105', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000c', 'lodging', 'sc-archivado',
   '{"es":"Archivado"}'::jsonb, 1000, true, 2, null, 'date'),
  -- D : deux couchages, jamais taggés (ni au niveau produit ni au niveau établissement)
  ('aaaa1111-0000-0000-0000-000000000106', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000d', 'lodging', 'sc-hab-d1',
   '{"es":"Hab D1"}'::jsonb, 80000, true, 2, null, 'date'),
  ('aaaa1111-0000-0000-0000-000000000107', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000d', 'lodging', 'sc-hab-d2',
   '{"es":"Hab D2"}'::jsonb, 85000, true, 2, null, 'date'),
  -- Activités : bornes de quantité différentes, pour le filtre personas
  ('aaaa1111-0000-0000-0000-000000000201', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000b', 'activity', 'sc-jetski',
   '{"es":"Jetski"}'::jsonb, 90000, true, 20, 2, 'date'),
  ('aaaa1111-0000-0000-0000-000000000202', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000b', 'activity', 'sc-sin-tope',
   '{"es":"Sin tope"}'::jsonb, 30000, true, 20, null, 'date'),
  ('aaaa1111-0000-0000-0000-000000000203', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000b', 'activity', 'sc-cerrada',
   '{"es":"Cerrada"}'::jsonb, 40000, true, 20, null, 'date');

-- Événements (2026-09-15, retour Jérôme : trier les evento par prochaine occurrence, du plus
-- proche au plus éloigné — migration 20260915110000_search_catalog_evento_next_occurrence.sql).
-- Toutes les dates relatives à `today_in_bogota()`, jamais en dur (ce fichier doit rester vrai
-- indéfiniment). Assertions plus bas en ORDRE RELATIF entre CES fixtures (jamais un rango_seccion
-- absolu, qui dépendrait des evento déjà présents ailleurs dans la base — même discipline que le
-- reste de ce fichier, cf. en-tête).
insert into products (
  id, partner_id, establishment_id, type, slug, name, price_cop, sellable,
  occurrence_type, occurrence_date, recurrence_frequency_days, recurrence_end_date, recurrence_end_count
) values
  -- E1 : ponctuel, dans 30 jours — le plus ÉLOIGNÉ des événements « à venir » de ce lot.
  ('aaaa1111-0000-0000-0000-000000000401', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000b', 'evento', 'sc-evento-loin',
   '{"es":"Evento Lejano"}'::jsonb, 50000, true,
   'once', today_in_bogota() + 30, null, null, null),
  -- E2 : ponctuel, dans 10 jours — plus PROCHE que E1.
  ('aaaa1111-0000-0000-0000-000000000402', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000b', 'evento', 'sc-evento-cerca',
   '{"es":"Evento Cercano"}'::jsonb, 50000, true,
   'once', today_in_bogota() + 10, null, null, null),
  -- E3 : ponctuel, déjà PASSÉ — aucune occurrence à venir, doit finir après E1/E2.
  ('aaaa1111-0000-0000-0000-000000000403', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000b', 'evento', 'sc-evento-pasado',
   '{"es":"Evento Pasado"}'::jsonb, 50000, true,
   'once', today_in_bogota() - 5, null, null, null),
  -- E4 : récurrent tous les 7 jours, ancre lointaine dans le passé, SANS fin — sa prochaine
  -- occurrence tombe forcément dans les 6 prochains jours, donc avant E2 (+10j).
  ('aaaa1111-0000-0000-0000-000000000404', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000b', 'evento', 'sc-evento-recurrente',
   '{"es":"Evento Recurrente"}'::jsonb, 50000, true,
   'recurring', today_in_bogota() - 100, 7, null, null),
  -- E5 : récurrent, mais la série s'est terminée (recurrence_end_date déjà dépassée) — même
  -- traitement que E3, doit finir après tous les événements à venir.
  ('aaaa1111-0000-0000-0000-000000000405', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000b', 'evento', 'sc-evento-termine',
   '{"es":"Evento Terminado"}'::jsonb, 50000, true,
   'recurring', today_in_bogota() - 100, 10, today_in_bogota() - 50, null);

-- L'activité `sc-cerrada` est explicitement fermée sur toute une plage (calendrier CREUX :
-- l'absence de ligne vaut `calendar_default_open`, `true` par défaut).
insert into product_calendar (product_id, date, open) values
  ('aaaa1111-0000-0000-0000-000000000203', date '2030-03-10', false),
  ('aaaa1111-0000-0000-0000-000000000203', date '2030-03-11', false);

-- 20260916110000 — filtre dates bifurqué par type (camp/evento/activity à créneaux ont chacun leur
-- propre modèle de disponibilité, jamais écrit dans product_calendar).
--
-- Camp : un départ fixe dans product_availability (jamais product_calendar). Le séjour couvre
-- [départ, départ + duration_days - 1] (même formule que ultimoDiaCampIso côté app).
insert into products (
  id, partner_id, establishment_id, type, slug, name, price_cop, sellable, duration_days
) values (
  'aaaa1111-0000-0000-0000-000000000501', 'aaaa1111-0000-0000-0000-000000000001',
  'aaaa1111-0000-0000-0000-00000000000b', 'camp', 'sc-camp',
  '{"es":"Campamento de prueba"}'::jsonb, 500000, true, 7
);

insert into product_availability (product_id, date, capacity, booked) values
  ('aaaa1111-0000-0000-0000-000000000501', today_in_bogota() + 30, 20, 0);

-- Activity à créneaux : product_slot_rules porte un seul jour de semaine (celui de 2030-03-10, même
-- voisinage de dates que `sc-cerrada` ci-dessus) — jamais de ligne product_calendar pour ce produit.
insert into products (
  id, partner_id, establishment_id, type, slug, name, price_cop, sellable
) values (
  'aaaa1111-0000-0000-0000-000000000204', 'aaaa1111-0000-0000-0000-000000000001',
  'aaaa1111-0000-0000-0000-00000000000b', 'activity', 'sc-yoga-creneau',
  '{"es":"Yoga de prueba"}'::jsonb, 40000, true
);

insert into product_slot_rules (
  product_id, weekdays, start_time, end_time, slot_duration_minutes, capacity
) values (
  'aaaa1111-0000-0000-0000-000000000204',
  array[extract(isodow from date '2030-03-10')::smallint],
  '08:00', '09:00', 60, 10
);

-- Spec 29 — fixtures de tags. `sc-jetski` est classée, `sc-sin-tope` et `sc-cerrada` ne le sont
-- pas : c'est ce contraste qui rend `p_sin_tag` vérifiable.
insert into catalog_tags (id, label, slug) values
  ('aaaa1111-0000-0000-0000-000000000301', '{"es":"Kayak de prueba"}'::jsonb, 'sc-tag-kayak'),
  -- Chantier "catégories partout" (2026-09-14) — deux tags DISTINCTS pour isoler chaque source de
  -- la bifurcation établissement/produit (cf. section dédiée plus bas) : les mélanger sur un seul
  -- tag aurait rendu chaque assertion positive par la MAUVAISE raison.
  ('aaaa1111-0000-0000-0000-000000000302', '{"es":"Piscina de prueba"}'::jsonb, 'sc-tag-piscina'),
  ('aaaa1111-0000-0000-0000-000000000303', '{"es":"Vista de prueba"}'::jsonb, 'sc-tag-vista');

insert into product_tag_assignments (product_id, tag_id) values
  ('aaaa1111-0000-0000-0000-000000000201', 'aaaa1111-0000-0000-0000-000000000301'),
  -- Cabaña Sola (B, UN seul couchage → carte PRODUIT) : source produit, cas non-groupé inchangé.
  ('aaaa1111-0000-0000-0000-000000000104', 'aaaa1111-0000-0000-0000-000000000302'),
  -- Une CHAMBRE de l'Hotel Agrupado (A, DEUX couchages → carte ÉTABLISSEMENT groupée), avec un tag
  -- QUI N'EST JAMAIS POSÉ AU NIVEAU ÉTABLISSEMENT : doit rester sans aucun effet sur la carte
  -- groupée — c'est exactement la limite structurelle que la bifurcation corrige.
  ('aaaa1111-0000-0000-0000-000000000101', 'aaaa1111-0000-0000-0000-000000000303');

insert into establishment_tag_assignments (establishment_id, tag_id) values
  -- L'Hotel Agrupado (A) lui-même, au niveau ÉTABLISSEMENT, avec un tag DIFFÉRENT de celui posé
  -- sur sa chambre : c'est CE tag-ci qui doit le faire apparaître.
  ('aaaa1111-0000-0000-0000-00000000000a', 'aaaa1111-0000-0000-0000-000000000302');

-- Logement UNIQUE (migration 20261013192000) — Établissement E : UN seul couchage vendable (carte
-- PRODUIT) et une activité, avec un tag posé UNIQUEMENT sur l'établissement. Le couchage en hérite,
-- l'activité non.
insert into establishments (id, partner_id, name, status) values
  ('aaaa1111-0000-0000-0000-00000000000e', 'aaaa1111-0000-0000-0000-000000000001',
   '{"es":"Cabaña Heredera"}'::jsonb, 'active');

insert into products
  (id, partner_id, establishment_id, type, slug, name, price_cop, sellable, capacity, max_qty, schedule)
values
  ('aaaa1111-0000-0000-0000-000000000108', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000e', 'lodging', 'sc-cabana-heredera',
   '{"es":"Cabaña heredera"}'::jsonb, 120000, true, 2, null, 'date'),
  ('aaaa1111-0000-0000-0000-000000000205', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000e', 'activity', 'sc-actividad-heredera',
   '{"es":"Actividad de la cabaña heredera"}'::jsonb, 50000, true, null, null, 'date');

insert into catalog_tags (id, label, slug) values
  ('aaaa1111-0000-0000-0000-000000000304', '{"es":"Heredado de prueba"}'::jsonb, 'sc-tag-heredado');

insert into establishment_tag_assignments (establishment_id, tag_id) values
  ('aaaa1111-0000-0000-0000-00000000000e', 'aaaa1111-0000-0000-0000-000000000304');

-- ── Ordre des cartes dans une section (migration 20261013215000, demande Jérôme du 2026-10-13) ───
-- ⚠️ Ces trois lots s'affirment en ORDRE EXACT, ce que le reste du fichier s'interdit (d'autres
-- lignes existent dans la base). C'est possible ici parce que chaque lot porte un mot INVENTÉ dans
-- son nom (`zqmix`, `zqcamp`, `zqalt`) : `p_query` réduit alors les candidats à ces seules
-- fixtures, et l'ordre obtenu ne dépend plus de ce que la base contient par ailleurs.
--
-- `created_at` est posé À LA MAIN : dans une transaction, `now()` vaut la même chose pour toutes
-- les lignes, et l'ordre de base (« le plus récent d'abord ») se jouerait sur l'identifiant.

-- Mélange des catégories : trois « agua », une « arte », une « musica », de la plus récente à la
-- plus ancienne. Par date de création seule, les trois « agua » se suivraient.
insert into catalog_tags (id, label, slug) values
  ('aaaa1111-0000-0000-0000-000000000311', '{"es":"Agua de prueba"}'::jsonb, 'sc-mix-agua'),
  ('aaaa1111-0000-0000-0000-000000000312', '{"es":"Arte de prueba"}'::jsonb, 'sc-mix-arte'),
  ('aaaa1111-0000-0000-0000-000000000313', '{"es":"Musica de prueba"}'::jsonb, 'sc-mix-musica');

insert into products
  (id, partner_id, establishment_id, type, slug, name, price_cop, sellable, created_at)
values
  ('aaaa1111-0000-0000-0000-000000000601', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000b', 'activity', 'sc-mix-1',
   '{"es":"Zqmix uno"}'::jsonb, 10000, true, timestamptz '2030-01-05 12:00+00'),
  ('aaaa1111-0000-0000-0000-000000000602', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000b', 'activity', 'sc-mix-2',
   '{"es":"Zqmix dos"}'::jsonb, 10000, true, timestamptz '2030-01-04 12:00+00'),
  ('aaaa1111-0000-0000-0000-000000000603', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000b', 'activity', 'sc-mix-3',
   '{"es":"Zqmix tres"}'::jsonb, 10000, true, timestamptz '2030-01-03 12:00+00'),
  ('aaaa1111-0000-0000-0000-000000000604', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000b', 'activity', 'sc-mix-4',
   '{"es":"Zqmix cuatro"}'::jsonb, 10000, true, timestamptz '2030-01-02 12:00+00'),
  ('aaaa1111-0000-0000-0000-000000000605', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000b', 'activity', 'sc-mix-5',
   '{"es":"Zqmix cinco"}'::jsonb, 10000, true, timestamptz '2030-01-01 12:00+00');

insert into product_tag_assignments (product_id, tag_id) values
  ('aaaa1111-0000-0000-0000-000000000601', 'aaaa1111-0000-0000-0000-000000000311'),
  ('aaaa1111-0000-0000-0000-000000000602', 'aaaa1111-0000-0000-0000-000000000311'),
  ('aaaa1111-0000-0000-0000-000000000603', 'aaaa1111-0000-0000-0000-000000000311'),
  ('aaaa1111-0000-0000-0000-000000000604', 'aaaa1111-0000-0000-0000-000000000312'),
  ('aaaa1111-0000-0000-0000-000000000605', 'aaaa1111-0000-0000-0000-000000000313');

-- Camps : le plus RÉCEMMENT créé part le plus tard, le plus ancien part le plus tôt, et celui du
-- milieu n'a plus qu'un départ passé — trois ordres différents selon la règle appliquée.
insert into products
  (id, partner_id, establishment_id, type, slug, name, price_cop, sellable, duration_days, created_at)
values
  ('aaaa1111-0000-0000-0000-000000000511', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000b', 'camp', 'sc-camp-lejos',
   '{"es":"Zqcamp lejos"}'::jsonb, 500000, true, 3, timestamptz '2030-01-03 12:00+00'),
  ('aaaa1111-0000-0000-0000-000000000512', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000b', 'camp', 'sc-camp-pasado',
   '{"es":"Zqcamp pasado"}'::jsonb, 500000, true, 3, timestamptz '2030-01-02 12:00+00'),
  ('aaaa1111-0000-0000-0000-000000000513', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000b', 'camp', 'sc-camp-cerca',
   '{"es":"Zqcamp cerca"}'::jsonb, 500000, true, 3, timestamptz '2030-01-01 12:00+00');

insert into product_availability (product_id, date, capacity, booked) values
  ('aaaa1111-0000-0000-0000-000000000511', today_in_bogota() + 20, 20, 0),
  ('aaaa1111-0000-0000-0000-000000000512', today_in_bogota() - 3, 20, 0),
  -- Deux départs : c'est le PROCHAIN qui classe, pas le premier jamais saisi (déjà passé).
  ('aaaa1111-0000-0000-0000-000000000513', today_in_bogota() - 30, 20, 0),
  ('aaaa1111-0000-0000-0000-000000000513', today_in_bogota() + 5, 20, 0);

-- Events : trois ponctuels à venir, deux récurrents (dont un SANS date d'ancrage — la forme réelle
-- de « Kayam's Jam » dans mockData), un ponctuel passé.
insert into products (
  id, partner_id, establishment_id, type, slug, name, price_cop, sellable,
  occurrence_type, occurrence_date, recurrence_frequency_days
) values
  ('aaaa1111-0000-0000-0000-000000000411', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000b', 'evento', 'sc-alt-puntual-1',
   '{"es":"Zqalt puntual uno"}'::jsonb, 50000, true, 'once', today_in_bogota() + 3, null),
  ('aaaa1111-0000-0000-0000-000000000412', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000b', 'evento', 'sc-alt-puntual-2',
   '{"es":"Zqalt puntual dos"}'::jsonb, 50000, true, 'once', today_in_bogota() + 12, null),
  ('aaaa1111-0000-0000-0000-000000000413', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000b', 'evento', 'sc-alt-puntual-3',
   '{"es":"Zqalt puntual tres"}'::jsonb, 50000, true, 'once', today_in_bogota() + 40, null),
  -- Ancre à −70 j, tous les 7 j : sa prochaine occurrence tombe AUJOURD'HUI, donc avant tous les
  -- ponctuels. Par prochaine date seule, il serait premier.
  ('aaaa1111-0000-0000-0000-000000000414', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000b', 'evento', 'sc-alt-recurrente-1',
   '{"es":"Zqalt recurrente uno"}'::jsonb, 50000, true, 'recurring', today_in_bogota() - 70, 7),
  ('aaaa1111-0000-0000-0000-000000000415', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000b', 'evento', 'sc-alt-recurrente-2',
   '{"es":"Zqalt recurrente dos"}'::jsonb, 50000, true, 'recurring', null, 14),
  ('aaaa1111-0000-0000-0000-000000000416', 'aaaa1111-0000-0000-0000-000000000001',
   'aaaa1111-0000-0000-0000-00000000000b', 'evento', 'sc-alt-pasado',
   '{"es":"Zqalt pasado"}'::jsonb, 50000, true, 'once', today_in_bogota() - 2, null);

set local role anon;

-- ── Visibilité ──────────────────────────────────────────────────────────────────────────────────
select is(
  (select count(*)::int from search_catalog(p_limite => 100000)
   where id = 'aaaa1111-0000-0000-0000-000000000103'),
  0, 'un produit non vendable n''apparaît jamais'
);

select is(
  (select count(*)::int from search_catalog(p_limite => 100000)
   where id = 'aaaa1111-0000-0000-0000-000000000105'),
  0, 'un produit d''un établissement archivé n''apparaît jamais'
);

-- ── Regroupement d'établissement ────────────────────────────────────────────────────────────────
select is(
  (select count(*)::int from search_catalog(p_limite => 100000)
   where id = 'aaaa1111-0000-0000-0000-00000000000a' and es_establecimiento),
  1, 'un établissement à deux couchages vendables sort comme UNE carte'
);

select is(
  (select count(*)::int from search_catalog(p_limite => 100000)
   where id in ('aaaa1111-0000-0000-0000-000000000101',
                'aaaa1111-0000-0000-0000-000000000102')),
  0, 'ses couchages n''apparaissent PAS en plus de la carte groupée'
);

select is(
  (select count(*)::int from search_catalog(p_limite => 100000)
   where id = 'aaaa1111-0000-0000-0000-000000000104' and not es_establecimiento),
  1, 'un établissement à un seul couchage n''est pas groupé — le produit sort seul'
);

select is(
  (select count(*)::int from search_catalog(p_limite => 100000)
   where id = 'aaaa1111-0000-0000-0000-00000000000b' and es_establecimiento),
  0, '…et son établissement ne sort pas comme carte'
);

-- ── Prix ────────────────────────────────────────────────────────────────────────────────────────
select is(
  (select precio_desde from search_catalog(p_limite => 100000)
   where id = 'aaaa1111-0000-0000-0000-00000000000a'),
  90000::bigint, 'la carte groupée porte le prix MINIMUM de ses couchages vendables'
);

select is(
  (select precio_cop from search_catalog(p_limite => 100000)
   where id = 'aaaa1111-0000-0000-0000-000000000104'),
  150000::bigint, 'une carte produit porte son propre prix'
);

-- ── Total de section : des CARTES, pas des produits ─────────────────────────────────────────────
-- A donne 1 carte (2 couchages groupés) + B donne 1 carte = 2, jamais 3.
select ok(
  (select total_seccion from search_catalog(p_limite => 100000)
   where id = 'aaaa1111-0000-0000-0000-00000000000a') >= 2,
  'total_seccion compte des cartes, pas des produits (le regroupement précède le comptage)'
);

-- ── Recherche texte ─────────────────────────────────────────────────────────────────────────────
select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_query => 'guatape')
   where id = 'aaaa1111-0000-0000-0000-000000000104'),
  1, 'unaccent : « guatape » sans accent trouve « Guatapé »'
);

select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_query => 'JETSKI')
   where id = 'aaaa1111-0000-0000-0000-000000000201'),
  1, 'la recherche ignore la casse'
);

select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_query => 'Cabaña Sola')
   where id = 'aaaa1111-0000-0000-0000-000000000201'),
  1, 'chercher un nom d''établissement remonte ses offres'
);

-- ── Filtre personas : la colonne juste de chaque type ────────────────────────────────────────────
select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_personas => 4)
   where id = 'aaaa1111-0000-0000-0000-000000000104'),
  1, 'un logement de capacité 6 passe le filtre « 4 personnes »'
);

select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_personas => 4)
   where id = 'aaaa1111-0000-0000-0000-000000000201'),
  0, 'une activité bornée à max_qty=2 ne passe pas « 4 personnes »'
);

select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_personas => 99)
   where id = 'aaaa1111-0000-0000-0000-000000000202'),
  1, 'une borne ABSENTE ne filtre pas — sinon un trou de saisie cacherait une offre réelle'
);

-- ── Filtre dates : le calendrier est CREUX ──────────────────────────────────────────────────────
select is(
  (select count(*)::int
   from search_catalog(p_limite => 100000, p_desde => date '2030-03-10', p_hasta => date '2030-03-11')
   where id in ('aaaa1111-0000-0000-0000-000000000203',   -- fermée sur TOUTE la plage
                'aaaa1111-0000-0000-0000-000000000202')), -- aucune ligne : défaut = ouvert
  1, 'fermée sur toute la plage → absente ; sans ligne de calendrier → présente (défaut ouvert)'
);

-- ── Filtre dates : camp (product_availability, calendrier fixe par départ, 20260916110000) ──────
select is(
  (select count(*)::int
   from search_catalog(
     p_limite => 100000, p_desde => today_in_bogota() + 1, p_hasta => today_in_bogota() + 5
   )
   where id = 'aaaa1111-0000-0000-0000-000000000501'),
  0, 'camp : aucun départ dans la plage → absent (product_calendar resterait vacuously ouvert)'
);

select is(
  (select count(*)::int
   from search_catalog(
     p_limite => 100000, p_desde => today_in_bogota() + 28, p_hasta => today_in_bogota() + 32
   )
   where id = 'aaaa1111-0000-0000-0000-000000000501'),
  1, 'camp : la plage chevauche [départ, départ+duration_days-1] → présent'
);

-- ── Filtre dates : evento (occurrence_type/occurrence_date, jamais product_calendar) ────────────
select is(
  (select count(*)::int
   from search_catalog(
     p_limite => 100000, p_desde => today_in_bogota() + 1, p_hasta => today_in_bogota() + 5
   )
   where id = 'aaaa1111-0000-0000-0000-000000000402'), -- E2, occurrence ponctuelle à +10j
  0, 'evento ponctuel : occurrence hors plage → absent'
);

select is(
  (select count(*)::int
   from search_catalog(
     p_limite => 100000, p_desde => today_in_bogota() + 8, p_hasta => today_in_bogota() + 12
   )
   where id = 'aaaa1111-0000-0000-0000-000000000402'),
  1, 'evento ponctuel : occurrence dans la plage → présent'
);

-- ── Filtre dates : activity à créneaux (product_slot_rules.weekdays, jamais product_calendar) ───
select is(
  (select count(*)::int
   from search_catalog(p_limite => 100000, p_desde => date '2030-03-11', p_hasta => date '2030-03-16')
   where id = 'aaaa1111-0000-0000-0000-000000000204'),
  0, 'activity à créneaux : aucun jour de la semaine du créneau dans la plage → absente'
);

select is(
  (select count(*)::int
   from search_catalog(p_limite => 100000, p_desde => date '2030-03-08', p_hasta => date '2030-03-10')
   where id = 'aaaa1111-0000-0000-0000-000000000204'),
  1, 'activity à créneaux : la plage contient le jour de la semaine du créneau → présente'
);

-- ── Filtre par tag, et le slug inconnu (spec 29 §6c) ────────────────────────────────────────────
select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_tag_slug => 'sc-tag-kayak')
   where id = 'aaaa1111-0000-0000-0000-000000000201'),
  1, 'un tag connu remonte l''offre qui le porte'
);

select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_tag_slug => 'sc-tag-kayak')
   where id = 'aaaa1111-0000-0000-0000-000000000202'),
  0, '…et écarte celle qui ne le porte pas'
);

-- ⚠️ LE correctif du 2026-09-08 (spec 28 §10quinquies). Avant lui, un slug absent de catalog_tags
-- filtrait TOUT : la page restait vide, et comme le bloc de recherche reportait le paramètre à
-- chaque soumission, elle ne se déverrouillait plus jamais. Un tag inconnu est un paramètre
-- invalide, donc il est IGNORÉ — exactement comme un `tipo` inconnu.
select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_tag_slug => 'zzz-inexistant')
   where id = 'aaaa1111-0000-0000-0000-000000000202'),
  1, 'un slug de tag INCONNU est ignoré — il ne filtre rien'
);

-- ── p_sin_tag : la page « Otras actividades » (spec 29 §0) ──────────────────────────────────────
select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_sin_tag => true)
   where id = 'aaaa1111-0000-0000-0000-000000000201'),
  0, 'p_sin_tag écarte une offre qui porte au moins un tag'
);

select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_sin_tag => true)
   where id = 'aaaa1111-0000-0000-0000-000000000202'),
  1, '…et garde celle qu''aucune catégorie ne classe'
);

-- ── n_alojamientos : le décompte d'une carte groupée (spec 30 §3.6) ─────────────────────────────
-- L'établissement A porte TROIS couchages, dont un NON vendable ; le visiteur doit lire 2.
--
-- ⚠️ CE QUE CETTE ASSERTION PROUVE, ET CE QU'ELLE NE PROUVE PAS — mesuré par mutation le
-- 2026-09-08, et écrit ici parce que le contraire se croit facilement. Remplacer le décompte par
-- un compte BRUT (`select count(*) from products where establishment_id = … and type = 'lodging'`,
-- sans aucun filtre `sellable`) NE FAIT PAS rougir cette assertion : tout ce fichier tourne en
-- `anon` (l. 85), et la policy `products_select_public` écarte déjà le non-vendable avant que le
-- décompte ne compte quoi que ce soit. En `postgres`, la même mutation rend bien 3.
--
-- L'assertion vérifie donc la propriété qui compte POUR L'ÉCRAN — « le visiteur lit le nombre de
-- couchages qu'il peut réellement réserver » —, et cette propriété est tenue DEUX fois : par le
-- prédicat de `candidatos` et par la RLS. Elle ne verrouille pas le prédicat à elle seule, et
-- prétendre le contraire ferait croire à un filet qui n'existe pas.
select is(
  (select n_alojamientos from search_catalog(p_limite => 100000)
   where id = 'aaaa1111-0000-0000-0000-00000000000a' and es_establecimiento),
  2::bigint, 'une carte groupée annonce le nombre de couchages VISIBLES par le visiteur (2 sur 3)'
);

-- `null`, jamais 0 : « 0 alojamientos » se lirait « cet établissement n'en a aucun », alors que la
-- carte est justement celle d'une offre isolée.
select is(
  (select n_alojamientos from search_catalog(p_limite => 100000)
   where id = 'aaaa1111-0000-0000-0000-000000000104'),
  null::bigint, 'une carte NON groupée n''annonce aucun décompte — null, jamais 0'
);

select is(
  (select n_alojamientos from search_catalog(p_limite => 100000)
   where id = 'aaaa1111-0000-0000-0000-000000000201'),
  null::bigint, '…et une activité non plus'
);

-- ── Bifurcation établissement/produit du filtre par tag (chantier "catégories partout", 2026-09-14) ─
-- cf. commentaire de tête de la migration `search_catalog_tag_bifurcation` : un tag posé sur
-- `establishment_tag_assignments` décide pour une carte GROUPÉE, un tag posé sur
-- `product_tag_assignments` décide pour une carte PRODUIT — jamais l'inverse.
select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_tag_slug => 'sc-tag-piscina')
   where id = 'aaaa1111-0000-0000-0000-00000000000a' and es_establecimiento),
  1, 'un tag posé sur l''ÉTABLISSEMENT groupé le fait apparaître comme carte groupée'
);

select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_tag_slug => 'sc-tag-piscina')
   where id = 'aaaa1111-0000-0000-0000-000000000104' and not es_establecimiento),
  1, '…et le MÊME slug, posé sur un PRODUIT non groupé, fait apparaître sa carte produit'
);

select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_tag_slug => 'sc-tag-vista')),
  0,
  'un tag posé sur une CHAMBRE d''un établissement groupé n''a aucun effet — seul le tag de l''établissement compte pour une carte groupée'
);

select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_sin_tag => true)
   where id = 'aaaa1111-0000-0000-0000-00000000000d' and es_establecimiento),
  1, 'p_sin_tag garde une carte groupée qu''AUCUN tag d''établissement ne classe'
);

select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_sin_tag => true)
   where id = 'aaaa1111-0000-0000-0000-00000000000a' and es_establecimiento),
  0, '…et écarte une carte groupée dont l''établissement porte un tag'
);

-- ── Logement unique : il hérite des tags de son établissement (2026-10-13) ───────────────────────
-- Même règle que dans `search_catalog_categorias` (migration 20261013192000) : sans elle, l'index
-- des catégories montrerait une catégorie que cette page-ci rendrait vide.
select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_tag_slug => 'sc-tag-heredado')
   where id = 'aaaa1111-0000-0000-0000-000000000108' and not es_establecimiento),
  1, 'un tag posé sur l''ÉTABLISSEMENT d''un couchage unique fait apparaître sa carte produit'
);

select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_tag_slug => 'sc-tag-heredado')
   where id = 'aaaa1111-0000-0000-0000-000000000205'),
  0, '…mais pas une ACTIVITÉ du même établissement : seul un couchage unique hérite'
);

select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_sin_tag => true)
   where id = 'aaaa1111-0000-0000-0000-000000000108'),
  0, 'p_sin_tag écarte un couchage unique dont l''établissement porte un tag'
);

select is(
  (select count(*)::int from search_catalog(p_limite => 100000, p_sin_tag => true)
   where id = 'aaaa1111-0000-0000-0000-000000000205'),
  1, '…et garde l''activité du même établissement, que rien ne classe'
);

-- ── Tri des evento par prochaine occurrence (2026-09-15) ────────────────────────────────────────
-- En ORDRE RELATIF entre les fixtures E1-E5 ci-dessus, jamais un rango_seccion absolu (d'autres
-- evento peuvent exister ailleurs dans la base, cf. discipline de ce fichier en en-tête).
select ok(
  (select rango_seccion from search_catalog(p_limite => 100000, p_tipos => array['evento'])
    where id = 'aaaa1111-0000-0000-0000-000000000402') -- E2, +10j
  <
  (select rango_seccion from search_catalog(p_limite => 100000, p_tipos => array['evento'])
    where id = 'aaaa1111-0000-0000-0000-000000000401'), -- E1, +30j
  'evento ponctuel le plus proche (+10j) est classé avant celui le plus éloigné (+30j)'
);

-- ⚠️ L'assertion « un récurrent plus proche passe avant un ponctuel » a été RETIRÉE le 2026-10-13 :
-- depuis la migration 20261013215000 les ponctuels et les récurrents alternent, et le rang d'un
-- récurrent par rapport à un ponctuel dépend alors du nombre d'events de chaque sorte présents dans
-- la base. L'alternance s'affirme plus bas, en ordre exact, sur un lot isolé par `p_query`.
select ok(
  (select rango_seccion from search_catalog(p_limite => 100000, p_tipos => array['evento'])
    where id = 'aaaa1111-0000-0000-0000-000000000404') -- E4, récurrent en cours
  <
  (select rango_seccion from search_catalog(p_limite => 100000, p_tipos => array['evento'])
    where id = 'aaaa1111-0000-0000-0000-000000000403'), -- E3, ponctuel déjà passé
  'evento récurrent en cours est classé avant un ponctuel déjà passé'
);

select ok(
  (select rango_seccion from search_catalog(p_limite => 100000, p_tipos => array['evento'])
    where id = 'aaaa1111-0000-0000-0000-000000000403') -- E3, ponctuel déjà passé
  >
  (select rango_seccion from search_catalog(p_limite => 100000, p_tipos => array['evento'])
    where id = 'aaaa1111-0000-0000-0000-000000000401'), -- E1, à venir
  'evento ponctuel déjà passé (aucune occurrence à venir) est classé après tous ceux à venir'
);

select ok(
  (select rango_seccion from search_catalog(p_limite => 100000, p_tipos => array['evento'])
    where id = 'aaaa1111-0000-0000-0000-000000000405') -- E5, série récurrente terminée
  >
  (select rango_seccion from search_catalog(p_limite => 100000, p_tipos => array['evento'])
    where id = 'aaaa1111-0000-0000-0000-000000000401'), -- E1, à venir
  'evento récurrent dont la série est terminée (recurrence_end_date passée) est classé après ceux à venir'
);

-- ── Ordre des cartes dans une section (2026-10-13) ──────────────────────────────────────────────
-- Chaque lot est isolé par son mot inventé (cf. les fixtures) : l'ordre s'affirme en entier.
select is(
  (select string_agg(slug, ' ' order by rango_seccion)
   from search_catalog(p_limite => 100000, p_tipos => array['activity'], p_query => 'zqmix')),
  'sc-mix-1 sc-mix-4 sc-mix-2 sc-mix-5 sc-mix-3',
  'activités : les catégories alternent — jamais deux cartes « agua » de suite quand c''est évitable'
);

select is(
  (select string_agg(slug, ' ' order by rango_seccion)
   from search_catalog(
     p_limite => 100000, p_tipos => array['activity'], p_query => 'zqmix', p_por_tipo => 3
   )),
  'sc-mix-1 sc-mix-4 sc-mix-2',
  'le plafond par section coupe APRÈS le mélange : les trois premières cartes sont déjà mélangées'
);

select is(
  (select string_agg(slug, ' ' order by rango_seccion)
   from search_catalog(p_limite => 100000, p_tipos => array['camp'], p_query => 'zqcamp')),
  'sc-camp-cerca sc-camp-lejos sc-camp-pasado',
  'camps : par prochain départ, du plus proche au plus lointain ; sans départ à venir, en dernier'
);

select is(
  (select string_agg(slug, ' ' order by rango_seccion)
   from search_catalog(p_limite => 100000, p_tipos => array['evento'], p_query => 'zqalt')),
  'sc-alt-puntual-1 sc-alt-recurrente-1 sc-alt-puntual-2 sc-alt-recurrente-2 sc-alt-puntual-3 sc-alt-pasado',
  'events : le ponctuel le plus proche, un récurrent, le ponctuel suivant, un récurrent… les passés en dernier'
);

select * from finish();
rollback;

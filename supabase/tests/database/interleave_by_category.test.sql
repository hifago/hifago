-- `interleave_by_category` (migration 20261013215000_search_catalog_orden_portada.sql) — l'ordre
-- qui mélange les catégories d'une section. Seul consommateur : `search_catalog`.
--
-- Entrée : la catégorie de chaque carte, dans l'ordre de base (la plus récente d'abord).
-- Sortie : à l'indice i, la POSITION (1 = première) de la carte i dans la section.
--
-- Fonction pure : aucune table lue, donc aucune fixture — et aucune dépendance au contenu de la
-- base locale. Tourne en `anon`, le rôle réel du seul appelant (`search_catalog`, SECURITY
-- INVOKER) : ce fichier verrouille au passage qu'elle reste exécutable par ce rôle.

begin;
select plan(9);

set local role anon;

select is(
  interleave_by_category('{}'::text[]),
  '{}'::int[],
  'aucune carte → aucun rang'
);

select is(
  interleave_by_category(array['agua', 'arte', 'musica']),
  array[1, 2, 3],
  'trois catégories différentes → l''ordre de base est conservé (la plus récente d''abord)'
);

select is(
  interleave_by_category(array['agua', 'agua', 'agua']),
  array[1, 2, 3],
  'une seule catégorie → rien à mélanger, l''ordre de base est conservé'
);

select is(
  interleave_by_category(array['agua', 'agua', 'arte', 'arte']),
  array[1, 3, 2, 4],
  'deux catégories à égalité → elles alternent'
);

-- LE cas qu'un tour de rôle naïf rate : il servirait agua, arte, musica puis agua, agua.
select is(
  interleave_by_category(array['agua', 'agua', 'agua', 'arte', 'musica']),
  array[1, 3, 5, 2, 4],
  'une catégorie majoritaire est répartie : agua, arte, agua, musica, agua — aucune paire'
);

select is(
  interleave_by_category(array['arte', 'agua', 'agua', 'agua', 'musica']),
  array[2, 1, 3, 5, 4],
  '…même quand la carte la plus récente n''est pas de la catégorie majoritaire'
);

-- Variété : avec quatre catégories, les quatre passent AVANT qu'aucune ne revienne.
select is(
  interleave_by_category(array['agua', 'agua', 'arte', 'arte', 'musica', 'musica', 'yoga', 'yoga']),
  array[1, 5, 2, 6, 3, 7, 4, 8],
  'quatre catégories → un tour complet avant qu''une catégorie ne revienne'
);

-- Inévitable : cinq cartes « agua » pour deux autres. Les paires restantes vont À LA FIN.
select is(
  interleave_by_category(array['agua', 'agua', 'agua', 'agua', 'agua', 'arte', 'musica']),
  array[1, 3, 5, 6, 7, 2, 4],
  'paires inévitables → repoussées en fin de section, jamais en tête'
);

-- Une carte sans étiquette (null) forme sa propre famille : elle s'intercale comme les autres.
select is(
  interleave_by_category(array['agua', 'agua', null, null]),
  array[1, 3, 2, 4],
  'les cartes sans catégorie s''intercalent entre les cartes classées'
);

select * from finish();
rollback;

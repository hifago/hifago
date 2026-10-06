#!/usr/bin/env bash
# Comptes de lignes de la base locale, table par table (audit P12e, 2026-10-06).
#
#   bash scripts/db-row-counts.sh                 → imprime « schéma.table=n », une ligne par table
#   bash scripts/db-row-counts.sh --compare <f>   → recompte et compare à <f> (la sortie d'un appel
#                                                   précédent) : exit 1 et les écarts si une table a
#                                                   bougé, 2 si <f> est vide ou absent.
#
# POURQUOI. Les tests de concurrence écrivent dans la base (fixtures, commandes, paiements…). Dix
# d'entre eux ne purgeaient qu'AVANT chaque run, jamais après le dernier : ~530 lignes laissées à
# chaque passage sur la pile locale partagée, de quoi faire rougir des pgTAP sans défaut. Le job CI
# `concurrence` compte donc les lignes avant et après `npm run test:concurrency` : une table qui a
# bougé désigne un fichier qui a oublié sa purge finale (CLAUDE.md §11.20).
#
# Toutes les tables de `public` plus `auth.users`, sans liste à tenir : un test neuf est couvert sans
# que son auteur ait à y penser.
set -euo pipefail

DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

compter() {
  psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1 <<'SQL'
select format('%I.%I', table_schema, table_name) || '=' ||
       (xpath('/row/c/text()',
              query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name),
                           false, true, '')))[1]::text
  from information_schema.tables
 where table_type = 'BASE TABLE'
   and (table_schema = 'public' or (table_schema = 'auth' and table_name = 'users'))
 order by 1;
SQL
}

if [ "${1:-}" = "--compare" ]; then
  reference="${2:-}"
  if [ -z "$reference" ] || [ ! -s "$reference" ]; then
    echo "✗ db-row-counts : fichier de référence vide ou absent (${reference:-non fourni}) — comparaison impossible." >&2
    exit 2
  fi
  apres="$(compter)"
  if ! ecarts="$(diff "$reference" <(printf '%s\n' "$apres"))"; then
    echo "✗ Des lignes ont été laissées ou retirées (< avant, > après) :"
    printf '%s\n' "$ecarts" | grep '^[<>]'
    exit 1
  fi
  echo "✓ db-row-counts : $(printf '%s\n' "$apres" | wc -l | tr -d ' ') tables, aucun écart."
  exit 0
fi

compter

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
#
# SAUF ce que pg_cron écrit de lui-même pendant la mesure, nommément (2026-10-14, job `concurrence`
# rouge sur #90 : `job_heartbeats` 1 → 6 sans qu'aucun test n'y touche). En CI le Vault ne porte
# aucune clé de service : les wrappers `invoke_*` ne font rien, et seuls deux jobs écrivent —
#   • les watchdogs (`jobs-watchdog`, `payments-reconcile-watchdog`, toutes les 15 min) : ils créent
#     les lignes de `job_heartbeats` des jobs attendus → table EXCLUE ;
#   • les mêmes, quand un job paraît arrêté : une alerte `admin_job_stalled` par admin dans
#     `notification_emails` → table comptée SANS ces lignes (les tests y écrivent d'autres e-mails,
#     qui doivent rester comptés).
# Aucun test de concurrence n'écrit dans `job_heartbeats` ni d'alerte `admin_job_stalled` (vérifié) :
# ces exclusions ne masquent aucun résidu de test. Reste compté, risque nommé : le roulement des
# disponibilités d'hébergement (`roll-lodging-availability`, 08:00 UTC chaque jour) écrit dans
# `product_availability`, table que les tests écrivent aussi — un run qui chevauche 08:00 UTC peut
# rougir sans défaut.
set -euo pipefail

DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

compter() {
  psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1 <<'SQL'
select format('%I.%I', table_schema, table_name) || filtre.libelle || '=' ||
       (xpath('/row/c/text()',
              query_to_xml(format('select count(*) as c from %I.%I %s', table_schema, table_name, filtre.clause),
                           false, true, '')))[1]::text
  from information_schema.tables
  cross join lateral (
    select case when table_schema = 'public' and table_name = 'notification_emails'
                then ' (hors admin_job_stalled)' else '' end as libelle,
           case when table_schema = 'public' and table_name = 'notification_emails'
                then 'where event_type <> ''admin_job_stalled''' else '' end as clause
  ) filtre
 where table_type = 'BASE TABLE'
   and (table_schema = 'public' or (table_schema = 'auth' and table_name = 'users'))
   and not (table_schema = 'public' and table_name = 'job_heartbeats')
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

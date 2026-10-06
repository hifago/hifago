#!/usr/bin/env bash
# Garde-fou — chaque Edge Function de job est contrôlée, supervisée sous le nom de son cron, et
# déclarée `verify_jwt = true` (CLAUDE.md §11.20).
#
#   ./scripts/check-edge-jobs.sh   (depuis hifago/)   — exit 1 si une règle est violée, 2 si le
#                                                      périmètre est introuvable.
#
# Pour chaque dossier `supabase/functions/<nom>/` (hors `_shared`, et il a un `index.ts`) :
#   1. `index.ts` importe `serveJob` de `../_shared/job.ts` et l'appelle — une fois, sous SON nom :
#      c'est serveJob qui contrôle l'appelant (requireServiceRole) AVANT tout, et qui écrit le
#      heartbeat. Un heartbeat sous un autre nom que celui du cron rendrait le job muet pour
#      toujours (jobs_watchdog ne surveille que les noms de crons) ;
#   2. `supabase/config.toml` porte `[functions.<nom>]` avec `verify_jwt = true`, sans `entrypoint`
#      (qui ferait servir un autre fichier que l'`index.ts` contrôlé ici) ;
#   3. une migration planifie un cron `<nom>` (cron.schedule) et un wrapper appelle
#      `/functions/v1/<nom>` ;
#   4. aucun `heartbeat_job` n'est écrit hors de `_shared/job.ts`.
# Et partout sous supabase/functions, hors `_shared/job.ts` : aucun fichier ne sert lui-même
# (`Deno.serve`, `Deno["serve"]`, `serve(` de std/http, `Deno.listen`, écouteur `fetch`) ;
# `_shared/job.ts` refuse l'appelant en PREMIÈRE instruction de son handler
# (`requireServiceRole(request)` puis `if (refused) return refused;`) ; `_shared/requireServiceRole.ts`
# compare bien l'en-tête Authorization à SUPABASE_SERVICE_ROLE_KEY (bearerMatchesKey) et ne rend
# null que sur égalité ; aucune section `[functions.*]` ne vise un dossier disparu.
set -uo pipefail

racine="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$racine"

config="supabase/config.toml"
job="supabase/functions/_shared/job.ts"
fautes=0
faute() {
  printf '  ✗ %s\n' "$1"
  fautes=$((fautes + 1))
}

# Le code sans ses commentaires `//` et `/* … */` (un appel cité en commentaire n'est pas un appel).
# Lecture de gauche à droite : le premier de { commentaire, chaîne } qui commence l'emporte — `//`
# dans une chaîne (une URL) reste du code, `/*` dans un commentaire `//` n'ouvre rien. Les sources
# des fonctions n'ont aucun littéral regex (une apostrophe dans l'un d'eux tromperait ce découpage).
sans_commentaires() {
  perl -0pe 's{(//[^\n]*)|(/\*.*?\*/)|("(?:\\.|[^"\\\n])*"|\x27(?:\\.|[^\x27\\\n])*\x27|`(?:\\.|[^`\\])*`)}{defined $3 ? $3 : ""}gse' "$1"
}

noms=()
for dossier in supabase/functions/*/; do
  nom="$(basename "$dossier")"
  [ "$nom" = "_shared" ] && continue
  if [ ! -f "$dossier/index.ts" ]; then
    faute "supabase/functions/$nom : dossier sans index.ts — une fonction déployée ailleurs que par index.ts échapperait à ce contrôle"
    continue
  fi
  noms+=("$nom")
done
if [ "${#noms[@]}" -eq 0 ]; then
  echo "check-edge-jobs : aucune fonction trouvée sous supabase/functions — périmètre introuvable" >&2
  exit 2
fi
if [ ! -f "$job" ]; then
  echo "check-edge-jobs : $job introuvable" >&2
  exit 2
fi

if ! sans_commentaires "$job" | perl -0ne 'exit(/Deno\.serve\(\s*async\s*\(request\)\s*=>\s*\{\s*const refused = await requireServiceRole\(request\);\s*if \(refused\) return refused;/ ? 0 : 1)'; then
  faute "$job : le handler de serveJob ne commence plus par requireServiceRole(request) puis if (refused) return refused;"
fi
garde="supabase/functions/_shared/requireServiceRole.ts"
if [ ! -f "$garde" ]; then
  faute "$garde introuvable"
elif ! sans_commentaires "$garde" | perl -0ne 'exit(/import \{ bearerMatchesKey \} from "\.\.\/\.\.\/\.\.\/packages\/domain\/src\/http\/bearerMatchesKey\.ts";.*export async function requireServiceRole\(request: Request\): Promise<Response \| null> \{\s*const allowed = await bearerMatchesKey\(\s*request\.headers\.get\("authorization"\),\s*Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\) \?\? ""\s*\);\s*if \(allowed\) return null;\s*return new Response\([^;]*status: 401/s ? 0 : 1)'; then
  faute "$garde : ne compare plus l'en-tête Authorization à SUPABASE_SERVICE_ROLE_KEY, ou ne rend plus null que sur égalité (401 sinon)"
fi

for nom in "${noms[@]}"; do
  fichier="supabase/functions/$nom/index.ts"
  code="$(sans_commentaires "$fichier")"

  if ! printf '%s\n' "$code" | perl -0ne 'exit(/import\s*\{[^}]*\bserveJob\b[^}]*\}\s*from\s*["\x27]\.\.\/_shared\/job\.ts["\x27]/ ? 0 : 1)'; then
    faute "$fichier : serveJob n'est pas importé de \"../_shared/job.ts\""
  fi
  # Tout appel à serveJob compte, quel que soit son premier argument.
  total="$(printf '%s\n' "$code" | grep -oE '\bserveJob[[:space:]]*\(' | grep -c .)"
  appels="$(printf '%s\n' "$code" | perl -0ne 'print "$1\n" while /\bserveJob\s*\(\s*["\x27`]([^"\x27`]*)["\x27`]/g')"
  if [ "$total" -ne 1 ] || [ "$(printf '%s\n' "$appels" | grep -c .)" -ne 1 ]; then
    faute "$fichier : serveJob(\"$nom\", …) doit apparaître exactement une fois, nom littéral"
  elif [ "$appels" != "$nom" ]; then
    faute "$fichier : serveJob(\"$appels\") — le heartbeat doit porter le nom du cron et du dossier, \"$nom\""
  fi

  # Section [functions.<nom>] : verify_jwt = true avant la section suivante.
  if ! awk -v section="[functions.$nom]" '
      $0 == section { dans = 1; next }
      /^\[/ { dans = 0 }
      dans && /^[[:space:]]*verify_jwt[[:space:]]*=[[:space:]]*true[[:space:]]*$/ { ok = 1 }
      END { exit ok ? 0 : 1 }' "$config"; then
    faute "$config : [functions.$nom] avec verify_jwt = true manquant"
  fi
  if awk -v section="[functions.$nom]" '
      $0 == section { dans = 1; next }
      /^\[/ { dans = 0 }
      dans && /^[[:space:]]*entrypoint[[:space:]]*=/ { trouve = 1 }
      END { exit trouve ? 0 : 1 }' "$config"; then
    faute "$config : [functions.$nom] porte un entrypoint — seul index.ts est contrôlé"
  fi

  if ! grep -qE "cron\.schedule\([[:space:]]*'$nom'" supabase/migrations/*.sql; then
    faute "supabase/migrations : aucun cron.schedule('$nom', …)"
  fi
  if ! grep -q "/functions/v1/$nom'" supabase/migrations/*.sql; then
    faute "supabase/migrations : aucun wrapper n'appelle /functions/v1/$nom"
  fi
done

# Une section de config pour un dossier qui n'existe plus.
while IFS= read -r section; do
  nom="${section#\[functions.}"
  nom="${nom%\]}"
  if [ ! -f "supabase/functions/$nom/index.ts" ]; then
    faute "$config : [functions.$nom] ne correspond à aucune fonction"
  fi
done < <(grep -E '^\[functions\.[^]]+\]$' "$config")

# Le heartbeat n'est écrit, et une requête n'est servie, QUE par le squelette commun — dans tout
# fichier sous supabase/functions, pas seulement les index.ts (un module voisin qui sert lui-même
# serait déployé avec la fonction).
while IFS= read -r fichier; do
  [ "$fichier" = "$job" ] && continue
  code="$(sans_commentaires "$fichier")"
  if printf '%s\n' "$code" | perl -0ne 'exit(/["\x27`]heartbeat_job["\x27`]/ ? 0 : 1)'; then
    faute "$fichier : heartbeat_job écrit hors de _shared/job.ts"
  fi
  if printf '%s\n' "$code" | perl -0ne 'exit(/Deno\s*(\.\s*(serve|listen|serveHttp)\b|\[)|(^|[^A-Za-z0-9_.\$])serve\s*\(|addEventListener\s*\(\s*["\x27`]fetch/m ? 0 : 1)'; then
    faute "$fichier : sert lui-même — passer par serveJob (contrôle d'appelant, heartbeat)"
  fi
done < <(find supabase/functions -name '*.ts' -type f | sort)

if [ "$fautes" -gt 0 ]; then
  echo "check-edge-jobs : $fautes faute(s) sur ${#noms[@]} fonction(s)"
  exit 1
fi
echo "check-edge-jobs : ${#noms[@]} fonction(s) contrôlée(s), supervisée(s) sous le nom de leur cron, verify_jwt explicite"

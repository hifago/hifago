#!/usr/bin/env bash
# CLI Supabase : UNE version, la même partout (audit P12d, 2026-10-06).
#
#   ./scripts/check-supabase-cli-version.sh   (depuis hifago/)   — exit 1 si une version diverge,
#                                                                 2 si un témoin est introuvable.
#
# POURQUOI. La CLI n'était épinglée nulle part dans le dépôt : `npx supabase` (db-setup.sh, les
# commandes de types, les migrations locales) prenait la dernière version du cache npm — 2.119.0 le
# 2026-10-05, avec un autre edge-runtime — pendant que la CI tournait en 2.116.0 (setup-cli). Deux
# machines, deux CLI, deux comportements : un vert local ne prouvait plus rien en CI.
#
# Trois règles :
#   1. `package.json` déclare `supabase` en devDependency, version EXACTE (ni ^ ni ~) : c'est elle que
#      `npx supabase` résout désormais, avant tout cache ;
#   2. `package-lock.json` porte cette même version (un `npm install` qui l'aurait bougée se voit) ;
#   3. chaque étape `uses: supabase/setup-cli@…` des workflows fixe un `version:` égal — une étape SANS
#      `version:` installe la dernière CLI, ce qui est exactement le défaut à empêcher.
set -euo pipefail
cd "$(dirname "$0")/.."

fautes=0
faute() {
  printf '  ✗ %s\n' "$1"
  fautes=$((fautes + 1))
}

# 1. package.json — lu par node (déjà requis par tout le dépôt), pas par grep : l'ordre des clés et
#    l'indentation ne doivent pas décider du résultat.
attendue="$(node -e '
  const p = require("./package.json");
  process.stdout.write((p.devDependencies && p.devDependencies.supabase) || "");
')"
if [ -z "$attendue" ]; then
  echo "✗ package.json : aucune devDependency \`supabase\` — témoin introuvable, contrôle impossible." >&2
  exit 2
fi
if ! printf '%s' "$attendue" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  faute "package.json : supabase = \"$attendue\", attendu une version exacte (x.y.z, sans ^ ni ~)"
fi

# 2. package-lock.json
verrou="$(node -e '
  const l = require("./package-lock.json");
  const e = l.packages && l.packages["node_modules/supabase"];
  process.stdout.write((e && e.version) || "");
')"
if [ -z "$verrou" ]; then
  faute "package-lock.json : aucune entrée node_modules/supabase (lancer npm install)"
elif [ "$verrou" != "$attendue" ]; then
  faute "package-lock.json : supabase $verrou, package.json $attendue"
fi

# 3. Workflows : pour chaque `uses: supabase/setup-cli@`, le `version:` du même pas (avant le pas
#    suivant). Sortie : <fichier>:<ligne>:<version ou VIDE>.
etapes="$(awk '
  FNR == 1 { if (dans) print fichier ":" ligne ":VIDE"; dans = 0 }
  /^[[:space:]]*-[[:space:]]/ && dans { print fichier ":" ligne ":VIDE"; dans = 0 }
  /uses:[[:space:]]*supabase\/setup-cli@/ { dans = 1; fichier = FILENAME; ligne = FNR; next }
  dans && /^[[:space:]]*version:[[:space:]]*/ {
    v = $0; sub(/^[[:space:]]*version:[[:space:]]*/, "", v); sub(/[[:space:]]*(#.*)?$/, "", v)
    gsub(/["'\'']/, "", v)
    print fichier ":" ligne ":" v; dans = 0
  }
  END { if (dans) print fichier ":" ligne ":VIDE" }
' .github/workflows/*.yml)"
if [ -z "$etapes" ]; then
  echo "✗ .github/workflows : aucune étape supabase/setup-cli — témoin introuvable, contrôle impossible." >&2
  exit 2
fi
while IFS=: read -r fichier ligne version; do
  if [ "$version" = "VIDE" ]; then
    faute "$fichier:$ligne : setup-cli sans \`version:\` (installerait la dernière CLI)"
  elif [ "$version" != "$attendue" ]; then
    faute "$fichier:$ligne : setup-cli en $version, package.json en $attendue"
  fi
done <<< "$etapes"

if [ "$fautes" -gt 0 ]; then
  echo "check-supabase-cli-version : $fautes écart(s) — une seule version de CLI, la même partout."
  exit 1
fi
echo "check-supabase-cli-version : CLI $attendue partout (package.json, lockfile, $(printf '%s\n' "$etapes" | wc -l | tr -d ' ') étape(s) setup-cli)"

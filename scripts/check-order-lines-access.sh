#!/usr/bin/env bash
# Garde-fou automatique — aucune lecture de `order_lines` par un client de SESSION dans les apps.
#
# POURQUOI. Le 2026-09-22, `order_lines` a perdu son SELECT pour `authenticated` et ses policies de
# lecture (20260922210000) : toute lecture passe désormais par une RPC `security definer` qui
# borne les colonnes et le périmètre. Les dix `.from("order_lines")` recensés ce jour-là ont été
# convertis — mais quatre lectures sont passées à travers, parce qu'elles partaient d'une AUTRE
# table (`ledger_entries`) et n'atteignaient `order_lines` que par un EMBED PostgREST
# (`order_line:order_lines!inner(...)`), qu'une recherche de `.from("order_lines")` ne voit pas.
# Chaque requête rendait alors « permission denied », avalé par `?? []` : ledger vide et
# commissions à 0 pendant une semaine, sans aucun signal. Ce script cherche les DEUX formes.
#
# Ce qu'il ne couvre pas, volontairement :
#   - les tests (`e2e/`, `*.spec.*`, `*.test.*`) : ils lisent `order_lines` par connexion directe
#     (`withDb`, @hifago/e2e-support), jamais par une session — le grant ne les concerne pas ;
#   - `database.types.ts`, généré, qui décrit la table sans la lire.
#
#   ./scripts/check-order-lines-access.sh   (depuis hifago/)
#
# Sort en erreur (exit 1) si une règle est enfreinte.

set -euo pipefail
cd "$(dirname "$0")/.."

SANS_COMMENTAIRES="scripts/lib/sans-commentaires.pl"
# Même garde de véracité que check-data-layer.sh : sans ce filtre, `perl` échoue, `grep` reçoit du
# vide, le `|| true` neutralise `pipefail` et tout passe sans avoir rien lu. Code 2, distinct du 1.
if [ ! -r "$SANS_COMMENTAIRES" ]; then
  echo "✗ $SANS_COMMENTAIRES introuvable ou illisible — contrôle impossible, pas \"aucune violation\"." >&2
  exit 2
fi
fail=0

# ─────────────────────────────────────────────────────────────────────────────────────────────
# Exemptions : AUCUNE aujourd'hui. La seule qu'il y ait eu, apps/web/app/api/pms/reserve-nights/
# route.ts (lecture/écriture d'`order_lines` par le client `service_role`), a été retirée le
# 2026-10-06 (audit P12f) : depuis 20260930221837 la route passe par des RPC
# (claim_order_for_pms_booking, record_pms_booking, release_pms_reserve_claim) et ne lit plus la
# table. Une exemption qui ne correspond plus à rien laisse passer, en silence, la régression
# qu'elle n'a plus de raison de couvrir. Toute exemption future s'ajoute ici NOMMÉMENT, avec sa
# raison — jamais par commodité.
# ─────────────────────────────────────────────────────────────────────────────────────────────
est_exempte() {
  case "$1" in
    *) return 1 ;;
  esac
}

signale() { # fichier, lignes, explication
  echo "✗ $1"
  echo "$2" | sed 's/^/    /'
  echo "    → $3"
  fail=1
}

fichiers_des_apps() {
  find apps \
    \( -name node_modules -o -name .next -o -name e2e \) -prune -o \
    -type f \( -name '*.ts' -o -name '*.tsx' \) \
    ! -name '*.spec.*' ! -name '*.test.*' ! -name 'database.types.ts' -print 2>/dev/null | sort
}

echo "== Lecture de order_lines par un client de session =="
while IFS= read -r f; do
  est_exempte "$f" && continue
  # `.from("order_lines")` (toute forme de guillemet) et l'embed `order_lines(…)`,
  # `order_lines!inner(…)` ou `order_lines!<clé étrangère>(…)` dans un select PostgREST.
  hits="$(perl -0777 -p "$SANS_COMMENTAIRES" "$f" \
    | grep -nE "\.from\(\s*[\"'\`]order_lines[\"'\`]\s*\)|order_lines(![A-Za-z_]+)?\(" || true)"
  [ -z "$hits" ] && continue
  signale "$f" "$hits" \
    "Lire order_lines par une RPC security definer (ex. admin_ledger_entries_list, 20260930211348) — une session n'a plus le SELECT depuis 20260922210000."
done < <(fichiers_des_apps)

echo
if [ "$fail" -eq 0 ]; then
  echo "✓ Aucune lecture de order_lines par un client de session."
else
  echo "✗ Voir ci-dessus. Une erreur PostgREST avalée par \`?? []\` s'affiche comme une liste vide."
fi
exit $fail

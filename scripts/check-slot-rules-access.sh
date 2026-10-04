#!/usr/bin/env bash
# Garde-fou automatique — aucune ÉCRITURE dans product_slot_rules depuis les apps.
#
# POURQUOI. Les règles de créneaux d'un produit étaient remplacées en deux requêtes depuis le
# navigateur (delete, puis insert) : un échec entre les deux laissait l'activité sans aucune règle,
# donc invendable. Elles passent désormais par une RPC, replace_product_slot_rules
# (20261001235031), qui fait les deux dans la même transaction, et la table est RPC-only en
# écriture (policy d'écriture retirée, grants révoqués). Ce script empêche une écriture directe de
# revenir dans le code : elle échouerait désormais en « permission denied », et rien d'autre ne le
# signalerait avant la production.
#
# La LECTURE reste permise (policy product_slot_rules_select) : seules les chaînes
# `.from("product_slot_rules")` suivies de `.insert(`, `.update(`, `.delete(` ou `.upsert(` sont
# visées — y compris quand la chaîne s'étale sur plusieurs lignes, comme dans le code d'avant.
#
#   ./scripts/check-slot-rules-access.sh   (depuis hifago/)
#
# Sort en erreur (exit 1) si une règle est enfreinte.

set -euo pipefail
cd "$(dirname "$0")/.."

SANS_COMMENTAIRES="scripts/lib/sans-commentaires.pl"
# Même garde de véracité que check-data-layer.sh : sans ce filtre, le contrôle passerait sans avoir
# rien lu. Code 2, distinct du 1 des vraies violations.
if [ ! -r "$SANS_COMMENTAIRES" ]; then
  echo "✗ $SANS_COMMENTAIRES introuvable ou illisible — contrôle impossible, pas \"aucune violation\"." >&2
  exit 2
fi
fail=0

fichiers_des_apps() {
  find apps \
    \( -name node_modules -o -name .next -o -name e2e \) -prune -o \
    -type f \( -name '*.ts' -o -name '*.tsx' \) \
    ! -name '*.spec.*' ! -name '*.test.*' ! -name 'database.types.ts' -print 2>/dev/null | sort
}

echo "== Écriture directe dans product_slot_rules =="
while IFS= read -r f; do
  # Le motif traverse les retours à la ligne : on travaille sur le fichier entier (commentaires
  # retirés, numéros de ligne conservés) et on rend le numéro de ligne du `.from(`.
  hits="$(perl -0777 -p "$SANS_COMMENTAIRES" "$f" | perl -0777 -ne '
    while (/\.from\(\s*["\x27\x60]product_slot_rules["\x27\x60]\s*\)\s*\.(insert|update|delete|upsert)\s*\(/g) {
      my $ligne = 1 + (substr($_, 0, $-[0]) =~ tr/\n//);
      print "$ligne: .from(\"product_slot_rules\").$1(\n";
    }' || true)"
  [ -z "$hits" ] && continue
  echo "✗ $f"
  echo "$hits" | sed 's/^/    /'
  echo "    → Passer par la RPC replace_product_slot_rules (une transaction) : la table est RPC-only en écriture."
  fail=1
done < <(fichiers_des_apps)

echo
if [ "$fail" -eq 0 ]; then
  echo "✓ Aucune écriture directe dans product_slot_rules."
else
  echo "✗ Voir ci-dessus."
fi
exit $fail

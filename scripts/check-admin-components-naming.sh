#!/usr/bin/env bash
# Garde-fou automatique — convention de nommage d'apps/admin/components/ (revue de packaging admin,
# 2026-09-17 : cf. apps/admin/components/README.md). CLAUDE.md §11.20 : une règle qu'aucun outil ne
# vérifie n'est pas une règle, c'est un souhait — celle-ci n'avait jamais été outillée avant ce
# script, contrairement à son équivalent PascalCase pour apps/web (constaté par la revue).
#
#   ./scripts/check-admin-components-naming.sh   (depuis hifago/)   — exit 1 si une faute est trouvée.
#
# RÈGLE : tout fichier de apps/admin/components/ (récursif — inclut les sous-dossiers créés depuis
# la revue, ex. product-type-fields/) est en kebab-case : lettres minuscules, chiffres, tirets,
# jamais de majuscule. Vérifié sur le nom SANS extension(s) — un `.test.tsx` ou `.stories.tsx` ne
# change rien à la forme du nom qu'il teste.
#
# EXCEPTIONS NOMMÉES : les 5 fichiers PascalCase déjà présents au moment de la revue. Coût de
# renommage disproportionné pour un gain cosmétique (5 sites d'import chacun en moyenne, aucun bug
# associé) — documentées comme historiques, pas comme un précédent à suivre pour un NOUVEAU fichier.
# Une exception porte sur le NOM, comme la règle : le `.test.tsx` colocalisé d'un composant exempté
# (même nom, sans extension) l'est aussi, sans allonger la liste.

set -euo pipefail
cd "$(dirname "$0")/.."

DOSSIER="apps/admin/components"
fail=0

est_exempte() {
  case "$1" in
    GoogleButton.tsx) return 0 ;;
    ContactClientButton.tsx) return 0 ;;
    EmptyStateCta.tsx) return 0 ;;
    LogoutButton.tsx) return 0 ;;
    ModifyOrderLineDialog.tsx) return 0 ;;
  esac
  return 1
}

echo "== Nommage kebab-case de $DOSSIER/ (récursif) =="
while IFS= read -r f; do
  rel="${f#"$DOSSIER"/}"
  base="$(basename "$f")"

  nom="${base%.*}"      # retire la dernière extension (.tsx/.ts/.css)
  nom="${nom%.test}"    # retire un éventuel suffixe .test (avant .tsx/.ts déjà retiré)
  nom="${nom%.stories}" # idem pour une future story colocalisée
  est_exempte "$nom.tsx" && continue

  if ! [[ "$nom" =~ ^[a-z][a-z0-9]*(-[a-z0-9]+)*$ ]]; then
    echo "✗ $rel — nom hors kebab-case (\"$nom\")"
    fail=1
  fi
done < <(find "$DOSSIER" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) | sort)

echo
if [ "$fail" -eq 0 ]; then
  echo "✓ Tous les fichiers de $DOSSIER/ respectent le kebab-case (hors exceptions historiques nommées)."
else
  echo "✗ Voir ci-dessus. Renommer le fichier en kebab-case, ou l'ajouter à est_exempte() avec sa raison si l'exception est réellement justifiée."
fi
exit $fail

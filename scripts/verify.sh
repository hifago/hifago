#!/usr/bin/env bash
# Lance TOUS les contrôles du job `lint` de la CI, sans s'arrêter au premier échec.
#
#   npm run verify            (depuis hifago/)   — exit 1 si au moins un contrôle échoue.
#
# POURQUOI CE SCRIPT EXISTE (revue de CI du 2026-09-19). Le job `lint` était une séquence de 13
# étapes `run:` distinctes, et GitHub Actions arrête un job à la première étape non-zéro. Un run
# rouge ne révélait donc QU'UN défaut, jamais les autres : trois contrôles fautifs demandaient
# trois pushs rien que pour être découverts. Ce n'est pas une hypothèse, c'est le commit 604011d —
# « le job lint échouait sur deux points distincts, l'un masquant l'autre […] check-tokens.sh,
# jamais exécuté jusqu'ici (bloqué par l'échec précédent) ». check-timezone.sh est resté rouge six
# jours (2026-09-13 → 19) en masquant check-tokens.sh tout du long. Mesure du chantier : 39 runs
# rouges sur 60, dont 15 des 20 derniers échecs imputables au seul job `lint`.
#
# Ce script inverse la logique : il lance tous les contrôles, retient les sorties, puis imprime UN
# récapitulatif. Un seul passage donne la liste complète de ce qu'il faut corriger.
#
# ⚠️ PAS de `set -e` — un `-e` ici ferait exactement ce que ce script existe pour empêcher. Les
# codes de retour sont accumulés à la main, jamais propagés au fil de l'eau.
#
# Il est lancé à deux endroits, et c'est volontairement le MÊME script aux deux :
#   - en local par le hook pre-push (scripts/hooks/pre-push), ~35 s ;
#   - en CI, étape unique du job `lint` (.github/workflows/hifago-ci.yml).
# Un contrôle vert en local est donc vert en CI : la portabilité macOS ↔ Ubuntu des motifs
# grep/sed des 8 check-*.sh a été vérifiée motif par motif le 2026-09-19 (16 testés, 16 identiques),
# pas supposée.

set -uo pipefail
cd "$(dirname "$0")/.."

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

total=0
echecs=0
: > "$TMP/echecs.txt"

# lancer <titre> <commande...> — exécute, capture, ne s'arrête JAMAIS.
lancer() {
  titre="$1"
  shift
  total=$((total + 1))
  journal="$TMP/$total.log"

  if "$@" > "$journal" 2>&1; then
    printf '  ✓ %s\n' "$titre"
  else
    printf '  ✗ %s\n' "$titre"
    echecs=$((echecs + 1))
    printf '%s\t%s\n' "$titre" "$journal" >> "$TMP/echecs.txt"
  fi
}

echo "== Contrôles hifago (identiques à ceux du job \`lint\` de la CI) =="
echo

lancer "ESLint (les deux apps)"                      npm run lint --workspaces --if-present

# Bloquant depuis le 2026-08-28 : couvre le piège Table.Body/Table.Content non sérialisable, que
# le lint no-restricted-imports ne voit pas.
lancer "Design system (HeroUI unique, sérialisable)" bash scripts/check-design-system.sh

# Bloquant depuis le 2026-08-28. La règle eslint (eslint.rules.mjs) ne couvre que les deux apps ;
# ce script couvre packages/, supabase/functions/ (Deno), tests/ et le SQL — c'est-à-dire l'angle
# mort où vivait le dixième site du lot fuseau (packages/e2e-support/src/date.ts).
lancer "Fuseau de Guatapé (dates civiles)"           bash scripts/check-timezone.sh

# Trois règles que la relecture ne peut pas attraper : l'une porte sur une ABSENCE (aucune table
# d'avis n'existe, donc aucune note ne doit être émise), l'autre sur deux écritures visuellement
# identiques dont une seule échappe réellement le JSON-LD, la troisième (2026-09-07) sur les zones
# (tunnel)/(cuenta)/(auth) noindex qu'aucune route ne doit annuler (spec 27 §0 invariant 6).
# Les branches ont été vérifiées PAR MUTATION, pas seulement observées vertes.
lancer "Référencement (JSON-LD, zones noindex)"      bash scripts/check-seo.sh

# Bloquant depuis la revue de packaging admin (2026-09-17) — vérifié PAR MUTATION. Jusque-là la
# convention kebab-case n'était constatée qu'a posteriori dans le code, jamais outillée : le cas
# que CLAUDE.md §11.20 nomme (« une règle que rien ne vérifie n'est pas une règle »).
lancer "Nommage kebab-case d'apps/admin/components"  bash scripts/check-admin-components-naming.sh

# Les trois contrôles de la vitrine (spec 27 §8), tous vérifiés PAR MUTATION avant d'être posés.
# Ils portent des règles invisibles à la relecture et qui ne cassent rien tout de suite : une
# couleur en dur ne se voit qu'au jour de l'habillage, une requête dans un page.tsx qu'au deuxième
# écran qui la réécrit autrement, un lien non localisé qu'à l'analytics d'un anglophone renvoyé en
# espagnol.
lancer "Jetons de couleur (vitrine)"                 bash scripts/check-tokens.sh

# Bloquant depuis le 2026-10-02 (plan 41, item G1) — vérifié PAR MUTATION : chacune des six règles
# rougit sur un fichier fautif, et le script sort en code 2 si une règle ne retrouve pas son témoin
# synthétique (la première version passait au vert sans rien lire).
lancer "Charte Hifago (titres, or, <main>, rayons)"  bash scripts/check-charte.sh
lancer "Couche d'accès (pas de requête en route)"    bash scripts/check-data-layer.sh
lancer "Panne ≠ absence (error lu, pas de loading)"  bash scripts/check-supabase-errors.sh
lancer "Navigation localisée (@/i18n/navigation)"    bash scripts/check-i18n-links.sh

# Bloquant depuis le 2026-09-30 — vérifié PAR MUTATION (rouge sur les quatre embeds d'avant le
# correctif, sur un `.from('order_lines')` ajouté ; muet sur un commentaire ; code 2 sans filtre).
# Une session n'a plus le SELECT d'`order_lines` depuis 20260922210000 : une lecture qui y revient,
# directe ou par embed, échoue en silence derrière un `?? []` — c'est ce qui a vidé le ledger et
# les commissions pendant une semaine.
lancer "Lecture d'order_lines (jamais en session)"   bash scripts/check-order-lines-access.sh

# ⚠️ N'EST PAS redondant avec le job `functions` de la CI : `deno check` résout à la TypeScript et
# passe au vert sur un import relatif sans extension, alors que le worker Edge, lui, ne boote pas
# du tout (mesuré le 2026-09-17, BOOT_ERROR). Seul un boot réel — ou ce script — le révèle.
lancer "Imports Deno (extension obligatoire)"        bash scripts/check-deno-imports.sh

# Le manifeste docs/ai-index.json est ce que lisent les agents pour s'orienter : périmé, il les
# envoie lire le mauvais document. Depuis le 2026-09-19 il est régénéré automatiquement par le
# hook pre-commit (scripts/git-hooks/pre-commit) — ce contrôle reste le filet.
lancer "Manifeste documentaire à jour"               npm run docs:check

# Second filet (le premier est le hook PostToolUse local, cf. .claude/settings.json) contre la
# régression du 2026-08-15 → 2026-09-07 : CLAUDE.md avait été vidé une fois puis regonflé à 569
# lignes sans qu'aucun outil ne le signale pendant trois semaines.
lancer "Corpus d'instructions (tailles, renvois)"    npm run check:instructions

# Audit COMPLET (dev comprises) rétabli le 2026-09-19. Il avait été restreint à `--omit=dev` le
# 2026-09-01 parce que Storybook faisait entrer 3 avis `high` sur `image-size` sans correctif
# disponible. Ce correctif existe désormais et a été appliqué : la condition de réouverture que le
# workflow s'était lui-même fixée (« si image-size publie un correctif, retirer --omit=dev ») est
# remplie. L'étape « pour information seulement » qui doublait celle-ci en `|| true` est supprimée :
# un signal qui ne peut pas échouer n'est pas lu, et celui-là avait masqué js-yaml et
# @vitest/mocker, tous deux réparables.
lancer "Dépendances sans vulnérabilité haute"        npm audit --audit-level=high

# Le détail ne s'affiche que pour ce qui a échoué : un log qui imprime aussi les 11 contrôles verts
# enterre les 2 lignes qui comptent, et c'est ce qui rendait le diagnostic long en CI.
if [ "$echecs" -gt 0 ]; then
  echo
  echo "================================ DÉTAIL DES ÉCHECS ================================"
  while IFS="$(printf '\t')" read -r titre journal; do
    echo
    echo "--- $titre ---"
    cat "$journal"
  done < "$TMP/echecs.txt"
fi

echo
if [ "$echecs" -eq 0 ]; then
  echo "✓ $total contrôles passés."
  exit 0
fi

echo "✗ $echecs contrôle(s) en échec sur $total :"
cut -f1 "$TMP/echecs.txt" | sed 's/^/    - /'
echo
echo "Tout est listé ci-dessus — corriger l'ensemble avant de pousser, pas seulement le premier."
exit 1

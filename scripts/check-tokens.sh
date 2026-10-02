#!/usr/bin/env bash
# Garde-fou automatique — aucune couleur en dur dans la vitrine (spec 27 §3 et §8).
#
# POURQUOI. L'identité visuelle de la vitrine est repoussée : on construit neutre, on habille
# après. Ce choix ne tient QUE si aucun écran n'écrit une couleur — sinon l'habillage d'après ne
# rattrape rien et il faut repeindre vingt écrans à la main. D'où un contrôle, pas une consigne.
#
# La couleur passe par les jetons sémantiques du thème (`bg-surface`, `text-foreground`,
# `border-default-200`, `var(--…)`), jamais par une valeur ni par une classe de palette Tailwind.
#
#   ./scripts/check-tokens.sh   (depuis hifago/)
#
# Sort en erreur (exit 1) si une règle est enfreinte.

set -euo pipefail
cd "$(dirname "$0")/.."

SANS_COMMENTAIRES="scripts/lib/sans-commentaires.pl"
# ⚠️ Garde-fou de VÉRACITÉ, pas de confort (revue de CI du 2026-09-19). Le motif employé plus bas
# est `perl "$SANS_COMMENTAIRES" "$f" | grep -nE '…' || true` : si ce filtre devient absent ou
# illisible, `perl` échoue, `grep` reçoit du vide, le `|| true` neutralise `pipefail` — et TOUS les
# fichiers passent. Le script sort 0 en n'ayant rien lu. Un contrôle qui peut passer au vert sans
# rien vérifier est pire qu'un contrôle absent : il inspire une confiance que rien ne soutient,
# ce que CLAUDE.md §11.20 nomme exactement. Code 2, distinct du 1 des vraies violations.
if [ ! -r "$SANS_COMMENTAIRES" ]; then
  echo "✗ $SANS_COMMENTAIRES introuvable ou illisible — contrôle impossible, pas \"aucune violation\"." >&2
  exit 2
fi
fail=0

# ─────────────────────────────────────────────────────────────────────────────────────────────
# Exemptions — nommées, avec leur raison. Jamais un motif large.
# ─────────────────────────────────────────────────────────────────────────────────────────────
est_exempte() {
  case "$1" in
    # Les DRAPEAUX SVG (colombien, britannique) de LanguageSwitcher : les huit seules valeurs
    # hexadécimales du dépôt. Un drapeau n'a pas de jeton sémantique — sa couleur EST sa
    # définition, et la repeindre au thème le rendrait faux. Exempté PAR FICHIER plutôt que par
    # attribut `fill=`/`stroke=` : exempter l'attribut laisserait passer n'importe quelle icône de
    # marque codée en dur, alors que nommer le fichier force la conversation au prochain drapeau.
    apps/web/components/organisms/LanguageSwitcher.tsx) return 0 ;;

    # La MARQUE Google de `components/molecules/GoogleButton.tsx` : quatre valeurs hexadécimales,
    # exactement la raison écrite au-dessus pour les drapeaux — la couleur d'un logo EST sa
    # définition, la repeindre au thème la rendrait fausse, et les Google Brand Guidelines
    # l'interdisent. Exempté PAR FICHIER comme la règle le prescrit : le prochain logo de marque
    # devra rouvrir cette conversation au lieu de se glisser sous une exemption d'attribut.
    apps/web/components/molecules/GoogleButton.tsx) return 0 ;;

    # Sonde de CONTRASTE d'une story : `rgba(0, 0, 0, 0)` est la valeur que rend
    # `getComputedStyle` pour un fond transparent (une sentinelle du moteur, pas une couleur
    # choisie), et `rgb(255,255,255)` le repli blanc sur lequel empiler les fonds `soft`
    # semi-transparents pour calculer un ratio réel. Aucune de ces deux valeurs n'est peinte.
    apps/web/components/atoms/Button.stories.tsx) return 0 ;;

    # SIMULATEUR de la page Checkout Pro EXTERNE de Mercado Pago (mode dev, jamais en prod —
    # cf. l'en-tête du fichier). Il ne fait délibérément PAS partie de la vitrine hifago : il en
    # sort exprès (même raisonnement que l'en-tête du fichier pour la frontière Server/Client et
    # les règles i18n/@hifago/ui). Reprendre les jetons sémantiques du thème habillerait un site
    # tiers simulé aux couleurs de hifago — le rendrait FAUX comme simulateur, pas plus fidèle.
    apps/web/app/api/payments/mock-checkout/route.ts) return 0 ;;
  esac
  return 1
}

signale() { # fichier, lignes, explication
  echo "✗ $1"
  echo "$2" | sed 's/^/    /'
  echo "    → $3"
  fail=1
}

echo "== Couleurs écrites en dur (hex, oklch, rgb, hsl) =="
while IFS= read -r f; do
  est_exempte "$f" && continue
  hits="$(perl -0777 -p "$SANS_COMMENTAIRES" "$f" | grep -nE '#[0-9a-fA-F]{3}([0-9a-fA-F]{3}([0-9a-fA-F]{2})?)?\b|\b(oklch|rgba?|hsla?)\(' || true)"
  [ -z "$hits" ] && continue
  signale "$f" "$hits" \
    "Passer par un jeton sémantique du thème (bg-surface, text-foreground, var(--…))."
done < <(find apps/web \
           \( -name node_modules -o -name .next -o -name storybook-static \) -prune -o \
           -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) -print 2>/dev/null | sort)

echo
echo "== Classes de palette Tailwind (bg-blue-500 et compagnie) =="
# La palette brute de Tailwind court-circuite le thème aussi sûrement qu'un hex : `bg-blue-500`
# vaut la même couleur sous `data-theme="vitrine"` et sous `data-theme="admin"`. Les jetons
# sémantiques (`default`, `surface`, `foreground`, `focus`, `danger`…) ne sont PAS dans cette
# liste — c'est exactement ce qu'on veut voir écrit.
PALETTE='slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
UTILITAIRES='bg|text|border|ring|from|to|via|fill|stroke|shadow|outline|divide|accent|caret|decoration|placeholder'
while IFS= read -r f; do
  est_exempte "$f" && continue
  hits="$(perl -0777 -p "$SANS_COMMENTAIRES" "$f" | grep -nE "\b($UTILITAIRES)-($PALETTE)-[0-9]{2,3}\b" || true)"
  [ -z "$hits" ] && continue
  signale "$f" "$hits" \
    "Utiliser un jeton sémantique (default, surface, foreground, focus, danger…), pas la palette brute."
done < <(find apps/web \
           \( -name node_modules -o -name .next -o -name storybook-static \) -prune -o \
           -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) -print 2>/dev/null | sort)

echo
echo "== Espacement de la police de titre (--tracking-titre) =="
# RÈGLE D'USAGE (Jérôme, 2026-10-01) : tout texte en police de titre prend l'interlettrage du jeton
# `--tracking-titre` (globals.css), et aucun autre. Trois façons de la casser, trois contrôles :
#   1. la règle des `<h1>`–`<h3>` de la vitrine ne lit plus le jeton ;
#   2. une ligne qui pose `font-titre` y ajoute un `tracking-…` autre que le jeton ;
#   3. un `<h1>`–`<h3>` (qui prend la police de titre par la base) reçoit un `tracking-…` à lui.
# Mutation vérifiée à l'écriture : `tracking-[3pt]` dans BandaTitulo et `0.01em` dans globals.css
# font chacun sortir ce contrôle en erreur.
GLOBALS="packages/ui/src/styles/globals.css"
if ! perl -0777 -ne 'exit(/\[data-theme="vitrine"\] :is\(h1, h2, h3\) \{[^}]*letter-spacing: var\(--tracking-titre\);/ ? 0 : 1)' "$GLOBALS"; then
  signale "$GLOBALS" '[data-theme="vitrine"] :is(h1, h2, h3) { … }' \
    "La règle des titres doit porter letter-spacing: var(--tracking-titre)."
fi
while IFS= read -r f; do
  hits="$(perl -0777 -p "$SANS_COMMENTAIRES" "$f" \
    | grep -nE 'font-titre|<h[1-3][ >]' \
    | grep -E 'tracking-' \
    | grep -vE 'tracking-\[var\(--tracking-titre\)\]' || true)"
  [ -z "$hits" ] && continue
  signale "$f" "$hits" \
    "Police de titre : tracking-[var(--tracking-titre)] seulement — la valeur se règle dans globals.css."
done < <(find apps/web \
           \( -name node_modules -o -name .next -o -name storybook-static \) -prune -o \
           -type f -name '*.tsx' -print 2>/dev/null | sort)

echo
if [ "$fail" -eq 0 ]; then
  echo "✓ Aucune couleur en dur, aucun interlettrage de titre hors jeton : tout passe par les jetons du thème."
else
  echo "✗ Voir ci-dessus. Si une exception est réellement légitime, l'AJOUTER NOMMÉMENT dans est_exempte(), avec sa raison."
fi
exit $fail

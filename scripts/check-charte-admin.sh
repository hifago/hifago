#!/usr/bin/env bash
# Garde-fou automatique — la charte Hifago sur l'admin et l'espace socio (2026-10-13).
#
# POURQUOI. Le thème `admin` porte la charte depuis le 2026-10-13
# (`docs/specs/09-design-system-admin.md`, « Révision du 2026-10-13 »). Deux de ses règles ne
# cassent rien à l'écriture et ne se voient qu'à l'écran — donc que la relecture laisse passer
# (CLAUDE.md §11.20) :
#   1. `--accent` est désormais l'OR : écrit en couleur de TEXTE sur fond clair, il rend 2.07:1.
#      L'ancien accent (terracotta) se lisait ; cinq `text-accent` ont dû être corrigés à la bascule.
#   2. Le titre de page est en Anton, qui n'a qu'une graisse : une classe `font-semibold` à côté de
#      `titre-page` fabrique un faux gras.
#
#   ./scripts/check-charte-admin.sh   (depuis hifago/)
#
# Sort en erreur (exit 1) si une règle est enfreinte ; exit 2 si le contrôle n'a pas pu lire le code
# (filtre de commentaires absent, ou règle qui ne retrouve pas son témoin).
#
# PÉRIMÈTRE : le code RENDU d'`apps/admin` et des composants de `packages/ui`, hors tests. Les
# commentaires sont retirés avant la recherche (`scripts/lib/sans-commentaires.pl`) : le code CITE
# ces motifs pour expliquer pourquoi ils sont interdits. Le pendant vitrine est `check-charte.sh`.

set -euo pipefail
cd "$(dirname "$0")/.."

SANS_COMMENTAIRES="scripts/lib/sans-commentaires.pl"
# ⚠️ Même garde-fou de véracité que `check-tokens.sh` : sans le filtre, la recherche porterait sur
# du vide et TOUS les fichiers passeraient. Code 2, distinct du 1 des vraies violations.
if [ ! -r "$SANS_COMMENTAIRES" ]; then
  echo "✗ $SANS_COMMENTAIRES introuvable ou illisible — contrôle impossible, pas \"aucune violation\"." >&2
  exit 2
fi
fail=0

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ⚠️ LE TÉMOIN — un fichier synthétique qui enfreint les deux règles. Chaque règle doit le
# retrouver, sinon elle est muette et le script sort en code 2 : un contrôle qui passe au vert sans
# rien lire est pire qu'un contrôle absent. Il n'existe que dans le dossier temporaire.
TEMOIN="$TMP/__temoin_check_charte_admin__.tsx"
cat > "$TEMOIN" <<'TEMOIN_TSX'
export function Temoin() {
  return (
    <div>
      <p className="text-sm text-accent">t</p>
      <h1 className="titre-page font-semibold">t</h1>
    </div>
  );
}
TEMOIN_TSX

fichiers_rendus() {
  find apps/admin/app apps/admin/components packages/ui/src/components \
    -type f \( -name '*.tsx' -o -name '*.ts' \) \
    ! -name '*.test.ts' ! -name '*.test.tsx' -print 2>/dev/null | sort
  echo "$TEMOIN"
}

# Les lignes (commentaires retirés) qui contiennent le motif perl $1 : « fichier:ligne: texte ».
# UN `perl` par lot de 100 fichiers, pas un par fichier : sous Windows, c'est la différence entre
# une seconde et une minute (mesuré sur `check-charte.sh` le 2026-10-02).
lignes_avec() { # motif
  fichiers_rendus | MOTIF="$1" FILTRE="./$SANS_COMMENTAIRES" xargs -n 100 perl -e '
    for my $f (@ARGV) {
      local $/;
      open my $in, "<", $f or die "$f : $!";
      $_ = <$in>;
      close $in;
      do $ENV{FILTRE};
      die $@ if $@;
      my $n = 0;
      for my $ligne (split /\n/) {
        $n++;
        print "$f:$n: $ligne\n" if $ligne =~ /$ENV{MOTIF}/;
      }
    }'
}

rapporter() { # titre de la règle, correction, motif
  local trouves vraies
  trouves="$(lignes_avec "$3")"
  if ! grep -qF "$TEMOIN" <<<"$trouves"; then
    echo "✗ $1 : la règle ne retrouve pas son témoin — contrôle muet, pas \"aucune violation\"." >&2
    exit 2
  fi
  vraies="$(grep -vF "$TEMOIN" <<<"$trouves" || true)"
  if [ -n "$vraies" ]; then
    echo "$vraies" | sed 's/^/    /'
    echo "    → $2"
    fail=1
  fi
}

echo "== 1. Pas de texte or (l'or est un aplat : 2.07:1 en texte sur clair) =="
rapporter "Texte or" \
  "Un lien : text-link. Un état « fait » : text-success. Un aplat or : bg-accent + text-accent-foreground." \
  '\btext-accent(?![-\w])|text-\[var\(--(?:accent|charte-or)\)\]|\[color:var\(--(?:accent|charte-or)\)\]'

echo
echo "== 2. Pas de graisse à côté de titre-page (Anton n'a qu'une graisse) =="
rapporter "Faux gras sur le titre de page" \
  "className=\"titre-page\" seul : la classe pose déjà la police, la taille et la graisse." \
  '^(?=.*\btitre-page\b)(?=.*\bfont-(?:medium|semibold|bold|extrabold|black)\b)'

echo
if [ "$fail" -eq 0 ]; then
  echo "✓ Charte admin respectée : pas de texte or, pas de faux gras sur le titre de page."
else
  echo "✗ Voir ci-dessus."
fi
exit $fail

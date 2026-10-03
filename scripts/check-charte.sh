#!/usr/bin/env bash
# Garde-fou automatique — la charte Hifago sur la vitrine (plan 41, item G1).
#
# POURQUOI. « Une règle que rien ne vérifie n'est pas une règle : c'est un souhait » (CLAUDE.md
# §11.20). Le plan `docs/specs/41-charte-hifago-toute-la-vitrine.md` pose des règles de style que
# la relecture laisse passer parce qu'elles ne cassent rien tout de suite : un titre en faux gras ne
# se voit qu'à l'écran, un texte or qu'au contraste mesuré, un `<main>` recopié qu'au jour où la
# colonne change. Six contrôles, chacun avec ses exemptions NOMMÉES, comme `check-tokens.sh`.
#
#   ./scripts/check-charte.sh   (depuis hifago/)
#
# Sort en erreur (exit 1) si une règle est enfreinte ; exit 2 si le contrôle n'a pas pu lire le code
# (filtre de commentaires absent, ou règle muette : voir « le témoin »).
#
# PÉRIMÈTRE : le code RENDU de la vitrine (`apps/web`). Hors stories, tests et playground : ils
# montrent aussi, exprès, ce qu'il ne faut pas faire (`Playground/Semantique`, les contre-exemples
# de la story `Contrastes`). Les commentaires sont retirés avant la recherche
# (`scripts/lib/sans-commentaires.pl`) : le code CITE ces motifs pour expliquer pourquoi ils sont
# interdits.

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

signale() { # fichier, lignes, explication
  echo "✗ $1"
  echo "$2" | sed 's/^/    /'
  echo "    → $3"
  fail=1
}

fichiers_rendus() {
  find apps/web \
    \( -name node_modules -o -name .next -o -name storybook-static \
       -o -path apps/web/components/playground -o -path apps/web/components/parcours \) -prune -o \
    -type f \( -name '*.tsx' -o -name '*.ts' \) \
    ! -name '*.stories.tsx' ! -name '*.test.ts' ! -name '*.test.tsx' -print 2>/dev/null | sort
}

# ⚠️ UN SEUL PASSAGE pour retirer les commentaires de tous les fichiers, puis UN `perl` par règle
# sur l'ensemble : une première version lançait un `perl` par fichier et par règle, et prenait
# 1 min 40 sous Windows (mesuré le 2026-10-02) — un contrôle lent est un contrôle qu'on saute. Les
# copies sans commentaires vont dans un dossier temporaire, aux mêmes chemins relatifs.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fichiers_rendus > "$TMP/liste"
DEST="$TMP/src" FILTRE="./$SANS_COMMENTAIRES" perl -e '
  use File::Path qw(make_path);
  use File::Basename qw(dirname);
  while (my $f = <STDIN>) {
    chomp $f;
    local $/;
    open my $in, "<", $f or die "$f : $!";
    $_ = <$in>;
    close $in;
    do $ENV{FILTRE};
    die $@ if $@;
    my $sortie = "$ENV{DEST}/$f";
    make_path(dirname($sortie));
    open my $out, ">", $sortie or die "$sortie : $!";
    print $out $_;
    close $out;
  }' < "$TMP/liste"

# ⚠️ LE TÉMOIN — garde-fou de véracité, écrit après qu'une première version de ce script eut passé
# au vert en ne lisant RIEN (le code perl y était pris pour un nom de fichier : « Can't open », et
# exit 0). Ce fichier synthétique enfreint les six règles ; chaque règle doit le retrouver, sinon
# elle est muette et le script sort en code 2. Il n'existe que dans le dossier temporaire.
TEMOIN="__temoin_check_charte__.tsx"
cat > "$TMP/src/$TEMOIN" <<'TEMOIN_TSX'
export function Temoin() {
  return (
    <main className="bg-accent text-white">
      <h2 className="text-sm font-bold">t</h2>
      <p className="text-accent">t</p>
      <button className="rounded-[var(--radius)]">t</button>
    </main>
  );
}
TEMOIN_TSX
echo "$TEMOIN" >> "$TMP/liste"

# Lance le code perl $2, avec les options $1 (mode -n : `$ARGV` = chemin relatif), sur toutes les
# copies, par lots de 100 fichiers (la ligne de commande de Windows plafonne à 32 Ko).
# ⚠️ Des options SANS `e` (`-n`, `-0777n`) : `-ne` suivi de `-e` ferait du code un nom de fichier.
sur_tous() { # options, code
  (cd "$TMP/src" && xargs -n 100 perl "$1" -e "$2" < "$TMP/liste")
}

# Les blocs `<h1>…</h1>` à `<h3>…</h3>`, contenu compris, qui contiennent le motif perl $1 — une
# graisse posée sur un `<span>` DANS le titre le rend tout aussi gras.
# Sortie : « fichier<TAB>ligne: <hN> … motif trouvé ».
titres_avec() { # motif
  MOTIF="$1" sur_tous -0777n '
    while (/<(h[1-3])\b.*?<\/\1>/gs) {
      my ($balise, $bloc, $debut) = ($1, $&, $-[0]);
      next unless $bloc =~ /$ENV{MOTIF}/;
      my $ligne = (substr($_, 0, $debut) =~ tr/\n//) + 1;
      print "$ARGV\t$ligne: <$balise> … $&\n";
    }'
}

# Les lignes qui contiennent le motif perl $1. Sortie : « fichier<TAB>ligne: texte ».
lignes_avec() { # motif
  MOTIF="$1" sur_tous -n '
    if (/$ENV{MOTIF}/) { (my $texte = $_) =~ s/^\s+//; print "$ARGV\t$.: $texte" }
    close ARGV if eof;'
}

# Les balises ouvrantes `<button …>` (sur plusieurs lignes au besoin) qui portent `--radius` brut.
boutons_au_rayon_du_theme() {
  sur_tous -0777n '
    while (/<button\b[^>]*>/gs) {
      my ($balise, $debut) = ($&, $-[0]);
      next unless $balise =~ /rounded-\[var\(--radius\)\]/;
      print "$ARGV\t", (substr($_, 0, $debut) =~ tr/\n//) + 1, ": <button … rounded-[var(--radius)]>\n";
    }'
}

# Regroupe les correspondances (entrée standard) par fichier, saute ceux que la fonction $2
# exempte, et signale les autres avec l'explication $1. Vérifie d'abord que la règle a retrouvé le
# témoin (sauf `sans-temoin` en $3).
# ⚠️ Toujours appelée avec une REDIRECTION (`rapporter … < <(règle)`), jamais au bout d'un pipe : un
# pipe l'exécuterait dans un sous-shell, et le `fail=1` de `signale` s'y perdrait — le script
# sortirait 0 en ayant trouvé des violations.
rapporter() { # explication, fonction d'exemption, [sans-temoin]
  local hits f
  hits="$(cat)"
  if [ "${3:-}" != "sans-temoin" ] \
    && ! printf '%s\n' "$hits" | awk -F'\t' -v t="$TEMOIN" '$1 == t { vu = 1 } END { exit !vu }'; then
    echo "✗ Règle muette : elle ne retrouve pas son témoin ($TEMOIN) — contrôle impossible, pas \"aucune violation\"." >&2
    exit 2
  fi
  hits="$(printf '%s\n' "$hits" | awk -F'\t' -v t="$TEMOIN" 'NF && $1 != t')"
  [ -z "$hits" ] && return 0
  while IFS= read -r f; do
    "$2" "$f" && continue
    signale "$f" "$(printf '%s\n' "$hits" | awk -F'\t' -v f="$f" '$1 == f { print $2 }')" "$1"
  done < <(printf '%s\n' "$hits" | cut -f1 | sort -u)
}
aucune_exemption() { return 1; }

echo "== 1. Pas de graisse sur un titre (h1–h3, et Title) =="
# La police de titre (Anton) et Anton n'existent qu'en 400 : toute graisse au-dessus fait
# synthétiser un faux gras au navigateur (§3.3 du plan). Le RÔLE décide de l'apparence
# (`Title size=…`, classes de rôle de globals.css), jamais une classe de graisse.
GRAISSE='\bfont-(?:semibold|bold|extrabold|medium)\b'
est_exempte_graisse() {
  case "$1" in
    # Le SLOGAN de l'accueil, « Guatapé merece más de un día. » : Poppins 800 dans un `<span>` du
    # `<h1>`, réglage validé par Jérôme (journal du 2026-10-01). C'est du Poppins, pas la police de
    # titre : il n'y a pas de faux gras, et c'est le seul titre du site composé ainsi (§3.3 du plan,
    # rôle `slogan`, « accueil seulement »).
    'apps/web/app/[locale]/(vitrine)/PortadaInicio.tsx') return 0 ;;
  esac
  return 1
}
rapporter "Choisir le rôle du titre (Title size=pagina|seccion|bloque|etiquette), pas une graisse." \
  est_exempte_graisse < <(titres_avec "$GRAISSE")
TITLE="apps/web/components/atoms/Title.tsx"
rapporter "Title rend des rôles (classes de globals.css) : aucune graisse Tailwind ici." \
  aucune_exemption sans-temoin < <(lignes_avec "$GRAISSE" | awk -F'\t' -v f="$TITLE" '$1 == f')

echo
echo "== 2. Pas de titre en 12 ou 14 px (text-xs, text-sm sur h1–h3) =="
# Un titre de 14 px n'est plus un titre : c'est le constat T3 du plan (titres illisibles en police de
# titre). Sous 20 px, c'est le rôle `etiquette` (Poppins), qui s'écrit `Title size="etiquette"`.
rapporter "Rôle « etiquette » (Title size=\"etiquette\") pour un petit titre, jamais text-xs/text-sm." \
  aucune_exemption < <(titres_avec '\btext-(?:xs|sm)\b')

echo
echo "== 3. Pas de texte or (l'or est un aplat) =="
# L'or #ddae09 ne porte jamais de texte sur le clair (1.96:1) ; il n'est lisible que sur le marine
# (6.31:1). Seuls les fichiers d'une SURFACE MARINE peuvent donc l'écrire en texte (règle 2 du §0).
OR_TEXTE='\btext-accent(?![-\w])|text-\[var\(--(?:accent|charte-or)\)\]|\[color:var\(--(?:accent|charte-or)\)\]'
est_surface_marine() {
  case "$1" in
    # Aucun fichier pour l'instant. Ni le pied de page marine (C2) ni le rail (S3, `SeccionRiel`)
    # n'en ont eu besoin : ils n'écrivent pas d'or en texte (liens bleu poudre et focus or venus de
    # la surface pour le pied ; tuiles à cartouche clair pour le rail). Un futur fichier qui en
    # écrit s'y nomme un par un, avec sa raison — jamais un dossier entier.
    __aucun__) return 0 ;;
  esac
  return 1
}
rapporter "Texte marine sur l'or, or seulement sur le marine : déclarer la surface marine ici si c'en est une." \
  est_surface_marine < <(lignes_avec "$OR_TEXTE")

echo
echo "== 4. Pas de blanc sur l'or (text-white avec bg-accent) =="
# 2.07:1 : sur l'or, le texte est marine (6.31:1). Une action principale posée sur l'or est le
# bouton `marine` (texte blanc sur MARINE), pas un texte blanc sur or.
rapporter "Texte marine sur l'or (text-accent-foreground), ou Button color=\"marine\"." \
  aucune_exemption < <(lignes_avec '^(?=.*\bbg-accent(?![-\w]))(?=.*\btext-white\b)')

echo
echo "== 5. Pas de <main> écrit à la main (PageShell le pose) =="
# Une seule colonne pour tout le site (item F7) : elle vit dans `PageShell`. Un `<main>` recopié
# garde sa propre largeur, et c'est ainsi que la vitrine en avait cinq.
est_exempte_main() {
  case "$1" in
    # La source elle-même.
    apps/web/components/atoms/PageShell.tsx) return 0 ;;
    # La frontière d'erreur : `PageShell` n'y est pas importé pour que l'écran d'erreur ne dépende
    # de rien qui puisse échouer avec lui (en-tête du fichier).
    apps/web/components/organisms/ErrorScreen.tsx) return 0 ;;
    # La 404 : exemption prévue par le plan (G1), à reconsidérer dans son item, P11.
    'apps/web/app/[locale]/not-found.tsx') return 0 ;;
    # ⚠️ TEMPORAIRES — chaque page passe à `PageShell variant="pagina"` dans son item P, avec son
    # bandeau (S2). Retirer la ligne dans le même commit que la migration.
    'apps/web/app/[locale]/(auth)/entrar/page.tsx') return 0 ;;                # → P10
    'apps/web/app/[locale]/(auth)/registro/page.tsx') return 0 ;;              # → P10
    'apps/web/app/[locale]/(auth)/olvide-password/page.tsx') return 0 ;;       # → P10
    'apps/web/app/[locale]/(auth)/restablecer-password/page.tsx') return 0 ;;  # → P10
    'apps/web/app/[locale]/(auth)/verificar-email/page.tsx') return 0 ;;       # → P10
    'apps/web/app/[locale]/(tunnel)/mi-viaje/page.tsx') return 0 ;;            # → P5
    'apps/web/app/[locale]/(tunnel)/pago/page.tsx') return 0 ;;                # → P6
  esac
  return 1
}
rapporter "Passer par PageShell (variant=\"pagina\") : un seul <main>, une seule colonne." \
  est_exempte_main < <(lignes_avec '<main\b')

echo
echo "== 6. Pas de rounded-[var(--radius)] sur un bouton =="
# UN rayon pour tous les boutons rectangulaires (item F4, arbitrage D4 : 8 px), posé par les atomes
# (`RADIUS_CLASS`, jeton `--rayon-bouton`). `--radius` seul vaut 4 px : un `<button>` écrit à la
# main avec lui rend le second rayon que F4 a fait disparaître.
rapporter "rounded-[var(--rayon-bouton)], ou mieux : l'atome Button / IconButton." \
  aucune_exemption < <(boutons_au_rayon_du_theme)

echo
if [ "$fail" -eq 0 ]; then
  echo "✓ Charte respectée : titres sans faux gras ni petite taille, pas de texte or ni de blanc sur l'or, un seul <main>, un seul rayon de bouton."
else
  echo "✗ Voir ci-dessus. Si une exception est réellement légitime, l'AJOUTER NOMMÉMENT dans le est_exempte_… de la règle, avec sa raison."
fi
exit $fail

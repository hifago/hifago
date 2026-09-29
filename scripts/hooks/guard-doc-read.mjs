#!/usr/bin/env node
/**
 * Hook PreToolUse sur Read, scopé par `if: "Read(**\/docs/**)"` dans .claude/settings.json.
 *
 * POURQUOI (audit du 2026-09-28) : `docs/INDEX.md` donne la plage utile de chaque document, mais
 * rien n'empêchait un Read entier — une spec de 84 Ko, c'est ~24 k tokens pour en lire 200 lignes.
 * Pour un journal (~660 Ko), le Read nu échoue (> 256 Ko), et `limit` sans `offset` rend les
 * entrées les PLUS ANCIENNES : l'agent croit lire l'état courant et lit celui du 1er du mois.
 *
 * Refuse donc un Read SANS `offset` d'un `docs/**.md` de plus de 40 Ko, et donne dans sa raison ce
 * qu'il faut lire à la place, déjà calculé : pour un journal, les 5 dernières entrées ; pour un autre
 * document, son plan `## ` (et `### ` dans les sections de plus de 200 lignes) avec l'offset/limit de
 * chaque section — l'agent n'a pas à relancer un grep. `offset=1` reste possible : c'est une lecture
 * entière DÉLIBÉRÉE (réécrire une spec, par exemple), pas un accident.
 *
 * Laisse passer (sortie 0, silencieuse) dans tous les autres cas, y compris une charge illisible ou
 * un fichier introuvable : un garde-fou qui bloquerait par erreur coûterait plus qu'il n'économise.
 */
import fs from 'node:fs';

const SEUIL_OCTETS = 40 * 1024;
const GROSSE_SECTION = 200; // lignes — au-delà, on détaille ses `### `

/**
 * Titres d'un niveau donné avec leur plage (numérotation du Read, à partir de 1), hors blocs de
 * code et commentaires HTML — même règle que `sections()` dans scripts/docs_index.js, recopiée
 * parce que ce script-là exécute sa génération au chargement.
 */
function titres(lignes, prefixe) {
  const out = [];
  let code = false;
  let commentaire = false;
  lignes.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) { code = !code; return; }
    if (code) return;
    if (commentaire) { if (l.includes('-->')) commentaire = false; return; }
    if (l.includes('<!--') && !l.includes('-->')) { commentaire = true; return; }
    if (l.startsWith(prefixe)) out.push({ titre: l.slice(prefixe.length).trim(), de: i + 1 });
  });
  return out;
}

/** Complète chaque titre avec son `limit` : jusqu'au titre suivant de même niveau, ou `fin`. */
function avecLimites(liste, fin) {
  return liste.map((t, k) => ({ ...t, limit: (k + 1 < liste.length ? liste[k + 1].de : fin + 1) - t.de }));
}

const court = (s, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function raisonJournal(chemin, lignes) {
  const datees = titres(lignes, '## ').filter((t) => /^20\d\d-/.test(t.titre));
  const entrees = avecLimites(datees, lignes.length).slice(-5);
  return [
    `${chemin} fait ~${Math.round(fs.statSync(chemin).size / 1024)} Ko : jamais en entier, et jamais`,
    "`limit` sans `offset` (ce sont alors les entrées les PLUS ANCIENNES). Les 5 dernières entrées :",
    ...entrees.map((e) => `  offset ${e.de} limit ${e.limit} — ${court(e.titre)}`),
    "Les autres mois : `grep -n '^## 20' docs/journal/*.md | tail -5`.",
  ].join('\n');
}

function raisonDocument(chemin, lignes) {
  const h2 = avecLimites(titres(lignes, '## '), lignes.length);
  const h3 = titres(lignes, '### ');
  const plan = [];
  for (const s of h2) {
    plan.push(`  offset ${s.de} limit ${s.limit} — ${court(s.titre)}`);
    if (s.limit > GROSSE_SECTION) {
      const fin = s.de + s.limit - 1;
      const dedans = avecLimites(h3.filter((t) => t.de > s.de && t.de <= fin), fin);
      for (const t of dedans) plan.push(`    offset ${t.de} limit ${t.limit} — ${court(t.titre, 70)}`);
    }
  }
  return [
    `${chemin} fait ~${Math.round(fs.statSync(chemin).size / 1024)} Ko : lire la section utile, pas le`,
    "document entier (une spec : sa §0, dont docs/INDEX.md donne aussi la plage). Plan :",
    ...plan,
    "Lecture entière délibérée : Read avec offset=1.",
  ].join('\n');
}

let entree = '';
process.stdin.on('data', (d) => { entree += d; });
process.stdin.on('end', () => {
  try {
    const { tool_input: input = {} } = JSON.parse(entree || '{}');
    const chemin = input.file_path;
    if (typeof chemin !== 'string' || !/\/docs\/.+\.md$/.test(chemin)) process.exit(0);
    if (input.offset !== undefined && input.offset !== null) process.exit(0);
    if (!fs.existsSync(chemin) || fs.statSync(chemin).size <= SEUIL_OCTETS) process.exit(0);

    const lignes = fs.readFileSync(chemin, 'utf8').split('\n');
    if (lignes[lignes.length - 1] === '') lignes.pop();
    const raison = /\/docs\/journal\/[^/]+\.md$/.test(chemin)
      ? raisonJournal(chemin, lignes)
      : raisonDocument(chemin, lignes);

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: raison,
      },
    }));
    process.exit(0);
  } catch {
    process.exit(0); // Charge illisible ou fichier inattendu : ne jamais bloquer par erreur.
  }
});

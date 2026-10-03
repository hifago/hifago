#!/usr/bin/env node
/**
 * Garde-fou du corpus d'instructions hifago/ — ce que `docs_index.js` ne couvre pas (il ne
 * parcourt que `docs/` et garde sa seule mission : le manifeste).
 *
 *   node scripts/check-instructions.mjs   → exit 0 si tout est bon, exit 1 sinon (liste précise)
 *
 * Née de la régression du 2026-08-15 → 2026-09-07 : `CLAUDE.md` §12 avait déjà été vidé une fois
 * ("pour ne plus être chargé automatiquement") et avait regonflé à 569 lignes en trois semaines,
 * sans qu'aucun outil ne le signale. Doctrine du projet (`eslint.rules.mjs`) : « Une règle
 * documentée que rien ne vérifie n'est pas une règle : c'est un souhait. »
 *
 * Contrôles :
 *   1. `CLAUDE.md` ≤ 200 lignes.
 *   2. Chaque `.claude/rules/*.md` ≤ 100 lignes.
 *   3. `docs/backlog.md` ≤ 60 lignes.
 *   4. Tout `CLAUDE.md §N` (ou `§N.M` / `§N point M`) cité dans hifago/ (hors journal/prompts/
 *      archive/node_modules/build) désigne une section — et un sous-point — qui existe vraiment.
 *   5. Tout chemin `.md` cité entre backticks dans le corpus d'instructions (CLAUDE.md, règles,
 *      skills, backlog, AGENTS-PARALLELES.md) résout vers un fichier qui existe.
 *   6. Tout skill de projet respecte le format commun Claude/Codex (`name` + `description`).
 *   7. Toute règle de projet déclare au moins un motif YAML `paths:`.
 *
 * Appelé par le hook PostToolUse (`scripts/hooks/post-edit-check-instructions.mjs`) après chaque
 * édition, et par le job `lint` de la CI comme second filet.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const LIMITES = {
  'CLAUDE.md': 200,
  'docs/backlog.md': 60,
  REGLE: 100,
};

// Dossiers/fichiers exclus du balayage §4 — build, dépendances, et le corpus explicitement non
// chargé automatiquement (journal, prompts livrés, skills archivés).
const EXCLUS = new Set([
  'node_modules', '.git', '.next', '.vercel', 'dist', 'build', 'coverage',
  'storybook-static', 'test-results', '.turbo', '.agents',
]);
const EXCLUS_RACINE_RELATIFS = ['docs/journal', 'prompts', 'archive'];

const EXTENSIONS_SCANNEES = new Set([
  '.md', '.ts', '.tsx', '.js', '.mjs', '.sql', '.sh', '.yml', '.yaml',
]);

function marcher(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(ROOT, full).replace(/\\/g, '/');
    if (EXCLUS_RACINE_RELATIFS.some((p) => rel === p || rel.startsWith(p + '/'))) continue;
    if (entry.isDirectory()) marcher(full, acc);
    else if (EXTENSIONS_SCANNEES.has(path.extname(entry.name))) acc.push(full);
  }
  return acc;
}

function compterLignes(fichier) {
  const texte = fs.readFileSync(fichier, 'utf8');
  return texte.split('\n').length - (texte.endsWith('\n') ? 1 : 0);
}

/**
 * Découpe CLAUDE.md en sections `## N. ...` → { n: { titre, points: Set<number> } }.
 *
 * INDEX DÉPORTÉ (depuis le 2026-09-09) : une section dont le titre contient « index déporté »
 * garde sa numérotation dans CLAUDE.md mais range ses points dans un autre fichier, pour ne pas
 * peser sur le corpus chargé à chaque tour. Ses sous-points sont alors résolus contre le PREMIER
 * chemin `.md` cité entre backticks dans son corps. C'est ce qui permet aux ~90 citations
 * `CLAUDE.md §11.N` (code, migrations, specs, journal) de rester vraies et VÉRIFIÉES sans que les
 * 20 pièges soient rechargés à chaque tour. Une section déportée dont le fichier cible manque ou
 * ne porte aucun point numéroté est signalée : la délégation ne doit jamais désarmer le contrôle.
 */
function parserSections(texteClaudeMd, problemes = []) {
  const sections = new Map();
  const lignes = texteClaudeMd.split('\n');
  let courante = null;
  for (const ligne of lignes) {
    const entete = /^## (\d+)\.\s*(.*)$/.exec(ligne);
    if (entete) {
      courante = { titre: entete[2], points: new Set(), corps: [] };
      sections.set(Number(entete[1]), courante);
      continue;
    }
    if (courante) {
      courante.corps.push(ligne);
      const point = /^(\d+)\.\s/.exec(ligne);
      if (point) courante.points.add(Number(point[1]));
    }
  }

  for (const [n, section] of sections) {
    if (!/index déporté/i.test(section.titre)) continue;
    const cible = extraireCheminsMd(section.corps.join('\n'))[0];
    if (!cible) {
      problemes.push(
        `CLAUDE.md §${n} est marquée « index déporté » mais ne cite aucun fichier \`.md\` : ` +
        `les citations §${n}.N ne sont plus vérifiables.`
      );
      continue;
    }
    const chemin = path.join(ROOT, cible);
    if (!fs.existsSync(chemin)) {
      problemes.push(`CLAUDE.md §${n} déporte ses points vers \`${cible}\` — ce fichier n'existe pas.`);
      continue;
    }
    let n_ajoutes = 0;
    for (const ligne of fs.readFileSync(chemin, 'utf8').split('\n')) {
      const point = /^(\d+)\.\s/.exec(ligne);
      if (point) { section.points.add(Number(point[1])); n_ajoutes++; }
    }
    if (n_ajoutes === 0) {
      problemes.push(
        `CLAUDE.md §${n} déporte ses points vers \`${cible}\`, qui ne porte aucun point numéroté ` +
        `en début de ligne — les citations §${n}.N passeraient sans être vérifiées.`
      );
    }
  }

  return sections;
}

/** Trouve chaque citation `CLAUDE.md §N`, `§N.M`, `§N point M`, `§ N` dans un texte. */
function extraireCitations(texte) {
  const citations = [];
  // §N.M ou §N point M ou § N point M ou §N (sans point) — capturé séparément pour ne pas
  // confondre un simple "§3" avec "§3.5" (la présence du point/mot "point" décide du sous-point).
  const re = /§\s*(\d+)(?:\s*[.\s]\s*(?:point\s*)?(\d+))?/g;
  let m;
  while ((m = re.exec(texte))) {
    citations.push({ section: Number(m[1]), point: m[2] ? Number(m[2]) : null, brut: m[0] });
  }
  return citations;
}

/** Chemins `` `xxx.md` `` cités dans un texte, résolus depuis `depuisDir`. */
function extraireCheminsMd(texte) {
  const chemins = [];
  const re = /`([A-Za-z0-9_.\-/]+\.md)`/g;
  let m;
  while ((m = re.exec(texte))) chemins.push(m[1]);
  return chemins;
}

/** Parse le sous-ensemble YAML volontairement minimal utilisé par les frontmatters du projet. */
function parserFrontmatter(texte) {
  const lignes = texte.replace(/\r\n/g, '\n').split('\n');
  if (lignes[0] !== '---') return null;
  const fin = lignes.indexOf('---', 1);
  if (fin === -1) return null;

  const champs = new Map();
  const doublons = new Set();
  let cleCourante = null;
  for (const ligne of lignes.slice(1, fin)) {
    const definition = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(ligne);
    if (definition) {
      cleCourante = definition[1];
      if (champs.has(cleCourante)) doublons.add(cleCourante);
      champs.set(cleCourante, definition[2]);
      continue;
    }
    const element = /^\s+-\s+(.+)$/.exec(ligne);
    if (element && cleCourante) {
      const valeur = champs.get(cleCourante);
      champs.set(cleCourante, Array.isArray(valeur) ? [...valeur, element[1]] : [element[1]]);
    }
  }

  return { champs, doublons, corps: lignes.slice(fin + 1).join('\n').trim() };
}

function valeurYamlScalaire(valeur) {
  if (Array.isArray(valeur) || typeof valeur !== 'string') return '';
  const propre = valeur.trim();
  if (
    propre.length >= 2 &&
    ((propre.startsWith('"') && propre.endsWith('"')) ||
      (propre.startsWith("'") && propre.endsWith("'")))
  ) return propre.slice(1, -1).trim();
  return propre;
}

function listeYaml(valeur) {
  if (Array.isArray(valeur)) return valeur.map(valeurYamlScalaire).filter(Boolean);
  const propre = valeurYamlScalaire(valeur);
  if (!propre) return [];
  if (propre.startsWith('[') && propre.endsWith(']')) {
    return propre.slice(1, -1).split(',').map((item) => valeurYamlScalaire(item)).filter(Boolean);
  }
  return [propre];
}

function verifier() {
  const problemes = [];

  // 1-2. Tailles.
  const claudeMdPath = path.join(ROOT, 'CLAUDE.md');
  const nClaude = compterLignes(claudeMdPath);
  if (nClaude > LIMITES['CLAUDE.md']) {
    problemes.push(
      `CLAUDE.md fait ${nClaude} lignes (> ${LIMITES['CLAUDE.md']}) : l'état va au journal ` +
      `(docs/journal/<mois>.md), les points ouverts au backlog (docs/backlog.md), le savoir ` +
      `situationnel dans une règle .claude/rules/*.md — pas ici.`
    );
  }
  const backlogPath = path.join(ROOT, 'docs/backlog.md');
  if (fs.existsSync(backlogPath)) {
    const n = compterLignes(backlogPath);
    if (n > LIMITES['docs/backlog.md']) {
      problemes.push(
        `docs/backlog.md fait ${n} lignes (> ${LIMITES['docs/backlog.md']}) : un groupe entier ` +
        `doit partir en spec ou en ticket séparé plutôt que de rester ici.`
      );
    }
  }
  const reglesDir = path.join(ROOT, '.claude/rules');
  if (fs.existsSync(reglesDir)) {
    for (const f of fs.readdirSync(reglesDir)) {
      if (!f.endsWith('.md')) continue;
      const cheminRegle = path.join(reglesDir, f);
      const n = compterLignes(cheminRegle);
      if (n > LIMITES.REGLE) {
        problemes.push(
          `.claude/rules/${f} fait ${n} lignes (> ${LIMITES.REGLE}) : le piège le plus ancien ` +
          `part au journal avec un lien depuis la règle.`
        );
      }

      const frontmatter = parserFrontmatter(fs.readFileSync(cheminRegle, 'utf8'));
      if (!frontmatter) {
        problemes.push(`.claude/rules/${f} n'a pas de frontmatter YAML valide.`);
      } else if (listeYaml(frontmatter.champs.get('paths')).length === 0) {
        problemes.push(`.claude/rules/${f} doit déclarer au moins un motif dans \`paths:\`.`);
      }
    }
  }

  // 6. Skills portables entre Claude Code et Codex.
  const skillsDir = path.join(ROOT, '.claude/skills');
  if (fs.existsSync(skillsDir)) {
    for (const s of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!s.isDirectory()) continue;
      const cheminSkill = path.join(skillsDir, s.name, 'SKILL.md');
      if (!fs.existsSync(cheminSkill)) continue;
      const rel = `.claude/skills/${s.name}/SKILL.md`;
      const frontmatter = parserFrontmatter(fs.readFileSync(cheminSkill, 'utf8'));
      if (!frontmatter) {
        problemes.push(`${rel} n'a pas de frontmatter YAML valide.`);
        continue;
      }

      const cles = [...frontmatter.champs.keys()];
      const interdites = cles.filter((cle) => !['name', 'description'].includes(cle));
      const name = valeurYamlScalaire(frontmatter.champs.get('name'));
      const description = valeurYamlScalaire(frontmatter.champs.get('description'));
      if (frontmatter.doublons.size) {
        problemes.push(`${rel} répète les clés : ${[...frontmatter.doublons].join(', ')}.`);
      }
      if (interdites.length) {
        problemes.push(
          `${rel} contient des clés non portables (${interdites.join(', ')}) ; seules \`name\` et ` +
          '`description` sont admises.'
        );
      }
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name !== s.name) {
        problemes.push(`${rel} doit avoir \`name: ${s.name}\` (kebab-case identique au dossier).`);
      }
      if (!description || /[<>]/.test(description)) {
        problemes.push(`${rel} doit avoir une \`description\` non vide, sans chevrons \`< >\`.`);
      }
      if (!frontmatter.corps) problemes.push(`${rel} doit contenir des instructions après le frontmatter.`);
    }
  }

  // 3. Renvois `CLAUDE.md §N[.M]` — chaque section et sous-point cités doivent exister.
  const texteClaudeMd = fs.readFileSync(claudeMdPath, 'utf8');
  const sections = parserSections(texteClaudeMd, problemes);
  const fichiers = marcher(ROOT);
  const vusManquants = new Set();
  for (const fichier of fichiers) {
    if (fichier === claudeMdPath) continue;
    const rel = path.relative(ROOT, fichier).replace(/\\/g, '/');
    const texte = fs.readFileSync(fichier, 'utf8');
    if (!/CLAUDE\.md/.test(texte)) continue;
    // Ne considérer une citation `§N` que si `CLAUDE.md` apparaît dans les ~80 caractères qui
    // précèdent, pour ne pas confondre avec un `§N` de cahier des charges ou de spec.
    const re = /CLAUDE\.md[^\n]{0,80}?§\s*\d+(?:\s*[.\s]\s*(?:point\s*)?\d+)?/g;
    let m;
    while ((m = re.exec(texte))) {
      for (const c of extraireCitations(m[0])) {
        const cle = `${rel}::§${c.section}${c.point ? '.' + c.point : ''}`;
        if (vusManquants.has(cle)) continue;
        const section = sections.get(c.section);
        if (!section) {
          problemes.push(`${rel} cite CLAUDE.md §${c.section} — cette section n'existe plus.`);
          vusManquants.add(cle);
        } else if (c.point !== null && !section.points.has(c.point)) {
          problemes.push(
            `${rel} cite CLAUDE.md §${c.section}.${c.point} — ce sous-point n'existe plus dans ` +
            `« ${section.titre} » (points actuels : ${[...section.points].sort((a, b) => a - b).join(', ') || 'aucun'}).`
          );
          vusManquants.add(cle);
        }
      }
    }
  }

  // 4. Chemins `.md` cités dans le corpus d'instructions — doivent exister.
  const corpus = [
    'CLAUDE.md',
    'AGENTS-PARALLELES.md',
    'docs/backlog.md',
    ...(fs.existsSync(reglesDir) ? fs.readdirSync(reglesDir).filter((f) => f.endsWith('.md')).map((f) => `.claude/rules/${f}`) : []),
  ];
  if (fs.existsSync(skillsDir)) {
    for (const s of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (s.isDirectory() && fs.existsSync(path.join(skillsDir, s.name, 'SKILL.md'))) {
        corpus.push(`.claude/skills/${s.name}/SKILL.md`);
      }
    }
  }
  for (const relCorpus of corpus) {
    const p = path.join(ROOT, relCorpus);
    if (!fs.existsSync(p)) continue;
    const texte = fs.readFileSync(p, 'utf8');
    for (const cible of extraireCheminsMd(texte)) {
      // Résolution façon `@import` : depuis la racine, sinon depuis le dossier du fichier citant
      // (couvre les renvois courts entre fichiers voisins, ex. `.claude/rules/apps.md` → `ui.md`).
      const depuisRacine = path.join(ROOT, cible);
      const depuisDossier = path.join(path.dirname(p), cible);
      if (!fs.existsSync(depuisRacine) && !fs.existsSync(depuisDossier)) {
        problemes.push(`${relCorpus} cite \`${cible}\` — ce fichier n'existe pas.`);
      }
    }
  }

  return problemes;
}

const problemes = verifier();
if (problemes.length) {
  console.error('Corpus d\'instructions hifago/ — problèmes détectés :\n');
  for (const p of problemes) console.error(`  ✗ ${p}`);
  console.error('');
  process.exit(1);
}
console.log('Corpus d\'instructions hifago/ OK.');

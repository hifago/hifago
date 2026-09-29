#!/usr/bin/env node
/**
 * Manifeste documentaire pour les agents IA — hifago/ (nouveau stack, dépôt séparé).
 *
 *   node scripts/docs_index.js --build   → (re)génère docs/ai-index.json ET docs/INDEX.md
 *   node scripts/docs_index.js --check   → vérifie la cohérence, sort en erreur si dérive
 *   node scripts/docs_index.js --build --staged → idem --build, depuis l'index git (hook pre-commit)
 *
 * Même mécanisme que le manifeste du dépôt racine (`scripts/docs_index.js` à la racine du repo
 * Casa Kayam) — dupliqué ici plutôt que partagé car `hifago/` est un dépôt git séparé, cloné
 * indépendamment. Le manifeste est la porte d'entrée d'une IA travaillant dans `hifago/` : elle
 * le lit UNE fois puis ouvre un seul document. Il est dérivé de l'en-tête `---` de chaque fichier
 * de `docs/`, donc il ne peut pas mentir : si un document change de résumé, on régénère.
 *
 * Règle : tout nouveau document de `docs/` doit avoir un en-tête, et `npm run docs:check`
 * doit rester vert avant un commit.
 *
 * 2026-09-07 — étendu (chantier 4 du rangement) après le constat que `statut` mentait sur 6 specs
 * sur 26 (`brouillon` alors que le code était livré) : l'énumération à 3 valeurs ne pouvait pas
 * dire une livraison par lots sans mentir dans un sens ou l'autre. Ajouts : `statut` fermé à 4
 * valeurs + `reste:` pour `partiel` ; `revise:` sur une spec qui touche un cahier des charges,
 * vérifié contre la date du dernier commit du cahier (pas une date tapée à la main — 74 % des
 * `maj` étaient déjà en retard) ; `docs/INDEX.md` humain, généré comme `ai-index.json`.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const OUT = path.join(DOCS, 'ai-index.json');
const OUT_HUMAIN = path.join(DOCS, 'INDEX.md');
const SPECS_README = path.join(DOCS, 'specs/README.md');

/** Table de routage sujet → document. Éditée à la main, préservée à chaque régénération. */
const ROUTAGE = {
  'référencement, seo, sitemap, robots.txt, hreflang, données structurées json-ld':
    'docs/specs/26-referencement-seo-et-moteurs-ia.md',
  'stack technique, architecture cible, décisions déjà tranchées à ne pas rouvrir': 'docs/04-architecture-cible.md',
  'squelette RPC anti-survente, test de concurrence, recherche géo+JSONB à copier': 'docs/05-reference-technique.md',
  'modèle de données cible : entités, champs, établissement/chambre/produit/compte': 'docs/00-modele-de-donnees.md',
  'cahier des charges portail client (marketplace, réservation)': 'docs/01-cahier-des-charges-client.md',
  'cahier des charges portail socio (référent, prestador)': 'docs/02-cahier-des-charges-socio.md',
  'cahier des charges back-office admin': 'docs/03-cahier-des-charges-admin.md',
  'emails transactionnels : les 8 envois possibles, leur déclencheur et leur destinataire': 'docs/06-emails-transactionnels.md',
  'sommaire des specs de feature, gabarit réutilisable': 'docs/specs/README.md',
  'gabarit à copier pour spécifier une nouvelle feature': 'docs/specs/_modele.md',
  'comment poser les bonnes questions à Jérôme avant d\'écrire une spec, clarifier une ambiguïté': 'docs/specs/avant-la-spec.md',
  "historique complet d'une feature déjà livrée (jamais chargé automatiquement)": 'docs/journal/',
  'points ouverts, arbitrages en attente de Jérôme, dette connue non traitée, quoi faire maintenant': 'docs/backlog.md',
};

/** Fiabilité d'un thème : ce qu'une IA a le droit d'en déduire. */
const THEMES = {
  cadrage: { dossier: 'docs/', fiabilite: 'cible', note: "Cahiers des charges et architecture cible de la refonte. Décrit ce qui doit exister, pas forcément déjà codé — croiser avec le statut de la section." },
  specs: { dossier: 'docs/specs/', fiabilite: 'cible', note: "⚠️ Spec d'une feature précise, prête à coder. Vérifier `statut` (voir STATUTS) avant de citer comme déjà livré." },
  journal: { dossier: 'docs/journal/', fiabilite: 'vivant', note: "Historique chronologique, jamais élagué. Jamais chargé automatiquement en session — à ouvrir seulement pour comprendre une décision passée." },
};

/** Les seules valeurs valides de `statut` pour un document de thème `specs`. */
const STATUTS = ['brouillon', 'partiel', 'implemente', 'supprimee'];
const LABEL_STATUT = { brouillon: 'Brouillon', partiel: 'Partiel', implemente: 'Implémenté', supprimee: 'Supprimée' };

/** Cahiers des charges qu'une spec peut réviser via son champ `revise:`. */
const CAHIERS = [
  'docs/00-modele-de-donnees.md',
  'docs/01-cahier-des-charges-client.md',
  'docs/02-cahier-des-charges-socio.md',
  'docs/03-cahier-des-charges-admin.md',
];

const PROTOCOLE = [
  "Lire `routage` (sujet → chemin) : il est en tête de ce fichier et couvre les cas courants. Si le sujet y figure, s'arrêter là.",
  "Sinon seulement, lire `documents` et croiser `cles` et `questions`.",
  "N'ouvrir qu'UN document. Son en-tête `---` répète ces métadonnées : les 20 premières lignes confirment le bon choix.",
  "Vérifier `themes[<theme>].fiabilite` avant de citer : `cible` ne décrit pas forcément un comportement déjà livré.",
  "Pour une spec (`theme: specs`) : `statut: partiel` a un champ `reste` — le lire avant de dire une feature terminée.",
  "En cas de contradiction entre une spec `implemente`/`partiel` et un cahier des charges (00-03), la spec la plus récente prime — elle raffine le cahier, elle ne l'invente pas.",
  "Sinon, en cas de contradiction entre deux documents, le code fait foi, puis `hifago/docs/04-architecture-cible.md`.",
  "Ne jamais parcourir docs/ en entier ni ouvrir plusieurs gros fichiers « pour voir ».",
];

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (full === OUT_HUMAIN) continue; // généré par ce script, pas un document source
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.name.endsWith('.md')) acc.push(full);
  }
  return acc;
}

/**
 * `--staged` (utilisé par le hook pre-commit) : lire les documents dans l'INDEX git, pas dans
 * l'arbre de travail. POURQUOI : le hook régénérait depuis l'arbre de travail, donc une ligne
 * modifiée mais non mise en scène dans une spec finissait dans le manifeste commité alors que la
 * spec commitée ne l'avait pas — et la CI, qui relit le contenu commité, passait au rouge. `ko`
 * arrondi au Ko amortissait le défaut ; les plages de lignes de `docs/INDEX.md` ne l'amortissent pas.
 */
const STAGED = process.argv.includes('--staged');

function listerDocuments() {
  if (!STAGED) return walk(DOCS).map((f) => path.relative(ROOT, f).replace(/\\/g, '/')).sort();
  const out = execFileSync('git', ['ls-files', '-z', '--', 'docs'], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\0').filter((rel) => rel.endsWith('.md') && rel !== 'docs/INDEX.md').sort();
}

function lireDocument(rel) {
  if (!STAGED) return fs.readFileSync(path.join(ROOT, rel), 'utf8');
  return execFileSync('git', ['show', `:${rel}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** Parseur d'en-tête minimal : suffisant pour le sous-ensemble YAML qu'on s'autorise. */
function parseFrontMatter(text) {
  if (!text.startsWith('---\n')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const block = text.slice(4, end);
  const out = {};
  let key = null;
  let mode = null;
  for (const raw of block.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const m = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (m && !line.startsWith(' ')) {
      key = m[1];
      const val = m[2].trim();
      if (val === '>' || val === '|') { out[key] = ''; mode = 'bloc'; }
      else if (val === '') { out[key] = []; mode = 'liste'; }
      else if (val.startsWith('[')) {
        out[key] = val.slice(1, -1).split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
        mode = null;
      } else { out[key] = val.replace(/^"|"$/g, ''); mode = null; }
      continue;
    }
    const t = line.trim();
    if (mode === 'bloc') out[key] += (out[key] ? ' ' : '') + t;
    else if (mode === 'liste' && t.startsWith('- ')) {
      out[key].push(t.slice(2).trim().replace(/^"|"$/g, ''));
    }
  }
  return out;
}

/**
 * « Aujourd'hui » à Guatapé (YYYY-MM-DD), jamais à UTC — même règle que
 * `packages/domain/src/time/bogotaDates.ts`, recopiée plutôt qu'importée parce que ce script est
 * du JS nu lancé hors des workspaces (aucune étape de compilation TypeScript ne le précède).
 *
 * ⚠️ Ce n'est pas une précaution théorique. Ce fichier calculait `new Date().toISOString()` : entre
 * 19 h et minuit à Guatapé, il datait du LENDEMAIN. La CI, elle, relit la date du COMMIT — donc
 * tout `docs:index` lancé en soirée produisait un index que `docs:check` déclarait périmé dès le
 * push. C'est ce qui a mis `hifago-ci` au rouge cinq commits de suite les 2026-09-07/08, sans
 * qu'aucune vérification locale ne le dise (`npm run lint` ne lance pas les scripts de la CI).
 * `scripts/` n'était pas non plus balayé par `check-timezone.sh` — il l'est depuis le 2026-09-07.
 */
const partsBogota = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Bogota',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
function aujourdHuiBogota() {
  const parts = partsBogota.formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Date de dernière modification « réelle » de `file` (YYYY-MM-DD) : le jour même si le fichier a
 * des changements non commités (working tree ou index — un `docs:check` lancé avant un commit doit
 * voir la correction qu'on vient d'écrire, pas la dernière date commitée), sinon la date du dernier
 * commit qui l'a touché, sinon `null` (jamais commité et inexistant en working tree).
 */
// Un clone SUPERFICIEL (`--depth 1`, le défaut d'`actions/checkout`) rend le commit de tête pour
// n'importe quel chemin : `gitMaj` daterait alors tous les documents du même jour et l'index serait
// déclaré périmé à chaque push, sans qu'aucun message ne dise pourquoi. Refuser franchement plutôt
// que produire un index faux — c'est ce silence-là qui a coûté 17 runs rouges (2026-09-07).
function refuseSiSuperficiel() {
  try {
    const out = execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: ROOT, encoding: 'utf8' }).trim();
    if (out === 'true') {
      console.error(
        "Dépôt cloné en superficiel (--depth) : les dates par fichier seraient toutes fausses.\n" +
        "En CI, poser `fetch-depth: 0` sur actions/checkout. En local, `git fetch --unshallow`."
      );
      process.exit(2);
    }
  } catch {
    // Pas un dépôt git : `gitMaj` retombera sur le frontmatter, comportement déjà prévu.
  }
}

function gitMaj(file) {
  try {
    // Avec --staged, seul ce qui entre dans le commit compte comme « modifié aujourd'hui ».
    const args = STAGED ? ['diff', '--cached', '--name-only', '--', file] : ['status', '--porcelain', '--', file];
    const statut = execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
    if (statut.trim()) return aujourdHuiBogota();
  } catch {
    // Pas un repo git (ou commande indisponible) : on retombe sur `log`, qui échouera pareil.
  }
  try {
    const out = execFileSync(
      'git', ['log', '-1', '--format=%ad', '--date=short', '--', file],
      { cwd: ROOT, encoding: 'utf8' }
    ).trim();
    return out || null;
  } catch {
    return null;
  }
}

function collect() {
  const docs = [];
  const problemes = [];
  for (const rel of listerDocuments()) {
    const text = lireDocument(rel);
    const fm = parseFrontMatter(text);
    if (!fm) { problemes.push(`${rel} — en-tête \`---\` absent ou illisible`); continue; }
    for (const champ of ['id', 'titre', 'theme', 'statut', 'resume']) {
      if (!fm[champ]) problemes.push(`${rel} — champ « ${champ} » manquant`);
    }
    if (fm.theme && !THEMES[fm.theme]) problemes.push(`${rel} — thème inconnu « ${fm.theme} »`);

    const estMetaSpec = rel === 'docs/specs/README.md' || rel.endsWith('/_modele.md') || rel.endsWith('/avant-la-spec.md');
    if (fm.theme === 'specs' && !estMetaSpec) {
      if (fm.statut && !STATUTS.includes(fm.statut)) {
        problemes.push(`${rel} — statut « ${fm.statut} » hors énumération (${STATUTS.join(' | ')})`);
      }
      if (fm.statut === 'partiel' && !fm.reste) {
        problemes.push(`${rel} — statut "partiel" sans champ « reste » : quoi manque-t-il ?`);
      }
      if (fm.revise) {
        const cibles = Array.isArray(fm.revise) ? fm.revise : [fm.revise];
        for (const cibleBrute of cibles) {
          const cible = cibleBrute.split('#')[0].trim();
          if (!CAHIERS.includes(cible)) {
            problemes.push(`${rel} — revise « ${cibleBrute} » : ce n'est pas un cahier connu (${CAHIERS.join(', ')})`);
            continue;
          }
          const majSpec = gitMaj(rel);
          const majCahier = gitMaj(cible);
          if (majSpec && majCahier && majCahier < majSpec) {
            problemes.push(
              `${rel} révise ${cibleBrute} (maj spec ${majSpec}) mais ${cible} n'a pas été touché ` +
              `depuis (maj ${majCahier}) — reporter l'écart dans son en-tête « Écarts connus ».`
            );
          }
        }
      }
    }

    const resume = fm.resume.length > 125 ? fm.resume.slice(0, 122).replace(/\s+\S*$/, '') + '…' : fm.resume;
    docs.push({
      chemin: rel,
      theme: fm.theme,
      statut: fm.statut,
      reste: fm.reste || undefined,
      langue: fm.langue || 'fr',
      maj: gitMaj(rel) || fm.maj || null,
      ko: Math.round(Buffer.byteLength(text, 'utf8') / 1024),
      resume,
      cles: (fm.mots_cles || []).join(', '),
      questions: (fm.repond_a || []).slice(0, 3).join(' | '),
      titre: fm.titre,
      _id: fm.id,
    });
  }
  const ids = docs.map((d) => d._id);
  for (const id of new Set(ids)) {
    if (ids.filter((x) => x === id).length > 1) problemes.push(`id « ${id} » utilisé par plusieurs documents`);
  }
  for (const cible of new Set(Object.values(ROUTAGE))) {
    if (cible.endsWith('/')) continue; // pointeur vers un dossier (ex. docs/journal/), pas un fichier
    if (!fs.existsSync(path.join(ROOT, cible))) problemes.push(`routage → ${cible} : fichier introuvable`);
  }
  problemes.push(...verifierSommaireSpecs(docs));
  return { docs, problemes };
}

/**
 * Cohérence frontmatter ↔ table « Sommaire » de docs/specs/README.md : chaque spec `theme: specs`
 * doit y avoir une ligne, et la colonne « État » doit commencer par le libellé du `statut` réel.
 */
function verifierSommaireSpecs(docs) {
  const problemes = [];
  if (!fs.existsSync(SPECS_README)) return problemes;
  const table = fs.readFileSync(SPECS_README, 'utf8');
  const specs = docs.filter((d) => d.theme === 'specs' && d.chemin !== 'docs/specs/README.md'
    && !d.chemin.endsWith('/_modele.md') && !d.chemin.endsWith('/avant-la-spec.md'));
  for (const spec of specs) {
    const nomFichier = path.basename(spec.chemin);
    const ligneRe = new RegExp(`\\[[^\\]]*\\]\\(${nomFichier.replace('.', '\\.')}\\)[^\\n]*`);
    const m = ligneRe.exec(table);
    if (!m) {
      problemes.push(`docs/specs/README.md — aucune ligne du sommaire ne pointe vers ${nomFichier}`);
      continue;
    }
    const label = LABEL_STATUT[spec.statut];
    if (label && !m[0].includes(label)) {
      problemes.push(
        `docs/specs/README.md — la ligne de ${nomFichier} ne contient pas « ${label} » ` +
        `(statut réel du frontmatter : ${spec.statut})`
      );
    }
  }
  return problemes;
}

function build(docs) {
  return {
    _lisez_moi: "Manifeste de la base documentaire hifago/. Généré par `npm run docs:index`. Ne pas éditer à la main : éditer l'en-tête `---` des documents, puis régénérer.",
    version: 1,
    maj: aujourdHuiBogota(),
    protocole_ia: PROTOCOLE,
    routage: ROUTAGE,
    themes: THEMES,
    statuts_specs: STATUTS,
    documents: docs.map(({ _id, titre, ...reste }) => reste),
  };
}

/** Sérialisation compacte : un document par ligne, le reste lisible. */
function serialiser(manifeste) {
  const { documents, ...tete } = manifeste;
  const head = JSON.stringify(tete, null, 2).replace(/\n?}$/, '');
  const lignes = documents.map((d) => '    ' + JSON.stringify(d)).join(',\n');
  return `${head},\n  "documents": [\n${lignes}\n  ]\n}\n`;
}

/** `docs/INDEX.md` — sommaire humain, par thème, généré (jamais édité à la main). */
function construireIndexHumain(docs) {
  const parThe = { cadrage: [], specs: [], journal: [] };
  for (const d of docs) if (parThe[d.theme]) parThe[d.theme].push(d);

  const tronquer = (s, n) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s);
  const ligne = (d) => {
    const reste = d.reste ? ` (reste : ${tronquer(d.reste, 90)})` : '';
    const statut = d.theme === 'specs' && d.statut
      ? ` — **${LABEL_STATUT[d.statut] || d.statut}**${reste}`
      : '';
    const maj = d.maj ? ` · maj ${d.maj}` : '';
    return `- [${d.titre}](${d.chemin.replace(/^docs\//, '')})${statut}${maj}`;
  };

  return `# Index de la documentation hifago/

> Généré par \`npm run docs:index\` — ne pas éditer à la main. Sommaire **humain** ; le
> \`docs/ai-index.json\` voisin sert le même contenu à une IA (table de routage sujet → document).
> Un seul fichier à ouvrir pour savoir ce qui existe : celui-ci.

## Cadrage — architecture, modèle de données, cahiers des charges
${parThe.cadrage.map(ligne).join('\n')}

## Specs — features prêtes à coder ou livrées
${parThe.specs.map(ligne).join('\n')}

## Journal — historique chronologique (jamais chargé automatiquement)
${parThe.journal.map(ligne).join('\n')}
`;
}

/**
 * Écarts NOMMÉS entre le tableau `documents` committé et celui qu'on vient de reconstruire.
 *
 * POURQUOI (revue de CI du 2026-09-19) : `--check` se contentait d'un `JSON.stringify(a) !== b`
 * et imprimait « ne correspond plus aux documents » — sans dire QUEL document ni QUEL champ.
 * `docs:check` est la 2ᵉ cause d'échec de la CI (3 des 15 derniers échecs du job lint), et chaque
 * diagnostic demandait de régénérer puis lire un `git diff` pour comprendre. Le voici dit tout de
 * suite. Le contrôle est strictement le même — seul le message change.
 */
function ecartsDocuments(actuels, attendus) {
  const ecarts = [];
  const bref = (v) => {
    if (v === undefined) return '(absent)';
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.length > 60 ? s.slice(0, 59) + '…' : s;
  };
  const parChemin = (l) => new Map(l.map((d) => [d.chemin, d]));
  const a = parChemin(actuels);
  const b = parChemin(attendus);

  for (const chemin of b.keys()) {
    if (!a.has(chemin)) ecarts.push(`${chemin} — document absent du manifeste (nouveau document)`);
  }
  for (const chemin of a.keys()) {
    if (!b.has(chemin)) ecarts.push(`${chemin} — encore listé mais introuvable (supprimé ou renommé)`);
  }
  for (const [chemin, attendu] of b) {
    const actuel = a.get(chemin);
    if (!actuel) continue;
    for (const champ of new Set([...Object.keys(attendu), ...Object.keys(actuel)])) {
      if (JSON.stringify(actuel[champ]) !== JSON.stringify(attendu[champ])) {
        ecarts.push(`${chemin} — ${champ} : ${bref(actuel[champ])} → ${bref(attendu[champ])}`);
      }
    }
  }
  // Même contenu mais ordre différent : invisible ci-dessus, et pourtant le manifeste diffère.
  if (!ecarts.length && JSON.stringify(actuels) !== JSON.stringify(attendus)) {
    ecarts.push("l'ordre des documents diffère de l'ordre généré");
  }
  return ecarts;
}

/**
 * Écarts d'EN-TÊTE (`routage`, `themes`, `protocole_ia`, `statuts_specs`, `version`).
 *
 * ⚠️ `maj` est volontairement EXCLU : c'est la date de génération, réécrite à chaque `--build`.
 * La comparer rendrait le contrôle rouge tous les jours à minuit sans qu'aucun fichier n'ait bougé.
 *
 * POURQUOI ce contrôle existe : `--check` ne regardait QUE `documents`. Modifier ROUTAGE ou THEMES
 * dans ce script laissait donc le manifeste committé périmé avec un check au VERT — une dérive
 * silencieuse, exactement le contraire de ce que CLAUDE.md §11.20 demande.
 */
function ecartsEntete(actuel, attendu) {
  const ecarts = [];
  const sansMaj = ({ maj, documents, ...reste }) => reste;
  const a = sansMaj(actuel);
  const b = sansMaj(attendu);
  for (const champ of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[champ]) !== JSON.stringify(b[champ])) {
      ecarts.push(`en-tête — « ${champ} » diffère de ce que génère scripts/docs_index.js`);
    }
  }
  return ecarts;
}

const mode = process.argv.includes('--check') ? 'check' : 'build';
refuseSiSuperficiel();
const { docs, problemes } = collect();

if (mode === 'check') {
  const ecarts = [];
  if (!fs.existsSync(OUT)) ecarts.push('docs/ai-index.json est absent');
  else {
    const actuel = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    const attendu = build(docs);
    const detail = [
      ...ecartsDocuments(actuel.documents || [], attendu.documents),
      ...ecartsEntete(actuel, attendu),
    ];
    for (const d of detail) ecarts.push(`docs/ai-index.json : ${d}`);
  }
  if (!fs.existsSync(OUT_HUMAIN)) ecarts.push('docs/INDEX.md est absent');
  else if (fs.readFileSync(OUT_HUMAIN, 'utf8') !== construireIndexHumain(docs)) {
    ecarts.push('docs/INDEX.md ne correspond plus aux documents');
  }
  const tout = [...problemes, ...ecarts];
  if (tout.length) {
    console.error('Base documentaire hifago/ — problèmes détectés :\n');
    for (const p of tout) console.error(`  ✗ ${p}`);
    console.error('\nRégénérer : npm run docs:index  (puis committer ai-index.json et INDEX.md)');
    console.error('Ce geste est automatisé par le hook pre-commit — voir scripts/git-hooks/pre-commit.');
    process.exit(1);
  }
  console.log(`Base documentaire hifago/ OK — ${docs.length} documents indexés, manifeste et index à jour.`);
} else {
  if (problemes.length) {
    console.error('Problèmes détectés :\n');
    for (const p of problemes) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  fs.writeFileSync(OUT, serialiser(build(docs)), 'utf8');
  fs.writeFileSync(OUT_HUMAIN, construireIndexHumain(docs), 'utf8');
  const ko = Math.round((fs.statSync(OUT).size / 1024) * 10) / 10;
  console.log(`docs/ai-index.json généré — ${docs.length} documents, ${ko} Ko. docs/INDEX.md généré.`);
}

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
 *
 * 2026-09-28 — plus AUCUNE date dans les sorties (ni `maj` par document, ni date de génération) :
 * dérivée de `git log`, elle faisait dépendre le manifeste de l'HISTORIQUE, pas du contenu — une
 * fusion, un squash ou un `--amend` le périmait sans qu'aucun document n'ait changé (c772927).
 * Les deux fichiers générés sont désormais une fonction pure du contenu de `docs/`. `gitMaj` ne
 * sert plus qu'au contrôle `revise`.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const OUT = path.join(DOCS, 'ai-index.json');
const OUT_HUMAIN = path.join(DOCS, 'INDEX.md');

/**
 * Raccourcis sujet → document(s), en tête de `docs/INDEX.md`. Édités à la main, chaque cible est
 * vérifiée. Seulement les sujets que les titres de la carte ne disent pas d'eux-mêmes — et jamais
 * un chiffre qui dérive (l'ancienne table de routage annonçait « les 8 envois » d'un document qui
 * en listait 11).
 */
const RACCOURCIS = [
  ['quoi faire maintenant, points ouverts, arbitrages en attente de Jérôme', ['docs/backlog.md']],
  ['stack, architecture, décisions déjà tranchées à ne pas rouvrir', ['docs/04-architecture-cible.md']],
  ['squelette RPC anti-survente, test de concurrence, recherche géo+JSONB à copier', ['docs/05-reference-technique.md']],
  ['modèle de données : entités et champs (établissement, produit, compte)', ['docs/00-modele-de-donnees.md']],
  ['emails transactionnels : envois, déclencheurs, destinataires', ['docs/06-emails-transactionnels.md']],
  ['SEO : sitemap, robots.txt, hreflang, JSON-LD', ['docs/specs/26-referencement-seo-et-moteurs-ia.md']],
  ['pièges empiriques numérotés (`CLAUDE.md §11.N`)', ['docs/pieges-empiriques.md']],
  ['écrire une spec : les questions à poser, puis le gabarit', ['docs/specs/avant-la-spec.md', 'docs/specs/_modele.md']],
];

/** Thèmes valides d'un en-tête `---` — et rubriques de la carte. */
const THEMES = ['cadrage', 'specs', 'journal'];

/** Les seules valeurs valides de `statut` pour un document de thème `specs`. */
const STATUTS = ['brouillon', 'partiel', 'implemente', 'supprimee'];

/** Cahiers des charges qu'une spec peut réviser via son champ `revise:`. */
const CAHIERS = [
  'docs/00-modele-de-donnees.md',
  'docs/01-cahier-des-charges-client.md',
  'docs/02-cahier-des-charges-socio.md',
  'docs/03-cahier-des-charges-admin.md',
];

const GLYPHE = { implemente: '✓', partiel: '◐', brouillon: '○', supprimee: '✗' };

/**
 * La §0 « Contrat compact » est ce que la carte envoie lire seul : toute spec doit en avoir une, de
 * 150 lignes au plus (le gabarit vise 80-150). Les specs non conformes au 2026-09-28 sont tolérées
 * ici, NOMMÉES — et la liste ne peut que rétrécir, mécaniquement : une exemption devenue inutile
 * fait échouer le contrôle, et aucune spec numérotée au-delà de DERNIERE_SPEC_EXEMPTABLE ne peut y
 * entrer (une spec nouvelle naît conforme).
 */
const CONTRAT_MAX_LIGNES = 150;
const DERNIERE_SPEC_EXEMPTABLE = 40;
const EXEMPTIONS_CONTRAT = {
  // Antérieures au gabarit à §0 (01-08) ou écrites hors gabarit (25, 38).
  sans: ['01', '02', '03', '04', '05', '07', '08', '25', '38'],
  // §0 au-delà de 150 lignes — à resserrer à la prochaine réouverture de la spec.
  longue: ['17', '19', '23', '28', '29', '30', '33'],
};

/**
 * Mode d'emploi en tête de `docs/INDEX.md` — ce que portait `protocole_ia` dans l'ancien
 * manifeste, là où l'agent le lit forcément : dans le premier fichier qu'il ouvre.
 */
const MODE_EMPLOI = [
  "Générée par `npm run docs:index` (hooks pre-commit et pre-merge-commit) — ne pas éditer à la main.",
  "Point d'entrée unique, humains et IA. Liens relatifs à `docs/`.",
  '',
  "1. Repérer le document ci-dessous — ou dans les Raccourcis si le sujet n'est pas un titre.",
  "2. Spec : Read avec l'`offset`/`limit` de sa §0 — le contrat pour coder, qui suffit seul.",
  "3. Autre document de plus de 40 Ko : un Read sans `offset` est refusé et renvoie son plan avec l'offset/limit",
  "   de chaque section (hook `scripts/hooks/guard-doc-read.mjs`) ; `offset=1` pour une lecture entière délibérée.",
  "4. Sujet introuvable ici : `grep -i <mot> docs/ai-index.json` (une ligne par document : résumé, mots-clés, questions).",
  "5. État courant : `grep -n '^## 20' docs/journal/*.md | tail -5`, puis Read avec `offset` et `limit`.",
  '',
  "Specs : ✓ livrée · ◐ partielle (lire « reste ») · ○ brouillon · ✗ supprimée (→ remplaçante).",
  "Le cadrage (00-06) décrit la cible, pas forcément ce qui est livré. En cas de contradiction, la spec",
  "livrée ou partielle la plus récente prime sur le cahier ; sinon le code fait foi, puis `04-architecture-cible.md`.",
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
 * Titres `## ` d'un document avec leur plage de lignes (numérotées à partir de 1, comme l'`offset`
 * du Read de Claude Code), hors blocs de code — même indentés dans une liste — et hors commentaires
 * HTML. La fin d'une section ne compte pas les lignes vides ni le `---` qui la séparent de la suivante.
 */
function sections(text) {
  const lignes = text.split('\n');
  if (lignes[lignes.length - 1] === '') lignes.pop();
  const out = [];
  let code = false;
  let commentaire = false;
  lignes.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) { code = !code; return; }
    if (code) return;
    if (commentaire) { if (l.includes('-->')) commentaire = false; return; }
    if (l.includes('<!--') && !l.includes('-->')) { commentaire = true; return; }
    if (l.startsWith('## ')) out.push({ titre: l.slice(3).trim(), de: i + 1 });
  });
  out.forEach((s, k) => {
    let a = k + 1 < out.length ? out[k + 1].de - 1 : lignes.length;
    while (a > s.de && /^\s*(---)?\s*$/.test(lignes[a - 1])) a -= 1;
    s.a = a;
  });
  return out;
}

/** Présence et taille de la §0 d'une spec active, exemptions comprises (voir EXEMPTIONS_CONTRAT). */
function verifierContrat(rel, contrat) {
  const n = path.basename(rel).slice(0, 2);
  const ou = 'scripts/docs_index.js, EXEMPTIONS_CONTRAT';
  const problemes = [];
  const sans = EXEMPTIONS_CONTRAT.sans.includes(n);
  const longue = EXEMPTIONS_CONTRAT.longue.includes(n);
  if (!contrat && !sans) {
    problemes.push(`${rel} — pas de « ## 0. Contrat compact » : la carte n'a aucune plage à donner (gabarit : docs/specs/_modele.md)`);
  }
  if (contrat && sans) problemes.push(`${rel} — a désormais une §0 : retirer « ${n} » de ${ou}.sans`);
  if (contrat && contrat.limit > CONTRAT_MAX_LIGNES && !longue) {
    problemes.push(`${rel} — §0 de ${contrat.limit} lignes (> ${CONTRAT_MAX_LIGNES}) : la resserrer, le détail va dans les sections 1-12`);
  }
  if (longue && (!contrat || contrat.limit <= CONTRAT_MAX_LIGNES)) {
    problemes.push(`${rel} — §0 revenue à ${contrat ? contrat.limit : 0} lignes : retirer « ${n} » de ${ou}.longue`);
  }
  return problemes;
}

/** Plage de la « §0 Contrat compact » d'une spec, au format du Read : { offset, limit } ou null. */
function contratCompact(text) {
  const zero = sections(text).find((s) => /^0\.\s/.test(s.titre));
  return zero ? { offset: zero.de, limit: zero.a - zero.de + 1 } : null;
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
  const chemins = listerDocuments();
  for (const rel of chemins) {
    const text = lireDocument(rel);
    const fm = parseFrontMatter(text);
    if (!fm) { problemes.push(`${rel} — en-tête \`---\` absent ou illisible`); continue; }
    const remplacePar = [].concat(fm.remplace_par || []);
    for (const champ of ['id', 'titre', 'theme', 'statut', 'resume']) {
      if (!fm[champ]) problemes.push(`${rel} — champ « ${champ} » manquant`);
    }
    if (fm.theme && !THEMES.includes(fm.theme)) problemes.push(`${rel} — thème inconnu « ${fm.theme} »`);

    const estMetaSpec = rel === 'docs/specs/README.md' || rel.endsWith('/_modele.md') || rel.endsWith('/avant-la-spec.md');
    if (fm.theme === 'specs' && !estMetaSpec) {
      if (fm.statut && !STATUTS.includes(fm.statut)) {
        problemes.push(`${rel} — statut « ${fm.statut} » hors énumération (${STATUTS.join(' | ')})`);
      }
      if (fm.statut === 'partiel' && !fm.reste) {
        problemes.push(`${rel} — statut "partiel" sans champ « reste » : quoi manque-t-il ?`);
      }
      // `remplace_par: [NN]` — une spec supprimée dit par quoi elle est remplacée, et la cible existe :
      // sans ce lien, un agent qui tombe sur l'archive ne sait pas où est la vérité d'aujourd'hui.
      if (fm.statut === 'supprimee' && !remplacePar.length) {
        problemes.push(`${rel} — statut "supprimee" sans champ « remplace_par » : par quelle spec ?`);
      }
      for (const n of remplacePar) {
        if (!chemins.some((c) => c.startsWith(`docs/specs/${n}-`))) {
          problemes.push(`${rel} — remplace_par « ${n} » : aucune spec docs/specs/${n}-*.md`);
        }
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
      remplace_par: remplacePar.length ? remplacePar : undefined,
      langue: fm.langue || 'fr',
      ko: Math.round(Buffer.byteLength(text, 'utf8') / 1024),
      resume,
      cles: (fm.mots_cles || []).join(', '),
      questions: (fm.repond_a || []).slice(0, 3).join(' | '),
      titre: fm.titre,
      _id: fm.id,
      _contrat: fm.theme === 'specs' && !estMetaSpec ? contratCompact(text) : null,
    });
    if (fm.theme === 'specs' && !estMetaSpec && fm.statut !== 'supprimee') {
      problemes.push(...verifierContrat(rel, docs[docs.length - 1]._contrat));
    }
  }
  for (const [genre, numeros] of Object.entries(EXEMPTIONS_CONTRAT)) {
    for (const n of numeros) {
      if (Number(n) > DERNIERE_SPEC_EXEMPTABLE) {
        problemes.push(`EXEMPTIONS_CONTRAT.${genre} contient ${n} : une spec postérieure à la ${DERNIERE_SPEC_EXEMPTABLE} naît avec une §0 conforme, sans exemption`);
      }
      const spec = docs.find((d) => d.chemin.startsWith(`docs/specs/${n}-`));
      if (!spec || spec.statut === 'supprimee') {
        problemes.push(`EXEMPTIONS_CONTRAT.${genre} contient ${n} : aucune spec active de ce numéro — retirer l'exemption`);
      }
    }
  }
  const ids = docs.map((d) => d._id);
  for (const id of new Set(ids)) {
    if (ids.filter((x) => x === id).length > 1) problemes.push(`id « ${id} » utilisé par plusieurs documents`);
  }
  for (const [sujet, cibles] of RACCOURCIS) {
    for (const cible of cibles) {
      if (!chemins.includes(cible)) problemes.push(`raccourci « ${sujet} » → ${cible} : document introuvable`);
    }
  }
  return { docs, problemes };
}

function build(docs) {
  return {
    _lisez_moi: "Index de RECHERCHE de la base documentaire hifago/ : une ligne par document, à interroger par `grep -i <mot>`, jamais à lire en entier. Point d'entrée : docs/INDEX.md. Généré par `npm run docs:index` — éditer l'en-tête `---` des documents, puis régénérer.",
    version: 2,
    // Seulement ce qui sert à TROUVER un document par grep : `theme` se lit dans le chemin, `ko` et
    // la plage de la §0 sont dans la carte, `langue` valait « fr » partout. Une spec supprimée ne
    // garde ni résumé ni mots-clés ni questions — elle sortait encore sur « hôtel » — seulement le
    // lien vers sa remplaçante.
    documents: docs.map(({ chemin, statut, reste, remplace_par, resume, cles, questions }) =>
      statut === 'supprimee'
        ? { chemin, statut, remplace_par, reste }
        : { chemin, statut, reste, remplace_par, resume, cles, questions }),
  };
}

/** Sérialisation compacte : un document par ligne, le reste lisible. */
function serialiser(manifeste) {
  const { documents, ...tete } = manifeste;
  const head = JSON.stringify(tete, null, 2).replace(/\n?}$/, '');
  const lignes = documents.map((d) => '    ' + JSON.stringify(d)).join(',\n');
  return `${head},\n  "documents": [\n${lignes}\n  ]\n}\n`;
}

/**
 * `docs/INDEX.md` — la CARTE : point d'entrée unique, humains et IA (généré, jamais édité à la main).
 *
 * POURQUOI (audit du 2026-09-28) : l'agent entrait par `ai-index.json` (39 Ko, lu en entier, jamais
 * sous le niveau du fichier) puis ouvrait une spec entière. La carte tient en ~9 Ko, une ligne par
 * document, et donne pour chaque spec la plage de sa §0 au format du Read (offset/limit) : la
 * question « quelle spec couvre le panier ? » passe de ~18 k à ~5 k tokens. Les numéros de ligne ne
 * sont tolérables QUE parce qu'ils sont générés et vérifiés (`--check`, CLAUDE.md §11.20) — et c'est
 * pour cela qu'aucune ligne du journal n'y figure : une entrée non commitée les périmerait.
 */
function construireIndexHumain(docs) {
  const tronquer = (s, n) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s);
  const relatif = (chemin) => chemin.replace(/^docs\//, '');
  const estSpecFeature = (d) => /^docs\/specs\/\d/.test(d.chemin);

  const ligne = (d) => {
    const morceaux = [`- [${tronquer(d.titre, 70)}](${relatif(d.chemin)}) ${d.ko}K`];
    if (estSpecFeature(d)) {
      morceaux.push(GLYPHE[d.statut] || d.statut);
      if (d.remplace_par) morceaux.push(`→ ${d.remplace_par.join(', ')}`);
      else if (d._contrat) morceaux.push(`· §0 offset ${d._contrat.offset} limit ${d._contrat.limit}`);
      else morceaux.push('· sans §0');
      if (d.statut === 'partiel' && d.reste) morceaux.push(`· reste : ${tronquer(d.reste, 90)}`);
    }
    if (d.chemin.startsWith('docs/journal/')) morceaux.push('· jamais en entier (voir 5.)');
    return morceaux.join(' ');
  };
  const rubrique = (theme, filtre = () => true) =>
    docs.filter((d) => d.theme === theme && filtre(d)).map(ligne).join('\n');
  const raccourcis = RACCOURCIS
    .map(([sujet, cibles]) => `- ${sujet} → ${cibles.map((c) => `[${relatif(c)}](${relatif(c)})`).join(', ')}`)
    .join('\n');

  return `# Carte de la documentation hifago/

${MODE_EMPLOI.map((l) => (l ? `> ${l}` : '>')).join('\n')}

## Raccourcis
${raccourcis}

## Cadrage — la cible de la refonte
${rubrique('cadrage')}

## Specs — une feature chacune
${rubrique('specs', estSpecFeature)}
${rubrique('specs', (d) => !estSpecFeature(d))}

## Suivi — backlog, dette, pièges, journal
${rubrique('journal')}
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
 * POURQUOI ce contrôle existe : `--check` ne regardait QUE `documents`. Modifier ROUTAGE ou THEMES
 * dans ce script laissait donc le manifeste committé périmé avec un check au VERT — une dérive
 * silencieuse, exactement le contraire de ce que CLAUDE.md §11.20 demande.
 */
function ecartsEntete(actuel, attendu) {
  const ecarts = [];
  const sansDocuments = ({ documents, ...reste }) => reste;
  const a = sansDocuments(actuel);
  const b = sansDocuments(attendu);
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
  else {
    // Nommer la première ligne qui diffère (ex. « §0 offset 48 » devenu 49 parce qu'une ligne a été
    // ajoutée au-dessus) plutôt qu'un « ne correspond plus » qui oblige à régénérer pour comprendre.
    const actuel = fs.readFileSync(OUT_HUMAIN, 'utf8').split('\n');
    const attendu = construireIndexHumain(docs).split('\n');
    const i = attendu.findIndex((l, k) => l !== actuel[k]);
    if (i !== -1 || actuel.length !== attendu.length) {
      const k = i === -1 ? attendu.length : i;
      ecarts.push(`docs/INDEX.md, ligne ${k + 1} : « ${actuel[k] ?? '(absente)'} » → attendu « ${attendu[k] ?? '(absente)'} »`);
    }
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

#!/usr/bin/env node
/** Injecte avant une lecture/édition Codex toute règle `.claude/rules/*.md` dont `paths:` matche. */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RULES = path.join(ROOT, '.claude', 'rules');

function retirerGuillemets(valeur) {
  const v = valeur.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function lireMotifs(texte) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(texte);
  if (!fm) return [];
  const lignes = fm[1].split(/\r?\n/);
  const motifs = [];
  let dansPaths = false;
  for (const ligne of lignes) {
    const cle = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(ligne);
    if (cle) {
      dansPaths = cle[1] === 'paths';
      if (dansPaths && cle[2].trim().startsWith('[')) {
        const contenu = cle[2].trim().slice(1, -1);
        for (const valeur of contenu.split(',')) if (valeur.trim()) motifs.push(retirerGuillemets(valeur));
      }
      continue;
    }
    if (dansPaths) {
      const item = /^\s+-\s+(.+)$/.exec(ligne);
      if (item) motifs.push(retirerGuillemets(item[1]));
      else if (ligne.trim()) dansPaths = false;
    }
  }
  return motifs;
}

function developperAccolades(motif) {
  const m = /\{([^{}]+)\}/.exec(motif);
  if (!m) return [motif];
  return m[1].split(',').flatMap((choix) =>
    developperAccolades(motif.slice(0, m.index) + choix + motif.slice(m.index + m[0].length))
  );
}

function globVersRegex(motif) {
  let source = '^';
  for (let i = 0; i < motif.length;) {
    if (motif.startsWith('**/', i)) {
      source += '(?:.*/)?';
      i += 3;
    } else if (motif.startsWith('**', i)) {
      source += '.*';
      i += 2;
    } else if (motif[i] === '*') {
      source += '[^/]*';
      i++;
    } else if (motif[i] === '?') {
      source += '[^/]';
      i++;
    } else {
      source += motif[i].replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
      i++;
    }
  }
  return new RegExp(source + '$');
}

function matche(motif, chemin) {
  return developperAccolades(motif).some((m) => globVersRegex(m).test(chemin));
}

function normaliserChemin(brut) {
  if (typeof brut !== 'string' || !brut.trim()) return null;
  const propre = brut.trim();
  const relatif = path.isAbsolute(propre) ? path.relative(ROOT, propre) : propre;
  const normalise = relatif.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^(?:a|b)\//, '');
  return normalise === '..' || normalise.startsWith('../') ? null : normalise;
}

function cheminsDuPayload(payload) {
  const candidats = [payload?.tool_input?.file_path, payload?.tool_input?.path];
  for (const contenu of [payload?.tool_input?.command, payload?.tool_input?.patch]) {
    if (typeof contenu !== 'string') continue;
    for (const match of contenu.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) candidats.push(match[1]);
    for (const match of contenu.matchAll(/^\*\*\* Move to: (.+)$/gm)) candidats.push(match[1]);
  }
  return [...new Set(candidats.map(normaliserChemin).filter(Boolean))];
}

let entree = '';
process.stdin.on('data', (d) => { entree += d; });
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(entree || '{}');
  } catch {
    process.exit(0);
  }

  const chemins = cheminsDuPayload(payload);
  if (chemins.length === 0) process.exit(0);

  const applicables = [];
  for (const nom of fs.readdirSync(RULES).filter((f) => f.endsWith('.md')).sort()) {
    const texte = fs.readFileSync(path.join(RULES, nom), 'utf8');
    const motifs = lireMotifs(texte);
    if (motifs.some((motif) => chemins.some((chemin) => matche(motif, chemin)))) {
      applicables.push(`===== .claude/rules/${nom} =====\n${texte.trim()}`);
    }
  }

  if (applicables.length === 0) process.exit(0);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: `Règles Hifago applicables à ${chemins.join(', ')} :\n\n${applicables.join('\n\n')}`,
    },
  }));
});

#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(racine, '.claude', 'skills');
const destination = path.join(racine, '.agents', 'skills');

fs.mkdirSync(destination, { recursive: true });

let crees = 0;
let existants = 0;

for (const entree of fs.readdirSync(source, { withFileTypes: true })) {
  if (!entree.isDirectory()) continue;

  const cible = path.join(source, entree.name);
  const lien = path.join(destination, entree.name);

  if (fs.existsSync(lien)) {
    const cibleReelle = fs.realpathSync(cible);
    const lienReel = fs.realpathSync(lien);
    if (cibleReelle !== lienReel) {
      throw new Error(`${lien} existe déjà mais ne pointe pas vers ${cible}`);
    }
    existants++;
    continue;
  }

  fs.symlinkSync(cible, lien, process.platform === 'win32' ? 'junction' : 'dir');
  crees++;
}

console.log(`Skills Codex Hifago : ${crees} lien(s) créé(s), ${existants} déjà correct(s).`);

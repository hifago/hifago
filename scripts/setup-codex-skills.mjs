#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dossierClaude = path.join(racine, '.claude');
const dossierAgents = path.join(racine, '.agents');
const silencieux = process.argv.includes('--quiet');

fs.mkdirSync(dossierAgents, { recursive: true });

const reel = (p) => {
  const valeur = fs.realpathSync(p);
  return process.platform === 'win32' ? valeur.toLowerCase() : valeur;
};

function existeMemeCommeLien(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch (erreur) {
    if (erreur?.code === 'ENOENT') return false;
    throw erreur;
  }
}

function creerAlias(source, destination) {
  const cible = process.platform === 'win32' ? source : path.relative(path.dirname(destination), source);
  fs.symlinkSync(cible, destination, process.platform === 'win32' ? 'junction' : 'dir');
}

function assurerAlias(nom) {
  const source = path.join(dossierClaude, nom);
  const destination = path.join(dossierAgents, nom);
  if (!fs.statSync(source).isDirectory()) throw new Error(`${source} n'est pas un dossier.`);

  if (existeMemeCommeLien(destination)) {
    const statut = fs.lstatSync(destination);
    if (statut.isSymbolicLink()) {
      try {
        if (reel(destination) !== reel(source)) {
          throw new Error(`${destination} existe déjà mais ne pointe pas vers ${source}`);
        }
        return { nom, etat: 'déjà partagé', migres: 0 };
      } catch (erreur) {
        if (erreur?.code !== 'ENOENT') throw erreur;
        fs.unlinkSync(destination); // Répare seulement un alias cassé, jamais un dossier réel.
        creerAlias(source, destination);
        return { nom, etat: 'alias cassé réparé', migres: 0 };
      }
    }

    if (!statut.isDirectory()) throw new Error(`${destination} existe mais n'est pas un dossier.`);

    let migres = 0;
    for (const entree of fs.readdirSync(destination, { withFileTypes: true })) {
      const ancien = path.join(destination, entree.name);
      const cible = path.join(source, entree.name);
      if (existeMemeCommeLien(cible)) {
        if (reel(ancien) !== reel(cible)) {
          throw new Error(`${ancien} et ${cible} existent avec des contenus différents.`);
        }
        fs.unlinkSync(ancien); // Retire seulement l'ancien lien individuel, jamais sa cible.
      } else {
        fs.renameSync(ancien, cible); // Préserve un élément créé uniquement côté Codex.
        migres++;
      }
    }
    fs.rmdirSync(destination); // Le dossier a été vérifié et vidé entrée par entrée ci-dessus.
    creerAlias(source, destination);
    return { nom, etat: 'alias de dossier créé', migres };
  }

  creerAlias(source, destination);
  return { nom, etat: 'alias de dossier créé', migres: 0 };
}

const resultats = ['skills', 'rules'].map(assurerAlias);
if (!silencieux) {
  for (const resultat of resultats) {
    const suffixe = resultat.migres ? `, ${resultat.migres} élément(s) Codex préservé(s)` : '';
    console.log(`${resultat.nom} : ${resultat.etat}${suffixe}.`);
  }
}

#!/usr/bin/env node
/**
 * Hook Stop — rappelle d'écrire l'entrée de journal de fin de session avant d'arrêter, si des
 * fichiers pertinents ont été modifiés sans qu'aucun fichier de `docs/journal/` ne le soit.
 * Mode d'échec symétrique déjà observé : 6 commits passés sans entrée de journal (02-04/09/2026).
 *
 * SÛRETÉ ANTI-BOUCLE : si `stop_hook_active` est vrai (Claude Code l'envoie quand un Stop hook a
 * déjà bloqué une fois pour ce tour), on laisse toujours passer — jamais un deuxième blocage sur
 * le même arrêt, quoi qu'il arrive. Ce hook n'est qu'un rappel, pas un verrou : il ne se déclenche
 * qu'une fois par tentative d'arrêt.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let entree = '';
process.stdin.on('data', (d) => { entree += d; });
process.stdin.on('end', () => {
  let payload = {};
  try { payload = JSON.parse(entree || '{}'); } catch { /* payload illisible : ne pas bloquer */ }
  if (payload.stop_hook_active) process.exit(0);

  let statut = '';
  try {
    statut = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
  } catch {
    process.exit(0); // Pas un repo git accessible : rien à vérifier, ne pas bloquer.
  }
  if (!statut.trim()) process.exit(0); // Rien de non commité : rien à journaliser maintenant.

  const lignes = statut.split('\n').filter(Boolean);
  const chemins = lignes.map((l) => l.slice(3));
  const toucheDuTravail = chemins.some((c) =>
    /^(?:CLAUDE|AGENTS)\.md$/.test(c) ||
    c.startsWith('.claude/rules/') || c.startsWith('.codex/') ||
    c.startsWith('apps/') || c.startsWith('packages/') || c.startsWith('supabase/') ||
    c.startsWith('docs/specs/'));
  const journalTouche = chemins.some((c) => c.startsWith('docs/journal/'));

  if (toucheDuTravail && !journalTouche) {
    process.stderr.write(
      'Des fichiers de travail sont modifiés sans qu\'aucune entrée de docs/journal/<mois>.md ' +
      'n\'ait été ajoutée. Avant de considérer la session finie : ajouter une entrée datée ' +
      '(append, jamais écraser), et mettre docs/backlog.md à jour si un point s\'ouvre ou se ' +
      'referme. Si ce lot ne le mérite pas (retouche mineure), continuer normalement.\n'
    );
    process.exit(2);
  }
  process.exit(0);
});

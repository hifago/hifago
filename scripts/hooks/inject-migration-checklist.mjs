#!/usr/bin/env node
/**
 * Hook PreToolUse, scopé par `if: "Edit(supabase/migrations/*.sql)"` /
 * `if: "Write(supabase/migrations/*.sql)"` dans .claude/settings.json. Côté Codex, le matcher
 * intercepte `apply_patch` puis ce script inspecte le patch pour ne garder que les migrations.
 *
 * Remède au trou du chantier 3 : une règle `.claude/rules/*.md` avec `paths:` se charge quand
 * Claude LIT un fichier qui matche, jamais quand il en CRÉE un (doc officielle : « Path-scoped
 * rules trigger when Claude reads files matching the pattern »). Une migration écrite sans avoir
 * ouvert de voisin se ferait donc sans `.claude/rules/supabase.md` en contexte — inacceptable pour
 * l'invariant §3/§4 (« non négociable »). Ce hook n'écrit rien et ne bloque jamais : il ajoute la
 * checklist au contexte de l'agent, exit 0, avant que l'écriture n'ait lieu.
 */
let entree = '';
process.stdin.on('data', (d) => { entree += d; });
process.stdin.on('end', () => {
  let payload = {};
  try {
    payload = JSON.parse(entree || '{}');
  } catch {
    process.exit(0); // Payload illisible : ne jamais injecter sur une édition sans rapport.
  }

  const entrees = [];
  const cheminDirect = payload?.tool_input?.file_path;
  if (typeof cheminDirect === 'string') entrees.push(cheminDirect);

  // Codex transmet le texte du patch dans `tool_input.command`, sans `file_path` séparé.
  const commande = payload?.tool_input?.command;
  if (typeof commande === 'string') {
    for (const match of commande.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) {
      entrees.push(match[1].trim());
    }
    for (const match of commande.matchAll(/^\*\*\* Move to: (.+)$/gm)) {
      entrees.push(match[1].trim());
    }
  }

  const migrations = [...new Set(entrees
    .map((chemin) => chemin.replace(/\\/g, '/'))
    .filter((chemin) => /(^|\/)supabase\/migrations\/[^/]+\.sql$/i.test(chemin)))];
  if (migrations.length === 0) process.exit(0);

  const cheminFichier = migrations.join(', ');

  const checklist = [
    `Migration Supabase détectée (${cheminFichier}) — checklist non négociable de CLAUDE.md §3/§4`,
    `(forme exécutable complète : .claude/rules/supabase.md) :`,
    `1. Table de capacité/disponibilité, écriture auditée, vue miroir ou verrou optimiste → RPC-only`,
    `   (RLS activé, revoke insert/update/delete, AUCUNE policy d'écriture). Sinon RLS directe.`,
    `2. Fonction appelée depuis une policy RLS directe : STABLE ; SECURITY DEFINER + `,
    `   SET search_path = '' si elle lit une table sous RLS.`,
    `3. Toute policy enveloppe auth.uid() en (select auth.uid()).`,
    `4. RPC critique (§4.1 : réservation, fermeture de date/créneau, décrément) : squelette exact`,
    `   de docs/05-reference-technique.md §1 + SELECT ... FOR UPDATE + test de concurrence`,
    `   ($hifago-rpc-critique dans Codex) — sinon elle n'est pas terminée.`,
    `5. Régénérer les types après application ($hifago-migration décrit la commande filtrée).`,
  ].join('\n');

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: checklist,
    },
  }));
  process.exit(0); // Jamais bloquant — uniquement informatif.
});

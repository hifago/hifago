#!/usr/bin/env bash
# Dépendances sans vulnérabilité haute — audit COMPLET (dev comprises), avec exemptions NOMMÉES.
#
# Deux règles, dans cet ordre :
#   1. Les dépendances de PRODUCTION n'ont aucun avis `high` ni `critical`, sans exception possible.
#   2. L'audit complet (dev comprises) n'a aucun avis `high`/`critical` hors de la liste EXEMPTIONS.
#      Comme la règle 1 est passée, un avis exempté ne peut toucher QUE des outils de développement.
# Une exemption qui ne correspond plus à aucun avis fait échouer le contrôle : la retirer d'ici (un
# correctif est sorti, ou l'avis a disparu) — la liste ne peut que rétrécir.
#
# Pourquoi pas `npm audit --audit-level=high` seul (la version d'avant, 2026-09-19 → 2026-10-03) : un
# avis publié sans AUCUNE version corrigée sur une dépendance de dev rend le contrôle rouge partout,
# hook de push et CI, sans geste possible. Pourquoi pas `--omit=dev` seul : on cesserait de voir les
# dev, ce qui avait masqué js-yaml et @vitest/mocker, réparables (cf. le commentaire de verify.sh).
set -euo pipefail
cd "$(dirname "$0")/.."

# Une ligne par exemption : identifiant GHSA, date d'entrée, raison. Revoir à chaque passage du hook.
EXEMPTIONS=(
  # braces (toutes versions) via eslint-config-next → @next/eslint-plugin-next → fast-glob →
  # micromatch → braces. Outillage de lint seulement, jamais déployé. Aucune version corrigée publiée
  # au 2026-10-03 ; `npm audit fix --force` proposait de redescendre eslint-config-next en 14.x.
  "GHSA-vfj7-8cjw-p6xm|2026-10-03|braces, outillage de lint uniquement, aucune version corrigée"
)

echo "== Dépendances de production (aucune exemption possible) =="
if ! npm audit --omit=dev --audit-level=high; then
  echo "✗ Avis high/critical sur une dépendance de PRODUCTION : à corriger, aucune exemption possible ici." >&2
  exit 1
fi

echo "== Audit complet (dev comprises), hors exemptions nommées =="
audit_json="$(npm audit --json 2>/dev/null || true)"
# `${…+…}` : sous le bash 3.2 de macOS, `set -u` fait échouer l'expansion d'un tableau VIDE — or
# une liste vide est l'état visé (mesuré par mutation le 2026-10-03).
ids_exemptes="$(printf '%s\n' ${EXEMPTIONS[@]+"${EXEMPTIONS[@]}"} | cut -d'|' -f1)"

AUDIT_JSON="$audit_json" EXEMPTES="$ids_exemptes" node <<'EOF'
const audit = JSON.parse(process.env.AUDIT_JSON || "{}");
const exemptes = new Set((process.env.EXEMPTES || "").split("\n").filter(Boolean));
if (!audit.vulnerabilities) {
  console.error("✗ Sortie de npm audit illisible : impossible de conclure (échec fermé).");
  process.exit(1);
}
const trouves = new Map();
for (const v of Object.values(audit.vulnerabilities)) {
  for (const via of v.via || []) {
    if (typeof via !== "object" || !["high", "critical"].includes(via.severity)) continue;
    const id = String(via.url || "").split("/").pop() || via.title;
    trouves.set(id, `${via.severity} — ${via.name} : ${via.title}`);
  }
}
const nonExemptes = [...trouves].filter(([id]) => !exemptes.has(id));
const perimees = [...exemptes].filter((id) => !trouves.has(id));
for (const [id, detail] of nonExemptes) console.error(`✗ ${id} (${detail}) — non exempté`);
for (const id of perimees) console.error(`✗ Exemption périmée : ${id} n'apparaît plus — la retirer de scripts/check-npm-audit.sh`);
if (nonExemptes.length || perimees.length) process.exit(1);
for (const id of exemptes) console.log(`… ${id} exempté (dev seulement, cf. EXEMPTIONS)`);
console.log("✓ Aucun avis high/critical hors exemptions nommées ; production sans avis.");
EOF

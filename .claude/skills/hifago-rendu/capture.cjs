#!/usr/bin/env node
// Capture du RENDU RÉEL d'écrans de la vitrine dans Storybook — l'outil du skill /hifago-rendu.
//
// Pourquoi : « l'impression du rendu réel au lieu de sa supposition » (.claude/rules/orchestration.md).
// jsdom n'applique pas les media queries et ne charge aucune police : seul un vrai navigateur dit si
// une page déborde à 360 px, quelle police s'affiche, quel rayon a un bouton. Né du plan
// docs/specs/41-charte-hifago-toute-la-vitrine.md (2026-10-02), où toutes les mesures ont été prises ainsi.
//
// Usage (depuis la racine hifago/) :
//   node .claude/skills/hifago-rendu/capture.cjs --out <dossier> [--largeurs 360,390,1280]
//        [--mesure] [--decoupe 1100] <storyId> [<storyId>…]
//   node .claude/skills/hifago-rendu/capture.cjs --compare <dossierAvant> <dossierApres>
//
//   --mesure   relève titres, boutons, champs, images prioritaires ; signale les écarts aux règles.
//   --decoupe  découpe chaque capture pleine page en tranches de N px (lisibles une par une).
//
// Storybook affiche la police de PRODUCTION (Anton) : l'ancienne option `--prod`, qui bloquait la
// Sugo Pro Display d'essai, n'a plus d'objet depuis que Jérôme a confirmé Anton (2026-10-02).
//
// Prérequis : Storybook sur http://localhost:6006 (npm run storybook -w @hifago/web) et Microsoft Edge
// installé — aucun navigateur Playwright n'est téléchargé sur cette machine, on passe par le canal
// « msedge ». Les captures vont où l'on dit (--out) : un scratchpad, JAMAIS le dépôt.
"use strict";

const path = require("path");
const fs = require("fs");
const { createRequire } = require("module");

const RACINE = path.resolve(__dirname, "../../..");
const requireWeb = createRequire(path.join(RACINE, "apps/web/package.json"));
const requireRacine = createRequire(path.join(RACINE, "package.json"));

const STORYBOOK = process.env.STORYBOOK_URL || "http://localhost:6006";
// La barre d'outils de Storybook mémorise ses globals : on force le rayon de production et la
// langue espagnole dans l'URL pour rendre les captures reproductibles.
const GLOBALS = "radius:piste;locale:es";

function lireArgs(argv) {
  const opts = { out: null, largeurs: [390, 1280], mesure: false, decoupe: 0, ids: [], compare: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") opts.out = argv[++i];
    else if (a === "--largeurs") opts.largeurs = argv[++i].split(",").map(Number).filter(Boolean);
    else if (a === "--mesure") opts.mesure = true;
    else if (a === "--decoupe") opts.decoupe = Number(argv[++i]) || 1100;
    else if (a === "--compare") opts.compare = [argv[++i], argv[++i]];
    else if (a.startsWith("--")) {
      console.error(`Option inconnue : ${a}`);
      process.exit(2);
    } else opts.ids.push(a);
  }
  return opts;
}

// Relevés faits DANS la page. La police de titre est Anton (Sugo reconnue aussi, pour les anciennes captures).
function releverDansLaPage(mesure) {
  const estPoliceTitre = (famille) => /sugo|anton/i.test(famille.split(",")[0]);
  // Visible = une boîte réelle, hors d'un conteneur `sr-only` (un bouton « Buscar » qui n'apparaît
  // qu'au focus garde sinon ses 81 × 40 px mesurés à travers le `clip` de son parent).
  const visible = (e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && !e.closest(".sr-only") && !e.closest('[aria-hidden="true"]');
  };
  // Le style qui compte est celui de l'élément qui PORTE le texte : le <h1> de l'accueil enveloppe
  // un <span> en Poppins 800 ; mesurer le <h1> lui-même rendrait la police de titre à 16 px.
  const styleDuTexte = (el) => {
    const marcheur = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
    const noeud = marcheur.nextNode();
    return getComputedStyle(noeud ? noeud.parentElement : el);
  };
  // Seule la page compte : l'iframe de Storybook contient aussi ses propres gabarits masqués
  // (« No Preview », un <h1> vide) hors de `#storybook-root`.
  const racine = document.querySelector("#storybook-root") || document.body;
  const doc = document.documentElement;
  const info = {
    largeurPage: doc.scrollWidth,
    largeurVue: doc.clientWidth,
    hauteur: doc.scrollHeight,
    h1: [...racine.querySelectorAll("h1")].map((h) => (h.textContent || "").trim().slice(0, 60)),
    imagesPrioritaires: racine.querySelectorAll('img[fetchpriority="high"]').length,
    alertes: [],
  };
  if (info.largeurPage > info.largeurVue) info.alertes.push(`DÉBORDEMENT horizontal : ${info.largeurPage} px pour ${info.largeurVue}`);
  if (info.h1.length !== 1) info.alertes.push(`${info.h1.length} <h1> (il en faut exactement un)`);
  if (info.imagesPrioritaires > 1) info.alertes.push(`${info.imagesPrioritaires} images priority (une seule : le LCP)`);
  if (!mesure) return info;

  info.titres = [...racine.querySelectorAll("h1, h2, h3")].filter(visible).map((h) => {
    const cs = styleDuTexte(h);
    const t = { balise: h.tagName.toLowerCase(), texte: (h.textContent || "").trim().slice(0, 40), police: cs.fontFamily.split(",")[0].replace(/"/g, ""), taille: parseFloat(cs.fontSize), graisse: Number(cs.fontWeight) };
    if (estPoliceTitre(cs.fontFamily) && t.taille < 20) info.alertes.push(`police de titre sous 20 px : ${t.balise} « ${t.texte} » ${t.taille} px`);
    if (estPoliceTitre(cs.fontFamily) && t.graisse > 400) info.alertes.push(`faux gras : ${t.balise} « ${t.texte} » graisse ${t.graisse}`);
    return t;
  });
  info.boutons = [...racine.querySelectorAll('button, a[class*="button"], [role="button"]')].filter(visible).map((b) => {
    const cs = getComputedStyle(b);
    const r = b.getBoundingClientRect();
    const rayon = parseFloat(cs.borderTopLeftRadius) || 0;
    // Rond ou pilule (rayon ≥ demi-hauteur) : hors du décompte des rayons « rectangulaires ».
    const t = { texte: (b.textContent || b.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 32), rayon: rayon >= r.height / 2 ? "pilule" : `${rayon}px`, hauteur: Math.round(r.height) };
    if (t.hauteur < 44) info.alertes.push(`cible < 44 px : « ${t.texte} » ${t.hauteur} px`);
    return t;
  });
  // Un champ SANS bordure ni fond propre est habillé par son conteneur (la pilule de recherche fait
  // 44 px, son <input> 40) : seul le champ qui porte lui-même sa bordure est mesuré.
  info.champs = [...racine.querySelectorAll('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), select, textarea')]
    .filter(visible)
    .filter((c) => parseFloat(getComputedStyle(c).borderTopWidth) > 0)
    .map((c) => {
      const h = Math.round(c.getBoundingClientRect().height);
      if (h < 44) info.alertes.push(`champ < 44 px : ${c.getAttribute("name") || c.getAttribute("aria-label") || c.tagName} ${h} px`);
      return h;
    });
  const rayons = [...new Set(info.boutons.map((b) => b.rayon).filter((r) => r !== "pilule" && r !== "0px"))];
  if (rayons.length > 1) info.alertes.push(`plusieurs rayons de bouton rectangulaire : ${rayons.join(", ")}`);
  info.alertes = [...new Set(info.alertes)];
  return info;
}

async function decouper(fichier, hauteurTranche) {
  const sharp = requireRacine("sharp");
  const meta = await sharp(fichier).metadata();
  const base = fichier.replace(/\.png$/, "");
  const tranches = [];
  for (let haut = 0, n = 0; haut < meta.height; haut += hauteurTranche, n++) {
    const h = Math.min(hauteurTranche, meta.height - haut);
    const sortie = `${base}-${String(n).padStart(2, "0")}.png`;
    await sharp(fichier).extract({ left: 0, top: haut, width: meta.width, height: h }).png().toFile(sortie);
    tranches.push(path.basename(sortie));
  }
  return tranches;
}

async function capturer(opts) {
  if (!opts.out || opts.ids.length === 0) {
    console.error("Usage : capture.cjs --out <dossier> [--largeurs 360,390,1280] [--mesure] [--decoupe 1100] <storyId…>");
    process.exit(2);
  }
  try {
    const r = await fetch(`${STORYBOOK}/index.json`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch (e) {
    console.error(`Storybook injoignable sur ${STORYBOOK} (${e.message}) — lancer : npm run storybook -w @hifago/web`);
    process.exit(2);
  }
  fs.mkdirSync(opts.out, { recursive: true });
  const { chromium } = requireWeb("playwright");
  const navigateur = await chromium.launch({ channel: "msedge" });
  let alertesTotales = 0;
  try {
    for (const largeur of opts.largeurs) {
      const contexte = await navigateur.newContext({ viewport: { width: largeur, height: largeur < 600 ? 844 : 900 }, deviceScaleFactor: 1 });
      const page = await contexte.newPage();
      const erreurs = [];
      page.on("pageerror", (e) => erreurs.push(String(e).slice(0, 160)));
      for (const id of opts.ids) {
        const url = `${STORYBOOK}/iframe.html?id=${encodeURIComponent(id)}&viewMode=story&globals=${GLOBALS}`;
        try {
          await page.goto(url, { waitUntil: "load", timeout: 60000 });
          // Une story peut garder une requête pendante À DESSEIN (« en cours ») : networkidle n'est
          // qu'un bonus, jamais une condition.
          await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
          await page.waitForFunction(() => (document.querySelector("#storybook-root")?.children.length ?? 0) > 0, null, { timeout: 30000 });
          await page.evaluate(() => document.fonts.ready);
          await page.waitForTimeout(1200);
          const info = await page.evaluate(releverDansLaPage, opts.mesure);
          const nom = `${id}--${largeur}.png`;
          const fichier = path.join(opts.out, nom);
          await page.screenshot({ path: fichier, fullPage: true });
          const tranches = opts.decoupe ? await decouper(fichier, opts.decoupe) : [];
          alertesTotales += info.alertes.length;
          console.log(JSON.stringify({ capture: nom, ...info, tranches }));
        } catch (e) {
          console.log(JSON.stringify({ capture: `${id}--${largeur}`, echec: String(e).slice(0, 200) }));
        }
      }
      if (erreurs.length) console.log(JSON.stringify({ largeur, erreursDePage: erreurs.slice(0, 5) }));
      await contexte.close();
    }
  } finally {
    await navigateur.close();
  }
  console.log(alertesTotales ? `⚠️ ${alertesTotales} alerte(s) — voir le champ « alertes » de chaque capture.` : "✓ Aucune alerte.");
}

async function comparer([avant, apres]) {
  const sharp = requireRacine("sharp");
  const fichiers = fs.readdirSync(avant).filter((f) => f.endsWith(".png") && !/-\d{2}\.png$/.test(f));
  for (const f of fichiers) {
    const b = path.join(apres, f);
    if (!fs.existsSync(b)) {
      console.log(`${f} : absent de ${apres}`);
      continue;
    }
    const [ia, ib] = await Promise.all([sharp(path.join(avant, f)).raw().toBuffer({ resolveWithObject: true }), sharp(b).raw().toBuffer({ resolveWithObject: true })]);
    if (ia.info.width !== ib.info.width || ia.info.height !== ib.info.height) {
      console.log(`${f} : TAILLE différente ${ia.info.width}×${ia.info.height} → ${ib.info.width}×${ib.info.height}`);
      continue;
    }
    let differents = 0;
    const c = ia.info.channels;
    for (let i = 0; i < ia.data.length; i += c) {
      if (Math.abs(ia.data[i] - ib.data[i]) > 16 || Math.abs(ia.data[i + 1] - ib.data[i + 1]) > 16 || Math.abs(ia.data[i + 2] - ib.data[i + 2]) > 16) differents++;
    }
    const total = ia.data.length / c;
    console.log(`${f} : ${differents === 0 ? "IDENTIQUE" : `${((differents / total) * 100).toFixed(3)} % de pixels différents`}`);
  }
}

const opts = lireArgs(process.argv.slice(2));
(opts.compare ? comparer(opts.compare) : capturer(opts)).catch((e) => {
  console.error(e);
  process.exit(1);
});

#!/usr/bin/env node
// Sauvegarde locale des photos du catalogue Hifago — l'outil du skill /hifago-sauvegarde-photos.
//
// Pourquoi : les photos des partenaires ne vivent que dans le Storage du site. Cet outil les
// rapatrie sur le disque de Jérôme et les range comme la photothèque posée à la main le 2026-10-12
// (journal) : un seul dossier `Photos/`, un nom qui dit tout
// (`partenaire_rubrique_sujet_NN_description.ext`), une seule version par image.
//
// Usage (depuis la racine hifago/) :
//   node .claude/skills/hifago-sauvegarde-photos/sauvegarde.mjs collecter [--source prod|preprod|<url>]
//        [--dest <dossier>] [--a-blanc] [--tout]
//   node .claude/skills/hifago-sauvegarde-photos/sauvegarde.mjs appliquer [--dest <dossier>] [--sans-description]
//   node .claude/skills/hifago-sauvegarde-photos/sauvegarde.mjs index [--dest <dossier>]
//
//   collecter  lit le catalogue en ligne, ne télécharge que ce qui manque, pose les nouvelles photos
//              dans `<dest>/_a-classer/` avec des planches de vignettes et `a-decrire.json`.
//   appliquer  range `_a-classer/` dans `Photos/` avec les noms définitifs de `a-decrire.json`.
//   index      régénère `index-photos.csv` et `apercu-photos.html` d'après `Photos/` et `Marque/`.
//   --a-blanc  n'écrit rien : dit ce qui serait fait.
//   --tout     réexamine aussi les photos déjà traitées (une photo supprimée à la main reviendrait).
//
// LECTURE ANONYME UNIQUEMENT : pages et fichiers publics, comme un visiteur. Aucun jeton, aucune
// clé, aucun CLI — ne jamais y ajouter `service_role` (CLAUDE.md §8). Le dossier de destination est
// hors du dépôt : `HIFAGO_ASSETS_DIR`, sinon `../Assets` à côté du dépôt.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(ICI, "../../..");
// sharp est une dépendance déclarée d'apps/admin : on la résout de là, sans l'ajouter ailleurs.
const sharp = createRequire(path.join(RACINE, "apps/admin/package.json"))("sharp");
const CONV = JSON.parse(fs.readFileSync(path.join(ICI, "conventions.json"), "utf8"));

const [commande, ...reste] = process.argv.slice(2);
const OPTIONS_CONNUES = new Set(["--source", "--dest", "--a-blanc", "--tout", "--sans-description"]);
const opt = {};
for (let i = 0; i < reste.length; i++) {
  if (!OPTIONS_CONNUES.has(reste[i])) arreter(`option inconnue : ${reste[i]}`);
  if (reste[i] === "--source" || reste[i] === "--dest") opt[reste[i].slice(2)] = reste[++i];
  else opt[reste[i].slice(2)] = true;
}
const DEST = path.resolve(opt.dest ?? process.env.HIFAGO_ASSETS_DIR ?? path.join(RACINE, "..", "Assets"));
const PHOTOS = path.join(DEST, "Photos");
const ATTENTE = path.join(DEST, "_a-classer");
const ETAT = path.join(DEST, "sauvegarde-etat.json");
const A_DECRIRE = path.join(ATTENTE, "a-decrire.json");
const IMAGE = /\.(png|jpe?g|webp|gif|avif)$/i;
const MOT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function arreter(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}
const slug = (s) =>
  String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const CREUX = new Set("de del la las el los y o en con por para hasta desde a al un una the for of and to in".split(" "));
const raccourcir = (s) => s.split("-").filter((m) => m && !CREUX.has(m)).slice(0, 4).join("-") || s;

async function lire(url, type = "text") {
  for (let essai = 1; ; essai++) {
    try {
      const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return type === "buffer" ? Buffer.from(await r.arrayBuffer()) : await r.text();
    } catch (e) {
      if (essai === 3) throw new Error(`${url} : ${e.message}`);
      await new Promise((ok) => setTimeout(ok, 800 * essai));
    }
  }
}
async function parLots(liste, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < liste.length) await fn(liste[i++]); }));
}

// ------------------------------------------------------------------ même image ?
// Deux fichiers sont la même photo s'ils ont les mêmes octets, ou une empreinte de contours proche
// (dHash) ET des couleurs voisines (signature 24×24) ET les mêmes proportions. La signature couleur
// écarte les faux jumeaux de même forme. Seuils mesurés le 2026-10-12 sur la photothèque réelle : la
// même image en deux tailles sort à 13 bits / écart 2,4 au pire ; les deux photos DIFFÉRENTES les
// plus proches (deux paddles sur le lac) à 20 bits / écart 22.
async function empreinte(buf) {
  const e = { sha: crypto.createHash("sha256").update(buf).digest("hex"), octets: buf.length };
  try {
    const m = await sharp(buf).metadata();
    Object.assign(e, { l: m.width, h: m.height, format: m.format === "jpeg" ? "jpg" : m.format === "heif" ? "avif" : m.format });
    const base = () => sharp(buf).rotate().flatten({ background: "#808080" });
    const px = await base().greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
    let bits = "";
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += px[y * 9 + x] > px[y * 9 + x + 1] ? "1" : "0";
    e.dh = BigInt("0b" + bits);
    e.sig = await base().resize(24, 24, { fit: "fill" }).removeAlpha().raw().toBuffer();
  } catch {
    e.document = true; // pas une image lisible : comparée aux octets seulement
  }
  return e;
}
function memeImage(a, b) {
  if (a.sha === b.sha) return true;
  if (a.document || b.document) return false;
  if (Math.abs(a.l / a.h - b.l / b.h) / (a.l / a.h) > 0.03) return false;
  let x = a.dh ^ b.dh, bitsDifferents = 0;
  while (x) (bitsDifferents += Number(x & 1n)), (x >>= 1n);
  if (bitsDifferents > 16) return false;
  let ecart = 0;
  for (let i = 0; i < a.sig.length; i++) ecart += Math.abs(a.sig[i] - b.sig[i]);
  return ecart / a.sig.length <= 6;
}
async function bibliotheque() {
  const fiches = [];
  for (const dossier of [PHOTOS, ATTENTE]) {
    if (!fs.existsSync(dossier)) continue;
    for (const nom of fs.readdirSync(dossier)) {
      if (!IMAGE.test(nom) || /^planche-\d+\.jpg$/.test(nom)) continue;
      fiches.push({ rel: `${path.basename(dossier)}/${nom}`, ...(await empreinte(fs.readFileSync(path.join(dossier, nom)))) });
    }
  }
  return fiches;
}

// ------------------------------------------------------------------ adaptateurs
// Chaque adaptateur rend la liste des photos en ligne : { cle, url, genre, slugFiche, nomFiche,
// slugEtab, segment, ordre }. `cle` est le chemin stable du fichier côté site.
async function detecter(base) {
  try {
    const j = JSON.parse(await lire(`${base}/api/portal/catalog`));
    if (j && Array.isArray(j.products)) return "v1";
  } catch { /* pas la v1 */ }
  const plan = await lire(`${base}/sitemap.xml`);
  if (/\/(productos|establecimientos)\//.test(plan)) return "v2";
  return /<loc>/.test(plan) ? "vide" : arreter(`${base} : ni catalogue v1 ni sitemap de la vitrine`);
}

// Vitrine du nouveau stack : sitemap → fiches → JSON-LD (`image`, dans l'ordre d'affichage).
async function adaptateurV2(base, erreurs) {
  const plan = await lire(`${base}/sitemap.xml`);
  const urls = [...new Set([...plan.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]))];
  const fiches = new Map(); // "productos/slug" → url (l'espagnol d'abord : x-default, CLAUDE.md §5)
  for (const u of urls.sort((a, b) => /\/es\//.test(b) - /\/es\//.test(a))) {
    const m = new URL(u).pathname.match(/^\/[a-z]{2}\/(productos|establecimientos)\/([a-z0-9-]+)\/?$/);
    if (m && !fiches.has(`${m[1]}/${m[2]}`)) fiches.set(`${m[1]}/${m[2]}`, u);
  }
  const photos = [];
  await parLots([...fiches], 4, async ([cleFiche, url]) => {
    const [genre, slugFiche] = cleFiche.split("/");
    let html;
    try { html = await lire(url); } catch (e) { return erreurs.push(e.message); }
    const ld = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].flatMap((m) => {
      try { return [JSON.parse(m[1])]; } catch { return []; }
    });
    const fiche = ld.find((d) => d["@type"] !== "BreadcrumbList" && d.name);
    if (!fiche) return erreurs.push(`${url} : aucun JSON-LD de fiche — la page a changé de forme ?`);
    let segment = "establecimientos", slugEtab = slugFiche;
    if (genre === "productos") {
      const fil = ld.find((d) => d["@type"] === "BreadcrumbList")?.itemListElement ?? [];
      segment = fil.map((i) => new URL(i.item, base).pathname.split("/")[2]).find((s) => s && CONV.rubriques[s] && s !== "establecimientos");
      slugEtab = (html.match(/\/[a-z]{2}\/establecimientos\/([a-z0-9-]+)/) || [])[1];
      if (!segment) return erreurs.push(`${url} : rubrique introuvable dans le fil d'Ariane`);
      if (!slugEtab) return erreurs.push(`${url} : établissement introuvable dans la page`);
    }
    [fiche.image ?? []].flat().map((x) => (typeof x === "string" ? x : x?.url)).filter(Boolean).forEach((src, i) => {
      const u = new URL(src, base);
      photos.push({ cle: u.pathname.replace(/^.*\/object\/public\//, ""), url: u.href, genre, slugFiche, nomFiche: fiche.name, slugEtab, segment, ordre: i + 1 });
    });
  });
  return photos;
}

// Portail v1 (Express) tant qu'il sert hifago.co : `/api/portal/catalog` et `/experiences`.
async function adaptateurV1(base) {
  const cat = JSON.parse(await lire(`${base}/api/portal/catalog`));
  let exp = { experiences: [] };
  try { exp = JSON.parse(await lire(`${base}/api/portal/experiences`)); } catch { /* portail sans expériences */ }
  const photos = [];
  const ajouter = (refs, fiche) =>
    [...new Set(refs.map((r) => (typeof r === "string" ? r : r?.url)).filter((r) => r && IMAGE.test(r)))].forEach((r, i) => {
      const chemin = "/" + r.replace(/^\//, "");
      photos.push({ cle: "v1" + chemin, url: base + encodeURI(chemin), ordre: i + 1, ...fiche });
    });
  const SEGMENT = { activity: "actividades", transport: "transportes", tour: "camps", camp: "camps", event: "eventos" };
  for (const p of cat.products ?? [])
    ajouter(p.photos ?? [], { genre: "productos", slugFiche: slug(p.name), nomFiche: p.name, slugEtab: slug(p.provider_name ?? p.provider_id), segment: SEGMENT[p.type] ?? "actividades" });
  for (const e of exp.experiences ?? [])
    ajouter(e.photos ?? [], { genre: "productos", slugFiche: slug(e.title), nomFiche: e.title, slugEtab: slug(String(e.place ?? "guatape").split("·")[0]), segment: SEGMENT[e.kind] ?? "eventos" });
  for (const p of cat.properties ?? [])
    ajouter([p.hero, ...(p.gallery ?? [])], { genre: "establecimientos", slugFiche: p.id, nomFiche: p.name, slugEtab: p.id, segment: "establecimientos" });
  return photos;
}

// ------------------------------------------------------------------ nommage
function champs(p) {
  const partenaireDe = (s) => CONV.partenaires[s] ?? s;
  if (p.genre === "establecimientos") {
    const c = CONV.etablissements[p.slugFiche] ?? {};
    return { partenaire: c.partenaire ?? partenaireDe(p.slugEtab), rubrique: c.rubrique ?? "etablissement", sujet: c.sujet ?? "lieu" };
  }
  const c = CONV.fiches[p.slugFiche] ?? {};
  return { partenaire: c.partenaire ?? partenaireDe(p.slugEtab), rubrique: CONV.rubriques[p.segment], sujet: c.sujet ?? raccourcir(p.slugFiche) };
}
const prefixe = (c) => `${c.partenaire}_${c.rubrique}_${c.sujet}`;
function numeroLibre(pref, voulu, pris) {
  const occupes = new Set(pris.filter((n) => n.startsWith(pref + "_")).map((n) => +n.slice(pref.length + 1, pref.length + 3)));
  let n = occupes.has(voulu) ? Math.max(...occupes) + 1 : voulu;
  while (occupes.has(n)) n++;
  return String(n).padStart(2, "0");
}

// ------------------------------------------------------------------ planches de vignettes
async function planches(entrees) {
  const C = 4, R = 3, L = 390, H = 270, T = 46;
  for (let n = 0; n * C * R < entrees.length; n++) {
    const comp = [];
    for (const [k, e] of entrees.slice(n * C * R, (n + 1) * C * R).entries()) {
      const x = (k % C) * L, y = Math.floor(k / C) * (H + T);
      if (!e.document)
        comp.push({ input: await sharp(path.join(ATTENTE, e.fichier)).rotate().flatten({ background: "#8a8f99" }).resize(L - 6, H, { fit: "contain", background: "#222" }).png().toBuffer(), left: x + 3, top: y + T });
      const texte = (s) => s.replace(/&/g, "+").replace(/</g, "");
      comp.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${L}" height="${T}"><rect width="100%" height="100%" fill="#000"/><text x="5" y="19" font-family="Arial" font-size="17" font-weight="bold" fill="#ff0">n° ${e.n}${e.remplace ? "  (meilleure définition)" : ""}</text><text x="5" y="38" font-family="Arial" font-size="12" fill="#fff">${texte(`${e.partenaire} · ${e.rubrique} · ${e.sujet} · ${e.numero}`)}</text></svg>`), left: x, top: y });
    }
    await sharp({ create: { width: C * L, height: R * (H + T), channels: 3, background: "#222" } }).composite(comp).jpeg({ quality: 84 }).toFile(path.join(ATTENTE, `planche-${String(n + 1).padStart(2, "0")}.jpg`));
  }
}

// ------------------------------------------------------------------ collecter
async function collecter() {
  const base = (CONV.sources[opt.source ?? "prod"] ?? opt.source).replace(/\/$/, "");
  if (!/^https:\/\//.test(base)) arreter(`source inconnue : ${opt.source} (prod, preprod ou une URL https)`);
  if (fs.existsSync(A_DECRIRE) && !opt["a-blanc"]) arreter(`${ATTENTE} contient déjà des photos à classer : lancer « appliquer » d'abord.`);
  const forme = await detecter(base);
  console.log(`source : ${base} (${forme === "v1" ? "portail v1" : forme === "v2" ? "vitrine du nouveau stack" : "catalogue vide"})`);
  if (forme === "vide") return console.log("Le site ne publie aucune fiche : rien à sauvegarder.");
  const erreurs = [];
  const enLigne = forme === "v1" ? await adaptateurV1(base) : await adaptateurV2(base, erreurs);
  // les produits avant les établissements : à image égale, le nom du produit l'emporte
  enLigne.sort((a, b) => (a.genre === "productos" ? 0 : 1) - (b.genre === "productos" ? 0 : 1) || a.slugFiche.localeCompare(b.slugFiche) || a.ordre - b.ordre);
  const etat = fs.existsSync(ETAT) ? JSON.parse(fs.readFileSync(ETAT, "utf8")) : { version: 1, vus: {} };
  const biblio = await bibliotheque();
  const noms = biblio.map((b) => path.basename(b.rel));
  const bilan = { enLigne: new Set(enLigne.map((p) => p.cle)).size, connues: 0, reconnues: 0, nouvelles: [], meilleures: [] };
  const traitees = new Set();
  const aEcrire = [];

  for (const p of enLigne) {
    if (traitees.has(p.cle)) continue;
    traitees.add(p.cle);
    if (etat.vus[p.cle] && !opt.tout) { bilan.connues++; continue; }
    let buf;
    try { buf = await lire(p.url, "buffer"); } catch (e) { erreurs.push(e.message); continue; }
    const e = await empreinte(buf);
    const jumeau = biblio.find((b) => memeImage(b, e));
    const c = champs(p);
    if (!MOT.test(c.partenaire) || !MOT.test(c.sujet) || !c.rubrique) { erreurs.push(`${p.url} : nom incalculable (${JSON.stringify(c)})`); continue; }
    const ext = e.format ?? (path.extname(new URL(p.url).pathname).slice(1).toLowerCase() || "bin");
    if (jumeau && (e.document || jumeau.rel.startsWith("_a-classer/") || e.l * e.h <= jumeau.l * jumeau.h * 1.15)) {
      bilan.reconnues++;
      etat.vus[p.cle] = { fichier: jumeau.rel, source: p.url, date: new Date().toISOString().slice(0, 10) };
      continue;
    }
    const entree = { n: aEcrire.length + 1, cle: p.cle, source: p.url, fiche: p.nomFiche, ...c, description: "", document: !!e.document };
    if (jumeau) {
      // même image, plus grande en ligne : elle remplacera le fichier existant, sous le même nom
      const m = path.basename(jumeau.rel).match(/^(.*?)_(\d\d)(?:_(.*))?\.[a-z0-9]+$/);
      Object.assign(entree, { remplace: jumeau.rel, numero: m?.[2] ?? "01", description: m?.[3] ?? "", gain: `${jumeau.l}×${jumeau.h} → ${e.l}×${e.h}` });
      if (m) [entree.partenaire, entree.rubrique, entree.sujet] = m[1].split("_");
      bilan.meilleures.push(entree);
    } else {
      entree.numero = numeroLibre(prefixe(c), p.ordre, noms);
      bilan.nouvelles.push(entree);
    }
    entree.fichier = `${prefixe(entree)}_${entree.numero}${entree.remplace ? "_remplacement" : ""}.${ext}`;
    noms.push(entree.fichier);
    biblio.push({ rel: `_a-classer/${entree.fichier}`, ...e });
    etat.vus[p.cle] = { fichier: `_a-classer/${entree.fichier}`, source: p.url, date: new Date().toISOString().slice(0, 10) };
    aEcrire.push({ entree, buf });
  }

  if (!opt["a-blanc"]) {
    fs.mkdirSync(DEST, { recursive: true });
    if (aEcrire.length) {
      fs.mkdirSync(ATTENTE, { recursive: true });
      for (const { entree, buf } of aEcrire) fs.writeFileSync(path.join(ATTENTE, entree.fichier), buf);
      fs.writeFileSync(A_DECRIRE, JSON.stringify(aEcrire.map((x) => x.entree), null, 2) + "\n");
      await planches(aEcrire.map((x) => x.entree));
    }
    fs.writeFileSync(ETAT, JSON.stringify(etat, null, 1) + "\n");
  }
  console.log(`${opt["a-blanc"] ? "[à blanc] " : ""}${bilan.enLigne} photos en ligne : ${bilan.connues} déjà traitées, ${bilan.reconnues} reconnues dans la photothèque, ${bilan.nouvelles.length} nouvelles, ${bilan.meilleures.length} en meilleure définition.`);
  for (const e of bilan.nouvelles) console.log(`  + n° ${e.n}  ${e.fichier}   (${e.fiche})`);
  for (const e of bilan.meilleures) console.log(`  ↑ n° ${e.n}  ${e.remplace}   ${e.gain}`);
  if (aEcrire.length && !opt["a-blanc"]) console.log(`→ ${ATTENTE} : regarder les planches, remplir « description » dans a-decrire.json, puis « appliquer ».`);
  if (erreurs.length) {
    console.error(`\n${erreurs.length} erreur(s) — la sauvegarde est INCOMPLÈTE :`);
    for (const e of erreurs) console.error(`  ✗ ${e}`);
    process.exitCode = 1;
  }
}

// ------------------------------------------------------------------ appliquer
function appliquer() {
  if (!fs.existsSync(A_DECRIRE)) arreter(`rien à appliquer : ${A_DECRIRE} n'existe pas.`);
  const entrees = JSON.parse(fs.readFileSync(A_DECRIRE, "utf8"));
  const etat = fs.existsSync(ETAT) ? JSON.parse(fs.readFileSync(ETAT, "utf8")) : { version: 1, vus: {} };
  const existants = new Set(fs.existsSync(PHOTOS) ? fs.readdirSync(PHOTOS) : []);
  const plan = [];
  for (const e of entrees) {
    for (const cle of ["partenaire", "sujet"]) if (!MOT.test(e[cle] ?? "")) arreter(`n° ${e.n} : « ${cle} » invalide (${e[cle]}) — minuscules, chiffres et tirets.`);
    if (!/^[a-z]+$/.test(e.rubrique ?? "") || !/^\d\d$/.test(e.numero ?? "")) arreter(`n° ${e.n} : rubrique ou numéro invalide.`);
    if (e.description ? !MOT.test(e.description) : !opt["sans-description"])
      arreter(`n° ${e.n} : description ${e.description ? "invalide" : "vide"} (${e.fichier}) — 2 à 4 mots en minuscules sans accents, séparés par des tirets, ou --sans-description.`);
    if (!fs.existsSync(path.join(ATTENTE, e.fichier))) arreter(`n° ${e.n} : ${e.fichier} a disparu de _a-classer.`);
    const final = `${e.partenaire}_${e.rubrique}_${e.sujet}_${e.numero}${e.description ? "_" + e.description : ""}${path.extname(e.fichier)}`;
    const ancien = e.remplace ? path.basename(e.remplace) : null;
    if (existants.has(final) && final !== ancien) arreter(`n° ${e.n} : ${final} existe déjà dans Photos — changer le numéro.`);
    if (plan.some((p) => p.final === final)) arreter(`n° ${e.n} : deux photos porteraient le nom ${final}.`);
    plan.push({ e, final, ancien });
  }
  fs.mkdirSync(PHOTOS, { recursive: true });
  for (const { e, final, ancien } of plan) {
    if (ancien && fs.existsSync(path.join(PHOTOS, ancien))) fs.rmSync(path.join(PHOTOS, ancien));
    fs.renameSync(path.join(ATTENTE, e.fichier), path.join(PHOTOS, final));
    if (etat.vus[e.cle]) etat.vus[e.cle].fichier = `Photos/${final}`;
    for (const v of Object.values(etat.vus)) if (v.fichier === `_a-classer/${e.fichier}` || (ancien && v.fichier === `Photos/${ancien}`)) v.fichier = `Photos/${final}`;
  }
  for (const n of fs.readdirSync(ATTENTE)) if (/^planche-\d+\.jpg$/.test(n) || n === "a-decrire.json") fs.rmSync(path.join(ATTENTE, n));
  if (!fs.readdirSync(ATTENTE).length) fs.rmdirSync(ATTENTE);
  fs.writeFileSync(ETAT, JSON.stringify(etat, null, 1) + "\n");
  console.log(`${plan.length} photo(s) rangée(s) dans ${PHOTOS} (${plan.filter((p) => p.ancien).length} remplacement(s)).`);
  for (const { final } of plan) console.log(`  ${final}`);
}

// ------------------------------------------------------------------ index et page d'aperçu
async function index() {
  const etat = fs.existsSync(ETAT) ? JSON.parse(fs.readFileSync(ETAT, "utf8")) : { vus: {} };
  const sourceDe = new Map(Object.values(etat.vus).map((v) => [v.fichier, v.source]));
  const decouper = (f) => {
    const [partenaire, rubrique, sujet, ...suite] = f.replace(/\.[a-z0-9]+$/, "").split("_");
    const numero = /^\d\d$/.test(suite[0]) ? suite.shift() : "";
    return { partenaire, rubrique, sujet, numero, description: suite.join("_").replaceAll("-", " ") };
  };
  const lignes = [], horsRegle = [];
  for (const dossier of ["Marque", "Photos"]) {
    if (!fs.existsSync(path.join(DEST, dossier))) continue;
    for (const fichier of fs.readdirSync(path.join(DEST, dossier)).sort()) {
      const plein = path.join(DEST, dossier, fichier);
      if (!fs.statSync(plein).isFile()) continue;
      if (!/^[a-z0-9-]+_[a-z]+_[a-z0-9-]+_[a-z0-9_-]+\.[a-z0-9]+$/.test(fichier)) horsRegle.push(`${dossier}/${fichier}`);
      const image = /\.(png|jpe?g|webp|gif)$/.test(fichier);
      const m = image ? await sharp(plein).metadata() : {};
      lignes.push({ dossier, fichier, image, l: m.width ?? "", h: m.height ?? "", ko: Math.round(fs.statSync(plein).size / 1024), source: sourceDe.get(`${dossier}/${fichier}`) ?? "", ...decouper(fichier) });
    }
  }
  const csv = ["dossier;fichier;partenaire;rubrique;sujet;numero;description;largeur;hauteur;ko;source_en_ligne"];
  for (const l of lignes) csv.push([l.dossier, l.fichier, l.partenaire, l.rubrique, l.sujet, l.numero, l.description, l.l, l.h, l.ko, l.source].join(";"));
  fs.writeFileSync(path.join(DEST, "index-photos.csv"), "﻿" + csv.join("\r\n") + "\r\n"); // BOM : Excel

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const cartes = lignes.map((l) => {
    const vue = l.image ? `<img loading="lazy" src="${l.dossier}/${esc(l.fichier)}" alt="">` : `<div class="doc">${esc(path.extname(l.fichier).slice(1).toUpperCase())}</div>`;
    return `<figure data-q="${esc(`${l.fichier} ${l.dossier}`.toLowerCase())}" data-d="${l.dossier}"><a href="${l.dossier}/${esc(l.fichier)}" target="_blank">${vue}</a><figcaption><b>${esc(l.partenaire)}</b> · ${esc(l.rubrique)} · ${esc(l.sujet)}${l.numero ? " · " + l.numero : ""}<br><span>${esc(l.description)}</span><code>${esc(l.fichier)}</code><small>${l.image ? `${l.l}×${l.h} · ` : ""}${l.ko} Ko</small></figcaption></figure>`;
  }).join("\n");
  fs.writeFileSync(path.join(DEST, "apercu-photos.html"), `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Photos Hifago</title>
<style>
:root{--fond:#f4f1ea;--carte:#fff;--texte:#16233f;--doux:#5b6780;--trait:#d9d3c5;--accent:#0f2a5c}
*{box-sizing:border-box}body{margin:0;background:var(--fond);color:var(--texte);font:14px/1.4 system-ui,Segoe UI,sans-serif}
header{position:sticky;top:0;z-index:2;background:var(--fond);border-bottom:1px solid var(--trait);padding:14px 16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
h1{font-size:18px;margin:0 8px 0 0}input{flex:1;min-width:220px;padding:9px 12px;font-size:15px;border:1px solid var(--trait);border-radius:8px}
button{padding:8px 12px;border:1px solid var(--trait);border-radius:8px;background:var(--carte);color:var(--texte);cursor:pointer;font-size:14px}
button[aria-pressed=true]{background:var(--accent);color:#fff;border-color:var(--accent)}#n{color:var(--doux)}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;padding:16px}
figure{margin:0;background:var(--carte);border:1px solid var(--trait);border-radius:10px;overflow:hidden}
figure img,.doc{display:block;width:100%;height:190px;object-fit:contain;background:#8a8f99}
.doc{display:grid;place-items:center;color:#fff;font-weight:700;font-size:28px;letter-spacing:.08em}a{text-decoration:none}
figcaption{padding:9px 10px 10px}figcaption span{color:var(--doux)}
code{display:block;margin-top:6px;font:11.5px/1.35 Consolas,monospace;word-break:break-all;cursor:copy;user-select:all}
small{display:block;margin-top:4px;color:var(--doux)}
</style></head><body>
<header><h1>Photos Hifago</h1><input id="q" type="search" placeholder="Filtrer : bania piscine, glamping, logo…" autofocus>
<button data-d="" aria-pressed="true">Tout</button><button data-d="Photos" aria-pressed="false">Photos</button><button data-d="Marque" aria-pressed="false">Marque</button><span id="n"></span></header>
<main>
${cartes}
</main>
<script>
const q=document.getElementById("q"),n=document.getElementById("n"),figs=[...document.querySelectorAll("figure")],btns=[...document.querySelectorAll("button")];let d="";
function maj(){const mots=q.value.toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").split(/\\s+/).filter(Boolean);let c=0;for(const f of figs){const ok=(!d||f.dataset.d===d)&&mots.every(m=>f.dataset.q.includes(m));f.hidden=!ok;if(ok)c++}n.textContent=c+" / "+figs.length}
q.addEventListener("input",maj);btns.forEach(b=>b.addEventListener("click",()=>{d=b.dataset.d;btns.forEach(x=>x.setAttribute("aria-pressed",x===b));maj()}));
document.addEventListener("click",e=>{if(e.target.tagName==="CODE")navigator.clipboard?.writeText(e.target.textContent)});maj();
</script></body></html>
`);
  console.log(`index et aperçu régénérés : ${lignes.filter((l) => l.dossier === "Photos").length} dans Photos, ${lignes.filter((l) => l.dossier === "Marque").length} dans Marque.`);
  if (horsRegle.length) console.log(`hors convention de nommage : ${horsRegle.join(", ")}`);
}

if (commande === "collecter") await collecter();
else if (commande === "appliquer") { appliquer(); await index(); }
else if (commande === "index") await index();
else arreter("commande attendue : collecter, appliquer ou index (voir l'en-tête du fichier).");

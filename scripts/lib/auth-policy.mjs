/**
 * Politique Auth attendue (`supabase/auth-policy.json`) — comparaisons PURES, sans réseau ni disque :
 * l'appelant lit les fichiers et passe un `lireFichier`. Testées par `auth-policy.test.mjs`.
 *
 * Deux usages, un seul jeu de règles :
 *   - `ecartsConfigLocale` : `supabase/config.toml` (le local) déclare-t-il la même politique ?
 *     → scripts/check-auth-config.mjs, dans `npm run verify` ;
 *   - `ecartsCloud` : la réponse de `GET /v1/projects/{ref}/config/auth` porte-t-elle les valeurs
 *     attendues ? → scripts/check-cloud-auth-config.mjs, lancé à la main, en lecture seule.
 *
 * `config.toml` ne gouverne QUE le local : préprod et prod se règlent par l'API de gestion, champ
 * par champ (jamais `supabase config push`). D'où deux contrôles pour une seule intention.
 */

/** `password_requirements` de config.toml → `password_required_characters` de l'API. */
export const EXIGENCES_TOML = {
  "": "",
  letters_digits: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789",
  lower_upper_letters_digits: "abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789",
  lower_upper_letters_digits_symbols:
    "abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789:!@#$%^&*()_+-=[]{};'\\:\"|<>?,./`~",
};

/** Champ de l'API → [section de config.toml, clé]. Les gabarits d'e-mail sont déduits du nom. */
const CORRESPONDANCES = {
  password_min_length: ["auth", "minimum_password_length"],
  password_required_characters: ["auth", "password_requirements"],
  security_update_password_require_reauthentication: ["auth.email", "secure_password_change"],
};

const SUJET = /^mailer_subjects_([a-z_]+)$/;
const GABARIT = /^mailer_templates_([a-z_]+)_content$/;

// Un secret ne se compare pas ici : sa valeur finirait dans la sortie d'un écart.
const SECRET = /secret|smtp_pass|_token$|_key$/;

/** Clés comparées (hors `$commentaire`). Lève si l'une désigne un secret. */
export function clesDePolitique(politique) {
  const cles = Object.keys(politique).filter((cle) => !cle.startsWith("$"));
  const secrets = cles.filter((cle) => SECRET.test(cle));
  if (secrets.length > 0) {
    throw new Error(`auth-policy.json ne doit contenir aucun secret : ${secrets.join(", ")}`);
  }
  return cles;
}

/**
 * Lecteur TOML volontairement minimal : sections `[a.b]` et `clé = valeur` scalaires (chaîne entre
 * guillemets doubles, nombre, booléen). Le reste (tableaux, tables en ligne) est ignoré — aucune
 * des clés comparées n'en a la forme.
 */
export function lireConfigToml(texte) {
  const sections = new Map();
  let courante = "";
  for (const brute of texte.split("\n")) {
    const ligne = brute.trim();
    if (ligne === "" || ligne.startsWith("#")) continue;
    const section = /^\[([^\]]+)\]$/.exec(ligne);
    if (section) {
      courante = section[1].trim();
      if (!sections.has(courante)) sections.set(courante, {});
      continue;
    }
    // La chaîne d'abord : un `#` entre guillemets n'ouvre pas un commentaire.
    const paire =
      /^([A-Za-z0-9_]+)\s*=\s*("(?:[^"\\]|\\.)*")\s*(?:#.*)?$/.exec(ligne) ??
      /^([A-Za-z0-9_]+)\s*=\s*([^\s#]+)\s*(?:#.*)?$/.exec(ligne);
    if (!paire) continue;
    const [, cle, valeurBrute] = paire;
    let valeur;
    if (valeurBrute.startsWith('"')) valeur = JSON.parse(valeurBrute);
    else if (valeurBrute === "true" || valeurBrute === "false") valeur = valeurBrute === "true";
    else if (/^-?\d+$/.test(valeurBrute)) valeur = Number(valeurBrute);
    else continue;
    if (!sections.has(courante)) sections.set(courante, {});
    sections.get(courante)[cle] = valeur;
  }
  return sections;
}

const sansPointSlash = (chemin) => chemin.replace(/^\.\//, "");

/** `supabase/config.toml` déclare-t-il la politique attendue ? Rend la liste des écarts. */
export function ecartsConfigLocale(sections, politique) {
  const ecarts = [];
  const lire = (section, cle) => sections.get(section)?.[cle];
  const cles = clesDePolitique(politique);

  for (const cle of cles) {
    const attendu = politique[cle];
    const sujet = SUJET.exec(cle);
    const gabarit = GABARIT.exec(cle);

    if (sujet) {
      const recu = lire(`auth.email.template.${sujet[1]}`, "subject");
      if (recu !== attendu) {
        ecarts.push(`[auth.email.template.${sujet[1]}] subject : attendu ${JSON.stringify(attendu)}, trouvé ${JSON.stringify(recu)}`);
      }
      continue;
    }
    if (gabarit) {
      const recu = lire(`auth.email.template.${gabarit[1]}`, "content_path");
      if (typeof recu !== "string" || sansPointSlash(recu) !== attendu?.fichier) {
        ecarts.push(`[auth.email.template.${gabarit[1]}] content_path : attendu ${JSON.stringify(attendu?.fichier)}, trouvé ${JSON.stringify(recu)}`);
      }
      continue;
    }
    const correspondance = CORRESPONDANCES[cle];
    if (!correspondance) {
      ecarts.push(`${cle} : aucune correspondance dans config.toml — à ajouter à CORRESPONDANCES (scripts/lib/auth-policy.mjs)`);
      continue;
    }
    const [section, cleToml] = correspondance;
    let recu = lire(section, cleToml);
    if (cle === "password_required_characters") {
      recu = typeof recu === "string" && recu in EXIGENCES_TOML ? EXIGENCES_TOML[recu] : `(valeur inconnue : ${JSON.stringify(recu)})`;
    }
    if (recu !== attendu) {
      ecarts.push(`[${section}] ${cleToml} : attendu ${JSON.stringify(attendu)}, trouvé ${JSON.stringify(recu)}`);
    }
  }

  // Un gabarit local sans son pendant attendu côté cloud : on l'oublierait au déploiement.
  for (const section of sections.keys()) {
    const nom = /^auth\.email\.template\.([a-z_]+)$/.exec(section)?.[1];
    if (nom && !(`mailer_subjects_${nom}` in politique && `mailer_templates_${nom}_content` in politique)) {
      ecarts.push(`[${section}] : gabarit local absent de auth-policy.json (mailer_subjects_${nom}, mailer_templates_${nom}_content)`);
    }
  }
  return ecarts;
}

/**
 * La configuration Auth d'un projet cloud porte-t-elle la politique attendue ? Rend la liste des
 * écarts — sans jamais recopier un gabarit entier ni une valeur hors politique.
 */
export function ecartsCloud(reponse, politique, lireFichier) {
  const ecarts = [];
  for (const cle of clesDePolitique(politique)) {
    const attendu = politique[cle];
    const recu = reponse?.[cle];
    if (attendu !== null && typeof attendu === "object") {
      const contenu = lireFichier(attendu.fichier).trim();
      if (typeof recu !== "string" || recu === "") {
        ecarts.push(`${cle} : absent (gabarit par défaut de Supabase) — attendu le contenu de ${attendu.fichier}`);
      } else if (recu.trim() !== contenu) {
        ecarts.push(`${cle} : diffère de ${attendu.fichier} (${recu.trim().length} caractères reçus, ${contenu.length} attendus)`);
      }
      continue;
    }
    if (recu !== attendu) {
      ecarts.push(`${cle} : attendu ${JSON.stringify(attendu)}, reçu ${JSON.stringify(recu)}`);
    }
  }
  return ecarts;
}

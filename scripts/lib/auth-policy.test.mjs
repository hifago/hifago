import { describe, expect, it } from "vitest";
import {
  clesDePolitique,
  ecartsCloud,
  ecartsConfigLocale,
  EXIGENCES_TOML,
  lireConfigToml,
} from "./auth-policy.mjs";

// Lancé par `npm run verify` (étape « Politique Auth »), donc en CI.

const POLITIQUE = {
  $commentaire: "ignoré",
  password_min_length: 8,
  password_required_characters: EXIGENCES_TOML.letters_digits,
  security_update_password_require_reauthentication: true,
  mailer_subjects_reauthentication: "Tu código # de Hifago",
  mailer_templates_reauthentication_content: { fichier: "supabase/templates/reauthentication.html" },
};

const TOML_CONFORME = `
[auth]
# Passwords shorter than this value will be rejected as weak.
minimum_password_length = 8
password_requirements = "letters_digits" # commentaire en fin de ligne
enable_signup = true

[auth.email] # commentaire après une section
secure_password_change = true

[auth.email.template.reauthentication]
subject = "Tu código # de Hifago"
content_path = "./supabase/templates/reauthentication.html"
`;

const GABARIT = "<h2>Tu código</h2>\n<p>{{ .Token }}</p>\n";
const lireFichier = () => GABARIT;

const REPONSE_CONFORME = {
  password_min_length: 8,
  password_required_characters: EXIGENCES_TOML.letters_digits,
  security_update_password_require_reauthentication: true,
  mailer_subjects_reauthentication: "Tu código # de Hifago",
  mailer_templates_reauthentication_content: GABARIT.trim(),
  smtp_pass: "ne doit jamais être lu",
};

describe("lireConfigToml", () => {
  it("lit sections, chaînes (avec #), nombres et booléens ; ignore les commentaires", () => {
    const sections = lireConfigToml(TOML_CONFORME);
    expect(sections.get("auth")).toEqual({
      minimum_password_length: 8,
      password_requirements: "letters_digits",
      enable_signup: true,
    });
    expect(sections.get("auth.email.template.reauthentication")?.subject).toBe("Tu código # de Hifago");
  });
});

describe("ecartsConfigLocale — config.toml déclare la politique attendue", () => {
  it("aucun écart sur un fichier conforme", () => {
    expect(ecartsConfigLocale(lireConfigToml(TOML_CONFORME), POLITIQUE)).toEqual([]);
  });

  it.each([
    ["longueur 6", "minimum_password_length = 8", "minimum_password_length = 6", "minimum_password_length"],
    ["exigences vides", '"letters_digits"', '""', "password_requirements"],
    ["exigence inconnue", '"letters_digits"', '"lettres"', "password_requirements"],
    ["changement non sécurisé", "secure_password_change = true", "secure_password_change = false", "secure_password_change"],
    ["sujet différent", 'subject = "Tu código # de Hifago"', 'subject = "Reauth"', "subject"],
    ["autre gabarit", "templates/reauthentication.html", "templates/autre.html", "content_path"],
  ])("rougit : %s", (_cas, avant, apres, attendu) => {
    const ecarts = ecartsConfigLocale(lireConfigToml(TOML_CONFORME.replace(avant, apres)), POLITIQUE);
    expect(ecarts).toHaveLength(1);
    expect(ecarts[0]).toContain(attendu);
  });

  it("rougit sur un réglage absent de config.toml", () => {
    const ecarts = ecartsConfigLocale(
      lireConfigToml(TOML_CONFORME.replace("secure_password_change = true\n", "")),
      POLITIQUE
    );
    expect(ecarts).toEqual([expect.stringContaining("secure_password_change")]);
  });

  it("rougit sur un gabarit local que la politique cloud ne connaît pas", () => {
    const toml = `${TOML_CONFORME}\n[auth.email.template.invite]\nsubject = "x"\ncontent_path = "./y.html"\n`;
    expect(ecartsConfigLocale(lireConfigToml(toml), POLITIQUE)).toEqual([
      expect.stringContaining("[auth.email.template.invite]"),
    ]);
  });

  it("rougit sur une clé de politique sans correspondance locale", () => {
    const ecarts = ecartsConfigLocale(lireConfigToml(TOML_CONFORME), { ...POLITIQUE, rate_limit_email_sent: 30 });
    expect(ecarts).toEqual([expect.stringContaining("rate_limit_email_sent")]);
  });
});

describe("ecartsCloud — la configuration du projet porte la politique attendue", () => {
  it("aucun écart sur une réponse conforme (gabarit comparé sans les blancs de bord)", () => {
    expect(ecartsCloud(REPONSE_CONFORME, POLITIQUE, lireFichier)).toEqual([]);
  });

  it.each([
    ["longueur 6", { password_min_length: 6 }, "password_min_length"],
    ["exigences vides", { password_required_characters: "" }, "password_required_characters"],
    ["changement non sécurisé", { security_update_password_require_reauthentication: false }, "reauthentication"],
    ["réglage absent", { security_update_password_require_reauthentication: null }, "reauthentication"],
    ["sujet par défaut", { mailer_subjects_reauthentication: null }, "mailer_subjects_reauthentication"],
  ])("rougit : %s", (_cas, modification, attendu) => {
    const ecarts = ecartsCloud({ ...REPONSE_CONFORME, ...modification }, POLITIQUE, lireFichier);
    expect(ecarts).toHaveLength(1);
    expect(ecarts[0]).toContain(attendu);
  });

  it("gabarit par défaut ou modifié : signalé, jamais recopié dans l'écart", () => {
    const absent = ecartsCloud(
      { ...REPONSE_CONFORME, mailer_templates_reauthentication_content: null },
      POLITIQUE,
      lireFichier
    );
    expect(absent).toEqual([expect.stringContaining("absent")]);

    const modifie = ecartsCloud(
      { ...REPONSE_CONFORME, mailer_templates_reauthentication_content: "<p>{{ .Token }} CONTENU-DISTANT</p>" },
      POLITIQUE,
      lireFichier
    );
    expect(modifie).toEqual([expect.stringContaining("diffère")]);
    expect(modifie[0]).not.toContain("CONTENU-DISTANT");
  });
});

describe("clesDePolitique — aucun secret dans la politique", () => {
  it.each(["smtp_pass", "external_google_secret", "sms_twilio_auth_token", "sms_textlocal_api_key"])(
    "refuse %s",
    (cle) => {
      expect(() => clesDePolitique({ ...POLITIQUE, [cle]: "x" })).toThrow(/aucun secret/);
    }
  );

  it("laisse passer les réglages de mot de passe (« password » n'est pas un secret)", () => {
    expect(clesDePolitique(POLITIQUE)).not.toContain("$commentaire");
    expect(clesDePolitique(POLITIQUE)).toContain("password_min_length");
  });
});

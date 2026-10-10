import { PASSWORD_MIN_LENGTH } from "@hifago/domain";

// Les phrases de la règle de mot de passe (`meetsPasswordPolicy`, @hifago/domain) pour les trois
// écrans de l'admin qui en posent un : réinitialisation, compte partenaire, adhésion par
// invitation. En espagnol en dur, comme le reste de cette app (hors next-intl). La longueur vient
// de la constante partagée : elle ne peut pas être recopiée de travers.

export const PASSWORD_HINT = `Mínimo ${PASSWORD_MIN_LENGTH} caracteres, con letras y números.`;

export const PASSWORD_POLICY_ERROR = `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres, con letras y números.`;

export const SAME_PASSWORD_ERROR = "La nueva contraseña debe ser distinta de la actual.";

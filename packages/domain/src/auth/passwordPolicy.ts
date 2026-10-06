/**
 * Règle de mot de passe des deux apps (décision du 2026-10-06) : 8 caractères au moins, dont au
 * moins une lettre et un chiffre.
 *
 * C'est le MIROIR de la règle que Supabase Auth applique lui-même — `minimum_password_length` et
 * `password_requirements = "letters_digits"` dans `supabase/config.toml` pour le local,
 * `password_min_length` et `password_required_characters` sur les projets cloud, valeurs attendues
 * dans `supabase/auth-policy.json`. Le serveur reste l'autorité : ce contrôle sert à dire POURQUOI
 * avant l'envoi, au lieu d'une erreur générique au retour. `passwordPolicy.test.ts` lit
 * `auth-policy.json` : les deux ne peuvent pas diverger sans rougir.
 *
 * Mêmes jeux de caractères que GoTrue, en ASCII : une lettre accentuée n'y compte pas comme une
 * lettre, donc pas ici non plus. La longueur est comptée en unités UTF-16, jamais plus que les
 * octets que compte GoTrue : ce contrôle ne peut pas accepter un mot de passe que le serveur
 * refuserait pour sa longueur.
 */
export const PASSWORD_MIN_LENGTH = 8;

/** Au format de GoTrue (`password_required_characters`) : au moins un caractère de chaque jeu. */
export const PASSWORD_REQUIRED_CHARACTERS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789";

export function meetsPasswordPolicy(password: string): boolean {
  if (password.length < PASSWORD_MIN_LENGTH) return false;
  return PASSWORD_REQUIRED_CHARACTERS.split(":").every((jeu) =>
    Array.from(password).some((caractere) => jeu.includes(caractere))
  );
}

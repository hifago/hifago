import { crearClienteFalso } from "../supabaseFalso";

// Remplace `@hifago/supabase/server` dans le Storybook (alias Vite, `.storybook/main.ts`) — même
// faux client que côté navigateur : une story d'écran n'a qu'UNE identité, que la page la lise
// côté serveur ou côté client.
export async function createClient() {
  return crearClienteFalso();
}

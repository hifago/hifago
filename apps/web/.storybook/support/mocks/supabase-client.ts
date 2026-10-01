import { crearClienteFalso } from "../supabaseFalso";

// Remplace `@hifago/supabase/client` dans le Storybook (alias Vite, `.storybook/main.ts`).
export function createClient() {
  return crearClienteFalso();
}

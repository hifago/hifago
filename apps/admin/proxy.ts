import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Contrairement à apps/web, cette app n'a ni next-intl (pas de locale routée pour l'admin/socio) ni
// logique d'attribution ?ref= (concern vitrine uniquement) — seul le refresh de session Supabase
// est nécessaire ici.
//
// Motif du guide Supabase pour Next.js (2026-10-02) : la réponse est RECRÉÉE à partir de la requête
// à chaque écriture de cookies (`NextResponse.next({ request })`). C'est ainsi que le jeton
// rafraîchi atteint aussi les Server Components de CETTE requête ; avant, seule la réponse au
// navigateur le recevait, et les pages relisaient l'ancien jeton, déjà remplacé, sur la requête
// même où il expirait.
export default async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};

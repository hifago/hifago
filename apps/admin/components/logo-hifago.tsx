import Image from "next/image";
import Link from "next/link";

// Le logo Hifago de la charte 2026, servi en image (son dessin est en Garet, police absente des
// services de polices) — mêmes fichiers que la vitrine (`apps/web/public/brand/`), copiés dans
// `apps/admin/public/brand/` : les deux apps se déploient séparément et ne partagent aucun statique.
//
//   - `sombre` : lettres or et blanches, pour la surface marine (barre latérale, barre mobile) ;
//   - `clair`  : lettres marine, pour un fond clair (connexion, inscription).
//
// `href` : le logo ramène à l'accueil de l'espace courant ; sans lui (écrans de connexion), c'est
// une simple image. L'image est décorative (`alt=""`) : c'est le lien qui porte le nom accessible.
const FICHIERS = {
  sombre: { src: "/brand/logo-header-sombre.webp", width: 158, height: 96 },
  clair: { src: "/brand/logo-header-clair.webp", width: 167, height: 96 },
} as const;

export function LogoHifago({
  variante,
  hauteur,
  href,
}: {
  variante: keyof typeof FICHIERS;
  /** Classe(s) de hauteur Tailwind, ex. `h-9 md:h-12` ; la largeur suit. */
  hauteur: string;
  href?: string;
}) {
  const { src, width, height } = FICHIERS[variante];
  const image = (
    <Image src={src} alt="" aria-hidden width={width} height={height} loading="eager" className={`w-auto ${hauteur}`} />
  );
  // Toujours dans une boîte : posée directement dans une colonne flex (`items-stretch` par défaut),
  // l'image serait étirée à la largeur de la colonne et déformée.
  if (!href) return <span className="inline-flex shrink-0">{image}</span>;
  return (
    <Link href={href} aria-label="Hifago — inicio" className="inline-flex shrink-0 rounded-md">
      {image}
    </Link>
  );
}

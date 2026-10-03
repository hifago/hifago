import type { ReactNode } from "react";
import { LinkButton } from "@/components/atoms/LinkButton";

// Le bouton d'une offre NON RÉSERVABLE en ligne — spec 30 §5c.
//
// Il occupe LA PLACE EXACTE du calendrier : c'est la forme arrêtée par le cahier §2e — « la
// différence se voit à l'endroit exact où le client la cherche, sans bandeau ni texte explicatif ».
// Rien d'autre sur la fiche ne signale qu'elle n'est pas réservable, et c'est délibéré.
//
// Un seul composant, deux usages : `products.external_booking_url` sur une fiche produit,
// `establishments.contact_phone` (converti en lien wa.me par la couche) sur une fiche
// établissement. Il ne construit AUCUNE URL lui-même — un composant qui devinerait « c'est un
// numéro, donc wa.me » ferait de la logique métier dans du rendu.

// COULEUR SELON LA SURFACE (plan 41, P4) : or sur le clair (le panneau de la fiche produit, le
// défaut), MARINE sur l'or (le bandeau de la fiche établissement) — un bouton or y disparaîtrait
// (F4). Et pleine largeur seulement là où il tient la place d'un formulaire : dans un bandeau, il
// prend la largeur de son libellé.
export function BotonContacto({
  href,
  etiqueta,
  color = "accent",
  width = "full",
  iconBefore,
  testId,
}: {
  /** URL complète, déjà construite par l'appelant. */
  href: string;
  /** Déjà traduite — un composant d'écran ne traduit pas. */
  etiqueta: string;
  /** `marine` sur une surface or. */
  color?: "accent" | "marine";
  width?: "auto" | "full";
  /** Glyphe décoratif devant le libellé (WhatsApp sur la fiche établissement). */
  iconBefore?: ReactNode;
  testId?: string;
}) {
  return (
    <LinkButton
      href={href}
      external
      // ⚠️ Obligatoire dès qu'on ouvre un onglet : sans lui, la page cible reçoit `window.opener`
      // et peut réécrire l'URL de la nôtre. L'atome l'exige, d'où cette prop.
      newTabLabel={etiqueta}
      // `lg` (48 px, plan 41 F4) : il tient la place du CTA de conversion « Añadir a Mi viaje ».
      size="lg"
      color={color}
      width={width}
      iconBefore={iconBefore}
      testId={testId}
    >
      {etiqueta}
    </LinkButton>
  );
}

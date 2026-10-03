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

export function BotonContacto({
  href,
  etiqueta,
  testId,
}: {
  /** URL complète, déjà construite par l'appelant. */
  href: string;
  /** Déjà traduite — un composant d'écran ne traduit pas. */
  etiqueta: string;
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
      width="full"
      testId={testId}
    >
      {etiqueta}
    </LinkButton>
  );
}

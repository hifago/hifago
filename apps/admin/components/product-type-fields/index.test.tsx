import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProductTypeFields } from "./index";
import { useProductTypeFieldsState, type ProductType } from "@/lib/products/useProductTypeFieldsState";

// Options d'un logement réservées à l'admin (demande Jérôme du 2026-10-13) : le dépôt et le lien de
// réservation externe disparaissent de l'espace socio, pour un LOGEMENT seulement. Rendu limité à
// l'étape « pricing », où vivent ces deux champs.
function Harness({ type, showAdminLodgingOptions }: { type: ProductType; showAdminLodgingOptions?: boolean }) {
  const state = useProductTypeFieldsState();
  return (
    <ProductTypeFields
      type={type}
      state={state}
      section="pricing"
      showAdminLodgingOptions={showAdminLodgingOptions}
    />
  );
}

// Pas de @testing-library/jest-dom dans ce monorepo — assertions sur la présence dans le DOM.
describe("ProductTypeFields — showAdminLodgingOptions", () => {
  it("admin (défaut) : un logement montre le dépôt et le lien de réservation externe", () => {
    render(<Harness type="lodging" />);
    expect(screen.queryByTestId("stay-rates-deposit-input")).not.toBeNull();
    expect(screen.queryByTestId("external-booking-url-input")).not.toBeNull();
  });

  it("socio : un logement ne montre ni le dépôt ni le lien, le reste des tarifs demeure", () => {
    render(<Harness type="lodging" showAdminLodgingOptions={false} />);
    expect(screen.queryByTestId("stay-rates-deposit-input")).toBeNull();
    expect(screen.queryByTestId("external-booking-url-input")).toBeNull();
    expect(screen.queryByTestId("stay-rates-weekend-surcharge-input")).not.toBeNull();
    expect(screen.queryByTestId("stay-rates-extra-note-input")).not.toBeNull();
  });

  it("socio : hors logement, le lien de réservation externe reste proposé", () => {
    render(<Harness type="activity" showAdminLodgingOptions={false} />);
    expect(screen.queryByTestId("external-booking-url-input")).not.toBeNull();
  });
});

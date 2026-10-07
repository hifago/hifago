import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PartnerHomeBanner } from "./PartnerHomeBanner";

// Un référent seul ne voit jamais « Prestador activo / Mi establecimiento » : son bandeau mène à
// son code et à ses commissions (décision de Gabriel, 2026-10-07).

const liens = () =>
  screen.getAllByRole("link").map((lien) => [lien.textContent, lien.getAttribute("href")]);

describe("PartnerHomeBanner", () => {
  it("référent : « Referente activo », son code et ses commissions", () => {
    render(<PartnerHomeBanner kind="referrer" />);
    expect(screen.getByTestId("partner-status-referrer").textContent).toBe("Referente activo");
    expect(liens()).toEqual([
      ["Mi enlace y QR", "/partner/tools"],
      ["Mis comisiones", "/partner/commissions"],
    ]);
    expect(screen.queryByText("Prestador activo")).toBeNull();
    expect(screen.queryByText("Mi establecimiento")).toBeNull();
  });

  it("prestataire : inchangé, « Prestador activo » et son établissement", () => {
    render(<PartnerHomeBanner kind="provider" />);
    expect(screen.getByTestId("partner-status-compact").textContent).toBe("Prestador activo");
    expect(liens()).toEqual([["Mi establecimiento", "/partner/establishment"]]);
  });
});

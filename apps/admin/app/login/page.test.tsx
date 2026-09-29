import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// La destination `next` transmise au formulaire est suivie par `router.push` après connexion :
// une valeur hors du site y deviendrait une navigation vers un autre domaine.
vi.mock("./LoginForm", () => ({
  LoginForm: ({ next }: { next: string }) => <p data-testid="next">{next}</p>,
}));

const { default: LoginPage } = await import("./page");

async function nextTransmis(next: string) {
  render(await LoginPage({ searchParams: Promise.resolve({ next }) } as never));
  return screen.getByTestId("next").textContent;
}

describe("/login — destination transmise au formulaire", () => {
  it.each([["//evil.com"], ["/\\evil.com"], ["/./\\evil.com"]])(
    "remplace une destination hors du site (%j) par /",
    async (next) => {
      expect(await nextTransmis(next)).toBe("/");
    }
  );

  it("transmet une destination interne telle quelle", async () => {
    expect(await nextTransmis("/partner/join?token=abc")).toBe("/partner/join?token=abc");
  });
});

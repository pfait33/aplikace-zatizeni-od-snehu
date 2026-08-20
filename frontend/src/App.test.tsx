// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

vi.mock("axios", () => ({
  default: {
    get: vi.fn(),
    isAxiosError: vi.fn(() => false)
  }
}));

const snowLoadResponse = {
  input: { ku: "Kvaň", parcel: "223/2" },
  parcel: { kuCode: "678082", parcelId: "CPX.1394061202", parcelNumber: "223/2" },
  location: {
    lat: 49.77566,
    lon: 13.849107,
    source: "ČÚZK",
    cadastralMapUrl: "https://example.test/cadastre",
    mapyComUrl: "https://example.test/map",
    chmiSnowMapUrl: "https://example.test/snow"
  },
  altitude: { value: 455, unit: "m n. m.", source: "Open-Meteo" },
  snowLoad: { sk: 0.85, unit: "kPa", source: "ČHMÚ" },
  snowArea: { code: "II", limit: 1, unit: "kN/m2", source: "ČSN EN 1991-1-3" },
  warnings: ["Výsledek je orientační; hodnotu ověřte podle platné normy."]
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("snow-load workbench", () => {
  it("uses the CAG workbench visual hierarchy", () => {
    render(<App />);

    expect(screen.getByRole("main")).toHaveAttribute("data-design", "cag-workbench");
    expect(screen.getByText("SNÍH")).toHaveClass("brand-mark");
    expect(screen.getByRole("heading", { name: "Zatížení sněhem podle parcely" })).toBeVisible();
    expect(screen.getByText("01")).toBeVisible();
    expect(screen.getByText("Zadejte parcelu")).toBeVisible();
  });

  it("keeps the existing query and result calculation flow", async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({ data: snowLoadResponse });
    const user = userEvent.setup();
    render(<App />);

    await user.clear(screen.getByLabelText("Katastrální území"));
    await user.type(screen.getByLabelText("Katastrální území"), "Kvaň");
    await user.clear(screen.getByLabelText("Parcelní číslo"));
    await user.type(screen.getByLabelText("Parcelní číslo"), "223/2");
    await user.click(screen.getByRole("button", { name: "Zjistit zatížení sněhem" }));

    expect(axios.get).toHaveBeenCalledWith(expect.stringContaining("/api/snow-load"), {
      params: { ku: "Kvaň", parcel: "223/2" }
    });
    expect(await screen.findByText("0.85 kPa")).toBeVisible();
    expect(screen.getByText("II (do 1.0 kN/m2)")).toBeVisible();
  });
});

import { findParcel } from "./cadastralService.js";
import { toWgs84 } from "./coordinateService.js";
import { getElevation } from "./elevationService.js";
import { getSnowLoad } from "./snowLoadService.js";

export type SnowLoadApiResponse = {
  input: {
    ku: string;
    parcel: string;
  };
  parcel: {
    kuCode: string;
    parcelId: string;
    parcelNumber: string;
  };
  location: {
    lat: number;
    lon: number;
    source: string;
    cadastralMapUrl: string;
    mapyComUrl: string;
  };
  altitude: {
    value: number | null;
    unit: "m n. m.";
    source: string;
  };
  snowLoad: {
    sk: number | null;
    unit: "kPa";
    source: string;
  };
  snowArea: {
    code: string | null;
    limit: number | null;
    unit: "kN/m2";
    source: string;
  };
  warnings: string[];
};

const verificationWarning =
  "Výsledek slouží jako orientační automatický výpočet. Pro projektovou dokumentaci ověřte hodnotu podle platné normy a oficiální mapy ČHMÚ.";

export async function resolveSnowLoad(ku: string, parcel: string): Promise<SnowLoadApiResponse> {
  const parcelResult = await findParcel(ku, parcel);
  const location = parcelResult.locationWgs84 ?? (
    parcelResult.locationSJtsk ? toWgs84(parcelResult.locationSJtsk.x, parcelResult.locationSJtsk.y) : null
  );

  if (!location) {
    throw new Error("Parcela nemá použitelné souřadnice definičního bodu.");
  }
  const warnings = [...parcelResult.warnings, verificationWarning];

  const altitude = await getElevation(location.lat, location.lon);
  if (altitude.value === null) {
    warnings.push("Nepodařilo se určit nadmořskou výšku. Sněhové zatížení může být méně přesné.");
  }

  const snowLoad = await getSnowLoad(location.lat, location.lon, altitude.value);
  if (snowLoad.sk === null) {
    warnings.push("Nepodařilo se určit sněhové zatížení pro zadanou polohu.");
  }

  const snowArea = getSnowArea(snowLoad.sk);

  return {
    input: { ku, parcel },
    parcel: {
      kuCode: parcelResult.kuCode,
      parcelId: parcelResult.parcelId,
      parcelNumber: parcelResult.parcelNumber
    },
    location: {
      lat: location.lat,
      lon: location.lon,
      source: parcelResult.locationSource,
      cadastralMapUrl: getCadastralParcelUrl(parcelResult.parcelId),
      mapyComUrl: getMapyComUrl(location.lat, location.lon)
    },
    altitude: {
      value: altitude.value,
      unit: "m n. m.",
      source: altitude.source
    },
    snowLoad: {
      sk: snowLoad.sk,
      unit: "kPa",
      source: snowLoad.source
    },
    snowArea,
    warnings
  };
}

function getSnowArea(sk: number | null): SnowLoadApiResponse["snowArea"] {
  const source = "Sněhové oblasti podle hodnot sk: I 0.7, II 1.0, III 1.5, IV 2.0, V 2.5, VI 3.0, VII 4.0, VIII > 4.0 kN/m2";

  if (sk === null) {
    return {
      code: null,
      limit: null,
      unit: "kN/m2",
      source
    };
  }

  const areas = [
    { code: "I", limit: 0.7 },
    { code: "II", limit: 1.0 },
    { code: "III", limit: 1.5 },
    { code: "IV", limit: 2.0 },
    { code: "V", limit: 2.5 },
    { code: "VI", limit: 3.0 },
    { code: "VII", limit: 4.0 }
  ];
  const match = areas.find((area) => sk <= area.limit);

  return {
    code: match?.code ?? "VIII",
    limit: match?.limit ?? null,
    unit: "kN/m2",
    source
  };
}

function getCadastralParcelUrl(parcelId: string): string {
  const ruianParcelCode = parcelId.replace(/^CPX\./, "");
  return `https://vdp.cuzk.gov.cz/vdp/ruian/parcely/${encodeURIComponent(ruianParcelCode)}`;
}

function getMapyComUrl(lat: number, lon: number): string {
  return `https://mapy.com/zakladni?x=${lon.toFixed(6)}&y=${lat.toFixed(6)}&z=17`;
}

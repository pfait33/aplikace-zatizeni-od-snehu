import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import axios from "axios";
import { parseCsv, parseNumber, normalizeText } from "../utils/csv.js";
import { ApiError } from "../utils/errors.js";

export type ParcelResult = {
  kuCode: string;
  parcelId: string;
  parcelNumber: string;
  locationSJtsk: {
    x: number;
    y: number;
  } | null;
  locationWgs84?: {
    lat: number;
    lon: number;
  };
  locationSource: string;
  warnings: string[];
};

type ParcelIndexRow = {
  kuName: string;
  kuCode: string;
  parcelId: string;
  parcelNumber: string;
  lat: number | null;
  lon: number | null;
  x: number | null;
  y: number | null;
  source: string;
};

type CadastralZoning = {
  id: string;
  code: string;
  name: string;
};

const dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultParcelIndexPath = path.resolve(dirname, "../../data/parcels.sample.csv");
const cuzkWfsUrl = "https://services.cuzk.gov.cz/wfs/inspire-cpx-wfs.asp";

const cuzkClient = axios.create({
  timeout: 20000,
  responseType: "text",
  transformResponse: [(data) => data]
});

export async function findParcel(ku: string, parcelNumber: string): Promise<ParcelResult> {
  const onlineErrorWarnings: string[] = [];

  if (process.env.CADASTRAL_ONLINE_ENABLED !== "false") {
    try {
      const remoteResult = await findParcelInCuzkWfs(ku, parcelNumber);
      if (remoteResult) {
        return remoteResult;
      }
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      onlineErrorWarnings.push("Online ČÚZK WFS není dostupné, použit lokální index parcel.");
    }
  }

  const localResult = await findParcelInLocalIndex(ku, parcelNumber);
  if (localResult) {
    return {
      ...localResult,
      warnings: [...onlineErrorWarnings, ...localResult.warnings]
    };
  }

  throw new ApiError(
    404,
    "Parcela nebyla nalezena online v ČÚZK ani v lokálním indexu.",
    {
      onlineSource: cuzkWfsUrl,
      localFallbackFile: getParcelIndexPath(),
      expectedColumns: ["kuName", "kuCode", "parcelId", "parcelNumber", "lat", "lon", "x", "y", "source"]
    }
  );
}

async function findParcelInCuzkWfs(ku: string, parcelNumber: string): Promise<ParcelResult | null> {
  const zonings = await findZoningsByName(ku);

  if (zonings.length === 0) {
    throw new ApiError(404, "Katastrální území nebylo nalezeno v online službě ČÚZK.", {
      source: cuzkWfsUrl
    });
  }

  const exactZonings = zonings.filter((zoning) => normalizeText(zoning.name) === normalizeText(ku));
  const candidates = exactZonings.length > 0 ? exactZonings : zonings;

  if (candidates.length > 1) {
    throw new ApiError(409, "Pro zadaný název existuje více katastrálních území.", {
      matches: candidates.map((zoning) => ({
        kuCode: zoning.code,
        name: zoning.name,
        id: zoning.id
      }))
    });
  }

  const zoning = candidates[0];
  if (!zoning) {
    return null;
  }

  const parcelXml = await getCuzkFeature({
    storedQuery_id: "GetParcel",
    UPPER_ZONING_ID: zoning.code || zoning.id.replace(/^CZ\./, ""),
    TEXT: normalizeParcelInput(parcelNumber),
    srsName: "http://www.opengis.net/def/crs/EPSG/0/4326"
  });

  if (getNumberAttribute(parcelXml, "numberReturned") === 0) {
    throw new ApiError(404, "Parcelní číslo nebylo nalezeno v zadaném katastrálním území.", {
      kuCode: zoning.code,
      source: cuzkWfsUrl
    });
  }

  const parcel = parseParcel(parcelXml, zoning);
  if (!parcel) {
    throw new ApiError(502, "ČÚZK WFS vrátil parcelu bez použitelného definičního bodu.", {
      kuCode: zoning.code,
      source: cuzkWfsUrl
    });
  }

  return parcel;
}

async function findZoningsByName(ku: string): Promise<CadastralZoning[]> {
  const xml = await getCuzkFeature({
    storedQuery_id: "GetZoningByName",
    ZONING_NAME: ku,
    srsName: "http://www.opengis.net/def/crs/EPSG/0/4326"
  });

  if (getNumberAttribute(xml, "numberReturned") === 0) {
    return [];
  }

  return getMemberBlocks(xml).map((member) => ({
    id: firstMatch(member, /gml:id="([^"]+)"/) ?? "",
    code: textContent(member, "cp:nationalCadastalZoningReference") ?? "",
    name: textContent(member, "cp:label") ?? textContent(member, "gn:text") ?? ""
  })).filter((zoning) => zoning.id || zoning.code || zoning.name);
}

async function getCuzkFeature(params: Record<string, string>): Promise<string> {
  const response = await cuzkClient.get<string>(cuzkWfsUrl, {
    params: {
      service: "WFS",
      version: "2.0.0",
      request: "GetFeature",
      ...params
    }
  });

  return response.data;
}

function parseParcel(xml: string, zoning: CadastralZoning): ParcelResult | null {
  const member = getMemberBlocks(xml)[0];
  if (!member) {
    return null;
  }

  const parcelId = textContent(member, "base:localId") ?? firstMatch(member, /<cp-ext:CadastralParcel[^>]*gml:id="([^"]+)"/) ?? "";
  const parcelNumber = textContent(member, "cp:label") ?? "";
  const referencePoint = getReferencePoint(member) ?? getCentroidFromPosList(member);

  if (!referencePoint) {
    return null;
  }

  return {
    kuCode: zoning.code,
    parcelId,
    parcelNumber,
    locationSJtsk: null,
    locationWgs84: referencePoint,
    locationSource: "ČÚZK CPX WFS GetZoningByName/GetParcel, definiční bod parcely ve WGS84",
    warnings: []
  };
}

function getReferencePoint(xml: string): { lat: number; lon: number } | null {
  const referencePointBlock = firstMatch(xml, /(<cp:referencePoint>[\s\S]*?<\/cp:referencePoint>)/);
  const pos = referencePointBlock ? textContent(referencePointBlock, "gml:pos") : null;
  return pos ? parseGmlPosition(pos) : null;
}

function getCentroidFromPosList(xml: string): { lat: number; lon: number } | null {
  const posList = textContent(xml, "gml:posList");
  if (!posList) {
    return null;
  }

  const values = posList.trim().split(/\s+/).map(Number).filter(Number.isFinite);
  if (values.length < 2) {
    return null;
  }

  let latSum = 0;
  let lonSum = 0;
  let count = 0;

  for (let index = 0; index + 1 < values.length; index += 2) {
    const lat = values[index];
    const lon = values[index + 1];
    if (lat === undefined || lon === undefined) {
      continue;
    }

    latSum += lat;
    lonSum += lon;
    count += 1;
  }

  return count > 0
    ? { lat: roundCoordinate(latSum / count), lon: roundCoordinate(lonSum / count) }
    : null;
}

function parseGmlPosition(value: string): { lat: number; lon: number } | null {
  const [lat, lon] = value.trim().split(/\s+/).map(Number);
  if (lat === undefined || lon === undefined) {
    return null;
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  return {
    lat: roundCoordinate(lat),
    lon: roundCoordinate(lon)
  };
}

async function findParcelInLocalIndex(ku: string, parcelNumber: string): Promise<ParcelResult | null> {
  const rows = await readParcelIndex();
  const kuNormalized = normalizeText(ku);
  const parcelNormalized = normalizeParcelNumber(parcelNumber);
  const matches = rows.filter((row) =>
    normalizeText(row.kuName) === kuNormalized &&
    normalizeParcelNumber(row.parcelNumber) === parcelNormalized
  );

  if (matches.length > 1) {
    throw new ApiError(409, "Pro zadané údaje existuje více shod.", {
      matches: matches.map((item) => ({
        kuCode: item.kuCode,
        parcelId: item.parcelId,
        parcelNumber: item.parcelNumber
      }))
    });
  }

  const match = matches[0];
  if (!match) {
    return null;
  }

  if ((match.lat === null || match.lon === null) && (match.x === null || match.y === null)) {
    throw new ApiError(422, "Parcela nemá v indexu definiční bod ani použitelné souřadnice.", {
      kuCode: match.kuCode,
      parcelId: match.parcelId
    });
  }

  return {
    kuCode: match.kuCode,
    parcelId: match.parcelId,
    parcelNumber: match.parcelNumber,
    locationSJtsk: match.x !== null && match.y !== null ? { x: match.x, y: match.y } : null,
    locationWgs84: match.lat !== null && match.lon !== null ? { lat: match.lat, lon: match.lon } : undefined,
    locationSource: match.source || "Lokální index parcel ČÚZK",
    warnings: isSampleParcelIndex()
      ? ["Použit ukázkový index parcel. Pro celou ČR nastavte CADASTRAL_INDEX_PATH na plný export ČÚZK."]
      : []
  };
}

async function readParcelIndex(): Promise<ParcelIndexRow[]> {
  const filePath = getParcelIndexPath();
  const csv = await fs.readFile(filePath, "utf8");

  return parseCsv(csv).flatMap((record) => {
    const kuName = record.kuName ?? "";
    const parcelNumber = record.parcelNumber ?? "";

    if (!kuName || !parcelNumber) {
      return [];
    }

    return [{
      kuName,
      kuCode: record.kuCode ?? "",
      parcelId: record.parcelId ?? "",
      parcelNumber,
      lat: parseNumber(record.lat),
      lon: parseNumber(record.lon),
      x: parseNumber(record.x),
      y: parseNumber(record.y),
      source: record.source ?? "Lokální index parcel ČÚZK"
    }];
  });
}

function getMemberBlocks(xml: string): string[] {
  return Array.from(xml.matchAll(/<member>([\s\S]*?)<\/member>/g), (match) => match[1] ?? "");
}

function textContent(xml: string, tagName: string): string | null {
  const escapedTagName = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(new RegExp(`<${escapedTagName}[^>]*>([\\s\\S]*?)<\\/${escapedTagName}>`));
  return match?.[1] ? decodeXml(match[1].trim()) : null;
}

function firstMatch(xml: string, pattern: RegExp): string | null {
  const match = xml.match(pattern);
  return match?.[1] ? decodeXml(match[1]) : null;
}

function getNumberAttribute(xml: string, attributeName: string): number | null {
  const match = xml.match(new RegExp(`${attributeName}="(\\d+)"`));
  return match?.[1] ? Number(match[1]) : null;
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function getParcelIndexPath(): string {
  return process.env.CADASTRAL_INDEX_PATH || defaultParcelIndexPath;
}

function isSampleParcelIndex(): boolean {
  return path.resolve(getParcelIndexPath()) === defaultParcelIndexPath;
}

function normalizeParcelInput(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeParcelNumber(value: string): string {
  return normalizeText(value).replace(/\s+/g, "");
}

function roundCoordinate(value: number): number {
  return Number(value.toFixed(6));
}

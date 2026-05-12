import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import axios from "axios";
import { parseCsv, parseNumber } from "../utils/csv.js";
import { haversineMeters } from "../utils/geo.js";

export type SnowLoadResult = {
  sk: number | null;
  source: string;
};

type GridCell = {
  lat: number;
  lon: number;
  sk: number;
  source: string;
};

const chmiClient = axios.create({
  timeout: 25000
});

const dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultSnowGridPath = path.resolve(dirname, "../../data/snow-load-grid.sample.csv");
const defaultOnlineSnowLoadUrl = "https://clima-maps.info/snehovamapa/getData.php";
const snowMapGrid = {
  rows: 2307,
  columns: 6228,
  xll: 11.9284707974,
  yll: 48.4784934355,
  cellSize: 0.0011467188,
  minLat: 48.48934,
  maxLat: 51.06933,
  minLon: 12.0036,
  maxLon: 18.987
};

export async function getSnowLoad(lat: number, lon: number, elevation: number | null): Promise<SnowLoadResult> {
  const chmi = await getChmiSnowLoad(lat, lon, elevation);
  if (chmi.sk !== null) {
    return chmi;
  }

  return getFallbackGridSnowLoad(lat, lon);
}

async function getChmiSnowLoad(lat: number, lon: number, _elevation: number | null): Promise<SnowLoadResult> {
  if (process.env.SNOW_LOAD_ONLINE_ENABLED === "false") {
    return {
      sk: null,
      source: "Online sněhová mapa je vypnutá nastavením SNOW_LOAD_ONLINE_ENABLED=false"
    };
  }

  if (!isInSnowMapBounds(lat, lon)) {
    return {
      sk: null,
      source: "Online sněhová mapa: bod leží mimo podporovaný rozsah ČR"
    };
  }

  try {
    const response = await chmiClient.post(
      process.env.SNOW_LOAD_ONLINE_URL || defaultOnlineSnowLoadUrl,
      new URLSearchParams({
        action: "getData",
        id: String(getSnowMapIndex(lat, lon)),
        coords: toCoordinateString(lat, lon)
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    const payload = response.data as Record<string, unknown>;
    const error = typeof payload.error === "string" ? payload.error.trim() : "";
    const sk = parseOnlineNumber(payload.sk);

    if (error || sk === null) {
      return {
        sk: null,
        source: error ? `Online sněhová mapa: ${error}` : "Online sněhová mapa nevrátila hodnotu sk"
      };
    }

    return {
      sk,
      source: "ČHMÚ / clima-maps digitální mapa zatížení sněhem na zemi, online dotaz getData.php"
    };
  } catch {
    return {
      sk: null,
      source: "Online sněhová mapa není dostupná"
    };
  }
}

async function getFallbackGridSnowLoad(lat: number, lon: number): Promise<SnowLoadResult> {
  const cells = await readCsvGrid(getSnowGridPath());
  const nearest = findNearestCell(lat, lon, cells);
  const maxDistanceMeters = Number(process.env.SNOW_GRID_MAX_DISTANCE_METERS ?? 100);

  if (!nearest || nearest.distanceMeters > maxDistanceMeters) {
    return {
      sk: null,
      source: `Lokální grid sněhového zatížení nenalezl buňku do ${maxDistanceMeters} m`
    };
  }

  return {
    sk: nearest.cell.sk,
    source: nearest.cell.source
  };
}

async function readCsvGrid(filePath: string): Promise<GridCell[]> {
  const csv = await fs.readFile(filePath, "utf8");

  return parseCsv(csv).flatMap((record) => {
    const lat = parseNumber(record.lat);
    const lon = parseNumber(record.lon);
    const sk = parseNumber(record.sk);

    if (lat === null || lon === null || sk === null) {
      return [];
    }

    return [{
      lat,
      lon,
      sk,
      source: record.source ?? "Lokální grid sněhového zatížení"
    }];
  });
}

function findNearestCell(lat: number, lon: number, cells: GridCell[]): { cell: GridCell; distanceMeters: number } | null {
  let best: { cell: GridCell; distanceMeters: number } | null = null;

  for (const cell of cells) {
    const distanceMeters = haversineMeters(lat, lon, cell.lat, cell.lon);

    if (!best || distanceMeters < best.distanceMeters) {
      best = { cell, distanceMeters };
    }
  }

  return best;
}

function getSnowGridPath(): string {
  return process.env.SNOW_LOAD_GRID_PATH || defaultSnowGridPath;
}

function isInSnowMapBounds(lat: number, lon: number): boolean {
  return (
    lat >= snowMapGrid.minLat &&
    lat <= snowMapGrid.maxLat &&
    lon >= snowMapGrid.minLon &&
    lon <= snowMapGrid.maxLon
  );
}

function getSnowMapIndex(lat: number, lon: number): number {
  const row = snowMapGrid.rows - Math.floor((lat - snowMapGrid.yll) / snowMapGrid.cellSize) - 1;
  const column = Math.floor((lon - snowMapGrid.xll) / snowMapGrid.cellSize);
  return row * snowMapGrid.columns + column;
}

function toCoordinateString(lat: number, lon: number): string {
  const latParts = decimalToParts(lat);
  const lonParts = decimalToParts(lon);
  return `${format2(latParts.deg)}-${format2(latParts.min)}-${format2(latParts.sec)}_${format2(lonParts.deg)}-${format2(lonParts.min)}-${format2(lonParts.sec)}`;
}

function decimalToParts(value: number): { deg: number; min: number; sec: number } {
  const absolute = Math.abs(value);
  const deg = Math.floor(absolute);
  const min = Math.floor((absolute - deg) * 60);
  const sec = Math.round(absolute * 3600 - min * 60 - deg * 3600);
  return { deg, min, sec };
}

function format2(value: number): string {
  return String(value).padStart(2, "0");
}

function parseOnlineNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

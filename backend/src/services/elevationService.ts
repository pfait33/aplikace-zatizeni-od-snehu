import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import axios from "axios";
import { parseCsv, parseNumber } from "../utils/csv.js";
import { haversineMeters } from "../utils/geo.js";

export type ElevationResult = {
  value: number | null;
  source: string;
};

type ElevationCell = {
  lat: number;
  lon: number;
  elevation: number;
  source: string;
};

const dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultElevationGridPath = path.resolve(dirname, "../../data/elevation-grid.sample.csv");
const defaultElevationApiUrl = "https://api.open-meteo.com/v1/elevation?latitude={lat}&longitude={lon}";

const elevationClient = axios.create({
  timeout: 10000
});

export async function getElevation(lat: number, lon: number): Promise<ElevationResult> {
  const external = await getExternalElevation(lat, lon);
  if (external.value !== null) {
    return external;
  }

  return getLocalDemElevation(lat, lon);
}

async function getExternalElevation(lat: number, lon: number): Promise<ElevationResult> {
  if (process.env.ELEVATION_ONLINE_ENABLED === "false") {
    return {
      value: null,
      source: "Online elevation service je vypnutá nastavením ELEVATION_ONLINE_ENABLED=false"
    };
  }

  try {
    const template = process.env.ELEVATION_API_URL || defaultElevationApiUrl;
    const url = template
      .replace("{lat}", encodeURIComponent(String(lat)))
      .replace("{lon}", encodeURIComponent(String(lon)));
    const response = await elevationClient.get(url);
    const value = extractElevation(response.data);

    return {
      value,
      source: value === null ? "Externí elevation API nevrátilo výšku" : "Externí elevation API"
    };
  } catch {
    return {
      value: null,
      source: "Externí elevation API není dostupné"
    };
  }
}

async function getLocalDemElevation(lat: number, lon: number): Promise<ElevationResult> {
  const cells = await readElevationGrid();
  let best: { cell: ElevationCell; distanceMeters: number } | null = null;

  for (const cell of cells) {
    const distanceMeters = haversineMeters(lat, lon, cell.lat, cell.lon);
    if (!best || distanceMeters < best.distanceMeters) {
      best = { cell, distanceMeters };
    }
  }

  const maxDistanceMeters = Number(process.env.ELEVATION_GRID_MAX_DISTANCE_METERS ?? 100);
  if (!best || best.distanceMeters > maxDistanceMeters) {
    return {
      value: null,
      source: "Lokální DEM neobsahuje buňku pro zadanou polohu"
    };
  }

  return {
    value: best.cell.elevation,
    source: best.cell.source
  };
}

async function readElevationGrid(): Promise<ElevationCell[]> {
  const filePath = process.env.ELEVATION_GRID_PATH || defaultElevationGridPath;
  const csv = await fs.readFile(filePath, "utf8");

  return parseCsv(csv).flatMap((record) => {
    const lat = parseNumber(record.lat);
    const lon = parseNumber(record.lon);
    const elevation = parseNumber(record.elevation);

    if (lat === null || lon === null || elevation === null) {
      return [];
    }

    return [{
      lat,
      lon,
      elevation,
      source: record.source ?? "Lokální DEM"
    }];
  });
}

function extractElevation(data: unknown): number | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const object = data as Record<string, unknown>;
  if (typeof object.elevation === "number") {
    return object.elevation;
  }

  if (Array.isArray(object.elevation)) {
    const [firstElevation] = object.elevation;
    return typeof firstElevation === "number" ? firstElevation : null;
  }

  if (Array.isArray(object.results)) {
    const first = object.results[0] as Record<string, unknown> | undefined;
    return typeof first?.elevation === "number" ? first.elevation : null;
  }

  return null;
}

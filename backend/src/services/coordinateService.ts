import proj4 from "proj4";

type Coordinate = {
  lat: number;
  lon: number;
};

type SJtskCoordinate = {
  x: number;
  y: number;
};

const sJtsk = "+proj=krovak +lat_0=49.5 +lon_0=24.83333333333333 +alpha=30.28813972222222 +k=0.9999 +x_0=0 +y_0=0 +ellps=bessel +towgs84=570.8,85.7,462.8,4.998,1.587,5.261,3.56 +units=m +no_defs";

proj4.defs("EPSG:5514", sJtsk);
proj4.defs("EPSG:4326", "+proj=longlat +datum=WGS84 +no_defs");

export function toWgs84(x: number, y: number): Coordinate {
  const [lon, lat] = proj4("EPSG:5514", "EPSG:4326", [x, y]);

  if (typeof lat !== "number" || typeof lon !== "number") {
    throw new Error("Nepodařilo se převést souřadnice S-JTSK na WGS84.");
  }

  return {
    lat: roundCoordinate(lat),
    lon: roundCoordinate(lon)
  };
}

export function fromWgs84(lat: number, lon: number): SJtskCoordinate {
  const [x, y] = proj4("EPSG:4326", "EPSG:5514", [lon, lat]);

  if (typeof x !== "number" || typeof y !== "number") {
    throw new Error("Nepodařilo se převést souřadnice WGS84 na S-JTSK.");
  }

  return {
    x: Math.round(x),
    y: Math.round(y)
  };
}

function roundCoordinate(value: number): number {
  return Number(value.toFixed(6));
}

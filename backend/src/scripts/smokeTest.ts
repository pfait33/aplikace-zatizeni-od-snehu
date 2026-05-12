import { resolveSnowLoad } from "../services/snowLoadQueryService.js";

const result = await resolveSnowLoad("Kvaň", "223/2");

if (result.parcel.parcelNumber !== "223/2") {
  throw new Error("Smoke test selhal: neočekávané parcelní číslo.");
}

if (result.location.lat === null || result.location.lon === null) {
  throw new Error("Smoke test selhal: chybí GPS souřadnice.");
}

if (result.snowLoad.sk === null) {
  throw new Error("Smoke test selhal: chybí hodnota sněhového zatížení.");
}

console.log(JSON.stringify(result, null, 2));

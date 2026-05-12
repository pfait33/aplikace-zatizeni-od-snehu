import { Router } from "express";
import { resolveSnowLoad } from "../services/snowLoadQueryService.js";
import { ApiError } from "../utils/errors.js";

export const snowLoadRouter = Router();

snowLoadRouter.get("/", async (req, res) => {
  const ku = String(req.query.ku ?? "").trim();
  const parcel = String(req.query.parcel ?? "").trim();

  if (!ku || !parcel) {
    res.status(400).json({ error: "Vyplňte katastrální území i parcelní číslo." });
    return;
  }

  try {
    res.json(await resolveSnowLoad(ku, parcel));
  } catch (error) {
    if (error instanceof ApiError) {
      res.status(error.statusCode).json({ error: error.message, details: error.details });
      return;
    }

    console.error(error);
    res.status(500).json({ error: "Neočekávaná chyba serveru." });
  }
});

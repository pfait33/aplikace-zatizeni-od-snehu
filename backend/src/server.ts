import cors from "cors";
import express from "express";
import { snowLoadRouter } from "./routes/snowLoadRoute.js";

const app = express();
const port = Number(process.env.PORT ?? 3001);
const allowedOrigins = (process.env.CORS_ORIGINS ?? "http://localhost:5173,https://pfait33.github.io")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origin ${origin} is not allowed by CORS.`));
  }
}));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "snow-load-api" });
});

app.use("/api/snow-load", snowLoadRouter);

app.listen(port, () => {
  console.log(`Snow load backend listening on http://localhost:${port}`);
});

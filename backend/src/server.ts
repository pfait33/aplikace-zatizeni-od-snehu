import cors from "cors";
import express from "express";
import { snowLoadRouter } from "./routes/snowLoadRoute.js";

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/snow-load", snowLoadRouter);

app.listen(port, () => {
  console.log(`Snow load backend listening on http://localhost:${port}`);
});

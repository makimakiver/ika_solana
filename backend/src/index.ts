import "dotenv/config";
import express from "express";
import dwalletRouter from "./routes/dwallet.js";
import depositRouter from "./routes/deposit.js";
import testRouter from "./routes/test.js";
import bridgeRouter from "./routes/bridge.js";
import lifiRouter from "./routes/lifi.js";

const app = express();
const PORT = process.env.PORT ?? 3001;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";

app.use(express.json());

// Allow requests from the Next.js frontend
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", FRONTEND_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/dwallet", dwalletRouter);
app.use("/api/deposit", depositRouter);
app.use("/api/test", testRouter);
app.use("/api/bridge", bridgeRouter);
app.use("/api/lifi", lifiRouter);

app.listen(PORT, () => {
  console.log(`Urchin backend running on http://localhost:${PORT}`);
});

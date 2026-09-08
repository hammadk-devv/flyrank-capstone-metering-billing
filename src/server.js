import "dotenv/config";
import express from "express";
import pool from "./db/pool.js";
import generateRouter from "./routes/generate.routes.js";
import usageRouter from "./routes/usage.routes.js";

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "metering-billing-engine",
  });
});

app.get("/health/db", async (_req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS current_time");

    res.json({
      status: "ok",
      database: "connected",
      current_time: result.rows[0].current_time,
    });
  } catch (error) {
    console.error("Database health check failed:", error);

    res.status(503).json({
      status: "error",
      database: "unavailable",
    });
  }
});

app.use(generateRouter);
app.use(usageRouter);

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
import "dotenv/config";
import express from "express";

const app = express();
const port = process.env.PORT || 3000;

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "metering-billing-engine",
  });
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
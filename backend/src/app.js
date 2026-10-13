import cors from "cors";
import express from "express";
import { createDishRepository } from "./dishRepository.js";
import { createDishesRouter } from "./routes/dishes.js";

export function createApp(db, { corsOrigin } = {}) {
  const app = express();
  app.use(cors({ origin: corsOrigin || true }));
  app.use(express.json({ limit: "10kb" }));

  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.use("/dishes", createDishesRouter(createDishRepository(db)));

  app.use((_req, res) => res.status(404).json({ error: "NotFound", message: "Route not found." }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === "entity.parse.failed" || err.type === "entity.too.large") {
      return res.status(400).json({
        error: "ValidationError",
        message: err.type === "entity.too.large" ? "Request body too large." : "Request body is not valid JSON.",
        details: [{ field: "body", message: err.message }],
      });
    }
    console.error(err);
    res.status(500).json({ error: "InternalServerError", message: "Something went wrong. Please try again." });
  });

  return app;
}

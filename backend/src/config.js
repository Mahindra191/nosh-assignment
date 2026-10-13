import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const config = {
  port: Number(process.env.PORT) || 4000,
  dbPath: path.resolve(backendRoot, process.env.DB_PATH || "./data/nosh.db"),
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
  seedFile: path.resolve(backendRoot, "data/dishes.json"),
};

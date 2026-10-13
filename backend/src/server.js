import { config } from "./config.js";
import { openDb } from "./db.js";
import { createApp } from "./app.js";

const db = openDb(config.dbPath);
const server = createApp(db, { corsOrigin: config.corsOrigin }).listen(config.port, () => {
  console.log(`Nosh backend listening on http://localhost:${config.port} (db: ${config.dbPath})`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

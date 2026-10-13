import fs from "node:fs";
import path from "node:path";
import { config } from "../src/config.js";
import { openDb } from "../src/db.js";
import { createDishRepository } from "../src/dishRepository.js";

// Usage: npm run seed [-- --file path/to/dishes.json]
const fileFlag = process.argv.indexOf("--file");
const seedFile = fileFlag > -1 ? path.resolve(process.argv[fileFlag + 1]) : config.seedFile;

const dishes = JSON.parse(fs.readFileSync(seedFile, "utf8"));
const db = openDb(config.dbPath);
const repo = createDishRepository(db);

// INSERT OR IGNORE: existing dishes (and their edits/versions) are never touched, so reruns are safe.
let inserted = 0;
for (const dish of dishes) {
  if (repo.insertIfMissing(dish)) inserted++;
}
console.log(`Seeded ${inserted} new dish(es), skipped ${dishes.length - inserted} existing, from ${seedFile}`);
console.log(`Database: ${config.dbPath}`);
db.close();

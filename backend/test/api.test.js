import assert from "node:assert/strict";
import fs from "node:fs";
import { after, before, describe, it } from "node:test";
import { createApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import { createDishRepository } from "../src/dishRepository.js";

const seed = JSON.parse(fs.readFileSync(new URL("../data/dishes.json", import.meta.url), "utf8"));
const fixtures = JSON.parse(fs.readFileSync(new URL("../data/invalid-image-fixtures.json", import.meta.url), "utf8"));

let server, base, db, repo;

before(async () => {
  db = openDb(":memory:");
  repo = createDishRepository(db);
  [...seed, ...fixtures].forEach((d) => repo.insertIfMissing(d));
  server = createApp(db).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://localhost:${server.address().port}`;
});
after(() => { server.close(); db.close(); });

const patch = (id, body, raw) =>
  fetch(`${base}/dishes/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });

describe("GET /dishes", () => {
  it("returns all dishes with version 1", async () => {
    const dishes = await (await fetch(`${base}/dishes`)).json();
    assert.equal(dishes.length, seed.length + fixtures.length);
    assert.ok(dishes.every((d) => d.version === 1));
  });
});

describe("seeding", () => {
  it("is idempotent and does not overwrite edits", async () => {
    await patch("3", { dishName: "Rabdi Special", isPublished: true, expectedVersion: 1 });
    seed.forEach((d) => repo.insertIfMissing(d));
    const dishes = await (await fetch(`${base}/dishes`)).json();
    assert.equal(dishes.length, seed.length + fixtures.length);
    const rabdi = dishes.find((d) => d.dishId === "3");
    assert.equal(rabdi.dishName, "Rabdi Special");
    assert.equal(rabdi.version, 2);
  });
});

describe("PATCH /dishes/:dishId", () => {
  it("saves explicit values, trims the name and increments the version", async () => {
    const res = await patch("1", { dishName: "  Jeera Rice Deluxe ", isPublished: false, expectedVersion: 1 });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ...seed[0], dishName: "Jeera Rice Deluxe", isPublished: false, version: 2 });
  });

  it("returns 409 with the current dish for a stale version and leaves data unchanged", async () => {
    const res = await patch("1", { dishName: "Stale", isPublished: true, expectedVersion: 1 });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.currentDish.dishName, "Jeera Rice Deluxe");
    assert.equal(body.currentDish.version, 2);
    assert.equal(repo.get("1").dishName, "Jeera Rice Deluxe");
  });

  it("returns 404 for an unknown dish", async () => {
    assert.equal((await patch("999", { dishName: "x", isPublished: false, expectedVersion: 1 })).status, 404);
  });

  it("returns 400 for malformed input and does not change the dish", async () => {
    const before = repo.get("2");
    const bad = [
      { dishName: 5, isPublished: true, expectedVersion: 1 },
      { dishName: "ok", isPublished: "yes", expectedVersion: 1 },
      { dishName: "ok", isPublished: true, expectedVersion: "1" },
      { dishName: "ok", isPublished: true, expectedVersion: 0 },
      { dishName: "ok", isPublished: true, expectedVersion: 1.5 },
      { dishName: "ok", isPublished: true },
      [],
    ];
    for (const body of bad) assert.equal((await patch("2", body)).status, 400, JSON.stringify(body));
    assert.equal((await patch("2", null, "{not json")).status, 400);
    assert.equal((await patch("bad id!", { dishName: "ok", isPublished: true, expectedVersion: 1 })).status, 400);
    assert.deepEqual(repo.get("2"), before);
  });

  it("rejects publishing with an empty/whitespace name", async () => {
    const before = repo.get("2");
    const res = await patch("2", { dishName: "   ", isPublished: true, expectedVersion: 1 });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).details[0].field, "dishName");
    assert.deepEqual(repo.get("2"), before);
  });

  it("allows an empty name while unpublished", async () => {
    const res = await patch("5", { dishName: "", isPublished: false, expectedVersion: 1 });
    assert.equal(res.status, 200);
  });

  it("rejects publishing a dish whose stored image URL is invalid or non-HTTP(S)", async () => {
    for (const id of ["bad-image", "ftp-image"]) {
      const before = repo.get(id);
      const res = await patch(id, { dishName: "Named", isPublished: true, expectedVersion: 1 });
      assert.equal(res.status, 400);
      assert.equal((await res.json()).details[0].field, "imageUrl");
      assert.deepEqual(repo.get(id), before);
    }
    // Saving it unpublished is fine.
    assert.equal((await patch("bad-image", { dishName: "Named", isPublished: false, expectedVersion: 1 })).status, 200);
  });

  it("lets exactly one of many concurrent requests with the same version win", async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        patch("4", { dishName: `Racer ${i}`, isPublished: true, expectedVersion: 1 })
      )
    );
    const statuses = results.map((r) => r.status);
    assert.equal(statuses.filter((s) => s === 200).length, 1);
    assert.equal(statuses.filter((s) => s === 409).length, 24);
    assert.equal(repo.get("4").version, 2);
  });
});

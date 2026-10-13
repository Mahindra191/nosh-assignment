import { validatePublishable } from "./validation.js";

const toDish = (row) => ({
  dishId: row.dish_id,
  dishName: row.dish_name,
  imageUrl: row.image_url,
  isPublished: row.is_published === 1,
  version: row.version,
});

/** Outcome kinds returned by updateDish. */
export const UpdateResult = {
  UPDATED: "updated",
  NOT_FOUND: "not_found",
  CONFLICT: "conflict",
  INVALID: "invalid",
};

export function createDishRepository(db) {
  const selectAll = db.prepare("SELECT * FROM dishes ORDER BY CAST(dish_id AS INTEGER), dish_id");
  const selectOne = db.prepare("SELECT * FROM dishes WHERE dish_id = ?");
  const insertIgnore = db.prepare(
    "INSERT OR IGNORE INTO dishes (dish_id, dish_name, image_url, is_published, version) VALUES (?, ?, ?, ?, 1)"
  );
  // The WHERE clause carries the optimistic lock: it only matches if the version is unchanged.
  const updateIfVersion = db.prepare(
    `UPDATE dishes SET dish_name = ?, is_published = ?, version = version + 1
     WHERE dish_id = ? AND version = ?`
  );

  return {
    list: () => selectAll.all().map(toDish),

    get(dishId) {
      const row = selectOne.get(dishId);
      return row ? toDish(row) : null;
    },

    /** Inserts a dish with version 1 unless the id already exists. Returns true if inserted. */
    insertIfMissing({ dishId, dishName, imageUrl, isPublished }) {
      return insertIgnore.run(dishId, dishName, imageUrl, isPublished ? 1 : 0).changes === 1;
    },

    /**
     * Compare-and-set update inside an IMMEDIATE transaction, so the read of the stored
     * state (needed for validation) and the write cannot interleave with another writer.
     */
    updateDish(dishId, { dishName, isPublished, expectedVersion }) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const row = selectOne.get(dishId);
        if (!row) {
          db.exec("ROLLBACK");
          return { kind: UpdateResult.NOT_FOUND };
        }
        if (row.version !== expectedVersion) {
          db.exec("ROLLBACK");
          return { kind: UpdateResult.CONFLICT, current: toDish(row) };
        }
        if (isPublished) {
          const errors = validatePublishable({ dishName, imageUrl: row.image_url });
          if (errors.length) {
            db.exec("ROLLBACK");
            return { kind: UpdateResult.INVALID, errors };
          }
        }
        const { changes } = updateIfVersion.run(dishName, isPublished ? 1 : 0, dishId, expectedVersion);
        if (changes !== 1) throw new Error("Version-guarded update affected no rows");
        const saved = toDish(selectOne.get(dishId));
        db.exec("COMMIT");
        return { kind: UpdateResult.UPDATED, dish: saved };
      } catch (err) {
        try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
        throw err;
      }
    },
  };
}

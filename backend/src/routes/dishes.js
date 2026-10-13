import { Router } from "express";
import { UpdateResult } from "../dishRepository.js";
import { isValidDishId, validatePatchBody } from "../validation.js";

const badRequest = (res, errors) =>
  res.status(400).json({ error: "ValidationError", message: "Invalid request.", details: errors });

export function createDishesRouter(repo) {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(repo.list());
  });

  router.patch("/:dishId", (req, res) => {
    const { dishId } = req.params;
    if (!isValidDishId(dishId)) {
      return badRequest(res, [{ field: "dishId", message: "dishId is not a valid identifier." }]);
    }
    const parsed = validatePatchBody(req.body);
    if (parsed.errors) return badRequest(res, parsed.errors);

    const result = repo.updateDish(dishId, parsed.value);
    switch (result.kind) {
      case UpdateResult.UPDATED:
        return res.json(result.dish);
      case UpdateResult.NOT_FOUND:
        return res.status(404).json({ error: "NotFound", message: `Dish "${dishId}" does not exist.` });
      case UpdateResult.CONFLICT:
        return res.status(409).json({
          error: "VersionConflict",
          message: "The dish was updated by someone else since you loaded it.",
          currentDish: result.current,
        });
      case UpdateResult.INVALID:
        return badRequest(res, result.errors);
      default:
        throw new Error(`Unhandled update result: ${result.kind}`);
    }
  });

  return router;
}

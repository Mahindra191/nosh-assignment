/** Validation helpers. Pure functions; no I/O. */

const DISH_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_NAME_LENGTH = 200;

export function isValidDishId(value) {
  return typeof value === "string" && DISH_ID_PATTERN.test(value);
}

export function isValidHttpUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value.trim());
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
  } catch {
    return false;
  }
}

/**
 * Validates the shape of a PATCH body (types only, no knowledge of stored state).
 * Returns { value } on success or { errors } (list of { field, message }).
 */
export function validatePatchBody(body) {
  const errors = [];
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { errors: [{ field: "body", message: "Request body must be a JSON object." }] };
  }

  const { dishName, isPublished, expectedVersion } = body;

  if (typeof dishName !== "string") {
    errors.push({ field: "dishName", message: "dishName must be a string." });
  } else if (dishName.length > MAX_NAME_LENGTH) {
    errors.push({ field: "dishName", message: `dishName must be at most ${MAX_NAME_LENGTH} characters.` });
  }
  if (typeof isPublished !== "boolean") {
    errors.push({ field: "isPublished", message: "isPublished must be a boolean." });
  }
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    errors.push({ field: "expectedVersion", message: "expectedVersion must be a positive integer." });
  }

  if (errors.length) return { errors };
  return { value: { dishName: dishName.trim(), isPublished, expectedVersion } };
}

/** Rules that depend on the stored dish: a published dish needs a name and a valid image URL. */
export function validatePublishable({ dishName, imageUrl }) {
  const errors = [];
  if (dishName.trim() === "") {
    errors.push({ field: "dishName", message: "A published dish must have a non-empty name." });
  }
  if (!isValidHttpUrl(imageUrl)) {
    errors.push({ field: "imageUrl", message: "A published dish must have a valid HTTP/HTTPS image URL." });
  }
  return errors;
}

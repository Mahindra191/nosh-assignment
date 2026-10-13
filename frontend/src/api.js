const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/$/, "");

/** Error carrying the HTTP status (0 = network failure) and parsed response body. */
export class ApiError extends Error {
  constructor(message, { status = 0, body = null } = {}) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new ApiError("Could not reach the server. Check your connection and try again.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(body?.message || `Request failed with status ${res.status}.`, { status: res.status, body });
  }
  return body;
}

export const fetchDishes = (signal) => request("/dishes", { signal });

export const saveDish = (dishId, { dishName, isPublished, expectedVersion }) =>
  request(`/dishes/${encodeURIComponent(dishId)}`, {
    method: "PATCH",
    body: JSON.stringify({ dishName, isPublished, expectedVersion }),
  });

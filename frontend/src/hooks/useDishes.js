import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, fetchDishes, saveDish } from "../api.js";

const POLL_INTERVAL_MS = Math.min(Number(import.meta.env.VITE_POLL_INTERVAL_MS) || 4000, 5000);

const isDirty = (saved, draft) =>
  Boolean(draft) && (draft.dishName !== saved.dishName || draft.isPublished !== saved.isPublished);

function describeError(err) {
  const details = err.body?.details;
  if (err.status === 400 && Array.isArray(details) && details.length) {
    return details.map((d) => d.message).join(" ");
  }
  if (err.status === 404) return "This dish no longer exists on the server.";
  if (err.status >= 500) return "The server hit an error while saving. Your draft is kept; please retry.";
  return err.message;
}

/**
 * State model
 *  - saved[id]   : last values loaded from / confirmed by the server (with its version)
 *  - drafts[id]  : local edits, only present once the user edits; never sent until Save
 *  - remote[id]  : newest server state seen by polling (may be ahead of saved[id])
 *  - ui[id]      : { saving, error, conflict } transient per-dish state
 * A draft is always saved against saved[id].version (the version it was based on).
 * Polling never touches a dish that has an unsaved draft; it only updates `remote`.
 */
export function useDishes() {
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [loadError, setLoadError] = useState("");
  const [saved, setSaved] = useState({});
  const [order, setOrder] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [remote, setRemote] = useState({});
  const [ui, setUi] = useState({});
  const [offline, setOffline] = useState(false);

  // Refs let async callbacks (polling, save) read the latest state without stale closures.
  const savedRef = useRef(saved);
  const draftsRef = useRef(drafts);
  const uiRef = useRef(ui);
  savedRef.current = saved;
  draftsRef.current = drafts;
  uiRef.current = ui;

  const patchUi = useCallback((id, patch) => setUi((u) => ({ ...u, [id]: { ...u[id], ...patch } })), []);

  const applyServerList = useCallback((list) => {
    const byId = Object.fromEntries(list.map((d) => [d.dishId, d]));
    setOrder(list.map((d) => d.dishId));
    setSaved(byId);
    setRemote(byId);
    setDrafts({});
    setUi({});
  }, []);

  const load = useCallback(async () => {
    setStatus("loading");
    setLoadError("");
    try {
      applyServerList(await fetchDishes());
      setStatus("ready");
    } catch (err) {
      setLoadError(err.message);
      setStatus("error");
    }
  }, [applyServerList]);

  useEffect(() => {
    load();
  }, [load]);

  // --- Polling for external updates (bonus) ---
  useEffect(() => {
    if (status !== "ready") return undefined;
    let controller = null;
    let stopped = false;

    const poll = async () => {
      if (document.hidden || controller) return; // skip hidden tabs and overlapping requests
      controller = new AbortController();
      try {
        const list = await fetchDishes(controller.signal);
        if (stopped) return;
        setOffline(false);
        setRemote(Object.fromEntries(list.map((d) => [d.dishId, d])));
        // Silently adopt newer server data only for dishes the user has no unsaved draft for.
        setSaved((prev) => {
          let next = prev;
          for (const dish of list) {
            const cur = prev[dish.dishId];
            if (!cur || dish.version <= cur.version) continue; // also ignores responses older than a just-finished save
            if (isDirty(cur, draftsRef.current[dish.dishId]) || uiRef.current[dish.dishId]?.saving) continue;
            if (next === prev) next = { ...prev };
            next[dish.dishId] = dish;
          }
          return next;
        });
      } catch (err) {
        if (err.name !== "AbortError" && !stopped) setOffline(true); // keep polling; recovers on next success
      } finally {
        controller = null;
      }
    };

    const timer = setInterval(poll, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", poll);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
      controller?.abort();
    };
  }, [status]);

  const editDraft = useCallback((id, changes) => {
    setDrafts((d) => {
      const base = d[id] ?? {
        dishName: savedRef.current[id].dishName,
        isPublished: savedRef.current[id].isPublished,
      };
      return { ...d, [id]: { ...base, ...changes } };
    });
  }, []);

  /** Restores the last loaded values and clears any error/conflict notice. */
  const discard = useCallback((id) => {
    setDrafts(({ [id]: _removed, ...rest }) => rest);
    setUi(({ [id]: _removed, ...rest }) => rest);
  }, []);

  const save = useCallback(
    async (id) => {
      const base = savedRef.current[id];
      const draft = draftsRef.current[id];
      if (!base || !isDirty(base, draft) || uiRef.current[id]?.saving) return;

      patchUi(id, { saving: true, error: "", conflict: null });
      try {
        const result = await saveDish(id, {
          dishName: draft.dishName,
          isPublished: draft.isPublished,
          expectedVersion: base.version,
        });
        setSaved((s) => ({ ...s, [id]: result }));
        setRemote((r) => ({ ...r, [id]: result }));
        setDrafts(({ [id]: _removed, ...rest }) => rest);
        patchUi(id, { saving: false, error: "", conflict: null, justSaved: true });
      } catch (err) {
        if (err instanceof ApiError && err.status === 409 && err.body?.currentDish) {
          // Keep the draft; remember the newer server copy so the user can choose to reload.
          setRemote((r) => ({ ...r, [id]: err.body.currentDish }));
          patchUi(id, { saving: false, error: "", conflict: err.body.currentDish });
        } else {
          patchUi(id, { saving: false, error: describeError(err), conflict: null });
        }
      }
    },
    [patchUi]
  );

  /** Explicitly adopts the newest server copy, dropping the local draft. */
  const reloadFromServer = useCallback((id) => {
    const latest = uiRef.current[id]?.conflict ?? remote[id];
    if (!latest) return;
    setSaved((s) => ({ ...s, [id]: latest }));
    discard(id);
  }, [remote, discard]);

  return { status, loadError, order, saved, drafts, remote, ui, offline, load, editDraft, discard, save, reloadFromServer };
}

export { isDirty };

import { useState } from "react";
import { isDirty } from "../hooks/useDishes.js";

function DishImage({ src, alt }) {
  const [failedSrc, setFailedSrc] = useState(null);
  if (!src || failedSrc === src) {
    return <div className="dish-image dish-image--fallback" role="img" aria-label="Image unavailable">Image unavailable</div>;
  }
  return <img className="dish-image" src={src} alt={alt} onError={() => setFailedSrc(src)} />;
}

export default function DishCard({ saved, draft, remote, state = {}, onEdit, onDiscard, onSave, onReload }) {
  const { saving = false, error = "", conflict = null, justSaved = false } = state;
  const dirty = isDirty(saved, draft);
  const current = draft ?? saved; // what the inputs show
  const newerAvailable = remote && remote.version > saved.version;
  const newer = conflict ?? (newerAvailable ? remote : null);

  const handleReload = () => {
    const ok = window.confirm(
      "Reloading discards your unsaved changes to this dish and loads the latest saved values. Continue?"
    );
    if (ok) onReload();
  };

  return (
    <li className={`card${dirty ? " card--dirty" : ""}`}>
      <DishImage src={saved.imageUrl} alt={saved.dishName} />

      <div className="card-body">
        <div className="meta">
          <span>ID: <code>{saved.dishId}</code></span>
          <span>Version: <strong>{saved.version}</strong></span>
          <span className={`pill ${saved.isPublished ? "pill--on" : "pill--off"}`}>
            Saved: {saved.isPublished ? "Published" : "Unpublished"}
          </span>
          {dirty && <span className="pill pill--draft">Unsaved changes</span>}
        </div>

        <p className="saved-name">Saved name: <strong>{saved.dishName || <em>(empty)</em>}</strong></p>

        <label className="field">
          <span>Dish name</span>
          <input
            type="text"
            value={current.dishName}
            disabled={saving}
            onChange={(e) => onEdit({ dishName: e.target.value })}
          />
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={current.isPublished}
            disabled={saving}
            onChange={(e) => onEdit({ isPublished: e.target.checked })}
          />
          <span>Published</span>
        </label>

        {error && <p className="notice notice--error" role="alert">{error}</p>}

        {newer && (
          <div className="notice notice--warn" role="alert">
            {conflict ? (
              <p><strong>Save rejected: another update occurred.</strong> This dish was changed on the server (now version {newer.version}) after you loaded it. Your draft is preserved.</p>
            ) : (
              <p><strong>Newer saved data is available</strong> (version {newer.version}). Your draft is preserved and was not changed. Saving it will fail until you reload.</p>
            )}
            <p className="muted">
              Latest saved: “{newer.dishName}”, {newer.isPublished ? "published" : "unpublished"}.
            </p>
            <button type="button" className="btn btn--warn" onClick={handleReload} disabled={saving}>
              Reload latest (discards my draft)
            </button>
          </div>
        )}

        {justSaved && !dirty && !newer && !error && <p className="notice notice--ok">Saved.</p>}

        <div className="actions">
          <button type="button" className="btn btn--primary" onClick={onSave} disabled={!dirty || saving}>
            {saving ? "Saving…" : error ? "Retry save" : "Save"}
          </button>
          <button type="button" className="btn" onClick={onDiscard} disabled={(!dirty && !error && !conflict) || saving}>
            Discard
          </button>
        </div>
      </div>
    </li>
  );
}

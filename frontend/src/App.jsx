import DishCard from "./components/DishCard.jsx";
import { useDishes } from "./hooks/useDishes.js";

export default function App() {
  const { status, loadError, order, saved, drafts, remote, ui, offline, load, editDraft, discard, save, reloadFromServer } =
    useDishes();

  return (
    <main className="container">
      <header className="header">
        <h1>Dish Dashboard</h1>
        <p className="muted">Edits stay local drafts until you press Save.</p>
      </header>

      {offline && status === "ready" && (
        <p className="notice notice--warn" role="status">
          Connection to the server lost. Retrying automatically; your drafts are safe.
        </p>
      )}

      {status === "loading" && <p className="state" role="status">Loading dishes…</p>}

      {status === "error" && (
        <div className="state" role="alert">
          <p>Couldn’t load dishes: {loadError}</p>
          <button type="button" className="btn btn--primary" onClick={load}>Try again</button>
        </div>
      )}

      {status === "ready" && order.length === 0 && (
        <p className="state">No dishes found. Run <code>npm run seed</code> in the backend folder.</p>
      )}

      {status === "ready" && order.length > 0 && (
        <ul className="grid">
          {order.map((id) => (
            <DishCard
              key={id}
              saved={saved[id]}
              draft={drafts[id]}
              remote={remote[id]}
              state={ui[id]}
              onEdit={(changes) => editDraft(id, changes)}
              onDiscard={() => discard(id)}
              onSave={() => save(id)}
              onReload={() => reloadFromServer(id)}
            />
          ))}
        </ul>
      )}
    </main>
  );
}

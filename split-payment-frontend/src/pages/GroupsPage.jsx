import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, clearToken } from "../api";

const styles = {
  container: {
    maxWidth: "720px",
    margin: "40px auto",
    padding: "24px",
    border: "1px solid #ddd",
    borderRadius: "8px",
    fontFamily: "Inter, system-ui, sans-serif",
  },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  list: { listStyle: "none", padding: 0, marginTop: "16px" },
  item: {
    padding: "12px 0",
    borderBottom: "1px solid #eee",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  itemButton: {
    background: "none",
    border: "none",
    padding: 0,
    margin: 0,
    textAlign: "left",
    cursor: "pointer",
    flex: 1,
  },
  button: {
    padding: "8px 14px",
    borderRadius: "6px",
    border: "none",
    background: "#2563eb",
    color: "white",
    cursor: "pointer",
    fontWeight: 600,
  },
  error: { color: "#b91c1c", marginTop: "12px", whiteSpace: "pre-wrap" },
  muted: { color: "#555" },
};

function formatError(err) {
  const code = err?.code || "HTTP_ERROR";
  const message = err?.message || "Request failed";
  return `${code}: ${message}`;
}

export default function GroupsPage() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [nameInput, setNameInput] = useState("");

  useEffect(() => {
    fetchGroups();
  }, []);

  async function fetchGroups() {
    try {
      setLoading(true);
      setError(null);
      const data = await api.groupsList();
      setGroups(Array.isArray(data) ? data : []);
    } catch (err) {
      setGroups([]);
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    try {
      setCreating(true);
      setError(null);
      await api.createGroup(trimmed);
      setNameInput("");
      await fetchGroups();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setCreating(false);
    }
  }

  function handleLogout() {
    clearToken();
    navigate("/login", { replace: true });
  }

  function openGroup(group) {
    navigate(`/groups/${group._id}`, { state: { name: group.name } });
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2>Grupy</h2>
        <div>
          <button style={{ ...styles.button, marginRight: "8px" }} onClick={fetchGroups} disabled={loading}>
            Odśwież
          </button>
          <button style={styles.button} onClick={handleLogout}>
            Wyloguj
          </button>
        </div>
      </div>

      <form onSubmit={handleCreate}>
        <label>
          Nazwa grupy
          <input
            style={styles.input}
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="np. Wakacje"
          />
        </label>
        <button style={styles.button} type="submit" disabled={creating || !nameInput.trim()}>
          {creating ? "Tworzenie..." : "Utwórz"}
        </button>
      </form>

      {loading && <p style={styles.muted}>Wczytywanie...</p>}

      {!loading && groups.length === 0 && !error && <p style={styles.muted}>Brak grup.</p>}

      {!loading && groups.length > 0 && (
        <ul style={styles.list}>
          {groups.map((g) => (
            <li key={g._id} style={styles.item}>
              <button style={styles.itemButton} onClick={() => openGroup(g)}>
                <div>{g.name}</div>
                <div style={styles.muted}>{g.isClosed ? "closed" : "open"}</div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <div style={styles.error}>{error}</div>}
    </div>
  );
}

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, getToken, setToken } from "../api";

const styles = {
  container: {
    maxWidth: "640px",
    margin: "40px auto",
    padding: "24px",
    border: "1px solid #ddd",
    borderRadius: "8px",
    fontFamily: "Inter, system-ui, sans-serif",
  },
  input: {
    width: "100%",
    padding: "8px 12px",
    marginBottom: "12px",
    borderRadius: "6px",
    border: "1px solid #ccc",
  },
  button: {
    padding: "10px 16px",
    borderRadius: "6px",
    border: "none",
    background: "#2563eb",
    color: "white",
    cursor: "pointer",
    fontWeight: 600,
  },
  error: {
    color: "#b91c1c",
    marginTop: "12px",
    whiteSpace: "pre-wrap",
  },
};

function formatError(err) {
  const code = err?.code || "HTTP_ERROR";
  const message = err?.message || "Request failed";
  return `${code}: ${message}`;
}

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("owner@example.com");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (getToken()) {
      navigate("/groups", { replace: true });
    }
  }, [navigate]);

  async function handleLogin(e) {
    e.preventDefault();
    try {
      setLoading(true);
      setError(null);
      const data = await api.login(email, password);
      setToken(data.token);
      navigate("/groups", { replace: true });
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.container}>
      <h2>Split Payment - Login</h2>
      <form onSubmit={handleLogin}>
        <label>
          Email
          <input
            style={styles.input}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Hasło
          <input
            style={styles.input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <button style={styles.button} type="submit" disabled={loading}>
          {loading ? "Logowanie..." : "Zaloguj"}
        </button>
      </form>
      {error && <div style={styles.error}>{error}</div>}
    </div>
  );
}

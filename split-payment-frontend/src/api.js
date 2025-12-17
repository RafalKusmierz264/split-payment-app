const API_URL = import.meta.env.VITE_API_URL || "";

const TOKEN_KEY = "splitpay_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function request(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-cache" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    cache: "no-store",
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data.message ||
      data.error ||
      (Array.isArray(data?.errors) ? JSON.stringify(data.errors) : null) ||
      res.statusText ||
      "Request failed";
    const err = new Error(msg);
    err.code = data.code || data.error || `HTTP_${res.status || "ERROR"}`;
    throw err;
  }
  return data;
}

export const api = {
  login(email, password) {
    return request(`/api/auth/login`, { method: "POST", body: { email, password } });
  },
  me() {
    return request(`/api/me`);
  },
  groupsList() {
    return request(`/api/groups`);
  },
  createGroup(name) {
    return request(`/api/groups`, { method: "POST", body: { name } });
  },
  groupDetails(groupId) {
    return request(`/api/groups/${groupId}`);
  },
  renameGroup(groupId, name) {
    return request(`/api/groups/${groupId}`, { method: "PATCH", body: { name } });
  },
  groupTimeline(groupId, { limit = 20, before } = {}) {
    const params = new URLSearchParams();
    if (limit) params.append("limit", String(limit));
    if (before) params.append("before", String(before));
    const qs = params.toString();
    const suffix = qs ? `?${qs}` : "";
    return request(`/api/groups/${groupId}/timeline${suffix}`);
  },
  addGroupMember(groupId, email) {
    return request(`/api/groups/${groupId}/members`, { method: "POST", body: { email } });
  },
  createExpense(groupId, payload) {
    return request(`/api/groups/${groupId}/expenses`, { method: "POST", body: payload });
  },
  groupExpenses(groupId) {
    return request(`/api/groups/${groupId}/expenses`);
  },
  groupBalance(groupId) {
    return request(`/api/groups/${groupId}/balance`);
  },
  groupTransfers(groupId) {
    return request(`/api/groups/${groupId}/transfers`);
  },
  createSettlement(groupId, payload) {
    return request(`/api/groups/${groupId}/settlements`, { method: "POST", body: payload });
  },
};

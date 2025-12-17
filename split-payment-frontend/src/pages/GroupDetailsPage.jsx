import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import {
  formatPLN,
  getExpenseDate,
  getId,
  isInCurrentMonth,
  isInCurrentWeek,
  userRoleLabel,
} from "../utils/groupUiUtils";
import {
  buildTimelineEventKey,
  buildTimelineSubtitleLines,
  extractTimelinePayload,
  getTimelineDisplayTitle,
} from "../utils/timelineUtils";

const styles = {
  container: {
    maxWidth: "720px",
    margin: "28px auto",
    padding: "18px",
    border: "1px solid #ddd",
    borderRadius: "8px",
    fontFamily: "Inter, system-ui, sans-serif",
  },
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  button: {
    padding: "6px 12px",
    borderRadius: "6px",
    border: "none",
    background: "#2563eb",
    color: "white",
    cursor: "pointer",
    fontWeight: 600,
  },
  error: { color: "#b91c1c", marginTop: "12px", whiteSpace: "pre-wrap" },
  muted: { color: "#555" },
  timeline: { marginTop: "16px" },
  timelineItem: { padding: "8px 0", borderBottom: "1px solid #eee" },
  subtitle: { color: "#555", fontSize: "0.9rem", lineHeight: "1.25" },
  timestamp: { color: "#666", fontSize: "0.85rem", marginTop: "2px", lineHeight: "1.2" },
  memberList: { listStyle: "none", padding: 0, margin: 0 },
  memberItem: { padding: "4px 0", borderBottom: "1px solid #eee" },
  formRow: { display: "flex", gap: "6px", marginTop: "6px", flexWrap: "wrap" },
  input: { padding: "6px 10px", borderRadius: "6px", border: "1px solid #ccc", minWidth: "220px" },
  select: { padding: "6px 10px", borderRadius: "6px", border: "1px solid #ccc", minWidth: "220px" },
};

function formatError(err) {
  const code = err?.code || "HTTP_ERROR";
  const message = err?.message || "Request failed";
  return `${code}: ${message}`;
}

function getRole(member) {
  if (!member) return null;
  const nestedUser = member.user || member.member || {};
  return member.role || member.userRole || member.membershipRole || nestedUser.role || nestedUser.userRole || null;
}

function extractUserIdFromMember(member) {
  if (!member) return undefined;
  const direct = member.userId || member.user_id || member.userID || member.accountId || member.userRef;
  if (typeof direct === "string" || typeof direct === "number") return String(direct);

  if (typeof member.user === "string" || typeof member.user === "number") return String(member.user);
  if (member.user && typeof member.user === "object") {
    const nested = member.user._id || member.user.id || member.user.userId;
    if (nested) return String(nested);
  }

  const nested =
    member.profile?.userId ||
    member.profile?.user?._id ||
    member.userInfo?._id;
  if (typeof nested === "string" || typeof nested === "number") return String(nested);

  return undefined;
}

function roleLabel(role) {
  const r = typeof role === "string" ? role.toLowerCase() : "";
  if (r === "owner" || r === "admin" || r === "administrator") return "Właściciel";
  if (r === "member") return "Użytkownik";
  if (r) return "Użytkownik";
  return "Użytkownik";
}

function resolvePayerRoleLabel(expense, ownerUserId) {
  const payerId = getId(expense?.paidByUserId ?? expense?.paidBy);
  if (!payerId) return "Nieznany";
  return userRoleLabel(payerId, ownerUserId);
}

export default function GroupDetailsPage() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const timelineRef = useRef(null);

  const [group, setGroup] = useState(null);
  const [titleName, setTitleName] = useState(() => location.state?.name || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [saving, setSaving] = useState(false);

  const [members, setMembers] = useState([]);
  const [memberEmail, setMemberEmail] = useState("");
  const [memberError, setMemberError] = useState(null);
  const [memberAdding, setMemberAdding] = useState(false);

  const [expenses, setExpenses] = useState([]);
  const [expensesLoading, setExpensesLoading] = useState(false);
  const [expensesError, setExpensesError] = useState(null);
  const [expenseDesc, setExpenseDesc] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expensePayerUserId, setExpensePayerUserId] = useState("");
  const [expenseError, setExpenseError] = useState(null);
  const [expenseAdding, setExpenseAdding] = useState(false);
  const [expenseSuccess, setExpenseSuccess] = useState("");
  const [expenseSummaryMode, setExpenseSummaryMode] = useState("week"); // "week" | "month"

  const [balances, setBalances] = useState([]);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [balancesError, setBalancesError] = useState(null);

  const [transfers, setTransfers] = useState([]);
  const [transfersLoading, setTransfersLoading] = useState(false);
  const [transfersError, setTransfersError] = useState(null);
  const [settlementSavingId, setSettlementSavingId] = useState(null);
  const [settlementMessage, setSettlementMessage] = useState("");
  const [settlementError, setSettlementError] = useState(null);

  const [showTimeline, setShowTimeline] = useState(false);
  const [timelineLoaded, setTimelineLoaded] = useState(false);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState(null);
  const [timelineEvents, setTimelineEvents] = useState([]);
  const [timelineNextBefore, setTimelineNextBefore] = useState(null);
  const [timelineLoadingMore, setTimelineLoadingMore] = useState(false);

  const { memberOptions, memberByMemberId, memberByUserId } = useMemo(() => {
    const normalized = [];
    const byMemberId = new Map();
    const byUserId = new Map();

    const pushMember = (raw, roleHint) => {
      const id = getId(raw);
      if (!id) return;
      const existing = byMemberId.get(id);
      const role = getRole(raw) || roleHint || existing?.role;
      const name = raw?.name || raw?.email || existing?.name;
      const userId = extractUserIdFromMember(raw) || existing?.userId;
      const normalizedMember = {
        ...(existing || {}),
        ...(typeof raw === "object" ? raw : {}),
        id,
        _id: raw?._id || existing?._id || id,
      };
      if (role) normalizedMember.role = role;
      if (name) normalizedMember.name = name;
      if (userId) normalizedMember.userId = userId;
      byMemberId.set(id, normalizedMember);
      if (userId) byUserId.set(userId, normalizedMember);
      if (!existing) normalized.push(normalizedMember);
      else {
        const idx = normalized.findIndex((m) => m.id === id);
        if (idx !== -1) normalized[idx] = normalizedMember;
      }
    };

    const fallbackMembers = Array.isArray(group?.members)
      ? group.members
      : Array.isArray(group?.memberIds)
        ? group.memberIds.map((id) => ({ id: String(id) }))
        : [];
    const rawMembers = Array.isArray(members) && members.length > 0 ? members : fallbackMembers;

    rawMembers.forEach((m) => pushMember(m));
    if (Array.isArray(group?.memberIds)) {
      group.memberIds.forEach((id) => pushMember({ _id: id }));
    }
    if (group?.owner) {
      pushMember(group.owner, getRole(group.owner) || "owner");
    } else if (group?.ownerId) {
      pushMember({ _id: group.ownerId, name: group.ownerName }, "owner");
    }

    return { memberOptions: normalized, memberByMemberId: byMemberId, memberByUserId: byUserId };
  }, [group, members]);

  const ownerUserId = useMemo(
    () => getId(group?.owner?._id || group?.ownerId || group?.owner?.id || group?.owner?.userId),
    [group],
  );

  const participantUserIds = useMemo(() => {
    const ids = (Array.isArray(balances) ? balances : []).map((b) => getId(b.userId)).filter(Boolean);
    const unique = [];
    const seen = new Set();
    ids.forEach((id) => {
      if (seen.has(id)) return;
      seen.add(id);
      unique.push(id);
    });
    return unique;
  }, [balances]);

  const headerTitle = titleName ? `Szczegóły grupy: ${titleName}` : "Szczegóły grupy";
  const membersCount = memberOptions.length;
  const latestExpenses = [...expenses]
    .sort((a, b) => new Date(b.createdAt || b.at || b.date || 0) - new Date(a.createdAt || a.at || a.date || 0))
    .slice(0, 3);
  const summarySum = useMemo(() => {
    return expenses
      .filter((e) => {
        const date = getExpenseDate(e);
        if (!date) return false;
        return expenseSummaryMode === "week" ? isInCurrentWeek(date) : isInCurrentMonth(date);
      })
      .reduce((acc, e) => acc + Number(e?.amount || 0), 0);
  }, [expenses, expenseSummaryMode]);

  const fetchGroup = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.groupDetails(groupId);
      const groupObj = data?.group ?? data;
      const membersList = Array.isArray(data?.members)
        ? data.members
        : Array.isArray(groupObj?.members)
          ? groupObj.members
          : null;
      setGroup(groupObj);
      if (groupObj?.name) setTitleName(groupObj.name);
      setNameInput(groupObj?.name || "");
      setMembers(membersList || []);
    } catch (err) {
      setGroup(null);
      setMembers([]);
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  const fetchExpenses = useCallback(async () => {
    try {
      setExpensesLoading(true);
      setExpensesError(null);
      const data = await api.groupExpenses(groupId);
      const list = Array.isArray(data?.expenses) ? data.expenses : [];
      setExpenses(list);
    } catch (err) {
      setExpenses([]);
      setExpensesError(formatError(err));
    } finally {
      setExpensesLoading(false);
    }
  }, [groupId]);

  const fetchBalances = useCallback(async () => {
    try {
      setBalancesLoading(true);
      setBalancesError(null);
      const data = await api.groupBalance(groupId);
      const balanceMap = data?.balance || data?.balances || {};
      const list = Object.entries(balanceMap).map(([userId, amount]) => ({ userId, amount: Number(amount) }));
      list.sort((a, b) => a.amount - b.amount);
      setBalances(list);
    } catch (err) {
      setBalances([]);
      setBalancesError(formatError(err));
    } finally {
      setBalancesLoading(false);
    }
  }, [groupId]);

  const fetchTransfers = useCallback(async () => {
    try {
      setTransfersLoading(true);
      setTransfersError(null);
      const data = await api.groupTransfers(groupId);
      const list = Array.isArray(data?.transfers) ? data.transfers : [];
      setTransfers(list);
    } catch (err) {
      setTransfers([]);
      setTransfersError(formatError(err));
    } finally {
      setTransfersLoading(false);
    }
  }, [groupId]);

  const fetchTimeline = useCallback(async () => {
    try {
      setTimelineLoading(true);
      setTimelineError(null);
      const data = await api.groupTimeline(groupId, { limit: 20 });
      const events = Array.isArray(data?.events) ? data.events : [];
      setTimelineEvents(events);
      setTimelineNextBefore(data?.nextBefore ?? null);
      setTimelineLoaded(true);
    } catch (err) {
      setTimelineEvents([]);
      setTimelineError(formatError(err));
    } finally {
      setTimelineLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    fetchGroup();
    fetchExpenses();
    fetchBalances();
    fetchTransfers();
    setTimelineEvents([]);
    setTimelineNextBefore(null);
    setTimelineError(null);
    setTimelineLoaded(false);
    setShowTimeline(false);
  }, [fetchBalances, fetchExpenses, fetchGroup, fetchTransfers]);

  useEffect(() => {
    if (showTimeline && !timelineLoaded) {
      fetchTimeline();
    }
  }, [fetchTimeline, showTimeline, timelineLoaded]);

  useEffect(() => {
    if (participantUserIds.length === 0) return;
    const exists = participantUserIds.includes(expensePayerUserId);
    if (!expensePayerUserId || !exists) {
      setExpensePayerUserId(participantUserIds[0]);
    }
  }, [expensePayerUserId, participantUserIds]);

  async function handleSaveName() {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    try {
      setSaving(true);
      setError(null);
      const updated = await api.renameGroup(groupId, trimmed);
      const updatedObj = updated?.group ?? updated;
      setGroup((prev) => ({ ...(prev || {}), ...updatedObj }));
      setTitleName(trimmed);
      setEditing(false);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setSaving(false);
    }
  }

  async function loadMoreTimeline() {
    if (!timelineNextBefore || timelineLoadingMore) return;
    try {
      setTimelineLoadingMore(true);
      setTimelineError(null);
      const data = await api.groupTimeline(groupId, { limit: 20, before: timelineNextBefore });
      const newEvents = Array.isArray(data?.events) ? data.events : [];
      const combined = [...timelineEvents];
      for (const ev of newEvents) {
        const id = ev?.id ?? `${ev.kind}-${ev.at}`;
        if (!combined.find((e) => (e?.id ?? `${e.kind}-${e.at}`) === id)) {
          combined.push(ev);
        }
      }
      setTimelineEvents(combined);
      setTimelineNextBefore(data?.nextBefore ?? null);
    } catch (err) {
      setTimelineError(formatError(err));
    } finally {
      setTimelineLoadingMore(false);
    }
  }

  async function handleAddMember(e) {
    e.preventDefault();
    const emailTrim = memberEmail.trim();
    if (!emailTrim) return;
    try {
      setMemberAdding(true);
      setMemberError(null);
      await api.addGroupMember(groupId, emailTrim);
      setMemberEmail("");
      await fetchGroup();
      await fetchExpenses();
    } catch (err) {
      setMemberError(formatError(err));
    } finally {
      setMemberAdding(false);
    }
  }

  async function handleAddExpense(e) {
    e.preventDefault();
    const desc = expenseDesc.trim();
    const amountNum = Number(expenseAmount);
    if (!desc || !amountNum || amountNum <= 0 || !expensePayerUserId || participantUserIds.length === 0) return;

    try {
      setExpenseAdding(true);
      setExpenseError(null);
      setExpenseSuccess("");

      const participantIds = participantUserIds;

      const payload = {
        title: desc,
        amount: amountNum,
        participantIds,
        paidByUserId: expensePayerUserId,
        paidBy: expensePayerUserId,
      };
      await api.createExpense(groupId, payload);

      setExpenseDesc("");
      setExpenseAmount("");
      setExpensePayerUserId(participantUserIds[0] || "");
      setExpenseSuccess("Dodano wydatek");

      await fetchGroup();
      await fetchExpenses();
      await fetchBalances();
      await fetchTransfers();
      if (showTimeline) await fetchTimeline();
    } catch (err) {
      setExpenseError(formatError(err));
    } finally {
      setExpenseAdding(false);
    }
  }

  const scrollToTimeline = () => {
    if (!showTimeline) setShowTimeline(true);
    setTimeout(() => {
      timelineRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  };

  const renderMembersAndBalance = () => (
    <>
      <div style={{ marginTop: "10px" }}>
        <h3 style={{ margin: "10px 0 6px" }}>Saldo</h3>
        {balancesLoading && <p style={styles.muted}>Wczytywanie sald...</p>}
        {!balancesLoading && balancesError && <div style={styles.error}>{balancesError}</div>}
        {!balancesLoading && !balancesError && balances.length === 0 && <p style={styles.muted}>Brak sald.</p>}
        {!balancesLoading && !balancesError && balances.length > 0 && (
          <div>
            {balances.map((b) => {
              const candidates = [b.userId, b.memberId, b.user, b.member];
              let member = null;
              for (const candidate of candidates) {
                const cid = getId(candidate);
                if (!cid) continue;
                member = memberByUserId.get(cid) || memberByMemberId.get(cid);
                if (member) break;
              }
                  const label = member ? roleLabel(member.role) : roleLabel();
                  return (
                    <div key={b.userId || b.memberId} style={{ padding: "4px 0" }}>
                      <span>
                        <strong>{label}</strong>
                      </span>
                      <span style={{ marginLeft: "8px" }}>{formatPLN(b.amount)}</span>
                    </div>
                  );
                })}
              </div>
            )}
      </div>

      <div style={{ marginTop: "10px" }}>
        <h3 style={{ margin: "10px 0 6px" }}>Członkowie - Liczba członków: {membersCount}</h3>
        {memberOptions.length > 0 ? (
          <ul style={styles.memberList}>
            {memberOptions.map((m) => (
              <li key={m.id} style={styles.memberItem}>
                <div>
                  <strong>{roleLabel(m.role)}</strong>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p style={styles.muted}>Brak szczegółów członków (tylko ID).</p>
        )}

        <form onSubmit={handleAddMember} style={{ marginTop: "10px" }}>
          <div style={styles.formRow}>
            <input
              style={styles.input}
              type="email"
              placeholder="email@przyklad.pl"
              value={memberEmail}
              onChange={(e) => setMemberEmail(e.target.value)}
              required
            />
            <button style={styles.button} type="submit" disabled={memberAdding || !memberEmail.trim()}>
              {memberAdding ? "Dodawanie..." : "Dodaj"}
            </button>
          </div>
          {memberError && <div style={styles.error}>{memberError}</div>}
        </form>
      </div>
    </>
  );

  const renderExpenseForm = () => (
    <>
      <form onSubmit={handleAddExpense}>
        <div style={styles.formRow}>
          <input
            style={styles.input}
            type="text"
            placeholder="Opis"
            value={expenseDesc}
            onChange={(e) => setExpenseDesc(e.target.value)}
            required
          />
          <input
            style={styles.input}
            type="number"
            step="0.01"
            min="0"
            placeholder="Kwota"
            value={expenseAmount}
            onChange={(e) => setExpenseAmount(e.target.value)}
            required
          />
          <select
            style={styles.select}
            value={expensePayerUserId}
            onChange={(e) => setExpensePayerUserId(e.target.value)}
            required
          >
            <option value="">Zapłaci...</option>
            {participantUserIds.map((uid) => (
              <option key={uid} value={uid}>
                {userRoleLabel(uid, ownerUserId)}
              </option>
            ))}
          </select>
          <button
            style={styles.button}
            type="submit"
            disabled={
              expenseAdding ||
              !expenseDesc.trim() ||
              !expenseAmount ||
              Number(expenseAmount) <= 0 ||
              !expensePayerUserId ||
              participantUserIds.length === 0
            }
          >
            {expenseAdding ? "Dodawanie..." : "Dodaj wydatek"}
          </button>
        </div>
      </form>
      {expenseError && <div style={styles.error}>{expenseError}</div>}
      {expenseSuccess && <div style={styles.muted}>{expenseSuccess}</div>}
    </>
  );

  const renderExpensesList = () => (
    <div style={{ marginTop: "12px" }}>
      <h4 style={{ margin: "10px 0 6px" }}>
        Wydatki (ostatnie {latestExpenses.length} z {expenses.length}){" "}
        <button
          type="button"
          onClick={scrollToTimeline}
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
            marginLeft: "8px",
            fontSize: "0.85rem",
            color: "#2563eb",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Zobacz w historii
        </button>
      </h4>
      {expensesLoading && <p style={styles.muted}>Wczytywanie wydatków...</p>}
      {!expensesLoading && expensesError && <div style={styles.error}>{expensesError}</div>}
      {!expensesLoading && !expensesError && expenses.length === 0 && <p style={styles.muted}>Brak wydatków.</p>}
      {!expensesLoading && !expensesError && expenses.length > 0 && (
        <div>
          {latestExpenses.map((ex) => {
            const payerRole = resolvePayerRoleLabel(ex, ownerUserId);
            const when = ex.createdAt || ex.at;
            const title = ex.description || ex.title || "(bez opisu)";
            return (
              <div key={ex._id || ex.id || ex.title} style={{ padding: "6px 0", borderBottom: "1px solid #eee" }}>
                <div>
                  <strong>{title}</strong>
                </div>
                <div style={styles.subtitle}>Kwota: {formatPLN(ex.amount)}</div>
                <div style={styles.subtitle}>Zapłacił(a): {payerRole}</div>
                {when && <div style={styles.timestamp}>{new Date(when).toLocaleString()}</div>}
              </div>
            );
          })}
          <div style={{ marginTop: "6px" }}>
            <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => setExpenseSummaryMode("week")}
                style={{
                  ...styles.button,
                  padding: "4px 8px",
                  fontSize: "0.85rem",
                  background: expenseSummaryMode === "week" ? styles.button.background : "#e5e7eb",
                  color: expenseSummaryMode === "week" ? styles.button.color : "#111827",
                }}
              >
                Tydzień
              </button>
              <button
                type="button"
                onClick={() => setExpenseSummaryMode("month")}
                style={{
                  ...styles.button,
                  padding: "4px 8px",
                  fontSize: "0.85rem",
                  background: expenseSummaryMode === "month" ? styles.button.background : "#e5e7eb",
                  color: expenseSummaryMode === "month" ? styles.button.color : "#111827",
                }}
              >
                Miesiąc
              </button>
            </div>
            <div style={{ ...styles.subtitle, marginTop: "4px", fontWeight: 600 }}>
              {expenseSummaryMode === "week"
                ? `Wydatki w tym tygodniu: ${formatPLN(summarySum)}`
                : `Wydatki w tym miesiącu: ${formatPLN(summarySum)}`}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderTransfers = () => (
    <div style={{ marginTop: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <h3 style={{ margin: 0 }}>Sugerowane przelewy</h3>
        <button style={{ ...styles.button, padding: "5px 9px" }} onClick={fetchTransfers} disabled={transfersLoading}>
          {transfersLoading ? "Odświeżam..." : "Odśwież przelewy"}
        </button>
      </div>
      {transfersLoading && <p style={styles.muted}>Wczytywanie przelewów...</p>}
      {!transfersLoading && transfersError && <div style={styles.error}>{transfersError}</div>}
      {!transfersLoading && !transfersError && transfers.length === 0 && (
        <p style={styles.muted}>Brak przelewów (wszyscy rozliczeni).</p>
      )}
      {!transfersLoading && !transfersError && transfers.length > 0 && (
        <div style={{ marginTop: "6px" }}>
          {transfers.map((t, idx) => {
            const fromRaw = t.fromUserId ?? t.fromMemberId ?? t.from;
            const toRaw = t.toUserId ?? t.toMemberId ?? t.to;
            const fromRoleLabel = userRoleLabel(fromRaw, ownerUserId);
            const toRoleLabel = userRoleLabel(toRaw, ownerUserId);
            const isSaving = settlementSavingId === (t.id || `${getId(fromRaw)}-${getId(toRaw)}-${idx}`);
            return (
              <div key={t.id || `${getId(fromRaw)}-${getId(toRaw)}-${idx}`} style={{ padding: "6px 0", borderBottom: "1px solid #eee" }}>
                <div>
                  <strong>{fromRoleLabel}</strong> → <strong>{toRoleLabel}</strong>: {formatPLN(t.amount)}
                </div>
                <button
                  style={{ ...styles.button, marginTop: "4px", padding: "5px 9px" }}
                  disabled={isSaving}
                  onClick={async () => {
                    if (!window.confirm("Na pewno oznaczyć jako opłacone?")) return;
                    const sid = t.id || `${getId(fromRaw)}-${getId(toRaw)}-${idx}`;
                    try {
                      setSettlementSavingId(sid);
                      setSettlementError(null);
                      setSettlementMessage("");
                      await api.createSettlement(groupId, {
                        fromUserId: t.fromUserId ?? getId(fromRaw),
                        toUserId: t.toUserId ?? getId(toRaw),
                        amount: t.amount,
                      });
                      setSettlementMessage("Zapisano settlement");
                      await fetchBalances();
                      await fetchTransfers();
                      if (showTimeline) await fetchTimeline();
                    } catch (err) {
                      setSettlementError(formatError(err));
                    } finally {
                      setSettlementSavingId(null);
                    }
                  }}
                >
                  {isSaving ? "Zapisywanie..." : "Oznacz jako opłacone"}
                </button>
              </div>
            );
          })}
          {settlementMessage && <div style={styles.muted}>{settlementMessage}</div>}
          {settlementError && <div style={styles.error}>{settlementError}</div>}
        </div>
      )}
    </div>
  );

  const renderTimeline = () => (
    <div style={styles.timeline} ref={timelineRef}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <h3 style={{ margin: 0 }}>Historia</h3>
        <button style={styles.button} onClick={() => setShowTimeline((v) => !v)}>
          {showTimeline ? "Ukryj historię" : "Pokaż historię"}
        </button>
      </div>
      {showTimeline && (
        <>
          {timelineLoading && <p style={styles.muted}>Wczytywanie historii...</p>}
          {!timelineLoading && timelineError && <div style={styles.error}>{timelineError}</div>}
          {!timelineLoading && !timelineError && timelineEvents.length === 0 && (
            <p style={styles.muted}>Brak wydarze‘".</p>
          )}
          {!timelineLoading && !timelineError && timelineEvents.length > 0 && (
            <div>
              {timelineEvents.map((ev, idx) => {
                const dateStr = ev?.at ? new Date(ev.at).toLocaleString() : "";
                const payload = extractTimelinePayload(ev);
                const eventKey = buildTimelineEventKey(ev, idx);
                const displayTitle = getTimelineDisplayTitle(ev, payload);
                const subtitleLines = buildTimelineSubtitleLines(ev, payload, ownerUserId);
                return (
                  <div key={eventKey} style={styles.timelineItem}>
                    <div>
                      <strong>{displayTitle}</strong>
                    </div>
                    {subtitleLines.length > 0 &&
                      subtitleLines.map((line, i) => (
                        <div key={`${eventKey}-sub-${i}`} style={styles.subtitle}>
                          {line}
                        </div>
                      ))}
                    {dateStr && <div style={styles.timestamp}>{dateStr}</div>}
                  </div>
                );
              })}
              {timelineNextBefore && (
                <button
                  style={{ ...styles.button, marginTop: "8px" }}
                  onClick={loadMoreTimeline}
                  disabled={timelineLoadingMore}
                >
                  {timelineLoadingMore ? "Ładowanie..." : "Pokaż więcej"}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <div style={styles.container}>
      <div style={styles.headerRow}>
        <h2>{headerTitle}</h2>
        <button style={styles.button} onClick={() => navigate("/groups")}>
          Powrót do listy
        </button>
      </div>

      {loading && <p style={styles.muted}>Wczytywanie...</p>}
      {!loading && error && <div style={styles.error}>{error}</div>}
      {!loading && !error && !group && <p style={styles.muted}>Nie znaleziono grupy.</p>}

      {!loading && group && (
        <div>
          {editing ? (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <input
                style={{ padding: "8px 12px", borderRadius: "6px", border: "1px solid " + "#ccc", minWidth: "260px" }}
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                disabled={saving}
              />
              <button style={styles.button} onClick={handleSaveName} disabled={saving || !nameInput.trim()}>
                {saving ? "Zapisywanie..." : "Zapisz"}
              </button>
              <button
                style={{ ...styles.button, background: "#6b7280" }}
                onClick={() => {
                  setEditing(false);
                  setNameInput(group.name || "");
                  setError(null);
                }}
                disabled={saving}
              >
                Anuluj
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <button style={{ ...styles.button, background: "#2563eb" }} onClick={() => setEditing(true)}>
                Zmień nazwę
              </button>
            </div>
          )}

          {renderMembersAndBalance()}

          <div style={{ marginTop: "16px" }}>
            <h3 style={{ margin: "10px 0 6px" }}>Wydatki</h3>
            {renderExpenseForm()}
            {renderExpensesList()}
          </div>

          {renderTransfers()}
        </div>
      )}

      {renderTimeline()}

    </div>
  );
}

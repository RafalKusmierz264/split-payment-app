export function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

export function formatPLN(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return "0,00 zł";
  return new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency: "PLN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

export function getExpenseDate(expense) {
  const raw = expense?.createdAt || expense?.at || expense?.date;
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export function isInCurrentWeek(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const day = start.getDay(); // 0 (Sun) .. 6 (Sat)
  const diffToMonday = (day + 6) % 7;
  start.setDate(start.getDate() - diffToMonday);

  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return date >= start && date < end;
}

export function isInCurrentMonth(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

export function getId(value) {
  if (!value) return null;
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") {
    const nestedUser = value.user || value.member || {};
    const rawId =
      value._id || value.id || value.userId || value.memberId || nestedUser._id || nestedUser.id || nestedUser.userId;
    return rawId ? String(rawId) : null;
  }
  return null;
}

export function userRoleLabel(userId, ownerUserId) {
  const uid = getId(userId);
  const oid = getId(ownerUserId);
  if (oid && uid && uid === oid) return "Właściciel";
  return "Użytkownik";
}

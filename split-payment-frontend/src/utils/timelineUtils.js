import { formatPLN, getId, userRoleLabel } from "./groupUiUtils.js";

export function buildTimelineEventKey(ev, idx) {
  return ev?._id || `${ev?.kind || ev?.type || "event"}-${ev?.at || ev?.createdAt || "time"}-${idx}`;
}

export function extractTimelinePayload(ev) {
  return ev?.payload ?? ev?.entity?.payload ?? {};
}

export function getTimelineDisplayTitle(ev, payload) {
  const hasFrom = Boolean(getId(payload?.fromUserId) ?? payload?.fromUserId);
  const hasTo = Boolean(getId(payload?.toUserId) ?? payload?.toUserId);
  if (ev?.kind === "settlement_created" || (hasFrom && hasTo)) return "Rozliczenie";
  return ev?.title;
}

export function buildTimelineSubtitleLines(ev, payload, ownerUserId) {
  const oldName = payload?.before?.name;
  const newName = payload?.after?.name;

  const fromId = payload?.fromUserId;
  const toId = payload?.toUserId;

  const isExpenseEvent =
    ev?.kind === "expense_created" || ev?.kind === "expense_deleted" || ev?.kind === "expense_updated";
  const isSettlementEvent = ev?.kind === "settlement_created" || ev?.kind === "settlement_updated";

  if (isExpenseEvent) {
    const amount = payload?.amount ?? payload?.after?.amount ?? payload?.expense?.amount;
    const payerId =
      payload?.paidByUserId ?? payload?.paidBy ?? payload?.after?.paidByUserId ?? payload?.after?.paidBy;
    const payerRole = userRoleLabel(payerId, ownerUserId);

    if (amount !== undefined && amount !== null && `${amount}` !== "") {
      return [`Kwota: ${formatPLN(amount)}`, `Zapłacił(a): ${payerRole}`];
    }
    return [];
  }

  if (oldName && newName) return [`${oldName} -> ${newName}`];

  if ((isSettlementEvent || (fromId && toId)) && fromId && toId) {
    return [`${userRoleLabel(fromId, ownerUserId)} -> ${userRoleLabel(toId, ownerUserId)}`];
  }

  const subtitleText = ev?.subtitle || "";
  if (subtitleText) return [subtitleText];

  const fromRole = userRoleLabel(payload?.fromUserId ?? payload?.fromMemberId ?? payload?.from, ownerUserId);
  const toRole = userRoleLabel(payload?.toUserId ?? payload?.toMemberId ?? payload?.to, ownerUserId);
  if (fromRole !== "Nieznany" && toRole !== "Nieznany") return [`${fromRole} -> ${toRole}`];

  return [];
}

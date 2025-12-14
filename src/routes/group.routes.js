console.log("✅ LOADED group.routes.js (v3)");
const express = require("express");
const { z } = require("zod");
const mongoose = require("mongoose");
const auth = require("../middleware/auth");
const Group = require("../models/Group");
const User = require("../models/User");
const Expense = require("../models/Expense");
const Settlement = require("../models/Settlement");
const AuditEvent = require("../models/AuditEvent");
const { parseIncludeDeleted, assertGroupActive, assertGroupOpen } = require("../utils/groupHelpers");
const { calculateGroupFinancials } = require("../utils/calculateGroupFinancials");

const router = express.Router();
const validateObjectId = (id) => mongoose.Types.ObjectId.isValid(String(id));

// wszystkie endpointy chronione
router.use(auth);
router.get("/ping", (req, res) => {
  res.json({ ok: true, message: "group.routes działa ✅" });
});

/**
 * GET /api/groups
 * lista grup zalogowanego użytkownika
 */
router.get("/", async (req, res) => {
  const userId = req.user.userId;
  const includeDeleted = parseIncludeDeleted(req.query.includeDeleted);

  const groups = await Group.find({
    memberIds: userId,
    ...(includeDeleted ? {} : { isDeleted: { $ne: true } })
  }).sort({ createdAt: -1 });

  const filtered = includeDeleted
    ? groups.filter((g) => !g.isDeleted || String(g.ownerId) === String(userId))
    : groups;

  const withClosedFlag = filtered.map((g) => ({
    ...g.toObject(),
    isClosed: Boolean(g.closedAt)
  }));

  res.json(withClosedFlag);
});

/**
 * POST /api/groups
 * utworzenie nowej grupy
 */
router.post("/", async (req, res) => {
  try {
    const schema = z.object({
      name: z.string().min(2)
    });

    const data = schema.parse(req.body);
    const userId = req.user.userId;

    const group = await Group.create({
      name: data.name,
      ownerId: userId,
      memberIds: [userId]
    });

    res.status(201).json(group);
  } catch (err) {
    res.status(400).json({ error: err.errors || err.message });
  }
});

// --- GROUP DETAILS + FINANCIALS ---
router.get("/:groupId", async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.userId;

    if (!validateObjectId(groupId)) {
      return res.status(400).json({ error: "Invalid groupId" });
    }

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const isMember = group.memberIds.map(String).includes(String(userId));
    if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

    const includeDeleted = parseIncludeDeleted(req.query.includeDeleted);
    const guard = assertGroupActive(group, userId, includeDeleted);
    if (!guard.ok) return res.status(guard.status).json({ error: guard.error });

    const members = await User.find({ _id: { $in: group.memberIds } }).select("name email");

    const { balanceMap, transfers, settlements, group: calcGroup } = await calculateGroupFinancials({
      groupId,
      includeDeleted,
    });

    const groupForMembers = calcGroup || group;
    const membersLookup = members.reduce((acc, m) => {
      acc[String(m._id)] = { id: String(m._id), name: m.name, email: m.email };
      return acc;
    }, {});

    const balanceDetailed = groupForMembers.memberIds.map((mid) => {
      const id = String(mid);
      return {
        user: membersLookup[id] ?? { id },
        balance: balanceMap[id] ?? 0,
      };
    });

    const transfersDetailed = transfers.map((t) => ({
      from: membersLookup[String(t.fromUserId)] ?? { id: String(t.fromUserId) },
      to: membersLookup[String(t.toUserId)] ?? { id: String(t.toUserId) },
      amount: t.amount,
    }));

    const settlementsDetailed = settlements.map((s) => ({
      id: String(s._id),
      groupId: String(s.groupId),
      from: membersLookup[String(s.fromUserId)] ?? { id: String(s.fromUserId) },
      to: membersLookup[String(s.toUserId)] ?? { id: String(s.toUserId) },
      amount: Number(s.amount),
      note: s.note || "",
      createdBy: membersLookup[String(s.createdByUserId)] ?? { id: String(s.createdByUserId) },
      createdAt: s.createdAt,
    }));

    res.json({
      group: {
        ...group.toObject(),
        id: String(group._id),
        isClosed: Boolean(group.closedAt),
      },
      members: members.map((m) => ({
        id: String(m._id),
        name: m.name,
        email: m.email,
      })),
      financials: {
        balances: balanceMap,
        summary: {
          balanceDetailed,
          transfersDetailed,
          settlementsDetailed,
        },
        transfers,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/groups/:groupId/members
 * dodaj członka po emailu
 */
router.post("/:groupId/members", async (req, res) => {
  try {
    const schema = z.object({
      email: z.string().email()
    });

    const data = schema.parse(req.body);

    const userId = req.user.userId;
    const { groupId } = req.params;

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const guard = assertGroupActive(group, userId, false);
    if (!guard.ok) return res.status(guard.status).json({ error: guard.error });

    // tylko członek grupy może dodawać
    const isMember = group.memberIds.map(String).includes(String(userId));
    if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

    const userToAdd = await User.findOne({ email: data.email.toLowerCase().trim() });
    if (!userToAdd) return res.status(404).json({ error: "User not found" });

    const already = group.memberIds.map(String).includes(String(userToAdd._id));
    if (!already) {
      group.memberIds.push(userToAdd._id);
      await group.save();
    }

    res.json(group);
  } catch (err) {
    res.status(400).json({ error: err.errors || err.message });
  }
});

// --- GROUP SOFT-DELETE ---
router.delete("/:groupId", async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.userId;

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ error: "Group not found" });

    if (String(group.ownerId) !== String(userId)) {
      return res.status(403).json({ error: "Only group owner can delete the group" });
    }

    if (group.isDeleted) {
      return res.json(group);
    }

    group.isDeleted = true;
    group.deletedAt = new Date();
    await group.save();

    res.json(group);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- GROUP RESTORE ---
router.post("/:groupId/restore", async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.userId;

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ error: "Group not found" });

    if (String(group.ownerId) !== String(userId)) {
      return res.status(403).json({ error: "Only group owner can restore the group" });
    }

    if (!group.isDeleted) {
      return res.json(group);
    }

    group.isDeleted = false;
    group.deletedAt = null;
    await group.save();

    res.json(group);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- GROUP UPDATE (rename) ---
router.patch("/:groupId", async (req, res) => {
  try {
    const schema = z.object({
      name: z.string().trim().min(2),
    });

    const data = schema.parse(req.body);
    const { groupId } = req.params;
    const userId = req.user.userId;

    if (!validateObjectId(groupId)) {
      return res.status(400).json({ error: "Invalid groupId" });
    }

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const guard = assertGroupActive(group, userId, false);
    if (!guard.ok) return res.status(guard.status).json({ error: guard.error });

    const isMember = group.memberIds.map(String).includes(String(userId));
    if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

    const guardOpen = assertGroupOpen(group);
    if (!guardOpen.ok) {
      return res.status(guardOpen.status).json({ error: guardOpen.error, message: guardOpen.message });
    }

    const oldName = group.name;
    const newName = data.name.trim();

    if (oldName === newName) {
      return res.json(group);
    }

    group.name = newName;
    await group.save();

    await AuditEvent.create({
      groupId,
      kind: "group_updated",
      entityId: groupId,
      entityType: "group",
      actorUserId: userId,
      payload: {
        before: { name: oldName },
        after: { name: newName },
      },
      at: new Date(),
    });

    res.json(group);
  } catch (err) {
    res.status(400).json({ error: err.errors || err.message });
  }
});

// --- TIMELINE ---
router.get("/:groupId/timeline", async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.userId;
    const { type, action } = req.query || {};

    const validTypes = new Set(["expense", "settlement", "group"]);
    const validActions = new Set(["created", "deleted", "restored", "closed", "reopened", "updated"]);

    if (type && !validTypes.has(String(type))) {
      return res.status(400).json({ error: "Invalid type. Allowed: expense, settlement, group" });
    }
    if (action && !validActions.has(String(action))) {
      return res
        .status(400)
        .json({ error: "Invalid action. Allowed: created, deleted, restored, closed, reopened" });
    }

    const rawLimit = Number(req.query.limit ?? 50);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;
    const beforeParam = req.query.before ? new Date(req.query.before) : null;
    const beforeDate = beforeParam && !isNaN(beforeParam.getTime()) ? beforeParam : null;

    if (!validateObjectId(groupId)) {
      return res.status(400).json({ error: "Invalid groupId" });
    }

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const isMember = group.memberIds.map(String).includes(String(userId));
    if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

    const includeDeleted = parseIncludeDeleted(req.query.includeDeleted);
    const guard = assertGroupActive(group, userId, includeDeleted);
    if (!guard.ok) return res.status(guard.status).json({ error: guard.error });

    const [expenses, settlements] = await Promise.all([
      Expense.find({ groupId }),
      Settlement.find({ groupId }),
    ]);

    const events = [];

    const auditRenameEvents = await AuditEvent.find({ groupId, kind: "group_updated" }).sort({ at: -1 });

    if (group.closedAt) {
      events.push({
        at: group.closedAt,
        entityId: String(groupId),
        kind: "group_closed",
        title: "Group closed",
        subtitle: group.name,
        actorUserId: group.closedByUserId ? String(group.closedByUserId) : null,
        payload: { name: group.name },
        groupId: String(groupId),
      });
    }

    if (group.reopenedAt) {
      events.push({
        at: group.reopenedAt,
        entityId: String(groupId),
        kind: "group_reopened",
        title: "Group reopened",
        subtitle: group.name,
        actorUserId: group.reopenedByUserId ? String(group.reopenedByUserId) : null,
        payload: { name: group.name },
        groupId: String(groupId),
      });
    }

    for (const ev of auditRenameEvents) {
      events.push({
        at: ev.at || ev.createdAt,
        entityId: String(ev.entityId || groupId),
        kind: "group_updated",
        title: "Group renamed",
        subtitle: group.name,
        actorUserId: ev.actorUserId ? String(ev.actorUserId) : null,
        payload: ev.payload || {},
        groupId: String(groupId),
      });
    }

    for (const exp of expenses) {
      const meta = {
        title: exp.title,
        amount: Number(exp.amount),
        paidByUserId: exp.paidByUserId ? String(exp.paidByUserId) : null,
      };
      events.push({
        at: exp.createdAt,
        entityId: String(exp._id),
        kind: "expense_created",
        title: `${meta.title} — ${meta.amount}`,
        subtitle: meta.paidByUserId ? `Paid by ${meta.paidByUserId}` : "Paid",
        actorUserId: meta.paidByUserId,
        payload: meta,
        expenseId: String(exp._id),
        groupId: String(groupId),
      });

      if (exp.isDeleted && exp.deletedAt) {
        events.push({
          at: exp.deletedAt,
          entityId: String(exp._id),
          kind: "expense_deleted",
          title: `${meta.title} — ${meta.amount}`,
          subtitle: "Deleted",
          actorUserId: exp.deletedByUserId ? String(exp.deletedByUserId) : null,
          payload: meta,
          expenseId: String(exp._id),
          groupId: String(groupId),
        });
      }

      if (exp.restoredAt) {
        events.push({
          at: exp.restoredAt,
          entityId: String(exp._id),
          kind: "expense_restored",
          title: `${meta.title} — ${meta.amount}`,
          subtitle: "Restored",
          actorUserId: exp.restoredByUserId ? String(exp.restoredByUserId) : null,
          payload: meta,
          expenseId: String(exp._id),
          groupId: String(groupId),
        });
      }
    }

    for (const s of settlements) {
      const meta = {
        fromUserId: s.fromUserId ? String(s.fromUserId) : null,
        toUserId: s.toUserId ? String(s.toUserId) : null,
        amount: Number(s.amount),
        note: s.note || "",
      };
      const baseTitle = `${meta.fromUserId || "From"} → ${meta.toUserId || "To"}`;
      const baseSubtitle = meta.note ? `${meta.amount} — ${meta.note}` : `${meta.amount}`;

      events.push({
        at: s.createdAt,
        entityId: String(s._id),
        kind: "settlement_created",
        title: baseTitle,
        subtitle: baseSubtitle,
        actorUserId: s.createdByUserId ? String(s.createdByUserId) : null,
        payload: meta,
        settlementId: String(s._id),
        groupId: String(groupId),
      });

      if (s.isDeleted && s.deletedAt) {
        events.push({
          at: s.deletedAt,
          entityId: String(s._id),
          kind: "settlement_deleted",
          title: baseTitle,
          subtitle: "Deleted",
          actorUserId: s.deletedByUserId ? String(s.deletedByUserId) : null,
          payload: meta,
          settlementId: String(s._id),
          groupId: String(groupId),
        });
      }

      if (s.restoredAt) {
        events.push({
          at: s.restoredAt,
          entityId: String(s._id),
          kind: "settlement_restored",
          title: baseTitle,
          subtitle: "Restored",
          actorUserId: s.restoredByUserId ? String(s.restoredByUserId) : null,
          payload: meta,
          settlementId: String(s._id),
          groupId: String(groupId),
        });
      }
    }

    events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

    let filtered = events;
    if (type) filtered = filtered.filter((e) => e.kind.startsWith(type));
    if (action) filtered = filtered.filter((e) => e.kind.endsWith(action));
    if (beforeDate) filtered = filtered.filter((e) => new Date(e.at).getTime() < beforeDate.getTime());

    const normalizeTimelineItem = (raw) => {
      const base = raw && typeof raw === "object" ? raw : {};
      const kind = String(base.kind || `${base.type || "unknown"}_${base.action || "event"}`);
      const atRaw = base.at || base.createdAt || base.updatedAt || new Date().toISOString();
      const atDate = new Date(atRaw);
      const at = isNaN(atDate.getTime()) ? new Date().toISOString() : atDate.toISOString();

      const payload = base && typeof base.payload === "object" && base.payload !== null ? base.payload : {};

      const entityIdCandidate =
        base.entity?.id ||
        base.entityId ||
        base.expenseId ||
        base.settlementId ||
        base.groupId ||
        "";

      const isGroupKind = kind.startsWith("group_") || kind === "group";
      const isExpenseKind = kind.startsWith("expense_");
      const isSettlementKind = kind.startsWith("settlement_");

      const entityType = isGroupKind ? "group" : isExpenseKind ? "expense" : isSettlementKind ? "settlement" : "group";
      const entityId =
        entityType === "group"
          ? String(base.entityId || base.groupId || entityIdCandidate || groupId)
          : String(entityIdCandidate || "");

      const actorCandidate =
        base.actorUserId != null
          ? base.actorUserId
          : base.actor && typeof base.actor === "object"
          ? base.actor.id || base.actor._id || base.actor.userId
          : null;
      const actorUserId = actorCandidate ? String(actorCandidate) : null;

      const computedId =
        base.id ??
        base._id ??
        (base.entity && base.entity.id) ??
        base.entityId ??
        base.expenseId ??
        base.settlementId ??
        base.groupId ??
        `${kind}:${entityId || "na"}:${new Date(at).getTime()}`;

      const result = {
        ...base,
        kind,
        at,
        title: base.title ?? "",
        subtitle: base.subtitle ?? null,
        payload,
        entity: {
          type: entityType,
          id: entityId,
          title: base.title ?? "",
          subtitle: base.subtitle ?? null,
          payload,
        },
        actorUserId,
        id: String(computedId),
      };

      if (typeof result.id !== "string") {
        result.id = String(result.id ?? "");
      }

      return result;
    };

    const normalizedEvents = (filtered || []).filter(Boolean).slice(0, limit).map(normalizeTimelineItem);
    const nextBefore = normalizedEvents.length > 0 ? normalizedEvents[normalizedEvents.length - 1].at : null;

    res.json({
      groupId: String(groupId),
      count: normalizedEvents.length,
      events: normalizedEvents,
      nextBefore,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

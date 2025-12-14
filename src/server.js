console.log("✅ START server.js", new Date().toISOString());

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const auth = require("./middleware/auth");

const User = require("./models/User");
const Group = require("./models/Group");
const Expense = require("./models/Expense");
const Settlement = require("./models/Settlement");
const { parseIncludeDeleted, assertGroupActive } = require("./utils/groupHelpers");
const { calculateGroupFinancials } = require("./utils/calculateGroupFinancials");

const groupRoutes = require("./routes/group.routes");

const app = express();
app.use(cors());
app.use(express.json());

// ładny błąd gdy JSON jest popsuty
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  next(err);
});

// --- helpers ---
function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function validateObjectId(id) {
  return mongoose.Types.ObjectId.isValid(String(id));
}

// ✅ aktywne settlements = takie które NIE są soft-deleted
function activeSettlementsQuery(groupId) {
  return { groupId, isDeleted: { $ne: true } };
}

// ✅ aktywne expenses = takie które NIE są soft-deleted
function activeExpensesQuery(groupId) {
  return { groupId, isDeleted: { $ne: true } };
}

// zastosuj rozliczenia do salda:
// from płaci to -> from: +amount (zmniejsza dług), to: -amount (zmniejsza należność)
function applySettlementsToBalance(balance, settlements) {
  for (const s of settlements) {
    const from = String(s.fromUserId);
    const to = String(s.toUserId);
    const amt = Number(s.amount);

    balance[from] = (balance[from] ?? 0) + amt;
    balance[to] = (balance[to] ?? 0) - amt;
  }
}

// --- TRANSFERS (kto komu ile) ---
function calculateTransfers(balanceMap) {
  const creditors = [];
  const debtors = [];

  for (const [userId, balRaw] of Object.entries(balanceMap)) {
    const bal = round2(balRaw);
    if (bal > 0) creditors.push({ userId, amount: bal });
    if (bal < 0) debtors.push({ userId, amount: -bal });
  }

  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  const transfers = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i];
    const c = creditors[j];

    const pay = Math.min(d.amount, c.amount);
    if (pay > 0) {
      transfers.push({
        fromUserId: d.userId,
        toUserId: c.userId,
        amount: round2(pay),
      });

      d.amount = round2(d.amount - pay);
      c.amount = round2(c.amount - pay);
    }

    if (d.amount === 0) i++;
    if (c.amount === 0) j++;
  }

  return transfers;
}

// ile from jest winien to na podstawie transfers
function getOwedAmount(transfers, fromUserId, toUserId) {
  const f = String(fromUserId);
  const t = String(toUserId);
  const hit = transfers.find((x) => String(x.fromUserId) === f && String(x.toUserId) === t);
  return hit ? Number(hit.amount) : 0;
}

// --- BASIC ---
app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Backend działa ✅" });
});

app.post("/api/test-post", (req, res) => {
  res.json({ ok: true, received: req.body });
});

// --- AUTH ---
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Missing name/email/password" });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 chars" });
    }

    const emailNorm = String(email).toLowerCase().trim();
    const exists = await User.findOne({ email: emailNorm });
    if (exists) return res.status(409).json({ error: "Email already exists" });

    const passwordHash = await bcrypt.hash(String(password), 10);

    const user = await User.create({
      name: String(name).trim(),
      email: emailNorm,
      passwordHash,
    });

    return res.status(201).json({
      id: String(user._id),
      name: user.name,
      email: user.email,
    });
  } catch (err) {
    console.error("REGISTER ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: "Missing email or password" });
    }

    const user = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const ok = await bcrypt.compare(String(password), user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { userId: String(user._id), email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({
      token,
      user: {
        id: String(user._id),
        name: user.name,
        email: user.email,
      },
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/me", auth, async (req, res) => {
  const user = await User.findById(req.user.userId).select("-passwordHash");
  res.json(user);
});

// --- GROUPS router ---
app.use("/api/groups", groupRoutes);

// (opcjonalny) ping grup – zostawiamy, bo pomaga w testach
app.get("/api/groups/ping", auth, (req, res) => {
  res.json({ ok: true, message: "PING z server.js działa ✅" });
});

// --- MEMBERS ---
app.post("/api/groups/:groupId/members", auth, async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "Missing email" });

    const { groupId } = req.params;
    const userId = req.user.userId;

    if (!validateObjectId(groupId)) {
      return res.status(400).json({ error: "Invalid groupId" });
    }

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const isMember = group.memberIds.map(String).includes(String(userId));
    if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

    const guard = assertGroupActive(group, userId, false);
    if (!guard.ok) return res.status(guard.status).json({ error: guard.error });

    const userToAdd = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (!userToAdd) return res.status(404).json({ error: "User not found" });

    const already = group.memberIds.map(String).includes(String(userToAdd._id));
    if (!already) {
      group.memberIds.push(userToAdd._id);
      await group.save();
    }

    res.json(group);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- EXPENSES ---
app.post("/api/groups/:groupId/expenses", auth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.userId;

    if (!validateObjectId(groupId)) {
      return res.status(400).json({ error: "Invalid groupId" });
    }

    const { title, amount, participantIds } = req.body || {};
    if (!title || amount == null) {
      return res.status(400).json({ error: "Missing title or amount" });
    }

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const isMember = group.memberIds.map(String).includes(String(userId));
    if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

    const guard = assertGroupActive(group, userId, false);
    if (!guard.ok) return res.status(guard.status).json({ error: guard.error });

    const participants =
      Array.isArray(participantIds) && participantIds.length > 0
        ? participantIds.map(String)
        : group.memberIds.map(String);

    const groupMembers = new Set(group.memberIds.map(String));
    for (const pid of participants) {
      if (!groupMembers.has(String(pid))) {
        return res.status(400).json({ error: "participantIds contains non-member userId" });
      }
    }

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: "Amount must be a positive number" });
    }

    const shareRaw = amt / participants.length;
    const shares = participants.map((pid) => ({
      userId: pid,
      share: round2(shareRaw),
    }));

    const sumShares = round2(shares.reduce((s, x) => s + x.share, 0));
    const diff = round2(amt - sumShares);
    if (diff !== 0) {
      shares[0].share = round2(shares[0].share + diff);
    }

    const expense = await Expense.create({
      groupId,
      paidByUserId: userId,
      title: String(title).trim(),
      amount: amt,
      splits: shares,
      // soft-delete pola mają defaulty w schemacie Expense
    });

    res.status(201).json(expense);
  } catch (err) {
    console.error("EXPENSE CREATE ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// domyślnie: tylko aktywne
// opcjonalnie: ?includeDeleted=true -> pokaż też usunięte
app.get("/api/groups/:groupId/expenses", auth, async (req, res) => {
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
    const query = includeDeleted ? { groupId } : activeExpensesQuery(groupId);

    const expenses = await Expense.find(query).sort({ createdAt: -1 });
    res.json(expenses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- EXPENSE SOFT-DELETE ---
app.delete("/api/groups/:groupId/expenses/:expenseId", auth, async (req, res) => {
  try {
    const { groupId, expenseId } = req.params;
    const userId = req.user.userId;

    if (!validateObjectId(groupId) || !validateObjectId(expenseId)) {
      return res.status(400).json({ error: "Invalid groupId or expenseId" });
    }

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const isMember = group.memberIds.map(String).includes(String(userId));
    if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

    const guard = assertGroupActive(group, userId, false);
    if (!guard.ok) return res.status(guard.status).json({ error: guard.error });

    const expense = await Expense.findById(expenseId);
    if (!expense) return res.status(404).json({ error: "Expense not found" });

    if (String(expense.groupId) !== String(groupId)) {
      return res.status(400).json({ error: "Expense does not belong to this group" });
    }

    // kto może usuwać: owner grupy albo osoba która zapłaciła (paidByUserId)
    const isOwner = String(group.ownerId) === String(userId);
    const isPayer = String(expense.paidByUserId) === String(userId);
    if (!isOwner && !isPayer) {
      return res.status(403).json({ error: "Not allowed to delete this expense" });
    }

    // idempotencja
    if (expense.isDeleted === true) {
      return res.json({
        ok: true,
        alreadyDeleted: true,
        deletedExpenseId: String(expenseId),
        deletedAt: expense.deletedAt ?? null,
      });
    }

    const hasActiveSettlements = await Settlement.exists({
      groupId: expense.groupId,
      isDeleted: { $ne: true },
    });
    if (hasActiveSettlements) {
      return res.status(409).json({
        error: "EXPENSE_DELETE_BLOCKED",
        message: "Cannot delete expense because there are active settlements in this group.",
      });
    }

    expense.isDeleted = true;
    expense.deletedAt = new Date();
    expense.deletedByUserId = userId;
    await expense.save();

    res.json({
      ok: true,
      deletedExpenseId: String(expenseId),
      deletedAt: expense.deletedAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- EXPENSE RESTORE ---
app.post("/api/groups/:groupId/expenses/:expenseId/restore", auth, async (req, res) => {
  try {
    const { groupId, expenseId } = req.params;
    const userId = req.user.userId;

    if (!validateObjectId(groupId) || !validateObjectId(expenseId)) {
      return res.status(400).json({ error: "Invalid groupId or expenseId" });
    }

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const isMember = group.memberIds.map(String).includes(String(userId));
    if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

    const guard = assertGroupActive(group, userId, false);
    if (!guard.ok) return res.status(guard.status).json({ error: guard.error });

    const expense = await Expense.findById(expenseId);
    if (!expense) return res.status(404).json({ error: "Expense not found" });

    if (String(expense.groupId) !== String(groupId)) {
      return res.status(400).json({ error: "Expense does not belong to this group" });
    }

    // kto może przywrócić: owner grupy albo payer
    const isOwner = String(group.ownerId) === String(userId);
    const isPayer = String(expense.paidByUserId) === String(userId);
    if (!isOwner && !isPayer) {
      return res.status(403).json({ error: "Not allowed to restore this expense" });
    }

    if (!expense.isDeleted) {
      return res.status(400).json({ error: "Expense is not deleted" });
    }

    expense.isDeleted = false;
    expense.deletedAt = null;
    expense.deletedByUserId = null;
    expense.restoredAt = new Date();
    expense.restoredByUserId = userId;
    await expense.save();

    res.json({ ok: true, restoredExpenseId: String(expenseId) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// --- BALANCE ---
app.get("/api/groups/:groupId/balance", auth, async (req, res) => {
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

    const { balanceMap } = await calculateGroupFinancials({ groupId, includeDeleted });

    res.json({ groupId, balance: balanceMap });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/groups/:groupId/transfers", auth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.userId;

    if (!validateObjectId(groupId)) return res.status(400).json({ error: "Invalid groupId" });

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const isMember = group.memberIds.map(String).includes(String(userId));
    if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

    const includeDeleted = parseIncludeDeleted(req.query.includeDeleted);
    const guard = assertGroupActive(group, userId, includeDeleted);
    if (!guard.ok) return res.status(guard.status).json({ error: guard.error });

    const { balanceMap, transfers } = await calculateGroupFinancials({ groupId, includeDeleted });

    res.json({ groupId, transfers, balance: balanceMap });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/groups/:groupId/transfers-detailed", auth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.userId;

    if (!validateObjectId(groupId)) return res.status(400).json({ error: "Invalid groupId" });

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const isMember = group.memberIds.map(String).includes(String(userId));
    if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

    const includeDeleted = parseIncludeDeleted(req.query.includeDeleted);
    const guard = assertGroupActive(group, userId, includeDeleted);
    if (!guard.ok) return res.status(guard.status).json({ error: guard.error });

    const { transfers, group: calcGroup } = await calculateGroupFinancials({ groupId, includeDeleted });
    const groupForMembers = calcGroup || group;

    const memberUsers = await User.find({ _id: { $in: groupForMembers.memberIds } }).select("name email");
    const byId = {};
    for (const u of memberUsers) byId[String(u._id)] = { id: String(u._id), name: u.name, email: u.email };

    const detailed = transfers.map((t) => ({
      from: byId[String(t.fromUserId)] ?? { id: String(t.fromUserId) },
      to: byId[String(t.toUserId)] ?? { id: String(t.toUserId) },
      amount: t.amount,
    }));

    res.json({ groupId, transfers: detailed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- SUMMARY (dashboard in 1 request) ---
app.get("/api/groups/:groupId/summary", auth, async (req, res) => {
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

    const { settlements, balanceMap, transfers, group: calcGroup } = await calculateGroupFinancials({
      groupId,
      includeDeleted,
    });

    const groupForMembers = calcGroup || group;
    const memberUsers = await User.find({ _id: { $in: groupForMembers.memberIds } }).select("name email");

    const byId = {};
    for (const u of memberUsers) {
      byId[String(u._id)] = { id: String(u._id), name: u.name, email: u.email };
    }

    const transfersDetailed = transfers.map((t) => ({
      from: byId[String(t.fromUserId)] ?? { id: String(t.fromUserId) },
      to: byId[String(t.toUserId)] ?? { id: String(t.toUserId) },
      amount: t.amount,
    }));

    const balanceDetailed = group.memberIds.map((mid) => {
      const id = String(mid);
      return {
        user: byId[id] ?? { id },
        balance: balanceMap[id] ?? 0,
      };
    });

    const settlementsDetailed = settlements.map((s) => ({
      id: String(s._id),
      groupId: String(s.groupId),
      from: byId[String(s.fromUserId)] ?? { id: String(s.fromUserId) },
      to: byId[String(s.toUserId)] ?? { id: String(s.toUserId) },
      amount: Number(s.amount),
      note: s.note || "",
      createdBy: byId[String(s.createdByUserId)] ?? { id: String(s.createdByUserId) },
      createdAt: s.createdAt,
    }));

    res.json({
      group: {
        id: String(group._id),
        name: group.name,
        ownerId: String(group.ownerId),
        memberIds: group.memberIds.map(String),
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
      },
      members: memberUsers.map((u) => ({ id: String(u._id), name: u.name, email: u.email })),
      balanceDetailed,
      transfersDetailed,
      settlementsDetailed,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- AUDIT ---
app.get("/api/groups/:groupId/audit", auth, async (req, res) => {
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

    const [expenses, settlements] = await Promise.all([
      Expense.find({ groupId }),
      Settlement.find({ groupId }),
    ]);

    const events = [];

    for (const exp of expenses) {
      events.push({
        at: exp.createdAt,
        type: "expense",
        action: "created",
        entityId: String(exp._id),
        actorUserId: exp.paidByUserId ? String(exp.paidByUserId) : null,
        meta: {
          title: exp.title,
          amount: Number(exp.amount),
          paidByUserId: exp.paidByUserId ? String(exp.paidByUserId) : null,
        },
      });

      if (exp.isDeleted && exp.deletedAt) {
        events.push({
          at: exp.deletedAt,
          type: "expense",
          action: "deleted",
          entityId: String(exp._id),
          actorUserId: exp.deletedByUserId ? String(exp.deletedByUserId) : null,
          meta: {
            title: exp.title,
            amount: Number(exp.amount),
            paidByUserId: exp.paidByUserId ? String(exp.paidByUserId) : null,
          },
        });
      }

      if (exp.restoredAt) {
        events.push({
          at: exp.restoredAt,
          type: "expense",
          action: "restored",
          entityId: String(exp._id),
          actorUserId: exp.restoredByUserId ? String(exp.restoredByUserId) : null,
          meta: {
            title: exp.title,
            amount: Number(exp.amount),
            paidByUserId: exp.paidByUserId ? String(exp.paidByUserId) : null,
          },
        });
      }
    }

    for (const s of settlements) {
      events.push({
        at: s.createdAt,
        type: "settlement",
        action: "created",
        entityId: String(s._id),
        actorUserId: s.createdByUserId ? String(s.createdByUserId) : null,
        meta: {
          fromUserId: s.fromUserId ? String(s.fromUserId) : null,
          toUserId: s.toUserId ? String(s.toUserId) : null,
          amount: Number(s.amount),
          note: s.note || "",
        },
      });

      if (s.isDeleted && s.deletedAt) {
        events.push({
          at: s.deletedAt,
          type: "settlement",
          action: "deleted",
          entityId: String(s._id),
          actorUserId: s.deletedByUserId ? String(s.deletedByUserId) : null,
          meta: {
            fromUserId: s.fromUserId ? String(s.fromUserId) : null,
            toUserId: s.toUserId ? String(s.toUserId) : null,
            amount: Number(s.amount),
            note: s.note || "",
          },
        });
      }

      if (s.restoredAt) {
        events.push({
          at: s.restoredAt,
          type: "settlement",
          action: "restored",
          entityId: String(s._id),
          actorUserId: s.restoredByUserId ? String(s.restoredByUserId) : null,
          meta: {
            fromUserId: s.fromUserId ? String(s.fromUserId) : null,
            toUserId: s.toUserId ? String(s.toUserId) : null,
            amount: Number(s.amount),
            note: s.note || "",
          },
        });
      }
    }

    events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

    res.json({
      groupId,
      count: events.length,
      events,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- AUDIT DETAILED ---
app.get("/api/groups/:groupId/audit-detailed", auth, async (req, res) => {
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

    const [expenses, settlements] = await Promise.all([
      Expense.find({ groupId }),
      Settlement.find({ groupId }),
    ]);

    const userIds = new Set();
    const collect = (id) => {
      if (id) userIds.add(String(id));
    };

    for (const exp of expenses) {
      collect(exp.paidByUserId);
      collect(exp.deletedByUserId);
      collect(exp.restoredByUserId);
    }
    for (const s of settlements) {
      collect(s.createdByUserId);
      collect(s.deletedByUserId);
      collect(s.restoredByUserId);
      collect(s.fromUserId);
      collect(s.toUserId);
    }

    const users = await User.find({ _id: { $in: Array.from(userIds) } }).select("name email");
    const userMap = {};
    for (const u of users) {
      userMap[String(u._id)] = { id: String(u._id), name: u.name, email: u.email };
    }
    const mapUser = (id) => {
      if (!id) return null;
      const key = String(id);
      return userMap[key] || { id: key };
    };

    const events = [];

    for (const exp of expenses) {
      const baseMeta = {
        title: exp.title,
        amount: Number(exp.amount),
        paidBy: mapUser(exp.paidByUserId),
      };

      events.push({
        at: exp.createdAt,
        type: "expense",
        action: "created",
        entityId: String(exp._id),
        actor: mapUser(exp.paidByUserId),
        meta: baseMeta,
      });

      if (exp.isDeleted && exp.deletedAt) {
        events.push({
          at: exp.deletedAt,
          type: "expense",
          action: "deleted",
          entityId: String(exp._id),
          actor: mapUser(exp.deletedByUserId),
          meta: baseMeta,
        });
      }

      if (exp.restoredAt) {
        events.push({
          at: exp.restoredAt,
          type: "expense",
          action: "restored",
          entityId: String(exp._id),
          actor: mapUser(exp.restoredByUserId),
          meta: baseMeta,
        });
      }
    }

    for (const s of settlements) {
      const baseMeta = {
        from: mapUser(s.fromUserId),
        to: mapUser(s.toUserId),
        amount: Number(s.amount),
        note: s.note || "",
      };

      events.push({
        at: s.createdAt,
        type: "settlement",
        action: "created",
        entityId: String(s._id),
        actor: mapUser(s.createdByUserId),
        meta: baseMeta,
      });

      if (s.isDeleted && s.deletedAt) {
        events.push({
          at: s.deletedAt,
          type: "settlement",
          action: "deleted",
          entityId: String(s._id),
          actor: mapUser(s.deletedByUserId),
          meta: baseMeta,
        });
      }

      if (s.restoredAt) {
        events.push({
          at: s.restoredAt,
          type: "settlement",
          action: "restored",
          entityId: String(s._id),
          actor: mapUser(s.restoredByUserId),
          meta: baseMeta,
        });
      }
    }

    events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

    res.json({
      groupId,
      count: events.length,
      events,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- SETTLEMENTS (settle up) ---
// domyślnie: tylko aktywne
// opcjonalnie: ?includeDeleted=true -> pokaż też usunięte
app.get("/api/groups/:groupId/settlements", auth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const userId = req.user.userId;

    if (!validateObjectId(groupId)) return res.status(400).json({ error: "Invalid groupId" });

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const isMember = group.memberIds.map(String).includes(String(userId));
    if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

    const includeDeleted = parseIncludeDeleted(req.query.includeDeleted);
    const guard = assertGroupActive(group, userId, includeDeleted);
    if (!guard.ok) return res.status(guard.status).json({ error: guard.error });
    const query = includeDeleted ? { groupId } : activeSettlementsQuery(groupId);

    const settlements = await Settlement.find(query).sort({ createdAt: -1 });
    res.json(settlements);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- SETTLEMENTS HISTORY (pod UI) ---
app.get("/api/groups/:groupId/settlements/history", auth, async (req, res) => {
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

    const memberIds = group.memberIds.map(String);

    const settlements = await Settlement.find({ groupId }).sort({ updatedAt: -1 });

    const userIdsToFetch = new Set(memberIds);
    for (const s of settlements) {
      if (s.createdByUserId) userIdsToFetch.add(String(s.createdByUserId));
      if (s.deletedByUserId) userIdsToFetch.add(String(s.deletedByUserId));
      if (s.fromUserId) userIdsToFetch.add(String(s.fromUserId));
      if (s.toUserId) userIdsToFetch.add(String(s.toUserId));
    }

    const users = await User.find({ _id: { $in: Array.from(userIdsToFetch) } }).select("name email");

    const byId = {};
    for (const u of users) {
      byId[String(u._id)] = { id: String(u._id), name: u.name, email: u.email };
    }

    const items = settlements.map((s) => {
      const isDeleted = Boolean(s.isDeleted);
      const eventAt = s.deletedAt ? s.deletedAt : s.createdAt;

      return {
        id: String(s._id),
        groupId: String(s.groupId),
        status: isDeleted ? "deleted" : "active",
        eventAt,
        from: byId[String(s.fromUserId)] ?? { id: String(s.fromUserId) },
        to: byId[String(s.toUserId)] ?? { id: String(s.toUserId) },
        amount: Number(s.amount),
        note: s.note || "",
        createdBy: byId[String(s.createdByUserId)] ?? { id: String(s.createdByUserId) },
        createdAt: s.createdAt,
        deletedBy: s.deletedByUserId
          ? byId[String(s.deletedByUserId)] ?? { id: String(s.deletedByUserId) }
          : null,
        deletedAt: s.deletedAt ?? null,
        updatedAt: s.updatedAt,
      };
    });

    items.sort((a, b) => new Date(b.eventAt).getTime() - new Date(a.eventAt).getTime());

    res.json({ groupId, count: items.length, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// dodanie rozliczenia (przelewu) + LIMIT (nie przepłacisz)
app.post("/api/groups/:groupId/settlements", auth, async (req, res) => {
  try {
    const { groupId } = req.params;
    const createdByUserId = req.user.userId;

    if (!validateObjectId(groupId)) return res.status(400).json({ error: "Invalid groupId" });

    const { fromUserId, toUserId, amount, note } = req.body || {};
    if (!fromUserId || !toUserId || amount == null) {
      return res.status(400).json({ error: "Missing fromUserId/toUserId/amount" });
    }

    if (!validateObjectId(fromUserId) || !validateObjectId(toUserId)) {
      return res.status(400).json({ error: "Invalid fromUserId or toUserId" });
    }

    if (String(fromUserId) === String(toUserId)) {
      return res.status(400).json({ error: "fromUserId cannot equal toUserId" });
    }

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return res.status(400).json({ error: "Amount must be a positive number" });
    }

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const isMember = group.memberIds.map(String).includes(String(createdByUserId));
    if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

    const guard = assertGroupActive(group, createdByUserId, false);
    if (!guard.ok) return res.status(guard.status).json({ error: guard.error });

    const memberSet = new Set(group.memberIds.map(String));
    if (!memberSet.has(String(fromUserId)) || !memberSet.has(String(toUserId))) {
      return res.status(400).json({ error: "fromUserId/toUserId must be members of this group" });
    }

    // --- LIMIT: nie pozwól rozliczyć więcej niż aktualnie jest do zapłaty ---
    const { transfers: transfersNow } = await calculateGroupFinancials({ groupId, includeDeleted: false });
    const owed = getOwedAmount(transfersNow, fromUserId, toUserId);

    if (owed <= 0) {
      return res.status(400).json({ error: "Nothing to settle between these users right now" });
    }

    if (round2(amt) > round2(owed)) {
      return res.status(400).json({
        error: "Settlement amount exceeds current debt",
        maxAllowed: round2(owed),
      });
    }
    // --- KONIEC LIMITU ---

    const settlement = await Settlement.create({
      groupId,
      fromUserId,
      toUserId,
      amount: round2(amt),
      note: String(note || "").trim(),
      createdByUserId,
    });

    res.status(201).json(settlement);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- SETTLE ALL (auto-suggest) ---
app.post("/api/groups/:groupId/settle-all", auth, async (req, res) => {
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

    const guard = assertGroupActive(group, userId, false);
    if (!guard.ok) return res.status(guard.status).json({ error: guard.error });

    const note = String((req.body && req.body.note) || "Settle all").trim();

    const { transfers: transfersNow } = await calculateGroupFinancials({ groupId, includeDeleted: false });

    if (transfersNow.length === 0) {
      return res.json({
        groupId,
        createdCount: 0,
        settlements: [],
        message: "Nothing to settle",
      });
    }

    const docs = transfersNow.map((t) => ({
      groupId,
      fromUserId: t.fromUserId,
      toUserId: t.toUserId,
      amount: round2(t.amount),
      note,
      createdByUserId: userId,
    }));

    const created = await Settlement.insertMany(docs);

    res.status(201).json({
      groupId,
      createdCount: created.length,
      settlements: created,
      transfersUsed: transfersNow,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// soft-delete rozliczenia
app.delete("/api/groups/:groupId/settlements/:settlementId", auth, async (req, res) => {
  try {
    const { groupId, settlementId } = req.params;
    const userId = req.user.userId;

    if (!validateObjectId(groupId) || !validateObjectId(settlementId)) {
      return res.status(400).json({ error: "Invalid groupId or settlementId" });
    }

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const isMember = group.memberIds.map(String).includes(String(userId));
    if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

    const guard = assertGroupActive(group, userId, false);
    if (!guard.ok) return res.status(guard.status).json({ error: guard.error });

    const settlement = await Settlement.findById(settlementId);
    if (!settlement) return res.status(404).json({ error: "Settlement not found" });

    if (String(settlement.groupId) !== String(groupId)) {
      return res.status(400).json({ error: "Settlement does not belong to this group" });
    }

    const isOwner = String(group.ownerId) === String(userId);
    const isAuthor = String(settlement.createdByUserId) === String(userId);

    if (!isOwner && !isAuthor) {
      return res.status(403).json({ error: "Not allowed to delete this settlement" });
    }

    if (settlement.isDeleted === true) {
      return res.json({
        ok: true,
        alreadyDeleted: true,
        deletedSettlementId: String(settlementId),
      });
    }

    settlement.isDeleted = true;
    settlement.deletedAt = new Date();
    settlement.deletedByUserId = userId;
    await settlement.save();

    res.json({
      ok: true,
      deletedSettlementId: String(settlementId),
      deletedAt: settlement.deletedAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// restore settlement
app.post("/api/groups/:groupId/settlements/:settlementId/restore", auth, async (req, res) => {
  try {
    const { groupId, settlementId } = req.params;
    const userId = req.user.userId;

    if (!validateObjectId(groupId) || !validateObjectId(settlementId)) {
      return res.status(400).json({ error: "Invalid groupId or settlementId" });
    }

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ error: "Group not found" });

    const isMember = group.memberIds.map(String).includes(String(userId));
    if (!isMember) return res.status(403).json({ error: "Not a member of this group" });

    const guard = assertGroupActive(group, userId, false);
    if (!guard.ok) return res.status(guard.status).json({ error: guard.error });

    const settlement = await Settlement.findById(settlementId);
    if (!settlement) return res.status(404).json({ error: "Settlement not found" });

    if (String(settlement.groupId) !== String(groupId)) {
      return res.status(400).json({ error: "Settlement does not belong to this group" });
    }

    const isOwner = String(group.ownerId) === String(userId);
    const isAuthor = String(settlement.createdByUserId) === String(userId);

    if (!isOwner && !isAuthor) {
      return res.status(403).json({ error: "Not allowed to restore this settlement" });
    }

    if (!settlement.isDeleted) {
      return res.status(400).json({ error: "Settlement is not deleted" });
    }

    settlement.isDeleted = false;
    settlement.deletedAt = null;
    settlement.deletedByUserId = null;
    settlement.restoredAt = new Date();
    settlement.restoredByUserId = userId;
    await settlement.save();

    res.json({
      ok: true,
      restoredSettlementId: String(settlementId),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- START ---
const PORT = process.env.PORT || 4000;

async function start() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✅ MongoDB connected");

  app.listen(PORT, () => {
    console.log(`✅ API działa na http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error("❌ Start error:", err.message);
  process.exit(1);
});

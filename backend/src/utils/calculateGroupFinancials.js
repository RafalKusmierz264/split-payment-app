const Group = require("../models/Group");
const Expense = require("../models/Expense");
const Settlement = require("../models/Settlement");

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function applySettlementsToBalance(balance, settlements) {
  for (const s of settlements) {
    const from = String(s.fromUserId);
    const to = String(s.toUserId);
    const amt = Number(s.amount);

    balance[from] = (balance[from] ?? 0) + amt;
    balance[to] = (balance[to] ?? 0) - amt;
  }
}

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

async function calculateGroupFinancials({ groupId, includeDeleted = false }) {
  const group = await Group.findById(groupId);

  const expenseQuery = includeDeleted ? { groupId } : { groupId, isDeleted: { $ne: true } };
  const settlementQuery = includeDeleted ? { groupId } : { groupId, isDeleted: { $ne: true } };

  const [expenses, settlements] = await Promise.all([
    Expense.find(expenseQuery),
    Settlement.find(settlementQuery),
  ]);

  const balanceMap = {};
  for (const memberId of group?.memberIds?.map(String) || []) {
    balanceMap[memberId] = 0;
  }

  for (const exp of expenses) {
    const payer = String(exp.paidByUserId);
    balanceMap[payer] = (balanceMap[payer] ?? 0) + Number(exp.amount);

    for (const s of exp.splits) {
      const uid = String(s.userId);
      balanceMap[uid] = (balanceMap[uid] ?? 0) - Number(s.share);
    }
  }

  applySettlementsToBalance(balanceMap, settlements);
  for (const k of Object.keys(balanceMap)) {
    balanceMap[k] = round2(balanceMap[k]);
  }

  const transfers = calculateTransfers(balanceMap);

  return { group, expenses, settlements, balanceMap, transfers };
}

module.exports = {
  calculateGroupFinancials,
  round2,
  applySettlementsToBalance,
  calculateTransfers,
};

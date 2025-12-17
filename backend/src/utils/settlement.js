function round2(n) {
  return Math.round(n * 100) / 100;
}

function calculateTransfers(balanceMap) {
  // balanceMap: { userId: number }
  const creditors = [];
  const debtors = [];

  for (const [userId, balRaw] of Object.entries(balanceMap)) {
    const bal = round2(balRaw);
    if (bal > 0) creditors.push({ userId, amount: bal });
    if (bal < 0) debtors.push({ userId, amount: -bal }); // trzymamy dodatnią wartość długu
  }

  // opcjonalnie: sortowanie stabilizuje wyniki (łatwiej testować)
  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  const transfers = [];
  let i = 0, j = 0;

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

module.exports = { calculateTransfers };

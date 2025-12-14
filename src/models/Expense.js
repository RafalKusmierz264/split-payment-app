const mongoose = require("mongoose");

const ExpenseSchema = new mongoose.Schema(
  {
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: "Group", required: true },
    paidByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true },
    amount: { type: Number, required: true },

    splits: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        share: { type: Number, required: true },
      },
    ],

    // ✅ soft-delete
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Expense", ExpenseSchema);


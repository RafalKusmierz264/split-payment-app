const mongoose = require("mongoose");

const GroupSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    memberIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
      }
    ],
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    isClosed: { type: Boolean, default: false },
    closedAt: { type: Date, default: null },
    closedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reopenedAt: { type: Date, default: null },
    reopenedByUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Group", GroupSchema);

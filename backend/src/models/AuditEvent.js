const mongoose = require("mongoose");

const AuditEventSchema = new mongoose.Schema(
  {
    groupId: { type: mongoose.Schema.Types.ObjectId, ref: "Group", required: true, index: true },
    kind: { type: String, required: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, refPath: "entityType" },
    entityType: { type: String, default: "group" },
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    at: { type: Date, default: () => new Date(), index: true },
    payload: { type: Object, default: {} },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AuditEvent", AuditEventSchema);

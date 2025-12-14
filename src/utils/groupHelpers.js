function parseIncludeDeleted(value) {
  return String(value || "false").toLowerCase() === "true";
}

function assertGroupActive(group, reqUserId, includeDeleted) {
  const isOwner = String(group.ownerId) === String(reqUserId);

  if (group.isDeleted) {
    if (includeDeleted && isOwner) {
      return { ok: true, isOwner, isDeleted: true };
    }
    return { ok: false, status: 409, error: "Group is deleted", isOwner, isDeleted: true };
  }

  return { ok: true, isOwner, isDeleted: false };
}

module.exports = {
  parseIncludeDeleted,
  assertGroupActive,
};

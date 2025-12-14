console.log("✅ LOADED group.routes.js (v3)");
const express = require("express");
const { z } = require("zod");
const auth = require("../middleware/auth");
const Group = require("../models/Group");
const User = require("../models/User");
const { parseIncludeDeleted, assertGroupActive } = require("../utils/groupHelpers");

const router = express.Router();

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

module.exports = router;

console.log("✅ LOADED group.routes.js (v3)");
const express = require("express");
const { z } = require("zod");
const auth = require("../middleware/auth");
const Group = require("../models/Group");
const User = require("../models/User");

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

  const groups = await Group.find({
    memberIds: userId
  }).sort({ createdAt: -1 });

  res.json(groups);
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

module.exports = router;

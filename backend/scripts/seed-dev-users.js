const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const User = require("../src/models/User");

const MONGODB_URI = process.env.MONGODB_URI;

async function seedDevUsers() {
  if (!MONGODB_URI) {
    throw new Error("Missing MONGODB_URI env variable");
  }

  await mongoose.connect(MONGODB_URI);

  const targetUsers = [
    { name: "Owner User", email: "owner@example.com" },
    { name: "Member User", email: "member@example.com" },
  ];

  const targetEmails = targetUsers.map((u) => String(u.email).toLowerCase().trim());

  await User.deleteMany({ email: { $in: targetEmails } });

  for (const { name, email } of targetUsers) {
    const normalizedEmail = String(email).toLowerCase().trim();
    const passwordHash = await bcrypt.hash("password", 10);

    await User.create({
      name,
      email: normalizedEmail,
      passwordHash,
    });
  }

  const dbName = mongoose.connection.name;
  const usersCount = await User.countDocuments();

  console.log(`Connected to DB: ${dbName}`);
  console.log(`Users in collection: ${usersCount}`);
  console.log("Added dev users: owner@example.com / password, member@example.com / password");
}

seedDevUsers()
  .catch((err) => {
    console.error("Seeding dev users failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });

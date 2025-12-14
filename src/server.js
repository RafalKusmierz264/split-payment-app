const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const app = require("./app");

const PORT = process.env.PORT || 4000;

async function start() {
  console.log("✅ START server.js", new Date().toISOString());

  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✅ MongoDB connected");

  app.listen(PORT, () => {
    console.log(`✅ API działa na http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error("❌ Start error:", err.message);
    process.exit(1);
  });
}

module.exports = { app, start };

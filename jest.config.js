module.exports = {
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.js"],
  setupFilesAfterEnv: ["<rootDir>/tests/setupTestEnv.js"],
  testTimeout: 30000
};

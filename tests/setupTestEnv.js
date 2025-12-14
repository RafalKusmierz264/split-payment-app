process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

// Keep integration tests deterministic and avoid long hangs.
jest.setTimeout(30000);

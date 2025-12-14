const request = require("supertest");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const { MongoMemoryServer } = require("mongodb-memory-server");

const app = require("../src/app");
const User = require("../src/models/User");

describe("GET /api/groups/:groupId details with financials", () => {
  let mongo;
  let authToken;
  let groupId;
  const password = "Password123!";

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
  });

  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
    await mongo.stop();
  });

  beforeEach(async () => {
    await mongoose.connection.db.dropDatabase();

    const passwordHash = await bcrypt.hash(password, 10);
    await User.create({ name: "Owner", email: "owner@example.com", passwordHash });

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: "owner@example.com", password })
      .expect(200);

    authToken = loginRes.body.token;

    const groupRes = await request(app)
      .post("/api/groups")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ name: "Finance Group" })
      .expect(201);

    groupId = groupRes.body._id || groupRes.body.id;
  });

  test("returns group details, members, and financials", async () => {
    await request(app)
      .post(`/api/groups/${groupId}/expenses`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ title: "Dinner", amount: 20 })
      .expect(201);

    const res = await request(app)
      .get(`/api/groups/${groupId}`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(res.body.group).toBeDefined();
    expect(res.body.group.id).toBeDefined();
    expect(res.body.group.isClosed).toBe(false);
    expect(Array.isArray(res.body.members)).toBe(true);
    expect(res.body.members.length).toBeGreaterThanOrEqual(1);
    expect(res.body.financials).toBeDefined();
    expect(res.body.financials).toHaveProperty("balances");
    expect(res.body.financials).toHaveProperty("summary");
    expect(res.body.financials).toHaveProperty("transfers");

    await request(app)
      .post(`/api/groups/${groupId}/close`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    const resClosed = await request(app)
      .get(`/api/groups/${groupId}`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);
    expect(resClosed.body.group.isClosed).toBe(true);
  });
});

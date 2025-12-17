const request = require("supertest");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const { MongoMemoryServer } = require("mongodb-memory-server");

const app = require("../src/app");
const User = require("../src/models/User");

describe("GROUP_CLOSED error format", () => {
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
      .send({ name: "Closed Group" })
      .expect(201);

    groupId = groupRes.body._id || groupRes.body.id;

    await request(app)
      .post(`/api/groups/${groupId}/close`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);
  });

  test("returns {code, message} with GROUP_CLOSED on write", async () => {
    const res = await request(app)
      .patch(`/api/groups/${groupId}`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ name: "New Name" })
      .expect(409);

    expect(res.body).toHaveProperty("code", "GROUP_CLOSED");
    expect(typeof res.body.message).toBe("string");
  });
});

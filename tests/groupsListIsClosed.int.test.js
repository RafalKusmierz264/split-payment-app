const request = require("supertest");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const { MongoMemoryServer } = require("mongodb-memory-server");

const app = require("../src/app");
const User = require("../src/models/User");

describe("GET /api/groups includes isClosed flag", () => {
  let mongo;
  let authToken;
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
    await User.create({ name: "Test User", email: "user@example.com", passwordHash });

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: "user@example.com", password })
      .expect(200);

    authToken = loginRes.body.token;
  });

  test("returns isClosed=false for open group and true after close", async () => {
    const createRes = await request(app)
      .post("/api/groups")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ name: "My Group" })
      .expect(201);

    const groupId = createRes.body._id || createRes.body.id;

    const listOpen = await request(app)
      .get("/api/groups")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(listOpen.body).toHaveLength(1);
    expect(listOpen.body[0].isClosed).toBe(false);

    await request(app)
      .post(`/api/groups/${groupId}/close`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    const listClosed = await request(app)
      .get("/api/groups")
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(listClosed.body).toHaveLength(1);
    expect(listClosed.body[0].isClosed).toBe(true);
  });
});

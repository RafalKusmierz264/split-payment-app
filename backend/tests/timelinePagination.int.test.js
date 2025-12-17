const request = require("supertest");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const { MongoMemoryServer } = require("mongodb-memory-server");

const app = require("../src/app");
const User = require("../src/models/User");

describe("Timeline pagination", () => {
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
      .send({ name: "Timeline Pagination" })
      .expect(201);

    groupId = groupRes.body._id || groupRes.body.id;

    await request(app)
      .patch(`/api/groups/${groupId}`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ name: "Renamed 1" })
      .expect(200);

    await request(app)
      .post(`/api/groups/${groupId}/expenses`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ title: "Expense 1", amount: 10 })
      .expect(201);

    await request(app)
      .patch(`/api/groups/${groupId}`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ name: "Renamed 2" })
      .expect(200);

    await request(app)
      .post(`/api/groups/${groupId}/expenses`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ title: "Expense 2", amount: 20 })
      .expect(201);

    await request(app)
      .post(`/api/groups/${groupId}/close`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    await request(app)
      .post(`/api/groups/${groupId}/reopen`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    await request(app)
      .post(`/api/groups/${groupId}/expenses`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ title: "Expense 3", amount: 30 })
      .expect(201);
  });

  test("paginates with limit and before", async () => {
    const firstPage = await request(app)
      .get(`/api/groups/${groupId}/timeline?limit=2`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(firstPage.body.events).toHaveLength(2);
    expect(typeof firstPage.body.nextBefore === "string" || firstPage.body.nextBefore === null).toBe(true);

    const secondPage = await request(app)
      .get(`/api/groups/${groupId}/timeline?limit=2&before=${encodeURIComponent(firstPage.body.nextBefore)}`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(secondPage.body.events).toHaveLength(2);

    const firstIds = new Set(firstPage.body.events.map((e) => e.id));
    for (const e of secondPage.body.events) {
      expect(firstIds.has(e.id)).toBe(false);
    }
  });

  test("limit is capped at 50 and before must be valid date", async () => {
    const bigLimit = await request(app)
      .get(`/api/groups/${groupId}/timeline?limit=999`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);
    expect(bigLimit.body.events.length).toBeLessThanOrEqual(50);

    await request(app)
      .get(`/api/groups/${groupId}/timeline?before=not-a-date`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(400)
      .expect((res) => {
        if (res.body.code !== "VALIDATION_ERROR") throw new Error("Expected VALIDATION_ERROR");
      });
  });
});

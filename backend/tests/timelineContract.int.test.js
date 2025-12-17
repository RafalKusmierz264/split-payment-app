const request = require("supertest");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const { MongoMemoryServer } = require("mongodb-memory-server");

const app = require("../src/app");
const User = require("../src/models/User");

describe("Timeline contract", () => {
  let mongo;
  let authToken;
  let owner;
  let member;
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
    owner = await User.create({ name: "Owner", email: "owner@example.com", passwordHash });
    member = await User.create({ name: "Member", email: "member@example.com", passwordHash });

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: owner.email, password })
      .expect(200);

    authToken = loginRes.body.token;

    const groupRes = await request(app)
      .post("/api/groups")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ name: "Timeline Group" })
      .expect(201);

    groupId = groupRes.body._id || groupRes.body.id;

    await request(app)
      .post(`/api/groups/${groupId}/members`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ email: member.email })
      .expect(200);
  });

  test("timeline items follow contract and include key events", async () => {
    await request(app)
      .post(`/api/groups/${groupId}/expenses`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ title: "Dinner", amount: 25 })
      .expect(201);

    await request(app)
      .post(`/api/groups/${groupId}/settlements`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        fromUserId: member._id.toString(),
        toUserId: owner._id.toString(),
        amount: 10,
        note: "Payback"
      })
      .expect(201);

    await request(app)
      .post(`/api/groups/${groupId}/close`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    const res = await request(app)
      .get(`/api/groups/${groupId}/timeline`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    expect(Array.isArray(res.body.events)).toBe(true);
    expect(res.body.events.length).toBeGreaterThanOrEqual(3);

    const requiredKinds = new Set(res.body.events.map((e) => e.kind));
    expect(requiredKinds.has("expense_created")).toBe(true);
    expect(requiredKinds.has("settlement_created")).toBe(true);
    expect(requiredKinds.has("group_closed")).toBe(true);

    for (const item of res.body.events) {
      expect(typeof item.id).toBe("string");
      expect(typeof item.kind).toBe("string");
      expect(typeof item.at).toBe("string");
      expect(item.payload).not.toBeNull();
      expect(typeof item.payload).toBe("object");
      expect(item.entity).toBeDefined();
      expect(["group", "expense", "settlement"]).toContain(item.entity.type);
      expect(typeof item.entity.id).toBe("string");
      expect(item.entity.payload).not.toBeNull();
      expect(typeof item.entity.payload).toBe("object");
      expect(item.title).toBeDefined();
      expect(Object.prototype.hasOwnProperty.call(item, "subtitle")).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(item, "actorUserId")).toBe(true);
    }
  });
});

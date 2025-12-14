const request = require("supertest");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const { MongoMemoryServer } = require("mongodb-memory-server");

const app = require("../src/app");
const User = require("../src/models/User");

describe("Group rename and audit/timeline", () => {
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
      .send({ name: "Old Name" })
      .expect(201);

    groupId = groupRes.body._id || groupRes.body.id;
  });

  test("rename updates group, adds audit and timeline event", async () => {
    const renameRes = await request(app)
      .patch(`/api/groups/${groupId}`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ name: "New Name" })
      .expect(200);

    expect(renameRes.body.name).toBe("New Name");

    const auditRes = await request(app)
      .get(`/api/groups/${groupId}/audit`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    const auditKinds = auditRes.body.events.map((e) => `${e.type}_${e.action || ""}`);
    expect(auditKinds).toContain("group_updated");

    const timelineRes = await request(app)
      .get(`/api/groups/${groupId}/timeline`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    const updateItem = timelineRes.body.events.find((e) => e.kind === "group_updated");
    expect(updateItem).toBeDefined();
    expect(updateItem.payload).toBeDefined();
    expect(updateItem.payload.before.name).toBe("Old Name");
    expect(updateItem.payload.after.name).toBe("New Name");
  });

  test("closed group blocks rename", async () => {
    await request(app)
      .post(`/api/groups/${groupId}/close`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    await request(app)
      .patch(`/api/groups/${groupId}`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ name: "Blocked Name" })
      .expect(409);
  });
});

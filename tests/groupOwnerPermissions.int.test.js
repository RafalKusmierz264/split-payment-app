const request = require("supertest");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const { MongoMemoryServer } = require("mongodb-memory-server");

const app = require("../src/app");
const User = require("../src/models/User");

describe("Group owner-only admin actions", () => {
  let mongo;
  let ownerToken;
  let memberToken;
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
    const owner = await User.create({ name: "Owner", email: "owner@example.com", passwordHash });
    await User.create({ name: "Member", email: "member@example.com", passwordHash });

    const ownerLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: owner.email, password })
      .expect(200);
    ownerToken = ownerLogin.body.token;

    const memberLogin = await request(app)
      .post("/api/auth/login")
      .send({ email: "member@example.com", password })
      .expect(200);
    memberToken = memberLogin.body.token;

    const groupRes = await request(app)
      .post("/api/groups")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "AdminOnly Group" })
      .expect(201);

    groupId = groupRes.body._id || groupRes.body.id;

    await request(app)
      .post(`/api/groups/${groupId}/members`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ email: "member@example.com" })
      .expect(200);
  });

  test("non-owner gets 403 for admin actions, owner allowed", async () => {
    await request(app)
      .post(`/api/groups/${groupId}/close`)
      .set("Authorization", `Bearer ${memberToken}`)
      .expect(403);

    await request(app)
      .post(`/api/groups/${groupId}/close`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);

    await request(app)
      .post(`/api/groups/${groupId}/reopen`)
      .set("Authorization", `Bearer ${memberToken}`)
      .expect(403);

    await request(app)
      .post(`/api/groups/${groupId}/reopen`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);

    await request(app)
      .delete(`/api/groups/${groupId}`)
      .set("Authorization", `Bearer ${memberToken}`)
      .expect(403);

    await request(app)
      .delete(`/api/groups/${groupId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);

    await request(app)
      .post(`/api/groups/${groupId}/restore`)
      .set("Authorization", `Bearer ${memberToken}`)
      .expect(403);

    await request(app)
      .post(`/api/groups/${groupId}/restore`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .expect(200);
  });
});

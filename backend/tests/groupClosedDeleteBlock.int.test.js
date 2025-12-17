const request = require("supertest");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const { MongoMemoryServer } = require("mongodb-memory-server");

const app = require("../src/app");
const User = require("../src/models/User");

describe("Closed group blocks delete for expenses and settlements", () => {
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
      .send({ name: "Delete Guard Group" })
      .expect(201);

    groupId = groupRes.body._id || groupRes.body.id;

    await request(app)
      .post(`/api/groups/${groupId}/members`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ email: member.email })
      .expect(200);
  });

  test("delete blocked while closed and allowed after reopen", async () => {
    const expenseRes = await request(app)
      .post(`/api/groups/${groupId}/expenses`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ title: "Dinner", amount: 10 })
      .expect(201);

    const expenseId = expenseRes.body._id || expenseRes.body.id;

    const settlementRes = await request(app)
      .post(`/api/groups/${groupId}/settlements`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        fromUserId: member._id.toString(),
        toUserId: owner._id.toString(),
        amount: 5,
        note: "Payback"
      })
      .expect(201);

    const settlementId = settlementRes.body._id || settlementRes.body.id;

    await request(app)
      .post(`/api/groups/${groupId}/close`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    await request(app)
      .delete(`/api/groups/${groupId}/expenses/${expenseId}`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(409);

    await request(app)
      .delete(`/api/groups/${groupId}/settlements/${settlementId}`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(409);

    await request(app)
      .post(`/api/groups/${groupId}/reopen`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    await request(app)
      .delete(`/api/groups/${groupId}/settlements/${settlementId}`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    await request(app)
      .delete(`/api/groups/${groupId}/expenses/${expenseId}`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);
  });
});

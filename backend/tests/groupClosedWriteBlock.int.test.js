// Run integration tests locally with: npm test
const request = require("supertest");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const { MongoMemoryServer } = require("mongodb-memory-server");

const app = require("../src/app");
const User = require("../src/models/User");

describe("Closed group write guard", () => {
  let mongo;
  let owner;
  let member;
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
    owner = await User.create({ name: "Owner User", email: "owner@example.com", passwordHash });
    member = await User.create({ name: "Member User", email: "member@example.com", passwordHash });

    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: owner.email, password })
      .expect(200);

    authToken = loginRes.body.token;

    const groupRes = await request(app)
      .post("/api/groups")
      .set("Authorization", `Bearer ${authToken}`)
      .send({ name: "Test Group" })
      .expect(201);

    groupId = groupRes.body._id || groupRes.body.id;

    await request(app)
      .post(`/api/groups/${groupId}/members`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ email: member.email })
      .expect(200);
  });

  test("closed group blocks expenses and settlements until reopened", async () => {
    await request(app)
      .post(`/api/groups/${groupId}/close`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    const blockedExpense = await request(app)
      .post(`/api/groups/${groupId}/expenses`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ title: "Should fail while closed", amount: 10 })
      .expect(409);

    expect(blockedExpense.body.error).toBe("GROUP_CLOSED");

    const blockedSettlement = await request(app)
      .post(`/api/groups/${groupId}/settlements`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        fromUserId: member._id.toString(),
        toUserId: owner._id.toString(),
        amount: 5,
        note: "Should fail while closed"
      })
      .expect(409);

    expect(blockedSettlement.body.error).toBe("GROUP_CLOSED");

    await request(app)
      .post(`/api/groups/${groupId}/reopen`)
      .set("Authorization", `Bearer ${authToken}`)
      .expect(200);

    const expenseAfterReopen = await request(app)
      .post(`/api/groups/${groupId}/expenses`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({ title: "After reopen", amount: 20 })
      .expect((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(`Unexpected status ${res.status}`);
        }
      });

    expect(expenseAfterReopen.body._id).toBeDefined();

    const settlementAfterReopen = await request(app)
      .post(`/api/groups/${groupId}/settlements`)
      .set("Authorization", `Bearer ${authToken}`)
      .send({
        fromUserId: member._id.toString(),
        toUserId: owner._id.toString(),
        amount: 10,
        note: "After reopen"
      })
      .expect((res) => {
        if (![200, 201].includes(res.status)) {
          throw new Error(`Unexpected status ${res.status}`);
        }
      });

    expect(settlementAfterReopen.body._id).toBeDefined();
    expect(String(settlementAfterReopen.body.groupId || settlementAfterReopen.body.group)).toBe(
      String(groupId)
    );
  });
});

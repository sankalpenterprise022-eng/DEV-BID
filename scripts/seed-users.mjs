// Seeds the test users from TASK_MODULE_EXPORT section 11.F / 12.
// Usage: npm run seed   (reads MONGODB_URI + SEED_PASSWORD from .env.local)
// Upserts by username, so it is safe to run more than once.
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
const password = process.env.SEED_PASSWORD;
if (!uri) { console.error("MONGODB_URI missing (.env.local)"); process.exit(1); }
if (!password) { console.error("SEED_PASSWORD missing (.env.local)"); process.exit(1); }

const users = [
  { username: "owner1", permissions: { boss: true, users: true }, managerUsername: null },
  { username: "manager1", permissions: { taskManager: true }, managerUsername: null },
  { username: "staff1", permissions: {}, managerUsername: "manager1" },
  { username: "staff2", permissions: {}, managerUsername: "manager1" },
  { username: "staff3", permissions: {}, managerUsername: null },
];

const client = new MongoClient(uri);
try {
  await client.connect();
  const col = client.db().collection("users");
  await col.createIndex({ username: 1 }, { unique: true });
  for (const u of users) {
    await col.updateOne(
      { username: u.username },
      { $set: { ...u, password }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
    console.log(`seeded ${u.username}`);
  }
  console.log(`Done. DB: ${client.db().databaseName}`);
} finally {
  await client.close();
}

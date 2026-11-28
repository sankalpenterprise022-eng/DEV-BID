// One-time (safe to re-run) migration: bcrypt-hash every plain-text password
// in the `users` collection. Already-hashed passwords are skipped.
// Usage: npm run migrate:passwords          (reads MONGODB_URI from .env.local)
//        npm run migrate:passwords -- --dry (only counts, writes nothing)
import { MongoClient } from "mongodb";
import bcrypt from "bcryptjs";

const uri = process.env.MONGODB_URI;
if (!uri) { console.error("MONGODB_URI missing (.env.local)"); process.exit(1); }
const dry = process.argv.includes("--dry");

// Must match lib/auth/password.ts isHashed().
const isHashed = (v) => typeof v === "string" && v.length === 60 && /^\$2[aby]\$\d{2}\$/.test(v);

const client = new MongoClient(uri);
try {
  await client.connect();
  const col = client.db().collection("users");
  let hashed = 0, skipped = 0, empty = 0, raced = 0;

  for await (const u of col.find({}, { projection: { username: 1, password: 1 } })) {
    if (isHashed(u.password)) { skipped++; continue; }
    if (typeof u.password !== "string" || !u.password) {
      empty++;
      console.warn(`! ${u.username}: no password set - this user cannot log in until one is set on the Users page`);
      continue;
    }
    if (dry) { hashed++; continue; }
    const hash = await bcrypt.hash(u.password, 10);
    // Filter on the old value: if the user logged in meanwhile (login hashes on the fly) we don't touch it.
    const r = await col.updateOne({ _id: u._id, password: u.password }, { $set: { password: hash } });
    if (r.modifiedCount) { hashed++; console.log(`hashed ${u.username}`); } else raced++;
  }

  console.log(
    `${dry ? "[DRY RUN] would hash" : "Hashed"}: ${hashed}, already hashed: ${skipped}, no password: ${empty}` +
    (raced ? `, changed meanwhile: ${raced}` : "") + ` | DB: ${client.db().databaseName}`
  );
} finally {
  await client.close();
}

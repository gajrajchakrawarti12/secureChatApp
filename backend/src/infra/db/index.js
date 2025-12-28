const mysql = require("mysql2/promise");
const { logError } = require("../logging/logger");
const admin = require("../firebase/admin");
const { runMigrations } = require("./migrations/runMigrations");

const {
  DB_HOST = "localhost",
  DB_USER = "root",
  DB_PASSWORD = "",
  DB_NAME = "secure_chat",
  DB_DRIVER = "mysql",
} = process.env;

let pool = null; // MySQL pool or Firebase shim

async function initDb() {
  try {
    if (DB_DRIVER.toLowerCase() !== "firebase") {
      // MySQL path (default)
      const conn = await mysql.createConnection({
        host: DB_HOST,
        user: DB_USER,
        password: DB_PASSWORD,
      });
      await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\``);
      await conn.end();

      pool = mysql.createPool({
        host: DB_HOST,
        user: DB_USER,
        password: DB_PASSWORD,
        database: DB_NAME,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
      });

      // Apply idempotent SQL migrations (replaces runtime DDL).
      await runMigrations(pool);
      return;
    }

    // Firebase Firestore path
    const firestore = admin.firestore();

    // Simple auto-increment counter per collection using a transaction
    async function nextId(name) {
      const ref = firestore.collection("_counters").doc(name);
      let newId = null;
      await firestore.runTransaction(async (t) => {
        const snap = await t.get(ref);
        const curr = snap.exists ? snap.data().value || 0 : 0;
        newId = curr + 1;
        t.set(ref, { value: newId }, { merge: true });
      });
      return newId;
    }

    // Helper getters
    const colUsers = () => firestore.collection("users");
    const colMessages = () => firestore.collection("messages");
    const colRefresh = () => firestore.collection("refresh_tokens");

    // Implement a minimal shim compatible with mysql2 pool.query/execute usage in routes
    const shim = {
      async query(sql, params = []) {
        return run(sql, params);
      },
      async execute(sql, params = []) {
        return run(sql, params);
      },
    };

    async function run(sql, params) {
      const s = String(sql).trim();
      const up = s.toUpperCase();

      // Users
      if (/^SELECT\s+ID\s+FROM\s+USERS\s+WHERE\s+EMAIL\s*=\s*\?/i.test(s)) {
        const email = params[0];
        const snap = await colUsers().where("email", "==", email).get();
        const rows = snap.docs.map((d) => ({ id: d.get("id") }));
        return [rows];
      }

      if (/^INSERT\s+INTO\s+USERS\s*\(/i.test(s)) {
        const [
          email,
          password_hash,
          public_key,
          encrypted_private_key,
          mac,
          nonce,
          salt,
          iv,
        ] = params;
        const id = await nextId("users");
        await colUsers().doc(String(id)).set({
          id,
          email,
          password_hash,
          public_key,
          encrypted_private_key,
          mac,
          nonce,
          salt,
          iv,
          created_at: admin.firestore.FieldValue.serverTimestamp(),
        });
        return [{ affectedRows: 1, insertId: id }];
      }

      if (
        /^SELECT\s+ID,\s*PASSWORD_HASH,\s*SALT\s+FROM\s+USERS\s+WHERE\s+EMAIL\s*=\s*\?/i.test(
          s
        )
      ) {
        const email = params[0];
        const snap = await colUsers()
          .where("email", "==", email)
          .limit(1)
          .get();
        const rows = snap.empty
          ? []
          : [
              {
                id: snap.docs[0].get("id"),
                password_hash: snap.docs[0].get("password_hash"),
                salt: snap.docs[0].get("salt"),
              },
            ];
        return [rows];
      }

      if (
        /^SELECT\s+ID,\s*EMAIL,\s*PUBLIC_KEY,\s*ENCRYPTED_PRIVATE_KEY,\s*MAC,\s*NONCE,\s*SALT,\s*IV,\s*CREATED_AT\s+FROM\s+USERS\s+WHERE\s+ID\s*=\s*\?/i.test(
          s
        )
      ) {
        const id = Number(params[0]);
        const doc = await colUsers().doc(String(id)).get();
        const rows = !doc.exists
          ? []
          : [
              {
                id: doc.get("id"),
                email: doc.get("email"),
                public_key: doc.get("public_key"),
                encrypted_private_key: doc.get("encrypted_private_key"),
                mac: doc.get("mac"),
                nonce: doc.get("nonce"),
                salt: doc.get("salt"),
                iv: doc.get("iv"),
                created_at: doc.get("created_at") || new Date(),
              },
            ];
        return [rows];
      }

      if (
        /^SELECT\s+ID,\s*PUBLIC_KEY\s+FROM\s+USERS\s+WHERE\s+ID\s*!=\s*\?/i.test(
          s
        )
      ) {
        const id = Number(params[0]);
        const snap = await colUsers().where("id", "!=", id).get();
        const rows = snap.docs.map((d) => ({
          id: d.get("id"),
          public_key: d.get("public_key"),
        }));
        return [rows];
      }

      if (
        /^SELECT\s+PUBLIC_KEY\s+FROM\s+USERS\s+WHERE\s+ID\s*=\s*\?/i.test(s)
      ) {
        const id = Number(params[0]);
        const doc = await colUsers().doc(String(id)).get();
        const rows = !doc.exists ? [] : [{ public_key: doc.get("public_key") }];
        return [rows];
      }

      // Refresh tokens
      if (/^INSERT\s+INTO\s+REFRESH_TOKENS\s*\(/i.test(s)) {
        const [user_id, token] = params;
        const id = await nextId("refresh_tokens");
        await colRefresh()
          .doc(String(id))
          .set({
            id,
            user_id: Number(user_id),
            token,
            created_at: admin.firestore.FieldValue.serverTimestamp(),
          });
        return [{ affectedRows: 1, insertId: id }];
      }

      if (
        /^SELECT\s+ID,\s*TOKEN\s+FROM\s+REFRESH_TOKENS\s+WHERE\s+USER_ID\s*=\s*\?/i.test(
          s
        )
      ) {
        const user_id = Number(params[0]);
        const snap = await colRefresh().where("user_id", "==", user_id).get();
        const rows = snap.docs.map((d) => ({
          id: d.get("id"),
          token: d.get("token"),
        }));
        return [rows];
      }

      if (/^DELETE\s+FROM\s+REFRESH_TOKENS\s+WHERE\s+ID\s*=\s*\?/i.test(s)) {
        const id = Number(params[0]);
        await colRefresh().doc(String(id)).delete();
        return [{ affectedRows: 1 }];
      }

      // Messages
      if (/^INSERT\s+INTO\s+MESSAGES\s*\(/i.test(s)) {
        const [sender_id, receiver_id, encrypted_message] = params;
        const id = await nextId("messages");
        await colMessages()
          .doc(String(id))
          .set({
            id,
            sender_id: Number(sender_id),
            receiver_id: Number(receiver_id),
            encrypted_message,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
          });
        return [{ insertId: id, affectedRows: 1 }];
      }

      if (
        /SELECT\s+ID,\s*SENDER_ID,\s*RECEIVER_ID,\s*ENCRYPTED_MESSAGE,\s*TIMESTAMP\s+FROM\s+MESSAGES\s+WHERE\s+ID\s*=\s*\?\s+LIMIT\s+1/i.test(
          s
        )
      ) {
        const id = Number(params[0]);
        const doc = await colMessages().doc(String(id)).get();
        const rows = !doc.exists
          ? []
          : [
              {
                id: doc.get("id"),
                sender_id: doc.get("sender_id"),
                receiver_id: doc.get("receiver_id"),
                encrypted_message: doc.get("encrypted_message"),
                timestamp: doc.get("timestamp") || new Date(),
              },
            ];
        return [rows];
      }

      if (
        up.includes("FROM MESSAGES") &&
        up.includes("ORDER BY TIMESTAMP") &&
        up.includes("LIMIT")
      ) {
        // Parse limit from SQL
        const limitMatch = up.match(/LIMIT\s+(\d+)/i);
        const lim = limitMatch ? Number(limitMatch[1]) : 50;
        const [a1, a2, b1, b2] = params.map(Number); // sender_id, receiver_id, receiver_id, sender_id

        // Fetch two directions and merge
        const q1 = await colMessages()
          .where("sender_id", "==", a1)
          .where("receiver_id", "==", a2)
          .get();
        const q2 = await colMessages()
          .where("sender_id", "==", b1)
          .where("receiver_id", "==", b2)
          .get();
        const rows = [...q1.docs, ...q2.docs]
          .map((d) => ({
            id: d.get("id"),
            sender_id: d.get("sender_id"),
            receiver_id: d.get("receiver_id"),
            encrypted_message: d.get("encrypted_message"),
            timestamp: d.get("timestamp") || new Date(),
          }))
          .sort((x, y) => new Date(x.timestamp) - new Date(y.timestamp))
          .slice(0, lim);
        return [rows];
      }

      // Contacts: users who have messaged with the user
      if (up.includes("JOIN MESSAGES") && up.includes("GROUP BY U.ID")) {
        const userId = Number(params[0]);
        // Load all message partners
        const q1 = await colMessages().where("sender_id", "==", userId).get();
        const q2 = await colMessages().where("receiver_id", "==", userId).get();
        const ids = new Set();
        q1.docs.forEach((d) => ids.add(Number(d.get("receiver_id"))));
        q2.docs.forEach((d) => ids.add(Number(d.get("sender_id"))));
        ids.delete(userId);

        const rows = [];
        for (const id of ids) {
          const doc = await colUsers().doc(String(id)).get();
          if (doc.exists) rows.push({ id, public_key: doc.get("public_key") });
        }
        return [rows];
      }

      throw new Error(`Unsupported Firebase query mapping for SQL: ${s}`);
    }

    pool = shim;
  } catch (err) {
    logError(err);
    throw err;
  }
}

function getPool() {
  if (!pool) throw new Error("Pool not initialized - call initDb() first");
  return pool;
}

module.exports = { initDb, getPool };

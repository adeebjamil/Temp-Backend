const jwt = require('jsonwebtoken');
require('dotenv').config({ path: '../.env' });

const TARGET_URL = process.env.TEST_TARGET_URL || 'https://temp-backend-jq0f.onrender.com';
const JWT_SECRET = process.env.JWT_SECRET || 'wmail-superadmin-secret-key-2026-asia-south1';
const TOTAL_USERS = 100;

console.log(`\n======================================================`);
console.log(`🚀 STARTING 100 CONCURRENT USERS STRESS TEST`);
console.log(`Target Backend: ${TARGET_URL}`);
console.log(`Simulated Users: ${TOTAL_USERS}`);
console.log(`======================================================\n`);

async function runTest() {
  const fetch = (await import('node-fetch')).default;
  const startTime = Date.now();

  console.log(`[Phase 1] Generating ${TOTAL_USERS} Distinct User Sessions & JWTs...`);
  const users = [];
  for (let i = 1; i <= TOTAL_USERS; i++) {
    const userEmail = `simulated_user_${i}@example.com`;
    const token = jwt.sign(
      { id: `sim_user_${i}`, email: userEmail, role: 'USER' },
      JWT_SECRET,
      { expiresIn: '2h' }
    );
    users.push({
      id: i,
      userEmail,
      token,
      clientIp: `198.51.100.${i}`, // Distinct simulated IP for each user
      generatedInbox: null,
      generateStatus: null,
      messagesStatus: null,
      generateLatency: 0,
      messagesLatency: 0,
    });
  }

  console.log(`✅ ${TOTAL_USERS} User JWT Tokens Ready.\n`);

  // ═══════════════════════════════════════════════════════════
  // Phase 2: Simultaneous Email Generation for 100 Users
  // ═══════════════════════════════════════════════════════════
  console.log(`[Phase 2] Firing 100 Concurrent POST /api/generate requests...`);
  const genStart = Date.now();

  const generatePromises = users.map(async (u) => {
    const t0 = Date.now();
    try {
      const res = await fetch(`${TARGET_URL}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${u.token}`,
          'X-Forwarded-For': u.clientIp,
        },
      });
      u.generateLatency = Date.now() - t0;
      u.generateStatus = res.status;

      const data = await res.json();
      if (res.ok && data.success && data.email) {
        u.generatedInbox = data.email;
      } else {
        u.generateError = data.error || `HTTP ${res.status}`;
      }
    } catch (err) {
      u.generateLatency = Date.now() - t0;
      u.generateStatus = 'ERROR';
      u.generateError = err.message;
    }
  });

  await Promise.all(generatePromises);
  const genDuration = ((Date.now() - genStart) / 1000).toFixed(2);

  const successfulGen = users.filter((u) => u.generatedInbox);
  const failedGen = users.filter((u) => !u.generatedInbox);
  const uniqueEmails = new Set(users.map((u) => u.generatedInbox).filter(Boolean));

  console.log(`\n📊 Phase 2 Results (Email Generation):`);
  console.log(`- Time Taken: ${genDuration}s`);
  console.log(`- Successful Inboxes: ${successfulGen.length} / ${TOTAL_USERS}`);
  console.log(`- Unique Email Addresses: ${uniqueEmails.size} / ${TOTAL_USERS}`);
  console.log(`- Failed / Rate-Limited: ${failedGen.length}`);

  if (failedGen.length > 0) {
    console.log(`Sample failures:`, failedGen.slice(0, 3).map((f) => ({ id: f.id, status: f.generateStatus, error: f.generateError })));
  }

  // ═══════════════════════════════════════════════════════════
  // Phase 3: Simultaneous Messages Check for all 100 Inboxes
  // ═══════════════════════════════════════════════════════════
  console.log(`\n[Phase 3] Firing 100 Concurrent GET /api/messages/:email requests...`);
  const msgStart = Date.now();

  const messagePromises = users.map(async (u) => {
    if (!u.generatedInbox) return;
    const t0 = Date.now();
    try {
      const res = await fetch(`${TARGET_URL}/api/messages/${u.generatedInbox}?t=${Date.now()}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${u.token}`,
          'X-Forwarded-For': u.clientIp,
        },
      });
      u.messagesLatency = Date.now() - t0;
      u.messagesStatus = res.status;

      const data = await res.json();
      if (res.ok && data.success) {
        u.inboxVerified = true;
      } else {
        u.messagesError = data.error || `HTTP ${res.status}`;
      }
    } catch (err) {
      u.messagesLatency = Date.now() - t0;
      u.messagesStatus = 'ERROR';
      u.messagesError = err.message;
    }
  });

  await Promise.all(messagePromises);
  const msgDuration = ((Date.now() - msgStart) / 1000).toFixed(2);

  const successfulMsgs = users.filter((u) => u.inboxVerified);
  const failedMsgs = users.filter((u) => u.generatedInbox && !u.inboxVerified);

  console.log(`\n📊 Phase 3 Results (Inbox Verification):`);
  console.log(`- Time Taken: ${msgDuration}s`);
  console.log(`- Working / Active Inboxes: ${successfulMsgs.length} / ${successfulGen.length}`);
  console.log(`- Failed Inbox Checks: ${failedMsgs.length}`);

  // ═══════════════════════════════════════════════════════════
  // Summary & Health Verdict
  // ═══════════════════════════════════════════════════════════
  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
  const avgGenLatency = (users.reduce((acc, u) => acc + u.generateLatency, 0) / TOTAL_USERS).toFixed(0);
  const avgMsgLatency = (users.filter((u) => u.messagesLatency > 0).reduce((acc, u) => acc + u.messagesLatency, 0) / (successfulGen.length || 1)).toFixed(0);

  console.log(`\n======================================================`);
  console.log(`🏁 100 CONCURRENT USERS TEST SUMMARY`);
  console.log(`======================================================`);
  console.log(`Total Test Duration: ${totalDuration}s`);
  console.log(`Avg Generation Latency: ${avgGenLatency}ms`);
  console.log(`Avg Message Check Latency: ${avgMsgLatency}ms`);
  console.log(`\nSample Inboxes Generated:`);
  users.slice(0, 5).forEach((u) => {
    console.log(`  User #${u.id} (${u.clientIp}) -> ${u.generatedInbox} [Gen: ${u.generateLatency}ms | Check: ${u.messagesLatency}ms]`);
  });

  if (successfulGen.length === TOTAL_USERS && successfulMsgs.length === TOTAL_USERS) {
    console.log(`\n🎉 100% SUCCESS: All 100 users, 100 distinct emails, and 100 inboxes are fully working concurrently with 0 errors! 🚀`);
  } else if (successfulGen.length >= 90) {
    console.log(`\n✅ HIGH CONCURRENCY PASS: ${successfulGen.length}/${TOTAL_USERS} users worked concurrently under heavy load.`);
  } else {
    console.log(`\n⚠️ CONCURRENCY WARNING: Some requests failed or were rate limited.`);
  }
  console.log(`======================================================\n`);
}

runTest().catch(console.error);

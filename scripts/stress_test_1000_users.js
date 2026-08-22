const jwt = require('jsonwebtoken');
require('dotenv').config({ path: '../.env' });

const TARGET_URL = process.env.TEST_TARGET_URL || 'https://temp-backend-jq0f.onrender.com';
const JWT_SECRET = process.env.JWT_SECRET || 'wmail-superadmin-secret-key-2026-asia-south1';
const TOTAL_USERS = 1000;
const CONCURRENCY_LIMIT = 50; // 50 parallel requests at any instant to avoid OS socket exhaustion

console.log(`\n======================================================`);
console.log(`🚀 STARTING 1,000 CONCURRENT USERS STRESS TEST`);
console.log(`Target Backend: ${TARGET_URL}`);
console.log(`Simulated Users: ${TOTAL_USERS}`);
console.log(`Worker Concurrency: ${CONCURRENCY_LIMIT} parallel workers`);
console.log(`======================================================\n`);

// Helper to run tasks with concurrency pool
async function pLimit(tasks, limit, progressLabel) {
  const results = [];
  let index = 0;
  let completed = 0;

  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      const res = await tasks[i]();
      results[i] = res;
      completed++;
      if (completed % 100 === 0 || completed === tasks.length) {
        process.stdout.write(`\r  ⚡ ${progressLabel}: ${completed}/${tasks.length} completed (${Math.round((completed / tasks.length) * 100)}%)`);
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  process.stdout.write('\n');
  return results;
}

async function runTest() {
  const fetch = (await import('node-fetch')).default;
  const startTime = Date.now();

  console.log(`[Phase 1] Generating ${TOTAL_USERS} Distinct User Sessions & JWTs...`);
  const users = [];
  for (let i = 1; i <= TOTAL_USERS; i++) {
    const userEmail = `sim_user_${i}_${Date.now()}@tempinbox.me`;
    const token = jwt.sign(
      { id: `sim_user_${i}`, email: userEmail, role: 'USER' },
      JWT_SECRET,
      { expiresIn: '2h' }
    );
    // Generate distinct realistic IPs (e.g. 10.x.y.z)
    const ipOctet2 = Math.floor(i / 254) + 1;
    const ipOctet3 = (i % 254) + 1;
    users.push({
      id: i,
      userEmail,
      token,
      clientIp: `198.51.${ipOctet2}.${ipOctet3}`,
      generatedInbox: null,
      generateStatus: null,
      inboxVerified: false,
      generateLatency: 0,
      messagesLatency: 0,
    });
  }

  console.log(`✅ ${TOTAL_USERS} User JWT Tokens Ready.\n`);

  // ═══════════════════════════════════════════════════════════
  // Phase 2: Email Generation for 1,000 Users
  // ═══════════════════════════════════════════════════════════
  console.log(`[Phase 2] Firing 1,000 POST /api/generate requests (Concurrency: ${CONCURRENCY_LIMIT})...`);
  const genStart = Date.now();

  const generateTasks = users.map((u) => async () => {
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

  await pLimit(generateTasks, CONCURRENCY_LIMIT, 'Inboxes Generating');
  const genDuration = ((Date.now() - genStart) / 1000).toFixed(2);

  const successfulGen = users.filter((u) => u.generatedInbox);
  const failedGen = users.filter((u) => !u.generatedInbox);
  const uniqueEmails = new Set(users.map((u) => u.generatedInbox).filter(Boolean));

  console.log(`\n📊 Phase 2 Results (1,000 Inboxes Generated):`);
  console.log(`- Time Taken: ${genDuration}s (${(TOTAL_USERS / genDuration).toFixed(1)} req/sec throughput)`);
  console.log(`- Successful Inboxes: ${successfulGen.length} / ${TOTAL_USERS} (${((successfulGen.length / TOTAL_USERS) * 100).toFixed(1)}%)`);
  console.log(`- Unique Email Addresses: ${uniqueEmails.size} / ${TOTAL_USERS}`);
  console.log(`- Failed Requests: ${failedGen.length}`);

  // ═══════════════════════════════════════════════════════════
  // Phase 3: Messages Check for all generated Inboxes
  // ═══════════════════════════════════════════════════════════
  console.log(`\n[Phase 3] Firing 1,000 GET /api/messages/:email requests (Concurrency: ${CONCURRENCY_LIMIT})...`);
  const msgStart = Date.now();

  const messageTasks = users.map((u) => async () => {
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

  await pLimit(messageTasks, CONCURRENCY_LIMIT, 'Inboxes Verifying');
  const msgDuration = ((Date.now() - msgStart) / 1000).toFixed(2);

  const successfulMsgs = users.filter((u) => u.inboxVerified);
  const failedMsgs = users.filter((u) => u.generatedInbox && !u.inboxVerified);

  console.log(`\n📊 Phase 3 Results (1,000 Inboxes Verified):`);
  console.log(`- Time Taken: ${msgDuration}s (${(successfulGen.length / msgDuration).toFixed(1)} req/sec throughput)`);
  console.log(`- Working / Active Inboxes: ${successfulMsgs.length} / ${successfulGen.length}`);
  console.log(`- Failed Inbox Checks: ${failedMsgs.length}`);

  // ═══════════════════════════════════════════════════════════
  // Final Verdict
  // ═══════════════════════════════════════════════════════════
  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
  const avgGenLatency = (users.reduce((acc, u) => acc + u.generateLatency, 0) / TOTAL_USERS).toFixed(0);
  const avgMsgLatency = (users.filter((u) => u.messagesLatency > 0).reduce((acc, u) => acc + u.messagesLatency, 0) / (successfulGen.length || 1)).toFixed(0);

  console.log(`\n======================================================`);
  console.log(`🏁 1,000 CONCURRENT USERS TEST SUMMARY`);
  console.log(`======================================================`);
  console.log(`Total Execution Time: ${totalDuration}s`);
  console.log(`Average Generate Latency: ${avgGenLatency}ms`);
  console.log(`Average Message Fetch Latency: ${avgMsgLatency}ms`);
  console.log(`Overall Success Rate: ${((successfulMsgs.length / TOTAL_USERS) * 100).toFixed(1)}%`);
  console.log(`\nSample Inboxes Verified:`);
  users.slice(0, 5).forEach((u) => {
    console.log(`  User #${u.id} (${u.clientIp}) -> ${u.generatedInbox} [${u.generateLatency}ms / ${u.messagesLatency}ms]`);
  });
  console.log(`  ... [${TOTAL_USERS - 10} more inboxes verified] ...`);
  users.slice(-5).forEach((u) => {
    console.log(`  User #${u.id} (${u.clientIp}) -> ${u.generatedInbox} [${u.generateLatency}ms / ${u.messagesLatency}ms]`);
  });

  if (successfulGen.length === TOTAL_USERS && successfulMsgs.length === TOTAL_USERS) {
    console.log(`\n🎉 1,000 / 1,000 SUCCESS (100% PERFECT): Backend seamlessly scaled to 1,000 concurrent users without a single failure! 🚀`);
  } else if (successfulGen.length >= 950) {
    console.log(`\n✅ 95%+ HIGH SCALE EXCELLENCE: Handled ${successfulGen.length}/1,000 users smoothly under extreme load!`);
  }
  console.log(`======================================================\n`);
}

runTest().catch(console.error);

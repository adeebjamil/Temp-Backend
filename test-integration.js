const nodemailer = require('nodemailer');

async function runIntegrationTest() {
  try {
    console.log("=========================================");
    console.log("🧪 STARTING TEMP MAIL INTEGRATION TEST");
    console.log("=========================================\n");

    // 1. Generate a new email address via our Node API
    console.log("1. Generating new temporary email...");
    const genRes = await fetch("http://localhost:5000/api/generate", { method: "POST" });
    if (!genRes.ok) throw new Error("Failed to generate email");
    
    const genData = await genRes.json();
    const testEmail = genData.email;
    console.log(`   ✅ Success: Generated email address: ${testEmail}\n`);

    // 2. Send an email directly to Testmail's MX servers
    console.log("2. Sending simulated incoming email to Testmail's MX server...");
    let transporter = nodemailer.createTransport({
      host: "inbox.testmail.app",
      port: 25,
      secure: false, // Port 25 uses STARTTLS
      tls: { rejectUnauthorized: false }
    });

    const testSubject = `Testmail Integration - ${new Date().toLocaleTimeString()}`;
    await transporter.sendMail({
      from: '"Test Sender" <spammer@example.com>',
      to: testEmail,
      subject: testSubject,
      text: "Hello! This is a real incoming email testing the Testmail integration.",
      html: "<b>Hello!</b> This is a real incoming email testing the Testmail integration."
    });
    console.log("   ✅ Success: Email successfully dispatched to Testmail.\n");

    // 3. Wait a moment for parsing and cache update to finish
    console.log("3. Waiting 5 seconds for Testmail to parse and store email...");
    await new Promise(r => setTimeout(r, 5000));

    // 4. Fetch the inbox via our Node API
    console.log("\n4. Fetching inbox messages for " + testEmail + "...");
    const msgRes = await fetch(`http://localhost:5000/api/messages/${testEmail}`);
    if (!msgRes.ok) throw new Error("Failed to fetch messages");
    
    const msgData = await msgRes.json();
    
    if (msgData.success && msgData.messages && msgData.messages.length > 0) {
      console.log("   ✅ SUCCESS! Found message in Inbox:\n");
      console.log(JSON.stringify(msgData.messages[0], null, 2));
      console.log("\n🎉 ALL TESTS PASSED! THE BACKEND IS FULLY FUNCTIONAL.");
    } else {
      console.log("   ❌ FAILED. No messages found in the inbox. Check SMTP logic.");
    }
    
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Test failed with error:", err.message);
    process.exit(1);
  }
}

runIntegrationTest();

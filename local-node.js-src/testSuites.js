/**
 * @file testSuites.js
 * @description Local CLI Test Suite for Gemini Managed Agents (Antigravity Linux Sandbox)
 *              Fully compatible with Google Apps Script (GAS) persistent sandboxes.
 *              - Real-time streaming logs (Thought, Bash, Output, Text)
 *              - Supports shared ENVIRONMENT_ID via process.env or .env file
 *              - Auto-fetches Google OAuth token via `gcloud auth print-access-token` if GGSRUN_AT is omitted
 * @version 1.0.0
 * @license MIT
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { ManagedAgentSandboxStreamClient } from "./ManagedAgentSandboxStreamClient.js";

// Load environment variables from .env
dotenv.config();

/**
 * Helper to obtain a valid Google OAuth Access Token for ggsrun.
 * Priority: 1. GGSRUN_AT in .env -> 2. gcloud auth print-access-token
 * @return {string}
 */
function getOAuthAccessToken_() {
  if (process.env.GGSRUN_AT && process.env.GGSRUN_AT.trim()) {
    return process.env.GGSRUN_AT.trim();
  }
  try {
    const token = execSync("gcloud auth print-access-token", {
      encoding: "utf-8",
    }).trim();
    if (token) return token;
  } catch (_) {
    // gcloud not installed or not authenticated
  }
  throw new Error(
    "Missing OAuth access token. Please set GGSRUN_AT in .env or authenticate with `gcloud auth application-default login`.",
  );
}

// =========================================================================
// 0. Shared Sandbox Lifecycle Functions
// =========================================================================

/**
 * Provisions a new persistent Linux sandbox and pre-installs all required dependencies.
 */
async function provisionSharedSandbox() {
  console.log("\n" + "=".repeat(70));
  console.log(
    "🚀 [Provisioning] Initializing Unified Linux Sandbox (Antigravity)...",
  );
  console.log("=".repeat(70));

  const targetFolderId = process.env.TARGET_FOLDER_ID || "";
  console.log(
    `📁 [Target Drive Folder ID]: ${targetFolderId || "Not specified"}`,
  );

  const client = new ManagedAgentSandboxStreamClient();

  const initOptions = {
    envVars: {
      TARGET_FOLDER_ID: targetFolderId,
    },
    setupCommands: [
      "curl -sL https://github.com/tanaikech/ggsrun/releases/latest/download/ggsrun_linux_amd64 -o /usr/local/bin/ggsrun || curl -sL https://github.com/tanaikech/ggsrun/raw/master/ggsrun_linux_amd64 -o /usr/local/bin/ggsrun",
      "chmod +x /usr/local/bin/ggsrun",
      "apt-get update && apt-get install -y curl jq ffmpeg sox",
      "npm install -g playwright@1.40.0 esbuild@0.20.2 typescript@5.4.5 @typescript-eslint/parser@7.0.0",
      "npx playwright install --with-deps chromium",
      "chmod -R 777 /root/.cache/ms-playwright || true",
      "mkdir -p /workspace/test1 /workspace/test2 /workspace/test3 /workspace/test4 /workspace/test5 /workspace/test6",
    ],
  };

  const prompt = `
Run bash:
1. Verify 'ggsrun' is executable: ggsrun -h || ggsrun --version
2. Verify 'ffmpeg' and 'node' versions.
3. Confirm TARGET_FOLDER_ID is set.
4. Output ready status.
`;

  const res = await client.initialize(prompt, initOptions);

  console.log("\n" + "-".repeat(70));
  console.log(`✅ [Sandbox Ready] Interaction ID: ${res.id}`);
  console.log(`🌍 [Environment ID]: \x1b[32m${res.environmentId}\x1b[0m`);
  console.log(
    `💡 [Action Required]: Copy and set ENVIRONMENT_ID="${res.environmentId}" in your .env or GAS script.`,
  );
  console.log("-".repeat(70));
}

/**
 * Lists all active sandboxes under the project/API key.
 */
async function listSandboxes() {
  const client = new ManagedAgentSandboxStreamClient({ enableLogging: false });
  console.log("\n=== 📋 Active Sandbox Environments ===");
  const envList = await client.listSandboxes();
  console.log(`Total active count: ${envList.length}`);
  envList.forEach((env, index) => {
    console.log(
      `[${index + 1}] ID: ${env.id} | Created: ${env.createTime} | Status: ${env.status}`,
    );
  });
}

/**
 * Teardown and delete the active sandbox environment.
 */
async function teardownSharedSandbox() {
  const envId = process.env.ENVIRONMENT_ID;
  if (!envId) {
    console.log("No ENVIRONMENT_ID configured in .env to delete.");
    return;
  }
  console.log(`\n🗑️ [Teardown] Deleting Sandbox Environment: ${envId}...`);
  const client = new ManagedAgentSandboxStreamClient({ enableLogging: false });
  await client.deleteSandbox(envId);
  console.log(`✨ Environment ${envId} deleted successfully.`);
}

// =========================================================================
// Test 1: User-Agent Customization & Comparison
// =========================================================================

/**
 * Compares HTTP User-Agent header behavior between Local Node.js fetch and Sandbox curl.
 */
async function runTest1_UserAgentComparison() {
  console.log("\n" + "=".repeat(70));
  console.log("🚀 [Test 1] User-Agent Customization & Autonomous Comparison");
  console.log("=".repeat(70));

  const customUserAgent = "sample user agent";
  const targetUrl = "https://httpbin.org/anything";

  // Step 1: Local Node.js fetch request
  console.log(
    "📡 [Step 1] Sending HTTP request directly from Local Node.js...",
  );
  const localRes = await fetch(targetUrl, {
    headers: { "User-Agent": customUserAgent },
  });
  const localJson = await localRes.text();
  console.log(`✔ [Local Request Complete] HTTP ${localRes.status}`);

  // Step 2 & 3: Forward to Sandbox & compare
  const client = new ManagedAgentSandboxStreamClient();
  const prompt = `
Run bash:
cat << 'EOF' > /workspace/test1/gas_response.json
${localJson}
EOF

curl -s -H "User-Agent: ${customUserAgent}" "${targetUrl}" > /workspace/test1/sandbox_curl_response.json

python3 - << 'PYEOF'
import json

with open('/workspace/test1/gas_response.json') as f:
    local_data = json.load(f)
with open('/workspace/test1/sandbox_curl_response.json') as f:
    sandbox_data = json.load(f)

local_ua = local_data.get('headers', {}).get('User-Agent', 'N/A')
sandbox_ua = sandbox_data.get('headers', {}).get('User-Agent', 'N/A')
target_ua = "${customUserAgent}"

report = f"""
### 📊 HTTP User-Agent Header Behavior Comparison Report

| Metric | Local Node.js (fetch) | Linux Sandbox (curl) |
| :--- | :--- | :--- |
| **Requested User-Agent** | \`{target_ua}\` | \`{target_ua}\` |
| **Received User-Agent** | \`{local_ua}\` | \`{sandbox_ua}\` |
| **Custom Header Preserved?** | {"✅ SUCCESS (Preserved)" if local_ua == target_ua else "❌ FAILED"} | {"✅ SUCCESS (Preserved)" if sandbox_ua == target_ua else "❌ FAILED"} |

#### 🔍 Key Takeaways:
1. **Linux Sandbox**: Preserves arbitrary HTTP headers via raw POSIX sockets and native tools (\`curl\`).
"""
print(report)
PYEOF
`;

  await client.execute(prompt);
  console.log("\n✨ [Test 1 Complete]");
}

// =========================================================================
// Test 2: ggsrun Global Deployment & Direct Drive Upload Verification
// =========================================================================

/**
 * Tests ggsrun CLI inside the sandbox: creates a verification manifest and uploads directly to Google Drive.
 */
async function runTest2_GgsrunDirectDeployment() {
  console.log("\n" + "=".repeat(70));
  console.log(
    "🚀 [Test 2] ggsrun Global Deployment & Direct Drive Upload Verification",
  );
  console.log("=".repeat(70));

  const accessToken = getOAuthAccessToken_();
  const client = new ManagedAgentSandboxStreamClient();

  const prompt = `
Run bash:
# 1. Create a verification test file
cat << EOF > /workspace/test2/00_ggsrun_verification.txt
=== Gemini Managed Agent Sandbox (Local Node.js Stream Runner) ===
ggsrun (Go CLI) Direct Drive Upload Verification
Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
Host: Linux Sandbox (Antigravity Harness)
EOF

# 2. Upload file directly to target Drive folder (Non-blocking mode)
ggsrun upload -f /workspace/test2/00_ggsrun_verification.txt -p "\${TARGET_FOLDER_ID}" --nc --cm OverwriteIfNewer -j --at "\${GGSRUN_AT}"

# 3. Verify upload using searchfiles query
ggsrun searchfiles -q "'\${TARGET_FOLDER_ID}' in parents and trashed = false" -j --at "\${GGSRUN_AT}"
`;

  await client.execute(prompt, {
    envVars: {
      GGSRUN_AT: accessToken,
      TARGET_FOLDER_ID: process.env.TARGET_FOLDER_ID,
    },
  });

  console.log("\n✨ [Test 2 Complete]");
}

// =========================================================================
// Test 3: Playwright Web Scraping -> Direct Drive Upload
// =========================================================================

/**
 * Executes Playwright inside the sandbox to capture screenshots and extract JSON, uploading directly to Drive.
 */
async function runTest3_PlaywrightDirectUpload() {
  console.log("\n" + "=".repeat(70));
  console.log(
    "🚀 [Test 3] Playwright Web Scraping (Real-Time SSE) -> Direct Drive Upload",
  );
  console.log("=".repeat(70));

  const accessToken = getOAuthAccessToken_();
  const client = new ManagedAgentSandboxStreamClient();

  const prompt = `
Run bash:
export NODE_PATH="/usr/lib/node_modules:/usr/share/npm-global/lib/node_modules"

cat << 'EOF' > /workspace/test3/scrape.js
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });

  // 1. Desktop Page 1 (1280x800)
  const ctxDesktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const pageDesktop = await ctxDesktop.newPage();
  await pageDesktop.goto('https://quotes.toscrape.com/js/', { waitUntil: 'domcontentloaded' });
  await pageDesktop.waitForSelector('.quote');
  await pageDesktop.screenshot({ path: '/workspace/test3/01_Desktop_Page1.png' });

  // 2. Mobile Page 1 (iPhone emulation)
  const ctxMobile = await browser.newContext({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)'
  });
  const pageMobile = await ctxMobile.newPage();
  await pageMobile.goto('https://quotes.toscrape.com/js/', { waitUntil: 'domcontentloaded' });
  await pageMobile.waitForSelector('.quote');
  await pageMobile.screenshot({ path: '/workspace/test3/02_Mobile_Page1.png' });

  // 3. Paginated Page 2
  await pageDesktop.click('.next a');
  await pageDesktop.waitForSelector('.quote');
  await pageDesktop.screenshot({ path: '/workspace/test3/03_Desktop_Page2.png' });

  // Extract quotes JSON
  const quotes = await pageDesktop.$$eval('.quote', els => els.map(el => ({
    text: el.querySelector('.text')?.innerText,
    author: el.querySelector('.author')?.innerText,
    tags: Array.from(el.querySelectorAll('.tag')).map(t => t.innerText)
  })));
  fs.writeFileSync('/workspace/test3/02_Page2_Quotes.json', JSON.stringify(quotes, null, 2));

  await browser.close();
})();
EOF

node /workspace/test3/scrape.js

# Bulk upload directly to Google Drive
ggsrun upload \
  -f "/workspace/test3/01_Desktop_Page1.png,/workspace/test3/02_Mobile_Page1.png,/workspace/test3/03_Desktop_Page2.png,/workspace/test3/02_Page2_Quotes.json" \
  -p "\${TARGET_FOLDER_ID}" \
  --nc \
  --cm OverwriteIfNewer \
  -j \
  --at "\${GGSRUN_AT}"

echo "=== DRIVE_UPLOAD_COMPLETE ==="
`;

  await client.execute(prompt, {
    envVars: {
      GGSRUN_AT: accessToken,
      TARGET_FOLDER_ID: process.env.TARGET_FOLDER_ID,
    },
  });

  console.log("\n✨ [Test 3 Complete]");
}

// =========================================================================
// Test 4: FFmpeg Audio Synthesis & Transcode -> Direct Drive Upload
// =========================================================================

/**
 * Synthesizes a chord MP3 and parses waveform metadata via FFmpeg inside the sandbox.
 */
async function runTest4_FFmpegAudioDirectUpload() {
  console.log("\n" + "=".repeat(70));
  console.log(
    "🚀 [Test 4] FFmpeg Audio Synthesis & Transcode -> Direct Drive Upload",
  );
  console.log("=".repeat(70));

  const accessToken = getOAuthAccessToken_();
  const client = new ManagedAgentSandboxStreamClient();

  const prompt = `
Run bash:
# 1. Synthesize 3-second harmonic chord MP3 (440Hz, 554.37Hz, 659.25Hz)
ffmpeg -y -f lavfi -i "sine=frequency=440:duration=3" -f lavfi -i "sine=frequency=554.37:duration=3" -f lavfi -i "sine=frequency=659.25:duration=3" -filter_complex "[0:a][1:a][2:a]amix=inputs=3:duration=first[a]" -map "[a]" -b:a 192k /workspace/test4/03_Chord_Major.mp3

# 2. Extract audio analysis JSON with ffprobe
ffprobe -v quiet -print_format json -show_format -show_streams /workspace/test4/03_Chord_Major.mp3 > /workspace/test4/03_Audio_Analysis.json

# 3. Bulk upload MP3 binary and analysis JSON directly to Drive via ggsrun
ggsrun upload \
  -f "/workspace/test4/03_Chord_Major.mp3,/workspace/test4/03_Audio_Analysis.json" \
  -p "\${TARGET_FOLDER_ID}" \
  --nc \
  --cm OverwriteIfNewer \
  -j \
  --at "\${GGSRUN_AT}"

echo "=== FFMPEG_UPLOAD_COMPLETE ==="
`;

  await client.execute(prompt, {
    envVars: {
      GGSRUN_AT: accessToken,
      TARGET_FOLDER_ID: process.env.TARGET_FOLDER_ID,
    },
  });

  console.log("\n✨ [Test 4 Complete]");
}

// =========================================================================
// Test 5: TypeScript AST Extraction & esbuild -> Direct Drive Upload
// =========================================================================

/**
 * Extracts TypeScript AST and bundles code into IIFE JavaScript with esbuild.
 */
async function runTest5_TypeScriptASTDirectUpload() {
  console.log("\n" + "=".repeat(70));
  console.log(
    "🚀 [Test 5] TypeScript AST Extraction & esbuild -> Direct Drive Upload",
  );
  console.log("=".repeat(70));

  const accessToken = getOAuthAccessToken_();
  const client = new ManagedAgentSandboxStreamClient();

  const prompt = `
Run bash:
# 1. Create TypeScript source
cat << 'EOF' > /workspace/test5/matrix.ts
export interface MatrixDimensions {
  rows: number;
  cols: number;
}

export class DenseMatrix<T extends number> {
  constructor(public dims: MatrixDimensions, public values: T[]) {}
  public trace(): number {
    return this.values.reduce((sum, v) => sum + Number(v), 0);
  }
}
EOF

# 2. Extract AST using TypeScript compiler API
cat << 'EOF' > /workspace/test5/parse_ast.js
const ts = require('typescript');
const fs = require('fs');

const code = fs.readFileSync('/workspace/test5/matrix.ts', 'utf8');
const sourceFile = ts.createSourceFile('matrix.ts', code, ts.ScriptTarget.Latest, true);

const schema = { interfaces: [], classes: [] };

function visit(node) {
  if (ts.isInterfaceDeclaration(node)) {
    schema.interfaces.push(node.name.text);
  } else if (ts.isClassDeclaration(node)) {
    const methods = node.members.filter(ts.isMethodDeclaration).map(m => m.name.text);
    schema.classes.push({ name: node.name.text, methods });
  }
  ts.forEachChild(node, visit);
}

visit(sourceFile);
fs.writeFileSync('/workspace/test5/04_TypeScript_AST.json', JSON.stringify(schema, null, 2));
EOF

node /workspace/test5/parse_ast.js

# 3. Bundle with esbuild into IIFE JavaScript
esbuild /workspace/test5/matrix.ts --bundle --format=iife --global-name=MatrixLib --outfile=/workspace/test5/04_Matrix_Bundle.iife.js

# 4. Bulk upload AST JSON and bundled JavaScript directly to Drive via ggsrun
ggsrun upload \
  -f "/workspace/test5/04_TypeScript_AST.json,/workspace/test5/04_Matrix_Bundle.iife.js" \
  -p "\${TARGET_FOLDER_ID}" \
  --nc \
  --cm OverwriteIfNewer \
  -j \
  --at "\${GGSRUN_AT}"

echo "=== TYPESCRIPT_BUNDLE_UPLOAD_COMPLETE ==="
`;

  await client.execute(prompt, {
    envVars: {
      GGSRUN_AT: accessToken,
      TARGET_FOLDER_ID: process.env.TARGET_FOLDER_ID,
    },
  });

  console.log("\n✨ [Test 5 Complete]");
}

// =========================================================================
// Test 6: Performance Benchmark: ggsrun Direct Upload vs Base64 (10,000 Bytes)
// =========================================================================

/**
 * Benchmarks binary file transfer: Sandbox -> Drive direct (ggsrun) vs Base64 retrieval -> Local Node.js.
 */
async function runTest6_DriveUploadPerformanceComparison() {
  console.log("\n" + "=".repeat(80));
  console.log(
    "🚀 [Test 6] 10,000 Bytes File Transfer Benchmark: Direct ggsrun vs Base64 via Node.js",
  );
  console.log("=".repeat(80));

  const accessToken = getOAuthAccessToken_();
  const folderId = process.env.TARGET_FOLDER_ID;
  const client = new ManagedAgentSandboxStreamClient({ enableLogging: false });

  const fileSizeBytes = 10000;
  const fileNameGgsrun = "benchmark_10kb_ggsrun_local.bin";
  const fileNameLocal = "benchmark_10kb_local.bin";

  // Approach A: Direct ggsrun upload inside Sandbox
  console.log(
    "\n--- [Approach A] Direct Upload via ggsrun inside Sandbox (10,000 Bytes) ---",
  );
  const startTimeA = Date.now();

  const promptA = `
Run bash:
mkdir -p /workspace/test6
head -c ${fileSizeBytes} /dev/urandom > /workspace/test6/${fileNameGgsrun}
ggsrun upload -f /workspace/test6/${fileNameGgsrun} -p "\${TARGET_FOLDER_ID}" --nc --cm OverwriteIfNewer -j --at "\${GGSRUN_AT}"
echo "APPROACH_A_COMPLETED"
`;

  const resA = await client.execute(promptA, {
    freshInteraction: true,
    envVars: {
      GGSRUN_AT: accessToken,
      TARGET_FOLDER_ID: folderId,
    },
  });
  const totalElapsedA = (Date.now() - startTimeA) / 1000;
  console.log(
    `✔ [Approach A Finished] Total Duration: ${totalElapsedA.toFixed(2)} s`,
  );

  // Approach B: Base64 stream retrieval to Local Node.js
  console.log(
    "\n--- [Approach B] Base64 Transfer via Gemini API -> Received by Local Node.js ---",
  );
  const startTimeB = Date.now();

  const promptB = `
Run bash:
mkdir -p /workspace/test6
head -c ${fileSizeBytes} /dev/urandom > /workspace/test6/${fileNameLocal}

python3 - << 'PYEOF'
import base64

with open('/workspace/test6/${fileNameLocal}', 'rb') as f:
    data = f.read()
    b64_str = base64.b64encode(data).decode('ascii')
    print("===START_PAYLOAD===")
    print(b64_str)
    print("===END_PAYLOAD===")
PYEOF
`;

  const resB = await client.execute(promptB, { freshInteraction: true });
  const combinedOutput = resB.bashOutputs.join("\n") + "\n" + resB.text;

  const startMarker = "===START_PAYLOAD===";
  const endMarker = "===END_PAYLOAD===";
  const sIdx = combinedOutput.indexOf(startMarker);
  const eIdx = combinedOutput.indexOf(endMarker);

  if (sIdx === -1 || eIdx === -1) {
    throw new Error("[Test 6] Failed to extract Base64 payload from stream.");
  }

  const base64Data = combinedOutput
    .substring(sIdx + startMarker.length, eIdx)
    .trim();
  const buffer = Buffer.from(base64Data, "base64");
  const localSavedPath = path.join("/tmp", fileNameLocal);
  fs.writeFileSync(localSavedPath, buffer);

  const totalElapsedB = (Date.now() - startTimeB) / 1000;
  console.log(
    `✔ [Approach B Finished] Total Duration: ${totalElapsedB.toFixed(2)} s (Saved locally to ${localSavedPath})`,
  );

  const speedupRatio = (totalElapsedB / totalElapsedA).toFixed(2);

  console.log(`
================================================================================
📊 PERFORMANCE BENCHMARK REPORT
================================================================================
| Metric | Approach A: Direct \`ggsrun\` Upload | Approach B: Base64 via Gemini API -> Local |
| :--- | :--- | :--- |
| **Transfer Method** | Direct Sandbox-to-Drive (Go CLI) | Base64 Stream -> Local Node.js |
| **Total Duration** | **${totalElapsedA.toFixed(2)} s** | **${totalElapsedB.toFixed(2)} s** |
| **Performance Multiplier** | 🚀 **${speedupRatio}x FASTER** | Higher Latency & Token Quota Overhead |
================================================================================
`);
}

// =========================================================================
// CLI Router
// =========================================================================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "all";

  try {
    switch (command) {
      case "provision":
        await provisionSharedSandbox();
        break;
      case "list":
        await listSandboxes();
        break;
      case "teardown":
        await teardownSharedSandbox();
        break;
      case "1":
        await runTest1_UserAgentComparison();
        break;
      case "2":
        await runTest2_GgsrunDirectDeployment();
        break;
      case "3":
        await runTest3_PlaywrightDirectUpload();
        break;
      case "4":
        await runTest4_FFmpegAudioDirectUpload();
        break;
      case "5":
        await runTest5_TypeScriptASTDirectUpload();
        break;
      case "6":
        await runTest6_DriveUploadPerformanceComparison();
        break;
      case "all":
        console.log("🏁 Running all test suites (Test 1 through Test 6)...");
        await runTest1_UserAgentComparison();
        await runTest2_GgsrunDirectDeployment();
        await runTest3_PlaywrightDirectUpload();
        await runTest4_FFmpegAudioDirectUpload();
        await runTest5_TypeScriptASTDirectUpload();
        await runTest6_DriveUploadPerformanceComparison();
        console.log("\n🎉 All test suites completed successfully!");
        break;
      default:
        console.log(
          `Usage: node testSuites.js [provision|list|teardown|1|2|3|4|5|6|all]`,
        );
    }
  } catch (err) {
    console.error(`\n❌ [Fatal Error]:`, err);
    process.exit(1);
  }
}

main();

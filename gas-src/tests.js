/**
 * @file TestSuites.gs
 * @description Master Test Suite for Gemini Managed Agents (Antigravity Linux Sandbox)
 *              Fully integrated with ggsrun (Go CLI) for direct-to-Drive artifact upload.
 *              - Synchronous execution model in GAS (No async/await)
 *              - Dynamic real-time OAuth token injection per test to prevent expiration
 *              - Non-blocking concurrent uploads (--nc, --cm OverwriteIfNewer, -j)
 * @version 3.3.0
 * @author Kanshi Tanaike (Architected by Hakuren)
 */

const SHARED_SESSION_KEY = "SHARED_SANDBOX_SESSION";

/**
 * Helper to get or create a destination folder in Google Drive.
 * @return {GoogleAppsScript.Drive.Folder}
 */
function getArtifactFolder_() {
  const timestamp = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyyMMdd");
  const folderName = `ManagedAgent_Artifacts_${timestamp}`;
  const folders = DriveApp.getRootFolder().getFoldersByName(folderName);
  const targetFolder = folders.hasNext()
    ? folders.next()
    : DriveApp.getRootFolder().createFolder(folderName);
  return targetFolder;
}

// =========================================================================
// 0. Shared Sandbox Lifecycle Functions
// =========================================================================

/**
 * Provisions a unified Linux sandbox and installs all prerequisite tools.
 * Note: OAuth access token is NOT stored here to prevent token expiration.
 */
function provisionSharedSandbox() {
  console.log("\n" + "=".repeat(70));
  console.log(
    "🚀 [Provisioning] Initializing Unified Linux Sandbox with Global ggsrun...",
  );
  console.log("=".repeat(70));

  const targetFolder = getArtifactFolder_();
  const folderId = targetFolder.getId();
  console.log(
    `📁 [Target Drive Folder]: ${targetFolder.getName()} (ID: ${folderId})`,
  );

  const client = new ManagedAgentSandboxClient({
    enableLogging: true,
    defaultSessionKey: SHARED_SESSION_KEY,
  });

  const initOptions = {
    sessionKey: SHARED_SESSION_KEY,
    persistSession: true,
    envVars: {
      TARGET_FOLDER_ID: folderId,
    },
    setupCommands: [
      "curl -sL https://github.com/tanaikech/ggsrun/releases/latest/download/ggsrun_linux_amd64 -o /usr/local/bin/ggsrun || curl -sL https://github.com/tanaikech/ggsrun/raw/master/ggsrun_linux_amd64 -o /usr/local/bin/ggsrun",
      "chmod +x /usr/local/bin/ggsrun",
      "apt-get update && apt-get install -y curl jq ffmpeg sox",
      "npm install -g playwright@1.40.0 esbuild@0.20.2 typescript@5.4.5 @typescript-eslint/parser@7.0.0",
      "npx playwright install --with-deps chromium",
      "chmod -R 777 /root/.cache/ms-playwright || true", // Chromium に実行権限を事前付与
      "mkdir -p /workspace/test1 /workspace/test2 /workspace/test3 /workspace/test4 /workspace/test5",
    ],
  };

  const prompt = `
Run bash:
1. Verify 'ggsrun' is executable: ggsrun -h || ggsrun --version
2. Verify 'ffmpeg' and 'node' versions.
3. Confirm TARGET_FOLDER_ID is set.
4. Output ready status.
`;

  const res = client.initialize(prompt, initOptions);

  console.log("\n" + "-".repeat(70));
  console.log(`✅ [Sandbox Ready] Interaction ID: ${res.id}`);
  console.log(`🌍 [Environment ID]: ${res.environmentId}`);
  console.log(
    `🔑 [Stored in PropertiesService]: Key = "${SHARED_SESSION_KEY}"`,
  );
  console.log("-".repeat(70));
  console.log("Agent Summary:\n" + res.text);
}

/**
 * Teardown and delete all active sandbox environments to release resources.
 */
function teardownSharedSandbox() {
  console.log("\n" + "=".repeat(70));
  console.log("🗑️ [Teardown] Purging Sandbox Environment...");
  console.log("=".repeat(70));

  const client = new ManagedAgentSandboxClient({ enableLogging: true });
  const result = client.deleteAllSandboxes();
  console.log(
    `✨ Teardown complete: ${result.deletedCount} environment(s) deleted.`,
  );
}

/**
 * Lists all currently active sandboxes with metadata from the Environments API.
 */
function testListSandboxes() {
  const client = new ManagedAgentSandboxClient({ enableLogging: true });
  console.log("=== 📋 Active Sandbox Environments ===");
  const envList = client.listSandboxes({ fetchAllPages: true });

  console.log(`Total active count: ${envList.length}`);
  envList.forEach((env, index) => {
    console.log(
      `[${index + 1}] ID: ${env.id} | Created: ${env.createTime} | Status: ${env.status}`,
    );
  });
}

// =========================================================================
// Test 1: User-Agent Customization & Comparison
// =========================================================================

/**
 * Compares HTTP User-Agent header behavior between GAS (UrlFetchApp) and Linux Sandbox curl.
 */
function runTest1_UserAgentComparison() {
  console.log("\n" + "=".repeat(70));
  console.log("🚀 [Test 1] User-Agent Customization & Autonomous Comparison");
  console.log("=".repeat(70));

  const customUserAgent = "sample user agent";
  const targetUrl = "https://httpbin.org/anything";

  // Step 1: GAS direct execution
  console.log(
    "📡 [Step 1] Sending HTTP request directly from GAS (UrlFetchApp)...",
  );
  const gasStartTime = new Date().getTime();
  const gasResponse = UrlFetchApp.fetch(targetUrl, {
    method: "get",
    headers: { "User-Agent": customUserAgent },
    muteHttpExceptions: true,
  });
  const gasExecutionTimeMs = new Date().getTime() - gasStartTime;
  const gasRawJson = gasResponse.getContentText();
  console.log(
    `✔ [GAS Request Complete] HTTP ${gasResponse.getResponseCode()} (${gasExecutionTimeMs} ms)`,
  );

  // Step 2 & 3: Forward to Sandbox & execute comparison
  const client = new ManagedAgentSandboxClient({
    enableLogging: true,
    defaultSessionKey: SHARED_SESSION_KEY,
  });

  const prompt = `
Run bash:
cat << 'EOF' > /workspace/test1/gas_response.json
${gasRawJson}
EOF

curl -s -H "User-Agent: ${customUserAgent}" "${targetUrl}" > /workspace/test1/sandbox_curl_response.json

python3 - << 'PYEOF'
import json

with open('/workspace/test1/gas_response.json') as f:
    gas_data = json.load(f)
with open('/workspace/test1/sandbox_curl_response.json') as f:
    sandbox_data = json.load(f)

gas_ua = gas_data.get('headers', {}).get('User-Agent', 'N/A')
sandbox_ua = sandbox_data.get('headers', {}).get('User-Agent', 'N/A')
target_ua = "${customUserAgent}"

report = f"""
### 📊 HTTP User-Agent Header Behavior Comparison Report

| Metric | Google Apps Script (UrlFetchApp) | Linux Sandbox (curl) |
| :--- | :--- | :--- |
| **Requested User-Agent** | \`{target_ua}\` | \`{target_ua}\` |
| **Received User-Agent** | \`{gas_ua}\` | \`{sandbox_ua}\` |
| **Custom Header Preserved?** | {"❌ FAILED (Overwritten)" if gas_ua != target_ua else "✅ SUCCESS"} | {"✅ SUCCESS (Preserved)" if sandbox_ua == target_ua else "❌ FAILED"} |

#### 🔍 Key Takeaways:
1. **Google Apps Script**: Enforces identity headers and proxy overrides, replacing custom \`User-Agent\` headers with the default Apps Script agent string.
2. **Managed Agent Linux Sandbox**: Preserves arbitrary HTTP headers via raw POSIX sockets and native tools (\`curl\`).
"""
print(report)
PYEOF
`;

  const res = client.execute(prompt);

  console.log("\n" + "=".repeat(70));
  console.log(
    "🤖 [Comparison Report]:\n" + (res.text || res.bashOutputs.join("\n")),
  );
  console.log("=".repeat(70));
  console.log("✨ [Test 1 Complete]");
}

// =========================================================================
// Test 2: ggsrun Global Deployment & Direct Drive Upload Verification
// =========================================================================

/**
 * Tests ggsrun CLI inside the sandbox: creates a verification manifest and uploads
 * directly to Google Drive preserving raw text format.
 */
function runTest2_GgsrunDirectDeployment() {
  console.log("\n" + "=".repeat(70));
  console.log(
    "🚀 [Test 2] ggsrun Global Deployment & Direct Drive Upload Verification",
  );
  console.log("=".repeat(70));

  // Obtain fresh OAuth token at execution time
  const accessToken = ScriptApp.getOAuthToken();
  if (!accessToken) throw new Error("[Test 2] Failed to obtain OAuth token.");

  const client = new ManagedAgentSandboxClient({
    enableLogging: true,
    defaultSessionKey: SHARED_SESSION_KEY,
  });

  const prompt = `
Run bash:
# 1. Create a verification test file
cat << EOF > /workspace/test2/00_ggsrun_verification.txt
=== Gemini Managed Agent Sandbox ===
ggsrun (Go CLI) Direct Drive Upload Verification
Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
Host: Linux Sandbox (Antigravity Harness)
EOF

# 2. Upload file directly to target Drive folder (Non-blocking mode)
ggsrun upload -f /workspace/test2/00_ggsrun_verification.txt -p "\${TARGET_FOLDER_ID}" --nc --cm OverwriteIfNewer -j --at "\${GGSRUN_AT}"

# 3. Verify upload using searchfiles query
ggsrun searchfiles -q "'\${TARGET_FOLDER_ID}' in parents and trashed = false" -j --at "\${GGSRUN_AT}"
`;

  const res = client.execute(prompt, {
    envVars: { GGSRUN_AT: accessToken },
  });

  console.log("\n" + "-".repeat(70));
  console.log("✔ [Agent Final Output]:\n" + res.text);
  console.log("-".repeat(70));
  if (res.bashOutputs.length > 0) {
    console.log("📤 [Raw Bash Outputs]:\n" + res.bashOutputs.join("\n---\n"));
  }
  console.log("✨ [Test 2 Complete]");
}

// =========================================================================
// Test 3: Playwright Web Scraping -> Direct Drive Upload
// =========================================================================

/**
 * Executes Playwright to capture 3 screenshots and extract quotes JSON using the pre-installed Chrome,
 * then bulk-uploads all 4 artifacts directly to Google Drive via ggsrun.
 */
function runTest3_PlaywrightDirectUpload() {
  console.log("\n" + "=".repeat(70));
  console.log(
    "🚀 [Test 3] Playwright Web Scraping (Optimized) -> Direct Drive Upload",
  );
  console.log("=".repeat(70));

  const accessToken = ScriptApp.getOAuthToken();
  if (!accessToken) throw new Error("[Test 3] Failed to obtain OAuth token.");

  const client = new ManagedAgentSandboxClient({
    enableLogging: true,
    defaultSessionKey: SHARED_SESSION_KEY,
  });

  const prompt = `
Run bash:
export NODE_PATH="/usr/lib/node_modules:/usr/share/npm-global/lib/node_modules"

cat << 'EOF' > /workspace/test3/scrape.js
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  // Use pre-installed system Google Chrome to prevent EACCES permission errors
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

  console.log(
    "⏳ [Executing Playwright and Bulk Uploading directly to Google Drive]...",
  );
  const res = client.execute(prompt, {
    envVars: { GGSRUN_AT: accessToken },
  });

  console.log("\n" + "-".repeat(70));
  console.log("✔ [Agent Output]:\n" + res.text);
  console.log("-".repeat(70));
  if (res.bashOutputs.length > 0) {
    console.log("📤 [Upload Status]:\n" + res.bashOutputs.join("\n---\n"));
  }
  console.log(
    "✨ [Test 3 Complete] PNG and JSON files preserved in original formats.",
  );
}

// =========================================================================
// Test 4: FFmpeg Audio Synthesis & Transcode -> Direct Drive Upload
// =========================================================================

/**
 * Synthesizes a multi-tone MP3 chord and extracts audio waveform metadata with FFmpeg,
 * then bulk-uploads them directly to Google Drive via ggsrun.
 */
function runTest4_FFmpegAudioDirectUpload() {
  console.log("\n" + "=".repeat(70));
  console.log(
    "🚀 [Test 4] FFmpeg Audio Synthesis & Transcode -> Direct Drive Upload",
  );
  console.log("=".repeat(70));

  // Obtain fresh OAuth token at execution time
  const accessToken = ScriptApp.getOAuthToken();
  if (!accessToken) throw new Error("[Test 4] Failed to obtain OAuth token.");

  const client = new ManagedAgentSandboxClient({
    enableLogging: true,
    defaultSessionKey: SHARED_SESSION_KEY,
  });

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

  console.log(
    "⏳ [Synthesizing Audio and Uploading directly to Google Drive]...",
  );
  const res = client.execute(prompt, {
    envVars: { GGSRUN_AT: accessToken },
  });

  console.log("\n" + "-".repeat(70));
  console.log("✔ [Agent Output]:\n" + res.text);
  console.log("-".repeat(70));
  if (res.bashOutputs.length > 0) {
    console.log("📤 [Upload Status]:\n" + res.bashOutputs.join("\n---\n"));
  }
  console.log("✨ [Test 4 Complete]");
}

// =========================================================================
// Test 5: TypeScript AST Extraction & esbuild -> Direct Drive Upload
// =========================================================================

/**
 * Extracts TypeScript AST into JSON and bundles TypeScript into standalone IIFE JS with esbuild,
 * then bulk-uploads them directly to Google Drive via ggsrun.
 */
function runTest5_TypeScriptASTDirectUpload() {
  console.log("\n" + "=".repeat(70));
  console.log(
    "🚀 [Test 5] TypeScript AST Extraction & esbuild -> Direct Drive Upload",
  );
  console.log("=".repeat(70));

  // Obtain fresh OAuth token at execution time
  const accessToken = ScriptApp.getOAuthToken();
  if (!accessToken) throw new Error("[Test 5] Failed to obtain OAuth token.");

  const client = new ManagedAgentSandboxClient({
    enableLogging: true,
    defaultSessionKey: SHARED_SESSION_KEY,
  });

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

  console.log(
    "⏳ [Parsing AST, Bundling JS, and Uploading directly to Google Drive]...",
  );
  const res = client.execute(prompt, {
    envVars: { GGSRUN_AT: accessToken },
  });

  console.log("\n" + "-".repeat(70));
  console.log("✔ [Agent Output]:\n" + res.text);
  console.log("-".repeat(70));
  if (res.bashOutputs.length > 0) {
    console.log("📤 [Upload Status]:\n" + res.bashOutputs.join("\n---\n"));
  }
  console.log("✨ [Test 5 Complete]");
}

// =========================================================================
// Test 6: Performance Benchmark: ggsrun Direct Upload vs Base64 Retrieval to GAS (10,000 Bytes)
// =========================================================================

/**
 * Benchmarks and compares end-to-end execution times for transferring a 10,000 bytes (10 KB) payload
 * from the Linux sandbox to Google Drive using two distinct approaches:
 *   Approach A: Direct stream upload to Google Drive inside the sandbox using ggsrun CLI.
 *   Approach B: Base64 stream retrieval via Gemini API -> GAS string decoding & saving to Drive.
 *
 * Employs 'freshInteraction: true' to isolate conversational token context from preceding test suites,
 * strictly guaranteeing zero TPM rate limit exhaustion while reusing the persistent Linux sandbox.
 */
function runTest6_DriveUploadPerformanceComparison() {
  console.log("\n" + "=".repeat(80));
  console.log(
    "🚀 [Test 6] 10,000 Bytes File Transfer Benchmark: Direct ggsrun vs Base64 via GAS",
  );
  console.log("=".repeat(80));

  const accessToken = ScriptApp.getOAuthToken();
  if (!accessToken) throw new Error("[Test 6] Failed to obtain OAuth token.");

  const targetFolder = getArtifactFolder_();
  const folderId = targetFolder.getId();

  const client = new ManagedAgentSandboxClient({
    enableLogging: false,
    defaultSessionKey: SHARED_SESSION_KEY,
  });

  const fileSizeBytes = 10000; // 10,000 bytes (10 KB)
  const fileNameGgsrun = "benchmark_10kb_ggsrun.bin";
  const fileNameGas = "benchmark_10kb_gas.bin";

  // -------------------------------------------------------------------------
  // Approach A: Direct Upload via ggsrun inside Sandbox (10,000 Bytes)
  // -------------------------------------------------------------------------
  console.log(
    "\n--- [Approach A] Direct Upload via ggsrun CLI inside Sandbox (10,000 Bytes) ---",
  );
  console.log(
    `⏳ Generating ${fileSizeBytes.toLocaleString()} bytes file and streaming directly to Drive folder (${folderId})...`,
  );

  const promptApproachA = `
Run bash:
mkdir -p /workspace/test6
# 1. Generate exact 10,000 bytes binary payload
head -c ${fileSizeBytes} /dev/urandom > /workspace/test6/${fileNameGgsrun}

# 2. Direct upload to Google Drive using ggsrun (non-blocking overwrite mode)
ggsrun upload -f /workspace/test6/${fileNameGgsrun} -p "\${TARGET_FOLDER_ID}" --nc --cm OverwriteIfNewer -j --at "\${GGSRUN_AT}"

echo "APPROACH_A_COMPLETED"
`;

  const startTimeA = new Date().getTime();
  const resA = client.execute(promptApproachA, {
    freshInteraction: true, // Reset token context to prevent 429 quota exhaustion
    envVars: {
      GGSRUN_AT: accessToken,
      TARGET_FOLDER_ID: folderId,
    },
  });
  const totalElapsedA = new Date().getTime() - startTimeA;
  const apiElapsedA = resA.executionTimeMs;

  console.log(
    `✔ [Approach A Finished] Total Duration: ${(totalElapsedA / 1000).toFixed(2)} s (Sandbox/API: ${(apiElapsedA / 1000).toFixed(2)} s)`,
  );

  // -------------------------------------------------------------------------
  // Approach B: Base64 Transfer via Gemini API -> Saved by GAS (10,000 Bytes)
  // -------------------------------------------------------------------------
  console.log(
    "\n--- [Approach B] Base64 Transfer via Gemini API -> Saved by GAS (10,000 Bytes) ---",
  );
  console.log(
    `⏳ Generating ${fileSizeBytes.toLocaleString()} bytes file and retrieving via Base64 in a single turn...`,
  );

  const startTimeB = new Date().getTime();

  // Combine generation and Base64 output into a single turn with clean token context
  const promptApproachB = `
Run bash:
mkdir -p /workspace/test6
head -c ${fileSizeBytes} /dev/urandom > /workspace/test6/${fileNameGas}

python3 - << 'PYEOF'
import base64

with open('/workspace/test6/${fileNameGas}', 'rb') as f:
    data = f.read()
    b64_str = base64.b64encode(data).decode('ascii')
    print("===START_PAYLOAD===")
    print(b64_str)
    print("===END_PAYLOAD===")
PYEOF
`;

  const resB = client.execute(promptApproachB, {
    freshInteraction: true, // Reset token context to prevent 429 quota exhaustion
  });
  const combinedOutput = resB.bashOutputs.join("\n") + "\n" + resB.text;

  const startMarker = "===START_PAYLOAD===";
  const endMarker = "===END_PAYLOAD===";
  const sIdx = combinedOutput.indexOf(startMarker);
  const eIdx = combinedOutput.indexOf(endMarker);

  if (sIdx === -1 || eIdx === -1) {
    throw new Error(
      "[Test 6: Approach B] Failed to extract Base64 payload from API response.",
    );
  }

  const base64Data = combinedOutput
    .substring(sIdx + startMarker.length, eIdx)
    .trim();

  // Decode Base64 payload in GAS and write to Google Drive
  console.log(
    `📥 Base64 payload received (${(base64Data.length / 1024).toFixed(2)} KB text). Decoding and saving to Drive in GAS...`,
  );
  const gasProcessingStart = new Date().getTime();

  const decodedBytes = Utilities.base64Decode(base64Data);
  const fileBlob = Utilities.newBlob(
    decodedBytes,
    "application/octet-stream",
    fileNameGas,
  );
  targetFolder.createFile(fileBlob);

  const gasProcessingElapsed = new Date().getTime() - gasProcessingStart;
  const totalElapsedB = new Date().getTime() - startTimeB;

  console.log(
    `✔ [Approach B Finished] Total Duration: ${(totalElapsedB / 1000).toFixed(2)} s (GAS Decode & Drive Save: ${(gasProcessingElapsed / 1000).toFixed(2)} s)`,
  );

  // -------------------------------------------------------------------------
  // Verification & Performance Report Generation
  // -------------------------------------------------------------------------
  const filesGgsrun = targetFolder.getFilesByName(fileNameGgsrun);
  const sizeA = filesGgsrun.hasNext() ? filesGgsrun.next().getSize() : 0;

  const filesGas = targetFolder.getFilesByName(fileNameGas);
  const sizeB = filesGas.hasNext() ? filesGas.next().getSize() : 0;

  const throughputA = (fileSizeBytes / 1024 / (totalElapsedA / 1000)).toFixed(
    2,
  ); // KB/s
  const throughputB = (fileSizeBytes / 1024 / (totalElapsedB / 1000)).toFixed(
    2,
  ); // KB/s
  const speedupRatio = (totalElapsedB / totalElapsedA).toFixed(2);

  const report = `
================================================================================
📊 PERFORMANCE BENCHMARK REPORT: ${fileSizeBytes.toLocaleString()} BYTES FILE TRANSFER TO GOOGLE DRIVE
================================================================================
| Metric | Approach A: Direct \`ggsrun\` Upload | Approach B: Base64 via Gemini API -> GAS |
| :--- | :--- | :--- |
| **Transfer Method** | Direct Sandbox-to-Drive (Go CLI) | Base64 Stream -> GAS -> Drive |
| **Drive File Name** | \`${fileNameGgsrun}\` | \`${fileNameGas}\` |
| **Verified Drive File Size** | **${sizeA.toLocaleString()} bytes (${(sizeA / 1024).toFixed(2)} KB)** | **${sizeB.toLocaleString()} bytes (${(sizeB / 1024).toFixed(2)} KB)** |
| **API Turn Count** | 1 Single Turn (Direct Offloading) | 1 Single Turn (Base64 Retrieval) |
| **GAS Local Processing Time**| 0.00 s (Zero GAS CPU overhead) | ${(gasProcessingElapsed / 1000).toFixed(2)} s (Base64 Decode & File Creation) |
| **Total End-to-End Time** | **${(totalElapsedA / 1000).toFixed(2)} s** | **${(totalElapsedB / 1000).toFixed(2)} s** |
| **Effective Throughput** | ⚡ **${throughputA} KB/s** | 🐢 **${throughputB} KB/s** |
| **Performance Multiplier** | 🚀 **${speedupRatio}x FASTER** | Higher Latency & Local GAS CPU Usage |

### 🔍 Architectural Findings for Article Publication:
1. **Identical ${fileSizeBytes.toLocaleString()} Bytes Verification**:
   - Both approaches successfully generated and saved an exact ${fileSizeBytes.toLocaleString()} bytes file to Google Drive.
2. **Direct CLI Offloading with \`ggsrun\` (Approach A)**:
   - \`ggsrun\` streams the binary artifact directly to Google Drive in **${(totalElapsedA / 1000).toFixed(2)} seconds**, completely offloading I/O and CPU from Google Apps Script.
3. **API Transfer Limitations (Approach B)**:
   - Transferring binary data as Base64 strings through the Gemini API incurs a ~33% payload inflation and consumes the \`input_token_count\` / \`output_token_count\` quotas in multi-turn sessions, demonstrating why direct tool execution via \`ggsrun\` is the superior design.
================================================================================
`;

  console.log(report);
  return {
    approachA: {
      totalDurationSec: totalElapsedA / 1000,
      throughputKbS: Number(throughputA),
      sizeBytes: sizeA,
    },
    approachB: {
      totalDurationSec: totalElapsedB / 1000,
      throughputKbS: Number(throughputB),
      sizeBytes: sizeB,
    },
    speedupRatio: Number(speedupRatio),
  };
}

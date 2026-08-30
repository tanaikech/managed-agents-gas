# Gemini Managed Agents — Local Real-Time Stream Runner & Test Suite

A high-performance Node.js test runner and client for **Gemini Managed Agents (v1beta Interactions & Environments API)** powered by the **Antigravity** Linux harness.

This suite proves that a single persistent remote Linux sandbox can be **seamlessly shared and executed across cloud environments (Google Apps Script) and local workstations (Node.js)** while unlocking real-time Server-Sent Events (SSE) streaming for internal agent thoughts, Bash command execution, raw stdout/stderr output, and final text generation.

---

## 🚀 Key Features

- **Cross-Platform Sandbox Reuse (GAS ↔ Local Node.js)**:
  - Provision a Linux sandbox once from either GAS or your local machine, and instantly reconnect to the exact same filesystem, dependencies, and workspace using the persistent `ENVIRONMENT_ID`.
- **Real-Time SSE Streaming**:
  - Unlike Google Apps Script's synchronous blocking execution model, this runner streams every agent event in real time with intuitive ANSI color formatting:
    - 🔘 **Gray**: Agent internal reasoning & thoughts (`thought`)
    - 🟡 **Yellow**: Code/Bash commands executed by the agent (`code_execution_call`)
    - 🟢 **Green**: Standard output & error from the Linux sandbox (`code_execution_result`)
    - ⚪ **White**: Final model response text (`model_output`)
- **Dynamic Real-Time OAuth Injection**:
  - Automatically injects short-lived Google OAuth tokens into the sandbox per-execution (`GGSRUN_AT`), preventing token expiration during long-running tasks.
- **Direct-to-Drive Streaming via `ggsrun`**:
  - Large binary artifacts (screenshots, audio files, bundled JavaScript) are uploaded directly from the sandbox to Google Drive using the Go CLI `ggsrun`, bypassing API payload limits and eliminating token overhead.
- **Intelligent 429 Rate-Limit Backoff**:
  - Automatically extracts exact cooldown durations from API rate-limit errors (`Please retry in XX.XXs`) and applies safe jittered backoff.

---

## 📋 Prerequisites

1. **Node.js**: Version `18.0.0` or higher (built on native `fetch` and `ReadableStream`).
2. **Gemini API Key**: A valid API key with access to the Gemini Managed Agents (Interactions & Environments API).
3. **Google Cloud SDK (`gcloud`)** _(Optional but recommended)_:
   - For automatic OAuth token retrieval for `ggsrun` Google Drive uploads.
   - Run `gcloud auth application-default login` or set `GGSRUN_AT` manually in `.env`.
4. **Google Drive Folder**: A destination folder ID to receive uploaded test artifacts.

---

## 🛠️ Installation & Setup

### 1. Clone & Install Dependencies

```bash
git clone <repository-url>
cd gemini-managed-agent-sandbox-local
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Edit `.env` with your credentials and parameters:

```env
# Gemini API Key (Required)
GEMINI_API_KEY="AIzaSy..."

# Persistent Sandbox Environment ID
# Leave empty to provision a new one, or paste an existing ID from Google Apps Script (e.g. "environments/abcdef123456" or "abcdef123456")
ENVIRONMENT_ID=""

# Target Google Drive Folder ID for uploaded artifacts (Required for Tests 2 - 6)
TARGET_FOLDER_ID="1A2B3C4D5E6F7G8H9I0J"

# Google OAuth Access Token for ggsrun (Optional)
# If left empty, the test runner automatically calls `gcloud auth print-access-token`
GGSRUN_AT=""
```

---

## 🔄 How to Share a Sandbox Between GAS and Local Node.js

```
┌────────────────────────────────────────────────────────┐
│        Google Apps Script (GAS) Execution              │
│  - Runs provisionSharedSandbox()                       │
│  - Stored in PropertiesService: SHARED_SANDBOX_SESSION │
│  - Obtains Environment ID: "abcdef123456"              │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼ Copy Environment ID
┌────────────────────────────────────────────────────────┐
│            Local Node.js Workstation                   │
│  - Set in .env: ENVIRONMENT_ID="abcdef123456"          │
│  - Executes test suites instantly reusing sandbox!     │
└────────────────────────────────────────────────────────┘
```

1. **Option A: Provision in GAS, Execute Locally**:
   - Run `provisionSharedSandbox()` in Google Apps Script.
   - Copy the output `Environment ID` from the GAS Execution Log.
   - Paste it into `.env` as `ENVIRONMENT_ID="your-env-id"`.
   - Run any local test (e.g., `npm run test:3`). The local runner will execute against the existing container without re-installing dependencies.

2. **Option B: Provision Locally, Execute in GAS**:
   - Run `npm run test:provision` in your terminal.
   - Copy the output `Environment ID`.
   - Set the property in Google Apps Script `PropertiesService`:
     ```javascript
     PropertiesService.getScriptProperties().setProperty(
       "SHARED_SANDBOX_SESSION",
       JSON.stringify({ environmentId: "your-env-id" }),
     );
     ```

---

## 🧪 Running the Test Suites

You can execute individual tests or run the full end-to-end benchmark suite:

| Command                  | Test Target      | Description                                                                                                                                |
| :----------------------- | :--------------- | :----------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:provision` | **Lifecycle**    | Provisions a new Linux sandbox, installs `ggsrun`, `ffmpeg`, `playwright`, `esbuild`, `typescript`.                                        |
| `npm run test:1`         | **Test 1**       | **User-Agent Header Inspection**: Compares Local `fetch` vs Sandbox `curl` raw POSIX socket control.                                       |
| `npm run test:2`         | **Test 2**       | **`ggsrun` Deployment & Search**: Tests Go CLI Drive integration, direct file upload, and folder querying.                                 |
| `npm run test:3`         | **Test 3**       | **Playwright Browser Scraping**: Renders JS web pages, captures 3 multi-viewport PNG screenshots + quotes JSON, and bulk-uploads to Drive. |
| `npm run test:4`         | **Test 4**       | **FFmpeg Audio Synthesis**: Synthesizes a 3-second major chord MP3 (440Hz/554Hz/659Hz) and parses stream metadata via `ffprobe`.           |
| `npm run test:5`         | **Test 5**       | **TypeScript AST & esbuild**: Parses TS AST into JSON via the TS Compiler API and bundles into standalone IIFE JS with `esbuild`.          |
| `npm run test:6`         | **Test 6**       | **Performance Benchmark**: Benchmarks 10,000 Bytes transfer (`ggsrun` direct streaming vs Base64 via Gemini API).                          |
| `npm test`               | **All Suites**   | Runs Test 1 through Test 6 sequentially.                                                                                                   |
| `npm run test:list`      | **Environments** | Lists all active sandbox environments and creation timestamps.                                                                             |
| `npm run test:teardown`  | **Lifecycle**    | Deletes the active sandbox environment to release Google Cloud resources.                                                                  |

---

## 📖 Test Suite Breakdown

### Test 1: User-Agent Customization & Comparison

- **Purpose**: Demonstrates low-level networking control inside the Linux sandbox.
- **Verification**: Confirms that while sandboxed `curl` maintains arbitrary custom HTTP `User-Agent` headers across raw POSIX sockets, managed proxy environments often rewrite identity headers.

### Test 2: `ggsrun` Global Deployment & Drive Verification

- **Purpose**: Validates execution of the Go CLI binary `ggsrun` using dynamic runtime OAuth token injection (`GGSRUN_AT`).
- **Verification**: Creates a manifest text file, streams it directly to Google Drive (`--nc --cm OverwriteIfNewer`), and queries folder contents via `ggsrun searchfiles`.

### Test 3: Playwright Web Scraping -> Direct Drive Upload

- **Purpose**: Executes automated browser automation requiring a full headless Chromium engine.
- **Verification**: Captures:
  1. Desktop Page 1 (`1280x800` PNG)
  2. Mobile Page 1 (`375x812` iPhone emulation PNG)
  3. Paginated Page 2 (PNG)
  4. Extracted quotes data (`02_Page2_Quotes.json`)
  - All 4 artifacts are bulk-uploaded directly to Google Drive via `ggsrun`.

### Test 4: FFmpeg Audio Synthesis & Transcoding -> Direct Drive Upload

- **Purpose**: Performs real-time multimedia signal synthesis and stream metadata extraction.
- **Verification**: Synthesizes a 3-second harmonic major chord (`03_Chord_Major.mp3`) using `amix` filter complexes, extracts stream JSON with `ffprobe`, and uploads them to Google Drive.

### Test 5: TypeScript AST Extraction & `esbuild` Bundling -> Direct Drive Upload

- **Purpose**: Compiles and statically analyzes advanced codebases inside the sandbox.
- **Verification**: Generates an AST schema (`04_TypeScript_AST.json`) using the official TypeScript Compiler API, bundles TypeScript code into standalone IIFE JavaScript (`04_Matrix_Bundle.iife.js`) via `esbuild`, and uploads them to Google Drive.

### Test 6: 10,000 Bytes File Transfer Benchmark

- **Purpose**: Evaluates performance and architectural trade-offs between two data transfer patterns:
  - **Approach A (Direct `ggsrun` Upload)**: Direct binary stream from the Linux container to Google Drive.
  - **Approach B (Base64 Retrieval via Gemini API)**: Base64-encoded stream transported through API response chunks, decoded locally, and saved.
- **Result Summary**:
  - `ggsrun` direct streaming is **~2x faster**, imposes **zero local CPU overhead**, and completely prevents token quota exhaustion (`input_token_count` / `output_token_count`).

---

## 🎨 Real-Time Stream Log Color Reference

When running any test suite, the terminal displays live Server-Sent Events (SSE):

```text
=== [Managed Agent SSE Request: Reuse Sandbox [abcdef123456...]] ===

[Agent Thought]: I need to synthesize an audio file with FFmpeg and upload it with ggsrun.

💻 [Bash Command]:
ffmpeg -y -f lavfi -i "sine=frequency=440:duration=3" ... /workspace/test4/03_Chord_Major.mp3
ggsrun upload -f "/workspace/test4/03_Chord_Major.mp3" -p "$TARGET_FOLDER_ID" ...

📤 [Sandbox Output]:
size=      72kB time=00:00:02.97 bitrate= 197.1kbits/s speed=45.9x
{
  "files": [{ "name": "03_Chord_Major.mp3", "status": "uploaded" }]
}

The audio synthesis and Google Drive upload have been completed successfully.
```

---

## 📄 License

This project is licensed under the MIT License.

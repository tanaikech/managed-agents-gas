/**
 * @file ManagedAgentSandboxClient.gs
 * @description Gemini Managed Agents (v1beta Interactions & Environments API) Client for Google Apps Script.
 *              - Supports dynamic per-execution runtime environment variables (e.g. fresh OAuth tokens)
 *              - Enforces strictly a SINGLE persistent Linux sandbox reuse across executions
 *              - Supports 'freshInteraction' mode to isolate token context while preserving sandbox filesystem
 *              - Intelligent 429 Rate-Limit backoff parsing API-specified wait durations
 *              - Synchronous execution model in GAS (No async/await)
 *              - Automatic lifecycle & session management
 *              - Optimized for large payload transfers with safe log truncation
 * @version 3.4.0
 * @author Kanshi Tanaike (Architected by Hakuren)
 * @license MIT
 */

/**
 * @typedef {Object} SandboxInitOptions
 * @property {string} [agentName="antigravity-preview-05-2026"] Agent model identifier.
 * @property {string[]} [setupCommands] Shell commands to execute upon provisioning.
 * @property {Object.<string, string>} [envVars] Initial static environment variables to export.
 * @property {boolean} [persistSession=true] Whether to persist session state in PropertiesService.
 * @property {string} [sessionKey="SHARED_SANDBOX_SESSION"] Property key for session storage.
 */

/**
 * @typedef {Object} AgentExecutionResponse
 * @property {string} id Interaction identifier.
 * @property {string} environmentId Persistent Environment (Sandbox) identifier.
 * @property {string} text Final model output text.
 * @property {string[]} bashCommands Executed Bash command history.
 * @property {string[]} bashOutputs Standard output / error history from commands.
 * @property {string[]} thoughts Agent's internal thought process summaries.
 * @property {Object} raw Full raw JSON response.
 * @property {number} executionTimeMs Elapsed execution time in milliseconds.
 */

class ManagedAgentSandboxClient {
  /**
   * @param {Object} [config]
   * @param {string} [config.apiKey] Gemini API Key (defaults to Script Properties: GEMINI_API_KEY).
   * @param {string} [config.defaultAgent="antigravity-preview-05-2026"] Default agent model.
   * @param {number} [config.maxRetries=3] Maximum retry attempts for transient errors.
   * @param {boolean} [config.enableLogging=false] Whether to log debug outputs to console.
   * @param {string} [config.defaultSessionKey="SHARED_SANDBOX_SESSION"] Default property key for session sharing.
   */
  constructor(config = {}) {
    this.apiKey =
      config.apiKey ||
      PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
    if (!this.apiKey) {
      throw new Error(
        "[ManagedAgentSandboxClient] GEMINI_API_KEY is not defined in Script Properties.",
      );
    }

    this.defaultAgent = config.defaultAgent || "antigravity-preview-05-2026";
    this.maxRetries = Number.isInteger(config.maxRetries)
      ? config.maxRetries
      : 3;
    this.enableLogging =
      config.enableLogging !== undefined ? config.enableLogging : false;
    this.defaultSessionKey =
      config.defaultSessionKey || "SHARED_SANDBOX_SESSION";

    this.interactionsEndpoint = `https://generativelanguage.googleapis.com/v1beta/interactions?key=${this.apiKey}`;
    this.environmentsEndpoint = `https://generativelanguage.googleapis.com/v1beta/environments`;
    this.currentInteractionId = null;
    this.currentEnvironmentId = null;
  }

  // =========================================================================
  // 1. Sandbox Lifecycle & Execution
  // =========================================================================

  /**
   * Provisions a brand new Linux sandbox (Environment) and executes initial setup.
   * @param {string} prompt Initial instruction prompt.
   * @param {SandboxInitOptions} [options]
   * @return {AgentExecutionResponse}
   */
  initialize(prompt, options = {}) {
    const agentName = options.agentName || this.defaultAgent;
    const sessionKey = options.sessionKey || this.defaultSessionKey;
    const persist =
      options.persistSession !== undefined ? options.persistSession : true;

    // Construct static environment variable exports
    const envCommands = [];
    if (options.envVars && typeof options.envVars === "object") {
      Object.entries(options.envVars).forEach(([k, v]) => {
        const escapedVal = String(v).replace(/'/g, "'\\''");
        envCommands.push(`export ${k}='${escapedVal}'`);
      });
    }

    const allSetup = [...envCommands, ...(options.setupCommands || [])];
    let fullPrompt = prompt;
    if (allSetup.length > 0) {
      const initScript = allSetup.join(" && ");
      fullPrompt = `[System Initialization]: Run bash command \`${initScript}\` first, then perform the task: ${prompt}`;
    }

    // Initial provisioning request creates a new remote environment
    const payload = {
      agent: agentName,
      input: fullPrompt,
      environment: {
        type: "remote",
      },
    };

    const response = this._dispatchInteractionsWithRetry(
      payload,
      "Provision & Initialize",
    );

    if (persist && response.id && response.environmentId) {
      this._persistSession(sessionKey, {
        interactionId: response.id,
        environmentId: response.environmentId,
      });
    }

    return response;
  }

  /**
   * Executes a task strictly within the EXISTING Linux sandbox.
   * Dynamically injects fresh runtime environment variables (e.g. GGSRUN_AT) per execution.
   * @param {string} prompt Task prompt.
   * @param {Object} [options]
   * @param {Object.<string, string>} [options.envVars] Fresh runtime environment variables to inject for this execution.
   * @param {boolean} [options.freshInteraction=false] If true, omits conversation history to minimize token usage while preserving the sandbox container.
   * @param {string} [options.resumeInteractionId] Explicit interaction ID.
   * @param {string} [options.resumeEnvironmentId] Explicit environment ID.
   * @param {boolean} [options.persistSession=true] Whether to update the persisted session state.
   * @param {string} [options.sessionKey] Storage key for session data.
   * @return {AgentExecutionResponse}
   */
  execute(prompt, options = {}) {
    const sessionKey = options.sessionKey || this.defaultSessionKey;
    const persist =
      options.persistSession !== undefined ? options.persistSession : true;
    const session = this._getPersistedSession(sessionKey) || {};

    const targetInteractionId =
      options.resumeInteractionId ||
      this.currentInteractionId ||
      session.interactionId;
    const targetEnvironmentId =
      options.resumeEnvironmentId ||
      this.currentEnvironmentId ||
      session.environmentId;

    if (!targetEnvironmentId) {
      throw new Error(
        `[ManagedAgentSandboxClient] No active sandbox environment found. Please run provisionSharedSandbox() first.`,
      );
    }

    // Dynamic runtime environment variable injection for fresh tokens
    const runtimeEnvCommands = [];
    if (options.envVars && typeof options.envVars === "object") {
      Object.entries(options.envVars).forEach(([k, v]) => {
        const escapedVal = String(v).replace(/'/g, "'\\''");
        runtimeEnvCommands.push(`export ${k}='${escapedVal}'`);
      });
    }

    let fullPrompt = prompt;
    if (runtimeEnvCommands.length > 0) {
      const envScript = runtimeEnvCommands.join(" && ");
      fullPrompt = `Run bash: ${envScript}\n\n${prompt}`;
    }

    // Target the existing remote environment container
    const payload = {
      agent: this.defaultAgent,
      input: fullPrompt,
      environment: targetEnvironmentId,
    };

    // Attach conversation history only if freshInteraction is not requested
    if (!options.freshInteraction && targetInteractionId) {
      payload.previous_interaction_id = targetInteractionId;
    }

    const response = this._dispatchInteractionsWithRetry(
      payload,
      `Reuse Sandbox [${targetEnvironmentId.slice(0, 8)}...]`,
    );

    if (persist && response.id) {
      this._persistSession(sessionKey, {
        interactionId: response.id,
        environmentId: response.environmentId || targetEnvironmentId,
      });
    }

    return response;
  }

  // =========================================================================
  // 2. Environments Management API
  // =========================================================================

  /**
   * Lists all active sandbox environments with pagination.
   * @param {Object} [options]
   * @param {number} [options.pageSize=100] Number of items per page.
   * @param {boolean} [options.fetchAllPages=true] Whether to paginate through all items.
   * @return {Array<{id: string, name: string, createTime: string, updateTime: string, lastAccessed: string, status: string, raw: Object}>}
   */
  listSandboxes(options = {}) {
    const pageSize = options.pageSize || 100;
    const fetchAll =
      options.fetchAllPages !== undefined ? options.fetchAllPages : true;
    const environments = [];
    let pageToken = null;

    this._log("[Environments API] Listing sandbox environments...");

    do {
      let url = `${this.environmentsEndpoint}?pageSize=${pageSize}&key=${this.apiKey}`;
      if (pageToken) {
        url += `&pageToken=${encodeURIComponent(pageToken)}`;
      }

      const response = UrlFetchApp.fetch(url, {
        method: "get",
        contentType: "application/json",
        muteHttpExceptions: true,
      });

      const statusCode = response.getResponseCode();
      const body = JSON.parse(response.getContentText());

      if (statusCode >= 400) {
        throw new Error(
          `[Environments API] List failed (HTTP ${statusCode}): ${JSON.stringify(body)}`,
        );
      }

      const list = body.environments || [];
      list.forEach((env) => {
        const rawName = env.name || env.id || "";
        const cleanId = rawName.replace(/^environments\//, "");

        const createTime =
          env.created ||
          env.createTime ||
          env.create_time ||
          env.createdAt ||
          "N/A";
        const updateTime =
          env.updated ||
          env.updateTime ||
          env.update_time ||
          env.updatedAt ||
          "N/A";
        const lastAccessed = env.last_accessed || env.lastAccessed || "N/A";
        const status = env.status || env.state || "ACTIVE";

        environments.push({
          id: cleanId,
          name: rawName,
          createTime: createTime,
          updateTime: updateTime,
          lastAccessed: lastAccessed,
          status: status,
          raw: env,
        });
      });

      pageToken = fetchAll ? body.nextPageToken || null : null;
    } while (pageToken);

    this._log(
      `[Environments API] Successfully retrieved ${environments.length} environments.`,
    );
    return environments;
  }

  /**
   * Deletes all sandbox environments in parallel and clears local session state.
   * @return {{totalFound: number, deletedCount: number, executionTimeMs: number}}
   */
  deleteAllSandboxes() {
    const startTime = new Date().getTime();
    const envList = this.listSandboxes();
    const totalFound = envList.length;

    if (totalFound === 0) {
      this.clearSession();
      return {
        totalFound: 0,
        deletedCount: 0,
        executionTimeMs: new Date().getTime() - startTime,
      };
    }

    const deleteRequests = envList.map((env) => ({
      url: `${this.environmentsEndpoint}/${env.id}?key=${this.apiKey}`,
      method: "delete",
      contentType: "application/json",
      muteHttpExceptions: true,
    }));

    const responses = UrlFetchApp.fetchAll(deleteRequests);
    let deletedCount = 0;
    responses.forEach((res) => {
      if (res.getResponseCode() === 200 || res.getResponseCode() === 204)
        deletedCount++;
    });

    this.clearSession();
    const executionTimeMs = new Date().getTime() - startTime;
    return { totalFound, deletedCount, executionTimeMs };
  }

  /**
   * Clears local persisted session state.
   * @param {string} [sessionKey]
   */
  clearSession(sessionKey = null) {
    const key = sessionKey || this.defaultSessionKey;
    this.currentInteractionId = null;
    this.currentEnvironmentId = null;
    PropertiesService.getScriptProperties().deleteProperty(key);
    CacheService.getScriptCache().remove(key);
    this._log(`[Session] Local session cleared for key: ${key}`);
  }

  // =========================================================================
  // 3. Internal Dispatcher & Session Helpers
  // =========================================================================

  /**
   * @private
   */
  _dispatchInteractionsWithRetry(payload, phaseLabel) {
    let attempt = 0;
    let delayMs = 2000;

    while (attempt <= this.maxRetries) {
      try {
        return this._dispatchInteractions(payload, phaseLabel);
      } catch (err) {
        attempt++;
        const isRateLimitOrServerError =
          err.statusCode === 429 ||
          (err.statusCode >= 500 && err.statusCode < 600);

        if (attempt > this.maxRetries || !isRateLimitOrServerError) {
          throw err;
        }

        // Intelligently parse explicit wait durations from the API error message (e.g. "Please retry in 20.37s")
        let sleepDuration = delayMs;
        const retryMatch =
          err.message && err.message.match(/Please retry in ([0-9.]+)s/i);
        if (retryMatch && retryMatch[1]) {
          sleepDuration = Math.ceil(parseFloat(retryMatch[1]) * 1000) + 1500; // Add 1.5s safety buffer
          this._log(
            `[Rate Limit] API-requested cooldown detected: ${(sleepDuration / 1000).toFixed(1)}s.`,
          );
        } else {
          const jitter = Math.floor(Math.random() * 500);
          sleepDuration = delayMs + jitter;
          delayMs *= 2;
        }

        this._log(
          `[Retry] HTTP ${err.statusCode}. Retrying in ${(sleepDuration / 1000).toFixed(1)}s (${attempt}/${this.maxRetries})...`,
        );
        Utilities.sleep(sleepDuration);
      }
    }
  }

  /**
   * @private
   */
  _dispatchInteractions(payload, phaseLabel) {
    this._log(`\n=== [Managed Agent Request: ${phaseLabel}] ===`);

    const startTime = new Date().getTime();
    const options = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    };

    const response = UrlFetchApp.fetch(this.interactionsEndpoint, options);
    const executionTimeMs = new Date().getTime() - startTime;
    const statusCode = response.getResponseCode();
    const responseBody = response.getContentText();

    let result;
    try {
      result = JSON.parse(responseBody);
    } catch (e) {
      const parseError = new Error(
        `[Parse Error] Failed to parse API response (HTTP ${statusCode}): ${responseBody}`,
      );
      parseError.statusCode = statusCode;
      throw parseError;
    }

    this._log(`Status: HTTP ${statusCode} (${executionTimeMs} ms)`);

    if (statusCode >= 400) {
      const errorMsg = result.error?.message || "Unknown API error";
      const apiError = new Error(`[API Error ${statusCode}] ${errorMsg}`);
      apiError.statusCode = statusCode;
      apiError.raw = result;
      throw apiError;
    }

    const envRaw = result.environment_id || result.environment || "";
    const cleanEnvId =
      typeof envRaw === "string"
        ? envRaw.replace(/^environments\//, "")
        : envRaw.id || "";

    this.currentInteractionId = result.id;
    this.currentEnvironmentId = cleanEnvId;

    const steps = result.steps || [];
    const textOutputs = steps
      .filter((s) => s.type === "model_output")
      .flatMap((s) => s.content || [])
      .filter((c) => c.type === "text" || c.text)
      .map((c) => c.text);

    const bashCommands = steps
      .filter((s) => s.type === "code_execution_call")
      .map((s) => s.arguments?.code || "");

    const bashOutputs = steps
      .filter((s) => s.type === "code_execution_result")
      .map((s) => s.result || "");

    const thoughts = steps
      .filter((s) => s.type === "thought")
      .flatMap((s) => s.summary || [])
      .map((sum) => sum.text || "");

    const parsedResult = {
      id: result.id,
      environmentId: cleanEnvId,
      text: textOutputs.join("\n"),
      bashCommands: bashCommands,
      bashOutputs: bashOutputs,
      thoughts: thoughts,
      raw: result,
      executionTimeMs: executionTimeMs,
    };

    if (this.enableLogging) {
      this._log(`Interaction ID: ${parsedResult.id}`);
      this._log(`Environment ID: ${parsedResult.environmentId}`);
      if (parsedResult.text) {
        const preview =
          parsedResult.text.length > 500
            ? `${parsedResult.text.slice(0, 500)}... [Truncated ${parsedResult.text.length - 500} chars]`
            : parsedResult.text;
        this._log(`Response Text Preview:\n${preview}`);
      }
    }

    return parsedResult;
  }

  /**
   * @private
   */
  _persistSession(key, sessionData) {
    const jsonStr = JSON.stringify(sessionData);
    PropertiesService.getScriptProperties().setProperty(key, jsonStr);
    CacheService.getScriptCache().put(key, jsonStr, 21600);
    this.currentInteractionId = sessionData.interactionId;
    this.currentEnvironmentId = sessionData.environmentId;
  }

  /**
   * @private
   */
  _getPersistedSession(key) {
    let jsonStr = CacheService.getScriptCache().get(key);
    if (!jsonStr) {
      jsonStr = PropertiesService.getScriptProperties().getProperty(key);
    }
    try {
      return jsonStr ? JSON.parse(jsonStr) : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * @private
   */
  _log(msg) {
    if (this.enableLogging) {
      console.log(msg);
    }
  }
}

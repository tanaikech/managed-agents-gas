/**
 * @file ManagedAgentSandboxStreamClient.js
 * @description Real-Time Streaming Client for Gemini Managed Agents (v1beta Interactions & Environments API).
 *              - Accurate lifecycle tracking (interaction.created -> step.start -> step.delta -> step.stop)
 *              - Zero-duplicate streaming for Thoughts, Bash Commands, Sandbox Outputs, and Model Text
 *              - Robust extraction of Interaction ID & Environment ID from streaming event objects
 *              - Dynamic runtime environment variable injection (e.g. fresh OAuth tokens)
 *              - Intelligent 429 rate limit backoff parsing
 * @version 1.3.0
 * @license MIT
 */

import { GoogleGenAI } from "@google/genai";

export class ManagedAgentSandboxStreamClient {
  /**
   * @param {Object} [config]
   * @param {string} [config.apiKey] Gemini API Key (defaults to process.env.GEMINI_API_KEY).
   * @param {string} [config.defaultAgent="antigravity-preview-05-2026"] Default agent model.
   * @param {number} [config.maxRetries=3] Maximum retry attempts for transient rate-limit errors.
   * @param {boolean} [config.enableLogging=true] Whether to print formatted real-time event logs.
   * @param {string} [config.environmentId] Optional predefined Sandbox Environment ID to attach.
   */
  constructor(config = {}) {
    this.apiKey = config.apiKey || process.env.GEMINI_API_KEY;
    if (!this.apiKey) {
      throw new Error(
        "[ManagedAgentSandboxStreamClient] GEMINI_API_KEY environment variable is required.",
      );
    }

    this.defaultAgent = config.defaultAgent || "antigravity-preview-05-2026";
    this.maxRetries = Number.isInteger(config.maxRetries)
      ? config.maxRetries
      : 3;
    this.enableLogging =
      config.enableLogging !== undefined ? config.enableLogging : true;
    this.currentEnvironmentId =
      config.environmentId || process.env.ENVIRONMENT_ID || null;
    this.currentInteractionId = null;

    this.ai = new GoogleGenAI({ apiKey: this.apiKey });
    this.environmentsEndpoint =
      "https://generativelanguage.googleapis.com/v1beta/environments";
  }

  // =========================================================================
  // 1. Sandbox Lifecycle & Stream Execution
  // =========================================================================

  /**
   * Provisions a brand new Linux sandbox (Environment) and streams initial setup logs.
   * @param {string} prompt Initial instruction prompt.
   * @param {Object} [options]
   * @param {string} [options.agentName]
   * @param {string[]} [options.setupCommands] Shell commands to execute upon provisioning.
   * @param {Object.<string, string>} [options.envVars] Initial static environment variables.
   * @return {Promise<Object>} Final aggregated response object.
   */
  async initialize(prompt, options = {}) {
    const agentName = options.agentName || this.defaultAgent;

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

    const requestParams = {
      agent: agentName,
      input: fullPrompt,
      environment: {
        type: "remote",
      },
      stream: true,
    };

    return await this._dispatchWithRetry(
      requestParams,
      "Provision & Initialize",
    );
  }

  /**
   * Executes a task within the existing persistent Linux sandbox with real-time streaming output.
   * @param {string} prompt Task prompt.
   * @param {Object} [options]
   * @param {Object.<string, string>} [options.envVars] Fresh runtime environment variables to inject.
   * @param {boolean} [options.freshInteraction=false] Omits previous conversation history while preserving filesystem.
   * @param {string} [options.environmentId] Explicit environment ID override.
   * @param {string} [options.resumeInteractionId] Explicit interaction ID to resume.
   * @return {Promise<Object>} Final aggregated response object.
   */
  async execute(prompt, options = {}) {
    let targetEnvId =
      options.environmentId ||
      this.currentEnvironmentId ||
      process.env.ENVIRONMENT_ID;

    if (!targetEnvId) {
      throw new Error(
        "[ManagedAgentSandboxStreamClient] No active sandbox environment ID found. Please set ENVIRONMENT_ID in .env or run provisionSharedSandbox first.",
      );
    }

    targetEnvId = targetEnvId.replace(/^environments\//, "");

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

    const requestParams = {
      agent: this.defaultAgent,
      input: fullPrompt,
      environment: targetEnvId,
      stream: true,
    };

    if (
      !options.freshInteraction &&
      (options.resumeInteractionId || this.currentInteractionId)
    ) {
      requestParams.previous_interaction_id =
        options.resumeInteractionId || this.currentInteractionId;
    }

    return await this._dispatchWithRetry(
      requestParams,
      `Reuse Sandbox [${targetEnvId.slice(0, 12)}...]`,
    );
  }

  // =========================================================================
  // 2. Environments Management API
  // =========================================================================

  /**
   * Lists all active sandbox environments with pagination.
   * @return {Promise<Array<Object>>}
   */
  async listSandboxes() {
    const url = `${this.environmentsEndpoint}?pageSize=100&key=${this.apiKey}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        `[Environments API] List failed (HTTP ${res.status}): ${await res.text()}`,
      );
    }
    const data = await res.json();
    const list = data.environments || [];
    return list.map((env) => ({
      id: (env.name || env.id || "").replace(/^environments\//, ""),
      rawName: env.name,
      createTime: env.createTime || env.created || "N/A",
      status: env.status || env.state || "ACTIVE",
      raw: env,
    }));
  }

  /**
   * Deletes a specific sandbox environment.
   * @param {string} environmentId
   */
  async deleteSandbox(environmentId) {
    const cleanId = environmentId.replace(/^environments\//, "");
    const url = `${this.environmentsEndpoint}/${cleanId}?key=${this.apiKey}`;
    const res = await fetch(url, { method: "DELETE" });
    if (!res.ok && res.status !== 404) {
      throw new Error(
        `[Environments API] Delete failed (HTTP ${res.status}): ${await res.text()}`,
      );
    }
    if (this.currentEnvironmentId === cleanId) {
      this.currentEnvironmentId = null;
    }
    return true;
  }

  // =========================================================================
  // 3. SSE Stream Dispatcher & Event Parser
  // =========================================================================

  /**
   * @private
   */
  async _dispatchWithRetry(requestParams, phaseLabel) {
    let attempt = 0;
    let delayMs = 2000;

    while (attempt <= this.maxRetries) {
      try {
        return await this._dispatchStream(requestParams, phaseLabel);
      } catch (err) {
        const statusCode = err.status || err.statusCode;
        const isTransientApiError =
          statusCode === 429 || (statusCode >= 500 && statusCode < 600);

        if (!isTransientApiError || attempt >= this.maxRetries) {
          throw err;
        }

        attempt++;
        let sleepDuration = delayMs;
        const retryMatch =
          err.message && err.message.match(/Please retry in ([0-9.]+)s/i);
        if (retryMatch && retryMatch[1]) {
          sleepDuration = Math.ceil(parseFloat(retryMatch[1]) * 1000) + 1500;
          console.log(
            `\n⏳ [Rate Limit] Cooldown requested by API: ${(sleepDuration / 1000).toFixed(1)}s`,
          );
        } else {
          sleepDuration = delayMs + Math.floor(Math.random() * 500);
          delayMs *= 2;
        }

        console.log(
          `\n🔄 [Retry ${attempt}/${this.maxRetries}] Retrying in ${(sleepDuration / 1000).toFixed(1)}s...`,
        );
        await new Promise((r) => setTimeout(r, sleepDuration));
      }
    }
  }

  /**
   * @private
   */
  async _dispatchStream(requestParams, phaseLabel) {
    const startTime = Date.now();

    if (this.enableLogging) {
      console.log(
        `\x1b[36m=== [Managed Agent SSE Request: ${phaseLabel}] ===\x1b[0m\n`,
      );
    }

    const state = {
      id: null,
      environmentId: null,
      textOutputs: [],
      bashCommands: [],
      bashOutputs: [],
      thoughts: [],
      seenSteps: new Map(), // Tracks step lifecycle by index or id
    };

    const stream = await this.ai.interactions.create(requestParams);

    for await (const event of stream) {
      this._processStreamEvent(event, state);
    }

    const executionTimeMs = Date.now() - startTime;
    if (state.environmentId) {
      this.currentEnvironmentId = state.environmentId;
    }
    if (state.id) {
      this.currentInteractionId = state.id;
    }

    return {
      id: state.id,
      environmentId: state.environmentId || this.currentEnvironmentId,
      text: state.textOutputs.join(""),
      bashCommands: state.bashCommands,
      bashOutputs: state.bashOutputs,
      thoughts: state.thoughts,
      executionTimeMs,
    };
  }

  /**
   * @private
   */
  _processStreamEvent(event, state) {
    try {
      const eventType = event.event_type || event.type || "";
      const stepIndex = event.index !== undefined ? event.index : 0;

      // 1. Extract Interaction and Environment IDs
      const interactionObj = event.interaction || (event.id ? event : null);
      if (interactionObj) {
        if (interactionObj.id && !state.id) {
          state.id = interactionObj.id;
        }
        const envRaw =
          interactionObj.environment_id || interactionObj.environment;
        if (envRaw) {
          const cleanEnv =
            typeof envRaw === "string"
              ? envRaw.replace(/^environments\//, "")
              : (envRaw.id || envRaw.name || "").replace(/^environments\//, "");
          if (cleanEnv) {
            state.environmentId = cleanEnv;
          }
        }
      }

      // 2. Lifecycle: Step Start (step.start)
      if (eventType === "step.start" && event.step) {
        const step = event.step;
        const stepType = step.type || "";

        // Track step start
        state.seenSteps.set(stepIndex, { type: stepType, started: true });

        // Thought step (only print summary if not streamed via delta)
        if (stepType === "thought" && step.summary) {
          const summaryText = (step.summary || [])
            .map((s) => (typeof s === "string" ? s : s.text || ""))
            .join("");
          if (summaryText && this.enableLogging) {
            state.thoughts.push(summaryText);
            console.log(
              `\x1b[90m💭 [Agent Thought]:\n${summaryText.trim()}\x1b[0m\n`,
            );
          }
        }

        // Code Execution Call (Bash command sent by agent)
        if (
          stepType === "code_execution_call" ||
          stepType === "code_execution" ||
          stepType === "function_call"
        ) {
          const code =
            step.arguments?.code ||
            step.arguments?.command ||
            (typeof step.arguments === "string" ? step.arguments : "");
          if (code) {
            state.bashCommands.push(code);
            if (this.enableLogging) {
              console.log(
                `\x1b[33m💻 [Bash Command]:\x1b[0m\n\x1b[33m${code.trim()}\x1b[0m\n`,
              );
            }
          }
        }
      }

      // 3. Lifecycle: Step Delta (step.delta)
      if (eventType === "step.delta" && event.delta) {
        const delta = event.delta;
        const deltaType = delta.type || "";

        // Text delta (Model final output)
        if (deltaType === "text" && delta.text) {
          state.textOutputs.push(delta.text);
          if (this.enableLogging) {
            process.stdout.write(`\x1b[37m${delta.text}\x1b[0m`);
          }
        } else if (
          typeof delta.text === "string" &&
          delta.text &&
          !deltaType.includes("thought")
        ) {
          state.textOutputs.push(delta.text);
          if (this.enableLogging) {
            process.stdout.write(`\x1b[37m${delta.text}\x1b[0m`);
          }
        }

        // Thought summary delta
        if (deltaType === "thought_summary" || deltaType === "thought") {
          const thoughtChunk =
            delta.content?.text ||
            (typeof delta.content === "string"
              ? delta.content
              : delta.text || "");
          if (thoughtChunk && this.enableLogging) {
            process.stdout.write(`\x1b[90m${thoughtChunk}\x1b[0m`);
          }
        }

        // Code execution arguments delta
        if (deltaType === "arguments_delta" && delta.arguments) {
          if (this.enableLogging) {
            process.stdout.write(`\x1b[33m${delta.arguments}\x1b[0m`);
          }
        }
      }

      // 4. Lifecycle: Step Stop (step.stop)
      if (eventType === "step.stop" && event.step) {
        const step = event.step;
        const stepType = step.type || "";

        // Sandbox Command Result (stdout / stderr)
        if (
          stepType === "code_execution_result" ||
          stepType === "function_result" ||
          step.result !== undefined ||
          step.output !== undefined
        ) {
          const rawResult =
            step.result !== undefined ? step.result : step.output;
          const resultStr =
            typeof rawResult === "string"
              ? rawResult
              : JSON.stringify(rawResult, null, 2);
          if (resultStr && resultStr.trim()) {
            state.bashOutputs.push(resultStr);
            if (this.enableLogging) {
              console.log(
                `\x1b[32m📤 [Sandbox Output]:\x1b[0m\n${resultStr.trim()}\n`,
              );
            }
          }
        }
      }
    } catch (_) {
      // Ignore unhandled chunk variations safely
    }
  }
}

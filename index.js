import { getContext, saveMetadataDebounced } from "../../../extensions.js";
import { activateSendButtons, deactivateSendButtons, eventSource, event_types, extension_prompt_roles, extension_prompt_types, getMaxContextSize, generateRaw, generateQuietPrompt, is_send_press } from "../../../../script.js";
import { promptManager } from "../../../openai.js";
import { itemizedPrompts, itemizedParams } from "../../../itemized-prompts.js";

const MODULE_NAME = "CheckpointSummarize";
const METADATA_KEY = "checkpoint_summarize";
const INJECTION_POSITION_AFTER_WORLD_INFO = 3;
const AFTER_WI_PROMPT_ID = "stcs_after_wi_memory";
const AFTER_WI_PROMPT_NAME = "STCS Checkpoint Memory";

const DEFAULT_SUMMARY_PROMPT_TEMPLATE = `You are maintaining a long-term modular memory for a roleplay/chat.

Previous locked checkpoint summaries:
{{previous_summaries}}

Current raw chat block:
{{raw_block}}

Task:
Create a compact, information-dense summary ONLY for the current raw chat block.

Use the previous checkpoint summaries only to understand continuity, causality, character relationships, promises, secrets, unresolved plotlines, and world state.

Do NOT rewrite previous summaries.
Do NOT summarize the whole story.
Do NOT create a global summary.
Do NOT create a summary of summaries.
Do NOT repeat old facts unless they are necessary to explain what changed in the current block.
Only summarize what newly happened in the current raw block.

Target length:
approximately {{target_summary_words}} words.

Output only the checkpoint summary.
No commentary.`;

const LEGACY_DEFAULT_SUMMARY_PROMPT_TEMPLATE = `You are maintaining a long-term modular memory for a roleplay/chat.

Previous locked checkpoint summaries:
{{previous_summaries}}

Current raw chat block:
{{raw_block}}

Task:
Create a compact, information-dense summary ONLY for the current raw chat block.

Use the previous checkpoint summaries only to understand continuity, causality, character relationships, promises, secrets, unresolved plotlines, and world state.

Do NOT rewrite previous summaries.
Do NOT summarize the whole story.
Do NOT create a global summary.
Do NOT create a summary of summaries.
Do NOT repeat old facts unless they are necessary to explain what changed in the current block.
Only summarize what newly happened in the current raw block.

Target length:
approximately {{target_summary_tokens}} tokens.

Output only the checkpoint summary.
No commentary.`;

const DEFAULT_INJECTION_TEMPLATE = `[Checkpoint Memory]

The following are manually reviewed checkpoint summaries of earlier chat history.
Treat them as established continuity/canon unless contradicted by more recent raw messages.

{{checkpoint_blocks}}

[End Checkpoint Memory]`;

const DEFAULT_STATE = {
  version: 1,
  enabled: true,
  injectionEnabled: true,
  settings: {
    targetRawBlockTokens: 90000,
    targetSummaryTokens: 800,
    safetyMarginTokens: 3000,
    includeAllPreviousSummaries: true,
    autoModeEnabled: false,
    autoApproveEnabled: false,
    noBrainModeEnabled: false,
    connectionProfile: "",
    useProfilePromptStack: true,
    useWorldbookInDraft: true,
    calculator: {
      maxContextTokens: 98304,
      expectedResponseTokens: 3000,
      lorebookTokens: 40000,
      systemInstructionTokens: 1200,
      characterCardTokens: 5000,
      lastAvailableTokens: 0,
      lastRecommendedRawBlockTokens: 0,
    },
    injectionPosition: extension_prompt_types.IN_PROMPT,
    injectionDepth: 2,
    injectionRole: extension_prompt_roles.SYSTEM,
    injectionScan: false,
    summaryPromptTemplate: DEFAULT_SUMMARY_PROMPT_TEMPLATE,
    injectionTemplate: DEFAULT_INJECTION_TEMPLATE,
  },
  draft: {
    startIndex: null,
    endIndex: null,
    sourceTokenCount: 0,
    previousSummariesTokenCount: 0,
    summary: "",
    generatedAt: null,
  },
  blocks: [],
};

function getMetadataRoot() {
  const ctx = getContext();
  if (!ctx) return null;
  if (ctx.chatMetadata && typeof ctx.chatMetadata === "object") return ctx.chatMetadata;
  if (ctx.chat_metadata && typeof ctx.chat_metadata === "object") return ctx.chat_metadata;
  return null;
}

function getExtensionDirectory() {
  const indexPath = new URL(import.meta.url).pathname;
  return indexPath.substring(0, indexPath.lastIndexOf("/"));
}

function ensureState() {
  const metadata = getMetadataRoot();
  if (!metadata) return structuredClone(DEFAULT_STATE);

  if (!metadata[METADATA_KEY] || typeof metadata[METADATA_KEY] !== "object") {
    metadata[METADATA_KEY] = structuredClone(DEFAULT_STATE);
    saveState();
  }

  const state = metadata[METADATA_KEY];
  state.version ??= 1;
  state.enabled ??= true;
  state.injectionEnabled ??= true;
  state.settings ??= structuredClone(DEFAULT_STATE.settings);
  state.settings.targetRawBlockTokens ??= DEFAULT_STATE.settings.targetRawBlockTokens;
  state.settings.targetSummaryTokens ??= DEFAULT_STATE.settings.targetSummaryTokens;
  state.settings.safetyMarginTokens ??= DEFAULT_STATE.settings.safetyMarginTokens;
  state.settings.includeAllPreviousSummaries ??= DEFAULT_STATE.settings.includeAllPreviousSummaries;
  state.settings.autoModeEnabled ??= DEFAULT_STATE.settings.autoModeEnabled;
  state.settings.autoApproveEnabled ??= DEFAULT_STATE.settings.autoApproveEnabled;
  state.settings.noBrainModeEnabled ??= DEFAULT_STATE.settings.noBrainModeEnabled;
  state.settings.connectionProfile ??= DEFAULT_STATE.settings.connectionProfile;
  state.settings.useProfilePromptStack ??= DEFAULT_STATE.settings.useProfilePromptStack;
  state.settings.useWorldbookInDraft ??= DEFAULT_STATE.settings.useWorldbookInDraft;
  state.settings.calculator ??= structuredClone(DEFAULT_STATE.settings.calculator);
  state.settings.calculator.maxContextTokens ??= DEFAULT_STATE.settings.calculator.maxContextTokens;
  state.settings.calculator.expectedResponseTokens ??= DEFAULT_STATE.settings.calculator.expectedResponseTokens;
  state.settings.calculator.lorebookTokens ??= DEFAULT_STATE.settings.calculator.lorebookTokens;
  state.settings.calculator.systemInstructionTokens ??= DEFAULT_STATE.settings.calculator.systemInstructionTokens;
  state.settings.calculator.characterCardTokens ??= DEFAULT_STATE.settings.calculator.characterCardTokens;
  state.settings.calculator.lastAvailableTokens ??= 0;
  state.settings.calculator.lastRecommendedRawBlockTokens ??= 0;
  state.settings.injectionPosition ??= DEFAULT_STATE.settings.injectionPosition;
  state.settings.injectionDepth ??= DEFAULT_STATE.settings.injectionDepth;
  state.settings.injectionRole ??= DEFAULT_STATE.settings.injectionRole;
  state.settings.injectionScan ??= DEFAULT_STATE.settings.injectionScan;
  state.settings.summaryPromptTemplate ??= DEFAULT_STATE.settings.summaryPromptTemplate;
  if (typeof state.settings.summaryPromptTemplate === "string") {
    const currentTemplate = state.settings.summaryPromptTemplate.trim();
    const legacyTemplate = LEGACY_DEFAULT_SUMMARY_PROMPT_TEMPLATE.trim();
    if (currentTemplate === legacyTemplate) {
      state.settings.summaryPromptTemplate = DEFAULT_SUMMARY_PROMPT_TEMPLATE;
      saveState();
    }
  }
  state.settings.injectionTemplate ??= DEFAULT_STATE.settings.injectionTemplate;
  state.draft ??= structuredClone(DEFAULT_STATE.draft);
  state.draft.startIndex ??= null;
  state.draft.endIndex ??= null;
  state.draft.sourceTokenCount ??= 0;
  state.draft.previousSummariesTokenCount ??= 0;
  state.draft.summary ??= "";
  state.draft.generatedAt ??= null;
  state.blocks ??= [];

  return state;
}

function getState() {
  return ensureState();
}

function saveState() {
  saveMetadataDebounced();
}

async function flushMetadataNow() {
  const ctx = getContext();
  if (!ctx || typeof ctx.saveMetadata !== "function") return;
  try {
    await ctx.saveMetadata();
  } catch (error) {
    console.warn(`[${MODULE_NAME}] Immediate metadata save failed`, error);
  }
}

function getPromptManagerOrderCharacter() {
  if (!promptManager) return null;
  if (promptManager.activeCharacter) return promptManager.activeCharacter;
  const strategy = promptManager?.configuration?.promptOrder?.strategy;
  if (strategy === "global") {
    return { id: promptManager.configuration.promptOrder.dummyId };
  }
  return null;
}

function clearAfterWiPromptManagerInjection() {
  if (!promptManager) return;

  try {
    if (promptManager.getPromptById(AFTER_WI_PROMPT_ID)) {
      promptManager.updatePromptByIdentifier(AFTER_WI_PROMPT_ID, { content: "" });
    }
  } catch (error) {
    console.warn(`[${MODULE_NAME}] Failed to clear PromptManager after-WI prompt content`, error);
  }
}

function upsertAfterWiPromptManagerInjection(text, roleNumber) {
  if (!promptManager || !text) return false;

  const role = getPromptRole(roleNumber);
  const promptPatch = {
    name: AFTER_WI_PROMPT_NAME,
    role,
    content: text,
    system_prompt: false,
    marker: false,
    injection_position: 0,
    injection_depth: 0,
    injection_order: 100,
    forbid_overrides: false,
  };

  try {
    const existing = promptManager.getPromptById(AFTER_WI_PROMPT_ID);
    if (existing) {
      promptManager.updatePromptByIdentifier(AFTER_WI_PROMPT_ID, promptPatch);
    } else {
      promptManager.addPrompt(promptPatch, AFTER_WI_PROMPT_ID);
    }

    const character = getPromptManagerOrderCharacter();
    if (!character) return false;

    const promptOrder = promptManager.getPromptOrderForCharacter(character);
    if (!Array.isArray(promptOrder) || !promptOrder.length) return false;

    const existingIndex = promptOrder.findIndex((entry) => entry?.identifier === AFTER_WI_PROMPT_ID);
    const existingEnabled = existingIndex >= 0 ? promptOrder[existingIndex]?.enabled !== false : true;
    if (existingIndex >= 0) {
      promptOrder.splice(existingIndex, 1);
    }

    const afterWiIndex = promptOrder.findIndex((entry) => entry?.identifier === "worldInfoAfter");
    const chatHistoryIndex = promptOrder.findIndex((entry) => entry?.identifier === "chatHistory");
    const insertIndex = afterWiIndex >= 0
      ? afterWiIndex + 1
      : (chatHistoryIndex >= 0 ? chatHistoryIndex : promptOrder.length);

    promptOrder.splice(insertIndex, 0, { identifier: AFTER_WI_PROMPT_ID, enabled: existingEnabled });
    return true;
  } catch (error) {
    console.error(`[${MODULE_NAME}] Failed to upsert PromptManager after-WI injection`, error);
    return false;
  }
}

let hydrationTimer = null;
function scheduleHydrationRefresh() {
  if (hydrationTimer) {
    clearTimeout(hydrationTimer);
    hydrationTimer = null;
  }

  let attempts = 0;
  const maxAttempts = 24; // ~6s with 250ms step
  const stepMs = 250;

  const tick = () => {
    attempts += 1;
    const metadata = getMetadataRoot();
    const hasState = !!(metadata && typeof metadata[METADATA_KEY] === "object");

    // If state appeared (or timeout reached), force one render/update pass.
    if (hasState || attempts >= maxAttempts) {
      renderStatus();
      hydrationTimer = null;
      return;
    }

    hydrationTimer = setTimeout(tick, stepMs);
  };

  tick();
}

let autoModeTimer = null;
let autoModeInFlight = false;
let autoModeLastAttemptKey = "";
let autoModeUiLocked = false;

function setAutoModeUiLock(locked) {
  if (locked && !autoModeUiLocked) {
    deactivateSendButtons();
    autoModeUiLocked = true;
    return;
  }

  if (!locked && autoModeUiLocked) {
    activateSendButtons();
    autoModeUiLocked = false;
  }
}

function scheduleAutoModeRun() {
  if (autoModeTimer) {
    clearTimeout(autoModeTimer);
    autoModeTimer = null;
  }

  autoModeTimer = setTimeout(() => {
    autoModeTimer = null;
    void runAutoMode();
  }, 300);
}

async function runAutoMode() {
  if (autoModeInFlight) return;
  if (is_send_press) return;

  const state = getState();
  if (!state.enabled || !state.settings.autoModeEnabled) return;
  const autoDrainMode = !!state.settings.autoModeEnabled && !!state.settings.autoApproveEnabled;

  // Respect manual workflow: if a draft already exists, do not overwrite it.
  if (hasVisibleText(state.draft.summary ?? "")) return;

  const chat = getChatMessages();
  if (!chat.length) return;

  const startIndex = getNextStartIndex();
  if (startIndex >= chat.length) return;

  const unsummarizedTokens = calculateMessageRangeTokens(startIndex, chat.length - 1);
  const targetTokens = getEffectiveRawBlockTargetTokens(state);
  if (unsummarizedTokens < targetTokens) return;

  autoModeInFlight = true;
  try {
    setAutoModeUiLock(true);
    let safetyCycles = 0;
    const maxCycles = autoDrainMode ? 500 : 1;

    while (safetyCycles < maxCycles) {
      if (is_send_press) break;

      const loopState = getState();
      if (!loopState.enabled || !loopState.settings.autoModeEnabled) break;
      if (hasVisibleText(loopState.draft.summary ?? "")) break;

      const loopChat = getChatMessages();
      if (!loopChat.length) break;

      const loopStartIndex = getNextStartIndex();
      if (loopStartIndex >= loopChat.length) break;

      const loopUnsummarizedTokens = calculateMessageRangeTokens(loopStartIndex, loopChat.length - 1);
      const loopTargetTokens = getEffectiveRawBlockTargetTokens(loopState);
      if (loopUnsummarizedTokens < loopTargetTokens) break;
      const loopAutoDrainMode = !!loopState.settings.autoModeEnabled && !!loopState.settings.autoApproveEnabled;

      const attemptKey = `${loopChat.length}:${loopStartIndex}:${loopTargetTokens}:${loopAutoDrainMode ? "drain" : "std"}`;
      if (attemptKey === autoModeLastAttemptKey) break;
      autoModeLastAttemptKey = attemptKey;

      autoSelectNextRange();
      await generateDraftCheckpoint({ skipPostNoBrainMaintenance: true });

      const nextState = getState();
      if (nextState.settings.autoApproveEnabled && hasVisibleText(nextState.draft.summary ?? "")) {
        await lockDraftCheckpoint();
        if (nextState.settings.noBrainModeEnabled) {
          await runNoBrainMaintenanceCycle({ silent: true });
        }
      } else {
        break;
      }

      safetyCycles += 1;
      if (!(nextState.settings.autoModeEnabled && nextState.settings.autoApproveEnabled)) break;
    }
  } catch (error) {
    console.warn(`[${MODULE_NAME}] Auto mode draft generation failed`, error);
  } finally {
    setAutoModeUiLock(false);
    autoModeInFlight = false;
  }
}

function getBlocks() {
  return getState().blocks;
}

function getLockedBlocks() {
  return getBlocks().filter((b) => b.locked === true);
}

function isRangeCheckpoint(block) {
  const start = Number(block?.startIndex);
  const end = Number(block?.endIndex);
  return !block?.memoryOnly && Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start;
}

function getLastLockedBlock() {
  const locked = getLockedBlocks().filter((b) => isRangeCheckpoint(b));
  return locked.length ? locked[locked.length - 1] : null;
}

function getChatMessages() {
  const ctx = getContext();
  return Array.isArray(ctx?.chat) ? ctx.chat : [];
}

let connectionProfilesActive;
function checkConnectionProfilesActive() {
  if (connectionProfilesActive === undefined) {
    connectionProfilesActive = $("#sys-settings-button").find("#connection_profiles").length > 0;
  }
  return connectionProfilesActive;
}

async function getCurrentConnectionProfile() {
  if (!checkConnectionProfilesActive()) return "";
  try {
    const ctx = getContext();
    const result = await ctx.executeSlashCommandsWithOptions("/profile");
    return String(result?.pipe ?? "").trim();
  } catch (error) {
    console.warn(`[${MODULE_NAME}] /profile failed`, error);
    return "";
  }
}

async function getConnectionProfiles() {
  if (!checkConnectionProfilesActive()) return [];
  try {
    const ctx = getContext();
    const result = await ctx.executeSlashCommandsWithOptions("/profile-list");
    const parsed = JSON.parse(String(result?.pipe ?? "[]"));
    return Array.isArray(parsed) ? parsed.map((x) => String(x)) : [];
  } catch (error) {
    console.warn(`[${MODULE_NAME}] /profile-list failed`, error);
    return [];
  }
}

async function setConnectionProfile(name) {
  if (!checkConnectionProfilesActive()) return;
  const target = String(name ?? "").trim();
  if (!target) return;

  const current = await getCurrentConnectionProfile();
  if (current === target) return;

  const ctx = getContext();
  await ctx.executeSlashCommandsWithOptions(`/profile ${target}`);
}

async function updateConnectionProfileDropdown() {
  const row = document.querySelector(".stcs-connection-profile-row");
  const select = document.getElementById("stcs-connection-profile");
  if (!(select instanceof HTMLSelectElement)) return;

  if (!checkConnectionProfilesActive()) {
    if (row instanceof HTMLElement) row.style.display = "none";
    return;
  }

  if (row instanceof HTMLElement) row.style.display = "";

  const state = getState();
  const selected = String(state.settings.connectionProfile ?? "");
  const profiles = await getConnectionProfiles();

  const uniqueProfiles = [...new Set(profiles)];
  select.innerHTML = "";

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "Same as Current";
  select.appendChild(defaultOption);

  for (const name of uniqueProfiles) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  }

  select.value = selected;
  select.disabled = false;
}

async function runWithSelectedConnectionProfile(task) {
  const state = getState();
  const desired = String(state.settings.connectionProfile ?? "").trim();
  if (!desired || !checkConnectionProfilesActive()) {
    return await task();
  }

  const current = await getCurrentConnectionProfile();
  let switched = false;

  try {
    if (current !== desired) {
      await setConnectionProfile(desired);
      switched = true;
    }
    return await task();
  } finally {
    if (switched && current) {
      try {
        await setConnectionProfile(current);
      } catch (error) {
        console.error(`[${MODULE_NAME}] Failed to restore connection profile`, error);
      }
    }
  }
}

function countTokens(text, padding = 0) {
  const ctx = getContext();
  if (ctx && typeof ctx.getTokenCount === "function") {
    try {
      return ctx.getTokenCount(text ?? "", padding);
    } catch {
      // fall through to approximate token count
    }
  }

  const approx = Math.ceil(String(text ?? "").length / 4);
  return approx + padding;
}

function getPromptRole(roleNumber) {
  const role = Number(roleNumber);
  if (role === Number(extension_prompt_roles.USER)) return "user";
  if (role === Number(extension_prompt_roles.ASSISTANT)) return "assistant";
  return "system";
}

function getMessageRole(message) {
  if (typeof message?.role === "string" && message.role) return message.role;
  if (message?.is_system) return "system";
  if (message?.is_user) return "user";
  return "assistant";
}

function getMessageText(message) {
  return String(message?.mes ?? message?.message ?? message?.content ?? "");
}

function getMessageChunk(index, message) {
  const role = getMessageRole(message);
  const name = String(message?.name ?? "");
  const text = getMessageText(message);
  return `[${index}] (${role}${name ? `/${name}` : ""}) ${text}`;
}

function normalizeSummaryOutput(value) {
  let text = String(value ?? "");
  // Remove common hidden/control chars that can make output look empty in UI.
  text = text.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
  // Remove leading/trailing whitespace after cleanup.
  text = text.trim();
  return text;
}

function hasVisibleText(value) {
  const text = String(value ?? "");
  // Remove whitespace and hidden chars, then check length.
  const visible = text.replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, "");
  return visible.length > 0;
}

function forceSetDraftTextareaValue(value) {
  const text = String(value ?? "");
  const write = () => {
    const draftSummaryEl = document.getElementById("stcs-draft-summary");
    if (draftSummaryEl instanceof HTMLTextAreaElement) {
      draftSummaryEl.value = text;
      draftSummaryEl.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };

  write();
  // Retry in case UI was re-rendered right after generation/profile restore.
  setTimeout(write, 0);
  setTimeout(write, 80);
  setTimeout(write, 250);
  setTimeout(write, 500);
}

function simpleHash(input) {
  let hash = 2166136261;
  const text = String(input ?? "");
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function getMessageHash(message) {
  const identity = `${getMessageRole(message)}|${String(message?.name ?? "")}|${getMessageText(message)}`;
  return simpleHash(identity);
}

function getRangeMessages(startIndex, endIndex) {
  const chat = getChatMessages();
  if (!chat.length) return [];
  const start = Number(startIndex);
  const end = Number(endIndex);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) return [];
  const cappedEnd = Math.min(end, chat.length - 1);
  return chat.slice(start, cappedEnd + 1);
}

function getNextStartIndex() {
  const lastLocked = getLastLockedBlock();
  if (!lastLocked) return 0;
  const endIndex = Number(lastLocked.endIndex);
  return Number.isFinite(endIndex) ? endIndex + 1 : 0;
}

function calculateMessageRangeTokens(startIndex, endIndex) {
  const chat = getChatMessages();
  if (!chat.length) return 0;
  const start = Number(startIndex);
  const end = Number(endIndex);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) return 0;

  const cappedEnd = Math.min(end, chat.length - 1);
  let total = 0;
  for (let i = start; i <= cappedEnd; i++) {
    total += countTokens(getMessageChunk(i, chat[i]));
  }
  return total;
}

function buildPreviousSummariesText() {
  const locked = getLockedBlocks();
  if (!locked.length) return "";
  return locked
    .filter((b) => b.locked === true)
    .map((b, idx) => {
      const rangeLabel = isRangeCheckpoint(b) ? `${b.startIndex}-${b.endIndex}` : "memory-only";
      return `[Checkpoint ${String(idx + 1).padStart(3, "0")} | messages ${rangeLabel}]\n${String(b.summary ?? "").trim()}`;
    })
    .join("\n\n");
}

function escapeHtml(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTimestamp(ts) {
  if (!ts) return "n/a";
  const date = new Date(Number(ts));
  if (Number.isNaN(date.getTime())) return "n/a";
  return date.toLocaleString();
}

function sanitizeFileNamePart(value) {
  return String(value ?? "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "chat";
}

function getTimestampForFileName() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${y}${m}${d}_${hh}${mm}${ss}`;
}

function triggerDownloadTextFile(fileName, content) {
  const blob = new Blob([String(content ?? "")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function triggerDownloadJsonFile(fileName, payload) {
  const text = JSON.stringify(payload, null, 2);
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatCheckpointBlockForText(block) {
  const created = block?.createdAt ? new Date(block.createdAt).toLocaleString() : "n/a";
  const updated = block?.updatedAt ? new Date(block.updatedAt).toLocaleString() : "n/a";
  return [
    `Checkpoint ${block?.id ?? "n/a"}`,
    `Range: ${block?.memoryOnly ? "memory-only" : `${block?.startIndex ?? "?"}-${block?.endIndex ?? "?"}`}`,
    `Messages: ${Number(block?.messageCount ?? 0)}`,
    `Source tokens (est): ${Number(block?.sourceTokenCount ?? 0)}`,
    `Status: ${block?.locked ? "locked" : "draft"} | Inject: ${block?.inject ? "on" : "off"}`,
    `Created: ${created} | Updated: ${updated}`,
    "",
    String(block?.summary ?? "").trim(),
  ].join("\n");
}

function exportCheckpoints() {
  const state = getState();
  const blocks = Array.isArray(state.blocks) ? state.blocks : [];
  if (!blocks.length) {
    toastr.warning("No checkpoints to export.", MODULE_NAME);
    return;
  }

  const ctx = getContext();
  const chatLabel = sanitizeFileNamePart(ctx?.name2 || ctx?.characterName || ctx?.groupName || ctx?.chatId || "chat");
  const stamp = getTimestampForFileName();

  const textParts = blocks.map((block) => formatCheckpointBlockForText(block));
  const textContent = textParts.join("\n\n------------------------------\n\n");
  const textFileName = `${chatLabel}_stcs_checkpoints_${stamp}.txt`;
  triggerDownloadTextFile(textFileName, textContent);

  const jsonPayload = {
    exportedAt: new Date().toISOString(),
    module: MODULE_NAME,
    chat: {
      label: chatLabel,
      chatId: ctx?.chatId ?? null,
    },
    checkpoints: blocks,
  };
  const jsonFileName = `${chatLabel}_stcs_checkpoints_${stamp}.json`;
  triggerDownloadJsonFile(jsonFileName, jsonPayload);

  toastr.success("Checkpoint export complete (.txt + .json).", MODULE_NAME);
}

function exportCurrentSummary() {
  const injectionText = buildInjectionText();
  const ctx = getContext();
  const chatLabel = sanitizeFileNamePart(ctx?.name2 || ctx?.characterName || ctx?.groupName || ctx?.chatId || "chat");
  const stamp = getTimestampForFileName();

  if (!injectionText.trim()) {
    toastr.warning("Current summary is empty. Nothing to export.", MODULE_NAME);
    return;
  }

  const lockedInjectedBlocks = getLockedBlocks().filter((block) => block?.inject !== false);
  const payload = [
    "[ST-CheckpointSummarize Current Summary Export]",
    `Exported at: ${new Date().toISOString()}`,
    `Chat: ${chatLabel}`,
    `Locked checkpoints: ${getLockedBlocks().length}`,
    `Injected checkpoints: ${lockedInjectedBlocks.length}`,
    "",
    injectionText,
  ].join("\n");

  const fileName = `${chatLabel}_stcs_current_summary_${stamp}.txt`;
  triggerDownloadTextFile(fileName, payload);
  toastr.success("Current summary export complete.", MODULE_NAME);
}

function pickImportFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", () => {
      const file = input.files?.[0] ?? null;
      input.remove();
      resolve(file);
    }, { once: true });
    input.click();
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Failed to read import file."));
    reader.readAsText(file);
  });
}

function buildUniqueCheckpointId(existingIds, preferredId = "") {
  const preferred = String(preferredId ?? "").trim();
  if (preferred && !existingIds.has(preferred)) {
    existingIds.add(preferred);
    return preferred;
  }

  let maxNum = 0;
  for (const id of existingIds) {
    const match = String(id).match(/^chk-(\d+)$/);
    if (!match) continue;
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > maxNum) maxNum = n;
  }

  let next = maxNum + 1;
  let candidate = `chk-${String(next).padStart(4, "0")}`;
  while (existingIds.has(candidate)) {
    next += 1;
    candidate = `chk-${String(next).padStart(4, "0")}`;
  }
  existingIds.add(candidate);
  return candidate;
}

function normalizeImportedBlock(raw, existingIds) {
  const now = Date.now();
  const summary = String(raw?.summary ?? "").trim();
  if (!summary) return null;

  let startIndex = Number.isInteger(Number(raw?.startIndex)) ? Number(raw.startIndex) : -1;
  let endIndex = Number.isInteger(Number(raw?.endIndex)) ? Number(raw.endIndex) : -1;
  let messageCount = Number(raw?.messageCount ?? ((startIndex >= 0 && endIndex >= startIndex) ? (endIndex - startIndex + 1) : 0));
  const sourceTokenCount = Number(raw?.sourceTokenCount ?? 0);
  const previousSummariesTokenCount = Number(raw?.previousSummariesTokenCount ?? 0);
  const targetSummaryTokens = Number(raw?.targetSummaryTokens ?? 0);
  const locked = raw?.locked !== false;
  const inject = raw?.inject !== false;
  const createdAt = Number(raw?.createdAt);
  const updatedAt = Number(raw?.updatedAt);
  const importStartHash = String(raw?.startHash ?? "").trim();
  const importEndHash = String(raw?.endHash ?? "").trim();
  let memoryOnly = !!raw?.memoryOnly;

  if (!memoryOnly) {
    const chat = getChatMessages();
    const hasRange = Number.isInteger(startIndex) && Number.isInteger(endIndex) && startIndex >= 0 && endIndex >= startIndex;

    if (!hasRange || endIndex >= chat.length) {
      memoryOnly = true;
    } else {
      if (importStartHash && importStartHash !== getMessageHash(chat[startIndex])) {
        memoryOnly = true;
      }
      if (!memoryOnly && importEndHash && importEndHash !== getMessageHash(chat[endIndex])) {
        memoryOnly = true;
      }
    }
  }

  if (memoryOnly) {
    startIndex = -1;
    endIndex = -1;
    messageCount = Number.isFinite(messageCount) ? messageCount : 0;
  }

  return {
    id: buildUniqueCheckpointId(existingIds, raw?.id),
    startIndex,
    endIndex,
    startHash: memoryOnly ? "" : importStartHash,
    endHash: memoryOnly ? "" : importEndHash,
    messageCount: Number.isFinite(messageCount) ? messageCount : 0,
    sourceTokenCount: Number.isFinite(sourceTokenCount) ? sourceTokenCount : 0,
    previousSummariesTokenCount: Number.isFinite(previousSummariesTokenCount) ? previousSummariesTokenCount : 0,
    targetSummaryTokens: Number.isFinite(targetSummaryTokens) ? targetSummaryTokens : 0,
    summary,
    locked,
    inject,
    memoryOnly,
    createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : now,
    updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : null,
  };
}

function parseCheckpointsFromJsonText(text) {
  const parsed = JSON.parse(String(text ?? ""));
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.checkpoints)) return parsed.checkpoints;
  throw new Error("Invalid checkpoints JSON format.");
}

function parseCheckpointsFromTxtText(text) {
  const sections = String(text ?? "")
    .split(/\n\s*-{10,}\s*\n/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const blocks = [];
  for (const section of sections) {
    const idMatch = section.match(/^Checkpoint\s+(.+)$/m);
    const rangeMatch = section.match(/^Range:\s*(-?\d+|\?)-(-?\d+|\?)$/m);
    const messagesMatch = section.match(/^Messages:\s*(\d+)$/m);
    const sourceMatch = section.match(/^Source tokens \(est\):\s*(\d+)$/m);
    const statusMatch = section.match(/^Status:\s*([^|]+)\|\s*Inject:\s*(on|off)$/mi);

    const parts = section.split(/\n\s*\n/);
    const summary = String(parts.slice(1).join("\n\n") ?? "").trim();
    if (!summary) continue;

    const startIndex = rangeMatch && rangeMatch[1] !== "?" ? Number(rangeMatch[1]) : -1;
    const endIndex = rangeMatch && rangeMatch[2] !== "?" ? Number(rangeMatch[2]) : -1;

    blocks.push({
      id: idMatch ? String(idMatch[1]).trim() : "",
      startIndex,
      endIndex,
      messageCount: messagesMatch ? Number(messagesMatch[1]) : ((startIndex >= 0 && endIndex >= startIndex) ? (endIndex - startIndex + 1) : 0),
      sourceTokenCount: sourceMatch ? Number(sourceMatch[1]) : 0,
      previousSummariesTokenCount: 0,
      targetSummaryTokens: 0,
      summary,
      locked: statusMatch ? /locked/i.test(statusMatch[1]) : true,
      inject: statusMatch ? /on/i.test(statusMatch[2]) : true,
      startHash: "",
      endHash: "",
      memoryOnly: false,
      createdAt: Date.now(),
      updatedAt: null,
    });
  }
  return blocks;
}

function parseBlocksFromCurrentSummaryText(text) {
  const raw = String(text ?? "");
  const headerMatch = raw.match(/\[ST-CheckpointSummarize Current Summary Export\]/);
  const payload = headerMatch ? raw.replace(/^[\s\S]*?\n\n/, "") : raw;

  const re = /\[Checkpoint\s+\d+\s+\|\s+messages\s+(-?\d+)-(-?\d+)\]\s*\n([\s\S]*?)(?=\n\n\[Checkpoint\s+\d+\s+\|\s+messages\s+-?\d+-?\d+\]|\n\[End Checkpoint Memory\]|$)/g;
  const blocks = [];
  let match;

  while ((match = re.exec(payload)) !== null) {
    const startIndex = Number(match[1]);
    const endIndex = Number(match[2]);
    const summary = String(match[3] ?? "").trim();
    if (!summary) continue;
    blocks.push({
      id: "",
      startIndex,
      endIndex,
      messageCount: (Number.isInteger(startIndex) && Number.isInteger(endIndex) && endIndex >= startIndex) ? (endIndex - startIndex + 1) : 0,
      sourceTokenCount: 0,
      previousSummariesTokenCount: 0,
      targetSummaryTokens: 0,
      summary,
      locked: true,
      inject: true,
      startHash: "",
      endHash: "",
      memoryOnly: true,
      createdAt: Date.now(),
      updatedAt: null,
    });
  }

  if (blocks.length) return blocks;

  const plainSummary = payload.trim();
  if (!plainSummary) return [];
  return [{
    id: "",
    startIndex: -1,
    endIndex: -1,
    messageCount: 0,
    sourceTokenCount: 0,
    previousSummariesTokenCount: 0,
    targetSummaryTokens: 0,
    summary: plainSummary,
    locked: true,
    inject: true,
    startHash: "",
    endHash: "",
    memoryOnly: true,
    createdAt: Date.now(),
    updatedAt: null,
  }];
}

function appendImportedBlocks(rawBlocks) {
  const state = getState();
  state.blocks ??= [];
  const existingIds = new Set(state.blocks.map((b) => String(b?.id ?? "")).filter(Boolean));
  const normalized = rawBlocks
    .map((raw) => normalizeImportedBlock(raw, existingIds))
    .filter(Boolean);

  if (!normalized.length) return { imported: 0, memoryOnly: 0 };
  const memoryOnlyCount = normalized.filter((b) => !!b?.memoryOnly).length;
  state.blocks.push(...normalized);
  // keep debounced save for coalescing, but force immediate flush in callers
  saveState();
  renderStatus();
  scheduleAutoModeRun();
  return { imported: normalized.length, memoryOnly: memoryOnlyCount };
}

async function importCheckpoints() {
  try {
    const file = await pickImportFile(".json,.txt");
    if (!file) return;
    const text = await readFileAsText(file);
    let blocks = [];

    if (/\.json$/i.test(file.name)) {
      blocks = parseCheckpointsFromJsonText(text);
    } else {
      blocks = parseCheckpointsFromTxtText(text);
    }

    const result = appendImportedBlocks(blocks);
    if (result.imported <= 0) {
      toastr.warning("No valid checkpoints found in file.", MODULE_NAME);
      return;
    }
    await flushMetadataNow();
    const memoryOnlySuffix = result.memoryOnly > 0 ? ` (${result.memoryOnly} set as memory-only)` : "";
    toastr.success(`Imported ${result.imported} checkpoint(s)${memoryOnlySuffix}.`, MODULE_NAME);
  } catch (error) {
    console.error(`[${MODULE_NAME}] Failed to import checkpoints`, error);
    toastr.error(`Checkpoint import failed: ${String(error?.message ?? error)}`, MODULE_NAME);
  }
}

async function importCurrentSummary() {
  try {
    const file = await pickImportFile(".txt");
    if (!file) return;
    const text = await readFileAsText(file);
    const blocks = parseBlocksFromCurrentSummaryText(text);
    const result = appendImportedBlocks(blocks);
    if (result.imported <= 0) {
      toastr.warning("No valid summary content found in file.", MODULE_NAME);
      return;
    }
    await flushMetadataNow();
    const memoryOnlySuffix = result.memoryOnly > 0 ? ` (${result.memoryOnly} set as memory-only)` : "";
    toastr.success(`Imported ${result.imported} checkpoint(s) from current summary export${memoryOnlySuffix}.`, MODULE_NAME);
  } catch (error) {
    console.error(`[${MODULE_NAME}] Failed to import current summary`, error);
    toastr.error(`Current summary import failed: ${String(error?.message ?? error)}`, MODULE_NAME);
  }
}

function getBlockValidationWarnings(block) {
  const warnings = [];
  if (block?.memoryOnly) return warnings;

  const chat = getChatMessages();
  const start = Number(block?.startIndex);
  const end = Number(block?.endIndex);

  const startExists = Number.isInteger(start) && start >= 0 && start < chat.length;
  const endExists = Number.isInteger(end) && end >= 0 && end < chat.length;
  if (!startExists || !endExists) {
    warnings.push("Checkpoint range indices no longer exist in current chat.");
    return warnings;
  }

  const startHashNow = getMessageHash(chat[start]);
  const endHashNow = getMessageHash(chat[end]);
  if (block.startHash && block.startHash !== startHashNow) {
    warnings.push("Start message hash mismatch. Range may have changed.");
  }
  if (block.endHash && block.endHash !== endHashNow) {
    warnings.push("End message hash mismatch. Range may have changed.");
  }

  return warnings;
}

function renderLockedBlocksList() {
  const state = getState();
  const container = document.getElementById("stcs-locked-list");
  if (!container) return;

  const blocks = Array.isArray(state.blocks) ? state.blocks : [];
  if (!blocks.length) {
    container.innerHTML = "No checkpoints yet.";
    return;
  }

  const html = blocks.map((block, idx) => {
    const warnings = getBlockValidationWarnings(block);
    const preview = String(block.summary ?? "").trim().slice(0, 220);
    const summaryTokens = countTokens(String(block.summary ?? ""));
    const warningHtml = warnings.length
      ? `<div class="stcs-warn">${warnings.map((w) => `Warning: ${escapeHtml(w)}`).join("<br>")}</div>`
      : "";
    const updatedText = block.updatedAt ? formatTimestamp(block.updatedAt) : "n/a";
    const injectEnabled = block.inject !== false;
    const statusBase = block.locked ? "locked" : "draft";
    const status = block.memoryOnly ? `${statusBase}, memory-only` : statusBase;
    const rangeLabel = block.memoryOnly ? "memory-only" : `${block.startIndex}-${block.endIndex}`;
    const checkpointTitle = `Checkpoint ${String(idx + 1).padStart(3, "0")} (${escapeHtml(block.id)})`;

    return `
      <div class="stcs-block" data-block-id="${escapeHtml(block.id)}">
        <div><b>${checkpointTitle}</b></div>
        <div>Range: ${rangeLabel} | Messages: ${block.messageCount ?? "n/a"} | Source tokens(est): ${block.sourceTokenCount ?? "n/a"} | Summary tokens(est): ${summaryTokens}</div>
        <div>Created: ${escapeHtml(formatTimestamp(block.createdAt))} | Updated: ${escapeHtml(updatedText)} | Status: ${escapeHtml(status)} | Inject: ${injectEnabled ? "on" : "off"}</div>
        ${warningHtml}
        <div class="stcs-preview">${escapeHtml(preview || "(empty summary)")}</div>
        <div class="stcs-row">
          <button class="menu_button stcs-action-view">View/Edit summary</button>
          <button class="menu_button stcs-action-save">Save edits</button>
          <button class="menu_button stcs-action-delete">Delete checkpoint</button>
          <button class="menu_button stcs-action-toggle-inject">${injectEnabled ? "Disable injection" : "Enable injection"}</button>
        </div>
        <textarea class="text_pole stcs-block-editor" rows="8" style="display:none;">${escapeHtml(block.summary ?? "")}</textarea>
      </div>
    `;
  }).join("\n");

  container.innerHTML = html;
}

function buildRawBlockText(startIndex, endIndex) {
  const messages = getRangeMessages(startIndex, endIndex);
  if (!messages.length) return "";
  return messages
    .map((msg, idx) => getMessageChunk(startIndex + idx, msg))
    .join("\n");
}

function getInjectableLockedBlocks() {
  return getLockedBlocks().filter((b) => b.inject !== false);
}

function buildInjectionBlocksText() {
  const blocks = getInjectableLockedBlocks();
  if (!blocks.length) return "";
  return blocks
    .map((b, idx) => {
      const checkpointNumber = String(idx + 1).padStart(3, "0");
      const summary = String(b.summary ?? "").trim();
      const rangeLabel = isRangeCheckpoint(b) ? `${b.startIndex}-${b.endIndex}` : "memory-only";
      return `[Checkpoint ${checkpointNumber} | messages ${rangeLabel}]\n${summary}`;
    })
    .join("\n\n");
}

function fillTemplate(template, replacements) {
  let out = String(template ?? "");
  for (const [key, value] of Object.entries(replacements)) {
    out = out.replaceAll(`{{${key}}}`, String(value ?? ""));
  }
  return out;
}

function buildSummaryPrompt() {
  const state = getState();
  const draft = state.draft;
  const startIndex = Number(draft.startIndex);
  const endIndex = Number(draft.endIndex);
  const previousSummaries = state.settings.includeAllPreviousSummaries ? buildPreviousSummariesText() : "";
  const rawBlock = buildRawBlockText(startIndex, endIndex);
  const checkpointNumber = getLockedBlocks().length + 1;
  const targetSummaryTokens = Number(state.settings.targetSummaryTokens || 0);
  const targetSummaryWords = estimateGemma4WordsFromTokens(targetSummaryTokens);

  const templatedPrompt = fillTemplate(
    state.settings.summaryPromptTemplate || DEFAULT_SUMMARY_PROMPT_TEMPLATE,
    {
      previous_summaries: previousSummaries || "(none)",
      raw_block: rawBlock,
      target_summary_tokens: targetSummaryTokens,
      target_summary_words: targetSummaryWords,
      checkpoint_number: String(checkpointNumber).padStart(3, "0"),
      start_index: startIndex,
      end_index: endIndex,
    },
  );

  // Always include word-based length target for Gemma-family compliance.
  return `${templatedPrompt}\n\nLength requirement: approximately ${targetSummaryWords} words.`;
}

function calculateContextBudget() {
  const state = getState();
  const calc = state.settings.calculator ?? DEFAULT_STATE.settings.calculator;
  const useProfilePromptStack = !!state.settings.useProfilePromptStack;
  const useWorldbookInDraft = !!state.settings.useWorldbookInDraft;
  const maxContext = Number(calc.maxContextTokens || 0);
  const expectedResponse = Number(calc.expectedResponseTokens || 0);
  const lorebook = Number(calc.lorebookTokens || 0);
  const system = Number(calc.systemInstructionTokens || 0);
  const character = Number(calc.characterCardTokens || 0);
  const availableTokens = useProfilePromptStack
    ? (maxContext - expectedResponse - (useWorldbookInDraft ? lorebook : 0) - system - character)
    : (maxContext - expectedResponse - (useWorldbookInDraft ? lorebook : 0));
  const recommendedRawBlockTokens = Math.max(0, availableTokens - Number(state.settings.safetyMarginTokens || 0));

  return {
    maxContext,
    useProfilePromptStack,
    useWorldbookInDraft,
    expectedResponse,
    lorebook,
    system,
    character,
    availableTokens,
    recommendedRawBlockTokens,
  };
}

function getCheckpointContextBudgetBase() {
  const state = getState();
  const calc = state.settings.calculator ?? DEFAULT_STATE.settings.calculator;

  const fallbackMax = getMaxPromptTokensSafe();
  const maxContext = Number(calc.maxContextTokens || 0) > 0
    ? Number(calc.maxContextTokens)
    : fallbackMax;

  const expectedResponse = Number(calc.expectedResponseTokens || 0);
  const lorebook = Number(calc.lorebookTokens || 0);
  const system = Number(calc.systemInstructionTokens || 0);
  const character = Number(calc.characterCardTokens || 0);
  const fixedMandatory = state.settings.useProfilePromptStack
    ? (expectedResponse + (state.settings.useWorldbookInDraft ? lorebook : 0) + system + character)
    : (expectedResponse + (state.settings.useWorldbookInDraft ? lorebook : 0));
  const availableAfterMandatory = maxContext - fixedMandatory;

  return {
    maxContext,
    fixedMandatory,
    availableAfterMandatory,
  };
}

function getLatestItemizedPromptEntry() {
  if (!Array.isArray(itemizedPrompts) || !itemizedPrompts.length) return null;

  let latest = null;
  let latestMesId = -1;
  for (const entry of itemizedPrompts) {
    const mesId = Number(entry?.mesId);
    if (Number.isInteger(mesId) && mesId >= latestMesId) {
      latestMesId = mesId;
      latest = entry;
    } else if (!latest) {
      latest = entry;
    }
  }
  return latest;
}

function getLatestWorldInfoTextForDraft() {
  const latest = getLatestItemizedPromptEntry();
  if (!latest) return "";

  const wi = latest.worldInfoString;
  if (typeof wi === "string") return wi.trim();
  if (Array.isArray(wi)) return wi.map((x) => String(x ?? "")).join("\n").trim();
  return "";
}

function buildRawPromptWithOptionalWorldInfo(prompt, includeWorldInfo) {
  const basePrompt = String(prompt ?? "");
  if (!includeWorldInfo) return basePrompt;

  const worldInfo = getLatestWorldInfoTextForDraft();
  if (!worldInfo) return "";

  return [
    "[World Info]",
    worldInfo,
    "[End World Info]",
    "",
    basePrompt,
  ].join("\n");
}

function buildInjectionText() {
  const state = getState();
  const blocksText = buildInjectionBlocksText();
  if (!blocksText.trim()) return "";

  return fillTemplate(
    state.settings.injectionTemplate || DEFAULT_INJECTION_TEMPLATE,
    {
      checkpoint_blocks: blocksText,
    },
  ).trim();
}

function updateExtensionPrompt() {
  const state = getState();
  const ctx = getContext();
  if (!ctx || typeof ctx.setExtensionPrompt !== "function") return;

  if (!state.enabled || !state.injectionEnabled || state.settings.injectionPosition === -1) {
    clearAfterWiPromptManagerInjection();
    ctx.setExtensionPrompt(MODULE_NAME, "");
    return;
  }

  const text = buildInjectionText();
  if (!text) {
    clearAfterWiPromptManagerInjection();
    ctx.setExtensionPrompt(MODULE_NAME, "");
    return;
  }

  const requestedPosition = Number(state.settings.injectionPosition);
  if (requestedPosition === INJECTION_POSITION_AFTER_WORLD_INFO) {
    const synced = upsertAfterWiPromptManagerInjection(text, Number(state.settings.injectionRole));
    if (synced) {
      // Prevent duplicate copy via regular extension prompt channel.
      ctx.setExtensionPrompt(MODULE_NAME, "");
      return;
    }
    // Fallback when PromptManager isn't ready/available.
    clearAfterWiPromptManagerInjection();
    ctx.setExtensionPrompt(
      MODULE_NAME,
      text,
      Number(extension_prompt_types.IN_PROMPT),
      Number(state.settings.injectionDepth),
      Boolean(state.settings.injectionScan),
      Number(state.settings.injectionRole),
    );
    return;
  }

  clearAfterWiPromptManagerInjection();

  const resolvedPosition = requestedPosition;
  const resolvedDepth = Number(state.settings.injectionDepth);

  ctx.setExtensionPrompt(
    MODULE_NAME,
    text,
    resolvedPosition,
    resolvedDepth,
    Boolean(state.settings.injectionScan),
    Number(state.settings.injectionRole),
  );
}

function getMaxPromptTokensSafe() {
  try {
    const size = Number(getMaxContextSize?.());
    if (Number.isFinite(size) && size > 0) return size;
  } catch {
    // use fallback
  }
  return 16000;
}

function autoSelectNextRange() {
  const state = getState();
  const chat = getChatMessages();

  if (!chat.length) {
    state.draft.startIndex = null;
    state.draft.endIndex = null;
    state.draft.sourceTokenCount = 0;
    state.draft.previousSummariesTokenCount = 0;
    saveState();
    renderStatus();
    return;
  }

  const startIndex = getNextStartIndex();
  if (startIndex >= chat.length) {
    state.draft.startIndex = null;
    state.draft.endIndex = null;
    state.draft.sourceTokenCount = 0;
    state.draft.previousSummariesTokenCount = 0;
    saveState();
    renderStatus();
    return;
  }

  const previousSummariesText = state.settings.includeAllPreviousSummaries ? buildPreviousSummariesText() : "";
  const previousSummariesTokenCount = countTokens(previousSummariesText);
  const summaryInstructionsTokens = countTokens(state.settings.summaryPromptTemplate || DEFAULT_SUMMARY_PROMPT_TEMPLATE);
  const budgetBase = getCheckpointContextBudgetBase();
  const availableContext = budgetBase.availableAfterMandatory
    - previousSummariesTokenCount
    - summaryInstructionsTokens
    - Number(state.settings.targetSummaryTokens || 0)
    - Number(state.settings.safetyMarginTokens || 0);
  if (availableContext <= 0) {
    state.draft.startIndex = null;
    state.draft.endIndex = null;
    state.draft.sourceTokenCount = 0;
    state.draft.previousSummariesTokenCount = previousSummariesTokenCount;
    saveState();
    renderStatus();
    toastr.warning("No raw-block budget left after mandatory prompts. Reduce fixed prompt load.", MODULE_NAME);
    return;
  }
  const rawBlockBudget = Math.max(1, Math.min(getEffectiveRawBlockTargetTokens(state), availableContext));

  let sourceTokenCount = 0;
  let endIndex = startIndex;

  for (let i = startIndex; i < chat.length; i++) {
    const msgTokens = countTokens(getMessageChunk(i, chat[i]));
    if (sourceTokenCount + msgTokens > rawBlockBudget && i > startIndex) break;
    sourceTokenCount += msgTokens;
    endIndex = i;
  }

  state.draft.startIndex = startIndex;
  state.draft.endIndex = endIndex;
  state.draft.sourceTokenCount = sourceTokenCount;
  state.draft.previousSummariesTokenCount = previousSummariesTokenCount;
  state.draft.summary = "";
  state.draft.generatedAt = null;
  saveState();
  renderStatus();
}

async function generateDraftCheckpoint(options = {}) {
  const { skipPostNoBrainMaintenance = false } = options;
  const state = getState();
  const start = Number(state.draft.startIndex);
  const end = Number(state.draft.endIndex);
  const generateBtn = document.getElementById("stcs-generate-draft");

  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) {
    toastr.warning("Please select a valid message range first.", MODULE_NAME);
    return;
  }

  const rawBlock = buildRawBlockText(start, end);
  if (!rawBlock.trim()) {
    toastr.warning("Selected range has no content to summarize.", MODULE_NAME);
    return;
  }

  const prompt = buildSummaryPrompt();
  const promptTokens = countTokens(prompt);
  const targetSummaryTokens = Number(state.settings.targetSummaryTokens || 800);
  const budgetBase = getCheckpointContextBudgetBase();
  const promptBudget = budgetBase.availableAfterMandatory
    - Number(state.settings.safetyMarginTokens || 0)
    - targetSummaryTokens;

  if (promptTokens > promptBudget) {
    toastr.warning(
      `Estimated prompt too large (${promptTokens} > ${promptBudget}). Reduce range or token targets.`,
      MODULE_NAME,
    );
    return;
  }

  try {
    if (generateBtn) generateBtn.disabled = true;
    const summary = await runWithSelectedConnectionProfile(async () => {
      if (!state.settings.useProfilePromptStack) {
        const rawPrompt = buildRawPromptWithOptionalWorldInfo(prompt, !!state.settings.useWorldbookInDraft);
        if (state.settings.useWorldbookInDraft && !rawPrompt) {
          throw new Error("Worldbook is enabled, but no recent World Info snapshot was found in itemized prompts. Generate one chat reply first.");
        }
        const rawSummary = await generateRaw({
          prompt: rawPrompt || prompt,
          responseLength: targetSummaryTokens,
        });
        return String(rawSummary ?? "").trim();
      }

      try {
        return String(await generateQuietPrompt({
          quietPrompt: prompt,
          skipWIAN: !state.settings.useWorldbookInDraft,
          responseLength: targetSummaryTokens,
        }) ?? "").trim();
      } catch (quietError) {
        console.warn(`[${MODULE_NAME}] generateQuietPrompt failed, trying raw fallback`, quietError);
        const rawPrompt = buildRawPromptWithOptionalWorldInfo(prompt, !!state.settings.useWorldbookInDraft);
        if (state.settings.useWorldbookInDraft && !rawPrompt) {
          throw quietError;
        }
        const rawSummary = await generateRaw({
          prompt: rawPrompt || prompt,
          responseLength: targetSummaryTokens,
        });
        return String(rawSummary ?? "").trim();
      }
    });

    const normalizedSummary = normalizeSummaryOutput(summary);
    if (!hasVisibleText(normalizedSummary)) {
      toastr.warning("Model returned an empty draft summary.", MODULE_NAME);
      return;
    }

    state.draft.summary = normalizedSummary;
    state.draft.generatedAt = Date.now();
    state.draft.sourceTokenCount = calculateMessageRangeTokens(start, end);
    state.draft.previousSummariesTokenCount = state.settings.includeAllPreviousSummaries
      ? countTokens(buildPreviousSummariesText())
      : 0;

    forceSetDraftTextareaValue(normalizedSummary);

    saveState();
    renderStatus();
    if (!skipPostNoBrainMaintenance) {
      await runNoBrainMaintenanceCycle({ silent: true });
    }
    toastr.success("Draft checkpoint generated.", MODULE_NAME);
  } catch (error) {
    console.error(`[${MODULE_NAME}] Draft generation failed`, error);
    const message = String(error?.message ?? error ?? "Unknown error");
    if (/mandatory prompts exceed the context size/i.test(message)) {
      toastr.error(
        "Mandatory prompts exceed context. Reduce WI/system/character load or lower raw block target. Re-run Autofill + Calculate Limits.",
        MODULE_NAME,
      );
      return;
    }
    toastr.error(`Failed to generate checkpoint draft: ${message}`, MODULE_NAME);
  } finally {
    if (generateBtn) generateBtn.disabled = false;
  }
}

function makeCheckpointId() {
  const blocks = getBlocks();
  let maxNum = 0;
  for (const block of blocks) {
    const match = String(block?.id ?? "").match(/^chk-(\d+)$/);
    if (!match) continue;
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > maxNum) maxNum = n;
  }
  return `chk-${String(maxNum + 1).padStart(4, "0")}`;
}

async function lockDraftCheckpoint() {
  const state = getState();
  const chat = getChatMessages();
  const start = Number(state.draft.startIndex);
  const end = Number(state.draft.endIndex);
  const summary = String(state.draft.summary ?? "").trim();

  if (!summary) {
    toastr.warning("Draft summary is empty.", MODULE_NAME);
    return;
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end >= chat.length) {
    toastr.warning("Invalid draft range.", MODULE_NAME);
    return;
  }

  const rangeMessages = getRangeMessages(start, end);
  if (!rangeMessages.length) {
    toastr.warning("Cannot lock empty range.", MODULE_NAME);
    return;
  }

  const startMsg = chat[start];
  const endMsg = chat[end];
  const block = {
    id: makeCheckpointId(),
    startIndex: start,
    endIndex: end,
    startHash: getMessageHash(startMsg),
    endHash: getMessageHash(endMsg),
    messageCount: end - start + 1,
    sourceTokenCount: calculateMessageRangeTokens(start, end),
    previousSummariesTokenCount: state.draft.previousSummariesTokenCount || 0,
    targetSummaryTokens: Number(state.settings.targetSummaryTokens || 0),
    summary,
    locked: true,
    inject: true,
    memoryOnly: false,
    createdAt: Date.now(),
    updatedAt: null,
  };

  state.blocks.push(block);
  state.draft.startIndex = null;
  state.draft.endIndex = null;
  state.draft.sourceTokenCount = 0;
  state.draft.previousSummariesTokenCount = 0;
  state.draft.summary = "";
  state.draft.generatedAt = null;
  saveState();
  await flushMetadataNow();
  renderStatus();
  toastr.success(`Checkpoint ${block.id} locked.`, MODULE_NAME);
  scheduleAutoModeRun();
}

function clearDraft() {
  const state = getState();
  state.draft.summary = "";
  state.draft.generatedAt = null;
  saveState();
  renderStatus();
}

const SUMMARY_TOKENS_PER_RAW_TOKEN = 1000 / 50000;
const SUMMARY_STEP = 16;
const SUMMARY_MIN = 64;
const RAW_BLOCK_STEP = 100;
const RAW_BLOCK_MIN = 1000;
const NO_BRAIN_MAX_RAW_BLOCK_TOKENS = 50000;
const GEMMA4_TOKENS_PER_WORD = 1.35;

function getEffectiveRawBlockTargetTokens(state) {
  const base = Math.max(1, Number(state?.settings?.targetRawBlockTokens || 1));
  if (state?.settings?.noBrainModeEnabled) {
    return Math.min(base, NO_BRAIN_MAX_RAW_BLOCK_TOKENS);
  }
  return base;
}

function applyNoBrainPreset(state) {
  state.enabled = true;
  state.injectionEnabled = true;
  state.settings.useProfilePromptStack = false;
  state.settings.useWorldbookInDraft = true;
  state.settings.includeAllPreviousSummaries = true;
  state.settings.autoModeEnabled = true;
  state.settings.autoApproveEnabled = true;
}

async function runNoBrainMaintenanceCycle(options = {}) {
  const { silent = false } = options;
  const state = getState();
  if (!state.settings.noBrainModeEnabled) return;

  await autofillCalculatorFromPromptItemization({ silent });
  applyCalculatedLimits({ silent });
  if (Number(state.settings.targetRawBlockTokens || 0) > NO_BRAIN_MAX_RAW_BLOCK_TOKENS) {
    applyTargetsFromRawBlock(NO_BRAIN_MAX_RAW_BLOCK_TOKENS);
    saveState();
    renderStatus();
    if (!silent) {
      toastr.info(`No Brain cap applied: raw block target limited to ${NO_BRAIN_MAX_RAW_BLOCK_TOKENS} tokens.`, MODULE_NAME);
    }
  }
  autoSelectNextRange();
}

function applyNoBrainUiLock() {
  const root = document.getElementById("st_checkpoint_summarize_settings");
  if (!root) return;

  const state = getState();
  const noBrainOn = !!state.settings.noBrainModeEnabled;
  const allowIds = new Set([
    "stcs-no-brain-mode",
    "stcs-connection-profile",
  ]);

  const controls = root.querySelectorAll("input, select, textarea");
  controls.forEach((el) => {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) return;
    const id = String(el.id ?? "");
    if (!id) return;
    el.disabled = noBrainOn && !allowIds.has(id);
  });
}

function normalizeByStep(value, min, step) {
  const safeValue = Number.isFinite(Number(value)) ? Number(value) : min;
  return Math.max(min, Math.round(safeValue / step) * step);
}

function estimateGemma4WordsFromTokens(tokens) {
  const n = Number(tokens);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.max(1, Math.round(n / GEMMA4_TOKENS_PER_WORD));
}

function applyTargetsFromRawBlock(rawBlockTokens) {
  const state = getState();
  let computedRawBlockTokens = normalizeByStep(rawBlockTokens, RAW_BLOCK_MIN, RAW_BLOCK_STEP);
  if (state.settings.noBrainModeEnabled) {
    computedRawBlockTokens = Math.min(computedRawBlockTokens, NO_BRAIN_MAX_RAW_BLOCK_TOKENS);
  }
  state.settings.targetRawBlockTokens = computedRawBlockTokens;

  const rawSummaryEstimate = Math.max(
    SUMMARY_MIN,
    Math.round(computedRawBlockTokens * SUMMARY_TOKENS_PER_RAW_TOKEN),
  );
  const computedSummaryTokens = normalizeByStep(rawSummaryEstimate, SUMMARY_MIN, SUMMARY_STEP);
  state.settings.targetSummaryTokens = computedSummaryTokens;
}

function applyCalculatedLimits(options = {}) {
  const { silent = false } = options;
  const state = getState();
  const result = calculateContextBudget();

  state.settings.calculator.lastAvailableTokens = result.availableTokens;
  state.settings.calculator.lastRecommendedRawBlockTokens = result.recommendedRawBlockTokens;

  if (result.recommendedRawBlockTokens > 0) {
    applyTargetsFromRawBlock(result.recommendedRawBlockTokens);
  }

  saveState();
  renderStatus();

  if (!silent) {
    if (result.availableTokens <= 0) {
      toastr.warning("Context budget is non-positive. Reduce fixed token usage.", MODULE_NAME);
    } else {
      toastr.success("Limits calculated. Raw block and summary token targets updated.", MODULE_NAME);
    }
  }
}

function applyLimitsFromSelectedRange() {
  const state = getState();
  const start = Number(state.draft.startIndex);
  const end = Number(state.draft.endIndex);

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    toastr.warning("Please select a valid message range first.", MODULE_NAME);
    return;
  }

  const rangeTokens = calculateMessageRangeTokens(start, end);
  if (rangeTokens <= 0) {
    toastr.warning("Selected range has zero tokens.", MODULE_NAME);
    return;
  }

  state.draft.sourceTokenCount = rangeTokens;
  applyTargetsFromRawBlock(rangeTokens);
  state.settings.calculator.lastRecommendedRawBlockTokens = state.settings.targetRawBlockTokens;
  saveState();
  renderStatus();
  toastr.success("Limits set from selected range.", MODULE_NAME);
}

function escapeRegex(text) {
  return String(text ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseNumberByLabel(text, label) {
  const regex = new RegExp(`${escapeRegex(label)}[^\\d\\n]*([\\d,]+)`, "i");
  const match = String(text ?? "").match(regex);
  if (!match) return null;
  const value = Number(match[1].replaceAll(",", ""));
  return Number.isFinite(value) ? value : null;
}

function findPromptItemizationText() {
  const containers = Array.from(document.querySelectorAll(".popup, .dialogue_popup, .draggable, .drawer, .modal"));
  for (const el of containers) {
    const text = String(el?.innerText ?? "");
    if (text.includes("Prompt Itemization") && text.includes("Max Context")) {
      return text;
    }
  }

  const bodyText = String(document.body?.innerText ?? "");
  if (bodyText.includes("Prompt Itemization") && bodyText.includes("Max Context")) {
    return bodyText;
  }

  return "";
}

async function tryAutofillFromLatestItemizedPrompt(options = {}) {
  const { silent = false } = options;
  if (!Array.isArray(itemizedPrompts) || !itemizedPrompts.length) return false;

  let latestIndex = -1;
  let latestMesId = -1;
  for (let i = 0; i < itemizedPrompts.length; i++) {
    const mesId = Number(itemizedPrompts[i]?.mesId);
    if (!Number.isInteger(mesId)) continue;
    if (mesId >= latestMesId) {
      latestMesId = mesId;
      latestIndex = i;
    }
  }

  if (latestIndex < 0 || latestMesId < 0) return false;

  let params = null;
  try {
    params = await itemizedParams(itemizedPrompts, latestIndex, latestMesId);
  } catch (error) {
    console.warn(`[${MODULE_NAME}] Failed reading latest itemized prompt params`, error);
    return false;
  }

  if (!params) return false;

  const state = getState();
  const maxContext = Number(params.thisPrompt_max_context ?? 0);
  const systemInfo = Number(params.oaiSystemTokens ?? params.instructionTokens ?? 0);
  const lorebook = Number(params.worldInfoStringTokens ?? 0);
  const characterCard =
    Number(params.charDescriptionTokens ?? 0) +
    Number(params.charPersonalityTokens ?? 0) +
    Number(params.scenarioTextTokens ?? 0) +
    Number(params.examplesStringTokens ?? 0) +
    Number(params.userPersonaStringTokens ?? 0);

  if (maxContext > 0) state.settings.calculator.maxContextTokens = maxContext;
  state.settings.calculator.systemInstructionTokens = Math.max(0, systemInfo);
  state.settings.calculator.lorebookTokens = Math.max(0, lorebook);
  state.settings.calculator.characterCardTokens = Math.max(0, characterCard);
  state.settings.calculator.expectedResponseTokens = 0;

  saveState();
  renderStatus();
  if (!silent) {
    toastr.success("Calculator autofilled from latest chat itemization.", MODULE_NAME);
  }
  return true;
}

async function autofillCalculatorFromPromptItemization(options = {}) {
  const { silent = false } = options;
  const byLatestMessage = await tryAutofillFromLatestItemizedPrompt({ silent });
  if (byLatestMessage) return;

  const text = findPromptItemizationText();
  if (!text) {
    if (!silent) {
      toastr.warning("No recent itemized prompt found. Generate one chat reply, then retry autofill.", MODULE_NAME);
    }
    return;
  }

  const maxContext = parseNumberByLabel(text, "Max Context");
  const systemInfo = parseNumberByLabel(text, "System Info:");
  const worldInfo = parseNumberByLabel(text, "World Info:");
  const description = parseNumberByLabel(text, "-- Description:") ?? 0;
  const personality = parseNumberByLabel(text, "-- Personality:") ?? 0;
  const scenario = parseNumberByLabel(text, "-- Scenario:") ?? 0;
  const examples = parseNumberByLabel(text, "-- Examples:") ?? 0;
  const userPersona = parseNumberByLabel(text, "-- User Persona:") ?? 0;
  const characterCard = description + personality + scenario + examples + userPersona;

  const state = getState();
  if (maxContext !== null) state.settings.calculator.maxContextTokens = maxContext;
  if (systemInfo !== null) state.settings.calculator.systemInstructionTokens = systemInfo;
  if (worldInfo !== null) state.settings.calculator.lorebookTokens = worldInfo;
  state.settings.calculator.characterCardTokens = characterCard;

  // Prompt Itemization "Max Context" is usually already (context size - response length),
  // so keep expected response at 0 to avoid double subtraction.
  state.settings.calculator.expectedResponseTokens = 0;

  saveState();
  renderStatus();
  if (!silent) {
    toastr.success("Calculator autofilled from Prompt Itemization popup.", MODULE_NAME);
  }
}

function getBlockIndexById(blockId) {
  const blocks = getBlocks();
  return blocks.findIndex((b) => String(b?.id ?? "") === String(blockId ?? ""));
}

function getBlockElementFromTarget(target) {
  if (!(target instanceof HTMLElement)) return null;
  return target.closest(".stcs-block");
}

function toggleBlockEditor(blockElement) {
  const editor = blockElement?.querySelector(".stcs-block-editor");
  if (!(editor instanceof HTMLTextAreaElement)) return;
  editor.style.display = editor.style.display === "none" ? "block" : "none";
}

function saveBlockEdits(blockElement) {
  const blockId = blockElement?.dataset?.blockId;
  if (!blockId) return;
  const editor = blockElement.querySelector(".stcs-block-editor");
  if (!(editor instanceof HTMLTextAreaElement)) return;

  const idx = getBlockIndexById(blockId);
  if (idx < 0) return;

  const state = getState();
  state.blocks[idx].summary = editor.value;
  state.blocks[idx].updatedAt = Date.now();
  saveState();
  renderStatus();
  toastr.success(`Checkpoint ${blockId} saved.`, MODULE_NAME);
}

function deleteBlock(blockElement) {
  const blockId = blockElement?.dataset?.blockId;
  if (!blockId) return;
  const idx = getBlockIndexById(blockId);
  if (idx < 0) return;

  const confirmed = window.confirm(`Delete checkpoint ${blockId}?`);
  if (!confirmed) return;

  const state = getState();
  state.blocks.splice(idx, 1);
  saveState();
  renderStatus();
  toastr.success(`Checkpoint ${blockId} deleted.`, MODULE_NAME);
}

function toggleBlockInjection(blockElement) {
  const blockId = blockElement?.dataset?.blockId;
  if (!blockId) return;
  const idx = getBlockIndexById(blockId);
  if (idx < 0) return;

  const state = getState();
  const block = state.blocks[idx];
  block.inject = block.inject === false ? true : false;
  saveState();
  renderStatus();
}

function handleLockedListClick(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const blockElement = getBlockElementFromTarget(target);
  if (!blockElement) return;

  if (target.closest(".stcs-action-view")) {
    toggleBlockEditor(blockElement);
    return;
  }
  if (target.closest(".stcs-action-save")) {
    saveBlockEdits(blockElement);
    return;
  }
  if (target.closest(".stcs-action-delete")) {
    deleteBlock(blockElement);
    return;
  }
  if (target.closest(".stcs-action-toggle-inject")) {
    toggleBlockInjection(blockElement);
  }
}

function clampNumber(value, min, max, fallback = null) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function updateDraftRangeFromInputs() {
  const state = getState();
  const chat = getChatMessages();
  const startInput = document.getElementById("stcs-start-index");
  const endInput = document.getElementById("stcs-end-index");
  if (!startInput || !endInput) return;

  if (!chat.length) {
    state.draft.startIndex = null;
    state.draft.endIndex = null;
    state.draft.sourceTokenCount = 0;
    saveState();
    renderStatus();
    return;
  }

  const start = clampNumber(startInput.value, 0, chat.length - 1, null);
  const end = clampNumber(endInput.value, 0, chat.length - 1, null);

  if (start === null || end === null || end < start) {
    state.draft.startIndex = start;
    state.draft.endIndex = end;
    state.draft.sourceTokenCount = 0;
  } else {
    state.draft.startIndex = start;
    state.draft.endIndex = end;
    state.draft.sourceTokenCount = calculateMessageRangeTokens(start, end);
    state.draft.previousSummariesTokenCount = state.settings.includeAllPreviousSummaries ? countTokens(buildPreviousSummariesText()) : 0;
  }

  saveState();
  renderStatus();
}

function renderStatus() {
  const state = getState();
  const statusEl = document.getElementById("stcs-status");
  const lockedListEl = document.getElementById("stcs-locked-list");
  const previewEl = document.getElementById("stcs-memory-preview");
  const enabledEl = document.getElementById("stcs-enabled");
  const noBrainModeEl = document.getElementById("stcs-no-brain-mode");
  const injectionEl = document.getElementById("stcs-injection-enabled");
  const includePrevEl = document.getElementById("stcs-include-prev-summaries");
  const autoModeEnabledEl = document.getElementById("stcs-auto-mode-enabled");
  const autoApproveEnabledEl = document.getElementById("stcs-auto-approve-enabled");
  const targetRawBlockTokensEl = document.getElementById("stcs-target-raw-block-tokens");
  const targetSummaryTokensEl = document.getElementById("stcs-target-summary-tokens");
  const safetyMarginTokensEl = document.getElementById("stcs-safety-margin-tokens");
  const connectionProfileEl = document.getElementById("stcs-connection-profile");
  const useProfilePromptStackEl = document.getElementById("stcs-use-profile-prompt-stack");
  const useWorldbookInDraftEl = document.getElementById("stcs-use-worldbook-in-draft");
  const calcMaxContextEl = document.getElementById("stcs-calc-max-context");
  const calcExpectedResponseEl = document.getElementById("stcs-calc-expected-response");
  const calcLorebookEl = document.getElementById("stcs-calc-lorebook");
  const calcSystemEl = document.getElementById("stcs-calc-system");
  const calcCharacterEl = document.getElementById("stcs-calc-character");
  const calcResultEl = document.getElementById("stcs-calc-result");
  const injectionPositionEl = document.getElementById("stcs-injection-position");
  const injectionDepthEl = document.getElementById("stcs-injection-depth");
  const injectionRoleEl = document.getElementById("stcs-injection-role");
  const injectionScanEl = document.getElementById("stcs-injection-scan");
  const summaryTemplateEl = document.getElementById("stcs-summary-template");
  const injectionTemplateEl = document.getElementById("stcs-injection-template");
  const startIndexEl = document.getElementById("stcs-start-index");
  const endIndexEl = document.getElementById("stcs-end-index");
  const rangeInfoEl = document.getElementById("stcs-range-info");
  const draftSummaryEl = document.getElementById("stcs-draft-summary");

  if (!statusEl || !lockedListEl || !previewEl || !enabledEl || !injectionEl) return;

  const chat = getChatMessages();
  const locked = getLockedBlocks();
  const summarizedTokens = locked.reduce((sum, block) => sum + Number(block?.sourceTokenCount || 0), 0);
  const lastLocked = getLastLockedBlock();
  const lastEndIndex = lastLocked ? Number(lastLocked.endIndex) : -1;
  const unsummarizedStart = lastEndIndex + 1;
  const unsummarizedCount = Math.max(0, chat.length - unsummarizedStart);
  const unsummarizedTailTokens = unsummarizedCount > 0
    ? calculateMessageRangeTokens(unsummarizedStart, chat.length - 1)
    : 0;

  enabledEl.checked = !!state.enabled;
  if (noBrainModeEl) noBrainModeEl.checked = !!state.settings.noBrainModeEnabled;
  injectionEl.checked = !!state.injectionEnabled;
  if (includePrevEl) includePrevEl.checked = !!state.settings.includeAllPreviousSummaries;
  if (autoModeEnabledEl) autoModeEnabledEl.checked = !!state.settings.autoModeEnabled;
  if (autoApproveEnabledEl) autoApproveEnabledEl.checked = !!state.settings.autoApproveEnabled;
  if (targetRawBlockTokensEl) targetRawBlockTokensEl.value = String(state.settings.targetRawBlockTokens);
  if (targetSummaryTokensEl) targetSummaryTokensEl.value = String(state.settings.targetSummaryTokens);
  if (safetyMarginTokensEl) safetyMarginTokensEl.value = String(state.settings.safetyMarginTokens);
  if (connectionProfileEl) connectionProfileEl.value = String(state.settings.connectionProfile ?? "");
  if (useProfilePromptStackEl) useProfilePromptStackEl.checked = !!state.settings.useProfilePromptStack;
  if (useWorldbookInDraftEl) useWorldbookInDraftEl.checked = !!state.settings.useWorldbookInDraft;
  if (calcMaxContextEl) calcMaxContextEl.value = String(state.settings.calculator.maxContextTokens);
  if (calcExpectedResponseEl) calcExpectedResponseEl.value = String(state.settings.calculator.expectedResponseTokens);
  if (calcLorebookEl) calcLorebookEl.value = String(state.settings.calculator.lorebookTokens);
  if (calcSystemEl) calcSystemEl.value = String(state.settings.calculator.systemInstructionTokens);
  if (calcCharacterEl) calcCharacterEl.value = String(state.settings.calculator.characterCardTokens);
  if (injectionPositionEl) injectionPositionEl.value = String(state.settings.injectionPosition);
  if (injectionDepthEl) injectionDepthEl.value = String(state.settings.injectionDepth);
  if (injectionRoleEl) injectionRoleEl.value = String(state.settings.injectionRole);
  if (injectionScanEl) injectionScanEl.checked = !!state.settings.injectionScan;
  if (summaryTemplateEl && document.activeElement !== summaryTemplateEl) summaryTemplateEl.value = state.settings.summaryPromptTemplate ?? DEFAULT_SUMMARY_PROMPT_TEMPLATE;
  if (injectionTemplateEl && document.activeElement !== injectionTemplateEl) injectionTemplateEl.value = state.settings.injectionTemplate ?? DEFAULT_INJECTION_TEMPLATE;
  if (startIndexEl) startIndexEl.value = state.draft.startIndex ?? "";
  if (endIndexEl) endIndexEl.value = state.draft.endIndex ?? "";
  if (draftSummaryEl && (document.activeElement !== draftSummaryEl || !hasVisibleText(draftSummaryEl.value))) {
    draftSummaryEl.value = state.draft.summary ?? "";
  }

  statusEl.textContent = [
    `Enabled: ${state.enabled ? "yes" : "no"}`,
    `No Brain: ${state.settings.noBrainModeEnabled ? "yes" : "no"}`,
    `Injection: ${state.injectionEnabled ? "yes" : "no"}`,
    `Locked checkpoints: ${locked.length}`,
    `Summarized tokens (est): ${summarizedTokens}`,
    `Last end index: ${lastLocked ? lastLocked.endIndex : "n/a"}`,
    `Unsummarized messages: ${unsummarizedCount}`,
    `Unsummarized tail tokens (est): ${unsummarizedTailTokens}`,
  ].join(" | ");

  renderLockedBlocksList();

  if (rangeInfoEl) {
    const hasRange = Number.isInteger(state.draft.startIndex) && Number.isInteger(state.draft.endIndex);
    if (!hasRange) {
      rangeInfoEl.textContent = "No draft range selected.";
    } else {
      const start = Number(state.draft.startIndex);
      const end = Number(state.draft.endIndex);
      const chatInRange = getChatMessages();
      const startHash = chatInRange[start] ? getMessageHash(chatInRange[start]) : "n/a";
      const endHash = chatInRange[end] ? getMessageHash(chatInRange[end]) : "n/a";
      const draftSummaryText = (draftSummaryEl instanceof HTMLTextAreaElement && draftSummaryEl.value)
        ? draftSummaryEl.value
        : String(state.draft.summary || "");
      let draftSummaryTokens = countTokens(draftSummaryText);
      if (draftSummaryTokens <= 0 && hasVisibleText(draftSummaryText)) {
        draftSummaryTokens = Math.ceil(draftSummaryText.length / 4);
      }
      rangeInfoEl.textContent = `Selected range: ${start}-${end} | Source tokens (est): ${state.draft.sourceTokenCount} | Draft summary tokens: ${draftSummaryTokens} | Previous summaries tokens (est): ${state.draft.previousSummariesTokenCount} | Start hash: ${startHash} | End hash: ${endHash}`;
    }
  }

  if (calcResultEl) {
    const calc = calculateContextBudget();
    const modeText = calc.useProfilePromptStack
      ? `Formula mode: prompt stack for draft ON (WI ${calc.useWorldbookInDraft ? "ON" : "OFF"})`
      : `Formula mode: prompt stack for draft OFF (raw only; WI ${calc.useWorldbookInDraft ? "ON" : "OFF"})`;
    calcResultEl.textContent = `${modeText}\nAvailable by formula: ${calc.availableTokens} tokens | Recommended raw block target (after safety margin ${state.settings.safetyMarginTokens}): ${calc.recommendedRawBlockTokens} tokens`;
  }

  const previewText = buildInjectionText();
  if (!state.enabled) {
    previewEl.textContent = "[Injection disabled] Extension is disabled.";
  } else if (!state.injectionEnabled || Number(state.settings.injectionPosition) === -1) {
    previewEl.textContent = "[Injection disabled] Prompt injection is turned off.";
  } else if (!previewText) {
    previewEl.textContent = "[No checkpoint memory] No locked + enabled-for-injection checkpoints yet.";
  } else {
    previewEl.textContent = previewText;
  }

  applyNoBrainUiLock();
  updateExtensionPrompt();
}

function bindUiEvents() {
  const enabledEl = document.getElementById("stcs-enabled");
  const noBrainModeEl = document.getElementById("stcs-no-brain-mode");
  const injectionEl = document.getElementById("stcs-injection-enabled");
  const includePrevEl = document.getElementById("stcs-include-prev-summaries");
  const autoModeEnabledEl = document.getElementById("stcs-auto-mode-enabled");
  const autoApproveEnabledEl = document.getElementById("stcs-auto-approve-enabled");
  const targetRawBlockTokensEl = document.getElementById("stcs-target-raw-block-tokens");
  const targetSummaryTokensEl = document.getElementById("stcs-target-summary-tokens");
  const safetyMarginTokensEl = document.getElementById("stcs-safety-margin-tokens");
  const connectionProfileEl = document.getElementById("stcs-connection-profile");
  const useProfilePromptStackEl = document.getElementById("stcs-use-profile-prompt-stack");
  const useWorldbookInDraftEl = document.getElementById("stcs-use-worldbook-in-draft");
  const calcMaxContextEl = document.getElementById("stcs-calc-max-context");
  const calcExpectedResponseEl = document.getElementById("stcs-calc-expected-response");
  const calcLorebookEl = document.getElementById("stcs-calc-lorebook");
  const calcSystemEl = document.getElementById("stcs-calc-system");
  const calcCharacterEl = document.getElementById("stcs-calc-character");
  const calcApplyBtn = document.getElementById("stcs-calc-apply");
  const calcAutofillBtn = document.getElementById("stcs-calc-autofill-itemization");
  const injectionPositionEl = document.getElementById("stcs-injection-position");
  const injectionDepthEl = document.getElementById("stcs-injection-depth");
  const injectionRoleEl = document.getElementById("stcs-injection-role");
  const injectionScanEl = document.getElementById("stcs-injection-scan");
  const summaryTemplateEl = document.getElementById("stcs-summary-template");
  const injectionTemplateEl = document.getElementById("stcs-injection-template");
  const startIndexEl = document.getElementById("stcs-start-index");
  const endIndexEl = document.getElementById("stcs-end-index");
  const autoSelectBtn = document.getElementById("stcs-auto-select-next-block");
  const calcLimitsFromRangeBtn = document.getElementById("stcs-calc-limits-from-range");
  const generateDraftBtn = document.getElementById("stcs-generate-draft");
  const lockCheckpointBtn = document.getElementById("stcs-lock-checkpoint");
  const clearDraftBtn = document.getElementById("stcs-clear-draft");
  const exportCheckpointsBtn = document.getElementById("stcs-export-checkpoints");
  const exportCurrentSummaryBtn = document.getElementById("stcs-export-current-summary");
  const importCheckpointsBtn = document.getElementById("stcs-import-checkpoints");
  const importCurrentSummaryBtn = document.getElementById("stcs-import-current-summary");
  const draftSummaryEl = document.getElementById("stcs-draft-summary");
  const lockedListEl = document.getElementById("stcs-locked-list");

  enabledEl?.addEventListener("change", () => {
    const state = getState();
    state.enabled = enabledEl.checked;
    saveState();
    renderStatus();
    if (state.enabled) scheduleAutoModeRun();
  });

  noBrainModeEl?.addEventListener("change", () => {
    const state = getState();
    state.settings.noBrainModeEnabled = !!noBrainModeEl.checked;

    if (state.settings.noBrainModeEnabled) {
      applyNoBrainPreset(state);
    }

    saveState();
    renderStatus();

    if (state.settings.noBrainModeEnabled) {
      void runNoBrainMaintenanceCycle({ silent: true });
      toastr.success("No Brain mode enabled: preset applied and limits refreshed.", MODULE_NAME);
      if (state.settings.autoModeEnabled) {
        scheduleAutoModeRun();
      }
    } else {
      toastr.info("No Brain mode disabled.", MODULE_NAME);
    }
  });

  injectionEl?.addEventListener("change", () => {
    const state = getState();
    state.injectionEnabled = injectionEl.checked;
    saveState();
    renderStatus();
  });

  includePrevEl?.addEventListener("change", () => {
    const state = getState();
    state.settings.includeAllPreviousSummaries = includePrevEl.checked;
    saveState();
    renderStatus();
  });

  autoModeEnabledEl?.addEventListener("change", () => {
    const state = getState();
    state.settings.autoModeEnabled = !!autoModeEnabledEl.checked;
    saveState();
    renderStatus();
    if (state.settings.autoModeEnabled) {
      scheduleAutoModeRun();
    }
  });

  autoApproveEnabledEl?.addEventListener("change", () => {
    const state = getState();
    state.settings.autoApproveEnabled = !!autoApproveEnabledEl.checked;
    saveState();
    renderStatus();
  });

  targetRawBlockTokensEl?.addEventListener("change", () => {
    const state = getState();
    state.settings.targetRawBlockTokens = clampNumber(targetRawBlockTokensEl.value, 1, 1000000, DEFAULT_STATE.settings.targetRawBlockTokens);
    saveState();
    renderStatus();
    scheduleAutoModeRun();
  });

  targetSummaryTokensEl?.addEventListener("change", () => {
    const state = getState();
    state.settings.targetSummaryTokens = clampNumber(targetSummaryTokensEl.value, 1, 1000000, DEFAULT_STATE.settings.targetSummaryTokens);
    saveState();
    renderStatus();
  });

  safetyMarginTokensEl?.addEventListener("change", () => {
    const state = getState();
    state.settings.safetyMarginTokens = clampNumber(safetyMarginTokensEl.value, 0, 1000000, DEFAULT_STATE.settings.safetyMarginTokens);
    saveState();
    renderStatus();
  });

  connectionProfileEl?.addEventListener("change", () => {
    const state = getState();
    state.settings.connectionProfile = connectionProfileEl.value;
    saveState();
    renderStatus();
    if (state.settings.noBrainModeEnabled) {
      void runNoBrainMaintenanceCycle({ silent: true });
    }
  });
  useProfilePromptStackEl?.addEventListener("change", () => {
    const state = getState();
    state.settings.useProfilePromptStack = !!useProfilePromptStackEl.checked;
    saveState();
    renderStatus();
  });
  useWorldbookInDraftEl?.addEventListener("change", () => {
    const state = getState();
    state.settings.useWorldbookInDraft = !!useWorldbookInDraftEl.checked;
    saveState();
    renderStatus();
  });
  connectionProfileEl?.addEventListener("click", () => {
    void updateConnectionProfileDropdown();
  });

  calcMaxContextEl?.addEventListener("change", () => {
    const state = getState();
    state.settings.calculator.maxContextTokens = clampNumber(calcMaxContextEl.value, 1, 10000000, DEFAULT_STATE.settings.calculator.maxContextTokens);
    saveState();
    renderStatus();
  });

  calcExpectedResponseEl?.addEventListener("change", () => {
    const state = getState();
    state.settings.calculator.expectedResponseTokens = clampNumber(calcExpectedResponseEl.value, 0, 10000000, DEFAULT_STATE.settings.calculator.expectedResponseTokens);
    saveState();
    renderStatus();
  });

  calcLorebookEl?.addEventListener("change", () => {
    const state = getState();
    state.settings.calculator.lorebookTokens = clampNumber(calcLorebookEl.value, 0, 10000000, DEFAULT_STATE.settings.calculator.lorebookTokens);
    saveState();
    renderStatus();
  });

  calcSystemEl?.addEventListener("change", () => {
    const state = getState();
    state.settings.calculator.systemInstructionTokens = clampNumber(calcSystemEl.value, 0, 10000000, DEFAULT_STATE.settings.calculator.systemInstructionTokens);
    saveState();
    renderStatus();
  });

  calcCharacterEl?.addEventListener("change", () => {
    const state = getState();
    state.settings.calculator.characterCardTokens = clampNumber(calcCharacterEl.value, 0, 10000000, DEFAULT_STATE.settings.calculator.characterCardTokens);
    saveState();
    renderStatus();
  });

  calcApplyBtn?.addEventListener("click", applyCalculatedLimits);
  calcAutofillBtn?.addEventListener("click", () => {
    void autofillCalculatorFromPromptItemization();
  });

  injectionPositionEl?.addEventListener("change", () => {
    const state = getState();
    state.settings.injectionPosition = clampNumber(injectionPositionEl.value, -1, 3, DEFAULT_STATE.settings.injectionPosition);
    saveState();
    renderStatus();
  });

  injectionDepthEl?.addEventListener("change", () => {
    const state = getState();
    state.settings.injectionDepth = clampNumber(injectionDepthEl.value, 0, 99, DEFAULT_STATE.settings.injectionDepth);
    saveState();
    renderStatus();
  });

  injectionRoleEl?.addEventListener("change", () => {
    const state = getState();
    state.settings.injectionRole = clampNumber(injectionRoleEl.value, 0, 2, DEFAULT_STATE.settings.injectionRole);
    saveState();
    renderStatus();
  });

  injectionScanEl?.addEventListener("change", () => {
    const state = getState();
    state.settings.injectionScan = !!injectionScanEl.checked;
    saveState();
    renderStatus();
  });

  summaryTemplateEl?.addEventListener("input", () => {
    const state = getState();
    state.settings.summaryPromptTemplate = summaryTemplateEl.value;
    saveState();
  });
  summaryTemplateEl?.addEventListener("change", renderStatus);

  injectionTemplateEl?.addEventListener("input", () => {
    const state = getState();
    state.settings.injectionTemplate = injectionTemplateEl.value;
    saveState();
  });
  injectionTemplateEl?.addEventListener("change", renderStatus);

  startIndexEl?.addEventListener("change", updateDraftRangeFromInputs);
  endIndexEl?.addEventListener("change", updateDraftRangeFromInputs);
  autoSelectBtn?.addEventListener("click", autoSelectNextRange);
  calcLimitsFromRangeBtn?.addEventListener("click", applyLimitsFromSelectedRange);
  generateDraftBtn?.addEventListener("click", () => {
    void generateDraftCheckpoint();
  });
  lockCheckpointBtn?.addEventListener("click", () => {
    void lockDraftCheckpoint();
  });
  clearDraftBtn?.addEventListener("click", clearDraft);
  exportCheckpointsBtn?.addEventListener("click", exportCheckpoints);
  exportCurrentSummaryBtn?.addEventListener("click", exportCurrentSummary);
  importCheckpointsBtn?.addEventListener("click", () => {
    void importCheckpoints();
  });
  importCurrentSummaryBtn?.addEventListener("click", () => {
    void importCurrentSummary();
  });
  draftSummaryEl?.addEventListener("input", () => {
    const state = getState();
    state.draft.summary = draftSummaryEl.value;
    saveState();
    renderStatus();
  });
  lockedListEl?.addEventListener("click", handleLockedListClick);
}

async function renderUI() {
  const container = document.getElementById("extensions_settings2");
  if (!container) return;

  const oldRoot = document.getElementById("st_checkpoint_summarize_settings");
  if (oldRoot) oldRoot.remove();

  const settingsPath = `${getExtensionDirectory()}/settings.html`;
  let settingsHtml = "";
  try {
    settingsHtml = await $.get(settingsPath);
  } catch (error) {
    console.error(`[${MODULE_NAME}] Failed to load settings template`, settingsPath, error);
    toastr.error(`Failed to load settings template: ${settingsPath}`, MODULE_NAME);
    return;
  }

  container.insertAdjacentHTML("beforeend", settingsHtml);
  bindUiEvents();
  try {
    await updateConnectionProfileDropdown();
  } catch (error) {
    console.warn(`[${MODULE_NAME}] Failed to initialize connection profile dropdown`, error);
  }
  renderStatus();
  const state = getState();
  if (state.settings.noBrainModeEnabled) {
    void runNoBrainMaintenanceCycle({ silent: true });
  }
}

jQuery(async () => {
  const state = ensureState();
  if (state.settings.noBrainModeEnabled) {
    applyNoBrainPreset(state);
    saveState();
  }
  await renderUI();
  scheduleHydrationRefresh();
  scheduleAutoModeRun();

  const refresh = () => {
    scheduleHydrationRefresh();
    scheduleAutoModeRun();
  };
  const refreshEvents = [
    event_types?.CHAT_CHANGED,
    event_types?.CHARACTER_MESSAGE_RENDERED,
  ].filter(Boolean);

  for (const eventName of refreshEvents) {
    eventSource?.on?.(eventName, refresh);
  }
});

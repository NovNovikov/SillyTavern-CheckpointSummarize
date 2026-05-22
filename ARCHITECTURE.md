# ST-CheckpointSummarize Architecture

## Purpose
Manual checkpoint summarization for long chats: user selects a large raw range, generates a draft summary for only that range, reviews/edits it, then locks it as an immutable checkpoint.

## Non-goals (v1)
- No recursive summaries.
- No summary-of-summaries.
- No per-message summaries.
- No autonomous background summarization.
- No raw message mutation/deletion.

## Data Model
Stored in `chatMetadata.checkpoint_summarize`.

Top-level fields:
- `version`
- `enabled`
- `injectionEnabled`
- `settings`
- `draft`
- `blocks[]`

`blocks[]` are immutable checkpoints by default workflow (manual edit is allowed, automatic rewrite is forbidden).

## Generation Flow
1. Auto-select next raw block after last locked checkpoint.
2. Build context from previous locked summaries (read-only).
3. Build prompt with strict instruction to summarize only current raw block.
4. Generate draft.
5. User reviews/edits.
6. User locks checkpoint.

## Injection Flow (target)
1. Collect blocks where `locked === true` and `inject !== false`.
2. Build checkpoint memory text.
3. Inject via extension prompt API.
4. If disabled, clear injection.

## Important Functions
- `ensureState`, `getState`, `saveState`
- `getBlocks`, `getLockedBlocks`, `getLastLockedBlock`
- `getNextStartIndex`
- `calculateMessageRangeTokens`
- `autoSelectNextRange`
- `buildPreviousSummariesText`
- `buildRawBlockText`
- `buildSummaryPrompt`
- `generateDraftCheckpoint`
- `lockDraftCheckpoint`
- `renderLockedBlocksList`
- `getBlockValidationWarnings`
- `saveBlockEdits`
- `deleteBlock`
- `toggleBlockInjection`
- `buildInjectionText`
- `updateExtensionPrompt`
- `calculateContextBudget`
- `applyCalculatedLimits`
- `updateConnectionProfileDropdown`
- `runWithSelectedConnectionProfile`

## Known Limitations (current stage)
- Per-checkpoint warnings are UI-only; no automatic repair/rebuild is performed.

## Manual Testing (current stage)
1. Extension appears in settings.
2. New chat creates `chatMetadata.checkpoint_summarize`.
3. Toggle enabled/injection persists through metadata save.
4. Auto-select chooses a forward range after the last locked checkpoint.
5. Draft range token estimate updates when start/end inputs change.
6. Locked checkpoint list supports edit/save/delete/injection toggle.
7. If checkpoint range messages changed, warnings appear in list.
8. Memory Preview matches the exact text injected into prompt.
9. Turning off injection clears this extension prompt slot.

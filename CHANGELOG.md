# Changelog

## 0.1.0 - Stage 1 Scaffold
- Created third-party extension `ST-CheckpointSummarize`.
- Added manifest, base UI, and style.
- Added initial `chatMetadata.checkpoint_summarize` state schema.
- Added core state helpers:
  - `ensureState`
  - `getState`
  - `saveState`
  - `getBlocks`
  - `getLockedBlocks`
  - `getLastLockedBlock`
- Added architecture documentation.

## 0.2.0 - Stage 2 Range Selection and Budgeting
- Added checkpoint range controls (`startIndex`, `endIndex`) and auto-select button.
- Added safe raw block budget calculation based on:
  - max prompt context
  - previous summaries tokens
  - summary prompt instruction tokens
  - target summary tokens
  - safety margin
- Added token estimate helpers for message ranges and unsummarized tail.
- Added deterministic lightweight message hashing for range diagnostics.
- Added status metrics:
  - unsummarized message count
  - estimated unsummarized tail token count
- Added settings controls for:
  - include previous summaries
  - raw block token target
  - summary token target
  - safety margin tokens

## 0.3.0 - Stage 3 Draft Generation and Locking
- Added draft controls:
  - `Generate Draft Checkpoint`
  - `Lock Checkpoint`
  - `Clear Draft`
  - editable draft textarea
- Implemented prompt construction for draft generation:
  - previous locked summaries as read-only context
  - selected raw block as the only summarize target
  - token target replacement in template
- Implemented generation via current model/API style (`generateRaw`).
- Implemented lock flow:
  - validates range and non-empty summary
  - appends immutable checkpoint block with metadata and hashes
  - clears draft after lock
- Added stable checkpoint id allocation (`chk-0001` format).

## 0.4.0 - Stage 4 Locked Checkpoint Management
- Implemented full locked checkpoint list rendering with per-checkpoint metadata:
  - checkpoint id and ordinal number
  - range, message count, source token estimate
  - created/updated timestamps
  - lock status and injection status
  - short summary preview
- Added per-checkpoint actions:
  - `View/Edit summary`
  - `Save edits` (updates `updatedAt`, keeps id/range)
  - `Delete checkpoint`
  - `Enable/disable injection`
- Added checkpoint integrity warnings on render:
  - index missing warnings when saved range is out of chat bounds
  - hash mismatch warnings when start/end message content changed
- Corrected generation context behavior so draft generation uses all locked checkpoints as historical context (independent of per-block injection toggle).

## 0.4.1 - Template Loading Hotfix
- Fixed settings template loading for third-party path resolution.
- Switched UI template fetch to load `settings.html` relative to `import.meta.url` extension directory.

## 0.5.0 - Stage 5 Injection and Preview
- Implemented `buildInjectionText` using locked checkpoints with `inject !== false`.
- Implemented `updateExtensionPrompt` via `getContext().setExtensionPrompt(...)`.
- Injection now auto-syncs on render and state changes:
  - clears extension prompt when extension/injection disabled
  - clears extension prompt when no injectable checkpoints exist
- Memory Preview now shows exact injected prompt text.
- Added injection settings UI:
  - position, depth, role, scan
  - editable summary prompt template
  - editable injection template

## 0.5.1 - Context Budget Calculator
- Added a settings button and calculator UI for token budget formula:
  - max context
  - expected response
  - lorebook
  - system instruction
  - character card
- Implemented formula:
  - `available = maxContext - expectedResponse - lorebook - system - character`
- Added recommended raw-block target computation:
  - `recommendedRawBlock = max(0, available - safetyMargin)`
- `Calculate Limits` now updates `targetRawBlockTokens` automatically when result is positive.

## 0.5.2 - Autofill from Prompt Itemization
- Added `Autofill from Prompt Itemization` button in calculator section.
- New autofill parser reads visible Prompt Itemization values from UI:
  - `Max Context`
  - `System Info`
  - `World Info`
  - character-card components (`Description`, `Personality`, `Scenario`, `Examples`, `User Persona`)
- Autofill sets calculator `expectedResponseTokens = 0` because Prompt Itemization max context is typically already net of response length.

## 0.5.3 - Latest Message Autofill (No Popup Required)
- Autofill now first reads data from the latest stored itemized prompt in current chat (no popup needed).
- Fallback to popup text parsing is retained only as backup.
- Updated autofill button label to reflect latest-chat behavior.

## 0.5.4 - Draft Generation Compatibility Fix
- Draft generation now prefers `generateQuietPrompt` for better compatibility with chat-completion style APIs.
- Added fallback to `generateRaw` if quiet generation fails.
- Added preflight size check (`promptTokens + targetSummaryTokens`) against current context limit.
- Improved error toast to include underlying API error message.

## 0.5.5 - Connection Profile Selection
- Added `Connection Profile` dropdown in settings (with `Same as Current` option).
- Integrated with connection profiles slash commands:
  - `/profile-list` for available profiles
  - `/profile` for current profile and temporary switching
- Draft generation now supports temporary profile override:
  - switches to selected connection profile for generation
  - restores previous profile afterwards
- Dropdown refreshes on click to pick up newly created profiles.

## 0.5.6 - Mandatory Prompt Budget Guard
- Auto-select and draft preflight now account for calculator fixed mandatory load:
  - expected response
  - lorebook
  - system instruction
  - character card
- Added explicit handling for `Mandatory prompts exceed the context size` API errors with actionable guidance.
- Auto-select now aborts early when available raw-block budget is non-positive.

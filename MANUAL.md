# SillyTavern-CheckpointSummarize — User Manual

## What It Is
`SillyTavern-CheckpointSummarize` is a third-party SillyTavern extension for long chat memory management.

It stores chat history as locked checkpoint summaries:
- each checkpoint summarizes only its own message range;
- locked checkpoints are injected as long-term memory;
- new drafts can optionally use previous locked summaries as read-only context.

## Installation
1. Open SillyTavern.
2. Go to Extensions.
3. Install from URL:
   - `https://github.com/NovNovikov/SillyTavern-CheckpointSummarize`
4. Restart SillyTavern if needed.

## Quick Start (Recommended)
1. Enable `Enable extension`.
2. Enable `Enable prompt injection`.
3. Select a `Connection Profile` (preferably a non-reasoning profile for summary generation).
4. Enable `Easy mode (recommended)`.
5. Wait until first checkpoints appear in `Current Summary`.

## Modes

### Manual Mode
Use when you want full control over ranges and summary text.

Flow:
1. Click `Autoselect next block`.
2. Optional: click `Set limits from range`.
3. Click `Generate draft`.
4. Edit text in `Draft checkpoint summary`.
5. Click `Lock Checkpoint`.

### Auto / Semi-auto
Controlled by:
- `Auto mode: generate draft when unsummarized tail reaches target block tokens`
- `Auto approve: auto-lock generated draft in auto mode`

Behavior:
1. When unsummarized tail reaches block target, generation starts.
2. If `Auto approve` is ON, draft is locked automatically.
3. If `Auto approve` is OFF, draft stays for manual review.

### Easy mode
Preset mode that prioritizes automation:
- hides/locks part of manual controls;
- keeps maintenance cycle active;
- recalculates limits for current chat state;
- keeps summarizing valid gaps.

## Important Settings

### Context Compression value
Summary compression ratio presets:
- `Huge compression (1/70)`
- `Normal compression (1/50)`
- `Light compression (1/35)`
- `Endless VRAM (1/20)`

Lower divisor means longer summaries.

### Target raw block tokens
Target raw message block size per checkpoint.

### Target summary tokens
Target summary size.

### Safety margin tokens
Reserved tokens to reduce overflow risk.

### Injection position
Where checkpoint memory is injected into the main prompt.
For most RP cases, `After World info` is recommended.

### Include all previous locked summaries in draft generation
When enabled, draft context includes only truly earlier checkpoints (prevents future-to-past leakage).

## Checkpoint Management
In `Current Summary`:
- `View/Edit summary` — show/hide full summary text;
- `Save edits` — save edited text;
- `Delete checkpoint` — remove checkpoint and reopen its range as unsummarized gap;
- `Disable/Enable injection` — exclude/include checkpoint in memory injection.

## Import / Export
Supported:
- `Export checkpoints`
- `Export current summary`
- `Import checkpoints`
- `Import current summary`

Cross-chat import behavior:
- if message hashes/ranges do not match, records become `memory-only`;
- `memory-only` records do not count as normal range coverage.

## Status Line
The status line shows:
- extension/auto mode state;
- locked checkpoint count;
- summarized/unsummarized token estimates;
- first coverage gap;
- current cycle state:
  - `summary generation in progress`
  - `waiting for unsummarized tokens to reach the batch limit`
  - `Idle`
  - `error`

## Common Issues

### Draft generation fails
Check:
1. Selected `Connection Profile` is valid.
2. Backend is reachable.
3. Context is not overloaded.
4. Draft range is valid.

### Auto mode waits too long
Usually means unsummarized tail is below target block size.
Wait for more messages or lower `Target raw block tokens`.

### After deleting a checkpoint
Its range becomes a gap and should be rebuilt by auto cycle (in auto/easy modes).

## Recommended Workflow for Long RP Chats
1. Use a non-reasoning profile for summarization.
2. Keep `Enable extension` and `Enable prompt injection` ON.
3. Use `Easy mode (recommended)`.
4. Review `Current Summary` periodically.
5. Edit only important checkpoints.
6. Export checkpoints regularly as backups.

## Repository
- `https://github.com/NovNovikov/SillyTavern-CheckpointSummarize`

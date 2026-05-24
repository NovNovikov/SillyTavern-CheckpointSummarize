# SillyTavern-CheckpointSummarize

Manual checkpoint memory for long SillyTavern chats.

`SillyTavern-CheckpointSummarize` helps keep long roleplay and chat sessions usable by turning old chat ranges into locked checkpoint summaries. Each checkpoint covers a specific message range, can be reviewed or edited, and can be injected back into the prompt as long-term memory.

## Why This Exists

Long chats eventually become too large for a model context window. A single global summary can drift, overwrite details, or blur the timeline.

CheckpointSummarize uses a more controlled approach:

- summarize one raw message range at a time;
- keep earlier checkpoint summaries immutable by default;
- use previous checkpoints only as read-only context for the next draft;
- inject locked checkpoints as stable memory;
- reopen deleted checkpoint ranges as gaps that can be rebuilt.

The result is a modular memory timeline instead of one fragile rolling summary.

## Highlights

- Range-based checkpoint summaries.
- Manual review and editing before locking.
- Auto mode for unattended checkpoint generation.
- Easy mode for "turn it on and let it maintain itself" workflows.
- Prompt injection with an `After World info` option.
- Per-checkpoint injection toggle.
- Import and export for backups or migration.
- Range hash warnings when the underlying chat messages changed.
- Connection Profile selection for dedicated summary backends.

## Quick Start

1. Open SillyTavern.
2. Go to `Extensions`.
3. Install from:

   ```text
   https://github.com/NovNovikov/SillyTavern-CheckpointSummarize
   ```

4. Enable `Enable extension`.
5. Enable `Easy mode (recommended)`.
6. Select a `Connection Profile` suitable for summarization.
7. Watch `Current Summary` for generated checkpoints.

Easy mode applies the recommended automation preset, including prompt injection.

## How It Works

1. The extension finds the next unsummarized message gap.
2. It builds a draft prompt for that raw range only.
3. The model generates a checkpoint summary.
4. The summary is reviewed or auto-approved.
5. Locked checkpoints become prompt memory.

Checkpoints are stored in the current chat metadata under:

```text
chatMetadata.checkpoint_summarize
```

The extension does not mutate or delete raw chat messages.

## Modes

### Manual Mode

Use this when you want full control.

- Choose a range.
- Generate a draft.
- Edit the text.
- Lock it as a checkpoint.

### Auto Mode

Use this when you want automation with your own settings.

- Auto mode waits until an unsummarized tail reaches the configured raw block target.
- Middle gaps, such as deleted checkpoint ranges, are rebuilt automatically.
- Auto approve can lock generated drafts without manual review.

### Easy Mode

Use this when you want the extension to manage the workflow.

- Applies recommended automation settings.
- Recalculates context limits from current prompt conditions.
- Keeps the checkpoint timeline maintained.
- Hides or locks controls that could break the automated flow.

## Recommended Workflow

For long roleplay chats:

1. Use a non-reasoning summary profile if possible.
2. Keep prompt injection enabled.
3. Use Easy mode.
4. Periodically review `Current Summary`.
5. Edit only checkpoints that need human correction.
6. Export checkpoints as backups.

## Import And Export

The extension supports:

- `Export checkpoints`
- `Export current summary`
- `Import checkpoints`
- `Import current summary`

When imported checkpoints do not match the current chat message hashes, they are kept as `memory-only` records. They can still be injected, but they do not count as range coverage.

## Documentation

- [English manual](MANUAL.md)
- [Russian manual](MANUAL_RU.md)
- [Architecture notes](ARCHITECTURE.md)
- [Changelog](CHANGELOG.md)

## Status

This is a third-party SillyTavern extension focused on practical long-chat memory management. It is designed to work without patching SillyTavern core.

## License

MIT. See [LICENSE](LICENSE).

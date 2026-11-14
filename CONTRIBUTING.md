# Contributing

Thanks for helping improve Trash Explorer for Sync.

## Development setup

Requirements:

- Node.js 24 or newer
- pnpm
- A separate Obsidian development vault with Obsidian Sync (use a test remote
  vault, not your main vault)

Install dependencies and run the checks:

```sh
pnpm install --frozen-lockfile
pnpm check      # oxlint + Obsidian review rules (eslint-plugin-obsidianmd), oxfmt --check, tsc, vitest
pnpm build
pnpm validate
```

- `pnpm fix` applies lint and format fixes.
- `pnpm dev` rebuilds `main.js` on every change.
- `pnpm exec lefthook install` adds the read-only staged-file check before each
  commit.

The production build writes `main.js` to the repository root. Copy or symlink
the repository into `<vault>/.obsidian/plugins/trash-explorer-for-sync/`,
reload Obsidian, and enable the plugin.

## Code layout

| File                  | Job                                                                             |
| --------------------- | ------------------------------------------------------------------------------- |
| `src/sync-api.ts`     | The only code that touches the internal core Sync plugin. Runtime shape checks. |
| `src/model.ts`        | Pure functions: dedupe, filter, sort, folder tree, highlight.                   |
| `src/restore.ts`      | Restore logic with injected file operations. Never overwrites.                  |
| `src/view.ts`         | The workspace view: toolbar, filters, list, selection, restore flow.            |
| `src/preview.ts`      | Preview pane: versions and content.                                             |
| `src/virtual-list.ts` | Draws only the visible rows.                                                    |
| `src/settings.ts`     | Settings (declarative on Obsidian 1.13+, classic page before that).             |

Keep Obsidian imports out of `model.ts`, `restore.ts` and `sync-api.ts`, so the
tests can run them directly.

## Pull requests

- Keep changes focused and describe the visible behavior.
- Add or update tests for model, restore and Sync adapter changes.
- Run every command above and `git diff --check` before you open a pull
  request.

## Releases

1. Update the version in `manifest.json` and `package.json`.
2. Add the same version and the minimum Obsidian version to `versions.json`.
3. Commit the release changes.
4. Create and push a tag that is exactly the version, without a `v` prefix.

```sh
git tag -a 1.0.0 -m "1.0.0"
git push origin main 1.0.0
```

The release workflow runs all checks, builds and attests `main.js`,
`manifest.json` and `styles.css`, and publishes them to GitHub Releases.

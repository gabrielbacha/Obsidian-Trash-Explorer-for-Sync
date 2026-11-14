# Trash Explorer for Sync

Gabriel's Obsidian plugin. Listed name **Trash Explorer for Sync**, id
`trash-explorer-for-sync`, repo `gabrielbacha/Obsidian-Trash-Explorer-for-Sync`.
README title and website use "Trash Explorer for Obsidian Sync".

## Rules

- Obsidian's community list rejects "Obsidian" in the manifest name, id and
  description. `pnpm validate` checks this.
- All public links (manifest `authorUrl`, README, release body) go to
  `https://mindfulapps.xyz/trash-explorer-for-sync/`, not gabrielbacha.com.
  The website lives in `~/HQ/Coding/_Websites/Mindful-Apps-Website`.
- Core Sync has no public API. Only `src/sync-api.ts` may touch
  `app.internalPlugins`. Keep the runtime shape checks. After an Obsidian
  update, check the calls again in the app bundle
  (`~/Library/Application Support/obsidian/obsidian-<version>.asar`, file
  `app.js`: search `listDeleted`, `getHistory(`, `restoreVersion`).
- Restore must never overwrite a file. Do not use the internal
  `restoreVersion(uid, path)` with a path: it decodes content as text and breaks
  binary files.
- Do not test restores against Gabriel's main vaults without asking. Sync
  spreads restored files and plugin folders to all devices.

## Commands

`pnpm check`, `pnpm build`, `pnpm validate`. See CONTRIBUTING.md.

## Publishing status

See `docs/PUBLISHING.md`.

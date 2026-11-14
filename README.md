# Trash Explorer for Obsidian Sync

Search, filter, preview and restore the files that you deleted in a vault that
uses Obsidian Sync.

<div align="center">
  <h3>Made by <a href="https://mindfulapps.xyz/?utm_source=obsidian_community&amp;utm_medium=referral&amp;utm_campaign=obsidian_assets&amp;utm_content=trash_explorer_for_sync_readme_header">Mindful Apps</a></h3>
  <p>
    <a href="https://mindfulapps.xyz/trash-explorer-for-sync/?utm_source=obsidian_community&amp;utm_medium=referral&amp;utm_campaign=obsidian_assets&amp;utm_content=trash_explorer_for_sync_readme_header"><strong>Plugin page</strong></a>
    &nbsp;·&nbsp;
    <a href="https://mindfulapps.xyz/obsidian/?utm_source=obsidian_community&amp;utm_medium=referral&amp;utm_campaign=obsidian_assets&amp;utm_content=trash_explorer_for_sync_readme_header"><strong>More Obsidian plugins</strong></a>
    &nbsp;·&nbsp;
    <a href="https://github.com/gabrielbacha/Obsidian-Trash-Explorer-for-Sync/issues/new?template=feature_request.yml"><strong>Request a feature</strong></a>
  </p>
</div>

Obsidian Sync keeps deleted files on its server, but the core **Deleted files**
dialog is one long list with no search, no filters and no folders. In a vault
with thousands of deleted files it is almost impossible to find one note.
Trash Explorer for Sync shows the same files in a full workspace tab that you
can search and sort.

The listed name in Obsidian is **Trash Explorer for Sync**.

## Highlights

- Instant fuzzy search on the file name and the full original path.
- Filters: original folder (with subfolders), file type, deleted date (last
  24 hours to last year, or a custom range), device, and "hide files that
  exist again".
- Two layouts: a sortable list (name, folder, deleted date, size, device) or a
  folder tree that groups deleted files under their original folders.
- Preview of the last version before deletion: rendered Markdown, images, PDF,
  audio, video or plain text. Earlier versions are one click away.
- Restore to the original path, restore to another folder, or select many
  files and restore them together.
- Restore never replaces a file. When a file with the same name exists, you
  choose: restore with a name that ends in `(restored)`, or skip.
- Opens the core Sync version history for a file when you need more.
- Fast with large lists: only the visible rows are drawn.
- Works on desktop and mobile.

## How to use

1. Turn on Obsidian Sync for the vault.
2. Select the **archive** ribbon icon, or run the command
   **Trash Explorer for Sync: Open deleted files explorer**.
3. Type in the search box or use the filters. Select a row to preview it.
4. Select **Restore**, or **Restore to…** to choose a folder.
5. To restore many files, use the checkboxes (Shift-click selects a range),
   then select **Restore N files** at the bottom.

Keyboard: arrow keys move through the list, Space selects the current file,
Escape closes the preview.

When you restore the newest version to its original path, the plugin asks the
Sync server to restore it, in the same way as the core dialog. Sync then
downloads the file. In all other cases (another folder, an older version, or a
new name) the plugin downloads that version and creates the file in the vault,
and Sync uploads it as a new file.

## Settings

- **Default date filter** and **Default layout**: how the explorer starts.
- **Hide files that exist again**: hides deleted paths that have a file in the
  vault now, for example after a restore. On by default.
- **Show configuration folder files**: includes deleted files from the
  configuration folder, such as old plugin files. Off by default.

## Important: internal Sync API

Obsidian has no public API for Sync. This plugin uses the same internal calls
as the core **Deleted files** and **Version history** dialogs (checked on
Obsidian 1.15.1). All of these calls are in one file,
[`src/sync-api.ts`](src/sync-api.ts), and each one is checked when it runs.
If a future Obsidian version changes them, the explorer shows a clear message
and does nothing else. It never changes Sync settings.

## Privacy

- The plugin makes no network requests of its own and has no telemetry.
- It reads deleted-file data only through the Sync connection that Obsidian
  already has. Previews stay in memory and are not written to disk.
- Restored files are written into your vault, and Sync then syncs them as
  usual.

Privacy policy: <https://mindfulapps.xyz/trash-explorer-for-sync/privacy/>

## Requirements

- Obsidian 1.8.0 or newer, with an active Obsidian Sync subscription and the
  core Sync plugin turned on and connected to a remote vault.
- Desktop and mobile.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Support

Report bugs and ideas in
[GitHub issues](https://github.com/gabrielbacha/Obsidian-Trash-Explorer-for-Sync/issues)
or email support@mindfulapps.xyz.

## License

[MIT](LICENSE)

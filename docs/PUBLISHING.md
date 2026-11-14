# Publishing checklist

Status on 2026-11-14: 1.0.2 released. Published in the community directory
(<https://community.obsidian.md/plugins/trash-explorer-for-sync>, owner: Gabriel)
with icon and blurred screenshots. Repo is public. Mindful Apps pages are live.
Installed and ON in all managed vaults through `__system/_MASTER.dot.obsidian`.
To update the vaults after a release, replace the three files in
`__system/_MASTER.dot.obsidian/plugins/trash-explorer-for-sync/` (back up first).

Review notes from 1.0.0 (fixed in 1.0.1): the scanner flags any call to an API
newer than `minAppVersion`, including `super.setControlValue` (1.13). It also
warns on `!important` in CSS, and when the README title is not the manifest name.

## Before the first release

- [ ] Manual test in an Obsidian vault with Sync (see the list below).
- [x] Screenshots in `assets/` and in the README (names and contents blurred with CSS before capture).
- [x] Mindful Apps pages live: `/trash-explorer-for-sync/` and `/trash-explorer-for-sync/privacy/`
      (website repo `~/HQ/Coding/_Websites/Mindful-Apps-Website`; a push to `main` deploys).
- [x] Make the GitHub repo public.
- [x] Tag `1.0.0` and push it. The release workflow creates the GitHub release.

## Manual test

- [ ] The list count equals the count in the core Sync "Deleted files" dialog.
- [ ] Search, each filter, sort on each column, list and folder tree layouts.
- [ ] Preview: Markdown, image, PDF, a large file, an older version.
- [ ] Restore to the original path (server restore), to another folder, an older version.
- [ ] Name conflict: restore with a new name, and skip.
- [ ] Bulk restore of several files.
- [ ] Sync turned off: the view shows "Sync is not turned on".
- [ ] Narrow window and mobile: one pane at a time, the back button works.
- [ ] Developer console has no errors.

## Community submission

Checked on 2026-11-14 at <https://docs.obsidian.md/Plugins/Releasing/Submit+your+plugin>:
submission is no longer a pull request to `obsidianmd/obsidian-releases`. It goes
through the directory at <https://community.obsidian.md>.

1. Make sure `manifest.json` at the head of `main` is correct and committed. The directory reads that file.
2. Make sure the GitHub release `1.0.0` exists with `main.js`, `manifest.json` and `styles.css`.
3. Sign in at community.obsidian.md with the Obsidian account and link the GitHub account `gabrielbacha`.
4. Add the plugin (repo `gabrielbacha/Obsidian-Trash-Explorer-for-Sync`). Review is automatic.
5. To fix review findings, publish a new release with a higher version.

Rules: the id must be unique and must not contain "obsidian" (from the docs).
No listed plugin has "Obsidian" in its name (0 of 10,375 on 2026-11-14), so the
name and description avoid the word too.

Notes for the reviewers, if asked:

- The plugin uses the internal core Sync plugin (`app.internalPlugins`) because
  there is no public Sync API. All access is in `src/sync-api.ts`, with runtime
  checks. It reads deleted-file lists and versions, and restores through the
  same call as the core dialog. It never changes Sync settings.
- No network requests of its own, no telemetry.

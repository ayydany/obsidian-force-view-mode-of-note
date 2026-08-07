# Note View Rules

Force Obsidian notes to open in reading view, live preview, or source mode. Rules can use frontmatter, folders, filename patterns, or tags.

## Tag rules

Add ordered tag rules in **Settings → Note View Rules → Tags**. Tags from frontmatter and note content are supported, and the leading `#` is optional.

For example:

- `dashboard` → `obsidianUIMode: preview`
- `task` → `obsidianEditingMode: live`

Tag matching is exact and case-insensitive. When multiple tag rules match, the bottom-most rule wins. Tag rules override filename and folder rules, matching the existing behavior where configured rules override per-note frontmatter.

## Frontmatter

Changing the **view mode** can be done through the key `obsidianUIMode`, which can have the value `source` or `preview`. Changing the **editing mode** happens by declaring the key `obsidianEditingMode`; it takes `live` or `source` as value.

Example: add below snippet (front matter) to your note ...
```
---
obsidianUIMode: source
obsidianEditingMode: live
---
```
... and this will force the note to open in "live preview" edit mode.


Similar, ... add below snippet to your note ...
```
---
obsidianUIMode: preview
---
```
... and this will always open the note in a reading (/ preview) mode.

This plug-in also ensures that a note is always opened in the configured default mode (suppose the Obsidian setting has "preview" as default mode but the pane is currently in "source" mode, then opening a new note in that same pane will open in "preview" mode).

## Attribution

Based on [Obsidian Force Note View Mode](https://github.com/bwydoogh/obsidian-force-view-mode-of-note) by Benny Wydooghe.

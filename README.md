# Note View Rules

Open Obsidian notes in Reading view, Live Preview, or Source mode using one ordered rule list.

## Rules

Rules run from top to bottom and the first matching rule wins. Drag rules to change their priority. Each rule can require all conditions or any condition to match.

Available condition sources:

- **Tag:** includes or does not include an exact tag.
- **File name:** exact, negative, text, prefix, suffix, or regular-expression matching. File names include their extension.
- **Folder:** direct-folder or folder-tree matching.
- **Full path:** exact, negative, text, prefix, or regular-expression matching.

Available outputs:

- Reading view
- Editing view → Live Preview
- Editing view → Source mode

If no rule matches, the plugin does nothing and Obsidian keeps its chosen view. Invalid or incomplete rules are saved but never match.

Tag and normal text comparisons are exact and case-insensitive. Regular expressions are case-sensitive.

## Legacy frontmatter

Rules take priority over the original frontmatter behavior. When no rule matches, these properties remain supported as a secondary fallback:

```yaml
---
obsidianUIMode: preview
---
```

```yaml
---
obsidianUIMode: source
obsidianEditingMode: live
---
```

## Attribution

Based on [Obsidian Force Note View Mode](https://github.com/bwydoogh/obsidian-force-view-mode-of-note) by Benny Wydooghe.

---
name: notepad-code
description: Used to manage, search, read, create, update, and delete Notepad Code notebooks and pages.
---

# Notepad Code Skill

This skill allows you to manage notebooks and note pages inside the Notepad Code extension.

## Available MCP Tools

1. `notepad_list_notebooks`: Lists all notebook and page titles and IDs.
2. `notepad_read_page`: Reads the full content of a specific page (`notebookId`, `pageId`).
3. `notepad_search_notes`: Performs full-text search across all notes (`query`).
4. `notepad_create_notebook`: Creates a new notebook (`title`, `description`).
5. `notepad_create_page`: Adds a new page to a notebook (`notebookId`, `title`, `content`).
6. `notepad_update_page`: Updates page title or content (`notebookId`, `pageId`, `title`, `content`).
7. `notepad_rename_notebook`: Renames an existing notebook (`notebookId`, `title`).
8. `notepad_delete_page`: Permanently deletes a note page (`notebookId`, `pageId`, `confirm: true`).
9. `notepad_delete_notebook`: Permanently deletes a notebook and all its pages (`notebookId`, `confirm: true`).
10. `notepad_export_notes`: Exports all notes as a JSON backup string.
11. `notepad_import_notes`: Restores or imports notes from JSON (`jsonData`, `confirm: true`).

## ⚠️ Safety & Data Loss Prevention Rules

The tools `notepad_delete_page`, `notepad_delete_notebook`, and `notepad_import_notes` carry permanent data loss risks.
- NEVER pass `confirm: true` without obtaining explicit user confirmation first.
- Clearly inform the user which specific notebook or page will be deleted before proceeding.

## 📝 Plain-Text Formatting Rule

All notes in Notepad Code are stored in **normal plain text** format.
- DO NOT use Markdown formatting syntax (`#`, `##`, `**bold**`, ` ``` `, etc.) when creating or updating page content.
- Format headings, lists, and sections using clean, natural plain text lines.

---
name: announcement-specialist
description: Create and publish a concise version announcement for this workspace from a user-supplied version number. Use when asked to draft, summarize, add, or release a project announcement based on changes since the latest announcement.
---

# Announcement Specialist

Publish concise, factual release announcements in this repository's existing announcement source.

## Workflow

1. Require a version number. Ask for it if it is absent; do not infer a release version.
2. Read the repository `AGENTS.md` and locate the announcement source. In this project it is normally `client/src/content/announcements.ts`; also read its test.
3. Identify the newest existing announcement's date and ID. Treat it as the baseline.
4. Summarize changes since that baseline from relevant evidence: inspect committed changes after the baseline date, inspect uncommitted focused diffs, and confirm gameplay claims against configuration, documentation, and tests.
5. Add one newest-first announcement with a stable ID in the existing convention: `YYYY-MM-DD-vXYZ-short-slug`. Use the current local date unless the user specifies a release date.
6. Match the established TypeScript data shape and tone. Update the focused announcement test so it asserts the new first entry and preserves existing order assertions.
7. Run the focused announcement test and `git diff --check`. Report the announcement source, test result, and any intentionally omitted uncertain changes.

## Writing Rules

- Describe change directions and player impact, not an exhaustive implementation log.
- Prefer 3-5 short sections with 2-4 bullets each. Use a short summary and relevant tags.
- Include concrete mechanics only when necessary to avoid a misleading claim. Do not enumerate internal files, test counts, or implementation details in the announcement.
- Keep claims limited to changes supported by the workspace. Exclude unrelated dirty-worktree changes and unfinished work.
- Preserve every prior announcement ID and keep entries newest-first. Do not modify the unread-cursor logic.
- Do not pin a new announcement unless the project's current release convention or the user explicitly calls for it.

# PrintersHero Bulk File Renamer

This Windows helper uses Python 3 and only runs an approved plan from **Tools → Bulk File Renamer**. It never listens on a local port, uploads files, copies files, or receives rename commands from the Print Agent.

1. In PrintersHero, enter a prefix, select files, review every proposed name, and choose **Rename Files** to download `printershero-rename-plan.json`.
2. Download `printershero-bulk-file-renamer.py` from the same page. Open it with Python 3, or run `py printershero-bulk-file-renamer.py` from a terminal.
3. Select the approved plan, then select the exact matching local files. Review the paths and confirm in the helper.
4. The helper writes separate results and undo JSON files beside the plan. Import the results JSON in PrintersHero to review the per-file outcome.
5. To undo, open the helper again and select the undo JSON, or run `py printershero-bulk-file-renamer.py --undo <undo-manifest.json>`. Undo requires the original name to be free, the renamed file to be unchanged, the organization setting to remain enabled, and the plan authorization to remain valid (30 minutes after approval).

Network shares work when the current Windows user can rename files there. Read-only files and permission failures are reported per file. The helper never elevates privileges.

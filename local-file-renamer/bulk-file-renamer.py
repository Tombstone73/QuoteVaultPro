"""PrintersHero local rename executor. Requires an approved plan from Tools.

Run: python bulk-file-renamer.py [printershero-rename-plan.json]
Undo: python bulk-file-renamer.py --undo printershero-rename-undo-....json

The web application owns names and authorization. This process only selects
local files, checks the exact plan, and calls the OS rename primitive.
"""

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.parse
import urllib.request
from uuid import uuid4


def _checked_authorization_url(value):
    if not isinstance(value, str):
        raise ValueError("The plan has no authorization endpoint.")
    parsed = urllib.parse.urlparse(value)
    allowed = {"api-dev.printershero.com", "localhost", "127.0.0.1"}
    if parsed.hostname not in allowed or parsed.path != "/api/tools/bulk-file-renamer/authorize":
        raise ValueError("The plan has an unrecognized authorization endpoint.")
    if parsed.scheme != ("http" if parsed.hostname in {"localhost", "127.0.0.1"} else "https"):
        raise ValueError("The plan has an unsafe authorization endpoint.")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("The plan has an unsafe authorization endpoint.")
    return value


def _safe_name(value):
    return (isinstance(value, str) and value not in {"", ".", ".."}
            and len(value) <= 255 and not any(c in value for c in '/\\<>:"|?*')
            and not value.endswith((" ", ".")) and all(ord(c) >= 32 for c in value))


def _authorize(plan):
    url = _checked_authorization_url(plan.get("authorizationUrl"))
    body = json.dumps({
        "authorizationToken": plan.get("authorizationToken"),
        "prefix": plan.get("prefix"),
        "entries": plan.get("entries"),
    }).encode("utf-8")
    request = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(request, timeout=15) as response:
        if response.status != 200 or json.load(response).get("authorized") is not True:
            raise PermissionError("The organization no longer authorizes this rename plan.")


def _fingerprint(path):
    stat = path.stat()
    return {"size": stat.st_size, "modifiedNs": stat.st_mtime_ns, "device": stat.st_dev, "inode": stat.st_ino}


def _same_file(path, fingerprint):
    current = _fingerprint(path)
    return (current["size"] == fingerprint["size"]
            and current["modifiedNs"] == fingerprint["modifiedNs"]
            and (not fingerprint["inode"] or (current["device"], current["inode"]) ==
                 (fingerprint["device"], fingerprint["inode"])))


def _validate_plan(plan):
    if not isinstance(plan, dict) or plan.get("version") != 1 or not isinstance(plan.get("entries"), list) or not plan["entries"]:
        raise ValueError("Invalid rename plan.")
    _checked_authorization_url(plan.get("authorizationUrl"))
    for entry in plan["entries"]:
        if (not isinstance(entry, dict) or entry.get("status") not in {"ready", "already_prefixed"}
                or not _safe_name(entry.get("originalName")) or not _safe_name(entry.get("proposedName"))):
            raise ValueError("The plan contains an invalid file name or status.")


def execute_plan(plan, selected_paths, authorize=_authorize, confirm=lambda text: False):
    _validate_plan(plan)
    paths = [Path(path) for path in selected_paths]
    if Counter(path.name for path in paths) != Counter(entry["originalName"] for entry in plan["entries"]):
        raise ValueError("Selected files do not exactly match the approved plan.")
    if len(set(paths)) != len(paths):
        raise ValueError("The same file was selected more than once.")
    if len({entry["originalName"].casefold() for entry in plan["entries"]}) != len(plan["entries"]):
        raise ValueError("The plan has ambiguous duplicate filenames.")
    by_name = {path.name: path for path in paths}
    work = [(entry, by_name[entry["originalName"]]) for entry in plan["entries"]]
    preview = "\n".join(
        f"{source}  →  {source.with_name(entry['proposedName'])}"
        + ("  [DESTINATION EXISTS]" if entry["status"] == "ready" and source.with_name(entry["proposedName"]).exists() else "")
        for entry, source in work)
    if not confirm(preview):
        raise ValueError("Rename canceled before any file changed.")
    authorize(plan)  # Always check the active tenant setting immediately before execution.
    results = []
    completed = []
    # Resolve every destination before changing any file. A collision in one
    # row never risks replacing it, and the rest of the batch can still run.
    blocked = {str(source): "Destination already exists" for entry, source in work
               if entry["status"] == "ready" and source.with_name(entry["proposedName"]).exists()}
    for entry, source in work:
        target = source.with_name(entry["proposedName"])
        result = {"originalName": entry["originalName"], "proposedName": entry["proposedName"]}
        if entry["status"] == "already_prefixed":
            if source.is_file() and not source.is_symlink():
                results.append({**result, "status": "skipped", "reason": "Already prefixed"})
            else:
                results.append({**result, "status": "failed", "reason": "Selected source is unavailable"})
            continue
        try:
            if str(source) in blocked:
                raise FileExistsError(blocked[str(source)])
            if source.is_symlink() or not source.is_file():
                raise OSError("Source is not an ordinary file")
            if target.exists():
                raise FileExistsError("Destination already exists")
            before = _fingerprint(source)
            os.rename(source, target)  # Windows rename fails if destination appeared meanwhile.
            completed.append({"originalPath": str(source), "renamedPath": str(target), "fingerprint": before})
            results.append({**result, "status": "renamed"})
        except OSError as error:
            results.append({**result, "status": "failed", "reason": str(error)})
    return {"results": results, "completed": completed, "plan": plan}


def undo_completed(manifest, authorize=_authorize, confirm=lambda text: False):
    plan = manifest.get("plan")
    _validate_plan(plan)
    completed = manifest.get("completed")
    if not isinstance(completed, list):
        raise ValueError("Invalid undo manifest.")
    permitted = {(entry["originalName"], entry["proposedName"])
                 for entry in plan["entries"] if entry["status"] == "ready"}
    for item in completed:
        source, target = Path(item["renamedPath"]), Path(item["originalPath"])
        if (not _safe_name(source.name) or not _safe_name(target.name)
                or source.parent != target.parent or (target.name, source.name) not in permitted):
            raise ValueError("Undo manifest does not match the approved plan.")
    preview = "\n".join(f"{item['renamedPath']}  →  {item['originalPath']}" for item in completed)
    if not confirm(preview):
        raise ValueError("Undo canceled before any file changed.")
    authorize(plan)
    results = []
    for item in completed:
        source, target = Path(item["renamedPath"]), Path(item["originalPath"])
        result = {"originalName": source.name, "proposedName": target.name}
        try:
            if source.is_symlink() or not source.is_file() or target.exists() or not _same_file(source, item["fingerprint"]):
                raise OSError("Original name is occupied or renamed file has changed")
            os.rename(source, target)
            results.append({**result, "status": "renamed"})
        except OSError as error:
            results.append({**result, "status": "failed", "reason": str(error)})
    return {"results": results}


def _choose_file(title):
    from tkinter import filedialog, Tk
    root = Tk(); root.withdraw()
    try:
        return filedialog.askopenfilename(title=title, filetypes=[("JSON", "*.json")])
    finally:
        root.destroy()


def _choose_files():
    from tkinter import filedialog, Tk
    root = Tk(); root.withdraw()
    try:
        return filedialog.askopenfilenames(title="Select the exact files in the approved plan")
    finally:
        root.destroy()


def _confirm_all(preview):
    from tkinter import Button, Frame, Scrollbar, Text, Tk
    root = Tk(); root.title("PrintersHero Bulk File Renamer — review every file")
    root.geometry("850x500")
    frame = Frame(root); frame.pack(fill="both", expand=True)
    text = Text(frame, wrap="none"); scroll = Scrollbar(frame, command=text.yview)
    text.configure(yscrollcommand=scroll.set)
    text.insert("1.0", preview); text.configure(state="disabled")
    text.pack(side="left", fill="both", expand=True); scroll.pack(side="right", fill="y")
    approved = {"value": False}
    def finish(value):
        approved["value"] = value; root.destroy()
    Button(root, text="Rename Files / Confirm Undo", command=lambda: finish(True)).pack(side="right")
    Button(root, text="Cancel", command=lambda: finish(False)).pack(side="right")
    root.protocol("WM_DELETE_WINDOW", lambda: finish(False))
    root.mainloop()
    return approved["value"]


def _write_json(directory, stem, value):
    target = Path(directory) / f"{stem}-{datetime.now(timezone.utc):%Y%m%d-%H%M%S}-{uuid4().hex[:8]}.json"
    with target.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2)
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plan", nargs="?", help="Approved rename plan JSON")
    parser.add_argument("--undo", help="Undo manifest JSON")
    args = parser.parse_args()
    manifest_path = args.undo or args.plan or _choose_file("Select an approved plan or undo manifest")
    if not manifest_path:
        return 1
    with open(manifest_path, encoding="utf-8") as stream:
        document = json.load(stream)
    if args.undo or (isinstance(document, dict) and "completed" in document and "plan" in document):
        output = undo_completed(document, confirm=_confirm_all)
    else:
        paths = _choose_files()
        if not paths:
            return 1
        output = execute_plan(document, paths, confirm=_confirm_all)
    counts = Counter(result["status"] for result in output["results"])
    print(f"Renamed: {counts['renamed']}; skipped: {counts['skipped']}; failed: {counts['failed']}")
    try:
        if not (args.undo or (isinstance(document, dict) and "completed" in document and "plan" in document)) and output["completed"]:
            undo_path = _write_json(Path(manifest_path).parent, "printershero-rename-undo", {
                "plan": output["plan"], "completed": output["completed"],
            })
            print(f"Undo manifest: {undo_path}")
        results_path = _write_json(Path(manifest_path).parent, "printershero-rename-results", {"results": output["results"]})
        print(f"Results: {results_path}")
    except OSError as error:
        print(f"File operations completed, but the results or undo manifest could not be saved: {error}", file=sys.stderr)
        return 2
    return 2 if counts["failed"] else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, urllib.error.URLError) as error:
        print(f"No changes completed: {error}", file=sys.stderr)
        sys.exit(1)

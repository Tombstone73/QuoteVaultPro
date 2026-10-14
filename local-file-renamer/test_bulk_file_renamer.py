import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("bulk_file_renamer", Path(__file__).with_name("bulk-file-renamer.py"))
renamer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renamer)


def plan(entries):
    return {
        "version": 1, "prefix": "20685", "authorizationToken": "test-token",
        "authorizationUrl": "https://api-dev.printershero.com/api/tools/bulk-file-renamer/authorize",
        "entries": entries,
    }


class BulkFileRenamerTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        self.authorized = []

    def tearDown(self):
        self.folder.cleanup()

    def auth(self, approved_plan):
        self.authorized.append(approved_plan)

    def test_multiple_files_mixed_prefixed_and_safe_undo_preserve_bytes(self):
        banner = self.root / "Banner.pdf"
        cut = self.root / "Cut File.ai"
        already = self.root / "20685  Proof.pdf"
        banner.write_bytes(b"banner contents")
        cut.write_bytes(b"cut contents")
        already.write_bytes(b"proof contents")
        entries = [
            {"originalName": "Banner.pdf", "proposedName": "20685  Banner.pdf", "status": "ready"},
            {"originalName": "Cut File.ai", "proposedName": "20685  Cut File.ai", "status": "ready"},
            {"originalName": already.name, "proposedName": already.name, "status": "already_prefixed"},
        ]
        result = renamer.execute_plan(plan(entries), [banner, cut, already], authorize=self.auth, confirm=lambda _: True)
        self.assertEqual([item["status"] for item in result["results"]], ["renamed", "renamed", "skipped"])
        self.assertEqual((self.root / "20685  Banner.pdf").read_bytes(), b"banner contents")
        self.assertEqual((self.root / "20685  Cut File.ai").read_bytes(), b"cut contents")
        self.assertFalse(banner.exists())
        self.assertEqual(len(result["completed"]), 2)
        undone = renamer.undo_completed(result, authorize=self.auth, confirm=lambda _: True)
        self.assertEqual([item["status"] for item in undone["results"]], ["renamed", "renamed"])
        self.assertEqual(banner.read_bytes(), b"banner contents")
        self.assertEqual(cut.read_bytes(), b"cut contents")
        self.assertEqual(len(self.authorized), 2)

    def test_existing_destination_and_partial_failure_never_overwrite(self):
        first = self.root / "Banner.pdf"
        second = self.root / "Cut.pdf"
        first.write_bytes(b"first")
        second.write_bytes(b"second")
        (self.root / "20685  Cut.pdf").write_bytes(b"existing")
        entries = [
            {"originalName": first.name, "proposedName": "20685  Banner.pdf", "status": "ready"},
            {"originalName": second.name, "proposedName": "20685  Cut.pdf", "status": "ready"},
        ]
        result = renamer.execute_plan(plan(entries), [first, second], authorize=self.auth, confirm=lambda _: True)
        self.assertEqual([item["status"] for item in result["results"]], ["renamed", "failed"])
        self.assertEqual((self.root / "20685  Cut.pdf").read_bytes(), b"existing")
        self.assertEqual(second.read_bytes(), b"second")

    def test_disabled_or_expired_authority_prevents_every_rename(self):
        source = self.root / "Banner.pdf"
        source.write_bytes(b"unchanged")
        entry = {"originalName": source.name, "proposedName": "20685  Banner.pdf", "status": "ready"}
        def deny(_):
            raise PermissionError("disabled")
        with self.assertRaises(PermissionError):
            renamer.execute_plan(plan([entry]), [source], authorize=deny, confirm=lambda _: True)
        self.assertTrue(source.exists())

    def test_undo_refuses_modified_target_or_occupied_original(self):
        source = self.root / "Banner.pdf"
        source.write_bytes(b"original")
        entry = {"originalName": source.name, "proposedName": "20685  Banner.pdf", "status": "ready"}
        result = renamer.execute_plan(plan([entry]), [source], authorize=self.auth, confirm=lambda _: True)
        renamed = self.root / entry["proposedName"]
        renamed.write_bytes(b"changed")
        undone = renamer.undo_completed(result, authorize=self.auth, confirm=lambda _: True)
        self.assertEqual(undone["results"][0]["status"], "failed")
        self.assertFalse(source.exists())
        self.assertTrue(renamed.exists())

    def test_network_permission_failure_is_reported_per_file(self):
        source = self.root / "Network.pdf"
        source.write_bytes(b"data")
        entry = {"originalName": source.name, "proposedName": "20685  Network.pdf", "status": "ready"}
        with patch.object(renamer.os, "rename", side_effect=PermissionError("network share denies rename")):
            result = renamer.execute_plan(plan([entry]), [source], authorize=self.auth, confirm=lambda _: True)
        self.assertEqual(result["results"][0]["status"], "failed")
        self.assertTrue(source.exists())

    def test_read_only_permission_failure_is_reported_without_copying(self):
        source = self.root / "ReadOnly.pdf"
        source.write_bytes(b"data")
        entry = {"originalName": source.name, "proposedName": "20685  ReadOnly.pdf", "status": "ready"}
        with patch.object(renamer.os, "rename", side_effect=PermissionError("read-only file")):
            result = renamer.execute_plan(plan([entry]), [source], authorize=self.auth, confirm=lambda _: True)
        self.assertEqual(result["results"][0]["status"], "failed")
        self.assertEqual(source.read_bytes(), b"data")
        self.assertFalse((self.root / entry["proposedName"]).exists())

    def test_undo_refuses_an_occupied_original_name(self):
        source = self.root / "Banner.pdf"
        source.write_bytes(b"original")
        entry = {"originalName": source.name, "proposedName": "20685  Banner.pdf", "status": "ready"}
        result = renamer.execute_plan(plan([entry]), [source], authorize=self.auth, confirm=lambda _: True)
        source.write_bytes(b"another file")
        undone = renamer.undo_completed(result, authorize=self.auth, confirm=lambda _: True)
        self.assertEqual(undone["results"][0]["status"], "failed")
        self.assertEqual(source.read_bytes(), b"another file")


if __name__ == "__main__":
    unittest.main()

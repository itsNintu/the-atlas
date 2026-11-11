"""Synthetic transport tests; never use production credentials."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("provision", ROOT / "scripts/hosted-provision-agent.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ProvisionTests(unittest.TestCase):
    def test_private_reservation_retry_and_nonsecret_receipt(self):
        # NTFS ACL behavior must be exercised on Windows storage, not WSL's UNC filesystem.
        temporary_root = Path(os.environ["TMPDIR"]) if os.name == "nt" else ROOT / ".private"
        temporary_root.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=temporary_root) as directory:
            root = Path(directory)
            admin = root / "admin.json"
            admin.write_text(json.dumps({"token": "synthetic-admin"}))
            credential = root / "agent.json"
            args = ["provision", "--url", "https://atlas.example", "--admin-credential", str(admin),
                    "--agent", "test-company", "--name", "Test company", "--credential-file", str(credential)]
            calls = []
            class Transport:
                def open(self, request, **kwargs):
                    calls.append(request)
                    if len(calls) == 1:
                        raise urllib.error.URLError("synthetic-lost-response")
                    return io.BytesIO(json.dumps({"request_id": "req-synthetic", "data": {
                        "agent_id": "test-company", "principal_id": "prn-test", "credential_id": "key-test",
                        "workspace_id": "ws-test", "scopes": ["agent:test-company", "user:alex", "business:alex"],
                    }}).encode())
            with patch("sys.argv", args), patch.object(module.urllib.request, "build_opener", return_value=Transport()):
                with self.assertRaisesRegex(RuntimeError, "retained"):
                    module.main()
                saved = json.loads(credential.read_text())
                token = saved["token"]
                if os.name != "nt": self.assertEqual(credential.stat().st_mode & 0o777, 0o600)
                output = io.StringIO()
                with contextlib.redirect_stdout(output): module.main()
                self.assertNotIn(token, output.getvalue())
                self.assertNotIn("synthetic-admin", output.getvalue())
                self.assertEqual(json.loads(credential.read_text())["token"], token)
                self.assertEqual(calls[0].data, calls[1].data)
                self.assertEqual(calls[0].get_header("Idempotency-key"), calls[1].get_header("Idempotency-key"))
                self.assertEqual(json.loads(calls[0].data)["token_hash"], hashlib.sha256(token.encode()).hexdigest())
                self.assertNotIn(token.encode(), calls[0].data)
                self.assertEqual(json.loads(output.getvalue())["principal_id"], "prn-test")
            with patch("sys.argv", [*args[:-3], "Different company", "--credential-file", str(credential)]):
                with self.assertRaisesRegex(RuntimeError, "different provisioning request"): module.main()
            self.assertEqual(json.loads(credential.read_text())["token"], token)


if __name__ == "__main__":
    unittest.main()

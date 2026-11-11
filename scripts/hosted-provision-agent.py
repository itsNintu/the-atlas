#!/usr/bin/env python3
"""Provision an Atlas agent using a private, client-generated token (stdlib only).

The reserved credential file survives network errors. Retry the identical command:
the token hash and idempotency key stay stable, including after a lost response.
No server database, migration token, operations token or raw-secret API is used.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import stat
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def private(path):
    if os.name == "nt":
        # Explicit current-user SID avoids account-name/localization ambiguity.
        import csv
        sid = next(csv.reader(subprocess.check_output(
            ["whoami", "/user", "/fo", "csv", "/nh"], text=True).splitlines()))[1]
        result = subprocess.run(["icacls", str(path), "/inheritance:r", "/grant:r", f"*{sid}:(F)"], capture_output=True)
        if result.returncode:
            raise RuntimeError("Could not restrict credential ACL")
    elif stat.S_IMODE(path.stat().st_mode) & 0o077:
        raise RuntimeError("Credential file must be mode 0600")


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--url", required=True)
    p.add_argument("--admin-credential", type=Path, required=True)
    p.add_argument("--agent", required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--credential-file", type=Path, required=True)
    args = p.parse_args()
    target = urllib.parse.urlsplit(args.url)
    if target.scheme != "https" or not target.netloc or target.username or target.password or target.query or target.fragment or target.path not in ("", "/"):
        raise RuntimeError("A plain HTTPS origin is required")
    base = args.url.rstrip("/")
    path = args.credential_file.resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        private(path)
        saved = json.loads(path.read_text())
    else:
        os.close(fd)
        private(path)  # Restrict Windows ACL before any secret reaches disk.
        saved = {"url": base, "agent_id": args.agent, "name": args.name,
                 "token": "ta_" + secrets.token_urlsafe(32)}
        with path.open("w") as output:
            json.dump(saved, output); output.flush(); os.fsync(output.fileno())
    if (saved.get("url"), saved.get("agent_id"), saved.get("name")) != (base, args.agent, args.name):
        raise RuntimeError("Existing credential belongs to a different provisioning request")
    token_hash = hashlib.sha256(saved["token"].encode()).hexdigest()
    # The existing admin credential is read, never copied or modified.
    admin = json.loads(args.admin_credential.read_text())
    body = {"agent_id": args.agent, "name": args.name, "token_hash": token_hash}
    request = urllib.request.Request(base + "/v1/memory/agents", data=json.dumps(body).encode(), method="POST", headers={
        "Authorization": "Bearer " + admin["token"], "Content-Type": "application/json",
        "User-Agent": "Hermes-Atlas/1.2.6", "Idempotency-Key": "provision-agent:" + token_hash,
    })
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=60) as response:
            result = json.load(response)
    except urllib.error.HTTPError as exc:
        # Never print an untrusted response body that might contain secret material.
        raise RuntimeError(f"Provisioning HTTP {exc.code}; private file retained for identical retry") from None
    except (urllib.error.URLError, TimeoutError):
        raise RuntimeError("Provisioning connection failed; private file retained for identical retry") from None
    receipt = result["data"]
    if receipt["agent_id"] != args.agent:
        raise RuntimeError("Unexpected provisioning identity; private file retained")
    # Never rewrite/truncate the reserved token after a remote side effect.
    # Principal/credential IDs belong in the nonsecret receipt, not a second key copy.
    print(json.dumps({"request_id": result["request_id"], **receipt, "credential_file": str(path), "secret_printed": False}))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc) if isinstance(exc, RuntimeError) else type(exc).__name__, "secret_printed": False}), file=sys.stderr)
        sys.exit(1)

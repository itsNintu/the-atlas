#!/usr/bin/env python3
"""Switch the six existing native Atlas adapters without changing their credentials/scopes.

Run with Hermes' installed Windows Python. The required backup directory must be private: it
contains credential files for rollback. No token is printed by this script.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

ENDPOINT = "https://atlas.creator.gg"
LOCAL_ENDPOINTS = {"http://127.0.0.1:8787", "http://localhost:8787"}
PROFILES = ("default", "builder", "reaver", "overwatch", "wordsmith", "orchestrator")


def atomic_json(path: Path, value: dict) -> None:
    handle, temporary = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(value, stream, indent=2)
            stream.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def profile_home(root: Path, profile: str) -> Path:
    return root if profile == "default" else root / "profiles" / profile


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backup-dir", type=Path, required=True)
    parser.add_argument("--rollback", action="store_true")
    args = parser.parse_args()
    local = os.environ.get("LOCALAPPDATA")
    if not local:
        raise SystemExit("LOCALAPPDATA is required on native Windows")
    root = Path(local) / "hermes"
    source = Path(__file__).resolve().parent
    args.backup_dir.mkdir(parents=True, exist_ok=True)
    changed = []
    for profile in PROFILES:
        home = profile_home(root, profile)
        atlas = home / "atlas"
        backup = args.backup_dir / profile
        backup.mkdir(parents=True, exist_ok=True)
        config_path, credential_path = atlas / "config.json", atlas / "credential.json"
        if args.rollback:
            for path in (config_path, credential_path):
                if not (backup / path.name).is_file():
                    raise SystemExit(f"Missing rollback file for {profile}: {path.name}")
                shutil.copy2(backup / path.name, path)
        else:
            config = json.loads(config_path.read_text(encoding="utf-8-sig"))
            credential = json.loads(credential_path.read_text(encoding="utf-8-sig"))
            if not credential.get("principal_id") or not credential.get("token"):
                raise SystemExit(f"Missing existing credential identity for {profile}; refusing cutover")
            if config.get("url") not in LOCAL_ENDPOINTS | {ENDPOINT}:
                raise SystemExit(f"Unexpected endpoint for {profile}; refusing cutover")
            if config.get("url") != ENDPOINT:
                shutil.copy2(config_path, backup / config_path.name)
                shutil.copy2(credential_path, backup / credential_path.name)
                config["url"] = ENDPOINT
                credential["url"] = ENDPOINT
                atomic_json(config_path, config)
                atomic_json(credential_path, credential)
            changed.append(profile)

    # Use Hermes' own supported reload implementation and socket authentication.
    sys.path.insert(0, str(root / "hermes-agent"))
    from gateway.control_socket import reload_gateway_plugins

    receipts = []
    for profile in PROFILES:
        home = profile_home(root, profile)
        receipt = reload_gateway_plugins(str(home)) or {}
        if not receipt and profile != "default":
            receipt = reload_gateway_plugins(str(root), profile_home=str(home)) or {}
        plugins = receipt.get("plugins") or []
        activations = receipt.get("activations") or []
        activation = next((item for item in activations if item.get("key") == "atlas-memory"), {})
        if "atlas-memory" not in plugins or not activation:
            raise SystemExit(f"Live reload did not activate Atlas for {profile}")
        configured = json.loads((home / "atlas" / "config.json").read_text(encoding="utf-8-sig"))
        expected_url = configured.get("url")
        if not args.rollback and expected_url != ENDPOINT:
            raise SystemExit(f"Hosted Atlas configuration is absent for {profile}")
        if args.rollback and expected_url not in LOCAL_ENDPOINTS:
            raise SystemExit(f"Local Atlas configuration was not restored for {profile}")
        receipts.append({"profile": profile, "configured_url": expected_url, "plugin_reloaded": True})
    print(json.dumps({"rollback": args.rollback, "reloaded": receipts}, indent=2))


if __name__ == "__main__":
    main()

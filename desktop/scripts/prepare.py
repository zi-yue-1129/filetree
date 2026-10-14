"""Validate CI inputs and generate a Tauri configuration overlay."""

import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit


def main() -> None:
    """Require production configuration for release builds; label test fallbacks."""
    release = os.environ.get("DESKTOP_RELEASE") == "true"
    version = os.environ.get("DESKTOP_VERSION", "0.1.0")
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", version):
        raise ValueError("Desktop version must be a SemVer without a v prefix")
    origin = os.environ.get("CONFIGURED_API_URL", "")
    if not origin:
        if release:
            raise ValueError("Release requires repository variable VITE_API_BASE_URL")
        print("::warning::VITE_API_BASE_URL is absent; test app uses http://localhost:5168 and requires a local backend.")
        origin = "http://localhost:5168"
    parsed = urlsplit(origin)
    if (parsed.scheme not in {"http", "https"} or not parsed.netloc
            or parsed.path or parsed.query or parsed.fragment or parsed.username):
        raise ValueError("VITE_API_BASE_URL must be an HTTP(S) origin without a path or trailing slash")
    site_url = os.environ.get("VITE_SITE_URL", "")
    if not site_url:
        if release:
            raise ValueError("Release requires repository variable VITE_SITE_URL (public web origin for share links)")
        # GitHub Actions workflow command (annotation), not a log message.
        sys.stdout.write("::warning::VITE_SITE_URL is absent; copying share links in this test app shows an error.\n")
    else:
        parsed_site = urlsplit(site_url)
        if parsed_site.scheme not in {"http", "https"} or not parsed_site.netloc:
            raise ValueError("VITE_SITE_URL must be an absolute HTTP(S) URL")
    private_key = os.environ.get("TAURI_SIGNING_PRIVATE_KEY", "")
    public_key = os.environ.get("TAURI_UPDATER_PUBKEY", "").strip()
    if release and not private_key:
        raise ValueError("Release requires TAURI_SIGNING_PRIVATE_KEY secret")
    if private_key and not public_key:
        raise ValueError("Signed builds require TAURI_UPDATER_PUBKEY repository variable")
    if not private_key:
        print("::warning::TAURI_SIGNING_PRIVATE_KEY is absent; building unsigned test installers without updater artifacts.")
    config = {"version": version, "bundle": {"createUpdaterArtifacts": bool(private_key)}}
    if public_key:
        config["plugins"] = {"updater": {"pubkey": public_key}}
    root = Path(__file__).parents[1]
    (root / "src-tauri" / "ci.conf.json").write_text(json.dumps(config, indent=2), encoding="utf-8")
    environment_file = os.environ.get("GITHUB_ENV")
    if environment_file:
        with Path(environment_file).open("a", encoding="utf-8") as environment:
            environment.write(f"VITE_API_BASE_URL={origin}\n")


if __name__ == "__main__":
    main()

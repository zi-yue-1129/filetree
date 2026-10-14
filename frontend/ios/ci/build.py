"""Build, inspect and publish an unsigned FileNexus iOS archive on macOS CI."""

from __future__ import annotations

import argparse
import datetime
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import zipfile

FRONTEND: Path = Path(__file__).resolve().parents[2]
OUTPUT: Path = Path(os.environ.get("RUNNER_TEMP", "/tmp")) / "filenexus-ios"


def run(arguments: list[str], *, cwd: Path = FRONTEND, seconds: int = 120) -> None:
    """Run a checked subprocess with a finite wall-clock limit.

    Args:
        arguments: Executable and arguments, without shell interpolation.
        cwd: Working directory for the process.
        seconds: Maximum execution duration.
    """
    subprocess.run(arguments, cwd=cwd, check=True, timeout=seconds)


def resolve_version() -> tuple[str, int]:
    """Validate the supplied semantic version and derive an integer build number.

    Returns:
        Version string and build number.

    Raises:
        ValueError: A version cannot be represented by the shared version rule.
    """
    version: str = os.environ.get("RELEASE_VERSION") or "0.0.1"
    if re.fullmatch(r"(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)", version) is None:
        raise ValueError("Version must be X.Y.Z")
    major, minor, patch = map(int, version.split("."))
    if minor >= 100 or patch >= 100:
        raise ValueError("Minor and patch versions must be below 100")
    build_number: int = major * 10000 + minor * 100 + patch
    return version, max(1, build_number)


def test_protocol() -> None:
    """Compile production TUS parsing code with executable contract checks."""
    OUTPUT.mkdir(parents=True, exist_ok=True)
    executable: Path = OUTPUT / "protocol-checks"
    run(["xcrun", "swiftc", "-parse-as-library", str(FRONTEND / "native-plugin/ios/Sources/FileNexusNativePlugin/TUSProtocol.swift"),
         str(FRONTEND / "ios/ProtocolTests/main.swift"), "-o", str(executable)])
    run([str(executable)])


def build() -> None:
    """Sync Capacitor, verify Capgo manual-mode configuration and archive both targets."""
    version, build_number = resolve_version()
    server: str = os.environ["VITE_API_BASE_URL"]
    if not server.startswith("https://"):
        raise ValueError("Repository variable VITE_API_BASE_URL must be an HTTPS origin")
    if not os.environ.get("VITE_SITE_URL", "").startswith("https://"):
        raise ValueError("Repository variable VITE_SITE_URL (public web origin for share links) must be an HTTPS URL")
    run(["npm", "ci"], seconds=600)
    run(["npm", "run", "build"], seconds=600)
    run(["npx", "--no-install", "cap", "sync", "ios"], seconds=300)
    configuration: dict = json.loads((FRONTEND / "ios/App/App/capacitor.config.json").read_text())
    updater: dict = configuration["plugins"]["CapacitorUpdater"]
    if updater["autoUpdate"] is not False or updater["appReadyTimeout"] != 10000:
        raise ValueError("Capgo must use manual updates and the contract rollback timeout")
    package: str = (FRONTEND / "ios/App/CapApp-SPM/Package.swift").read_text()
    if "CapgoCapacitorUpdater" not in package or "FilenexusNative" not in package:
        raise ValueError("Capgo and the native plugin must be linked by SPM")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    test_protocol()
    run(["xcodebuild", "-project", "ios/App/App.xcodeproj", "-scheme", "App", "-configuration", "Release",
         "-destination", "generic/platform=iOS", "-archivePath", str(OUTPUT / "App.xcarchive"),
         "-derivedDataPath", str(OUTPUT / "DerivedData"), "archive", "CODE_SIGNING_ALLOWED=NO",
         "CODE_SIGNING_REQUIRED=NO", "CODE_SIGN_IDENTITY=", f"MARKETING_VERSION={version}",
         f"CURRENT_PROJECT_VERSION={build_number}", f"FILENEXUS_SERVER_URL={server}"], seconds=2100)


def test_uploads() -> None:
    """Run production URLSession queue regressions on an available iPhone simulator."""
    listed = subprocess.run(["xcrun", "simctl", "list", "devices", "available", "--json"],
                            capture_output=True, text=True, check=True, timeout=30)
    devices: dict = json.loads(listed.stdout)["devices"]
    candidates: list[dict] = [device for runtime, entries in sorted(devices.items(), reverse=True)
                              if "iOS" in runtime for device in entries
                              if device["isAvailable"] and device["name"].startswith("iPhone")]
    if not candidates:
        raise ValueError("An available iPhone simulator is required for upload state-machine tests")
    run(["xcodebuild", "-project", "ios/App/App.xcodeproj", "-scheme", "UploadTests", "-configuration", "Debug",
         "-destination", f"platform=iOS Simulator,id={candidates[0]['udid']}", "-parallel-testing-enabled", "NO",
         "-derivedDataPath", str(OUTPUT / "TestDerivedData"), "-resultBundlePath", str(OUTPUT / "UploadTests.xcresult"),
         "test", "CODE_SIGNING_ALLOWED=NO", "CODE_SIGNING_REQUIRED=NO", "CODE_SIGN_IDENTITY="], seconds=900)


def package() -> None:
    """Package and inspect both executable bundles before emitting a SideStore source."""
    version, build_number = resolve_version()
    source: Path = OUTPUT / "App.xcarchive/Products/Applications/App.app"
    payload: Path = OUTPUT / "Payload"
    if payload.exists():
        shutil.rmtree(payload)
    payload.mkdir(parents=True)
    shutil.copytree(source, payload / "App.app", symlinks=True)
    app: Path = payload / "App.app"
    extension: Path = app / "PlugIns/ShareExtension.appex"
    checks: list[dict] = []
    for bundle, identifier in [(app, "cc.spkuan.filenexus"), (extension, "cc.spkuan.filenexus.share")]:
        with (bundle / "Info.plist").open("rb") as stream:
            info: dict = plistlib.load(stream)
        if info["CFBundleIdentifier"] != identifier or info["CFBundleShortVersionString"] != version:
            raise ValueError(f"Incorrect identity/version in {bundle}")
        if str(info["CFBundleVersion"]) != str(build_number):
            raise ValueError(f"Incorrect build number in {bundle}")
        executable: Path = bundle / info["CFBundleExecutable"]
        if not executable.is_file():
            raise ValueError(f"Missing executable: {executable}")
        run(["xcrun", "lipo", str(executable), "-verify_arch", "arm64"])
        # Unsigned means no provisioning profile and no embedded code signature.
        signature = subprocess.run(["codesign", "-dv", str(bundle)], capture_output=True, timeout=30)
        if signature.returncode == 0:
            raise ValueError(f"Unexpected code signature in unsigned {bundle}")
        if (bundle / "embedded.mobileprovision").exists():
            raise ValueError(f"Unexpected provisioning profile in {bundle}")
        checks.append({"path": str(bundle.relative_to(OUTPUT)), "bundleIdentifier": identifier,
                       "executable": info["CFBundleExecutable"], "version": version, "buildNumber": build_number})
    ipa: Path = OUTPUT / f"FileNexus-{version}-unsigned.ipa"
    run(["/usr/bin/ditto", "-c", "-k", "--keepParent", "Payload", ipa.name], cwd=OUTPUT)
    with zipfile.ZipFile(ipa) as archive:
        for check in checks:
            if f'{check["path"]}/{check["executable"]}' not in archive.namelist():
                raise ValueError("IPA is missing a verified executable")
    report: dict = {"ipa": ipa.name, "size": ipa.stat().st_size, "unsigned": True, "bundles": checks}
    (OUTPUT / "ipa-contents.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    repository: str = os.environ["GITHUB_REPOSITORY"]
    release_url: str = f"https://github.com/{repository}/releases/download/v{version}/{ipa.name}"
    source_json: dict = {
        "name": "FileNexus", "identifier": "cc.spkuan.filenexus.source",
        "apps": [{"name": "FileNexus", "bundleIdentifier": "cc.spkuan.filenexus", "developerName": "FileNexus",
                  "localizedDescription": "私人檔案管理、背景上傳與相簿備份。使用免費 Apple ID 經 SideStore 簽署。",
                  "iconURL": f"https://raw.githubusercontent.com/{repository}/{os.environ['GITHUB_SHA']}/frontend/resources/icon.png",
                  "versions": [{"version": version, "date": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                                "downloadURL": release_url, "size": ipa.stat().st_size, "minOSVersion": "15.0"}]}]
    }
    (OUTPUT / "sidestore-source.json").write_text(json.dumps(source_json, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, indent=2))


def release() -> None:
    """Upload only into the already-created draft release in reusable release mode."""
    if os.environ.get("GITHUB_EVENT_NAME") != "workflow_call" and not os.environ.get("RELEASE_VERSION"):
        raise ValueError("Only the reusable release workflow may publish assets")
    version, _ = resolve_version()
    repository: str = os.environ["GITHUB_REPOSITORY"]
    existing = subprocess.run(["gh", "release", "view", f"v{version}", "--repo", repository,
                               "--json", "isDraft"], capture_output=True, text=True, check=True, timeout=30)
    if not json.loads(existing.stdout)["isDraft"]:
        raise ValueError("The target release must already exist as a draft")
    run(["gh", "release", "upload", f"v{version}", "--repo", repository, "--clobber",
         str(OUTPUT / f"FileNexus-{version}-unsigned.ipa"), str(OUTPUT / "sidestore-source.json")], seconds=180)


def main() -> None:
    """Dispatch a single bounded CI phase from the command line."""
    parser: argparse.ArgumentParser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=["build", "package", "release", "test", "test-uploads"])
    phase: str = parser.parse_args().phase
    {"build": build, "package": package, "release": release, "test": test_protocol, "test-uploads": test_uploads}[phase]()


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Map local web env values into iOS Debug config without printing secrets."""

from __future__ import annotations

import os
import plistlib
from pathlib import Path

IOS_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = IOS_ROOT.parent.parent
ENV_FILE = REPO_ROOT / ".env.local"
LOCAL_XCCONFIG = IOS_ROOT / "Config" / "Local.xcconfig"

WEB_URL = "NEXT_PUBLIC_SUPABASE_URL"
WEB_ANON = "NEXT_PUBLIC_SUPABASE_ANON_KEY"
IOS_URL = "ZOHOR_SUPABASE_URL"
IOS_ANON = "ZOHOR_SUPABASE_ANON_KEY"
IOS_BFF = "ZOHOR_BFF_BASE_URL"
LOCAL_BFF = "http://127.0.0.1:3002"


def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def xcconfig_escape(value: str) -> str:
    return value.replace("//", "/$()/")


def write_xcconfig(url: str, anon: str, bff: str) -> None:
    LOCAL_XCCONFIG.parent.mkdir(parents=True, exist_ok=True)
    LOCAL_XCCONFIG.write_text(
        "// Generated from .env.local. Do not commit.\n"
        f"{IOS_URL} = {xcconfig_escape(url)}\n"
        f"{IOS_ANON} = {xcconfig_escape(anon)}\n"
        f"{IOS_BFF} = {xcconfig_escape(bff)}\n",
        encoding="utf-8",
    )


def inject_plist(url: str, anon: str, bff: str) -> None:
    build_dir = os.environ.get("TARGET_BUILD_DIR")
    plist_path = os.environ.get("INFOPLIST_PATH")
    if not build_dir or not plist_path:
        return
    plist = Path(build_dir) / plist_path
    if not plist.exists():
        return
    with plist.open("rb") as handle:
        data = plistlib.load(handle)
    data[IOS_URL] = url
    data[IOS_ANON] = anon
    data[IOS_BFF] = bff
    with plist.open("wb") as handle:
        plistlib.dump(data, handle, fmt=plistlib.FMT_BINARY)


def main() -> None:
    if not ENV_FILE.exists():
        raise SystemExit("missing local env file")
    values = parse_env(ENV_FILE)
    url = values.get(WEB_URL, "").strip()
    anon = values.get(WEB_ANON, "").strip()
    if not url or not anon:
        raise SystemExit("local env is missing required web Supabase keys")
    if not url.startswith("http"):
        raise SystemExit("local Supabase URL is not an http URL")
    bff = values.get(IOS_BFF, "").strip() or LOCAL_BFF
    write_xcconfig(url, anon, bff)
    inject_plist(url, anon, bff)
    print("synced local iOS Supabase config")
    print(f"url_present={True} url_len={len(url)}")
    print(f"anon_present={True} anon_len={len(anon)}")
    print(f"bff_present={True} bff_len={len(bff)}")


if __name__ == "__main__":
    main()

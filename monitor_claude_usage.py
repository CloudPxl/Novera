#!/usr/bin/env python3
"""
Claude 72-Hour Quota Reset Monitor (macOS Keychain Aware)
Polls /api/oauth/usage to track rolling token utilization and detect the 72-hour reset cycle.
"""

import os
import sys
import json
import time
import logging
import subprocess
from pathlib import Path
from datetime import datetime, timezone, timedelta
import urllib.request
import urllib.error

# --- Configuration ---
POLL_INTERVAL_SECONDS = 300       # 5 minutes
RESET_CYCLE_HOURS = 72.0          # The 72h hard reset cycle
UTILIZATION_DROP_THRESHOLD = 20.0 # Drop >= 20% indicates a quota reset
STATE_FILE = Path("claude_usage_state.json")
CREDENTIALS_FILE = Path.home() / ".claude" / ".credentials.json"

API_URLS = [
    "https://api.anthropic.com/api/oauth/usage",
    "https://claude.ai/api/oauth/usage"
]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)

def extract_token_from_raw(raw: str) -> str:
    """Parses raw text which might be a JSON blob or raw token string."""
    raw = raw.strip()
    if raw.startswith("{"):
        try:
            data = json.loads(raw)
            return (
                data.get("accessToken")
                or data.get("claudeAiOauth", {}).get("accessToken")
                or ""
            )
        except Exception:
            pass
    return raw

def get_oauth_token() -> str:
    """Retrieves token from ENV, macOS Keychain, or credentials file."""
    # 1. Check environment variables
    env_token = os.getenv("CLAUDE_CODE_OAUTH_TOKEN") or os.getenv("CLAUDE_OAUTH_TOKEN")
    if env_token:
        token = extract_token_from_raw(env_token)
        if token:
            return token

    # 2. Check macOS Keychain (standard location on macOS for Claude Code)
    if sys.platform == "darwin":
        for service_name in ["Claude Code-credentials", "Claude Code", "claude-code"]:
            try:
                cmd = ["security", "find-generic-password", "-s", service_name, "-w"]
                output = subprocess.check_output(cmd, stderr=subprocess.DEVNULL).decode("utf-8").strip()
                token = extract_token_from_raw(output)
                if token:
                    return token
            except Exception:
                continue

    # 3. Check credentials file
    if CREDENTIALS_FILE.exists():
        try:
            with open(CREDENTIALS_FILE, "r", encoding="utf-8") as f:
                creds = json.load(f)
                token = (
                    creds.get("claudeAiOauth", {}).get("accessToken")
                    or creds.get("accessToken")
                )
                if token:
                    return token.strip()
        except Exception as e:
            logging.warning(f"Could not read {CREDENTIALS_FILE}: {e}")

    raise RuntimeError(
        "Could not automatically locate your Claude OAuth token in macOS Keychain, "
        "~/.claude/.credentials.json, or environment variables."
    )

def fetch_usage(token: str) -> dict:
    headers = {
        "Authorization": f"Bearer {token}",
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "claude-code/2.1.287",
        "Content-Type": "application/json",
        "Accept": "application/json"
    }

    last_error = None
    for url in API_URLS:
        req = urllib.request.Request(url, headers=headers, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                if resp.status == 200:
                    return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            last_error = e
            if e.code == 429:
                logging.warning(f"Rate limited (429) on {url}. Backing off.")
                break
        except Exception as e:
            last_error = e
            continue

    raise RuntimeError(f"Failed to fetch usage: {last_error}")

def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"last_utilization": None, "last_reset_utc": None, "resets": []}

def save_state(state: dict):
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)

def project_next_reset(last_reset_iso: str) -> datetime:
    last_reset = datetime.fromisoformat(last_reset_iso)
    now = datetime.now(timezone.utc)
    next_reset = last_reset + timedelta(hours=RESET_CYCLE_HOURS)
    while next_reset < now:
        next_reset += timedelta(hours=RESET_CYCLE_HOURS)
    return next_reset

def monitor_loop():
    token = get_oauth_token()
    state = load_state()
    logging.info("Starting Claude 72-hour usage reset monitor...")

    while True:
        try:
            data = fetch_usage(token)
            seven_day = data.get("seven_day", {})
            five_hour = data.get("five_hour", {})

            current_util = seven_day.get("utilization", 0.0)
            now_utc = datetime.now(timezone.utc)
            now_iso = now_utc.isoformat()

            prev_util = state.get("last_utilization")
            logging.info(
                f"Utilization -> 7-Day: {current_util:.1f}% | 5-Hour: {five_hour.get('utilization', 0.0):.1f}%"
            )

            if prev_util is not None and (prev_util - current_util) >= UTILIZATION_DROP_THRESHOLD:
                drop = prev_util - current_util
                logging.info(
                    f"🔔 RESET DETECTED! Utilization dropped by {drop:.1f}% "
                    f"({prev_util:.1f}% -> {current_util:.1f}%)"
                )

                if state["last_reset_utc"]:
                    prev_reset_dt = datetime.fromisoformat(state["last_reset_utc"])
                    gap_hours = (now_utc - prev_reset_dt).total_seconds() / 3600.0
                    logging.info(f"Interval since previous reset: {gap_hours:.2f} hours")

                state["last_reset_utc"] = now_iso
                state["resets"].append({
                    "timestamp": now_iso,
                    "previous_utilization": prev_util,
                    "new_utilization": current_util,
                    "drop": drop
                })

            state["last_utilization"] = current_util

            if state["last_reset_utc"]:
                next_proj = project_next_reset(state["last_reset_utc"])
                time_left = next_proj - now_utc
                hours_left = time_left.total_seconds() / 3600.0
                logging.info(
                    f"Projected next 72h reset: {next_proj.strftime('%Y-%m-%d %H:%M:%S UTC')} "
                    f"(in ~{hours_left:.1f}h)"
                )
            else:
                logging.info("Baseline established. Awaiting first drop to anchor the 72h cycle.")

            save_state(state)
            time.sleep(POLL_INTERVAL_SECONDS)

        except urllib.error.HTTPError as e:
            if e.code == 429:
                logging.warning("HTTP 429: Rate limited. Sleeping 10 minutes...")
                time.sleep(600)
            elif e.code == 401:
                logging.error("HTTP 401: Token expired or invalid. Attempting re-read...")
                try:
                    token = get_oauth_token()
                except Exception as err:
                    logging.critical(f"Auth failed: {err}")
                    time.sleep(60)
            else:
                logging.error(f"HTTP Error {e.code}: {e.reason}")
                time.sleep(60)
        except Exception as e:
            logging.error(f"Polling error: {e}")
            time.sleep(60)

if __name__ == "__main__":
    monitor_loop()

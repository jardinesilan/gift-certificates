#!/usr/bin/env python3
"""Sync newly issued gift certificates from the public GC app into Owner Tools.

Polls the public app's sync API (GET /api/v1/certificates?since=<ISO8601>,
Bearer SYNC_TOKEN) and upserts new certificates into the Owner Tools
certificates table. Idempotent: the code column has a UNIQUE index and the
insert uses OR IGNORE, so overlapping `since` windows are safe.

The sync token is read from TOKEN_FILE (written once via the secure vault
flow; never pasted in chat, never committed). The last-seen watermark lives in
STATE_FILE so each run only fetches what's new.

Usage:
    python3 sync-owner-tools.py            # normal run (needs token file)
    python3 sync-owner-tools.py --dry-run # fetch + parse, no DB writes
    GC_APP_URL=http://localhost:9999 python3 sync-owner-tools.py  # testing
"""

import json
import os
import sqlite3
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

APP_URL = os.environ.get("GC_APP_URL", "https://gift-certificates-production.up.railway.app").rstrip("/")
TOKEN_FILE = os.environ.get("SYNC_TOKEN_FILE", os.path.expanduser("~/workspace/gc-public-app/.sync-token"))
STATE_FILE = os.environ.get("SYNC_STATE_FILE", os.path.expanduser("~/workspace/gc-public-app/.sync-state"))
OWNER_DB = os.environ.get("OWNER_TOOLS_DB", os.path.expanduser("~/workspace/ts-spaces/owner-tools/app.db"))
OVERLAP = timedelta(minutes=5)


def load_token():
    try:
        with open(TOKEN_FILE) as f:
            token = f.read().strip()
    except FileNotFoundError:
        print(f"SYNC token file not found: {TOKEN_FILE}", file=sys.stderr)
        print("Ask Ela to paste the SYNC_TOKEN (Railway -> Gift Certificates service -> Variables) via the secure form.", file=sys.stderr)
        sys.exit(2)
    if not token:
        print("SYNC token file is empty.", file=sys.stderr)
        sys.exit(2)
    return token


def load_state():
    try:
        with open(STATE_FILE) as f:
            return datetime.fromisoformat(f.read().strip().replace("Z", "+00:00"))
    except (FileNotFoundError, ValueError):
        # First run: pull everything the public app has ever issued.
        return datetime(1970, 1, 1, tzinfo=timezone.utc)


def save_state(dt):
    with open(STATE_FILE, "w") as f:
        f.write(dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"))


def iso_to_ms(iso):
    return int(datetime.fromisoformat(str(iso).replace("Z", "+00:00")).timestamp() * 1000)


def fetch_certs(token, since):
    since_q = (since - OVERLAP).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    url = f"{APP_URL}/api/v1/certificates?since={since_q}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.load(resp)
    except urllib.error.HTTPError as e:
        print(f"Sync API returned HTTP {e.code}: {e.read().decode()[:200]}", file=sys.stderr)
        sys.exit(3)
    return body.get("certificates", [])


def upsert_certs(certs, dry_run=False):
    now_ms = int(time.time() * 1000)
    inserted = 0
    newest = None
    conn = sqlite3.connect(OWNER_DB)
    try:
        for c in certs:
            code = c["code"]
            amount = int(c.get("amount_cents") or 0)
            tip = int(c.get("tip_cents") or 0)
            sale_no = c.get("sale_number")
            payment_ref = c.get("payment_ref") or c.get("checkout_reference") or ""
            ref = f"GC invoice #{sale_no} · {payment_ref}".strip(" ·") if sale_no else payment_ref
            issued_ms = iso_to_ms(c["issued_at"])
            if dry_run:
                inserted += 1
                continue
            cur = conn.execute(
                """INSERT OR IGNORE INTO certificates
                   (code, original_amount_cents, remaining_amount_cents,
                    recipient_name, recipient_email, buyer_name, buyer_email,
                    purchase_reference, source_app, status, issued_at,
                    created_at, updated_at, tip_amount_cents, payment_method)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'gc-public-app', 'active', ?, ?, ?, ?, ?)""",
                (code, amount, amount,
                 c.get("recipient_name") or "", c.get("recipient_email"),
                 c.get("buyer_name") or "", c.get("buyer_email"),
                 ref, issued_ms, now_ms, now_ms, tip,
                 c.get("payment_method") or "card"),
            )
            inserted += cur.rowcount
            if newest is None or issued_ms > newest:
                newest = issued_ms
        if not dry_run:
            conn.commit()
    finally:
        conn.close()
    return inserted, newest


def main():
    dry_run = "--dry-run" in sys.argv
    token = load_token()
    state = load_state()
    certs = fetch_certs(token, state)
    inserted, newest = upsert_certs(certs, dry_run=dry_run)
    if not dry_run:
        new_state = max(state, datetime.fromtimestamp(newest / 1000, tz=timezone.utc)) if newest else state
        save_state(new_state)
    print(json.dumps({"fetched": len(certs), "inserted": inserted, "dry_run": dry_run}))


if __name__ == "__main__":
    main()

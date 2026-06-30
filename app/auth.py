import os
import hmac
import hashlib
import base64
import json
import time
import re
from fastapi import Request

COOKIE_NAME = "admin_session"
TTL_MS = 24 * 60 * 60 * 1000  # 24h in milliseconds


def _sign(data: str) -> str:
    """Sign data using HMAC-SHA256 with timing-safe comparison."""
    secret = os.environ.get("ADMIN_SECRET")
    if not secret:
        raise ValueError("ADMIN_SECRET is not set")
    return base64.urlsafe_b64encode(
        hmac.new(secret.encode(), data.encode(), hashlib.sha256).digest()
    ).rstrip(b"=").decode()


def create_session_token(address: str) -> str:
    """Create a session token for the given address."""
    payload = json.dumps({"address": address, "exp": int(time.time() * 1000) + TTL_MS})
    data = base64.urlsafe_b64encode(payload.encode()).rstrip(b"=").decode()
    sig = _sign(data)
    return f"{data}.{sig}"


def verify_session_cookie(cookie_header: str | None) -> str | None:
    """Verify a session cookie and return the address if valid, None otherwise."""
    if not cookie_header:
        return None

    # Extract the cookie value using regex
    match = re.search(rf"{COOKIE_NAME}=([^\s;]+)", cookie_header)
    if not match:
        return None

    token = match.group(1)

    # Split token into data and signature
    dot = token.rfind(".")
    if dot == -1:
        return None

    data, sig = token[:dot], token[dot + 1:]

    # Verify signature using timing-safe comparison
    try:
        expected = _sign(data)
        if not hmac.compare_digest(sig, expected):
            return None
    except Exception:
        return None

    # Verify expiration and extract address
    try:
        # Add padding back for base64 decoding (remove up to 2 = signs)
        padding = (4 - len(data) % 4) % 4
        padded_data = data + "=" * padding
        payload = json.loads(base64.urlsafe_b64decode(padded_data))

        if int(time.time() * 1000) > payload["exp"]:
            return None

        return payload["address"]
    except Exception:
        return None


def get_session_address(request: Request) -> str | None:
    """Extract and verify session address from request headers."""
    return verify_session_cookie(request.headers.get("cookie"))

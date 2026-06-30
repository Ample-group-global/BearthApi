import os
from fastapi import APIRouter, Request, HTTPException, Response
from app.auth import create_session_token, verify_session_cookie

router = APIRouter(prefix="/api/auth", tags=["auth"])

ADMIN_ADDRESS = os.environ.get("ADMIN_ADDRESS", "").lower()
COOKIE_MAX_AGE = 86400


@router.post("/session")
async def create_session(request: Request, response: Response):
    """Create admin session cookie."""
    body = await request.json()
    address = body.get("address", "").lower()

    if not address:
        raise HTTPException(status_code=400, detail="Address is required")

    if address != ADMIN_ADDRESS:
        raise HTTPException(status_code=403, detail="Only admin address can create session")

    token = create_session_token(address)
    response.set_cookie(
        key="admin_session",
        value=token,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        secure=True,
        samesite="none",
        path="/",
    )

    return {"message": "Session created", "address": address}


@router.get("/verify")
async def verify_auth(request: Request):
    """Verify current session."""
    address = verify_session_cookie(request.headers.get("cookie"))
    return {
        "address": address,
        "authenticated": address is not None
    }


@router.delete("/session")
async def delete_session(request: Request, response: Response):
    """Logout (clear session cookie)."""
    response.delete_cookie(
        key="admin_session",
        path="/",
        secure=True,
        samesite="none",
    )
    return {"message": "Session cleared"}

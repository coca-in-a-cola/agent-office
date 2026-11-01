"""Agent Office – Hermes Dashboard Plugin API.

Mounted by Hermes Dashboard at /api/dashboard/plugins/agent-office/...
Provides SSO identity and office state proxy for the embedded SPA.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/auth/me")
async def auth_me():
    """Return the hard-coded owner identity (SSO: no secondary login)."""
    return {
        "user": {
            "id": "dmitry",
            "role": "owner",
            "name": "Dmitry Dronov",
        }
    }


@router.get("/state")
async def office_state():
    """Return current office state summary."""
    return {
        "status": "operational",
        "plugin": "agent-office",
        "version": "1.0.0",
    }

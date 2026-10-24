"""Office's synchronous routing SDK adapter; no Hermes runtime dependency.

Only an employee binding selects policy. Role is not routing authority and is
left to the host's separate role-profile handling. The host must authorize route
destinations and resolve credentials; this adapter never supplies either.
"""
from __future__ import annotations

from typing import Any, Callable

from .native_policy import resolve_native_delegation_policy


class OfficeRouteResolutionError(ValueError):
    """A selected Office policy could not be resolved safely."""


def make_office_route_resolver(storage: Any) -> Callable[[Any], dict[str, Any] | None]:
    """Bind Office storage to the minimal, duck-typed Hermes routing request.

    No binding is explicitly inactive. A selected but missing/invalid policy
    denies instead of falling back to host defaults. Errors omit policy values,
    storage details and underlying exception text; no request is logged.
    """
    def resolve(request: Any) -> dict[str, Any] | None:
        try:
            employee_id = getattr(request, "employee_id", None)
            if employee_id is None:
                return None
            policy = resolve_native_delegation_policy(storage, employee_id)
            route = policy["selected_route"]
            return {
                "provider": route["provider"],
                "model": route["model"],
                "fallback_providers": [
                    {"provider": item["provider"], "model": item["model"]}
                    for item in route["fallback_providers"]
                ],
                "employee_id": policy["agent_id"],
                "policy_revision": policy["revision"],
            }
        except Exception:
            raise OfficeRouteResolutionError("Office delegation policy unavailable or invalid.") from None

    return resolve

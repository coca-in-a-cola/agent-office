"""Native delegation policy adapter for Agent Office.

Resolves native Hermes delegation policies from storage-backed agent configurations.
Follows established contract:
- Only standard library imports (no top-level Hermes imports).
- Priority routing strategy support only (round_robin explicitly unsupported).
- Primary route with fallback_providers chain.
- No secrets in routes or credentials.
"""

from typing import Any, Dict, List, Set


class NativePolicyError(ValueError):
    """Base error for native policy resolution failures."""
    pass


class AgentNotFoundError(NativePolicyError):
    """Raised when the specified agent is not found in storage."""
    pass


class EmptyPolicyError(NativePolicyError):
    """Raised when agent policy models configuration is empty or missing."""
    pass


class InvalidPolicyError(NativePolicyError):
    """Raised when agent policy configuration fails validation."""
    pass


class UnsupportedRoutingStrategyError(NativePolicyError):
    """Raised when an unsupported routing strategy (such as round_robin) is requested."""
    pass


# Disallowed demo and placeholder identifiers
_DISALLOWED_PLACEHOLDERS: Set[str] = {
    "demo",
    "placeholder",
    "dummy",
    "test",
    "example",
    "unknown",
    "none",
    "null",
    "undefined",
    "mock",
    "fake",
    "sample",
    "todo",
    "temp",
    "temporary",
    "your-model-here",
    "your-provider-here",
    "replace-me",
    "change-me",
}

_DISALLOWED_PREFIXES = (
    "demo-",
    "demo_",
    "placeholder-",
    "placeholder_",
    "dummy-",
    "dummy_",
    "test-",
    "test_",
)

_ALLOWED_MODEL_KEYS: Set[str] = {"provider", "model", "priority"}


def _validate_identifier(value: Any, field_name: str) -> str:
    """Validate string identifier bounds and reject empty, control, or whitespace-corrupted values.
    
    Preserves exact value without normalization.
    """
    if not isinstance(value, str):
        raise InvalidPolicyError(f"{field_name} must be a string, got {type(value).__name__}")
    if not value or not value.strip():
        raise InvalidPolicyError(f"{field_name} cannot be empty or whitespace-only")
    if value != value.strip():
        raise InvalidPolicyError(f"{field_name} must not contain leading or trailing whitespace: {value!r}")
    if len(value) > 128:
        raise InvalidPolicyError(f"{field_name} exceeds maximum length of 128 characters: {value!r}")
    if any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise InvalidPolicyError(f"{field_name} contains invalid control characters: {value!r}")
    return value


def _check_not_placeholder(value: str, field_name: str) -> None:
    """Reject demo or placeholder values while permitting arbitrary valid provider/model IDs."""
    val_lower = value.strip().lower()
    if val_lower in _DISALLOWED_PLACEHOLDERS:
        raise InvalidPolicyError(f"{field_name} cannot use placeholder/demo value: {value!r}")
    if (val_lower.startswith("<") and val_lower.endswith(">")) or \
       (val_lower.startswith("[") and val_lower.endswith("]")) or \
       (val_lower.startswith("{") and val_lower.endswith("}")):
        raise InvalidPolicyError(f"{field_name} contains placeholder pattern: {value!r}")
    for prefix in _DISALLOWED_PREFIXES:
        if val_lower.startswith(prefix) and len(val_lower) > len(prefix):
            raise InvalidPolicyError(f"{field_name} contains disallowed prefix {prefix!r}: {value!r}")


def resolve_native_delegation_policy(storage: Any, agent_id: str) -> Dict[str, Any]:
    """Resolve native delegation policy for an agent.

    Args:
        storage: Storage instance exposing get_agent(agent_id).
        agent_id: Identifier of the agent to resolve.

    Returns:
        Dict containing:
            - agent_id: Exact agent ID string.
            - role: Agent role string.
            - revision: Policy revision integer (>= 1).
            - selected_route: Dict with primary provider, model, and fallback_providers list.
            - credentials_cfg: Credentials configuration dict (never includes tokens).

    Raises:
        AgentNotFoundError: Agent is missing from storage.
        EmptyPolicyError: Agent models configuration is empty.
        UnsupportedRoutingStrategyError: Strategy is round_robin or unsupported.
        InvalidPolicyError: Configuration is malformed, has invalid strings, duplicates, or secrets.
        ValueError: On any contract violation.
    """
    valid_agent_id = _validate_identifier(agent_id, "agent_id")
    if any(c.isspace() for c in valid_agent_id):
        raise InvalidPolicyError(f"agent_id cannot contain internal whitespace: {valid_agent_id!r}")
    _check_not_placeholder(valid_agent_id, "agent_id")

    if not hasattr(storage, "get_agent"):
        raise InvalidPolicyError("Storage must implement get_agent")

    agent = storage.get_agent(valid_agent_id)
    if agent is None:
        raise AgentNotFoundError(f"Agent {valid_agent_id!r} not found in storage")

    # Extract fields supporting dict or object storage representations
    if isinstance(agent, dict):
        models = agent.get("models")
        routing_strategy = agent.get("routing_strategy")
        policy_revision = agent.get("policy_revision")
        if policy_revision is None:
            policy_revision = agent.get("revision")
        role = agent.get("role")
        raw_creds = agent.get("credentials_cfg", agent.get("credentials", {}))
    else:
        models = getattr(agent, "models", None)
        routing_strategy = getattr(agent, "routing_strategy", None)
        policy_revision = getattr(agent, "policy_revision", getattr(agent, "revision", None))
        role = getattr(agent, "role", None)
        raw_creds = getattr(agent, "credentials_cfg", getattr(agent, "credentials", {}))

    # Validate role
    valid_role = _validate_identifier(role, "role")

    # Validate revision (integer >= 1)
    if policy_revision is None:
        raise InvalidPolicyError("Missing policy_revision in agent configuration")
    if not isinstance(policy_revision, int) or isinstance(policy_revision, bool) or policy_revision < 1:
        raise InvalidPolicyError(f"Invalid policy_revision: {policy_revision!r}. Must be integer >= 1")

    # Validate routing strategy: priority only, round_robin explicitly unsupported
    if routing_strategy == "round_robin":
        raise UnsupportedRoutingStrategyError("round_robin routing strategy is not supported yet")
    if routing_strategy != "priority":
        raise UnsupportedRoutingStrategyError(f"Unsupported routing strategy: {routing_strategy!r}")

    # Validate models list
    if models is None or not isinstance(models, list) or len(models) == 0:
        raise EmptyPolicyError(f"Agent {valid_agent_id!r} has empty or missing models configuration")

    validated_models: List[Dict[str, str]] = []
    seen_pairs: Set[tuple] = set()

    for idx, item in enumerate(models):
        if not isinstance(item, dict):
            raise InvalidPolicyError(f"Model entry at index {idx} must be a dict, got {type(item).__name__}")

        # Check for disallowed input fields or secrets in route
        extra_keys = set(item.keys()) - _ALLOWED_MODEL_KEYS
        if extra_keys:
            raise InvalidPolicyError(
                f"Disallowed fields in route model entry at index {idx}: {sorted(extra_keys)}. "
                "Only provider, model, priority are allowed; no secrets permitted in route."
            )

        if "provider" not in item or "model" not in item:
            raise InvalidPolicyError(f"Model entry at index {idx} must contain both 'provider' and 'model'")

        prov = item["provider"]
        mod = item["model"]

        valid_prov = _validate_identifier(prov, f"models[{idx}].provider")
        valid_mod = _validate_identifier(mod, f"models[{idx}].model")

        if any(c.isspace() for c in valid_prov):
            raise InvalidPolicyError(f"Provider cannot contain whitespace: {valid_prov!r}")
        if any(c.isspace() for c in valid_mod):
            raise InvalidPolicyError(f"Model cannot contain whitespace: {valid_mod!r}")

        _check_not_placeholder(valid_prov, f"models[{idx}].provider")
        _check_not_placeholder(valid_mod, f"models[{idx}].model")

        # Priority validation if present
        if "priority" in item:
            prio = item["priority"]
            if not isinstance(prio, int) or isinstance(prio, bool):
                raise InvalidPolicyError(f"Priority at index {idx} must be an integer, got {prio!r}")

        pair = (valid_prov, valid_mod)
        if pair in seen_pairs:
            raise InvalidPolicyError(f"Duplicate provider/model pair at index {idx}: {pair}")
        seen_pairs.add(pair)

        # Preserve exact string IDs without normalization
        validated_models.append({"provider": valid_prov, "model": valid_mod})

    # Construct selected_route: primary is first, remaining are fallback_providers
    primary = validated_models[0]
    fallbacks = validated_models[1:]

    selected_route: Dict[str, Any] = {
        "provider": primary["provider"],
        "model": primary["model"],
        "fallback_providers": [{"provider": fb["provider"], "model": fb["model"]} for fb in fallbacks],
    }

    # credentials_cfg never includes tokens
    if raw_creds is None:
        raw_creds = {}
    if not isinstance(raw_creds, dict):
        raise InvalidPolicyError("credentials_cfg must be a dictionary")

    credentials_cfg: Dict[str, Any] = {}
    forbidden_token_terms = ("token", "secret", "password", "api_key", "bearer", "auth_token")
    for k, v in raw_creds.items():
        k_lower = str(k).lower()
        if any(term in k_lower for term in forbidden_token_terms):
            continue
        credentials_cfg[str(k)] = v

    return {
        "agent_id": valid_agent_id,
        "role": valid_role,
        "revision": policy_revision,
        "selected_route": selected_route,
        "credentials_cfg": credentials_cfg,
    }

"""Agent Office Plugin for Hermes.

Exposes plugin registration and runtime lifecycle hooks.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Ensure workspace directory is in sys.path so 'agent_office' package is resolvable
_pkg_root = Path(__file__).resolve().parent
if str(_pkg_root) not in sys.path:
    sys.path.insert(0, str(_pkg_root))

from agent_office import register, __version__

__all__ = ["register", "__version__"]

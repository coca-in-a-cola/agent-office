"""Workflow Core: versioned, fail-closed release workflow orchestration.

Bridge remains the only execution queue; this package records workflow state
and asks Bridge to submit/cancel/reconcile tasks through an injectable port.
"""

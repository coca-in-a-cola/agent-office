"""Versioned single-host software release workflow (AO-GRAPH-02).

implementation -> independent acceptance -> build -> exact-built-artifact
check -> publication & readback -> owner delivery.

Feedback loops are bounded by NodeDefinition.max_iterations; side-effecting
nodes never retry automatically and publication waits on an approval gate.
"""

from __future__ import annotations

from .definitions import (
    DigestBinding, NodeDefinition, Outcome, Target, Transition,
    WorkflowDefinition,
)

RELEASE_WORKFLOW_NAME = "software-release"

IMPLEMENTATION = "implementation"
ACCEPTANCE = "acceptance"
BUILD = "build"
ARTIFACT_CHECK = "artifact_check"
PUBLICATION = "publication"
DELIVERY = "delivery"

RELEASE_STEPS = (IMPLEMENTATION, ACCEPTANCE, BUILD, ARTIFACT_CHECK,
                 PUBLICATION, DELIVERY)

_EXECUTORS = ("claude", "omo")
_MODELS = ("claude-opus-5-5",)


def _branches(source: str, **targets: str) -> tuple[Transition, ...]:
    """Every outcome explicit; defaults are the conservative engine targets."""
    default = {
        Outcome.SUCCESS: Target.BLOCKED.value,
        Outcome.DEFECT: Target.BLOCKED.value,
        Outcome.TIMEOUT: Target.INSPECT.value,
        Outcome.FAILURE: Target.RETRY.value,
        Outcome.CANCEL: Target.CANCELLED.value,
        Outcome.QUOTA: Target.QUOTA_WAIT.value,
        Outcome.APPROVAL_WAIT: Target.APPROVAL.value,
    }
    for key, value in targets.items():
        default[Outcome(key)] = value
    return tuple(Transition(source, outcome, target)
                 for outcome, target in default.items())


def build_release_workflow(version: int = 1) -> WorkflowDefinition:
    nodes = (
        NodeDefinition(
            name=IMPLEMENTATION, role="implementer",
            allowed_executors=_EXECUTORS, allowed_models=_MODELS,
            goal="Implement the agreed change and commit it.",
            inputs=("change_request",),
            expected_artifacts=("patch",),
            required_fields=("source_sha", "producer"),
            completion_criteria=("commits exist", "project test gate green"),
            timeout_seconds=3600, budget=(("max_subagents", 2),),
        ),
        NodeDefinition(
            name=ACCEPTANCE, role="independent_reviewer",
            allowed_executors=_EXECUTORS, allowed_models=_MODELS,
            goal="Independently verify the ordinary user path at source_sha.",
            inputs=("source_sha",),
            expected_artifacts=("acceptance_report",),
            required_fields=("source_sha", "producer"),
            completion_criteria=("user path exercised", "reviewer != implementer"),
            timeout_seconds=1800, binds_source=True,
            independent_of=(IMPLEMENTATION,),
        ),
        NodeDefinition(
            name=BUILD, role="builder",
            allowed_executors=_EXECUTORS, allowed_models=_MODELS,
            goal="Build the release artifact from source_sha.",
            inputs=("source_sha",),
            expected_artifacts=("build_artifact",),
            required_fields=("source_sha", "producer", "command", "exit_code"),
            completion_criteria=("build exit 0",),
            timeout_seconds=1800, binds_source=True,
        ),
        NodeDefinition(
            name=ARTIFACT_CHECK, role="artifact_checker",
            allowed_executors=_EXECUTORS, allowed_models=_MODELS,
            goal="Check the exact built bytes, not the source tree.",
            inputs=("build_artifact",),
            expected_artifacts=("artifact_check_report",),
            required_fields=("source_sha", "producer", "checked_digest"),
            completion_criteria=("checked digest == built digest",),
            timeout_seconds=1800, binds_source=True,
            independent_of=(BUILD,),
            digest_bindings=(DigestBinding("checked_digest", BUILD, "build_artifact"),),
        ),
        NodeDefinition(
            name=PUBLICATION, role="publisher",
            allowed_executors=_EXECUTORS, allowed_models=_MODELS,
            goal="Publish exactly the checked artifact and read it back.",
            inputs=("build_artifact", "artifact_check_report"),
            expected_artifacts=("publication_receipt",),
            required_fields=("source_sha", "producer", "destination",
                             "published_digest", "readback_digest"),
            completion_criteria=("readback digest == checked digest",),
            timeout_seconds=900, max_attempts=1, binds_source=True,
            digest_bindings=(
                DigestBinding("published_digest", BUILD, "build_artifact"),
                DigestBinding("readback_digest", BUILD, "build_artifact"),
            ),
            side_effecting=True, requires_approval=True,
            approval_scope="publish",
        ),
        NodeDefinition(
            name=DELIVERY, role="owner_liaison",
            allowed_executors=_EXECUTORS, allowed_models=_MODELS,
            goal="Deliver the published release to the owner and record ack.",
            inputs=("publication_receipt",),
            expected_artifacts=("delivery_receipt",),
            required_fields=("producer", "delivered_to", "acknowledged_by"),
            completion_criteria=("owner acknowledgement recorded",),
            timeout_seconds=900, max_attempts=1, side_effecting=True,
        ),
    )
    blocked = Target.BLOCKED.value
    transitions = (
        _branches(IMPLEMENTATION, success=ACCEPTANCE, defect=IMPLEMENTATION)
        + _branches(ACCEPTANCE, success=BUILD, defect=IMPLEMENTATION)
        + _branches(BUILD, success=ARTIFACT_CHECK, defect=IMPLEMENTATION)
        + _branches(ARTIFACT_CHECK, success=PUBLICATION, defect=BUILD)
        + _branches(PUBLICATION, success=DELIVERY, defect=blocked, failure=blocked)
        + _branches(DELIVERY, success=Target.COMPLETED.value, defect=blocked,
                    failure=blocked)
    )
    return WorkflowDefinition(name=RELEASE_WORKFLOW_NAME, version=version,
                              start=IMPLEMENTATION, nodes=nodes,
                              transitions=transitions)

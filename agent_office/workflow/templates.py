"""Workflow blueprints and graph templates for Process Studio (AO-GRAPH-03).

Provides multiple domain-tailored workflow templates with explicit node input scopes:
- 'project': node operates across the entire project (intake, release, planning).
- 'task': node operates on a decomposed atomic ticket/feature.
- 'batch': node operates on a collection of artifacts.

Every workflow template enforces a mandatory publication / release gate.
"""

from __future__ import annotations

from typing import Mapping

from .definitions import (
    DigestBinding, NodeDefinition, Outcome, Target, Transition,
    WorkflowDefinition,
)
from .release_workflow import (
    ARTIFACT_CHECK, BUILD, DELIVERY, IMPLEMENTATION, PUBLICATION,
    build_release_workflow,
)

_EXECUTORS = ("claude", "omo", "hermes")
_MODELS = (
    "claude-opus-5-5",
    "antigravity/gemini-3.8-flash-high",
    "openai-broker/gpt-6.1-sol",
)


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


def build_feature_delivery_workflow(version: int = 1) -> WorkflowDefinition:
    """Project-to-Task fan-out pipeline with mandatory publication.

    1. project_intake (Scope: project) -> analyzes scope and outputs task specs.
    2. task_prioritization (Scope: project) -> orders sub-processes.
    3. task_implementation (Scope: task) -> coder/webdev builds the feature.
    4. task_acceptance (Scope: task) -> qa independently verifies the tests.
    5. staging_review (Scope: project) -> aggregates verified task components.
    6. publish_release (Scope: project, MANDATORY) -> deploys live release.
    """
    nodes = (
        NodeDefinition(
            name="project_intake", role="owner_liaison",
            allowed_executors=_EXECUTORS, allowed_models=_MODELS,
            goal="Analyze incoming project specification and generate structured task breakdown.",
            inputs=("project_specification",),
            expected_artifacts=("task_manifest",),
            required_fields=("project_id", "producer", "task_count"),
            completion_criteria=("tasks decomposed", "architecture verified"),
            timeout_seconds=3600,
            input_scope="project",
        ),
        NodeDefinition(
            name="task_prioritization", role="owner_liaison",
            allowed_executors=_EXECUTORS, allowed_models=_MODELS,
            goal="Order decomposed tasks into an executable dependency sequence.",
            inputs=("task_manifest",),
            expected_artifacts=("prioritized_backlog",),
            required_fields=("project_id", "execution_order"),
            completion_criteria=("dependency DAG valid",),
            timeout_seconds=1800, binds_source=True,
            independent_of=("project_intake",),
            input_scope="project",
        ),
        NodeDefinition(
            name="task_implementation", role="implementer",
            allowed_executors=_EXECUTORS, allowed_models=_MODELS,
            goal="Implement the prioritized task feature and commit with atomic discipline.",
            inputs=("prioritized_backlog",),
            expected_artifacts=("task_patch",),
            required_fields=("source_sha", "producer", "task_id"),
            completion_criteria=("code committed", "unit tests pass"),
            timeout_seconds=3600,
            input_scope="task",
        ),
        NodeDefinition(
            name="task_acceptance", role="independent_reviewer",
            allowed_executors=_EXECUTORS, allowed_models=_MODELS,
            goal="Independently verify ordinary user path and edge cases at source_sha.",
            inputs=("source_sha", "task_patch"),
            expected_artifacts=("qa_acceptance_report",),
            required_fields=("source_sha", "producer", "verdict"),
            completion_criteria=("regression suites green", "reviewer != implementer"),
            timeout_seconds=1800, binds_source=True,
            independent_of=("task_implementation",),
            input_scope="task",
        ),
        NodeDefinition(
            name="staging_review", role="owner_liaison",
            allowed_executors=_EXECUTORS, allowed_models=_MODELS,
            goal="Aggregate all completed task artifacts into a unified staging build.",
            inputs=("qa_acceptance_report",),
            expected_artifacts=("staging_manifest",),
            required_fields=("project_id", "staging_sha"),
            completion_criteria=("all tasks merged", "staging health green"),
            timeout_seconds=1800, binds_source=True,
            input_scope="project",
        ),
        NodeDefinition(
            name="publish_release", role="publisher",
            allowed_executors=_EXECUTORS, allowed_models=_MODELS,
            goal="Push release branch to GitHub origin, create release tag, and publish verified artifacts to live endpoints.",
            inputs=("staging_manifest",),
            expected_artifacts=("live_deployment_receipt", "github_release_receipt"),
            required_fields=("staging_sha", "destination_url", "release_version", "github_repo"),
            completion_criteria=("git push origin verified", "github release published", "live endpoint green"),
            timeout_seconds=1800, max_attempts=1, side_effecting=True,
            requires_approval=True, approval_scope="publish",
            input_scope="project",
            is_mandatory_publication=True,
        ),
    )
    blocked = Target.BLOCKED.value
    transitions = (
        _branches("project_intake", success="task_prioritization", defect="project_intake")
        + _branches("task_prioritization", success="task_implementation", defect="project_intake")
        + _branches("task_implementation", success="task_acceptance", defect="task_implementation")
        + _branches("task_acceptance", success="staging_review", defect="task_implementation")
        + _branches("staging_review", success="publish_release", defect="task_implementation")
        + _branches("publish_release", success=Target.COMPLETED.value, defect=blocked, failure=blocked)
    )
    return WorkflowDefinition(
        name="project-feature-lifecycle",
        version=version,
        start="project_intake",
        nodes=nodes,
        transitions=transitions,
    )


def build_hotfix_workflow(version: int = 1) -> WorkflowDefinition:
    """Rapid incident triage and hotfix pipeline with mandatory deploy.

    1. incident_intake (Scope: project) -> captures bug and diagnostic telemetry.
    2. root_cause_diagnosis (Scope: task) -> locates reproduction and failing test.
    3. patch_implementation (Scope: task) -> applies minimal fix.
    4. regression_verification (Scope: task) -> proves bug is fixed and no regression.
    5. publish_hotfix (Scope: project, MANDATORY) -> deploys emergency fix.
    """
    nodes = (
        NodeDefinition(
            name="incident_intake", role="independent_reviewer",
            allowed_executors=_EXECUTORS, allowed_models=_MODELS,
            goal="Triage emergency bug report, collect logs, and assess blast radius.",
            inputs=("incident_report",),
            expected_artifacts=("triage_dossier",),
            required_fields=("incident_id", "severity", "reporter"),
            completion_criteria=("repro steps documented",),
            timeout_seconds=900,
            input_scope="project",
        ),
        NodeDefinition(
            name="root_cause_diagnosis", role="implementer",
            allowed_executors=_EXECUTORS, allowed_models=_MODELS,
            goal="Isolate defect root cause with a deterministic reproducing test.",
            inputs=("triage_dossier",),
            expected_artifacts=("failing_test_case",),
            required_fields=("incident_id", "failing_test_name"),
            completion_criteria=("reproduction test committed",),
            timeout_seconds=1800, binds_source=True,
            input_scope="task",
        ),
        NodeDefinition(
            name="patch_implementation", role="implementer",
            allowed_executors=_EXECUTORS, allowed_models=_MODELS,
            goal="Implement minimal surgical fix passing the reproduction test.",
            inputs=("failing_test_case",),
            expected_artifacts=("hotfix_patch",),
            required_fields=("source_sha", "patch_summary"),
            completion_criteria=("reproduction test passes",),
            timeout_seconds=1800, binds_source=True,
            input_scope="task",
        ),
        NodeDefinition(
            name="regression_verification", role="independent_reviewer",
            allowed_executors=_EXECUTORS, allowed_models=_MODELS,
            goal="Execute full regression suite to guarantee zero collateral breakage.",
            inputs=("hotfix_patch",),
            expected_artifacts=("hotfix_verification_report",),
            required_fields=("source_sha", "test_suite_status"),
            completion_criteria=("full test suite 100% green", "reviewer != implementer"),
            timeout_seconds=900, binds_source=True,
            independent_of=("patch_implementation",),
            input_scope="task",
        ),
        NodeDefinition(
            name="publish_hotfix", role="publisher",
            allowed_executors=_EXECUTORS, allowed_models=_MODELS,
            goal="Publish and deploy emergency hotfix directly to production.",
            inputs=("hotfix_verification_report",),
            expected_artifacts=("hotfix_deployment_receipt",),
            required_fields=("source_sha", "destination_url", "hotfix_tag"),
            completion_criteria=("hotfix active on live endpoint",),
            timeout_seconds=900, max_attempts=1, side_effecting=True,
            requires_approval=True, approval_scope="hotfix",
            input_scope="project",
            is_mandatory_publication=True,
        ),
    )
    blocked = Target.BLOCKED.value
    transitions = (
        _branches("incident_intake", success="root_cause_diagnosis", defect="incident_intake")
        + _branches("root_cause_diagnosis", success="patch_implementation", defect="incident_intake")
        + _branches("patch_implementation", success="regression_verification", defect="patch_implementation")
        + _branches("regression_verification", success="publish_hotfix", defect="patch_implementation")
        + _branches("publish_hotfix", success=Target.COMPLETED.value, defect=blocked, failure=blocked)
    )
    return WorkflowDefinition(
        name="hotfix-fast-patch",
        version=version,
        start="incident_intake",
        nodes=nodes,
        transitions=transitions,
    )


def get_all_templates() -> dict[str, WorkflowDefinition]:
    """Catalog of all supported production workflow graph templates."""
    return {
        "project-feature-lifecycle": build_feature_delivery_workflow(),
        "hotfix-fast-patch": build_hotfix_workflow(),
        "software-release": build_release_workflow(),
    }

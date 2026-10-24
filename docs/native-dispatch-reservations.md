# Durable native dispatch reservations (offline preparatory layer)

`NativeDispatchReservations(storage, store=None)` uses `DurableRouteStore` on
`storage.db_path` by default, or an explicitly supplied runtime store. It does
not register a resolver, construct children, update observed employee fields,
resolve credentials, or make provider calls. An implicit in-memory Office DB is
rejected; tests may explicitly inject an in-memory route store.

## Contract for the next host/SDK slice

1. `reserve(employee_id)` validates saved policy and returns the primary route,
   cyclic remaining `fallback_providers`, `employee_id`, `policy_revision`, and
   an opaque `reservation_token`. This is an explicit persistent write boundary,
   not the generic preview/resolver. Priority returns the unchanged first-route
   policy and a null token, without writing routing state.
2. Host verifies identity binding, depth/concurrency/capability admission, and
   approves **all** destinations in that exact candidate chain. On denial or
   cancellation call `release(token)`. Never commit during policy inspection,
   UI refresh, capability discovery or speculative validation.
3. After approval and at final spawn admission call `commit(employee_id, token)`.
   False forbids construction; obtain a new candidate and repeat approval.
   Exceptions also deny. Do not spin in the adapter or silently use defaults.
4. Only after successful admission construct the child with the approved chain.
   Keep tokens separate from credential/routing payloads and out of prompts and
   logs. The host must durably deduplicate child construction per invocation:
   repeated commit is idempotent success for reconciliation, not permission for
   another spawn. SQLite admission and child construction are not atomic across
   systems; failure after commit consumes an admitted turn and cannot be undone
   by release. Recovery must reconcile that invocation rather than blind replay.

Reservations are optimistic: multiple callers may provisionally choose A, but
only one commits that cursor position. Other callers reselect and reauthorize
B, then C. A pending/abandoned/released reservation never advances the cursor or
blocks another caller. Committed positions are monotonic (no wraparound ABA).
The key encodes employee ID, revision, strategy, role and ordered routes using
unambiguous JSON. Identical policy saves preserve position; changed revisions
start at the new chain's first route. Final commit revalidates current policy;
the host must coordinate concurrent policy edits with final admission if a
strict policy-update linearization guarantee is needed.

The existing `provider_cursors` and `route_reservations` tables are reused. The
latter receives nullable lifecycle/position/modulo columns so old reservations
remain readable. `BEGIN IMMEDIATE` covers cursor reads and writes as well as
schema upgrades across independent SQLite connections. File-backed connections
are closed after each transaction. Legacy atomic cursor advancement is also
fixed to acquire the SQLite write transaction before reading.

## Why live support remains disabled

The isolated SDK's `hermes_cli/delegation_routing.py` currently permits only
`provider`, `model`, `fallback_providers`, `employee_id`, and `policy_revision`.
It has no reservation-token field or admission commit/release callback. Its
`RouteRequest` has session/employee/role only, not a durable spawn identity.
Returning a token today would fail strict payload validation; advancing inside
the resolver would consume turns before host denial. Neither is acceptable.

The next SDK slice needs a typed reservation lifecycle owned by the selected
plugin, an immutable per-invocation ID for deduplication, unload/error cleanup,
and post-authorization admission commit/release at the child-construction
boundary. Strict payload validation should keep lifecycle state separate from
credential configuration. Tests must prove denial never calls commit, a stale
commit triggers reapproval, cancellation releases, and duplicate invocations do
not construct another child. The current registered read-only Office resolver
continues to reject round_robin, and UI warnings are intentionally unchanged.

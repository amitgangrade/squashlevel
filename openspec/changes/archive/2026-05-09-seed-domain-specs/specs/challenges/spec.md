## ADDED Requirements

### Requirement: Challenge data model

A challenge SHALL be a row in `public.challenges`:
- `id uuid` primary key (default `gen_random_uuid()`).
- `from_player_id`, `to_player_id` — non-null FKs to `players(id)`, `on delete cascade`.
- `message text` (optional), `proposed_date date` (optional), `venue text` (optional).
- `status text NOT NULL DEFAULT 'pending'` — one of `pending | accepted | declined | cancelled | expired`.
- `created_at`, `responded_at`, `created_by` — timestamps and the auth uid that issued it.

Indexes SHALL exist on `(to_player_id, status)` and `(from_player_id, status)` for cheap inbox/outbox queries.

#### Scenario: Reading my open challenges
- **WHEN** a player queries `challenges where to_player_id = me and status = 'pending'`
- **THEN** the query is index-backed and returns only open inbound challenges

---

### Requirement: Challenge state machine

A challenge SHALL transition between exactly these statuses:

```
                  ┌────────────┐
   (insert)──────► pending      │
                  └─┬────┬────┬─┘
                    │    │    │
                    ▼    ▼    ▼
              accepted declined cancelled
              (term.)  (term.)  (term.)
```

Plus a non-RPC `expired` terminal status reserved for future ageing logic. Once a challenge reaches a terminal status it MUST NOT transition back to `pending`. Idempotent re-application of the same terminal status SHALL be rejected (the RPC raises so the UI surfaces a clear "already X" error).

#### Scenario: Accepting a pending challenge
- **WHEN** the recipient calls `respond_to_challenge(id, 'accepted')` on a pending challenge
- **THEN** `status = 'accepted'`, `responded_at = now()`

#### Scenario: Responding to a non-pending challenge
- **WHEN** anyone calls `respond_to_challenge(id, ...)` on a challenge that is no longer pending
- **THEN** the RPC raises `challenge already <status>`

---

### Requirement: Issuing a challenge

The `create_challenge(to_player, msg?, proposed?, venue_name?, from_player?)` SECURITY DEFINER RPC SHALL be the only sanctioned insert path. Direct INSERTs into `challenges` MUST be blocked by RLS. Behavior:

- Requires authentication; raises `not authenticated` otherwise.
- If `from_player` is omitted, infers it from `players where user_id = auth.uid()`. If no such player exists, raises `no player linked to your account`.
- If `from_player` is supplied, the caller MUST own that player OR be a global admin (admins MAY challenge on behalf of someone else); otherwise raises `cannot challenge as someone else`.
- Refuses self-challenges (`from = to`); raises `cannot challenge yourself`.
- Refuses if `to_player` doesn't exist; raises `opponent not found`.
- Refuses if there is already a `pending` challenge between the two players in either direction; raises `a pending challenge between these players already exists`.

#### Scenario: Normal challenge issued
- **WHEN** signed-in player A calls `create_challenge(B, 'Wed 8pm?')` and no pending challenge exists between A and B
- **THEN** a row is inserted with `from_player_id = A.id`, `to_player_id = B.id`, `created_by = A.user_id`

#### Scenario: Duplicate prevention
- **WHEN** A → B is already pending and A calls `create_challenge(B, ...)` again, or B calls `create_challenge(A, ...)`
- **THEN** the RPC raises `a pending challenge between these players already exists`

#### Scenario: Admin challenges on behalf of someone
- **WHEN** a global admin supplies `from_player = X` where X is not the admin's own player
- **THEN** the RPC accepts (admin override)

#### Scenario: Non-admin spoofing from_player
- **WHEN** a regular user supplies `from_player = X` where they don't own X
- **THEN** the RPC raises `cannot challenge as someone else`

---

### Requirement: Responding to a challenge

The `respond_to_challenge(challenge_id, response)` RPC SHALL be the only sanctioned way to advance a pending challenge to `accepted`, `declined`, or `cancelled`. The RPC enforces:

- `response` MUST be one of `accepted | declined | cancelled`; otherwise raises `invalid response`.
- The challenge MUST exist and be `pending`.
- For `cancelled`: only the SENDER (or a global admin) MAY cancel; raises `only the sender can cancel` otherwise.
- For `accepted` / `declined`: only the RECIPIENT (or a global admin) MAY transition; raises `only the recipient can accept or decline` otherwise.
- A user who is neither sender nor recipient (and not admin) raises `not allowed`.

`responded_at` SHALL be stamped on every successful transition.

#### Scenario: Sender cancels a pending challenge
- **WHEN** the sender calls `respond_to_challenge(id, 'cancelled')`
- **THEN** `status = 'cancelled'`, `responded_at = now()`

#### Scenario: Recipient declines
- **WHEN** the recipient calls `respond_to_challenge(id, 'declined')`
- **THEN** `status = 'declined'`, `responded_at = now()`

#### Scenario: Sender tries to "accept" their own challenge
- **WHEN** the sender calls `respond_to_challenge(id, 'accepted')`
- **THEN** the RPC raises `only the recipient can accept or decline`

#### Scenario: Admin overrides on behalf of either party
- **WHEN** a global admin calls `respond_to_challenge(id, 'cancelled')` on someone else's challenge
- **THEN** the call succeeds

---

### Requirement: Visibility and direct-write rules

Public read on `challenges` SHALL be allowed (so a profile page MAY surface "X has Y open challenges" later). There SHALL be NO public insert policy — inserts go exclusively via `create_challenge`. The only sanctioned UPDATE path for non-admins is `respond_to_challenge`; the existing "owner cancel challenge" UPDATE policy exists as a safety net for the sender/recipient/admin trio but the canonical path is the RPC. DELETE SHALL be admin-only.

#### Scenario: Direct insert blocked
- **WHEN** any client tries `INSERT INTO challenges (...)` directly
- **THEN** RLS rejects the insert (no insert policy is defined)

#### Scenario: Anonymous user reads public challenge list
- **WHEN** an unauthenticated request selects from `challenges`
- **THEN** rows are returned (visibility is public)

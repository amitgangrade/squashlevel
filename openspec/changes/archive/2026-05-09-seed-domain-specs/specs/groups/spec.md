## ADDED Requirements

### Requirement: Group data model

A group SHALL be a row in `public.groups`:
- `id uuid` primary key (default `gen_random_uuid()`).
- `name text NOT NULL`.
- `slug text` — generated stored column equal to `public.club_slug(name)`, with a unique index.
- `description text` (optional).
- `is_private boolean NOT NULL DEFAULT false`.
- `created_by uuid` references `auth.users(id) on delete set null`.
- `created_at timestamptz NOT NULL DEFAULT now()`.

Membership SHALL live in `public.group_members (group_id, player_id, is_admin, added_by, added_at)` with `(group_id, player_id)` as primary key. A player MAY belong to many groups; a group MAY have many admins.

Slug uniqueness is enforced at the schema level — two groups MUST NOT share a slug.

#### Scenario: Two groups with names that slugify equally
- **WHEN** a user tries to create a group named `Friday Night` and another named `friday   night`
- **THEN** the second creation fails with a unique-constraint violation on the slug

---

### Requirement: Anyone can create a group; creator becomes admin

The `create_group(p_name, p_description?, p_is_private?)` RPC SHALL allow any signed-in user with a linked player to create a group. The RPC:

- Requires authentication; raises `not authenticated` otherwise.
- Requires a non-empty trimmed name; raises `group name required` otherwise.
- Requires the caller to own a player row; raises `no player linked to your account` otherwise.
- Inserts the group, then inserts a `group_members` row with `is_admin = true` for the creator's player.

#### Scenario: First group of a new user
- **WHEN** a signed-in user with linked player `P` calls `create_group('Squashbuddies')`
- **THEN** a group is inserted and `group_members(group_id=g, player_id=P, is_admin=true)` is also inserted in the same transaction

#### Scenario: User with no linked player
- **WHEN** a signed-in user without a player row calls `create_group(...)`
- **THEN** the RPC raises `no player linked to your account` and no group is created

---

### Requirement: Group admin tier

A user SHALL be considered a **group admin** of group `G` iff: (a) they are a global admin, OR (b) they own a player row that is a member of `G` with `is_admin = true`. This SHALL be encoded as `is_group_admin(uid, gid)`.

Only group admins MAY edit the group's name/description/visibility, add or remove members, or promote/demote member admin status — all via dedicated RPCs (`update_group`, `delete_group`, `add_group_member`, `remove_group_member`). Direct table writes by non-admins MUST be blocked by RLS.

#### Scenario: Member promotes another member
- **WHEN** a group admin calls `add_group_member(g, p, true)` against an existing member row
- **THEN** the existing row's `is_admin` flag is upserted to `true`

#### Scenario: Non-admin tries to add a member
- **WHEN** a group member who is not a group admin calls `add_group_member(...)`
- **THEN** the RPC raises `group admin only`

---

### Requirement: Last-admin safety

The `remove_group_member` RPC MUST refuse to remove a member whose removal would leave the group with zero admins. The check SHALL be: if the target member has `is_admin = true`, count the OTHER members with `is_admin = true`; if that count is zero, raise `cannot remove the last admin`.

This invariant guarantees every group always has at least one steward who can manage it.

#### Scenario: Removing the only admin
- **WHEN** the sole admin of a group calls `remove_group_member(g, themselves)`
- **THEN** the RPC raises `cannot remove the last admin` and no row is deleted

#### Scenario: Removing one of several admins
- **WHEN** an admin removes another admin and at least one admin will remain
- **THEN** the removal succeeds

---

### Requirement: Visibility

A group with `is_private = false` (public) SHALL be readable by anyone, including unauthenticated users. A group with `is_private = true` SHALL be readable only by global admins and by users who own a player that is a member of the group. The same visibility rule SHALL apply to its `group_members` rows.

This is enforced by RLS using `is_group_member(uid, gid)`.

#### Scenario: Anonymous user views a public group
- **WHEN** an unauthenticated request selects from `groups` with `is_private = false`
- **THEN** the row is returned

#### Scenario: Anonymous user views a private group
- **WHEN** an unauthenticated request selects a row with `is_private = true`
- **THEN** RLS hides the row

#### Scenario: Non-member views a private group's members
- **WHEN** a signed-in user who is not a member selects from `group_members` for a private group
- **THEN** RLS returns no rows

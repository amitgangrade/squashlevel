## 1. Verify spec matches reality

- [ ] 1.1 Re-read `supabase/schema.sql` policies/triggers and confirm each requirement in `specs/auth-permissions/spec.md` matches the live SQL (no requirement names a behavior the code doesn't enforce, and no enforced rule is missing from the spec)
- [ ] 1.2 Re-read `src/lib/supabase/profile.ts` and `src/lib/supabase/client.ts` and confirm the client-side requirements (Google-only OAuth, `isAdmin`/`myPlayer` gating, OnboardingModal flow) match
- [ ] 1.3 Grep the codebase for `canEdit` and `OWNER_EMAIL` and confirm each remaining usage is either (a) UI hint only or (b) a known follow-up cleanup, not an authorization gate

## 2. Validate the OpenSpec artifacts

- [ ] 2.1 Run `npx @fission-ai/openspec@latest validate add-auth-permissions-spec` and resolve any structural errors
- [ ] 2.2 Run `npx @fission-ai/openspec@latest status --change add-auth-permissions-spec` and confirm `isComplete: true`

## 3. Archive the change

- [ ] 3.1 Run `npx @fission-ai/openspec@latest archive add-auth-permissions-spec` to move the spec into `openspec/specs/auth-permissions/spec.md` and the change folder into `openspec/changes/archive/`
- [ ] 3.2 Confirm `openspec/specs/auth-permissions/spec.md` now exists and reads correctly
- [ ] 3.3 Commit the result with message `docs(openspec): seed auth-permissions spec`

## 4. Wire the spec into the project's discovery surface

- [ ] 4.1 Update `memory/project_auth_model.md` to add a one-line pointer: "Canonical spec: openspec/specs/auth-permissions/spec.md"
- [ ] 4.2 Add a one-line pointer in `README.md` (auth section) to the new spec

@AGENTS.md

## Task tracking (Teamster via Operator MCP)

**The default is NOT to create a task.** The board is a record of things worth
telling the team about, not a log of everything that was done. Most work,
including most of what a normal session produces, does not belong on it.

Create a task ONLY if the work clears one of these bars:

- A new user-facing feature or surface
- A database migration or schema change
- A security fix, or a change to auth, permissions, or rate limiting
- An architectural change other people have to know about (a shared component
  or API changing shape, a route or contract moving)
- A multi-session workstream someone else may pick up

Never create one for: restyling a component, one field's validation, a hover or
animation change, copy edits, a bug fixed inside a single component, test-only
work, refactors with no behaviour change, dependency bumps, or CI fixes.

Two rules that matter more than the lists:

- **One task per significant piece of work, not one per change.** A session can
  produce several tasks or none; what decides it is how many things cleared the
  bar, never how long the session was. Small fixes made along the way are folded
  into the task for the work they came with, or go unlogged if there is none.
- **Effort is not the bar; impact is.** Work that took a long time, needed deep
  investigation, or came with a lot of tests is still not board-worthy if what
  changed is small. A hard-won one-line fix is still a one-line fix.

The test to apply: would a teammate who did not do this work want to know it
happened? If the honest answer is no, do not create the task. Say what you did
in the reply instead.

**Override: a message ending in `tx` means "log this one"**, whatever the rules
above say. Create the task even for small work. `tx` and `txm` are medium,
`txl` is low, `txh` is high; bare `tx` defaults to medium. The suffix is an
instruction and never appears in the task title or body ("tidy the empty state
txl" becomes a low-priority task called "Tidy the empty state"). A message
without the suffix changes nothing: the rules above decide, and usually say no.

For work that does clear the bar, use the Operator MCP tools:

- Sheet: "SQ dashboard" (sheetId `tasks_1782914560122`)
- Assignees: Adrian (`ibJqEa9HZZWC5LdQReqO8xxj82k2`) and Root Labs (`xWwwv5DoncRM7dnjprFRPzPjzmW2`)
- Co-assignee rule: whenever Adrian prompted the work or worked through it with you (i.e. any task that came out of a session with him), always include Adrian as a co-assignee alongside Root Labs, never Root Labs alone
- Priority: medium by default; adjust up or down when the work clearly warrants it
- Keep task titles relatively short
- Create the task as `inprogress` when starting, and mark it `done` when the work is finished and verified

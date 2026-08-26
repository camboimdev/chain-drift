# Chain Drift — Claude Instructions

## Language
All code, comments, commit messages, and documentation must be written in **English** without exception.

## No Backwards Compatibility
This product is under active development. When a change is requested:
- Implement it as the new version directly
- Do not add legacy shims, deprecated wrappers, or fallback support for old code
- Do not keep old method signatures alongside new ones
- Remove the old code entirely — the requested change is the new truth

## General
- Follow existing code conventions and file structure
- Prefer editing existing files over creating new ones
- Keep changes focused and minimal — only what was asked

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately — don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction from the user: update tasks/lessons.md with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes — don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Stack Facts
- Chain: **Base** — Base Sepolia (84532) in development, Base (8453) in production.
- Contracts: Solidity 0.8.28 + Foundry + OpenZeppelin v5, in `packages/contracts`.
- Randomness: Chainlink VRF v2.5. Never use `block.prevrandao` or `blockhash`
  for anything that decides a payout — both are proposer-influenceable.
- Frontend chain access: wagmi + viem. No ethers.
- ABIs in `packages/shared/src/abis/` are **generated** — edit the Solidity and
  run `pnpm contracts:build`, never hand-edit them.
- After any contract interface change, re-export the ABIs before touching the
  frontend or the recorder, or the types will silently be stale.

## Contract Work
- Every contract change needs a Foundry test that fails without it.
- Run `pnpm contracts:test` before claiming a contract change works.
- Value must be conserved: a test that sums payouts plus fees against the pool
  is the cheapest way to catch a split bug.

## Task Management
1. **Plan First**: Write plan to tasks/todo.md with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to tasks/todo.md
6. **Capture Lessons**: Update tasks/lessons.md after corrections

## Core Principles
- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

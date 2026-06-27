# worker — durable Golem agent worker (DUR-2)

**Placeholder. Blocked by the DUR-1 spike.**

This package will hold the production durable worker: the astonagent
`runAgent` step loop ported into a Golem WebAssembly component, with each loop
step mapped to oplog-journaled operations so a crashed run resumes exactly-once
without re-calling the LLM, and a session can suspend awaiting input.

It is intentionally empty until the [spike](../spike/README.md) returns a
**go**. Promoting the spike here means:

- Replacing the fake model in `spike/src/main.ts` with the real provider path
  (decided in DUR-3).
- Growing `wit/spike.wit` into the invoke / stream / resume interface (DUR-5).
- Wiring oplog vs Neon persistence (DUR-4).

See [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).

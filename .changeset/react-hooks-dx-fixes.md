---
"@uclaw/sdk": patch
---

Improve React hooks developer experience:

- Add `"use client";` to react hook entries for Next.js App Router compatibility.
- Unify `reasoning` parameter type inside hooks with `ReasoningOptions`.
- Add `error` state to both `useApp` and `useAgent` for capturing socket connection and state update errors.

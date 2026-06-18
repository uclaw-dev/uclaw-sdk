# @uclaw/sdk

## 0.1.1

### Patch Changes

- 44e7cb8: Bump dependencies.
- 69cb979: Document useAgent chat return.

## 0.1.0

### Patch Changes

- 6957047: Add secrets management interface to the SDK.

  - Expose `client.secrets` interface with `add`, `list`, and `remove` methods to manage app-level secrets.

- 502da8d: Add balanced model tier option.
- beca26e: Fix dynamic appId token exchange flow by passing appId in the local request body and parsing it in the server handler.
- 685aced: Improve React hooks developer experience:

  - Add `"use client";` to react hook entries for Next.js App Router compatibility.
  - Unify `reasoning` parameter type inside hooks with `ReasoningOptions`.
  - Add `error` state to both `useApp` and `useAgent` for capturing socket connection and state update errors.

- 1a8e1e9: List secrets with metadata.

## 0.1.0-canary.1

### Prerelease Changes

- Prepare the SDK for the `0.1.0` launch canary.
- Add app-level secrets management APIs.
- Improve React hooks for Next.js App Router, error state, and dynamic `appId` token exchange.
- Include secret metadata when listing secrets.
- Preserve streamed error events in run state before surfacing the run failure.

## 0.0.14

### Patch Changes

- 54204b8: Pre-release fixes.

## 0.0.13

### Patch Changes

- e48c7ae: Fix client token generation.

## 0.0.12

### Patch Changes

- 4960c31: Add official server-side Request handler `AppClient.handler` and update React hook defaults to retrieve client tokens from `/api/uclaw/client-tokens`.

## 0.0.11

### Patch Changes

- 5ba2c0c: Stabilize server-side agent API.

## 0.0.10

### Patch Changes

- 64230ce: Add reasoning config to generateText and streamText.
- d49b601: Rename systemPrompt to instructions.
- 2131c1c: Add generateText/streamText to client and hook.
- 457023a: Replace chat with agent.
- d51700a: Use appId to specify apps. Add tool config.

## 0.0.9

### Patch Changes

- 2c767ee: support appName
- d931c6a: Fix sub-agent rpc.
- f9ed95e: Fix sub-agent connect path

## 0.0.8

### Patch Changes

- 5d879a6: Support agent config in react hooks

## 0.0.7

### Patch Changes

- 99ecdaa: fix api call with empty response
- 6cb0a3b: rpc with context in both http client and react hooks
- db87fd5: Add browser-safe client token support to React hooks

## 0.0.6

### Patch Changes

- 196598a: Add API key support.

## 0.0.5

### Patch Changes

- 801f9e9: specify agent name

## 0.0.4

### Patch Changes

- 086eddc: rename durable objects

## 0.0.3

### Patch Changes

- add9f0f: bump versions correctly

## 0.0.2

### Patch Changes

- 86eb225: cli run command

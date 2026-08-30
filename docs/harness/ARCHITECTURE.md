# harness refactor: adapter architecture

## goal
katie stops being "a discord bot" and becomes a resident agent with pluggable
transport adapters. discord is one adapter. terminal, mic, http, whatever later.

## current shape (what exists)
- `botService.ts` (905 lines) — discord.js-selfbot client, message batching,
  queueing, run management (AbortControllers), reply dispatch. everything
  discord-specific AND all the orchestration lives here.
- `channelContext.ts` (346 lines) — per-discord-channel message history +
  rolling summary, keyed by channelId, persisted as json files.
- `agentService.ts` — thin wrapper that takes ChatMessage[] and calls the llm.
- `contextService.ts` — AsyncLocalStorage per-request context (web side).
- `voiceService.ts` — discord voice, transcription in.
- tools — a bunch reference discord directly (fetchMessages, searchMessages,
  getuserinfo, saveuserinfo).

## target shape
```
                 ┌──────────────┐
   inputs  ───►  │   adapters    │  discord / terminal / mic / http
                 └──────┬───────┘
                        │ normalized InboundMessage
                 ┌──────▼───────┐
                 │    router     │  routes to a context by binding rules
                 └──────┬───────┘
                 ┌──────▼───────┐
                 │   session     │  ONE context = messages + summary + state
                 │   manager     │  (replaces channelContext, key = sessionId)
                 └──────┬───────┘
                 ┌──────▼───────┐
                 │  agent core   │  llm loop, tools, permissions
                 └──────────────┘
                        │ OutboundEvent (text, react, call, ...)
                 ┌──────▼───────┐
                 │   adapters    │  each adapter knows how to render/send
                 └──────────────┘
```

## step 1 — context/session decoupling
- rename channelContext -> sessionStore. key = sessionId (uuid), not channelId.
- session holds: messages, rolling summary, participants, bindings.
- bindings: `binding = { adapterId, externalKey } -> sessionId`
  e.g. `{ adapter: "discord", key: "828800441030017055" } -> "sess_main"`
  a session can have MANY bindings (that's the multi-input goal).
- migration: one binding per existing channelId, sessionIds generated.

## step 2 — adapter interface
```ts
interface Adapter {
  id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  // adapter -> core
  onMessage(cb: (msg: InboundMessage) => Promise<void>): void;
  // core -> adapter
  send(out: OutboundEvent): Promise<void>;
}

interface InboundMessage {
  adapterId: string;
  externalKey: string;      // discord channel id, tty session, ws conn id
  authorId: string;         // adapter-scoped author identity
  authorName?: string;
  content: string;
  attachments?: Attachment[];
  timestamp: number;
  replyTo?: string;
}

type OutboundEvent =
  | { kind: "text"; text: string; replyTo?: string; delayMs?: number }
  | { kind: "react"; emoji: string; target?: string }
  | { kind: "typing" }
  | { kind: "custom"; adapterId: string; payload: unknown };
```
- botService keeps ONLY discord concerns: client login, batching/queueing
  (that logic moves into a shared `runQueue`), messageCreate -> InboundMessage,
  OutboundEvent -> discord send.
- batching/queueing/activeRuns move OUT of botService into the core run
  manager so every adapter gets the same queue behavior for free.

## step 3 — channel binding tool
- new tool `bindContext` / `listBindings` gated by permission:
  - `bind <adapter/key> -> <sessionId>` (create/retarget)
  - `unbind`, `list`
- katie can retarget a channel to a different session mid-conversation.
- default binding rule: unknown input -> new session (or configured default).

## step 4 — permissions
```ts
interface PermissionGrant {
  subject: string;          // adapter-scoped user id, e.g. "discord:232510731067588608"
  capability: Capability;   // "bash" | "readfile" | "opencode" | "tools.all" | ...
  scope?: { adapterId?: string; sessionId?: string };
  expiresAt?: number;
}
```
- default deny for dangerous tools (bash, opencode, subagent, anything fs).
- every tool declares `requiredCapability`.
- toolService checks `permissions.check(authorId, tool.requiredCapability)`
  before executing; denies get a friendly message back through the adapter.
- max = full grant. others: explicit only.
- identity mapping: adapters report `authorId`, a small identity service maps
  adapter ids -> canonical user (so perms follow the person across adapters).

## step 5 — terminal + mic adapters (after the move)
- terminal adapter: readline REPL on the m93p, binds to a named session.
- mic adapter: wake-word optional, transcription -> InboundMessage, tts out.
  (katie's mic never worked on linux, this is the "because it would be cool" tier)

## deployment target
- nixos on the thinkcentre m93p tiny (haswell, 2013).
- katie runs as a systemd user service, config in flake.
- secrets via sops-nix or agenix.
- discord adapter keeps working over the network; nothing else changes.

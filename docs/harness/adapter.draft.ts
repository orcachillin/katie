// core adapter interface — the seam that decouples katie from discord
import type { ChatMessage } from "../services/agent/types.js";

export interface Attachment {
    kind: "image" | "video" | "audio" | "file";
    url?: string;
    path?: string;
    filename?: string;
    mimeType?: string;
}

export interface InboundMessage {
    adapterId: string;
    /** adapter-scoped conversation key: discord channel id, tty id, ws conn id */
    externalKey: string;
    /** adapter-scoped author identity, e.g. "discord:232510731067588608" */
    authorId: string;
    authorName?: string;
    content: string;
    attachments?: Attachment[];
    timestamp: number;
    replyTo?: string;
    /** synthetic prompts (scheduled, cron) bypass adapters but share the shape */
    synthetic?: boolean;
}

export type OutboundEvent =
    | { kind: "text"; text: string; replyTo?: string; delayMs?: number }
    | { kind: "react"; emoji: string; target?: string }
    | { kind: "typing" }
    | { kind: "call"; action: "start" | "end"; target?: string }
    | { kind: "custom"; payload: unknown };

export interface Adapter {
    readonly id: string;
    start(): Promise<void>;
    stop(): Promise<void>;
    /** register the inbound callback; adapter calls it for every message */
    onMessage(cb: (msg: InboundMessage) => Promise<void>): void;
    /** core -> adapter outbound */
    send(msg: InboundMessage, out: OutboundEvent): Promise<void>;
}

/** shared run queue — extracted from botService so all adapters get identical behavior */
export interface RunManager {
    /** queue an inbound message; handles batching, ordering, aborts */
    enqueue(msg: InboundMessage): void;
    abortAll(): void;
}

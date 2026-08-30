// session store — replaces channelContext, keyed by sessionId instead of channelId
import type { ChatMessage } from "../services/agent/types.js";

export interface Session {
    id: string;
    messages: ChatMessage[];
    summary: string;
    /** which adapter inputs are currently wired to this session */
    bindings: Binding[];
    createdAt: number;
    updatedAt: number;
}

export interface Binding {
    adapterId: string;
    externalKey: string;
    /** optional human label, e.g. "dm with max" */
    label?: string;
}

export interface SessionStore {
    get(sessionId: string): Promise<Session | undefined>;
    /** resolve an adapter input to a session, creating one if configured to */
    resolve(adapterId: string, externalKey: string): Promise<Session>;
    /** create/re-point a binding — powers the bindContext tool */
    bind(adapterId: string, externalKey: string, sessionId: string, label?: string): Promise<void>;
    unbind(adapterId: string, externalKey: string): Promise<void>;
    listBindings(sessionId: string): Promise<Binding[]>;
    appendMessages(sessionId: string, msgs: ChatMessage[]): Promise<void>;
    setSummary(sessionId: string, summary: string): Promise<void>;
}

// migration plan from channelContext:
// 1. for each persisted channel file, create session with id = uuid
// 2. binding = { adapterId: "discord", externalKey: channelId }
// 3. summary carries over untouched

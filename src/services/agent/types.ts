export interface StoredImage {
    id: string;
    name: string;
    path: string;
    mimeType: string;
    size: number;
    width?: number;
    height?: number;
}

export interface ChatMessage {
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    name?: string;
    tool_call_id?: string;
    tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
    images?: StoredImage[];
    sent?: boolean;
}

export interface ToolDefinition {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
}

export interface ToolCall {
    id: string;
    name: string;
    arguments: string;
}

export interface ChatOptions {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    tools?: ToolDefinition[];
    toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } };
    signal?: AbortSignal;
    stripSystemPrompt?: boolean;
}

export interface ChatResponse {
    content: string | null;
    toolCalls?: ToolCall[];
    raw?: {
        role: "assistant";
        content: string | null;
        tool_calls?: { id: string; function: { name: string; arguments: string } }[];
    };
    usage?: {
        prompt: number;
        completion: number;
    };
}

export interface StreamChunk {
    content?: string;
    toolCall?: {
        index: number;
        id?: string;
        name?: string;
        arguments?: string;
    };
    finishReason?: string | null;
}

export interface PreparedMessages {
    messages: Record<string, unknown>[];
    hasImages: boolean;
}

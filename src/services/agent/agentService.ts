import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import AbstractService from "../../base/abstractService.js";

export interface ChatMessage {
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    name?: string;
    tool_call_id?: string;
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
    stripSystemPrompt?: boolean
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

export default class AgentService extends AbstractService<"agent"> {

    private apiKey: string;
    private apiUrl: string;
    private defaultModel: string;
    private systemPrompt = "";

    constructor() {
        super("agent");
        this.apiKey = process.env.AI_KEY!;
        this.apiUrl = (process.env.AI_URL || "https://api.neuralwatt.com/v1").replace(/\/+$/, "");
        this.defaultModel = process.env.AI_MODEL || "glm-5.2";
    }

    public async init(): Promise<void> {
        try {
            this.systemPrompt = readFileSync(resolve("./prompts/katie.md"), "utf-8");
            this.logger.log("System prompt loaded");
        } catch {
            this.logger.warn("Could not load prompts/katie.md");
        }

        if (!this.apiKey) {
            this.logger.warn("No AI_KEY set — agent will be disabled");
        }
    }

    public async destroy(): Promise<void> { }

    async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
        const model = options?.model || this.defaultModel;
        this.logger.log(`chat (${messages.length} msgs, ${model})`);

        const fullMessages: ChatMessage[] = options?.stripSystemPrompt ? messages : [
            { role: "system", content: this.getSystemPrompt() },
            ...messages,
        ];

        const body: Record<string, unknown> = {
            model,
            messages: fullMessages,
            temperature: options?.temperature ?? 0.7,
            max_tokens: options?.maxTokens ?? 1024,
            provider: {
                ignore: ["Inceptron", "Morph"]
            }
        };

        if (options?.tools?.length) {
            body.tools = options.tools;
            body.tool_choice = options.toolChoice ?? "auto";
        }

        const response = await fetch(`${this.apiUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
            signal: options?.signal,
        });

        if (!response.ok) {
            const text = await response.text();
            this.logger.error(`chat API error ${response.status}: ${text}`);
            throw new Error(`LLM API error ${response.status}: ${text}`);
        }

        const data = (await response.json()) as any;
        const choice = data.choices?.[0];
        const content = choice?.message?.content ?? null;
        const toolCalls = choice?.message?.tool_calls?.map((tc: any) => ({
            id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments,
        }));

        this.logger.log(`chat done: ${content?.length ?? 0} chars, ${toolCalls?.length ?? 0} tool calls`);
        return {
            content,
            toolCalls,
            raw: choice?.message && {
                role: "assistant",
                content: choice.message.content,
                tool_calls: choice.message.tool_calls?.map((tc: any) => ({
                    id: tc.id,
                    function: { name: tc.function.name, arguments: tc.function.arguments },
                })),
            },
            usage: data.usage && {
                prompt: data.usage.prompt_tokens,
                completion: data.usage.completion_tokens,
            },
        };
    }

    public getSystemPrompt(): string {
        const now = new Date();
        const dateStr = AgentService.formatDate(now)

        return `${this.systemPrompt}\n\nCurrent date and time: ${dateStr}`;
    }

    public static formatDate(date: Date) {
        return date.toLocaleString("en-US", {
            weekday: "short",
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            timeZoneName: "short",
        });
    }

    async *chatStream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<StreamChunk> {
        const model = options?.model || this.defaultModel;
        this.logger.log(`chatStream (${messages.length} msgs, ${model})`);

        const fullMessages: ChatMessage[] = [
            { role: "system", content: this.getSystemPrompt() },
            ...messages,
        ];

        const body: Record<string, unknown> = {
            model,
            messages: fullMessages,
            temperature: options?.temperature ?? 0.7,
            max_tokens: options?.maxTokens ?? 1024,
            stream: true,
        };

        if (options?.tools?.length) {
            body.tools = options.tools;
            body.tool_choice = options.toolChoice ?? "auto";
        }

        const response = await fetch(`${this.apiUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
            signal: options?.signal,
        });

        if (!response.ok) {
            const text = await response.text();
            this.logger.error(`chatStream API error ${response.status}: ${text}`);
            throw new Error(`LLM API error ${response.status}: ${text}`);
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith("data: ")) continue;
                const data = trimmed.slice(6);
                if (data === "[DONE]") {
                    this.logger.log("chatStream done");
                    return;
                }

                try {
                    const parsed = JSON.parse(data);
                    const delta = parsed.choices?.[0]?.delta;
                    const finishReason = parsed.choices?.[0]?.finish_reason;

                    if (!delta) {
                        if (finishReason) yield { finishReason };
                        continue;
                    }

                    if (delta.content) {
                        yield { content: delta.content };
                    }

                    if (delta.tool_calls) {
                        for (const tc of delta.tool_calls) {
                            yield {
                                toolCall: {
                                    index: tc.index,
                                    id: tc.id,
                                    name: tc.function?.name,
                                    arguments: tc.function?.arguments,
                                },
                            };
                        }
                    }

                    if (finishReason) {
                        yield { finishReason };
                    }
                } catch {
                    // skip malformed json lines
                }
            }
        }
    }
}
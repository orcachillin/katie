import BaseAIClient from "./baseAIClient.js";
import { estimateContextTokens } from "../tokenEstimator.js";
import type { ChatMessage, ChatOptions, ChatResponse, PreparedMessages, StreamChunk } from "../types.js";

export default class ChatClient extends BaseAIClient {

    constructor(
        apiKey: string,
        apiUrl: string,
        private readonly defaultModel: string,
        private readonly visionModel: string,
        private readonly getSystemPrompt: () => string,
        private readonly prepareMessages: (messages: ChatMessage[]) => Promise<PreparedMessages>,
    ) {
        super("agent:chat", apiKey, apiUrl);
    }

    public async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
        const fullMessages: ChatMessage[] = options?.stripSystemPrompt ? messages : [
            { role: "system", content: this.getSystemPrompt() },
            ...messages,
        ];
        const prepared = await this.prepareMessages(fullMessages);
        const model = options?.model || (prepared.hasImages ? this.visionModel : this.defaultModel);
        this.logger.log(`chat (${messages.length} msgs, ~${estimateContextTokens(fullMessages)} tokens, ${model}${prepared.hasImages ? ", vision" : ""})`);

        const body: Record<string, unknown> = {
            model,
            messages: prepared.messages,
            temperature: options?.temperature ?? 0.7,
            ...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}),
            provider: { ignore: ["Inceptron", "Morph"] },
        };
        if (options?.tools?.length) {
            body.tools = options.tools;
            body.tool_choice = options.toolChoice ?? "auto";
        }

        const response = await this.post(body, options?.signal, "LLM");
        const data = (await response.json()) as any;
        const estimated = estimateContextTokens(fullMessages);
        const actualPrompt = data.usage?.prompt_tokens;
        if (actualPrompt) {
            this.logger.log(`token check: estimated ~${estimated}, actual ${actualPrompt} (drift ${(actualPrompt / estimated).toFixed(2)}x)`);
        }
        const choice = data.choices?.[0];
        const content = choice?.message?.content ?? null;
        const toolCalls = choice?.message?.tool_calls?.map((toolCall: any) => ({
            id: toolCall.id,
            name: toolCall.function.name,
            arguments: toolCall.function.arguments,
        }));

        this.logger.log(`chat done: ${content?.length ?? 0} chars, ${toolCalls?.length ?? 0} tool calls`);
        return {
            content,
            toolCalls,
            raw: choice?.message && {
                role: "assistant",
                content: choice.message.content,
                tool_calls: choice.message.tool_calls?.map((toolCall: any) => ({
                    id: toolCall.id,
                    function: { name: toolCall.function.name, arguments: toolCall.function.arguments },
                })),
            },
            usage: data.usage && {
                prompt: data.usage.prompt_tokens,
                completion: data.usage.completion_tokens,
            },
        };
    }

    public async *chatStream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<StreamChunk> {
        const model = options?.model || this.defaultModel;
        this.logger.log(`chatStream (${messages.length} msgs, ${model})`);
        const body: Record<string, unknown> = {
            model,
            messages: [
                { role: "system", content: this.getSystemPrompt() },
                ...messages,
            ],
            temperature: options?.temperature ?? 0.7,
            ...(options?.maxTokens ? { max_tokens: options.maxTokens } : {}),
            stream: true,
        };
        if (options?.tools?.length) {
            body.tools = options.tools;
            body.tool_choice = options.toolChoice ?? "auto";
        }

        const response = await this.post(body, options?.signal, "LLM");
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
                    if (delta.content) yield { content: delta.content };
                    if (delta.tool_calls) {
                        for (const toolCall of delta.tool_calls) {
                            yield {
                                toolCall: {
                                    index: toolCall.index,
                                    id: toolCall.id,
                                    name: toolCall.function?.name,
                                    arguments: toolCall.function?.arguments,
                                },
                            };
                        }
                    }
                    if (finishReason) yield { finishReason };
                } catch {
                    // Ignore malformed event-stream lines.
                }
            }
        }
    }
}

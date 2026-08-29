import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import AbstractService from "../../base/abstractService.js";
import Core from "../../core.js";
import { selectRecentImages } from "./imageSelection.js";
import { trimOldToolResults } from "./tokenEstimator.js";
import ChatClient from "./clients/chatClient.js";
import TranscriptionClient from "./clients/transcriptionClient.js";
import type { ChatMessage, ChatOptions, ChatResponse, PreparedMessages, StreamChunk } from "./types.js";

export type { ChatMessage, ChatOptions, ChatResponse, StoredImage, StreamChunk, ToolCall, ToolDefinition } from "./types.js";

const MAX_CONTEXT_IMAGES = 3;
const DEFAULT_IMAGE_MAX_AGE_MS = 30 * 60 * 1000;
const IMAGE_MAX_AGE_MS = Math.max(0, Number(process.env.IMAGE_MAX_AGE_MS) || DEFAULT_IMAGE_MAX_AGE_MS);
const IMAGE_ROOT = resolve("./workspace/images");

export default class AgentService extends AbstractService<"agent"> {

    private apiKey: string;
    private chatClient: ChatClient;
    private transcriptionClient: TranscriptionClient;
    constructor() {
        super("agent");
        this.apiKey = process.env.AI_KEY!;
        const apiUrl = (process.env.AI_URL || "https://api.neuralwatt.com/v1").replace(/\/+$/, "");
        const defaultModel = process.env.AI_MODEL || "glm-5.2";
        this.chatClient = new ChatClient(
            this.apiKey,
            apiUrl,
            defaultModel,
            process.env.AI_VISION_MODEL || defaultModel,
            () => this.getSystemPrompt(),
            messages => this.prepareMessages(messages),
        );
        this.transcriptionClient = new TranscriptionClient(
            process.env.STT_KEY || this.apiKey,
            (process.env.STT_URL || apiUrl).replace(/\/+$/, ""),
            process.env.STT_MODEL || "google/gemini-2.5-flash",
        );
    }

    public async init(): Promise<void> {
        if (!this.apiKey) {
            this.logger.warn("No AI_KEY set — agent will be disabled");
        }
    }

    public async destroy(): Promise<void> { }

    public chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
        return this.chatClient.chat(messages, options);
    }

    public async transcribe(wav: Buffer, signal?: AbortSignal): Promise<string> {
        return this.transcriptionClient.transcribe(wav, signal);
    }

    private async prepareMessages(messages: ChatMessage[]): Promise<PreparedMessages> {
        const selection = await selectRecentImages(messages, MAX_CONTEXT_IMAGES, IMAGE_MAX_AGE_MS);

        let hasImages = false;
        const prepared = await Promise.all(messages.map(async message => {
            const { images, sent, ...plainMessage } = message;
            const messageContent = sent === false
                ? `[sent: false]\n${message.content}`
                : message.content;
            const preparedMessage = { ...plainMessage, content: messageContent };
            if (!images?.length) return preparedMessage;

            const content: Record<string, unknown>[] = [
                { type: "text", text: messageContent || "images attached" },
            ];
            for (const image of images) {
                if (!selection.selected.has(image.path)) {
                    content.push({ type: "text", text: `[image attachment: ${image.name} — evicted]` });
                    continue;
                }
                const absolutePath = resolve(image.path);
                if (absolutePath !== IMAGE_ROOT && !absolutePath.startsWith(`${IMAGE_ROOT}${sep}`)) {
                    this.logger.warn(`ignored image outside workspace: ${image.path}`);
                    content.push({ type: "text", text: `[image attachment: ${image.name} — evicted]` });
                    continue;
                }
                try {
                    const data = await readFile(absolutePath);
                    content.push({ type: "text", text: `image attachment: ${image.name}` });
                    content.push({
                        type: "image_url",
                        image_url: {
                            url: `data:${image.mimeType};base64,${data.toString("base64")}`,
                            detail: "auto",
                        },
                    });
                    hasImages = true;
                } catch (err: any) {
                    this.logger.warn(`could not load stored image ${image.id}: ${err?.message ?? err}`);
                    content.push({ type: "text", text: `[image attachment: ${image.name} — evicted]` });
                }
            }

            return { ...preparedMessage, content };
        }));

        trimOldToolResults(prepared as ChatMessage[]);

        return { messages: prepared, hasImages };
    }

    public getSystemPrompt(): string {
        const now = new Date();
        const dateStr = AgentService.formatDate(now)

        return `${Core.services.prompt.get("katie")}\n\n${Core.services.prompt.render("currentDate", { date: dateStr })}`;
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

    public chatStream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<StreamChunk> {
        return this.chatClient.chatStream(messages, options);
    }
}

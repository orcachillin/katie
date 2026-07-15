import AbstractService from "../../base/abstractService.js";
import { env } from "node:process";

interface EmbeddingResponse {
    data: { embedding: number[] }[];
    model: string;
}

export default class EmbeddingService extends AbstractService<"embedding"> {

    private apiKey: string;
    private apiUrl: string;
    private model: string;

    constructor() {
        super("embedding");
        this.apiKey = env.EMBEDDING_KEY || env.OPENROUTER_KEY || env.AI_KEY!;
        this.apiUrl = (env.EMBEDDING_URL || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
        this.model = env.EMBEDDING_MODEL || "text-embedding-3-small";
    }

    public async init(): Promise<void> {
        if (!this.apiKey) {
            this.logger.warn("No AI_KEY set — embeddings will be disabled");
        }
    }

    public async destroy(): Promise<void> { }

    async embed(text: string): Promise<number[]> {
        if (!this.apiKey) {
            throw new Error("Embedding service not configured: no AI_KEY");
        }

        this.logger.log(`embedding (${text.slice(0, 60)}...)`);

        const response = await fetch(`${this.apiUrl}/embeddings`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model: this.model,
                input: text,
            }),
        });

        if (!response.ok) {
            const body = await response.text();
            this.logger.error(`embedding API error: ${response.status} ${body}`);
            throw new Error(`Embedding API error ${response.status}: ${body}`);
        }

        const data = (await response.json()) as EmbeddingResponse;
        const vec = data.data[0].embedding;
        this.logger.log(`got embedding (${vec.length}d)`);
        return vec;
    }

    async embedBatch(texts: string[]): Promise<number[][]> {
        if (!this.apiKey) {
            throw new Error("Embedding service not configured: no AI_KEY");
        }

        this.logger.log(`embedding batch (${texts.length} texts)`);

        const response = await fetch(`${this.apiUrl}/embeddings`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
                model: this.model,
                input: texts,
            }),
        });

        if (!response.ok) {
            const body = await response.text();
            this.logger.error(`embedding batch API error: ${response.status} ${body}`);
            throw new Error(`Embedding API error ${response.status}: ${body}`);
        }

        const data = (await response.json()) as EmbeddingResponse;
        this.logger.log(`got ${data.data.length} embeddings`);
        return data.data.map(d => d.embedding);
    }

    async cosineSimilarity(a: number[], b: number[]): Promise<number> {
        let dot = 0, na = 0, nb = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            na += a[i] * a[i];
            nb += b[i] * b[i];
        }
        return dot / (Math.sqrt(na) * Math.sqrt(nb));
    }
}
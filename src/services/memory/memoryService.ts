import AbstractService from "../../base/abstractService.js";
import Core from "../../core.js";
import { Memory, MemoryCategory } from "../../database/entities/Memory.entity.js";

export interface MemorySearchResult {
    memory: Memory;
    similarity: number;
}

export default class MemoryService extends AbstractService<"memory"> {

    private vectorReady = false;

    constructor() {
        super("memory");
    }

    public async init(): Promise<void> {
        try {
            await Core.database.em.execute(`CREATE INDEX IF NOT EXISTS memory_embedding_idx ON "memory" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100)`);
            this.vectorReady = true;
            this.logger.log("Vector index ready");
        } catch {
            this.logger.warn("Could not create vector index — table may not exist yet");
        }
    }

    public async destroy(): Promise<void> { }

    async save(category: MemoryCategory, name: string, content: string, scopeId?: string): Promise<Memory> {
        const repo = Core.database.repository.memory;
        const where: any = { category, name };
        if (scopeId) where.scopeId = scopeId;

        let memory = await repo.findOne(where);

        if (memory) {
            memory.content = content;
            memory.updatedAt = new Date();
        } else {
            memory = Core.database.repository.memory.create({
                category,
                name,
                content,
                scopeId,
            })
        }

        const embedding = await Core.services.embedding.embed(content);
        memory.embedding = `[${embedding.join(",")}]`;

        Core.database.em.persist(memory);
        await Core.database.em.flush();
        return memory;
    }

    async read(category: MemoryCategory, name: string, scopeId?: string): Promise<Memory | null> {
        const where: any = { category, name };
        if (scopeId) where.scopeId = scopeId;
        return Core.database.repository.memory.findOne(where);
    }

    async readContent(category: MemoryCategory, name: string, scopeId?: string): Promise<string> {
        const memory = await this.read(category, name, scopeId);
        return memory?.content ?? "this memory doesnt exist yet, use memory to save something!";
    }

    async list(category: MemoryCategory, scopeId?: string): Promise<string[]> {
        const where: any = { category };
        if (scopeId) where.scopeId = scopeId;
        const memories = await Core.database.repository.memory.find(where, { fields: ["name"] });
        return memories.map(m => m.name);
    }

    async delete(category: MemoryCategory, name: string, scopeId?: string): Promise<boolean> {
        const repo = Core.database.repository.memory;
        const where: any = { category, name };
        if (scopeId) where.scopeId = scopeId;
        const memory = await repo.findOne(where);
        if (!memory) return false;
        Core.database.em.remove(memory);
        await Core.database.em.flush();
        return true;
    }

    async search(category: MemoryCategory, query: string, scopeId?: string, topK: number = 5): Promise<MemorySearchResult[]> {
        const queryEmbedding = await Core.services.embedding.embed(query);

        if (this.vectorReady) {
            return this._searchBySQL(category, queryEmbedding, scopeId, topK);
        }

        const where: any = { category };
        if (scopeId) where.scopeId = scopeId;

        const memories = await Core.database.repository.memory.find(where);

        const scored: MemorySearchResult[] = [];
        for (const memory of memories) {
            if (!memory.embedding) continue;
            const vec = this._parseVector(memory.embedding);
            if (!vec) continue;
            const similarity = await Core.services.embedding.cosineSimilarity(queryEmbedding, vec);
            scored.push({ memory, similarity });
        }

        scored.sort((a, b) => b.similarity - a.similarity);
        return scored.slice(0, topK);
    }

    async searchByVector(category: MemoryCategory, embedding: number[], scopeId?: string, topK: number = 5): Promise<MemorySearchResult[]> {
        if (this.vectorReady) {
            return this._searchBySQL(category, embedding, scopeId, topK);
        }

        const where: any = { category };
        if (scopeId) where.scopeId = scopeId;

        const memories = await Core.database.repository.memory.find(where);

        const scored: MemorySearchResult[] = [];
        for (const memory of memories) {
            if (!memory.embedding) continue;
            const vec = this._parseVector(memory.embedding);
            if (!vec) continue;
            const similarity = await Core.services.embedding.cosineSimilarity(embedding, vec);
            scored.push({ memory, similarity });
        }

        scored.sort((a, b) => b.similarity - a.similarity);
        return scored.slice(0, topK);
    }

    private async _searchBySQL(category: MemoryCategory, embedding: number[], scopeId?: string, topK: number = 5): Promise<MemorySearchResult[]> {
        const vecStr = `[${embedding.join(",")}]`;
        const params: any[] = [vecStr, category];
        let scopeClause = "";

        if (scopeId) {
            scopeClause = `AND "scope_id" = ?`;
            params.push(scopeId);
        } else {
            scopeClause = `AND "scope_id" IS NULL`;
        }

        params.push(vecStr, topK);

        const rows = await Core.database.em.execute<any[]>(
            `SELECT id, 1 - ("embedding" <=> ?::vector) AS distance
             FROM "memory"
             WHERE "category" = ? ${scopeClause}
             ORDER BY "embedding" <=> ?::vector
             LIMIT ?`,
            params,
        );

        if (rows.length === 0) return [];

        const ids = rows.map(r => r.id);
        const memories = await Core.database.repository.memory.find({ id: { $in: ids } });
        const map = new Map(memories.map(m => [m.id, m]));

        return rows
            .map(r => ({ memory: map.get(r.id), similarity: r.distance }))
            .filter((r): r is MemorySearchResult => r.memory != null);
    }

    private _parseVector(str: string): number[] | null {
        try {
            const cleaned = str.replace(/^\[|\]$/g, "");
            return cleaned.split(",").map(Number);
        } catch {
            return null;
        }
    }
}
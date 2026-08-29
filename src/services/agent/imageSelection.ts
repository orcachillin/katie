import { stat } from "node:fs/promises";
import type { ChatMessage, StoredImage } from "./types.js";

export interface ImageSelectionResult {
    selected: Set<string>;
    total: number;
    evicted: number;
}

export async function selectRecentImages(messages: ChatMessage[], maxImages: number, maxAgeMs: number): Promise<ImageSelectionResult> {
    const selected = new Set<string>();
    let total = 0;
    for (const message of messages) {
        total += message.images?.length ?? 0;
    }

    for (let messageIndex = messages.length - 1; messageIndex >= 0 && selected.size < maxImages; messageIndex--) {
        const images = messages[messageIndex].images ?? [];
        for (let imageIndex = images.length - 1; imageIndex >= 0 && selected.size < maxImages; imageIndex--) {
            const image = images[imageIndex];
            const age = await imageAgeMs(image, messages[messageIndex]);
            if (age !== undefined && age <= maxAgeMs) selected.add(image.path);
        }
    }

    let evicted = 0;
    for (const message of messages) {
        for (const image of message.images ?? []) {
            if (!selected.has(image.path)) evicted++;
        }
    }

    return { selected, total, evicted };
}

async function imageAgeMs(image: StoredImage, message: ChatMessage): Promise<number | undefined> {
    try {
        const info = await stat(image.path);
        return Math.max(0, Date.now() - info.mtimeMs);
    } catch {
        const match = /\btimestamp="(\d{12,})"/.exec(typeof message.content === "string" ? message.content : "");
        if (match) return Math.max(0, Date.now() - Number(match[1]));
        return undefined;
    }
}

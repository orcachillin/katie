import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Message, MessageAttachment } from "discord.js-selfbot-v13";
import AbstractService from "../../base/abstractService.js";
import type { StoredImage } from "../agent/agentService.js";
import XML from "../../util/xml.js";

const MAX_IMAGES_PER_MESSAGE = 3;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const IMAGE_ROOT = resolve("./workspace/images");
const SUPPORTED_IMAGE_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);

export interface StoredMessageImages {
    images: StoredImage[];
    context: string;
}

export default class ImageService extends AbstractService<"image"> {

    constructor() {
        super("image");
    }

    public async init(): Promise<void> {
        await mkdir(IMAGE_ROOT, { recursive: true });
    }

    public async destroy(): Promise<void> { }

    public async storeMessageImages(message: Message, signal: AbortSignal): Promise<StoredMessageImages> {
        const attachments = Array.from(message.attachments.values());
        const imageAttachments = attachments.filter(attachment => this.isImage(attachment));
        const selected = imageAttachments.slice(0, MAX_IMAGES_PER_MESSAGE);
        const images: StoredImage[] = [];
        const context: string[] = [];

        for (const attachment of attachments) {
            if (!this.isImage(attachment)) {
                context.push(this.formatAttachment(attachment, "not an image"));
                continue;
            }
            if (!selected.includes(attachment)) {
                context.push(this.formatAttachment(attachment, `only ${MAX_IMAGES_PER_MESSAGE} images can be processed per message`));
                continue;
            }
            if (attachment.size > MAX_IMAGE_SIZE) {
                context.push(this.formatAttachment(attachment, `image exceeds the ${MAX_IMAGE_SIZE / 1024 / 1024} MB limit`));
                continue;
            }

            try {
                const image = await this.download(message, attachment, signal);
                images.push(image);
                context.push(this.formatAttachment(attachment, "stored in image context", image.id));
            } catch (err: any) {
                if (err?.name === "AbortError") throw err;
                this.logger.warn(`failed to store image ${attachment.id}: ${err?.message ?? err}`);
                context.push(this.formatAttachment(attachment, "image could not be downloaded"));
            }
        }

        return { images, context: context.join("\n") };
    }

    private isImage(attachment: MessageAttachment): boolean {
        return attachment.contentType?.toLowerCase().startsWith("image/") === true
            || (attachment.width !== null && attachment.height !== null);
    }

    private async download(message: Message, attachment: MessageAttachment, signal: AbortSignal): Promise<StoredImage> {
        const response = await fetch(attachment.url, { signal });
        if (!response.ok) throw new Error(`download returned ${response.status}`);

        const data = Buffer.from(await response.arrayBuffer());
        if (data.byteLength > MAX_IMAGE_SIZE) throw new Error(`image exceeds the ${MAX_IMAGE_SIZE / 1024 / 1024} MB limit`);

        const attachmentType = attachment.contentType?.split(";")[0].toLowerCase();
        const responseType = response.headers.get("content-type")?.split(";")[0].toLowerCase();
        let mimeType = attachmentType?.startsWith("image/") ? attachmentType : responseType;
        if (mimeType === "image/jpg") mimeType = "image/jpeg";
        if (!mimeType || !SUPPORTED_IMAGE_TYPES.has(mimeType)) {
            throw new Error(`unsupported content type ${mimeType ?? "unknown"}`);
        }

        const path = join("workspace", "images", message.channelId, message.id, attachment.id);
        const absolutePath = resolve(path);
        const directory = resolve(absolutePath, "..");
        await mkdir(directory, { recursive: true });
        await writeFile(absolutePath, data);

        return {
            id: attachment.id,
            name: attachment.name ?? attachment.id,
            path,
            mimeType,
            size: data.byteLength,
            width: attachment.width ?? undefined,
            height: attachment.height ?? undefined,
        };
    }

    private formatAttachment(attachment: MessageAttachment, status: string, imageId?: string): string {
        return XML.format("attachment", {
            id: attachment.id,
            name: attachment.name ?? undefined,
            contentType: attachment.contentType ?? undefined,
            width: attachment.width?.toString(),
            height: attachment.height?.toString(),
            imageId,
            status,
        });
    }
}

import { defineEntity, p } from "@mikro-orm/core";
import { ResourceBaseEntity } from "../baseEntities/resource.js";

export enum MemoryCategory {
    User = "user",
    Channel = "channel",
    Self = "self",
}

export const MemorySchema = defineEntity({
    name: "Memory",
    extends: ResourceBaseEntity,
    properties: {
        category: p.string().length(32),
        scopeId: p.string().length(20).nullable(),
        name: p.string().length(64),
        content: p.text(),
        embedding: p.text().nullable().columnType('vector(1536)'),
    },
    indexes: [
        { properties: ["category", "scopeId"] },
    ],
})

export class Memory extends MemorySchema.class { }

MemorySchema.setClass(Memory)
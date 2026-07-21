import { defineEntity, p } from "@mikro-orm/core";
import { ResourceBaseEntity } from "../baseEntities/resource.js";

export const UserSchema = defineEntity({
    name: "User",
    extends: ResourceBaseEntity,
    properties: {
        id: p.string().length(20).primary(),
        username: p.string(),
        displayName: p.string(),
        pronouns: p.string().nullable(),
        bio: p.text().nullable(),
    }
})

export class User extends UserSchema.class { }

UserSchema.setClass(User)
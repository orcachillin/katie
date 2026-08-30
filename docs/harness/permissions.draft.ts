// permission system — default deny, explicit grants
export type Capability =
    | "tools.basic"      // memorize, querymemories, getuserinfo, fetchmessages...
    | "tools.web"        // websearch, webfetch
    | "tools.fs.read"    // readfile, listdir
    | "tools.fs.write"   // anything that mutates
    | "tools.bash"       // shell
    | "tools.agent"      // opencode, subagent
    | "tools.call"       // calluser, callgroup
    | "admin";           // bind contexts, manage permissions

export interface Grant {
    /** canonical user id after identity mapping */
    subject: string;
    capability: Capability;
    /** restrict to one adapter or one session if present */
    scope?: { adapterId?: string; sessionId?: string };
    expiresAt?: number;
}

export interface IdentityService {
    /** map adapter-scoped id -> canonical user, e.g. "discord:123" -> "max" */
    canonical(adapterId: string, externalUserId: string): Promise<string | undefined>;
}

export interface PermissionService {
    check(subject: string, cap: Capability, ctx?: { adapterId?: string; sessionId?: string }): Promise<boolean>;
    grant(g: Grant): Promise<void>;
    revoke(subject: string, cap: Capability): Promise<void>;
    list(subject?: string): Promise<Grant[]>;
}

// every tool declares requiredCapability; toolService checks before running.
// deny -> outbound { kind: "text", text: "no. ask max for that one" } through the adapter.

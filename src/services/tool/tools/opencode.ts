import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { Tool } from "../toolService.js";

const DEFAULT_TIMEOUT = 20 * 60 * 1000;
const MIN_TIMEOUT = 60_000;
const MAX_TIMEOUT = 60 * 60 * 1000;
const MAX_TASK_LENGTH = 20_000;
const MAX_CAPTURE_BYTES = 10 * 1024 * 1024;
const MAX_RESULT_LENGTH = 50_000;

interface ProcessResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    timedOut: boolean;
    outputExceeded: boolean;
}

export const openCode = {
    type: "function",
    function: {
        name: "opencode",
        description: "run an autonomous OpenCode CLI agent for large-scale technical work such as understanding and modifying a repository, implementing multi-file features, debugging, refactoring, or running extensive verification. returns a sessionId that can be continued in a later call.",
        parameters: {
            type: "object",
            properties: {
                task: { type: "string", description: "complete technical task with requirements, constraints, and expected verification" },
                cwd: { type: "string", description: "existing project directory; defaults to OPENCODE_DEFAULT_CWD or the application working directory" },
                timeoutMs: { type: "integer", description: "timeout from 60000 to 3600000 ms; defaults to 20 minutes" },
                model: { type: "string", description: "optional OpenCode model in provider/model format" },
                agent: { type: "string", description: "optional configured OpenCode agent name" },
                variant: { type: "string", description: "optional model reasoning variant such as high or max" },
                sessionId: { type: "string", description: "continue a session returned by an earlier opencode call" },
                fork: { type: "boolean", description: "fork sessionId before continuing instead of modifying that session" },
                autoApprove: { type: "boolean", description: "automatically approve non-denied OpenCode permissions; defaults to true" },
            },
            required: ["task"],
        },
        execute: async (args) => {
            const task = typeof args.task === "string" ? args.task.trim() : "";
            if (!task) return "task is required";
            if (task.length > MAX_TASK_LENGTH) return `task must be ${MAX_TASK_LENGTH} characters or fewer`;

            const timeout = args.timeoutMs ?? DEFAULT_TIMEOUT;
            if (!Number.isInteger(timeout) || (timeout as number) < MIN_TIMEOUT || (timeout as number) > MAX_TIMEOUT) {
                return `timeoutMs must be an integer between ${MIN_TIMEOUT} and ${MAX_TIMEOUT}`;
            }

            const cwdInput = typeof args.cwd === "string" && args.cwd.trim()
                ? args.cwd.trim()
                : process.env.OPENCODE_DEFAULT_CWD || process.cwd();
            const cwd = resolve(cwdInput);
            const cwdStat = await stat(cwd).catch(() => undefined);
            if (!cwdStat?.isDirectory()) return `cwd is not an existing directory: ${cwd}`;

            const sessionId = parseOption(args.sessionId, "sessionId", 200, /^[A-Za-z0-9_-]+$/);
            if (sessionId.error) return sessionId.error;
            const model = parseOption(args.model, "model", 300);
            if (model.error) return model.error;
            const agent = parseOption(args.agent, "agent", 100, /^[A-Za-z0-9_.-]+$/);
            if (agent.error) return agent.error;
            const variant = parseOption(args.variant, "variant", 100, /^[A-Za-z0-9_.-]+$/);
            if (variant.error) return variant.error;
            if (args.fork === true && !sessionId.value) return "fork requires sessionId";

            const cliArgs = ["run", "--format", "json", "--dir", cwd];
            if (args.autoApprove !== false) cliArgs.push("--auto");
            if (sessionId.value) cliArgs.push("--session", sessionId.value);
            if (args.fork === true) cliArgs.push("--fork");
            if (model.value) cliArgs.push("--model", model.value);
            if (agent.value) cliArgs.push("--agent", agent.value);
            if (variant.value) cliArgs.push("--variant", variant.value);
            cliArgs.push("--", task);

            const result = await runProcess("opencode", cliArgs, cwd, timeout as number);
            return JSON.stringify(parseResult(result, cwd));
        },
    },
} satisfies Tool;

function parseOption(
    value: unknown,
    name: string,
    maxLength: number,
    pattern?: RegExp,
): { value?: string; error?: string } {
    if (value === undefined) return {};
    if (typeof value !== "string" || !value.trim()) return { error: `${name} must be a non-empty string` };
    const parsed = value.trim();
    if (parsed.length > maxLength) return { error: `${name} must be ${maxLength} characters or fewer` };
    if (pattern && !pattern.test(parsed)) return { error: `${name} contains invalid characters` };
    return { value: parsed };
}

function runProcess(command: string, args: string[], cwd: string, timeout: number): Promise<ProcessResult> {
    return new Promise(resolveProcess => {
        const child = spawn(command, args, {
            cwd,
            detached: process.platform !== "win32",
            env: { ...process.env, CI: "1", NO_COLOR: "1" },
            stdio: ["ignore", "pipe", "pipe"],
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        let capturedBytes = 0;
        let settled = false;
        let timedOut = false;
        let outputExceeded = false;
        let forceKillTimer: NodeJS.Timeout | undefined;

        const kill = (signal: NodeJS.Signals) => {
            if (!child.pid) return;
            try {
                if (process.platform === "win32") child.kill(signal);
                else process.kill(-child.pid, signal);
            } catch { }
        };
        const terminate = () => {
            kill("SIGTERM");
            forceKillTimer = setTimeout(() => kill("SIGKILL"), 5_000);
            forceKillTimer.unref();
        };
        const capture = (target: Buffer[], chunk: Buffer) => {
            capturedBytes += chunk.length;
            if (capturedBytes <= MAX_CAPTURE_BYTES) target.push(chunk);
            else if (!outputExceeded) {
                outputExceeded = true;
                terminate();
            }
        };

        child.stdout.on("data", chunk => capture(stdout, Buffer.from(chunk)));
        child.stderr.on("data", chunk => capture(stderr, Buffer.from(chunk)));
        const timeoutTimer = setTimeout(() => {
            timedOut = true;
            terminate();
        }, timeout);
        timeoutTimer.unref();

        const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutTimer);
            if (forceKillTimer) clearTimeout(forceKillTimer);
            resolveProcess({
                stdout: Buffer.concat(stdout).toString("utf8"),
                stderr: Buffer.concat(stderr).toString("utf8"),
                exitCode,
                signal,
                timedOut,
                outputExceeded,
            });
        };

        child.once("error", error => {
            stderr.push(Buffer.from(error.message));
            finish(null, null);
        });
        child.once("close", finish);
    });
}

function parseResult(result: ProcessResult, cwd: string): Record<string, unknown> {
    let sessionId: string | undefined;
    let usage: Record<string, unknown> | undefined;
    const text: string[] = [];
    const errors: string[] = [];
    const raw: string[] = [];

    for (const line of result.stdout.split("\n")) {
        if (!line.trim()) continue;
        try {
            const event = JSON.parse(line);
            if (typeof event.sessionID === "string") sessionId = event.sessionID;
            if (event.type === "text" && typeof event.part?.text === "string") text.push(event.part.text);
            if (event.type === "step_finish") {
                usage = {
                    tokens: event.part?.tokens,
                    cost: event.part?.cost,
                    reason: event.part?.reason,
                };
            }
            if (event.type === "error") errors.push(JSON.stringify(event));
        } catch {
            raw.push(line);
        }
    }

    const summary = text.join("\n").trim() || raw.join("\n").trim();
    const status = result.timedOut
        ? "timed_out"
        : result.outputExceeded
            ? "output_limit_exceeded"
            : result.exitCode === 0 ? "completed" : "failed";
    return {
        status,
        sessionId,
        cwd,
        exitCode: result.exitCode,
        signal: result.signal,
        summary: truncate(summary, MAX_RESULT_LENGTH),
        usage,
        errors: errors.length ? errors : undefined,
        stderr: result.stderr.trim() ? truncate(result.stderr.trim(), 10_000) : undefined,
    };
}

function truncate(value: string, maxLength: number): string {
    return value.length <= maxLength ? value : `${value.slice(0, maxLength)}\n[output truncated]`;
}

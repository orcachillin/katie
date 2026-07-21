import { exec } from "node:child_process";

export function execAsync(command: string, timeout: number = 30_000): Promise<string> {
    return new Promise((resolve) => {
        exec(command, { maxBuffer: 10 * 1024 * 1024, timeout }, (error, stdout, stderr) => {
            if (error) {
                const msg = stderr || error.message;
                const code = error.code ?? "unknown";
                resolve(`exit code ${code}: ${msg}`);
            } else {
                resolve(stdout);
            }
        });
    });
}
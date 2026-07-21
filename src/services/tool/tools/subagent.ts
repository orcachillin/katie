import Core from "../../../core.js";
import type { ChatMessage } from "../../agent/agentService.js";
import type { Tool, ToolContext } from "../toolService.js";

export const subagent = {
    type: "function",
    function: {
        name: "subagent",
        description: "spawn a sub-agent to handle a complex subtask independently. the sub-agent has access to all the same tools and can work through multi-step problems, reporting back the result.",
        parameters: {
            type: "object",
            properties: {
                task: { type: "string", description: "the task description for the sub-agent" },
            },
            required: ["task"],
        },
        execute: async (args: Record<string, unknown>, ctx: ToolContext) => {
            const task = args.task as string;

            const messages: ChatMessage[] = [
                {
                    role: "system",
                    content: "you are a sub-agent working on a delegated task. you have the same capabilities as the primary agent. work through the task step by step using the available tools, then report your findings. be thorough.",
                },
                { role: "user", content: task },
            ];

            const toolDefs = Core.services.tool.definitions.filter(t => t.function.name !== "subagent");

            let loop = 0;
            const maxLoops = 15;
            let finalContent = "";

            while (loop < maxLoops) {
                loop++;
                const response = await Core.services.agent.chat(messages, { tools: toolDefs });

                const raw: any = { role: "assistant", content: response.content };
                if (response.toolCalls?.length) {
                    raw.tool_calls = response.toolCalls.map(tc => ({
                        id: tc.id,
                        type: "function",
                        function: { name: tc.name, arguments: tc.arguments },
                    }));
                }
                messages.push(raw);

                if (response.content) {
                    finalContent = response.content;
                }

                if (!response.toolCalls?.length) break;

                for (const tc of response.toolCalls) {
                    const result = await Core.services.tool.execute(tc.name, JSON.parse(tc.arguments), ctx);
                    messages.push({
                        role: "tool",
                        tool_call_id: tc.id,
                        content: result,
                    });
                }
            }

            return finalContent || "sub-agent completed with no output";
        },
    },
} satisfies Tool;
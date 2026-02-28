export interface Message {
	role: "user" | "assistant" | "system";
	content: string;
}

export interface PlanStep {
	id: string;
	description: string;
	type: "fetch" | "analyze" | "summarize" | "wait";
	url?: string; // for fetch steps
	status: "pending" | "approved" | "running" | "done" | "failed" | "cancelled";
	result?: string;
}

export interface PlannerResponse {
	reply: string;
	steps: PlanStep[];
	needsApproval: boolean;
}

const SYSTEM_PROMPT = `You are an autonomous AI agent. Users give you goals and you help plan and execute them step by step.

When a user gives you a goal that requires taking actions (fetching URLs, monitoring websites, analyzing data, etc.), respond with a JSON block containing your plan.

If the user is just chatting or asking a question, respond normally without a JSON block.

When you need to take actions, include a JSON block at the END of your reply in this exact format:
<plan>
{
  "steps": [
    { "id": "1", "type": "fetch", "description": "Fetch the webpage at example.com", "url": "https://example.com" },
    { "id": "2", "type": "analyze", "description": "Analyze the response for errors" },
    { "id": "3", "type": "summarize", "description": "Summarize findings and alert if issues found" }
  ],
  "needsApproval": true
}
</plan>

Step types:
- "fetch": retrieve a URL (include "url" field)
- "analyze": analyze data from a previous step
- "summarize": summarize and produce final output
- "wait": pause execution (for scheduled/periodic tasks)

Always set needsApproval to true so the user can review the plan before execution.
Keep steps concrete and minimal. Max 5 steps per plan.`;

export async function runPlanner(
	ai: Ai,
	messages: Message[],
	userMessage: string
): Promise<PlannerResponse> {
	const fullMessages: Message[] = [
		{ role: "system", content: SYSTEM_PROMPT },
		...messages,
		{ role: "user", content: userMessage },
	];

	const response = await ai.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
		messages: fullMessages,
	} as any);

	const text = (response as any).response as string;

	// Parse out the <plan> block if present
	const planMatch = text.match(/<plan>([\s\S]*?)<\/plan>/);
	let steps: PlanStep[] = [];
	let needsApproval = false;
	let reply = text;

	if (planMatch) {
		try {
			const parsed = JSON.parse(planMatch[1].trim());
			steps = parsed.steps ?? [];
			needsApproval = parsed.needsApproval ?? true;
			// Remove the plan block from the visible reply
			reply = text.replace(/<plan>[\s\S]*?<\/plan>/, "").trim();
		} catch {
			// If JSON parsing fails, treat it as a normal reply
		}
	}

	return { reply, steps, needsApproval };
}

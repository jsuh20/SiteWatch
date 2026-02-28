import type { CheckResult } from "../health/checker";

export interface IncidentDecision {
	severity: "low" | "medium" | "high";
	decision: "noop" | "retry" | "escalate";
	reason: string;
	actions: Array<{ type: string; args?: Record<string, any> }>;
}

const SYSTEM_PROMPT = `You are an incident response planner for a website monitoring system.
You receive health check results and decide how to respond.
Respond ONLY with valid JSON — no explanation, no markdown, just the JSON object:
{ "severity": "low|medium|high", "decision": "noop|retry|escalate", "reason": "...", "actions": [{ "type": "notify", "args": { "message": "..." } }] }

Rules:
- noop: all checks healthy (2xx responses, low latency)
- retry: some failures but below threshold — keep watching
- escalate: failures at or above threshold — alert immediately
- Only include actions when decision is escalate`;

export async function runPlanner(
	ai: Ai,
	recentChecks: CheckResult[],
	failureThreshold: number
): Promise<IncidentDecision> {
	const failures = recentChecks.filter(
		(c) => c.status === 0 || c.status >= 400
	);

	// Fast path: no failures, skip LLM call
	if (failures.length === 0) {
		return { severity: "low", decision: "noop", reason: "All checks healthy", actions: [] };
	}

	const userPrompt = `Health checks (last ${recentChecks.length}):
${JSON.stringify(recentChecks, null, 2)}

Failure threshold: ${failureThreshold}
Failures detected: ${failures.length}/${recentChecks.length}`;

	try {
		const response = await ai.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
			messages: [
				{ role: "system", content: SYSTEM_PROMPT },
				{ role: "user", content: userPrompt },
			],
		} as any);

		const text = (response as any).response as string;
		const match = text.match(/\{[\s\S]*\}/);
		if (match) return JSON.parse(match[0]) as IncidentDecision;
	} catch (err) {
		console.error("AI planner error:", err);
	}

	// Fallback if AI unavailable or JSON parse fails
	const escalate = failures.length >= failureThreshold;
	return {
		severity: escalate ? "high" : "medium",
		decision: escalate ? "escalate" : "retry",
		reason: `${failures.length}/${recentChecks.length} checks failed (threshold: ${failureThreshold})`,
		actions: escalate
			? [{ type: "notify", args: { message: `ALERT: ${failures.length} failures detected` } }]
			: [],
	};
}

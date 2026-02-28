import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from "cloudflare:workers";
import { AgentDO } from "./do/AgentDO";
import { checkEndpoint } from "./health/checker";
import { runPlanner } from "./agent/planner";
import { executeActions } from "./actions/runner";

// Re-export so wrangler can find these classes
export { AgentDO };

// ─── Workflow ─────────────────────────────────────────────────────────────────
// Runs the check loop for a single monitor: fetch → decide → act → sleep → repeat

interface WorkflowParams {
	userId: string;
	monitorId: string;
}

export class MonitorWorkflow extends WorkflowEntrypoint<Env, WorkflowParams> {
	async run(event: WorkflowEvent<WorkflowParams>, step: WorkflowStep) {
		const { userId, monitorId } = event.payload;

		const getAgent = () => {
			const id = this.env.AGENT_DO.idFromName(userId);
			return this.env.AGENT_DO.get(id);
		};

		// Run up to 100 check rounds — with 30s intervals that's ~50 minutes
		// For longer monitoring, restart the workflow via a new /api/monitor call
		for (let round = 0; round < 100; round++) {
			// 1. Get current monitor config (may have been deactivated)
			const config = await step.do(`get-config-${round}`, async () => {
				return getAgent().getMonitor(monitorId);
			});

			if (!config || !config.active) break;

			// 2. Run 3 health checks
			const checks = await step.do(`checks-${round}`, {
				retries: { limit: 2, delay: "3 seconds" },
			}, async () => {
				const results = [];
				for (let i = 0; i < 3; i++) {
					results.push(await checkEndpoint(config.url));
				}
				return results;
			});

			// 3. Ask the AI planner what to do
			const decision = await step.do(`plan-${round}`, async () => {
				return runPlanner(this.env.AI, checks, config.failure_threshold);
			});

			// 4. Record result in DO + execute any actions
			await step.do(`act-${round}`, async () => {
				const agent = getAgent();
				await agent.recordChecks(monitorId, checks, decision);
				await executeActions(
					decision,
					(entry) => agent.addAuditLog(entry),
					false
				);
			});

			// 5. Sleep before next round
			if (round < 99) {
				await step.sleep(`wait-${round}`, `${config.interval_seconds} seconds`);
			}
		}
	}
}

// ─── Worker ───────────────────────────────────────────────────────────────────

const getAgent = (env: Env, userId: string) => {
	const id = env.AGENT_DO.idFromName(userId);
	return env.AGENT_DO.get(id);
};

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		// POST /api/monitor — register a URL to watch
		if (url.pathname === "/api/monitor" && request.method === "POST") {
			const body = await request.json<{
				userId: string;
				url: string;
				interval_seconds: number;
				failure_threshold: number;
			}>();
			if (!body.userId || !body.url) {
				return Response.json({ error: "userId and url are required" }, { status: 400 });
			}
			const monitorId = crypto.randomUUID();
			const monitor = await getAgent(env, body.userId).createMonitor({
				monitorId,
				userId: body.userId,
				url: body.url,
				interval_seconds: body.interval_seconds ?? 30,
				failure_threshold: body.failure_threshold ?? 2,
			});
			await env.WORKFLOW.create({ params: { userId: body.userId, monitorId } });
			return Response.json({ monitorId, status: "created", monitor });
		}

		// DELETE /api/monitor — stop a monitor
		if (url.pathname === "/api/monitor" && request.method === "DELETE") {
			const { userId, monitorId } = await request.json<{ userId: string; monitorId: string }>();
			await getAgent(env, userId).deactivateMonitor(monitorId);
			return Response.json({ ok: true });
		}

		// GET /api/monitors?userId=... — list all monitors
		if (url.pathname === "/api/monitors" && request.method === "GET") {
			const userId = url.searchParams.get("userId") ?? "default";
			const monitors = await getAgent(env, userId).listMonitors();
			return Response.json(monitors);
		}

		// POST /api/resolve — manually resolve an incident
		if (url.pathname === "/api/resolve" && request.method === "POST") {
			const { userId, incidentId } = await request.json<{ userId: string; incidentId: string }>();
			await getAgent(env, userId).resolveIncident(incidentId);
			return Response.json({ ok: true });
		}

		// GET /api/state?userId=... — full debug state (monitors + incidents + audit log)
		if (url.pathname === "/api/state" && request.method === "GET") {
			const userId = url.searchParams.get("userId") ?? "default";
			const state = await getAgent(env, userId).getDebugState();
			return Response.json(state);
		}

		// Serve the UI
		return env.ASSETS.fetch(request);
	},
} satisfies ExportedHandler<Env>;

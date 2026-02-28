import type { IncidentDecision } from "../agent/planner";

export async function executeActions(
	decision: IncidentDecision,
	auditLog: (entry: string) => Promise<void>,
	dryRun = false
): Promise<void> {
	const prefix = dryRun ? "[DRY RUN] " : "";

	for (const action of decision.actions) {
		if (action.type === "notify") {
			const msg = action.args?.message ?? "Incident detected";
			await auditLog(`${prefix}NOTIFY: ${msg}`);
			// Production: swap this for a real Slack/PagerDuty POST
			console.log(`${prefix}NOTIFY:`, msg);
		} else {
			await auditLog(`${prefix}UNKNOWN ACTION: ${action.type}`);
		}
	}
}

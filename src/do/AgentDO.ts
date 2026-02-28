import { DurableObject } from "cloudflare:workers";
import type { CheckResult } from "../health/checker";
import type { IncidentDecision } from "../agent/planner";

export interface MonitorConfig {
	monitorId: string;
	userId: string;
	url: string;
	interval_seconds: number;
	failure_threshold: number;
	active: boolean;
	createdAt: string;
}

export interface Incident {
	id: string;
	monitorId: string;
	url: string;
	status: "NEW" | "INVESTIGATING" | "ESCALATED" | "RESOLVED";
	severity: IncidentDecision["severity"];
	decisions: IncidentDecision[];
	recentChecks: CheckResult[];
	createdAt: string;
	updatedAt: string;
}

interface DOState {
	monitors: Record<string, MonitorConfig>;
	incidents: Record<string, Incident>;
	auditLog: string[];
}

export class AgentDO extends DurableObject<Env> {
	private state: DOState = { monitors: {}, incidents: {}, auditLog: [] };

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.ctx.blockConcurrencyWhile(async () => {
			const stored = await this.ctx.storage.get<DOState>("state");
			if (stored) this.state = stored;
		});
	}

	private async persist() {
		await this.ctx.storage.put("state", this.state);
	}

	async createMonitor(config: Omit<MonitorConfig, "active" | "createdAt">): Promise<MonitorConfig> {
		const monitor: MonitorConfig = {
			...config,
			active: true,
			createdAt: new Date().toISOString(),
		};
		this.state.monitors[config.monitorId] = monitor;
		await this.persist();
		return monitor;
	}

	async getMonitor(monitorId: string): Promise<MonitorConfig | null> {
		return this.state.monitors[monitorId] ?? null;
	}

	async listMonitors(): Promise<MonitorConfig[]> {
		return Object.values(this.state.monitors);
	}

	async deactivateMonitor(monitorId: string): Promise<void> {
		const monitor = this.state.monitors[monitorId];
		if (monitor) {
			monitor.active = false;
			await this.persist();
		}
	}

	// Called by the Workflow each check round — updates or creates an incident
	async recordChecks(
		monitorId: string,
		checks: CheckResult[],
		decision: IncidentDecision
	): Promise<Incident | null> {
		const monitor = this.state.monitors[monitorId];
		if (!monitor) return null;

		// Find an open incident for this monitor
		let incident = Object.values(this.state.incidents).find(
			(i) => i.monitorId === monitorId && i.status !== "RESOLVED"
		);

		if (decision.decision === "noop") {
			// Healthy — resolve any open incident
			if (incident) {
				incident.status = "RESOLVED";
				incident.updatedAt = new Date().toISOString();
				await this.persist();
			}
			return incident ?? null;
		}

		// Create incident if none open
		if (!incident) {
			incident = {
				id: crypto.randomUUID(),
				monitorId,
				url: monitor.url,
				status: "NEW",
				severity: decision.severity,
				decisions: [],
				recentChecks: [],
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};
			this.state.incidents[incident.id] = incident;
		}

		incident.status = decision.decision === "escalate" ? "ESCALATED" : "INVESTIGATING";
		incident.severity = decision.severity;
		incident.decisions.push(decision);
		incident.recentChecks = checks;
		incident.updatedAt = new Date().toISOString();

		await this.persist();
		return incident;
	}

	async resolveIncident(incidentId: string): Promise<void> {
		const incident = this.state.incidents[incidentId];
		if (incident) {
			incident.status = "RESOLVED";
			incident.updatedAt = new Date().toISOString();
			await this.persist();
		}
	}

	async addAuditLog(entry: string): Promise<void> {
		this.state.auditLog.push(`[${new Date().toISOString()}] ${entry}`);
		if (this.state.auditLog.length > 200) {
			this.state.auditLog = this.state.auditLog.slice(-200);
		}
		await this.persist();
	}

	async getDebugState(): Promise<DOState> {
		return this.state;
	}
}

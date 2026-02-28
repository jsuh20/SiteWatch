export interface CheckResult {
	timestamp: string;
	status: number;
	latency_ms: number;
	error?: string;
}

export async function checkEndpoint(url: string): Promise<CheckResult> {
	const start = Date.now();
	try {
		const res = await fetch(url, { cf: { scrapeShield: false } } as RequestInit);
		return {
			timestamp: new Date().toISOString(),
			status: res.status,
			latency_ms: Date.now() - start,
		};
	} catch (e: any) {
		return {
			timestamp: new Date().toISOString(),
			status: 0,
			latency_ms: Date.now() - start,
			error: e?.message ?? "fetch failed",
		};
	}
}

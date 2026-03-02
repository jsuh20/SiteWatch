SiteWatch is an AI-powered website monitoring agent built on Cloudflare's edge infrastructure. You register any URL and SiteWatch continuously checks it in the background — no servers to manage, no polling from your laptop. When failures are detected, a Llama 3.3 70B model running at the edge analyzes the pattern of health checks and acts as an incident response planner, classifying severity as low, medium, or high and deciding whether to watch and retry or escalate immediately. Incident state is persisted across sessions using Durable Objects with SQLite-backed storage, tracking each monitor through a full lifecycle from NEW to INVESTIGATING to ESCALATED to RESOLVED. The check loop is orchestrated by Cloudflare Workflows, which handle automatic retries, sleeping between rounds, and surviving failures without losing progress. A live dashboard lets you add monitors, watch incidents update in real time, and manually resolve incidents when the issue is fixed.

<img width="1325" height="694" alt="Screenshot 2026-03-02 at 10 39 10 AM" src="https://github.com/user-attachments/assets/0a67abb1-3025-43e9-8b8b-717370243483" />
Chat interface and text fields to enter input url


<img width="1330" height="592" alt="Screenshot 2026-03-02 at 10 39 18 AM" src="https://github.com/user-attachments/assets/e67fea35-2a96-4559-84c8-5df62e8901e2" />

Sample URL that intentionally returns a 500 and logs an incident on the website

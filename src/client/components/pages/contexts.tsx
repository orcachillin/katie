import Core from "../../../core.js";

export const route = "/contexts";

export async function get() {
	const contexts = Core.services.bot.getContexts();
	const channelIds = Object.keys(contexts);

	return (
		<div id="contexts-content" hx-ext="sse" sse-connect="/events/contexts" sse-swap="contextUpdate">
			<h2 class="mb-4">contexts</h2>
			{channelIds.length === 0 ? (
				<p class="text-secondary">no contexts yet</p>
			) : (
				channelIds.map(id => {
					const messages = contexts[id];
					return (
						<div class="card mb-4">
							<div class="card-body">
								<div class="d-flex align-items-center gap-2 mb-2">
									<h5 class="card-title mb-0 text-break">{id}</h5>
									<span class="badge bg-secondary rounded-pill">{messages.length}</span>
								</div>
								<div class="table-responsive">
									<table class="table table-dark table-sm mb-0" style="font-size:0.875rem">
										<tbody>
											{messages.map(m => (
												<tr>
													<td class="fw-semibold text-secondary" style="width:90px;vertical-align:top;white-space:nowrap">
														{m.role}
														{m.tool_call_id ? <span class="d-block fw-normal text-muted" style="font-size:0.75rem;word-break:break-all">{m.tool_call_id}</span> : ""}
													</td>
													<td class="font-monospace text-break" style="white-space:pre-wrap;font-size:0.8125rem">
														{(m.content ?? "").slice(0, 500) || <span class="text-secondary">(empty)</span>}
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							</div>
						</div>
					);
				})
			)}
		</div>
	);
}
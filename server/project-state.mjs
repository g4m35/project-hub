// Shared by the cloud and preserved local app; callers save the whole state atomically.
export function linkRepository(state, projectId, fresh) {
  const fail = (status, message) => {
    throw Object.assign(new Error(message), { status });
  };
  const project = state.projects.find((p) => p.id === projectId);
  if (!project) fail(404, "Project not found.");
  if (!fresh.repo) fail(400, "Choose a GitHub repository.");
  const repo = fresh.repo.toLowerCase();
  if (project.repo && project.repo.toLowerCase() !== repo)
    fail(
      409,
      "This project already has a repository. Its connection was kept.",
    );
  const duplicate = state.projects.find(
    (p) => p.id !== projectId && p.repo?.toLowerCase() === repo,
  );
  if (duplicate)
    fail(
      409,
      "This repository is already linked to " +
        duplicate.name +
        ". Choose another repository.",
    );
  // A partial remote scan must not discard services imported from the Mac.
  const stack = [
    ...fresh.stack,
    ...(project.stack || []).filter(
      (node) => !fresh.stack.some((freshNode) => freshNode.name === node.name),
    ),
  ];
  Object.assign(project, {
    repo: fresh.repo,
    stack,
    scannedAt: fresh.scannedAt,
    modifiedAt: fresh.modifiedAt,
  });
  return project;
}

export function summarizeWorkflowRuns(
  defaultBranch,
  runs,
  activeWorkflowIds = null,
  workflowListComplete = true,
) {
  const latest = new Map();
  const relevant = runs
    .filter(
      (run) =>
        (activeWorkflowIds === null ||
          activeWorkflowIds.includes(run.workflow_id)) &&
        run.head_branch === defaultBranch &&
        run.event !== "pull_request" &&
        run.event !== "pull_request_target",
    )
    .sort(
      (a, b) =>
        new Date(b.created_at) - new Date(a.created_at) ||
        Number(b.id) - Number(a.id),
    );
  for (const run of relevant) {
    const key = run.workflow_id || run.path || run.name;
    if (!latest.has(key)) latest.set(key, run);
  }
  const normalized = [...latest.values()].map((run) => ({
    id: run.id,
    title: run.name,
    state: run.conclusion || run.status,
    branch: run.head_branch,
    url: run.html_url,
    createdAt: run.created_at,
  }));
  const failed = normalized.filter((run) =>
    ["failure", "timed_out", "action_required", "startup_failure"].includes(
      run.state,
    ),
  );
  const running = normalized.some((run) =>
    ["in_progress", "queued", "waiting", "pending", "requested"].includes(
      run.state,
    ),
  );
  const coverageComplete =
    workflowListComplete &&
    (activeWorkflowIds === null ||
      activeWorkflowIds.every((id) => latest.has(id)));
  const passed =
    coverageComplete &&
    normalized.length > 0 &&
    normalized.every((run) => run.state === "success");
  return {
    status: "connected",
    coverageComplete,
    branch: defaultBranch,
    runs: normalized,
    tone: failed.length
      ? "bad"
      : running
        ? "neutral"
        : passed
          ? "good"
          : "neutral",
    label: failed.length
      ? "Build needs attention"
      : running
        ? "Builds running"
        : passed
          ? "Recent builds passed"
          : !coverageComplete
            ? "Build coverage incomplete"
            : normalized.length
              ? "Review build results"
              : "No recent builds",
    syncedAt: new Date().toISOString(),
  };
}

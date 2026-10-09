// A manual release still needs evidence for the exact commit being deployed.
module.exports = async function requireCi({ github, context }) {
  const runs = await github.paginate(github.rest.actions.listWorkflowRuns, {
    ...context.repo,
    workflow_id: 'ci.yml',
    head_sha: context.sha,
    branch: 'main',
    event: 'push',
    per_page: 100,
  });
  const latest = runs
    .filter(run => run.head_sha === context.sha && run.head_branch === 'main' && run.event === 'push')
    .sort((a, b) => b.run_number - a.run_number)[0];
  if (!latest || latest.status !== 'completed' || latest.conclusion !== 'success') {
    throw new Error(`Release blocked: ${context.sha} needs a completed, successful CI push run on main. ${latest?.html_url || 'No matching run exists yet.'}`);
  }
  return latest.html_url;
};

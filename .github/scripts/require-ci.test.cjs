const { test } = require('node:test');
const assert = require('node:assert/strict');
const requireCi = require('./require-ci.cjs');

const context = { repo: { owner: 'owner', repo: 'app' }, sha: 'release-sha' };
const green = {
  head_sha: context.sha, head_branch: 'main', event: 'push', run_number: 12,
  status: 'completed', conclusion: 'success', html_url: 'https://example.test/runs/12',
};
function check(runs) {
  const endpoint = () => {};
  return requireCi({
    context,
    github: {
      rest: { actions: { listWorkflowRuns: endpoint } },
      paginate: async (method, options) => {
        assert.equal(method, endpoint);
        assert.deepEqual(options, {
          ...context.repo, workflow_id: 'ci.yml', head_sha: context.sha,
          branch: 'main', event: 'push', per_page: 100,
        });
        return runs;
      },
    },
  });
}

test('releases the commit whose main push CI passed', async () => {
  assert.equal(await check([green]), green.html_url);
});

for (const [name, runs] of [
  ['no evidence', []],
  ['another commit', [{ ...green, head_sha: 'old-sha' }]],
  ['another branch', [{ ...green, head_branch: 'feature' }]],
  ['a pull request run', [{ ...green, event: 'pull_request' }]],
  ['still running', [{ ...green, status: 'in_progress', conclusion: null }]],
  ['failed', [{ ...green, conclusion: 'failure' }]],
  ['cancelled', [{ ...green, conclusion: 'cancelled' }]],
  ['skipped', [{ ...green, conclusion: 'skipped' }]],
  ['newer failed run despite an older pass', [green, { ...green, run_number: 13, conclusion: 'failure' }]],
]) {
  test(`refuses ${name}`, async () => {
    await assert.rejects(check(runs), /Release blocked/);
  });
}

test('an unavailable CI API cannot grant a release', async () => {
  await assert.rejects(requireCi({
    context,
    github: { rest: { actions: {} }, paginate: async () => { throw new Error('unavailable'); } },
  }), /unavailable/);
});

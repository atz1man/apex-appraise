import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../../../infra/restore-check.sh', import.meta.url));
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
// Real runbook control flow, isolated fake PostgreSQL/container boundaries.
function run(mode: string, managed: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'restore-cleanup-')); roots.push(root);
  const bin = join(root, 'bin'), backups = join(root, 'backup files');
  mkdirSync(bin); mkdirSync(backups);
  writeFileSync(join(backups, 'apex-fixture.dump'), 'fixture');
  writeFileSync(join(root, 'calls'), '');
  const executable = (name: string, body: string) => writeFileSync(join(bin, name), '#!/bin/bash\nset -eu\n' + body, { mode: 0o755 });
  executable('stat', 'date +%s\n');
  executable('psql', `
printf '%s\\n' "$*" >> "$FIXTURE_ROOT/calls"
case "$*" in
 *'CREATE DATABASE'*) [ "$FIXTURE_MODE" != collision ] ;;
 *'DROP DATABASE'*) [ "$FIXTURE_MODE" != cleanupfailed ] && [ "$FIXTURE_MODE" != bothfailed ] ;;
 *'Organisation'*) echo 1 ;;
 *'Deal'*) echo 2 ;;
 *'information_schema'*) echo 3 ;;
 *) exit 91 ;;
esac
`);
  executable('pg_restore', `printf 'RESTORE\\n' >> "$FIXTURE_ROOT/calls"
if [ "$FIXTURE_MODE" = interrupted ]; then kill -TERM "$PPID"; exit 1; fi
[ "$FIXTURE_MODE" != restorefailed ] && [ "$FIXTURE_MODE" != bothfailed ]
`);
  executable('docker', `
case "$*" in
 'compose config --quiet') exit 0 ;;
 'compose exec -T db '*) shift 4; exec "$@" ;;
 *) exit 92 ;;
esac
`);
  const result = spawnSync('bash', [script, backups], {
    cwd: root, encoding: 'utf8', timeout: 10_000,
    env: { PATH: `${bin}:/usr/bin:/bin`, FIXTURE_ROOT: root, FIXTURE_MODE: mode,
      ...(managed ? { BACKUP_DB_URL: 'postgresql://fixture.invalid/apex?sslmode=require' } : {}) },
  });
  expect(result.error).toBeUndefined();
  return { ...result, calls: readFileSync(join(root, 'calls'), 'utf8') };
}

describe.each([true, false])('restore cleanup (managed=%s)', managed => {
  it('reports success only after removing its own scratch database', () => {
    const result = run('ok', managed);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('PASS');
    const actions = result.calls.split('\n').filter(line => /CREATE DATABASE|DROP DATABASE|RESTORE/.test(line));
    expect(actions).toHaveLength(3);
    expect(actions[0]).toContain('CREATE DATABASE');
    expect(actions[1]).toBe('RESTORE');
    expect(actions[2]).toContain('DROP DATABASE');
    if (managed) expect(actions[2]).toContain('?sslmode=require');
  });
  it('refuses an existing scratch name without dropping or restoring into it', () => {
    const result = run('collision', managed);
    expect(result.status).not.toBe(0);
    expect(result.calls).not.toContain('DROP DATABASE');
    expect(result.calls).not.toContain('RESTORE');
    expect(result.stdout).not.toContain('PASS');
  });
  it('fails visibly instead of reporting PASS when scratch cleanup fails', () => {
    const result = run('cleanupfailed', managed);
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain('PASS');
    expect(result.stderr).toContain('scratch database');
    expect(result.stderr).toContain('apex_restore_check_');
  });
  it('removes its scratch database after a failed restore', () => {
    const result = run('restorefailed', managed);
    expect(result.status).not.toBe(0);
    expect(result.calls).toContain('DROP DATABASE');
    expect(result.stderr).toContain('did not restore');
    expect(result.stdout).not.toContain('PASS');
  });
  it('cleans up after termination during restore', () => {
    const result = run('interrupted', managed);
    expect(result.status).toBe(143);
    expect(result.calls).toContain('DROP DATABASE');
    expect(result.stdout).not.toContain('PASS');
  });
  it('reports both restore and cleanup failures', () => {
    const result = run('bothfailed', managed);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('did not restore');
    expect(result.stderr).toContain('scratch database');
    expect(result.stdout).not.toContain('PASS');
  });
});

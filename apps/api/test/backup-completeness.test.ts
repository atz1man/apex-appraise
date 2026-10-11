import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Execute the actual runbook script with isolated storage and fake database /
// container boundaries. tar is real: malformed upload archives must be refused.
const script = fileURLToPath(new URL('../../../infra/backup.sh', import.meta.url));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function run(mode = 'ok', keep = '1', offsiteFails = false, options: { managed?: boolean; partials?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'apex-backup-')); roots.push(root);
  const bin = join(root, 'bin'), backups = join(root, 'backup files');
  mkdirSync(bin); mkdirSync(backups); mkdirSync(join(root, 'uploads'));
  writeFileSync(join(root, 'uploads', 'evidence.txt'), 'customer evidence');
  for (const name of ['apex-old.dump', 'uploads-old.tar.gz']) {
    writeFileSync(join(backups, name), 'previous recovery material');
    utimesSync(join(backups, name), 1, 1);
  }
  if (options.partials) {
    for (const name of ['apex-partial1.dump', 'apex-partial2.dump']) {
      writeFileSync(join(backups, name), 'database-only recovery material');
      utimesSync(join(backups, name), 2, 2);
    }
  }
  const executable = (name: string, body: string) => writeFileSync(join(bin, name), '#!/bin/bash\nset -eu\n' + body, { mode: 0o755 });
  executable('pg_dump', '[ "$FIXTURE_MODE" != dumpfailed ] || exit 1\nprintf "fixture database archive"\n');
  executable('pg_restore', '[ "$FIXTURE_MODE" != wronghostversion ] || exit 1\n[ "$FIXTURE_MODE" != invaliddump ] || exit 1\nprintf "TABLE DATA public Organisation\\n"\n');
  executable('docker', `
case "$*" in
  'compose config --quiet') [ "$FIXTURE_MODE" != configfailed ]; exit $? ;;
  'compose exec -T db pg_restore --list') [ "$FIXTURE_MODE" != invaliddump ] || exit 1; cat >/dev/null; printf 'TABLE DATA public Organisation'; exit 0 ;;
  'compose exec -T db pg_dump '*) [ "$FIXTURE_MODE" != dumpfailed ] || exit 1; printf 'fixture database archive'; exit 0 ;;
  'compose ps -q api') [ "$FIXTURE_MODE" != stopped ] && echo container; exit 0 ;;
  'compose exec -T api tar '*)
    case "$FIXTURE_MODE" in
      failed) printf partial; exit 1 ;;
      invalid) printf not-an-archive; exit 0 ;;
      *) tar -czf - -C "$FIXTURE_ROOT" uploads ;;
    esac ;;
  *) echo 'unexpected container operation' >&2; exit 90 ;;
esac
`);
  executable('offsite', 'printf "%s\\n" "$1" >> "$FIXTURE_ROOT/offsite.log"\n[ "$OFFSITE_FAILS" != 1 ]\n');
  const result = spawnSync('bash', [script, backups], {
    cwd: root, encoding: 'utf8', timeout: 10_000,
    env: { PATH: `${bin}:/usr/bin:/bin`, BACKUP_KEEP: keep, BACKUP_UPLOAD_CMD: 'offsite "$1"', FIXTURE_MODE: mode, FIXTURE_ROOT: root, OFFSITE_FAILS: offsiteFails ? '1' : '0', ...(options.managed ? { BACKUP_DB_URL: 'postgresql://fixture.invalid/apex' } : {}) },
  });
  expect(result.error).toBeUndefined();
  return { result, backups, root, files: readdirSync(backups) };
}

describe('backup completion and retention', () => {
  it.each(['stopped', 'failed', 'invalid'])('fails closed when uploaded documents are %s', mode => {
    const { result, backups, root, files } = run(mode);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('backup is incomplete');
    expect(result.stdout).not.toContain('done —');
    expect(files).toContain('apex-old.dump');
    expect(files).toContain('uploads-old.tar.gz');
    expect(files.filter(f => f.endsWith('.dump'))).toHaveLength(2);
    expect(files.some(f => f.endsWith('.part'))).toBe(false);
    expect(readFileSync(join(backups, 'uploads-old.tar.gz'), 'utf8')).toBe('previous recovery material');
    // The new database copy is still useful and must reach offsite storage.
    const copied = readFileSync(join(root, 'offsite.log'), 'utf8').trim().split('\n');
    expect(copied).toHaveLength(1);
    expect(copied[0]).toMatch(/apex-\d{8}-\d{6}\.dump$/);
  });
  it('publishes both verified artifacts offsite before pruning an older pair', () => {
    const { result, root, backups, files } = run();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('done —');
    expect(files).toHaveLength(2);
    expect(readFileSync(join(backups, files.find(f => f.endsWith('.dump'))!), 'utf8')).toBe('fixture database archive');
    const extracted = spawnSync('tar', ['-xOzf', join(backups, files.find(f => f.endsWith('.tar.gz'))!), 'uploads/evidence.txt'], { encoding: 'utf8' });
    expect(extracted.status).toBe(0);
    expect(extracted.stdout).toBe('customer evidence');
    expect(files).not.toContain('apex-old.dump');
    expect(files).not.toContain('uploads-old.tar.gz');
    expect(readFileSync(join(root, 'offsite.log'), 'utf8').trim().split('\n')).toHaveLength(2);
  });
  it('retains previous recovery material when offsite delivery fails', () => {
    const { result, files } = run('ok', '1', true);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('offsite copy');
    expect(files).toContain('apex-old.dump');
    expect(files).toContain('uploads-old.tar.gz');
    expect(files).toHaveLength(4);
  });
  it('verifies a compose archive with its matching container tool despite an incompatible host verifier', () => {
    const { result } = run('wronghostversion');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('database backup verified');
  });
  it('does not let partial dumps displace an older complete recovery pair', () => {
    const { result, files } = run('ok', '2', false, { partials: true });
    expect(result.status).toBe(0);
    expect(files).toContain('apex-old.dump');
    expect(files).toContain('uploads-old.tar.gz');
    expect(files).toContain('apex-partial1.dump');
    expect(files).toContain('apex-partial2.dump');
    expect(files).toHaveLength(6);
  });
  it('reports incomplete managed-database backups when compose uploads are unavailable', () => {
    const { result, root, files } = run('stopped', '1', false, { managed: true });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('backup is incomplete');
    expect(files).toContain('apex-old.dump');
    expect(readFileSync(join(root, 'offsite.log'), 'utf8')).toContain('.dump');
  });
  it.each(['dumpfailed', 'invaliddump', 'configfailed'])('preserves prior backups when %s', mode => {
    const { result, files } = run(mode);
    expect(result.status).toBe(1);
    expect(files).toContain('apex-old.dump');
    expect(files).toContain('uploads-old.tar.gz');
    expect(files.filter(f => f.endsWith('.dump'))).toEqual(['apex-old.dump']);
    expect(files.filter(f => f.endsWith('.part'))).toHaveLength(mode === 'configfailed' ? 0 : 1);
  });
  it.each(['0', '-1', '1+1', '01', '1000000'])('rejects unsafe retention %s before touching backups', keep => {
    const { result, files } = run('ok', keep);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('BACKUP_KEEP');
    expect(files.sort()).toEqual(['apex-old.dump', 'uploads-old.tar.gz']);
  });
});

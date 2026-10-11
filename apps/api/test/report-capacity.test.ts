import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => vi.resetModules());
afterEach(() => vi.useRealTimers());
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const renderer = () => {
  const contexts: { close: ReturnType<typeof vi.fn> }[] = [];
  const browser = {
    newContext: vi.fn(async () => {
      const context = { close: vi.fn(async () => {}) };
      contexts.push(context);
      return context;
    }),
    close: vi.fn(async () => {}),
  };
  return { browser, contexts };
};

describe('bounded PDF rendering', () => {
  it('holds two contexts, refuses a third without opening one, then accepts after completion', async () => {
    const { withReportContext } = await import('../src/report-capacity.js');
    const { browser, contexts } = renderer();
    const a = deferred<string>();
    const b = deferred<string>();
    const first = withReportContext(browser as never, () => a.promise);
    const second = withReportContext(browser as never, () => b.promise);
    await expect(withReportContext(browser as never, async () => 'excess')).rejects.toThrow('busy');
    expect(browser.newContext).toHaveBeenCalledTimes(2);
    a.resolve('first');
    expect(await first).toBe('first');
    expect(contexts[0]!.close).toHaveBeenCalledOnce();
    expect(await withReportContext(browser as never, async () => 'replacement')).toBe('replacement');
    b.resolve('second');
    expect(await second).toBe('second');
  });
  it('closes and releases capacity after a printing failure', async () => {
    const { withReportContext } = await import('../src/report-capacity.js');
    const { browser, contexts } = renderer();
    await expect(
      withReportContext(browser as never, async () => {
        throw new Error('print failed');
      }),
    ).rejects.toThrow('print failed');
    expect(contexts[0]!.close).toHaveBeenCalledOnce();
    expect(await withReportContext(browser as never, async () => 'recovered')).toBe('recovered');
  });
  it('releases capacity if Chromium refuses to create a context', async () => {
    const { withReportContext } = await import('../src/report-capacity.js');
    const { browser } = renderer();
    browser.newContext.mockRejectedValueOnce(new Error('disconnected'));
    await expect(withReportContext(browser as never, async () => 'unused')).rejects.toThrow('disconnected');
    expect(await withReportContext(browser as never, async () => 'recovered')).toBe('recovered');
  });
  it('times out a stalled operation, closes its context and permits a later report', async () => {
    vi.useFakeTimers();
    const { withReportContext } = await import('../src/report-capacity.js');
    let interrupt!: (error: Error) => void;
    const context = {
      close: vi.fn(async () => {
        interrupt?.(new Error('page closed'));
      }),
    };
    const browser = { newContext: vi.fn(async () => context) };
    const job = withReportContext(
      browser as never,
      () =>
        new Promise((_, reject) => {
          interrupt = reject;
        }),
    );
    const failure = expect(job).rejects.toThrow('too long');
    await vi.advanceTimersByTimeAsync(60_000);
    await failure;
    expect(context.close).toHaveBeenCalled();
    expect(await withReportContext(browser as never, async () => 'recovered')).toBe('recovered');
  });
  it('does not print into a context that arrives after its deadline', async () => {
    vi.useFakeTimers();
    const { withReportContext } = await import('../src/report-capacity.js');
    const pending = deferred<{ close: ReturnType<typeof vi.fn> }>();
    const { browser } = renderer();
    browser.newContext.mockReturnValueOnce(pending.promise);
    const print = vi.fn(async () => 'late report');
    const job = withReportContext(browser as never, print);
    const failure = expect(job).rejects.toThrow('too long');
    await vi.advanceTimersByTimeAsync(60_000);
    await failure;
    const context = { close: vi.fn(async () => {}) };
    pending.resolve(context);
    await vi.advanceTimersByTimeAsync(0);
    expect(print).not.toHaveBeenCalled();
    expect(context.close).toHaveBeenCalledOnce();
    expect(await withReportContext(browser as never, async () => 'recovered')).toBe('recovered');
  });
  it('retires the renderer when a context cannot close', async () => {
    const { withReportContext } = await import('../src/report-capacity.js');
    const context = {
      close: vi.fn().mockRejectedValue(new Error('context stuck')),
    };
    const browser = {
      newContext: vi.fn(async () => context),
      close: vi.fn(async () => {}),
    };
    expect(await withReportContext(browser as never, async () => 'complete')).toBe('complete');
    expect(browser.close).toHaveBeenCalledOnce();
  });
});

describe('a renderer whose cleanup is also broken', () => {
  it('retains capacity when neither contexts nor their browser can close', async () => {
    const { withReportContext } = await import('../src/report-capacity.js');
    const context = {
      close: vi.fn().mockRejectedValue(new Error('context stuck')),
    };
    const browser = {
      newContext: vi.fn(async () => context),
      close: vi.fn().mockRejectedValue(new Error('browser stuck')),
    };
    for (let i = 0; i < 2; i++)
      await expect(withReportContext(browser as never, async () => 'result')).rejects.toThrow('browser stuck');
    await expect(withReportContext(browser as never, async () => 'replacement')).rejects.toThrow('busy');
    expect(browser.newContext).toHaveBeenCalledTimes(2);
  });
});

describe('availability under stalled or public jobs', () => {
  it('reclaims closed contexts even when application work never settles', async () => {
    vi.useFakeTimers();
    const { withReportContext } = await import('../src/report-capacity.js');
    const { browser, contexts } = renderer();
    const jobs = [0, 1].map(() => withReportContext(browser as never, () => new Promise(() => {})));
    const failures = jobs.map((job) => expect(job).rejects.toThrow('too long'));
    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.all(failures);
    expect(contexts.every((context) => context.close.mock.calls.length === 1)).toBe(true);
    expect(await withReportContext(browser as never, async () => 'available')).toBe('available');
  });
  it('reserves capacity for an internal download while a public share is rendering', async () => {
    const { withReportContext } = await import('../src/report-capacity.js');
    const { browser } = renderer();
    const pending = deferred<string>();
    const publicJob = withReportContext(browser as never, () => pending.promise, { publicShare: true });
    await expect(
      withReportContext(browser as never, async () => 'another public job', {
        publicShare: true,
      }),
    ).rejects.toThrow('busy');
    expect(await withReportContext(browser as never, async () => 'internal download')).toBe('internal download');
    pending.resolve('public PDF');
    expect(await publicJob).toBe('public PDF');
    expect(
      await withReportContext(browser as never, async () => 'next public PDF', {
        publicShare: true,
      }),
    ).toBe('next public PDF');
  });
});

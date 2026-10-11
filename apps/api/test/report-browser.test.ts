import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { launch } = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock('playwright', () => ({ chromium: { launch } }));
beforeEach(() => { vi.resetModules(); launch.mockReset(); });
describe('the PDF renderer lifecycle', () => {
  it('shares one Chromium launch between concurrent report requests', async () => {
    const browser = new EventEmitter();
    launch.mockResolvedValue(browser);
    const { getReportBrowser } = await import('../src/report-browser.js');
    expect(await Promise.all([getReportBrowser(), getReportBrowser()])).toEqual([browser, browser]);
    expect(launch).toHaveBeenCalledTimes(1);
  });
  it('launches a fresh renderer after Chromium disconnects', async () => {
    const first = new EventEmitter();
    const second = new EventEmitter();
    launch.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const { getReportBrowser } = await import('../src/report-browser.js');
    expect(await getReportBrowser()).toBe(first);
    first.emit('disconnected');
    expect(await getReportBrowser()).toBe(second);
    expect(launch).toHaveBeenCalledTimes(2);
  });
  it('can recover from a failed launch on the next request', async () => {
    const browser = new EventEmitter();
    launch.mockRejectedValueOnce(new Error('renderer unavailable')).mockResolvedValueOnce(browser);
    const { getReportBrowser } = await import('../src/report-browser.js');
    await expect(getReportBrowser()).rejects.toThrow('renderer unavailable');
    expect(await getReportBrowser()).toBe(browser);
  });
});

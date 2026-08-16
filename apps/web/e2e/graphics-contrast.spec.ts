import { expect, test, type Page } from '@playwright/test';

/**
 * Graphical-object contrast — the other half of WCAG 1.4.11. A data mark has to
 * be distinguishable from what it is drawn on (3:1), or the chart is decoration.
 *
 * Everything is measured by default. Structural parts — gridlines, axis rules,
 * the soft area wash under a line, the halo that separates a dot from the line
 * it sits on — carry `data-decorative` IN THE COMPONENT, so each exemption is
 * visible where someone would add the next mark, not buried in this file.
 *
 * Adjacent data series are also compared against each other: two series that
 * only differ by colour must differ by 3:1, or they are one shape to anyone who
 * cannot separate the hues.
 */

type Finding = {
  route: string;
  theme: string;
  kind: 'mark-vs-background' | 'series-vs-series';
  ratio: number;
  colour: string;
  against: string;
  where: string;
};

const AUDIT = `(() => {
  const parse = (s) => {
    if (!s || s === 'none') return null;
    const n = (s.match(/[\\d.]+/g) || []).map(Number);
    return n.length >= 3 ? { r: n[0], g: n[1], b: n[2], a: n.length > 3 ? n[3] : 1 } : null;
  };
  /** first colour token in a value — a box-shadow's offsets must not be read as alpha */
  const parseColour = (s) => {
    if (!s || s === 'none') return null;
    const m = String(s).match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const n = m[1].split(',').map((v) => Number(v.trim().replace('/', '')));
    return n.length >= 3 ? { r: n[0], g: n[1], b: n[2], a: n.length > 3 ? n[3] : 1 } : null;
  };
  const blend = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const lum = (c) => {
    const f = [c.r, c.g, c.b].map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  };
  const contrast = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  /** the opaque HTML background the chart is painted on */
  const canvasBehind = (el) => {
    const stack = [];
    for (let n = el.parentElement; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a >= 0.999) break; }
    }
    if (!stack.length || stack[stack.length - 1].a < 0.999) {
      const page = parse(getComputedStyle(document.body).backgroundColor);
      stack.push(page && page.a > 0 ? { ...page, a: 1 } : { r: 255, g: 255, b: 255, a: 1 });
    }
    let out = stack[stack.length - 1];
    for (let i = stack.length - 2; i >= 0; i--) out = blend(stack[i], out);
    return out;
  };

  /**
   * SVG shapes AND declared HTML marks. Much of this product's data graphics are
   * plain divs — programme bars, the Monte Carlo band, the variance strip — and
   * a sweep that only walked SVG was silently green on all of them.
   */
  const SHAPES = 'svg rect, svg circle, svg line, svg path, svg polyline, svg ellipse, svg polygon, [data-mark]';
  const out = [];
  let measured = 0;
  const seen = new Set();
  const series = new Map(); // colour -> a representative element, for series-vs-series

  for (const el of document.querySelectorAll(SHAPES)) {
    if (el.closest('[aria-hidden="true"]') || el.hasAttribute('data-decorative')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const box = el.getBoundingClientRect();
    // a hairline is still a mark; a zero-area node is not
    if (box.width < 1 && box.height < 1) continue;

    const bg = canvasBehind(el);
    if (!bg) continue;

    // a shape paints with its fill, or with its stroke when unfilled
    const isHtml = !(el.ownerSVGElement || el.tagName.toLowerCase() === 'svg');
    const fill = isHtml ? parse(cs.backgroundColor) : parse(cs.fill);
    const stroke = isHtml ? parse(cs.borderTopColor) : parse(cs.stroke);
    const groupOpacity = Number(cs.opacity);
    if (groupOpacity === 0) continue;
    const channels = [];
    if (fill && fill.a > 0) channels.push({ c: { ...fill, a: fill.a * Number(isHtml ? 1 : cs.fillOpacity || 1) * groupOpacity }, how: 'fill ' + (isHtml ? cs.backgroundColor : cs.fill) });
    if (stroke && stroke.a > 0 && parseFloat(isHtml ? cs.borderTopWidth : cs.strokeWidth) > 0) {
      channels.push({ c: { ...stroke, a: stroke.a * Number(cs.strokeOpacity || 1) * groupOpacity }, how: 'stroke ' + cs.stroke });
    }
    // an outline identifies a soft-filled band just as a strong fill would
    if (isHtml && cs.boxShadow && cs.boxShadow !== 'none') {
      const ring = parseColour(cs.boxShadow);
      if (ring && ring.a > 0) channels.push({ c: ring, how: 'ring ' + cs.boxShadow.slice(0, 40) });
    }
    if (!channels.length) continue;
    measured++;

    // A mark is visible if ANY of the ways it paints is visible: a dot with a
    // pale halo stroke and a saturated fill reads by its fill.
    let best = { ratio: 0, how: '', colour: '' };
    for (const ch of channels) {
      const solid = ch.c.a >= 0.999 ? ch.c : blend(ch.c, bg);
      const ratio = contrast(solid, bg);
      if (ratio > best.ratio) best = { ratio, how: ch.how, colour: 'rgb(' + [solid.r, solid.g, solid.b].map(Math.round).join(', ') + ')' };
    }
    if (best.ratio + 0.01 < 3) {
      const key = 'm|' + best.how + Math.round(best.ratio * 100);
      if (!seen.has(key)) {
        seen.add(key);
        out.push({
          kind: 'mark-vs-background',
          ratio: Math.round(best.ratio * 100) / 100,
          colour: best.colour,
          against: 'rgb(' + [bg.r, bg.g, bg.b].map(Math.round).join(', ') + ')',
          where: (el.getAttribute('data-mark') || el.tagName) + ' [' + best.how + '] in ' + (el.closest('[data-chart]')?.getAttribute('data-chart') || 'panel'),
        });
      }
    } else if (best.ratio >= 3 && el.hasAttribute('data-series')) {
      /**
       * Only DECLARED series take part in the separability check, and they are
       * bucketed by the owning <svg> ELEMENT.
       * Inferring series from shapes was wrong twice over: every unnamed svg
       * collapsed into one bucket, so marks from different charts were compared
       * as if they shared a plot, and structural rules (a muted axis line) were
       * treated as data. Which marks are series is a fact about the chart, so
       * the chart states it.
       */
      const chart = el.closest('svg');
      if (chart) {
        if (!series.has(chart)) series.set(chart, new Map());
        const perChart = series.get(chart);
        const name = el.getAttribute('data-series');
        if (!perChart.has(name)) {
          perChart.set(name, {
            colour: best.colour,
            name,
            chart: chart.getAttribute('data-chart') || 'svg',
            // a series may state that colour is NOT its identity channel
            encoding: el.getAttribute('data-series-encoding') || '',
          });
        }
      }
    }
  }

  /**
   * Series separability uses OKLab ΔE, NOT a luminance ratio.
   * Two categorical colours can be plainly different to the eye while sitting at
   * the same luminance — amber and green do exactly that. Judging them by a 3:1
   * luminance rule (as this harness first did) condemns a palette the proper
   * instrument passes. The floor of 15 is the dataviz skill's normal-vision
   * threshold; CVD separation is validated at design time with that skill's
   * palette script, which simulates protan/deutan properly.
   */
  const oklab = (c) => {
    const f = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
    const r = f(c.r), g = f(c.g), b = f(c.b);
    let l = Math.cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*b);
    let m = Math.cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*b);
    let s2 = Math.cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*b);
    return [0.2104542553*l + 0.7936177850*m - 0.0040720468*s2,
            1.9779984951*l - 2.4285922050*m + 0.4505937099*s2,
            0.0259040371*l + 0.7827717662*m - 0.8086757660*s2];
  };
  const deltaE = (a, b) => {
    const A = oklab(a), B = oklab(b);
    return 100 * Math.hypot(A[0]-B[0], A[1]-B[1], A[2]-B[2]);
  };

  for (const perChart of series.values()) {
    const list = [...perChart.values()];
    const chart = list.length ? list[0].chart : 'svg';
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        /**
         * Colour separability only binds when colour IS the identity channel.
         * The comps ladder separates base from adjusted by hollow vs solid fill
         * (plus size, position and a legend), so its dots declare that and are
         * compared on nothing. Recorded on the marks themselves, so the reason
         * sits where the next person would add a series.
         */
        if (list[i].encoding || list[j].encoding) continue;
        const a = parse(list[i].colour);
        const b = parse(list[j].colour);
        if (!a || !b) continue;
        const ratio = deltaE(a, b);
        if (ratio < 15) {
          const key = 's|' + chart + list[i].colour + list[j].colour;
          if (!seen.has(key)) {
            seen.add(key);
            out.push({
              kind: 'series-vs-series',
              ratio: Math.round(ratio * 10) / 10,
              colour: list[i].colour + ' (' + list[i].name + ')',
              against: list[j].colour + ' (' + list[j].name + ')',
              where: chart,
            });
          }
        }
      }
    }
  }
  return { findings: out, measured, seriesFound: [...series.values()].reduce((a, m) => a + m.size, 0) };
})()`;

const setTheme = async (page: Page, theme: 'light' | 'dark') => {
  await page.evaluate((t) => {
    localStorage.setItem('apex_theme', t);
    document.documentElement.classList.toggle('dark', t === 'dark');
  }, theme);
};

async function runGraphicsSweep(page: Page, minMarks: number) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();

  const ids = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    const deals = j.result.data.json.deals as Array<{ id: string; name: string }>;
    const by = (p: string) => deals.find((d) => d.name.startsWith(p))!.id;
    return { northgate: by('Northgate'), kingsway: by('Kingsway'), harbour: by('Harbour') };
  });

  // every screen that draws data, plus the tabs that hold the charts
  const routes: Array<[string, string, string?]> = [
    ['appraisal cashflow', `/deal/${ids.kingsway}/appraisal`, 'Cashflow'],
    ['appraisal returns', `/deal/${ids.kingsway}/appraisal`, 'Returns'],
    ['phased programme', `/deal/${ids.harbour}/appraisal`, 'Phases'],
    ['deal overview', `/deal/${ids.harbour}`],
    ['sales', `/deal/${ids.harbour}/sales`],
    ['comparables', `/deal/${ids.northgate}/comparables`],
    ['costs', `/deal/${ids.harbour}/costs`],
    ['benchmarking', '/benchmarking'],
    ['hub', '/'],
  ];

  const findings: Finding[] = [];
  let totalMeasured = 0;
  let totalSeries = 0;
  const perRoute: string[] = [];
  for (const theme of ['light', 'dark'] as const) {
    for (const [name, path, tab] of routes) {
      await page.goto(path);
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
      if (tab) {
        await page.getByRole('button', { name: tab, exact: true }).click().catch(() => {});
      }
      await setTheme(page, theme);
      await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
      await page.waitForTimeout(300);
      const res = (await page.evaluate(AUDIT)) as { findings: Omit<Finding, 'route' | 'theme'>[]; measured: number; seriesFound: number };
      totalMeasured += res.measured;
      totalSeries += res.seriesFound;
      if (theme === 'light') perRoute.push(`${name}: ${res.measured} marks, ${res.seriesFound} series`);
      findings.push(...res.findings.map((h) => ({ ...h, route: name, theme })));
    }
  }

  if (findings.length) {
    const groups = new Map<string, { n: number; f: Finding }>();
    for (const f of findings) {
      const k = `${f.theme}|${f.kind}|${f.colour}|${f.against}`;
      const g = groups.get(k);
      if (g) g.n++;
      else groups.set(k, { n: 1, f });
    }
    console.log(
      '\nGRAPHICAL OBJECTS below 3:1:\n' +
        [...groups.values()]
          .sort((a, b) => a.f.ratio - b.f.ratio)
          .map(({ n, f }) => `  ${f.kind === 'series-vs-series' ? 'ΔE ' + f.ratio.toFixed(1) : f.ratio.toFixed(2) + ':1'}  [${f.theme}] ${f.kind}\n      ${f.colour} against ${f.against}  ×${n}\n      e.g. ${f.route} — ${f.where}`)
          .join('\n'),
    );
  }

  // a sweep that measured nothing would pass silently — prove it saw the charts
  // state the viewport the sweep actually ran at: a "mobile" run that silently
  // used the desktop width would be green for the wrong reason
  const env = await page.evaluate(() => ({ width: window.innerWidth, narrow: window.matchMedia('(max-width: 640px)').matches }));
  console.log(`\nmeasured ${totalMeasured} marks, ${totalSeries} declared series at ${env.width}px (narrow chart variant: ${env.narrow})`);
  console.log('  ' + perRoute.join('\n  '));
  // Floors set from what the sweep actually measures (146 marks / 8 series), not
  // a guess: they exist to catch a chart that stopped rendering, which would
  // otherwise turn this suite silently green.
  expect(totalMeasured).toBeGreaterThan(minMarks);
  expect(totalSeries).toBeGreaterThanOrEqual(8);

  expect(
    findings.map((f) => `${f.theme} ${f.route} ${f.kind}: ${f.colour} vs ${f.against} ${f.kind === 'series-vs-series' ? 'ΔE ' + f.ratio : f.ratio + ':1'}`),
  ).toEqual([]);
}

test('chart marks are distinguishable from their background and each other', async ({ page }) => {
  test.setTimeout(600_000);
  await runGraphicsSweep(page, 120);
});

/**
 * The charts swap to a NARROW variant below 640px — a different viewBox, tick
 * density and bar geometry. That code path had never been measured.
 */
test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('chart marks hold up at 390px', async ({ page }) => {
    test.setTimeout(600_000);
    await runGraphicsSweep(page, 60);
  });
});

/**
 * The report surfaces — the client deliverable.
 *
 * They render the SAME chart components but under two conditions the screen
 * sweep never exercises: a `.light` pin that must hold whatever theme the
 * viewer has set (i68's white-on-white bug was exactly that pin failing), and
 * print media, which is what the PDF renderer actually rasterises.
 */
test('report graphics hold up light-pinned and in print media', async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto('/login');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Deal tools')).toBeVisible();

  const ids = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    const deals = j.result.data.json.deals as Array<{ id: string; name: string }>;
    const by = (p: string) => deals.find((d) => d.name.startsWith(p))!.id;
    return { northgate: by('Northgate'), kingsway: by('Kingsway') };
  });

  const routes: Array<[string, string]> = [
    ['appraisal report', `/deal/${ids.kingsway}/report`],
    ['red book', `/deal/${ids.northgate}/redbook`],
    ['terms document', `/deal/${ids.northgate}/engagement/document`],
  ];

  const findings: Finding[] = [];
  let measured = 0;
  // 'dark' is the interesting case: the document must stay light-pinned, and its
  // marks must be measured against the light surfaces it pins itself to
  for (const [themeName, theme, media] of [
    ['screen/light', 'light', 'screen'],
    ['screen/dark-pinned', 'dark', 'screen'],
    ['print', 'light', 'print'],
  ] as Array<[string, 'light' | 'dark', 'screen' | 'print']>) {
    for (const [name, path] of routes) {
      await page.emulateMedia({ media: 'screen' });
      await page.goto(path);
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
      await setTheme(page, theme);
      await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
      await page.emulateMedia({ media });
      await page.waitForSelector('.a4-page', { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(400);
      const res = (await page.evaluate(AUDIT)) as { findings: Omit<Finding, 'route' | 'theme'>[]; measured: number; seriesFound: number };
      measured += res.measured;
      findings.push(...res.findings.map((h) => ({ ...h, route: name, theme: themeName })));
    }
  }
  await page.emulateMedia({ media: 'screen' });

  if (findings.length) {
    const groups = new Map<string, { n: number; f: Finding }>();
    for (const f of findings) {
      const k = `${f.theme}|${f.colour}|${f.against}`;
      const g = groups.get(k);
      if (g) g.n++;
      else groups.set(k, { n: 1, f });
    }
    console.log(
      '\nREPORT GRAPHICS below 3:1:\n' +
        [...groups.values()]
          .sort((a, b) => a.f.ratio - b.f.ratio)
          .map(({ n, f }) => `  ${f.kind === 'series-vs-series' ? 'ΔE ' + f.ratio.toFixed(1) : f.ratio.toFixed(2) + ':1'}  [${f.theme}] ${f.colour} on ${f.against}  ×${n}\n      e.g. ${f.route} — ${f.where}`)
          .join('\n'),
    );
  }
  console.log(`\nreport sweep measured ${measured} marks`);
  expect(measured).toBeGreaterThan(60);
  expect(
    findings.map((f) => `${f.theme} ${f.route}: ${f.colour} vs ${f.against} ${f.kind === 'series-vs-series' ? 'ΔE ' + f.ratio : f.ratio + ':1'}`),
  ).toEqual([]);
});

import { expect, test, type Page } from '@playwright/test';

/**
 * Both-theme contrast audit.
 *
 * The i28 dark-mode sign-off was screenshot-based and reported "0 findings";
 * two real failures (the brand green at 1.84:1, the toggle rail at 15.69:1)
 * were then found by accident months later. This measures instead: every
 * element with its own text, on every screen, in both themes, against the
 * WCAG AA thresholds — 4.5:1 for body text, 3:1 for large text.
 *
 * Run it alone while working on themes:
 *   npx playwright test e2e/contrast.spec.ts
 */

type Finding = {
  route: string;
  theme: string;
  ratio: number;
  required: number;
  color: string;
  background: string;
  fontSize: number;
  weight: number;
  text: string;
  where: string;
};

/** Injected into the page: returns every AA failure on the current screen. */
const AUDIT = `(() => {
  const parse = (s) => {
    const n = (s.match(/[\\d.]+/g) || []).map(Number);
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
  /**
   * What is VISUALLY behind the text, composited. Uses elementsFromPoint rather
   * than a parent walk: an absolutely-positioned label often escapes its
   * parent's box (a value sitting above its bar), and a DOM walk would measure
   * it against a background it does not actually sit on.
   */
  const backdrop = (el) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let chain = [];
    // Hit-testing is the accurate method — an absolutely-positioned label often
    // escapes its parent's box — but it only works for what is on screen. Off
    // screen (a card below the fold), fall back to the ancestor chain.
    if (cx >= 0 && cy >= 0 && cx <= innerWidth && cy <= innerHeight) {
      const hits = document.elementsFromPoint(cx, cy);
      const i = hits.indexOf(el);
      // start AT the element: its own background sits behind its own text, and
      // descendants paint above it so they appear earlier in the list
      if (i !== -1) chain = hits.slice(i).filter((n) => n === el || !el.contains(n));
    }
    if (!chain.length) {
      for (let n = el; n && n.nodeType === 1; n = n.parentElement) chain.push(n);
    }
    const stack = [];
    for (const n of chain) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null; // gradient/image
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) {
        stack.push(c);
        if (c.a >= 0.999) break;
      }
    }
    // the page itself is the last resort — NEVER assume white, which silently
    // inverts every dark-mode reading
    if (!stack.length || stack[stack.length - 1].a < 0.999) {
      const page = parse(getComputedStyle(document.body).backgroundColor);
      stack.push(page && page.a > 0 ? { ...page, a: 1 } : { r: 255, g: 255, b: 255, a: 1 });
    }
    let out = stack[stack.length - 1];
    for (let i = stack.length - 2; i >= 0; i--) out = blend(stack[i], out);
    return out;
  };
  const seen = new Set();
  const out = [];
  for (const el of document.querySelectorAll('*')) {
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
    if (!own) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    // WCAG exempts disabled controls, and our disabled styling is opacity-50
    if (el.closest('[disabled], [aria-disabled="true"]')) continue;
    // decorative glyphs are marked aria-hidden; WCAG contrast is about text
    // that conveys meaning
    if (el.closest('[aria-hidden="true"]')) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    const fg = parse(cs.color);
    if (!fg || fg.a === 0) continue;
    const bg = backdrop(el);
    if (!bg) continue; // gradient/image backdrop — reported separately if ever needed
    const size = parseFloat(cs.fontSize) || 16;
    const weight = Number(cs.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const required = large ? 3 : 4.5;
    const ratio = contrast(fg.a < 1 ? blend(fg, bg) : fg, bg);
    if (ratio + 0.01 >= required) continue;
    const key = cs.color + '|' + Math.round(ratio * 100) + '|' + own.slice(0, 20);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ratio: Math.round(ratio * 100) / 100,
      required,
      color: cs.color,
      background: 'rgb(' + [bg.r, bg.g, bg.b].map(Math.round).join(', ') + ')',
      fontSize: size,
      weight,
      text: own.slice(0, 40),
      where: el.tagName + '.' + String(el.className || '').slice(0, 44),
    });
  }
  return out;
})()`;

const setTheme = async (page: Page, theme: 'light' | 'dark') => {
  await page.evaluate((t) => {
    localStorage.setItem('apex_theme', t);
    document.documentElement.classList.toggle('dark', t === 'dark');
  }, theme);
};

/** Sign in as one of the seeded demo principals. */
const signIn = async (page: Page, email?: string) => {
  await page.goto('/login');
  if (email) {
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('demo');
  }
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForLoadState('networkidle').catch(() => {});
};

test('no AA contrast failures on any screen, in either theme', async ({ page, browser }) => {
  test.setTimeout(600_000);
  await signIn(page);
  await expect(page.getByText('Deal tools')).toBeVisible();

  const ids = await page.evaluate(async () => {
    const r = await fetch('/trpc/deals.list', { headers: { authorization: `Bearer ${localStorage.getItem('apex_token')}` } });
    const j = await r.json();
    const deals = j.result.data.json.deals as Array<{ id: string; name: string }>;
    const by = (p: string) => deals.find((d) => d.name.startsWith(p))!.id;
    return { northgate: by('Northgate'), kingsway: by('Kingsway'), harbour: by('Harbour'), westover: by('Westover') };
  });

  // a live signing link, so the page a client actually sees is audited too
  const signToken = await page.evaluate(async (dealId) => {
    const auth = { authorization: `Bearer ${localStorage.getItem('apex_token')}`, 'content-type': 'application/json' };
    const terms = {
      clientName: 'Contrast Sweep Ltd', clientAddress: '', otherUsers: 'None.', purpose: 'Audit.',
      interest: 'Freehold.', basisOfValue: 'Market Value', valuationDate: null,
      extentOfInvestigation: 'Inspection.', sourcesOfInformation: 'Client.', assumptions: 'Standard.',
      specialAssumptions: 'None.', reportFormat: 'PDF.', restrictionsOnUse: 'None.', feeBasis: 'Fixed.',
      liabilityCap: null, complaintsProcedure: 'RICS.', aiUse: 'May be used.',
      valuerName: 'Dana Whitlock MRICS', valuerReg: 'RICS Registered Valuer',
    };
    await fetch('/trpc/engagement.save', { method: 'POST', headers: auth, body: JSON.stringify({ json: { dealId, terms } }) });
    const res = await fetch('/trpc/engagement.issue', { method: 'POST', headers: auth, body: JSON.stringify({ json: dealId }) });
    const j = await res.json();
    return j.result.data.json.signToken as string;
  }, ids.westover);

  const routes: Array<[string, string]> = [
    ['hub', '/'],
    ['board', '/board'],
    ['calendar', '/calendar'],
    ['benchmarking', '/benchmarking'],
    ['integrations', '/integrations'],
    ['settings', '/settings'],
    ['whats-new', '/whats-new'],
    ['deal overview', `/deal/${ids.northgate}`],
    ['appraisal', `/deal/${ids.kingsway}/appraisal`],
    ['auto-appraisal', `/deal/${ids.northgate}/auto`],
    ['comparables', `/deal/${ids.northgate}/comparables`],
    ['scenarios', `/deal/${ids.northgate}/scenarios`],
    ['costs', `/deal/${ids.harbour}/costs`],
    ['sales', `/deal/${ids.harbour}/sales`],
    ['data room', `/deal/${ids.northgate}/dataroom`],
    ['workbench', `/deal/${ids.northgate}/workbench`],
    ['site pack', `/deal/${ids.northgate}/sitepack`],
    ['terms', `/deal/${ids.northgate}/engagement`],
    ['phases', `/deal/${ids.harbour}/appraisal`],
    ['field app', '/field'],
    // the client deliverable: light-pinned, and never previously swept
    ['appraisal report', `/deal/${ids.kingsway}/report`],
    ['red book', `/deal/${ids.northgate}/redbook`],
    ['terms document', `/deal/${ids.northgate}/engagement/document`],
  ];

  const findings: Finding[] = [];
  const sweep = async (p: Page, list: Array<[string, string]>) => {
    for (const theme of ['light', 'dark'] as const) {
      for (const [name, path] of list) {
        await p.goto(path);
        await p.waitForLoadState('networkidle').catch(() => {});
        await setTheme(p, theme);
        // Freeze animation rather than waiting a fixed interval for it: colour
        // transitions are what make a read return the PREVIOUS theme's value,
        // and on a loaded machine 400ms is not always enough — that is a flaky
        // gate, which for accessibility is worse than no gate.
        await p.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
        await p.waitForTimeout(150);
        const hits = (await p.evaluate(AUDIT)) as Omit<Finding, 'route' | 'theme'>[];
        findings.push(...hits.map((h) => ({ ...h, route: name, theme })));
      }
    }
  };

  await sweep(page, routes);

  // Everything a client or a stranger sees. Each persona needs its OWN context:
  // sessions share localStorage within one, so signing in as a buyer would
  // evict the internal session mid-sweep.
  const personas: Array<[string | undefined, Array<[string, string]>]> = [
    ['buyer@demo.co.uk', [['buyer portal', '/portal/buyer']]],
    ['investor@demo.co.uk', [['investor portal', '/portal/investor']]],
    [
      undefined, // no session at all
      [
        ['login', '/login'],
        ['register', '/register'],
        ['landing', '/welcome'],
        ['signing page', `/terms/${signToken}`],
        ['not found', '/no-such-page'],
      ],
    ],
  ];
  for (const [email, list] of personas) {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    if (email) {
      await signIn(p, email);
    }
    await sweep(p, list);
    await ctx.close();
  }

  if (findings.length) {
    // grouped first: a ramp-level problem shows up as one colour across many
    // screens, and that is a different fix from a one-off
    const byColour = new Map<string, { n: number; worst: number; sample: string }>();
    for (const f of findings) {
      const k = `${f.theme} ${f.color}`;
      const cur = byColour.get(k);
      if (!cur) byColour.set(k, { n: 1, worst: f.ratio, sample: f.text });
      else { cur.n++; cur.worst = Math.min(cur.worst, f.ratio); }
    }
    console.log(
      '\nBy colour:\n' +
        [...byColour.entries()]
          .sort((a, b) => a[1].worst - b[1].worst)
          .map(([k, v]) => `  ${v.worst.toFixed(2)}:1  ${k}  ×${v.n}   e.g. "${v.sample}"`)
          .join('\n'),
    );
    const worst = findings.sort((a, b) => a.ratio - b.ratio).slice(0, 40);
    console.log(
      '\nAA contrast failures:\n' +
        worst
          .map(
            (f) =>
              `  ${f.ratio.toFixed(2)}:1 (needs ${f.required})  [${f.theme}] ${f.route}\n` +
              `      "${f.text}"  ${f.color} on ${f.background}  ${f.fontSize}px/${f.weight}\n` +
              `      ${f.where}`,
          )
          .join('\n'),
    );
  }
  // ---------------------------------------------------------------------
  // The de-emphasised grey ramp (--ink-3, --inactive, --ink-2b) and two status
  // tones sit below AA by design decision, not by accident: ~1,150 text nodes
  // across every screen. Raising them repaints the whole app, so they are
  // QUARANTINED WITH A CEILING here rather than silenced — the counts may not
  // grow, and anything outside these tones fails immediately.
  //   → see the loop log (i66) for the numbers and the options.
  // The grey ramp was raised to AA in i67 (every tier ≥4.5:1 on the worst
  // background it lands on, hierarchy preserved), so the quarantine is gone.
  // What remains here is a short list of genuine exceptions, each with a reason.
  const RAMP_CEILING = new Map<string, number>([]);

  const counts = new Map<string, number>();
  for (const f of findings) {
    const k = `${f.theme} ${f.color}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const unexpected = findings.filter((f) => !RAMP_CEILING.has(`${f.theme} ${f.color}`));
  const grown = [...counts.entries()]
    .filter(([k, n]) => RAMP_CEILING.has(k) && n > RAMP_CEILING.get(k)!)
    .map(([k, n]) => `${k}: ${n} > ceiling ${RAMP_CEILING.get(k)}`);

  expect(
    unexpected.map((f) => `${f.theme} ${f.route}: "${f.text}" ${f.ratio}:1 ${f.color} on ${f.background}`),
  ).toEqual([]);
  expect(grown).toEqual([]);
});

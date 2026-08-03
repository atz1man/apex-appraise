import { expect, test, type Page } from '@playwright/test';

/**
 * Non-text contrast audit — WCAG 1.4.11, the 3:1 rule for things that are not
 * words: the boundary that tells you a control is a control, and the focus
 * indicator that tells a keyboard user where they are.
 *
 * The text sweep (contrast.spec.ts) says nothing about either. A control can
 * have perfectly legible text inside an invisible box, and a focus ring can be
 * the one thing on the page nobody can see.
 *
 * Scope note: decorative marks are exempt, and so are disabled controls. Status
 * dots are skipped deliberately — every one of ours sits beside a text label
 * that carries the same meaning, which makes the dot decoration.
 */

type Finding = {
  route: string;
  theme: string;
  kind: 'boundary' | 'focus';
  ratio: number;
  detail: string;
  where: string;
};

const AUDIT = `(() => {
  const parse = (s) => {
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
  /** the opaque colour painted behind an element, excluding the element itself */
  const behind = (el) => {
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

  const CONTROLS = 'input, select, textarea, button, [role="tab"], [role="checkbox"], [role="switch"]';
  const out = [];
  const seen = new Set();

  for (const el of document.querySelectorAll(CONTROLS)) {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') continue; // exempt
    if (el.closest('[aria-hidden="true"]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    // a file input rendered as sr-only is presented by its label, not itself
    if (el.className && String(el.className).includes('sr-only')) continue;

    const bg = behind(el);
    if (!bg) continue;
    const own = parse(cs.backgroundColor);
    const ownSolid = own && own.a > 0 ? (own.a >= 0.999 ? own : blend(own, bg)) : null;

    // A control is identifiable if EITHER its border contrasts with what is on
    // either side of it, OR its own fill stands out from the page.
    const bw = parseFloat(cs.borderTopWidth) || 0;
    const bc = parse(cs.borderTopColor);
    let boundary = 0;
    let detail = '';
    if (bw > 0 && bc && bc.a > 0) {
      const solid = bc.a >= 0.999 ? bc : blend(bc, ownSolid ?? bg);
      const vsOutside = contrast(solid, bg);
      const vsInside = ownSolid ? contrast(solid, ownSolid) : 0;
      boundary = Math.max(vsOutside, vsInside);
      detail = 'border ' + cs.borderTopColor + ' vs page ' + vsOutside.toFixed(2) + ':1, vs fill ' + vsInside.toFixed(2) + ':1';
    }
    if (ownSolid) {
      const fill = contrast(ownSolid, bg);
      if (fill > boundary) {
        boundary = fill;
        detail = 'fill ' + cs.backgroundColor + ' vs page ' + fill.toFixed(2) + ':1';
      }
    }
    /**
     * Justified exemptions. 1.4.11 covers information REQUIRED to identify a
     * component or its state — where the same state is also carried by text,
     * a tint is reinforcement rather than the indicator.
     *   - data-room folder rows: selected also sets font-semibold, brand text
     *     colour AND a brand icon colour
     *   - segmented-control pill: selected also sets brand text colour, weight,
     *     and a hairline ring (see i65)
     * Both are recorded here so the exemption is reviewable, not hidden.
     */
    if (el.closest('[role="tablist"]')) continue;
    if (el.matches('button.w-full.flex.items-center') && String(el.className).includes('rounded-[9px]')) continue;

    // A control with neither border nor fill presents itself through its label,
    // and that text is already held to 4.5:1 by the text sweep. 1.4.11 asks for
    // a boundary only where a boundary is what identifies the control.
    const hasOwnBoundary = (bw > 0 && bc && bc.a > 0) || !!ownSolid;
    if (!hasOwnBoundary) continue;
    if (!detail) detail = 'no border and no fill';
    if (boundary + 0.01 < 3) {
      const key = 'b|' + cs.borderTopColor + cs.backgroundColor + Math.round(boundary * 100);
      if (!seen.has(key)) {
        seen.add(key);
        out.push({
          kind: 'boundary',
          ratio: Math.round(boundary * 100) / 100,
          detail,
          where: el.tagName + '.' + String(el.className || '').slice(0, 40),
        });
      }
    }
  }
  return out;
})()`;

/** Focus each control in turn and measure the indicator that appears. */
const FOCUS_AUDIT = `(() => {
  const parse = (s) => {
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
  const blend = (fg, bg) => ({ r: fg.r*fg.a+bg.r*(1-fg.a), g: fg.g*fg.a+bg.g*(1-fg.a), b: fg.b*fg.a+bg.b*(1-fg.a), a: 1 });
  const lum = (c) => { const f=[c.r,c.g,c.b].map((v)=>{const x=v/255; return x<=0.03928?x/12.92:((x+0.055)/1.055)**2.4;}); return 0.2126*f[0]+0.7152*f[1]+0.0722*f[2]; };
  const contrast = (a,b) => { const [hi,lo]=[lum(a),lum(b)].sort((x,y)=>y-x); return (hi+0.05)/(lo+0.05); };
  const behind = (el) => {
    const stack = [];
    for (let n = el.parentElement; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a >= 0.999) break; }
    }
    if (!stack.length || stack[stack.length-1].a < 0.999) {
      const page = parse(getComputedStyle(document.body).backgroundColor);
      stack.push(page && page.a > 0 ? { ...page, a: 1 } : { r:255,g:255,b:255,a:1 });
    }
    let out = stack[stack.length-1];
    for (let i = stack.length-2; i>=0; i--) out = blend(stack[i], out);
    return out;
  };
  /**
   * Every channel a focused control might signal through. A control passes if
   * ANY of them is visible: reporting only the first found blamed the faint
   * 4px glow on inputs whose focus BORDER is the real indicator.
   */
  const ringChannels = (cs) => {
    const list = [];
    const ow = parseFloat(cs.outlineWidth) || 0;
    if (ow > 0 && cs.outlineStyle !== 'none') {
      const c = parse(cs.outlineColor);
      if (c && c.a > 0) list.push({ c, how: 'outline ' + cs.outlineColor });
    }
    const sh = cs.boxShadow || '';
    if (sh && sh !== 'none') {
      const c = parseColour(sh);
      if (c && c.a > 0) list.push({ c, how: 'box-shadow ' + sh.slice(0, 46) });
    }
    const bc = parse(cs.borderTopColor);
    if (bc && bc.a > 0 && (parseFloat(cs.borderTopWidth) || 0) > 0) list.push({ c: bc, how: 'focus border ' + cs.borderTopColor });
    return list;
  };
  const out = [];
  const seen = new Set();
  const controls = [...document.querySelectorAll('input, select, textarea, button, a[href], [role="tab"]')]
    .filter((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return cs.visibility !== 'hidden' && cs.display !== 'none' && r.width > 4 && r.height > 4 &&
        !el.hasAttribute('disabled') && !String(el.className || '').includes('sr-only');
    })
    .slice(0, 24); // a representative sample per screen keeps the sweep quick
  for (const el of controls) {
    const before = getComputedStyle(el).cssText;
    el.focus({ preventScroll: true });
    const cs = getComputedStyle(el);
    const bg = behind(el);
    if (!bg) { el.blur(); continue; }
    const channels = ringChannels(cs);
    if (!channels.length) {
      out.push({ kind: 'focus', ratio: 0, detail: 'no visible focus indicator', where: el.tagName + '.' + String(el.className||'').slice(0,40) });
      el.blur();
      continue;
    }
    let best = { ratio: 0, how: '' };
    for (const ch of channels) {
      const solid = ch.c.a >= 0.999 ? ch.c : blend(ch.c, bg);
      const ratio = contrast(solid, bg);
      if (ratio > best.ratio) best = { ratio, how: ch.how };
    }
    if (best.ratio + 0.01 < 3) {
      const key = 'f|' + best.how + Math.round(best.ratio * 100);
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ kind: 'focus', ratio: Math.round(best.ratio*100)/100, detail: 'best of ' + channels.length + ': ' + best.how, where: el.tagName + '.' + String(el.className||'').slice(0,40) });
      }
    }
    el.blur();
    void before;
  }
  return out;
})()`;

const setTheme = async (page: Page, theme: 'light' | 'dark') => {
  await page.evaluate((t) => {
    localStorage.setItem('apex_theme', t);
    document.documentElement.classList.toggle('dark', t === 'dark');
  }, theme);
};

test('controls and focus indicators meet the 3:1 non-text rule', async ({ page }) => {
  test.setTimeout(600_000);
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

  const routes: Array<[string, string]> = [
    ['login', '/login'],
    ['hub', '/'],
    ['board', '/board'],
    ['settings', '/settings'],
    ['integrations', '/integrations'],
    ['appraisal', `/deal/${ids.kingsway}/appraisal`],
    ['comparables', `/deal/${ids.northgate}/comparables`],
    ['costs', `/deal/${ids.harbour}/costs`],
    ['data room', `/deal/${ids.northgate}/dataroom`],
    ['terms', `/deal/${ids.northgate}/engagement`],
  ];

  const findings: Finding[] = [];
  for (const theme of ['light', 'dark'] as const) {
    for (const [name, path] of routes) {
      await page.goto(path);
      await page.waitForLoadState('networkidle').catch(() => {});
      await setTheme(page, theme);
      // border-color is transitioned, so a computed read straight after focus()
      // returns a value mid-animation — the audit measured the UNFOCUSED border
      // and blamed the wrong thing. Freeze animation before measuring.
      await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
      await page.waitForTimeout(350);
      for (const script of [AUDIT, FOCUS_AUDIT]) {
        const hits = (await page.evaluate(script)) as Omit<Finding, 'route' | 'theme'>[];
        findings.push(...hits.map((h) => ({ ...h, route: name, theme })));
      }
    }
  }

  if (findings.length) {
    const byKind = { boundary: findings.filter((f) => f.kind === 'boundary'), focus: findings.filter((f) => f.kind === 'focus') };
    const summarise = (list: Finding[]) => {
      const groups = new Map<string, { n: number; f: Finding }>();
      for (const f of list) {
        const k = `${f.theme}|${f.detail}`;
        const g = groups.get(k);
        if (g) g.n++;
        else groups.set(k, { n: 1, f });
      }
      return [...groups.values()]
        .sort((a, b) => a.f.ratio - b.f.ratio)
        .map(({ n, f }) => `  ${f.ratio.toFixed(2)}:1  [${f.theme}] ${f.detail}  ×${n}\n      e.g. ${f.route} — ${f.where}`)
        .join('\n');
    };
    console.log(`\nCONTROL BOUNDARIES below 3:1 (${byKind.boundary.length}):\n${summarise(byKind.boundary)}`);
    console.log(`\nFOCUS INDICATORS below 3:1 (${byKind.focus.length}):\n${summarise(byKind.focus)}`);
  }

  expect(findings.map((f) => `${f.theme} ${f.route} ${f.kind}: ${f.detail} ${f.ratio}:1`)).toEqual([]);
});

import { beforeAll, describe, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';
import { verifyDownloadToken } from '../src/download-token.js';

/**
 * What an investor can read, and what a buyer can read before signing.
 *
 * The investor portal's Documents panel was fed from `Investor.documents`, a
 * JSON list of {name, date, size} on the investor row. Nothing but the demo
 * seed ever wrote to it — the register that creates investors wrote `'[]'` —
 * and no file was ever behind an entry, so the panel drew a download icon
 * beside each name that downloaded nothing. An LP reading "Q2 2026 investor
 * report.pdf · 1.2 MB" was reading a string.
 *
 * Sharing is now a flag on the DOCUMENT, beside the buyer's, and the portal
 * lists the flagged documents of the deals the investor holds in with the same
 * signed file URL the data room uses. The buyer's list gains the same URL: its
 * "Review & sign" button stood beside a name the buyer had no way to open.
 */

let A: Tenant;
let B: Tenant;
let lp: { investorId: string; userId: string };
const lpPrincipal = () => ({ ...A.investorPrincipal, investorId: lp.investorId }) as never;

const tokenOf = (url: string) => new URL(url, 'http://x').searchParams.get('t') ?? '';

const fileDoc = (orgId: string, dealId: string, name: string, key: string | null = `${name}.key`) =>
  prisma.document.create({
    data: {
      orgId, dealId, name, category: 'Finance', ext: 'pdf', sizeBytes: BigInt(1234), extraction: 'STORED',
      url: key ? `/uploads/files/${key}` : '',
    },
  });

type Position = { documents: Array<{ id: string; name: string; url: string; dealName: string; sizeBytes: number }> };

beforeAll(async () => {
  resetDatabase();
  A = await makeTenant('Alpha');
  B = await makeTenant('Bravo');
  const inv = await prisma.investor.create({ data: { orgId: A.orgId, name: 'Alpha Capital LP', sharePct: 40 } });
  await prisma.user.update({ where: { id: A.investorPrincipal.userId }, data: { investorId: inv.id } });
  await prisma.holding.create({ data: { investorId: inv.id, dealId: A.dealId, sharePct: 40, committed: 1_000_000_00 } });
  lp = { investorId: inv.id, userId: A.investorPrincipal.userId };
}, 120_000);

describe('documents shared with investors', () => {
  it('reach the LP with a link signed for them, and leave when sharing stops', async () => {
    const doc = await fileDoc(A.orgId, A.dealId, 'Q3 investor report.pdf', 'q3.pdf');
    const before = (await callerFor(lpPrincipal()).investors.myPosition()) as Position;
    expect(before.documents.map((d) => d.id), 'a document nobody shared was already visible').not.toContain(doc.id);

    await callerFor(A.principal).documents.shareWithInvestors({ id: doc.id, visible: true } as never);
    const after = (await callerFor(lpPrincipal()).investors.myPosition()) as Position;
    const seen = after.documents.find((d) => d.id === doc.id);
    expect(seen, 'sharing a document did not reach the investor').toBeTruthy();
    expect(seen!.dealName).toBe('Alpha Wharf');
    expect(seen!.sizeBytes).toBe(1234);

    // the link is the data room's file URL, with a token for THIS viewer and this file
    expect(seen!.url.startsWith('/uploads/files/q3.pdf?t=')).toBe(true);
    expect(verifyDownloadToken(tokenOf(seen!.url), { kind: 'file', key: 'q3.pdf' })).toMatchObject({ userId: lp.userId });
    // a token for one file opens no other
    expect(verifyDownloadToken(tokenOf(seen!.url), { kind: 'file', key: 'other.pdf' })).toBeNull();

    await callerFor(A.principal).documents.shareWithInvestors({ id: doc.id, visible: false } as never);
    const gone = (await callerFor(lpPrincipal()).investors.myPosition()) as Position;
    expect(gone.documents.map((d) => d.id)).not.toContain(doc.id);
  });

  it('is a document the firm holds no file for named without a link, never a link to nothing', async () => {
    const doc = await fileDoc(A.orgId, A.dealId, 'Listed only.pdf', null);
    await callerFor(A.principal).documents.shareWithInvestors({ id: doc.id, visible: true } as never);
    const pos = (await callerFor(lpPrincipal()).investors.myPosition()) as Position;
    expect(pos.documents.find((d) => d.id === doc.id)?.url).toBe('');
  });

  it('follow the HOLDINGS — a deal the LP holds nothing in shows them nothing', async () => {
    const other = await prisma.deal.create({
      data: { orgId: A.orgId, name: 'Alpha Quay', address: '2 Alpha Road', postcode: 'BH1 1AA', assetType: 'RESIDENTIAL', stage: 'APPRAISAL' },
    });
    const doc = await fileDoc(A.orgId, other.id, 'Quay investor pack.pdf');
    await callerFor(A.principal).documents.shareWithInvestors({ id: doc.id, visible: true } as never);
    const before = (await callerFor(lpPrincipal()).investors.myPosition()) as Position;
    expect(before.documents.map((d) => d.id), 'a document on a deal the LP does not hold in was visible').not.toContain(doc.id);

    // and a holding is what admits them
    await prisma.holding.create({ data: { investorId: lp.investorId, dealId: other.id, sharePct: 10, committed: 100_000_00 } });
    const after = (await callerFor(lpPrincipal()).investors.myPosition()) as Position;
    expect(after.documents.map((d) => d.id)).toContain(doc.id);
  });

  it('never cross firms, even through a holding row that names another firm’s deal', async () => {
    /**
     * The register refuses a deal of another firm, but a row is a row. The
     * document query scopes by the firm as well as by the deals held, so a
     * holding that somehow points elsewhere admits nothing.
     */
    const theirs = await fileDoc(B.orgId, B.dealId, 'Bravo investor pack.pdf');
    await callerFor(B.principal).documents.shareWithInvestors({ id: theirs.id, visible: true } as never);
    await prisma.holding.create({ data: { investorId: lp.investorId, dealId: B.dealId, sharePct: 10, committed: 100_000_00 } });
    const pos = (await callerFor(lpPrincipal()).investors.myPosition()) as Position;
    expect(pos.documents.map((d) => d.name), 'another firm’s document reached this LP').not.toContain('Bravo investor pack.pdf');
    await prisma.holding.deleteMany({ where: { investorId: lp.investorId, dealId: B.dealId } });
  });

  it('are signed for whoever is looking when the firm previews a position', async () => {
    const doc = await fileDoc(A.orgId, A.dealId, 'Preview me.pdf', 'preview.pdf');
    await callerFor(A.principal).documents.shareWithInvestors({ id: doc.id, visible: true } as never);
    const preview = (await callerFor(A.principal).investors.get(lp.investorId)) as Position;
    const seen = preview.documents.find((d) => d.id === doc.id)!;
    // the firm's own user, not the LP: a preview link must not be a link that works as the LP
    expect(verifyDownloadToken(tokenOf(seen.url), { kind: 'file', key: 'preview.pdf' })).toMatchObject({ userId: A.userId });
  });

  it('cannot be a placeholder', async () => {
    const placeholder = (await callerFor(A.principal).documents.expect({
      dealId: A.dealId, name: 'Audited accounts FY26.pdf', category: 'Finance',
    } as never)) as { id: string };
    await expect(
      callerFor(A.principal).documents.shareWithInvestors({ id: placeholder.id, visible: true } as never),
    ).rejects.toThrow(/not been received/);
    // withdrawing is always allowed — there is nothing to withhold
    await callerFor(A.principal).documents.shareWithInvestors({ id: placeholder.id, visible: false } as never);
  });

  it('are counted for the access panel and recorded in the trail', async () => {
    const access = (await callerFor(A.principal).documents.access(A.dealId)) as { investorDocuments: number; investors: Array<{ id: string }> };
    const flagged = await prisma.document.count({ where: { dealId: A.dealId, investorVisible: true } });
    expect(access.investorDocuments).toBe(flagged);
    expect(access.investors.map((i) => i.id)).toContain(lp.investorId);
    const trail = await prisma.activityEvent.findMany({ where: { orgId: A.orgId, action: 'shared a document with investors' } });
    expect(trail.length).toBeGreaterThan(0);
  });
});

describe('a buyer’s documents', () => {
  it('carry the file to read before signing, signed for the buyer', async () => {
    const unit = await prisma.unit.create({
      data: { orgId: A.orgId, dealId: A.dealId, name: 'Plot 3', spec: '2 bed', appraisedValue: 300_000_00, status: 'RESERVED', buyerName: 'Cal' },
    });
    const buyer = await prisma.user.create({
      data: { orgId: A.orgId, email: 'cal@buyer.test', password: 'x', name: 'Cal', initials: 'CA', role: 'VIEWER', principalType: 'buyer', buyerUnitId: unit.id },
    });
    const principal = { ...A.investorPrincipal, userId: buyer.id, principalType: 'buyer', investorId: null, buyerUnitId: unit.id } as never;
    const contract = await fileDoc(A.orgId, A.dealId, 'Contract — Plot 3.pdf', 'plot3.pdf');
    const listed = await fileDoc(A.orgId, A.dealId, 'Reservation — Plot 3.pdf', null);
    for (const d of [contract, listed]) {
      await callerFor(A.principal).documents.shareWithBuyer({ id: d.id, unitId: unit.id } as never);
    }
    const mine = (await callerFor(principal).buyer.myUnit()) as { documentsToSign: Array<{ id: string; url: string }> };
    const c = mine.documentsToSign.find((d) => d.id === contract.id)!;
    expect(c.url.startsWith('/uploads/files/plot3.pdf?t=')).toBe(true);
    expect(verifyDownloadToken(tokenOf(c.url), { kind: 'file', key: 'plot3.pdf' })).toMatchObject({ userId: buyer.id });
    expect(mine.documentsToSign.find((d) => d.id === listed.id)!.url).toBe('');
  });
});

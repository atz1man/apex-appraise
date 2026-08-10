import { beforeAll, describe, expect, it } from 'vitest';
import { callerFor, expectDenied, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * Things the product asserts as fact.
 *
 * Each of these replaces something that was invented and presented as real: a
 * data room's access list, a document's file size, the identity of the person a
 * valuation is signed by. They share a failure mode — the screen looks complete
 * and correct, and nothing is wrong until somebody relies on it.
 */

let A: Tenant;
let B: Tenant;

beforeAll(async () => {
  resetDatabase();
  A = await makeTenant('Alpha');
  B = await makeTenant('Beta');
}, 180_000);

describe('the data room access list', () => {
  it('names this workspace’s own people, not another firm’s', async () => {
    const access = (await callerFor(A.principal).documents.access(A.dealId as never)) as {
      team: Array<{ name: string; permission: string; you: boolean }>;
    };
    const names = access.team.map((t) => t.name);
    expect(names).toContain('Alpha Owner');
    // the list used to be three hardcoded names shown to every workspace
    expect(names).not.toContain('Arthur O.');
    expect(names).not.toContain('Dana W.');
    expect(names).not.toContain('Beta Owner');
    expect(access.team.find((t) => t.you)?.name).toBe('Alpha Owner');
  });

  it('grants permission wording from the role that actually governs the account', async () => {
    const access = (await callerFor(A.principal).documents.access(A.dealId as never)) as {
      team: Array<{ name: string; role: string; permission: string }>;
    };
    // makeTenant's owner is an ADMIN
    expect(access.team.find((t) => t.role === 'ADMIN')?.permission).toBe('Full');
  });

  it('refuses to describe access to another firm’s deal', async () => {
    await expectDenied('reading a foreign deal’s access list', () =>
      callerFor(A.principal).documents.access(B.dealId as never),
    );
  });
});

describe('documents the deal is still waiting for', () => {
  it('records no size, because there is no file to have one', async () => {
    const doc = (await callerFor(A.principal).documents.expect({
      dealId: A.dealId,
      name: 'Structural survey.pdf',
      category: 'Technical',
    } as never)) as { id: string; extraction: string; sizeBytes: bigint; buyerVisible: boolean };

    /**
     * The old behaviour: the client sent a random number between 120KB and 6MB,
     * the row claimed STORED, and it linked nowhere. In a room a lender reads, a
     * document that does not exist is worse than a gap — a gap gets chased.
     */
    expect(Number(doc.sizeBytes)).toBe(0);
    expect(doc.extraction).toBe('AWAITED');
    // nothing to show a buyer
    expect(doc.buyerVisible).toBe(false);
  });

  it('does not inflate the room’s size, and is counted as outstanding', async () => {
    const listed = (await callerFor(A.principal).documents.list({ dealId: A.dealId } as never)) as {
      totalBytes: number;
      awaited: number;
      documents: Array<{ name: string; url: string | null }>;
    };
    expect(listed.totalBytes).toBe(0);
    expect(listed.awaited).toBeGreaterThan(0);
    // and it is honest about having nothing behind it
    expect(listed.documents.find((d) => d.name === 'Structural survey.pdf')?.url).toBeFalsy();
  });

  it('cannot be marked stored without a file ever arriving', async () => {
    const doc = await prisma.document.findFirst({ where: { orgId: A.orgId, extraction: 'AWAITED' } });
    expect(doc).toBeTruthy();
    /**
     * Without this the placeholder walks back into claiming a file exists —
     * the same lie through a different door.
     */
    await expectDenied('promoting an expected document to STORED', () =>
      callerFor(A.principal).documents.setExtraction({ id: doc!.id, status: 'STORED' } as never),
    );
  });
});

describe('the investor portal’s named contact', () => {
  it('is a real administrator at the investor’s own managing firm', async () => {
    const contact = (await callerFor(A.investorPrincipal).investors.myContact()) as {
      firm: string;
      manager: { name: string; email: string } | null;
    };
    expect(contact.firm).toContain('Alpha');
    expect(contact.manager?.name).toBe('Alpha Owner');
    /**
     * Every investor of every firm used to be told their manager was "Arthur O.
     * of Brookfield Developments", with a mailto to a demo address — so an LP
     * writing in reached nobody, and the firm never learned they had tried.
     */
    expect(contact.manager?.email).not.toContain('apexappraise.co.uk');
    expect(contact.manager?.email).toContain('alpha');
  });
});

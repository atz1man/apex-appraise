import { useState } from 'react';
import { trpc } from '../lib/trpc';
import { Button } from './ui';

/**
 * Create, see and withdraw the read-only links to a report.
 *
 * The links shipped with expiry and revocation as security properties — and with
 * no way to exercise either from the product. A firm could hand out a link and
 * then had no means of taking it back short of an API call, which is the same as
 * not being able to take it back. This is that half.
 *
 * Shared by both reports, so the appraisal and the Red Book cannot drift into
 * having different rules about who may share what.
 */
export function ShareLinks({ dealId, kind }: { dealId: string; kind: 'appraisal' | 'redbook' }) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);

  const { data: shares } = trpc.appraisal.shares.useQuery(dealId, { enabled: open });
  const create = trpc.appraisal.createShare.useMutation({
    onSuccess: (s) => {
      // shown once, here: the token is stored hashed and cannot be produced again
      setFresh(`${window.location.origin}/shared/${s.token}.pdf`);
      utils.appraisal.shares.invalidate(dealId);
    },
  });
  const revoke = trpc.appraisal.revokeShare.useMutation({
    onSuccess: () => utils.appraisal.shares.invalidate(dealId),
  });

  const mine = (shares ?? []).filter((s) => s.kind === kind);
  const live = mine.filter((s) => s.state === 'live');

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(!open)}>
        Share link{live.length > 0 ? ` · ${live.length}` : ''}
      </Button>

      {open && (
        <div
          className="absolute left-0 right-0 top-[54px] bg-surface border-b border-border-strong px-5 py-3"
          data-share-panel
        >
          <div className="flex items-center gap-3">
            <span className="text-[12.5px] font-semibold">Read-only links</span>
            <span className="text-[11.5px] text-ink-3">
              Anyone with the link can read this report as a PDF. It expires after 30 days and you can withdraw it at any
              time.
            </span>
            <Button
              size="sm"
              className="ml-auto"
              loading={create.isPending}
              onClick={() => create.mutate({ dealId, kind })}
            >
              New link
            </Button>
            <Button size="sm" variant="secondary" onClick={() => { setOpen(false); setFresh(null); }}>
              Done
            </Button>
          </div>

          {fresh && (
            <div className="mt-2.5 flex items-center gap-2" data-share-link>
              <span className="text-[11.5px] text-ink-2 flex-none">Copy it now — it is not shown again:</span>
              <input className="flex-1 fig text-[11.5px]" readOnly value={fresh} onFocus={(e) => e.currentTarget.select()} />
              <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard?.writeText(fresh)}>
                Copy
              </Button>
            </div>
          )}

          {mine.length > 0 && (
            <div className="mt-2.5 flex flex-col gap-1">
              {mine.map((s) => (
                <div key={s.id} className="flex items-center gap-3 text-[11.5px]">
                  <span
                    className="fig flex-none"
                    style={{
                      color:
                        s.state === 'live'
                          ? 'rgb(var(--status-green, 30 122 85))'
                          : 'rgb(var(--ink-3, 118 125 118))',
                    }}
                  >
                    {s.state === 'live' ? 'LIVE' : s.state.toUpperCase()}
                  </span>
                  <span className="text-ink-2">
                    created {new Date(s.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    {s.state === 'live'
                      ? ` · expires ${new Date(s.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
                      : ''}
                  </span>
                  {/* opened-count matters: a link nobody used is safe to withdraw,
                      and one used forty times is worth asking about */}
                  <span className="fig text-ink-3">
                    {s.viewCount} {s.viewCount === 1 ? 'open' : 'opens'}
                  </span>
                  {s.state === 'live' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={revoke.isPending && revoke.variables?.id === s.id}
                      onClick={() => revoke.mutate({ id: s.id })}
                    >
                      Withdraw
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

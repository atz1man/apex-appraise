import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { StatusKey } from '@apex/ui-tokens';
import { getToken, trpc } from '../lib/trpc';
import { Button, EmptyState, FormError, Icon, Skeleton, SkeletonRows, Spinner, StatusChip, TopBar } from '../components/ui';
import { DealNav } from '../components/DealNav';
import { useToast } from '../components/Toast';
import { fmtBytes, n0 } from '../lib/format';
import { brandInk, onFill, personGradients, status as statusTokens } from '@apex/ui-tokens';

const UPLOAD_ICON = 'M12 3v13|M8 7l4-4 4 4|M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2';
const FOLDER_ICON = 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z';

const QUOTA_BYTES = 2 * 1024 ** 3; // 2 GB data-room quota

const FOLDERS: Array<{ key: string; label: string }> = [
  { key: 'all', label: 'All documents' },
  { key: 'Architectural', label: 'Architectural' },
  { key: 'Planning', label: 'Planning' },
  { key: 'Cost plans', label: 'Cost plans' },
  { key: 'Legal', label: 'Legal & title' },
  { key: 'Finance', label: 'Finance' },
];

const CATEGORIES = FOLDERS.slice(1);

/** dc-prototype file-type colours: pdf red, sheets green, docs/CAD blue. */
const EXT_STYLE: Record<string, { bg: string; color: string }> = {
  pdf: { bg: 'rgb(var(--tint-red-soft, 247 229 226))', color: 'rgb(var(--status-red, 178 58 46))' },
  xlsx: { bg: 'rgb(var(--tint-success-2, 228 241 234))', color: 'rgb(var(--status-green, 30 122 85))' },
  xls: { bg: 'rgb(var(--tint-success-2, 228 241 234))', color: 'rgb(var(--status-green, 30 122 85))' },
  docx: { bg: 'rgb(var(--status-blue-bg, 229 234 246))', color: 'rgb(var(--status-blue, 45 91 168))' },
  doc: { bg: 'rgb(var(--status-blue-bg, 229 234 246))', color: 'rgb(var(--status-blue, 45 91 168))' },
  dwg: { bg: 'rgb(var(--status-blue-bg, 229 234 246))', color: 'rgb(var(--status-blue, 45 91 168))' },
};
const EXT_FALLBACK = { bg: 'rgb(var(--sunken-2, 240 239 233))', color: 'rgb(var(--ink-2b, 110 114 105))' };

const STATUS_CHIP: Record<string, StatusKey> = { EXTRACTED: 'green', LINKED: 'blue', STORED: 'neutral', AWAITED: 'amber' };
const NEXT_STATUS: Record<string, 'EXTRACTED' | 'LINKED' | 'STORED'> = {
  EXTRACTED: 'LINKED',
  LINKED: 'STORED',
  STORED: 'EXTRACTED',
};

const STATUS_SUB: Record<string, string> = {
  EXTRACTED: 'Parsed by AI extraction',
  LINKED: 'Linked to appraisal',
  STORED: 'Stored — not yet extracted',
  AWAITED: 'Expected — no file received yet',
};

/**
 * Role as a person reads it. The access list itself is now fetched — it used to
 * be three hardcoded names shown to every workspace on the platform, which told
 * a firm that people it had never heard of could read its confidential room.
 */
const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Administrator',
  ANALYST: 'Analyst',
  SURVEYOR: 'Surveyor',
  VIEWER: 'Viewer',
};

/** A stable colour per person, derived from their id — never a random one. */
const AVATAR_GRADS = personGradients;
const gradOf = (id: string) => {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_GRADS[h % AVATAR_GRADS.length];
};

const ACTIVITY_DOTS = ['rgb(var(--brand-ink, 20 80 59))', statusTokens.blue.dot, 'rgb(var(--status-purple-dot, 155 121 192))', 'rgb(var(--status-green, 30 122 85))'];

const fmtDay = (d: Date | string) =>
  new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

const fmtWhen = (d: Date | string) => {
  const date = new Date(d);
  return `${fmtDay(date)} · ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
};

/** one answered (or unanswerable) workfile question, kept locally */
type AskEntry = { q: string; status: 'ok' | 'demo' | 'no-docs'; answer?: string; sources?: string[] };

export default function DataRoom() {
  const { dealId = '' } = useParams();
  const utils = trpc.useUtils();
  const toast = useToast();
  const { data: deal } = trpc.deals.get.useQuery(dealId, { enabled: !!dealId });

  const [folder, setFolder] = useState('all');
  const { data, isLoading } = trpc.documents.list.useQuery(
    { dealId, category: folder === 'all' ? undefined : folder },
    { enabled: !!dealId },
  );
  const { data: activity } = trpc.documents.activity.useQuery(dealId, { enabled: !!dealId });
  const accessQ = trpc.documents.access.useQuery(dealId, { enabled: !!dealId });

  const addDoc = trpc.documents.expect.useMutation({
    onSuccess: () => {
      utils.documents.list.invalidate();
      utils.documents.activity.invalidate(dealId);
      setDraft({ name: '', category: folder === 'all' ? 'Architectural' : folder });
      setFormOpen(false);
    },
  });
  /** the plots a document can be shared with — the buyer picker's options */
  const { data: unitsData } = trpc.sales.units.useQuery(dealId, { enabled: !!dealId });
  const units = unitsData?.units ?? [];
  const shareWithInvestors = trpc.documents.shareWithInvestors.useMutation({
    onSuccess: (r) => {
      utils.documents.list.invalidate();
      utils.documents.activity.invalidate(dealId);
      utils.documents.access.invalidate();
      toast.success(r.investorVisible ? 'Shared with investors' : 'No longer shared with investors');
    },
  });
  const shareWithBuyer = trpc.documents.shareWithBuyer.useMutation({
    onSuccess: (r) => {
      utils.documents.list.invalidate();
      // the access panel counts what buyers can reach, so it moves with this
      utils.documents.access.invalidate();
      toast.success(r.buyerVisible ? 'Shared with the buyer' : 'No longer shared with a buyer');
    },
  });
  const setExtraction = trpc.documents.setExtraction.useMutation({
    onSuccess: () => utils.documents.list.invalidate(),
  });

  // ---- Ask the workfile: AI Q&A over the deal's readable documents ----
  // this screen shows the error where it happened; see App.tsx
  const ask = trpc.documents.ask.useMutation({ meta: { inlineError: true } });
  const [question, setQuestion] = useState('');
  const [askHistory, setAskHistory] = useState<AskEntry[]>([]);
  const onAsk = async () => {
    const q = question.trim();
    if (q.length < 3 || ask.isPending) return;
    try {
      const res = await ask.mutateAsync({ dealId, question: q });
      setAskHistory((h) => [{ q, ...res }, ...h].slice(0, 3)); // last 3 Q&As, local only
      setQuestion('');
      if (res.status !== 'no-docs') utils.documents.activity.invalidate(dealId);
    } catch {
      /* surfaced via ask.error below */
    }
  };

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState({ name: '', category: 'Architectural' });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openForm = () => {
    setDraft((d) => ({ ...d, category: folder === 'all' ? 'Architectural' : folder }));
    setFormOpen(true);
  };

  const submitDoc = () => {
    if (!draft.name.trim() || addDoc.isPending) return;
    const name = draft.name.trim().includes('.') ? draft.name.trim() : `${draft.name.trim()}.pdf`;
    /**
     * This lists a document the deal is still waiting for. It used to invent a
     * file size between 120KB and 6MB and present the row as a stored file —
     * complete with a link to nothing — which in a room a lender reads is worse
     * than an obvious gap, because a gap gets chased.
     */
    addDoc.mutate({ dealId, name, category: draft.category });
  };

  /** real multipart upload to the API's local/S3-compatible store */
  const uploadFiles = async (files: FileList | File[]) => {
    setUploadError('');
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append('dealId', dealId);
        form.append('category', folder === 'all' ? 'Architectural' : folder);
        form.append('file', file);
        const res = await fetch('/uploads/document', {
          method: 'POST',
          headers: { authorization: `Bearer ${getToken() ?? ''}` },
          body: form,
        });
        if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      }
      utils.documents.list.invalidate();
      utils.documents.activity.invalidate(dealId);
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const docs = data?.documents ?? [];
  const totalBytes = data?.totalBytes ?? 0;
  const currentLabel = FOLDERS.find((f) => f.key === folder)?.label ?? 'All documents';
  const folderCount = (key: string) => (key === 'all' ? data?.counts.all ?? 0 : data?.counts.byCategory[key] ?? 0);

  return (
    <div className="min-h-screen">
      <TopBar
        crumb={
          <span>
            <Link to={`/deal/${dealId}/appraisal`} className="text-inactive hover:text-brand-ink">{deal?.name ?? 'Deal'}</Link>
            {' / '}Data room
          </span>
        }
        right={
          <Button onClick={openForm}>
            <span className="inline-flex" aria-hidden="true"><Icon d={UPLOAD_ICON} size={15} color={onFill} /></span> Upload
          </Button>
        }
      />
      <DealNav dealId={dealId} active="dataroom" />

      <div className="max-w-[1640px] mx-auto grid grid-cols-1 lg:[grid-template-columns:230px_minmax(0,1fr)_300px]" style={{ minHeight: 'calc(100vh - 56px)' }}>
        {/* folders */}
        <div className="bg-surface border-b lg:border-b-0 lg:border-r border-border-strong px-3.5 py-5">
          <div className="label-mono text-ink-3 px-2 pb-2.5">Folders</div>
          {FOLDERS.map((f) => {
            const on = folder === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setFolder(f.key)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[9px] mb-0.5 text-left transition-colors ${on ? 'bg-tint-success' : 'hover:bg-sunken'}`}
              >
                <span className="inline-flex shrink-0" aria-hidden="true">
                  <Icon d={FOLDER_ICON} size={16} color={on ? 'rgb(var(--brand-ink, 20 80 59))' : 'rgb(var(--ink-3, 154 160 154))'} strokeWidth={1.9} />
                </span>
                <span className={`flex-1 min-w-0 truncate text-[12.5px] ${on ? 'font-semibold text-brand-ink' : 'font-medium text-ink-2'}`}>{f.label}</span>
                {data ? (
                  <span className="fig text-[10px] font-medium text-ink-2b">{folderCount(f.key)}</span>
                ) : (
                  <Skeleton height={10} width={14} />
                )}
              </button>
            );
          })}
          <div className="mt-4 p-3 rounded-[11px] bg-canvas">
            <div className="fig text-[10px] uppercase text-ink-3">Storage</div>
            <div className="mt-2 h-1.5 rounded-[3px] bg-border-strong overflow-hidden">
              <div className="h-full bg-brand-700" style={{ width: `${Math.min(100, (totalBytes / QUOTA_BYTES) * 100)}%` }} />
            </div>
            <div className="mt-1.5 text-[11px] text-ink-3">{fmtBytes(totalBytes)} of 2 GB</div>
          </div>
        </div>

        {/* file list */}
        <div className="px-4 sm:px-6 py-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[32px] font-bold tracking-[-1.2px]">{currentLabel}</div>
              <div className="mt-0.5 text-[12.5px] text-ink-3">{docs.length} files · linked to Auto-Appraisal extraction</div>
            </div>
          </div>

          {/* dropzone — real uploads; click also opens the metadata-only form */}
          <input
            aria-label="Choose documents to upload to the data room"
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => e.target.files?.length && uploadFiles(e.target.files)}
          />
          <div
            tabIndex={0}
            className="border-[1.5px] border-dashed border-[rgb(var(--dashed,218_217_210))] rounded-[14px] p-5 mb-4 bg-sunken cursor-pointer"
            onClick={() => !formOpen && !uploading && fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && !formOpen && !uploading && e.target === e.currentTarget) {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!uploading && e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
            }}
          >
            <div className="flex items-center gap-3.5">
              <div className="w-[42px] h-[42px] rounded-[11px] bg-tint-success flex items-center justify-center shrink-0">
                {uploading ? <Spinner /> : <span className="inline-flex" aria-hidden="true"><Icon d={UPLOAD_ICON} size={20} color={brandInk} strokeWidth={1.9} /></span>}
              </div>
              <div className="flex-1">
                <div className="text-[13.5px] font-semibold">
                  {uploading ? 'Uploading…' : 'Drop drawings, cost plans or planning docs here'}
                </div>
                <div className="mt-0.5 text-[12px] text-ink-3">
                  PDF, DWG, XLSX · up to 100 MB. Documents feed the AI extraction.{' '}
                  <button
                    className="text-brand-ink font-semibold hover:text-brand-ink"
                    onClick={(e) => {
                      e.stopPropagation();
                      openForm();
                    }}
                  >
                    List one you are waiting for
                  </button>
                </div>
                {uploadError && <FormError className="mt-1 text-[11.5px]">{uploadError}</FormError>}
              </div>
            </div>
            {formOpen && (
              <div className="mt-4 pt-4 border-t border-border-std flex gap-2 items-center flex-wrap" onClick={(e) => e.stopPropagation()}>
                <input
                  aria-label="Name of the document you are waiting for"
                  autoFocus
                  className="flex-1"
                  placeholder="Document you are waiting for — e.g. Elemental cost plan v4.xlsx"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && submitDoc()}
                />
                <select aria-label="Document category" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
                  {CATEGORIES.map((c) => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))}
                </select>
                <Button writes onClick={submitDoc} disabled={!draft.name.trim()} loading={addDoc.isPending}>
                  {!addDoc.isPending && 'List as expected'}
                </Button>
                <Button variant="ghost" onClick={() => setFormOpen(false)}>Cancel</Button>
              </div>
            )}
          </div>

          {isLoading ? (
            <div className="bg-surface border border-border-strong rounded-card shadow-rest p-4">
              <SkeletonRows rows={6} height={20} />
            </div>
          ) : docs.length === 0 ? (
            <EmptyState title="This folder is empty" cta={<Button variant="secondary" onClick={openForm}>List an expected document</Button>}>
              Drop in contracts, reports and drawings — every uploaded document becomes part of the deal workfile. You can also list one you
              are still waiting for, so the gap is visible while it is chased.
            </EmptyState>
          ) : (
            <div className="bg-surface border border-border-strong rounded-card overflow-hidden shadow-rest">
              <div className="overflow-x-auto">
              <div className="min-w-[640px]">
              <div className="flex label-mono text-ink-3 border-b border-border-std" style={{ padding: '12px 18px' }}>
                <div style={{ flex: 3 }}>Name</div>
                <div style={{ flex: 1.2 }}>Type</div>
                <div style={{ flex: 1 }}>Added</div>
                <div style={{ flex: 1 }} className="text-right">Size</div>
                <div style={{ flex: 1 }} className="text-right">Investors</div>
                <div style={{ flex: 1.4 }} className="text-right">Buyer</div>
                <div style={{ flex: 1.2 }} className="text-right">Status</div>
              </div>
              {docs.map((d) => {
                const es = EXT_STYLE[d.ext.toLowerCase()] ?? EXT_FALLBACK;
                return (
                  <div key={d.id} className="flex items-center border-b border-border-faint last:border-b-0 hover:bg-sunken transition-colors" style={{ padding: '13px 18px' }}>
                    <div className="flex items-center gap-3" style={{ flex: 3 }}>
                      <div
                        className="fig w-[30px] h-[36px] rounded-[5px] flex items-center justify-center text-[8px] font-semibold uppercase shrink-0"
                        style={{ background: es.bg, color: es.color }}
                      >
                        {d.ext}
                      </div>
                      <div className="min-w-0">
                        {d.url ? (
                          <a href={d.url} target="_blank" rel="noreferrer" className="text-[13px] font-medium truncate block hover:text-brand-ink">
                            {d.name}
                          </a>
                        ) : (
                          <div className="text-[13px] font-medium truncate">{d.name}</div>
                        )}
                        <div className="text-[10.5px] text-ink-3">{STATUS_SUB[d.extraction] ?? ''}</div>
                      </div>
                    </div>
                    <div className="text-[12px] text-ink-2b" style={{ flex: 1.2 }}>{d.category}</div>
                    <div className="text-[12px] text-ink-2b" style={{ flex: 1 }}>{fmtDay(d.addedAt)}</div>
                    {/* an expected document has no size, because it has no file */}
                    <div className="fig text-right text-[11.5px] font-medium text-ink-3" style={{ flex: 1 }}>
                      {d.extraction === 'AWAITED' ? '—' : fmtBytes(d.sizeBytes)}
                    </div>
                    {/*
                      * Which plot's buyer sees this file, if any.
                      *
                      * `buyerVisible` existed from the first migration and
                      * NOTHING could set it — every document creator left it
                      * false and no procedure toggled it, so a firm paying for
                      * "Buyer + investor portals" had a buyer whose Documents to
                      * sign panel could only ever read "Nothing waiting for your
                      * signature". It takes a PLOT rather than a checkbox
                      * because the portal used to select by deal: a reservation
                      * pack for plot 1 is not plot 7's business, and one
                      * `signedAt` column cannot hold ten people's signatures.
                      */}
                    {/*
                      * Whether the deal's investors see this file. Deal-level
                      * where the buyer control is plot-level: an investor
                      * report is one document for the whole syndicate.
                      */}
                    <div className="flex justify-end" style={{ flex: 1 }}>
                      {d.extraction === 'AWAITED' ? (
                        <span className="text-[11.5px] text-ink-3">—</span>
                      ) : (
                        <input
                          type="checkbox"
                          aria-label={`Share ${d.name} with investors`}
                          className="w-4 h-4 cursor-pointer disabled:opacity-50"
                          disabled={shareWithInvestors.isPending}
                          // shows the choice while the write is in flight, so the box does not
                          // snap back for the refetch and read as a refusal
                          checked={
                            shareWithInvestors.isPending && shareWithInvestors.variables?.id === d.id
                              ? shareWithInvestors.variables.visible
                              : d.investorVisible
                          }
                          onChange={(e) => shareWithInvestors.mutate({ id: d.id, visible: e.target.checked })}
                        />
                      )}
                    </div>
                    <div className="flex justify-end" style={{ flex: 1.4 }}>
                      {d.extraction === 'AWAITED' ? (
                        <span className="text-[11.5px] text-ink-3">—</span>
                      ) : (
                        <select
                          aria-label={`Share ${d.name} with a buyer`}
                          className="max-w-full text-[11.5px] bg-sunken rounded-[7px] px-1.5 py-1 text-ink-2b disabled:opacity-50"
                          disabled={shareWithBuyer.isPending || !units.length}
                          value={d.buyerVisible ? (d.unitId ?? '') : ''}
                          onChange={(e) => shareWithBuyer.mutate({ id: d.id, unitId: e.target.value || null })}
                        >
                          <option value="">Not shared</option>
                          {units.map((u) => (
                            <option key={u.id} value={u.id}>{u.name}</option>
                          ))}
                        </select>
                      )}
                    </div>
                    <div className="flex justify-end" style={{ flex: 1.2 }}>
                      {d.extraction === 'AWAITED' ? (
                        // not cyclable: only an actual upload can make this a stored file
                        <StatusChip status="amber" label="AWAITED" />
                      ) : (
                        <button
                          title="Click to cycle extraction status"
                          className="cursor-pointer transition-opacity disabled:opacity-50"
                          disabled={setExtraction.isPending}
                          onClick={() => setExtraction.mutate({ id: d.id, status: NEXT_STATUS[d.extraction] ?? 'EXTRACTED' })}
                        >
                          <StatusChip status={STATUS_CHIP[d.extraction] ?? 'neutral'} label={d.extraction} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              </div>
              </div>
            </div>
          )}
        </div>

        {/* access + activity */}
        <div className="bg-surface border-t lg:border-t-0 lg:border-l border-border-strong" style={{ padding: '22px 18px' }}>
          <div className="text-[13px] font-semibold">Access</div>
          {accessQ.isLoading ? (
            <div className="mt-3"><Spinner /></div>
          ) : (
            <div className="mt-3 flex flex-col gap-2.5">
              {(accessQ.data?.team ?? []).map((a) => (
                <div key={a.id} className="flex items-center gap-2.5">
                  <span
                    className="w-[30px] h-[30px] rounded-full flex items-center justify-center text-white text-[10px] font-semibold shrink-0"
                    style={{ background: gradOf(a.id) }}
                  >
                    {a.initials}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-medium truncate">
                      {a.name}
                      {a.you && <span className="text-ink-3 font-normal"> · you</span>}
                    </div>
                    <div className="text-[10.5px] text-ink-3">{ROLE_LABEL[a.role] ?? a.role}</div>
                  </div>
                  <span className="fig text-[10px] font-medium text-ink-3">{a.permission}</span>
                </div>
              ))}
              {(accessQ.data?.investors ?? []).map((inv) => (
                <div key={inv.id} className="flex items-center gap-2.5">
                  <span
                    className="w-[30px] h-[30px] rounded-full flex items-center justify-center text-white text-[10px] font-semibold shrink-0"
                    style={{ background: gradOf(inv.id) }}
                  >
                    {inv.initials}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-medium truncate">{inv.name}</div>
                    <div className="text-[10.5px] text-ink-3">
                      Investor · {n0(accessQ.data!.investorDocuments)} shared document{accessQ.data!.investorDocuments === 1 ? '' : 's'}
                    </div>
                  </div>
                  <span className="fig text-[10px] font-medium text-ink-3">{inv.permission}</span>
                </div>
              ))}
              {/**
               * Buyers are counted rather than listed: each reaches only the
               * documents flagged for them, so naming them alongside people with
               * full access would overstate what they can see.
               */}
              {(accessQ.data?.buyers.accounts ?? 0) > 0 && (
                <div className="mt-1 text-[10.5px] leading-[1.45] text-ink-3">
                  {n0(accessQ.data!.buyers.accounts)} buyer{accessQ.data!.buyers.accounts === 1 ? '' : 's'} can reach{' '}
                  {n0(accessQ.data!.buyers.visibleDocuments)} document{accessQ.data!.buyers.visibleDocuments === 1 ? '' : 's'} marked visible
                  to them.
                </div>
              )}
            </div>
          )}

          <div className="mt-6 text-[13px] font-semibold">Ask the workfile</div>
          <div className="mt-1 text-[11px] text-ink-3">The AI answers from this deal's uploaded documents only.</div>
          <div className="mt-2.5 flex gap-2">
            <input
              aria-label="Ask a question of this deal's documents"
              className="flex-1 min-w-0"
              placeholder="e.g. What does the cost plan allow for M&E?"
              maxLength={500}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onAsk()}
            />
            <Button writes onClick={onAsk} disabled={question.trim().length < 3} loading={ask.isPending}>
              {!ask.isPending && 'Ask'}
            </Button>
          </div>
          {ask.error && <FormError className="mt-2 text-[11.5px]">{ask.error.message}</FormError>}
          <div className="mt-3 flex flex-col gap-3">
            {askHistory.map((entry, i) => (
              <div key={`${entry.q}-${i}`} className="bg-sunken border border-border-std rounded-[11px] p-3">
                <div className="text-[12px] font-semibold leading-snug">{entry.q}</div>
                {entry.status === 'no-docs' ? (
                  <div className="mt-1.5 text-[12px] text-ink-3 leading-normal">
                    Upload PDFs or images and the AI can answer from them.
                  </div>
                ) : (
                  <>
                    <div className="mt-1.5 text-[12px] text-ink-2 leading-normal whitespace-pre-wrap">
                      {entry.status === 'demo' && (
                        <span className="mr-1.5 align-middle"><StatusChip status="neutral" label="DEMO" /></span>
                      )}
                      {entry.answer}
                    </div>
                    {(entry.sources ?? []).length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="label-mono text-ink-3">Sources</span>
                        {entry.sources!.map((s) => (
                          <span key={s} className="fig text-[10px] font-medium text-ink-2b bg-surface border border-border-std rounded-[5px] px-1.5 py-0.5">
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="mt-6 text-[13px] font-semibold">Recent activity</div>
          <div className="mt-3">
            {(activity ?? []).length === 0 && <div className="text-[11.5px] text-ink-2b">No activity yet.</div>}
            {(activity ?? []).map((a, i) => (
              <div key={a.id} className="flex gap-2.5 pb-3.5">
                <div className="flex flex-col items-center">
                  <span className="w-2 h-2 rounded-full mt-1 shrink-0" style={{ background: ACTIVITY_DOTS[i % ACTIVITY_DOTS.length] }} />
                  <span className="flex-1 w-px bg-border-std mt-1" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] leading-normal">
                    <b className="font-semibold">{a.actor}</b> {a.action} {a.target}
                  </div>
                  <div className="fig mt-0.5 text-[10.5px] text-ink-2b">{fmtWhen(a.at)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

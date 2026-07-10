import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { StatusKey } from '@apex/ui-tokens';
import { getToken, trpc } from '../lib/trpc';
import { Button, EmptyState, Icon, Skeleton, SkeletonRows, Spinner, StatusChip, TopBar } from '../components/ui';
import { DealNav } from '../components/DealNav';

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
  pdf: { bg: '#F7E5E2', color: '#B23A2E' },
  xlsx: { bg: '#E4F1EA', color: '#1E7A55' },
  xls: { bg: '#E4F1EA', color: '#1E7A55' },
  docx: { bg: '#E5EAF6', color: '#2D5BA8' },
  doc: { bg: '#E5EAF6', color: '#2D5BA8' },
  dwg: { bg: '#E5EAF6', color: '#2D5BA8' },
};
const EXT_FALLBACK = { bg: '#F0EFE9', color: '#6E7269' };

const STATUS_CHIP: Record<string, StatusKey> = { EXTRACTED: 'green', LINKED: 'blue', STORED: 'neutral' };
const NEXT_STATUS: Record<string, 'EXTRACTED' | 'LINKED' | 'STORED'> = {
  EXTRACTED: 'LINKED',
  LINKED: 'STORED',
  STORED: 'EXTRACTED',
};

const STATUS_SUB: Record<string, string> = {
  EXTRACTED: 'Parsed by AI extraction',
  LINKED: 'Linked to appraisal',
  STORED: 'Stored — not yet extracted',
};

const ACCESS = [
  { initials: 'AO', name: 'Arthur O.', role: 'Owner', perm: 'Full', dot: 'linear-gradient(135deg,#1E7A55,#14503B)' },
  { initials: 'DW', name: 'Dana W.', role: 'Valuer (MRICS)', perm: 'Edit', dot: 'linear-gradient(135deg,#3C7FB5,#1F4E73)' },
  { initials: 'BF', name: 'Brookfield', role: 'Investor', perm: 'View', dot: 'linear-gradient(135deg,#9B79C0,#5E3F86)' },
];

const ACTIVITY_DOTS = ['#14503B', '#3C7FB5', '#9B79C0', '#1E7A55'];

function fmtBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

const fmtDay = (d: Date | string) =>
  new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

const fmtWhen = (d: Date | string) => {
  const date = new Date(d);
  return `${fmtDay(date)} · ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
};

export default function DataRoom() {
  const { dealId = '' } = useParams();
  const utils = trpc.useUtils();
  const { data: deal } = trpc.deals.get.useQuery(dealId, { enabled: !!dealId });

  const [folder, setFolder] = useState('all');
  const { data, isLoading } = trpc.documents.list.useQuery(
    { dealId, category: folder === 'all' ? undefined : folder },
    { enabled: !!dealId },
  );
  const { data: activity } = trpc.documents.activity.useQuery(dealId, { enabled: !!dealId });

  const addDoc = trpc.documents.add.useMutation({
    onSuccess: () => {
      utils.documents.list.invalidate();
      utils.documents.activity.invalidate(dealId);
      setDraft({ name: '', category: folder === 'all' ? 'Architectural' : folder });
      setFormOpen(false);
    },
  });
  const setExtraction = trpc.documents.setExtraction.useMutation({
    onSuccess: () => utils.documents.list.invalidate(),
  });

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
    // metadata only — no real file transfer; size is a plausible placeholder
    addDoc.mutate({ dealId, name, category: draft.category, sizeBytes: Math.round(120_000 + Math.random() * 6_000_000) });
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
            <Link to={`/deal/${dealId}/appraisal`} className="text-inactive hover:text-brand-700">{deal?.name ?? 'Deal'}</Link>
            {' / '}Data room
          </span>
        }
        right={
          <Button onClick={openForm}>
            <span className="inline-flex" aria-hidden="true"><Icon d={UPLOAD_ICON} size={15} color="#fff" /></span> Upload
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
                  <Icon d={FOLDER_ICON} size={16} color={on ? '#14503B' : '#9AA09A'} strokeWidth={1.9} />
                </span>
                <span className={`flex-1 min-w-0 truncate text-[12.5px] ${on ? 'font-semibold text-brand-700' : 'font-medium text-ink-2'}`}>{f.label}</span>
                {data ? (
                  <span className="fig text-[10px] font-medium text-ink-3b">{folderCount(f.key)}</span>
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
              <div className="text-[19px] font-bold tracking-[-0.4px]">{currentLabel}</div>
              <div className="mt-0.5 text-[12.5px] text-ink-3">{docs.length} files · linked to Auto-Appraisal extraction</div>
            </div>
          </div>

          {/* dropzone — real uploads; click also opens the metadata-only form */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => e.target.files?.length && uploadFiles(e.target.files)}
          />
          <div
            tabIndex={0}
            className="border-[1.5px] border-dashed border-[#DAD9D2] rounded-[14px] p-5 mb-4 bg-sunken cursor-pointer"
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
                {uploading ? <Spinner /> : <span className="inline-flex" aria-hidden="true"><Icon d={UPLOAD_ICON} size={20} color="#14503B" strokeWidth={1.9} /></span>}
              </div>
              <div className="flex-1">
                <div className="text-[13.5px] font-semibold">
                  {uploading ? 'Uploading…' : 'Drop drawings, cost plans or planning docs here'}
                </div>
                <div className="mt-0.5 text-[12px] text-ink-3">
                  PDF, DWG, XLSX · up to 100 MB. Documents feed the AI extraction.{' '}
                  <button
                    className="text-brand-500 font-semibold hover:text-brand-700"
                    onClick={(e) => {
                      e.stopPropagation();
                      openForm();
                    }}
                  >
                    Add by name instead
                  </button>
                </div>
                {uploadError && <div className="mt-1 text-[11.5px] text-status-red">{uploadError}</div>}
              </div>
            </div>
            {formOpen && (
              <div className="mt-4 pt-4 border-t border-border-std flex gap-2 items-center flex-wrap" onClick={(e) => e.stopPropagation()}>
                <input
                  autoFocus
                  className="flex-1"
                  placeholder="File name — e.g. Elemental cost plan v4.xlsx"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && submitDoc()}
                />
                <select aria-label="Document category" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
                  {CATEGORIES.map((c) => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))}
                </select>
                <Button onClick={submitDoc} disabled={!draft.name.trim() || addDoc.isPending}>
                  {addDoc.isPending ? <Spinner /> : 'Add document'}
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
            <EmptyState cta={<Button variant="secondary" onClick={openForm}>Upload a document</Button>}>
              No documents in this folder yet.
            </EmptyState>
          ) : (
            <div className="bg-surface border border-border-strong rounded-card overflow-hidden shadow-rest">
              <div className="overflow-x-auto">
              <div className="min-w-[560px]">
              <div className="flex label-mono text-ink-3 border-b border-border-std" style={{ padding: '12px 18px' }}>
                <div style={{ flex: 3 }}>Name</div>
                <div style={{ flex: 1.2 }}>Type</div>
                <div style={{ flex: 1 }}>Added</div>
                <div style={{ flex: 1 }} className="text-right">Size</div>
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
                          <a href={d.url} target="_blank" rel="noreferrer" className="text-[13px] font-medium truncate block hover:text-brand-700">
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
                    <div className="fig text-right text-[11.5px] font-medium text-ink-3" style={{ flex: 1 }}>{fmtBytes(d.sizeBytes)}</div>
                    <div className="flex justify-end" style={{ flex: 1.2 }}>
                      <button
                        title="Click to cycle extraction status"
                        className="cursor-pointer transition-opacity disabled:opacity-50"
                        disabled={setExtraction.isPending}
                        onClick={() => setExtraction.mutate({ id: d.id, status: NEXT_STATUS[d.extraction] ?? 'EXTRACTED' })}
                      >
                        <StatusChip status={STATUS_CHIP[d.extraction] ?? 'neutral'} label={d.extraction} />
                      </button>
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
          <div className="mt-3 flex flex-col gap-2.5">
            {ACCESS.map((a) => (
              <div key={a.initials} className="flex items-center gap-2.5">
                <span
                  className="w-[30px] h-[30px] rounded-full flex items-center justify-center text-white text-[10px] font-semibold shrink-0"
                  style={{ background: a.dot }}
                >
                  {a.initials}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-medium">{a.name}</div>
                  <div className="text-[10.5px] text-ink-3">{a.role}</div>
                </div>
                <span className="fig text-[10px] font-medium text-ink-3">{a.perm}</span>
              </div>
            ))}
          </div>

          <div className="mt-6 text-[13px] font-semibold">Recent activity</div>
          <div className="mt-3">
            {(activity ?? []).length === 0 && <div className="text-[11.5px] text-ink-3b">No activity yet.</div>}
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
                  <div className="fig mt-0.5 text-[10.5px] text-ink-3b">{fmtWhen(a.at)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

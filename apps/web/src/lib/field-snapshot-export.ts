/** Historical context, deliberately separate from financial input acceptance. */
export interface FieldSnapshotExport {
  capturedAt: string;
  capturedBy: string;
  capturedById: string;
  tasks: Array<{
    id: string; title: string; done: boolean;
    inspectionEvidence: null | {
      inspectionId: string; sourceUpdatedAt: string; capturedAt: string; roomIndex: number;
      room: { name: string; notes: string; condition: number };
    };
  }>;
}

export function fieldSnapshotLines(snapshot: FieldSnapshotExport | null | undefined, state?: string,
  version?: { id: string; label: string }, unsavedInputs?: boolean): string[] {
  if (state === 'unverified') return ['FIELD SNAPSHOT UNVERIFIED: the saved version could not be confirmed for this editor. No historical evidence is asserted.'];
  if (state === 'unreadable') return ['FIELD SNAPSHOT UNREADABLE: stored evidence could not be read. Its contents and status cannot be confirmed.'];
  if (!snapshot) return ['No field snapshot is attached to this version. This does not mean the project has no field observations.'];
  const lines = [
    'HISTORICAL FIELD CONTEXT — not approval, input acceptance, a financial adjustment or a complete inspection.',
    'Task status is fixed at capture; later task and inspection changes are not reflected. Photos are not included.',
    ...(unsavedInputs ? ['UNSAVED INPUTS: workbook figures include editor changes. This historical snapshot does not confirm those inputs.'] : []),
    ...(version ? [`Appraisal version: ${version.label} | ID: ${version.id}`] : []),
    `Captured by: ${snapshot.capturedBy} | Member ID: ${snapshot.capturedById}`,
    `Snapshot captured at (UTC): ${snapshot.capturedAt}`,
  ];
  for (const task of snapshot.tasks) {
    lines.push(`Task: ${task.title}`, `Task ID: ${task.id} | ${task.done ? 'Completed' : 'Open'} at capture`);
    const e = task.inspectionEvidence;
    if (!e) { lines.push('No inspection observation was attached to this task at capture.'); continue; }
    lines.push(`Inspection ID: ${e.inspectionId} | Room index: ${e.roomIndex} (zero-based)`,
      `Inspection source updated at (UTC): ${e.sourceUpdatedAt}`,
      `Observation captured at (UTC): ${e.capturedAt}`,
      `Room: ${e.room.name} | Recorded condition: ${e.room.condition ? `${e.room.condition}/5` : 'not rated'}`,
      `Observation: ${e.room.notes || '(No note recorded)'}`);
  }
  return lines;
}

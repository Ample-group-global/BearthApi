export interface ExportState {
  status: 'running' | 'done' | 'error';
  progress: number;
  total: number;
  phase: string;
  error?: string;
}

export interface RefreshCidState {
  status: 'running' | 'done' | 'error';
  progress: number;
  total: number;
  resolved: number;
  skipped: number;
  phase: string;
  error?: string;
}

export interface PreviewState {
  status: 'running' | 'done' | 'error';
  progress: number;
  total: number;
  phase: string;
  validCount: number;
  invalidItems: Array<{ edition: number; reason: string }>;
  error?: string;
}

// Mutable containers stored as object properties — importers can reassign
// `.running` without hitting the ES-module "live binding is read-only" error
// that would occur with `export let running = false`.
export const exportMeta = {
  running: false,
  jobs: new Map<string, ExportState>(),
};

export const refreshCidMeta = {
  running: false,
  jobs: new Map<string, RefreshCidState>(),
};

export const previewMeta = {
  jobs: new Map<string, PreviewState & { dir: string }>(),
};

// Tracks pre-built ZIP location for each export job so the download endpoint
// can return a pre-signed URL instead of streaming from scratch.
// key = jobId, value = { bucket, zipKey }
export const zipRegistry = new Map<string, { bucket: string; zipKey: string }>();

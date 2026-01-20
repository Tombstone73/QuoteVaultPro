import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * Prepress API Hooks
 * 
 * React Query hooks for interacting with the prepress service.
 */

export interface PrepressJob {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  mode: 'check' | 'check_and_fix';
  originalFilename: string;
  sizeBytes: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  expiresAt: string;
  reportSummary: {
    score: number;
    counts: {
      BLOCKER: number;
      WARNING: number;
      INFO: number;
    };
    pageCount: number;
  } | null;
  outputManifest: {
    report_json: boolean;
    proof_png: boolean;
    fixed_pdf?: boolean;
  } | null;
  error: {
    message: string;
    code: string;
  } | null;
  progressMessage: string | null;
}

/**
 * Fetch list of all prepress jobs for current org
 */
export function usePrepressJobList() {
  return useQuery({
    queryKey: ['prepress', 'jobs'],
    queryFn: async () => {
      const response = await fetch('/api/prepress/jobs');
      
      if (!response.ok) {
        throw new Error('Failed to fetch jobs');
      }
      
      const result = await response.json();
      return result.data as PrepressJob[];
    },
    refetchInterval: (query) => {
      // Stop polling if query is in error state to prevent spam
      return query?.state?.status === 'error' ? false : 10000;
    },
  });
}

/**
 * Create a new prepress job
 */
export function useCreatePrepressJob() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (data: { file: File; mode: 'check' | 'check_and_fix' }) => {
      const formData = new FormData();
      formData.append('file', data.file);
      formData.append('mode', data.mode);
      
      const response = await fetch('/api/prepress/jobs', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to create job');
      }
      
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prepress'] });
    },
  });
}

/**
 * Fetch job status
 */
export function usePrepressJob(jobId: string | null) {
  return useQuery({
    queryKey: ['prepress', 'job', jobId],
    queryFn: async () => {
      if (!jobId) return null;
      
      const response = await fetch(`/api/prepress/jobs/${jobId}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch job');
      }
      
      return await response.json() as PrepressJob;
    },
    enabled: !!jobId,
    refetchInterval: (data) => {
      // Poll every 2s while running/queued, stop when complete
      if (!data || typeof data !== 'object') return false;
      return ['queued', 'running'].includes((data as PrepressJob).status) ? 2000 : false;
    },
  });
}

/**
 * Fetch full report
 */
export function usePrepressReport(jobId: string | null) {
  return useQuery({
    queryKey: ['prepress', 'report', jobId],
    queryFn: async () => {
      if (!jobId) return null;
      
      const response = await fetch(`/api/prepress/jobs/${jobId}/report`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch report');
      }
      
      return await response.json();
    },
    enabled: !!jobId,
  });
}

/**
 * Download output file
 */
export function downloadPrepressOutput(jobId: string, kind: 'report_json' | 'proof_png' | 'fixed_pdf') {
  const url = `/api/prepress/jobs/${jobId}/download/${kind}`;
  const link = document.createElement('a');
  link.href = url;
  link.download = `${jobId}-${kind}`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Fetch job findings
 */
export function usePrepressFindings(jobId: string | null) {
  return useQuery({
    queryKey: ['prepress', 'findings', jobId],
    queryFn: async () => {
      if (!jobId) return null;
      
      const response = await fetch(`/api/prepress/jobs/${jobId}/findings`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch findings');
      }
      
      const result = await response.json();
      return result.data as PrepressFinding[];
    },
    enabled: !!jobId,
  });
}

/**
 * Fetch job fix logs
 */
export function usePrepressFixLogs(jobId: string | null) {
  return useQuery({
    queryKey: ['prepress', 'fixes', jobId],
    queryFn: async () => {
      if (!jobId) return null;
      
      const response = await fetch(`/api/prepress/jobs/${jobId}/fixes`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch fix logs');
      }
      
      const result = await response.json();
      return result.data as PrepressFixLog[];
    },
    enabled: !!jobId,
  });
}

/**
 * Type definitions for findings and fixes
 */
export interface PrepressFinding {
  id: string;
  prepressJobId: string;
  findingType: 'missing_dpi' | 'spot_color_detected' | 'font_not_embedded' | 'low_resolution_image' | 'rgb_colorspace' | 'transparency_detected' | 'other';
  severity: 'blocker' | 'warning' | 'info';
  message: string;
  pageNumber?: number;
  artboardName?: string;
  objectReference?: string;
  spotColorName?: string;
  colorModel?: string;
  detectedDpi?: number;
  requiredDpi?: number;
  metadata?: any;
  createdAt: string;
}

export interface PrepressFixLog {
  id: string;
  prepressJobId: string;
  fixType: 'rgb_to_cmyk' | 'normalize_dpi' | 'flatten_transparency' | 'embed_fonts' | 'remove_spot_color' | 'pdf_normalize' | 'other';
  description: string;
  fixedByUserId?: string;
  beforeSnapshot?: any;
  afterSnapshot?: any;
  createdAt: string;
}

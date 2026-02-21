import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, RefreshCw, History, FileText, Download, ZoomIn, Upload, Check, Lock, Image as ImageIcon, Info, Paperclip, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

import { formatDistanceToNow } from "date-fns";

// API Types
type QueueItem = {
  lineItemId: string;
  jobNumber: string;
  customerName: string;
  productName: string;
  printType: string | null;
  media: string | null;
  dueDate: string | null;
  status: string;
  rush: boolean;
  assignedTo: string | null;
  lockedBy: string | null;
  sessionId: string | null;
  fileCounts: {
    originals: number;
    finals: number;
  };
  // Job specs for detail view
  quantity: number;
  width: number | null;
  height: number | null;
  sqFootage: number | null;
  bleed: string | null;
  finishing: string | null;
};

type LineItemFile = {
  id: string;
  role: "original" | "final" | "reference";
  originalFilename: string;
  sizeBytes: number;
  tag: string | null;
  createdAt: string;
  uploadedBy: string;
};

type UploadProgress = {
  id: string;
  filename: string;
  progress: number;
};

// Utility to format bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export default function PrepressProductionPageV2() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // UI State
  const [selectedLineItemId, setSelectedLineItemId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [printTypeFilter, setPrintTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [rushFilter, setRushFilter] = useState(false);
  const [sortBy, setSortBy] = useState("due_date");
  const [sortAsc, setSortAsc] = useState(true);
  const [prepressNotes, setPrepressNotes] = useState("");
  const [flagForQc, setFlagForQc] = useState(false);
  const [issueType, setIssueType] = useState("");
  const [selectedTag, setSelectedTag] = useState("final_print");
  const [uploadingFiles, setUploadingFiles] = useState<UploadProgress[]>([]);

  // Queue Query
  const { data: queueData, isLoading: queueLoading } = useQuery({
    queryKey: ["/api/prepress/queue", { search: searchQuery, printType: printTypeFilter, status: statusFilter, rush: rushFilter, sortBy, sortAsc }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.set("search", searchQuery);
      if (printTypeFilter !== "all") params.set("printType", printTypeFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (rushFilter) params.set("rush", "true");
      params.set("sortBy", sortBy);
      params.set("sortOrder", sortAsc ? "asc" : "desc");
      
      const res = await fetch(`/api/prepress/queue?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch queue");
      const data = await res.json();
      console.log("[Prepress Queue]", data.items?.length || 0, "items");
      return data.items as QueueItem[];
    },
    refetchInterval: 30000, // Refresh every 30s
  });

  // Line Item Files Query
  const { data: filesData } = useQuery({
    queryKey: ["/api/prepress/line-item", selectedLineItemId, "files"],
    queryFn: async () => {
      if (!selectedLineItemId) return null;
      const res = await fetch(`/api/prepress/line-item/${selectedLineItemId}/files`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch files");
      const data = await res.json();
      console.log("[Line Item Files]", data.files?.length || 0, "files");
      return data.files as LineItemFile[];
    },
    enabled: !!selectedLineItemId,
  });

  // Mutations
  const startSessionMutation = useMutation({
    mutationFn: async (lineItemId: string) => {
      const res = await fetch("/api/prepress/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ lineItemId }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to start session");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prepress/queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/prepress/line-item", selectedLineItemId] });
      toast({ title: "Prepress started", description: "Session created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const saveNoteMutation = useMutation({
    mutationFn: async ({ sessionId, note, flaggedForQc, issueType }: { sessionId: string; note: string; flaggedForQc: boolean; issueType: string }) => {
      const res = await fetch(`/api/prepress/session/${sessionId}/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ note, flaggedForQc, issueType }),
      });
      if (!res.ok) throw new Error("Failed to save note");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Notes saved", description: "Prepress notes updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const completeSessionMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await fetch(`/api/prepress/session/${sessionId}/complete`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to complete prepress");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prepress/queue"] });
      setSelectedLineItemId(null);
      toast({ title: "Prepress complete", description: "Job marked complete and moved to production" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const uploadFileMutation = useMutation({
    mutationFn: async ({ lineItemId, file, role, tag }: { lineItemId: string; file: File; role: string; tag: string }) => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("lineItemId", lineItemId);
      formData.append("role", role);
      if (tag) formData.append("tag", tag);

      const uploadId = Math.random().toString();
      setUploadingFiles(prev => [...prev, { id: uploadId, filename: file.name, progress: 0 }]);

      const res = await fetch("/api/prepress/files/upload", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      setUploadingFiles(prev => prev.filter(u => u.id !== uploadId));

      if (!res.ok) throw new Error("Upload failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prepress/line-item", selectedLineItemId] });
      toast({ title: "Upload complete", description: "File uploaded successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    },
  });

  // Derived state
  const queue = queueData || [];
  const selectedItem = queue.find(q => q.lineItemId === selectedLineItemId);
  const originalFiles = filesData?.filter(f => f.role === "original") || [];
  const finalFiles = filesData?.filter(f => f.role === "final") || [];
  const hasFinalFiles = finalFiles.length > 0;
  const canComplete = hasFinalFiles && selectedItem?.sessionId && !selectedItem?.lockedBy;
  const isLocked = selectedItem?.lockedBy && !selectedItem?.sessionId;

  // Handlers
  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/prepress/queue"] });
  };

  const handleStartPrepress = () => {
    if (selectedItem) {
      startSessionMutation.mutate(selectedItem.lineItemId);
    }
  };

  const handleSaveNotes = () => {
    if (selectedItem?.sessionId) {
      saveNoteMutation.mutate({
        sessionId: selectedItem.sessionId,
        note: prepressNotes,
        flaggedForQc: flagForQc,
        issueType: flagForQc ? issueType : "",
      });
    }
  };

  const handleComplete = () => {
    if (selectedItem?.sessionId && canComplete) {
      completeSessionMutation.mutate(selectedItem.sessionId);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || !selectedLineItemId) return;

    Array.from(files).forEach(file => {
      uploadFileMutation.mutate({
        lineItemId: selectedLineItemId,
        file,
        role: "final",
        tag: selectedTag,
      });
    });

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDownloadFile = (fileId: string) => {
    window.open(`/api/prepress/files/${fileId}/download`, "_blank");
  };

  const handleDownloadAllOriginals = () => {
    if (selectedLineItemId) {
      window.open(`/api/prepress/line-item/${selectedLineItemId}/download-originals-zip`, "_blank");
    }
  };

  return (
    <div className="h-screen flex bg-[#111921] text-slate-100 font-sans overflow-hidden">
      {/* LEFT COLUMN: Prepress Queue */}
      <aside className="w-[400px] flex-shrink-0 border-r border-[#2d3748] flex flex-col h-full bg-[#1a232e]/50">
        {/* Header & Search */}
        <div className="p-4 border-b border-[#2d3748] space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold tracking-tight">Prepress Queue</h1>
              <p className="text-xs text-slate-400">TitanOS ERP Production v2.4</p>
            </div>
            <button onClick={handleRefresh} className="p-2 hover:bg-white/10 rounded-lg transition-colors" disabled={queueLoading}>
              <RefreshCw className={cn("w-4 h-4", queueLoading && "animate-spin")} />
            </button>
          </div>

          {/* Filters */}
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#111921] border-[#2d3748] rounded-lg pl-10 text-sm focus:ring-[#1773cf] focus:border-[#1773cf] h-9"
                placeholder="Search Job #, Customer, Product..."
              />
            </div>

            <div className="flex gap-2">
              <Select value={printTypeFilter} onValueChange={setPrintTypeFilter}>
                <SelectTrigger className="flex-1 bg-[#111921] border-[#2d3748] rounded-lg text-xs py-1 h-8 focus:ring-[#1773cf] focus:border-[#1773cf]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Print Type: All</SelectItem>
                  <SelectItem value="flatbed">Flatbed</SelectItem>
                  <SelectItem value="roll">Roll</SelectItem>
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="flex-1 bg-[#111921] border-[#2d3748] rounded-lg text-xs py-1 h-8 focus:ring-[#1773cf] focus:border-[#1773cf]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Status: All</SelectItem>
                  <SelectItem value="pending_prepress">Pending</SelectItem>
                  <SelectItem value="in_prepress">In Prepress</SelectItem>
                </SelectContent>
              </Select>

              <button
                onClick={() => setRushFilter(!rushFilter)}
                className={cn(
                  "px-2 py-1 bg-[#111921] border rounded-lg text-[10px] font-bold transition-colors flex items-center gap-1 h-8",
                  rushFilter ? "border-[#e53e3e] text-[#e53e3e]" : "border-[#2d3748] text-slate-400 hover:border-[#e53e3e] hover:text-[#e53e3e]"
                )}
              >
                <span className={cn("w-2 h-2 rounded-full", rushFilter ? "bg-[#e53e3e]" : "bg-slate-600")}></span>
                RUSH
              </button>
            </div>
          </div>

          {/* Sort Controls */}
          <div className="flex items-center justify-between pt-2 border-t border-[#2d3748]/30">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase font-bold text-slate-500 tracking-tighter">Sort By:</span>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="bg-transparent border-none text-[11px] font-medium text-slate-300 p-0 focus:ring-0 h-auto w-auto">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="due_date">Due Date</SelectItem>
                  <SelectItem value="job_number">Job #</SelectItem>
                  <SelectItem value="client">Client</SelectItem>
                  <SelectItem value="type">Type</SelectItem>
                  <SelectItem value="material">Material</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <button
              onClick={() => setSortAsc(!sortAsc)}
              className="flex items-center justify-center p-1 text-slate-500 hover:text-[#1773cf] transition-colors hover:bg-white/5 rounded"
            >
              <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            </button>
          </div>
        </div>

        {/* Job List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {jobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              isSelected={selectedJobId === job.id}
              onClick={() => setSelectedJobId(job.id)}
            />
          ))}
        </div>
      </aside>

      {/* RIGHT COLUMN: Main Workspace */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-[#111921]">
        {/* Workspace Header */}
        <header className="p-6 border-b border-[#2d3748] bg-[#1a232e]/30 flex justify-between items-center">
          <div className="flex items-center gap-6">
            <div>
              <h2 className="text-2xl font-black text-white">JOB-94028</h2>
              <div className="flex items-center gap-2 mt-1">
                <span className="bg-[#1773cf]/20 text-[#1773cf] text-[10px] font-bold px-2 py-0.5 rounded border border-[#1773cf]/30 uppercase tracking-widest">
                  In Prepress
                </span>
                <span className="text-slate-400 text-xs">Assigned to: Alex M.</span>
              </div>
            </div>
            <div className="h-10 w-px bg-[#2d3748]"></div>
            <div className="flex gap-8">
              <div>
                <p className="text-[10px] uppercase text-slate-500 font-bold tracking-tighter">Customer</p>
                <p className="text-sm font-semibold">Global Logistics Solutions</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-slate-500 font-bold tracking-tighter">Due Date</p>
                <p className="text-sm font-semibold text-[#e53e3e]">Oct 24, 2023 (Today)</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button className="flex items-center gap-2 text-xs text-slate-400 hover:text-white transition-colors">
              <History className="w-4 h-4" /> History
            </button>
            <button className="flex items-center gap-2 text-xs text-slate-400 hover:text-white transition-colors">
              <FileText className="w-4 h-4" /> Spec Sheet
            </button>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8 pb-32">
          {/* Section 1: Job Specifications */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4 flex items-center gap-2">
              <Info className="w-4 h-4" /> Job Specifications
            </h3>
            <div className="grid grid-cols-4 lg:grid-cols-6 gap-4 bg-[#1a232e] p-5 border border-[#2d3748] rounded-lg shadow-sm">
              <div>
                <p className="text-[10px] text-slate-500 uppercase font-bold">Product</p>
                <p className="text-sm font-medium">Vinyl Banner</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase font-bold">Size</p>
                <p className="text-sm font-medium">120" x 48"</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase font-bold">Qty</p>
                <p className="text-sm font-medium">5 units</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase font-bold">Sq Footage</p>
                <p className="text-sm font-medium text-[#1773cf]">500.0 sq ft</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase font-bold">Media</p>
                <p className="text-sm font-medium">13oz Scrim Vinyl</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase font-bold">Print Type</p>
                <p className="text-sm font-medium">Roll-to-Roll</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase font-bold">Bleed</p>
                <p className="text-sm font-medium">0.5" All Sides</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase font-bold">Registration</p>
                <p className="text-sm font-medium">Grommets @ 24"</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 uppercase font-bold">Priority</p>
                <p className="text-sm font-bold text-[#e53e3e]">RUSH</p>
              </div>
            </div>
          </section>

          {/* Section 2: Original Customer Files */}
          <section>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
                <Paperclip className="w-4 h-4" /> Original Customer Files
              </h3>
              <button className="text-xs font-bold text-[#1773cf] hover:underline flex items-center gap-1">
                <Download className="w-4 h-4" /> Download All
              </button>
            </div>
            <div className="border border-[#2d3748] rounded-lg overflow-hidden bg-[#1a232e]">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#111921] border-b border-[#2d3748] text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-semibold w-24">Preview</th>
                    <th className="px-4 py-3 font-semibold">Filename</th>
                    <th className="px-4 py-3 font-semibold">Size</th>
                    <th className="px-4 py-3 font-semibold">Upload Date</th>
                    <th className="px-4 py-3 font-semibold">Uploaded By</th>
                    <th className="px-4 py-3 font-semibold">Tag</th>
                    <th className="px-4 py-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2d3748]">
                  {originalFiles.map((file) => (
                    <tr key={file.id} className="hover:bg-white/5 transition-colors group cursor-pointer">
                      <td className="px-4 py-3">
                        <FileThumbnail filename={file.filename} />
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-200">{file.filename}</td>
                      <td className="px-4 py-3 font-mono">{file.size}</td>
                      <td className="px-4 py-3">{file.uploadDate}</td>
                      <td className="px-4 py-3">{file.uploadedBy}</td>
                      <td className="px-4 py-3">
                        <span className="bg-slate-700 px-2 py-0.5 rounded">{file.tag}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button className="bg-[#111921] border border-[#2d3748] px-3 py-1 rounded hover:bg-[#1773cf]/20 hover:border-[#1773cf] transition-all">
                          Download
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Section 3: Final Production Files */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4 flex items-center gap-2">
              <CheckCircle className="w-4 h-4" /> Final Production Files
            </h3>

            {/* Existing Final Files */}
            <div className="border border-[#2d3748] rounded-lg overflow-hidden bg-[#1a232e] mb-4">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#111921] border-b border-[#2d3748] text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-semibold w-24">Preview</th>
                    <th className="px-4 py-3 font-semibold">File Info</th>
                    <th className="px-4 py-3 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2d3748]">
                  {finalFiles.map((file) => (
                    <tr key={file.id} className="hover:bg-white/5 transition-colors cursor-pointer">
                      <td className="px-4 py-3">
                        <div className="relative w-20 h-20 rounded-lg border border-[#2d3748] overflow-hidden bg-[#111921] flex items-center justify-center group">
                          <div className="absolute inset-0 bg-slate-700 flex items-center justify-center">
                            <ImageIcon className="w-8 h-8 text-slate-500" />
                          </div>
                          <div className="absolute top-1 right-1 w-5 h-5 bg-green-500 rounded-full border-2 border-[#1a232e] flex items-center justify-center shadow-lg">
                            <Check className="w-3 h-3 text-white" />
                          </div>
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                            <ZoomIn className="w-5 h-5 text-white" />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-1">
                          <p className="font-bold text-slate-200">{file.filename}</p>
                          <div className="flex items-center gap-3">
                            <span className="bg-[#1773cf]/30 text-[#1773cf] border border-[#1773cf]/40 px-2 py-0.5 rounded font-bold uppercase text-[9px]">
                              {file.tag}
                            </span>
                            <span className="text-slate-500 font-mono">{file.size}</span>
                            <span className="text-slate-400 italic">
                              Uploaded by {file.uploadedBy} ({file.uploadDate})
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right space-x-2">
                        <button className="text-slate-400 hover:text-white p-1">
                          <Download className="w-5 h-5" />
                        </button>
                        <button className="text-slate-400 hover:text-[#e53e3e] p-1">
                          <RefreshCw className="w-5 h-5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Drag & Drop Upload Zone */}
            <div className="border-2 border-dashed border-[#2d3748] rounded-xl p-8 bg-[#1a232e]/20 flex flex-col items-center justify-center text-center hover:border-[#1773cf]/50 hover:bg-[#1773cf]/5 transition-all group">
              <div className="w-12 h-12 bg-[#1a232e] border border-[#2d3748] rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Upload className="w-6 h-6 text-[#1773cf]" />
              </div>
              <p className="text-sm font-semibold mb-1">Drag and drop final production files here</p>
              <p className="text-xs text-slate-500 mb-6">PDF, TIF, JPG, or EPS up to 2GB</p>
              <div className="flex items-center gap-4">
                <Select defaultValue="final_print">
                  <SelectTrigger className="bg-[#111921] border-[#2d3748] rounded-lg text-xs py-2 px-4 focus:ring-[#1773cf] focus:border-[#1773cf] w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="final_print">Select Tag: FINAL_PRINT</SelectItem>
                    <SelectItem value="proof_only">PROOF_ONLY</SelectItem>
                    <SelectItem value="cut_file">CUT_FILE</SelectItem>
                  </SelectContent>
                </Select>
                <Button className="bg-[#1773cf] text-white text-sm font-bold px-6 py-2 rounded-lg hover:bg-[#1773cf]/90 transition-colors shadow-lg">
                  Choose File
                </Button>
              </div>

              {/* Recently Uploaded */}
              <div className="w-full mt-8 border-t border-[#2d3748]/50 pt-6">
                <p className="text-[10px] uppercase font-bold text-slate-500 mb-4 text-left">
                  Recently Uploaded / In Progress
                </p>
                <div className="flex gap-4">
                  {/* Uploading Item */}
                  <div className="w-24 flex flex-col gap-2">
                    <div className="w-24 h-24 rounded-lg border border-[#1773cf]/50 bg-[#1773cf]/5 flex items-center justify-center relative overflow-hidden">
                      <Upload className="w-6 h-6 text-[#1773cf] animate-pulse" />
                    </div>
                    <div className="w-full bg-slate-800 h-1 rounded-full overflow-hidden">
                      <div className="bg-[#1773cf] h-full w-2/3"></div>
                    </div>
                    <p className="text-[10px] text-slate-400 truncate">Uploading...</p>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Section 4: Prepress Notes + QC Flagging */}
          <section>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" /> Prepress Notes + QC Flagging
            </h3>
            <div className="grid grid-cols-2 gap-6">
              {/* Left: Notes */}
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-2">Production Notes</label>
                  <Textarea
                    value={prepressNotes}
                    onChange={(e) => setPrepressNotes(e.target.value)}
                    className="w-full bg-[#111921] border-[#2d3748] rounded-lg text-sm focus:ring-[#1773cf] focus:border-[#1773cf] min-h-[120px] resize-none"
                    placeholder="Add prepress notes, color corrections, adjustments..."
                  />
                </div>
                <Button className="bg-[#1a232e] border border-[#2d3748] text-slate-300 hover:bg-[#2d3748] w-full">
                  Save Notes
                </Button>
              </div>

              {/* Right: QC Flagging */}
              <div className="space-y-4">
                <div className="flex items-start gap-3 p-4 bg-[#1a232e] border border-[#2d3748] rounded-lg">
                  <Checkbox
                    id="qc-flag"
                    checked={flagForQc}
                    onCheckedChange={(checked) => setFlagForQc(checked as boolean)}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <label htmlFor="qc-flag" className="text-sm font-semibold text-white cursor-pointer block">
                      Flag for Quality Control Review
                    </label>
                    <p className="text-xs text-slate-500 mt-1">
                      Mark this job for additional QC inspection before final approval
                    </p>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-400 block mb-2">Issue Type (Optional)</label>
                  <Select value={issueType} onValueChange={setIssueType} disabled={!flagForQc}>
                    <SelectTrigger className="bg-[#111921] border-[#2d3748] rounded-lg text-sm focus:ring-[#1773cf] focus:border-[#1773cf]">
                      <SelectValue placeholder="Select issue type..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="color">Color Mismatch</SelectItem>
                      <SelectItem value="resolution">Resolution Issue</SelectItem>
                      <SelectItem value="artwork">Artwork Problem</SelectItem>
                      <SelectItem value="specs">Spec Clarification Needed</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-slate-600 mt-2">
                    Flagged jobs will appear in the QC queue for manager review
                  </p>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Sticky Footer */}
        <div className="border-t border-[#2d3748] bg-[#1a232e]/95 backdrop-blur-sm p-4 flex items-center justify-between sticky bottom-0">
          <div className="flex items-center gap-4">
            {hasFinalFiles ? (
              <div className="flex items-center gap-2 text-green-500">
                <CheckCircle className="w-4 h-4" />
                <span className="text-xs font-medium">Final file detected</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-amber-500">
                <AlertCircle className="w-4 h-4" />
                <span className="text-xs font-medium">No final files uploaded</span>
              </div>
            )}
            <button className="text-xs font-medium text-[#1773cf] hover:underline">
              Release Lock
            </button>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              className="bg-transparent border-[#2d3748] text-slate-300 hover:bg-[#2d3748] hover:text-white"
            >
              Start Prepress
            </Button>
            <Button
              disabled={!hasFinalFiles}
              className={cn(
                "font-bold shadow-lg transition-all",
                hasFinalFiles
                  ? "bg-[#1773cf] text-white hover:bg-[#1773cf]/90"
                  : "bg-slate-700 text-slate-500 cursor-not-allowed"
              )}
            >
              Mark Prepress Complete
              <svg className="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
}

function JobCard({ job, isSelected, onClick }: { job: Job; isSelected: boolean; onClick: () => void }) {
  const statusConfig = {
    in_prepress: {
      label: "IN PREPRESS",
      bgClass: "bg-[#1773cf]/20",
      textClass: "text-[#1773cf]",
      borderClass: "border-[#1773cf]/30",
    },
    locked: {
      label: "LOCKED",
      bgClass: "bg-slate-700/50",
      textClass: "text-slate-400",
      borderClass: "border-[#2d3748]",
    },
    pending: {
      label: "PENDING",
      bgClass: "bg-slate-700",
      textClass: "text-slate-300",
      borderClass: "border-[#2d3748]",
    },
  };

  const config = statusConfig[job.status];

  return (
    <div
      onClick={job.status !== "locked" ? onClick : undefined}
      className={cn(
        "p-2 rounded-lg flex gap-3 transition-colors relative",
        job.status === "locked" && "opacity-70 cursor-not-allowed",
        job.status !== "locked" && "cursor-pointer",
        isSelected && "bg-[#1773cf]/10 border-l-4 border-[#1773cf] rounded-l-none rounded-r-lg",
        !isSelected && job.status === "locked" && "bg-[#1a232e]/50 border border-[#2d3748]",
        !isSelected && job.status !== "locked" && "bg-[#1a232e] border border-[#2d3748] hover:border-[#1773cf]/50"
      )}
    >
      <div className="relative w-16 h-16 flex-shrink-0 rounded-lg border border-[#2d3748] overflow-hidden bg-[#111921] flex items-center justify-center group">
        {job.status === "locked" ? (
          <>
            <svg className="w-6 h-6 text-[#d69e2e]/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <div className="absolute bottom-0 right-0 bg-[#d69e2e] p-0.5 rounded-tl-lg">
              <Lock className="w-2.5 h-2.5 text-black" />
            </div>
          </>
        ) : (
          <>
            <div className="absolute inset-0 flex items-center justify-center">
              <ImageIcon className="w-8 h-8 text-slate-700" />
            </div>
            <div className="relative z-10 w-full h-full bg-slate-600"></div>
            {job.fileCount && (
              <div className="absolute bottom-0 right-0 bg-[#1773cf] text-white text-[9px] font-black px-1 rounded-tl-sm shadow-lg z-20">
                +{job.fileCount}
              </div>
            )}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
              <ZoomIn className="w-5 h-5 text-white" />
            </div>
          </>
        )}
      </div>

      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div className="flex justify-between items-start">
          <span className={cn("text-sm font-bold", isSelected ? "text-white" : job.status === "locked" ? "text-slate-400" : "text-white")}>
            {job.jobNumber}
          </span>
          <span className={cn("text-[8px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider", config.bgClass, config.textClass, config.borderClass)}>
            {config.label}
          </span>
        </div>
        <p className={cn("text-xs font-semibold truncate", job.status === "locked" ? "text-slate-500" : "text-slate-200")}>{job.customer}</p>
        <p className={cn("text-[10px] truncate", job.status === "locked" ? "text-slate-600" : "text-slate-400")}>{job.product}</p>
        <div className="flex items-center justify-between mt-1 text-[9px]">
          {job.status === "locked" ? (
            <span className="text-[#d69e2e]">Locked by {job.lockedBy}</span>
          ) : job.assignedTo ? (
            <span className="text-slate-500">Assigned: {job.assignedTo}</span>
          ) : (
            <span className="text-slate-500">Unassigned</span>
          )}
          {job.isRush && <span className="text-[#e53e3e] font-bold">RUSH</span>}
          {job.dueDate && !job.isRush && <span className="text-slate-400">{job.dueDate}</span>}
        </div>
      </div>
    </div>
  );
}

function FileThumbnail({ filename }: { filename: string }) {
  const isPdf = filename.toLowerCase().endsWith(".pdf");

  return (
    <div className="relative w-20 h-20 rounded-lg border border-[#2d3748] overflow-hidden bg-[#111921] flex items-center justify-center group">
      {isPdf ? (
        <div className="absolute inset-0 bg-slate-600 flex items-center justify-center">
          <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        </div>
      ) : (
        <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      )}
      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
        <ZoomIn className="w-5 h-5 text-white" />
      </div>
    </div>
  );
}

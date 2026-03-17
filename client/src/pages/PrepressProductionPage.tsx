/**
 * Manual Prepress Production Page
 * 
 * Queue-based prepress workflow with file upload/download and session management.
 * Left: Queue list filtered by status/print type/search
 * Right: Line item workspace with originals, finals, notes, and completion controls
 */

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Upload, Check, FileText, AlertTriangle, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface QueueItem {
  lineItem: any;
  order: any;
  session: any | null;
  fileCounts: {
    originals: number;
    finals: number;
    references: number;
  };
}

interface LineItemFile {
  id: string;
  role: "original" | "final" | "reference";
  originalFilename: string;
  sizeBytes: number;
  tag: string | null;
  createdAt: string;
}

export default function PrepressProductionPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // State
  const [statusFilter, setStatusFilter] = useState("ready_for_prepress,in_prepress");
  const [selectedLineItemId, setSelectedLineItemId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [issueFlag, setIssueFlag] = useState(false);
  const [issueType, setIssueType] = useState("");

  // Fetch queue
  const { data: queueData } = useQuery({
    queryKey: ["/api/prepress/queue", statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.append("status", statusFilter);
      const res = await fetch(`/api/prepress/queue?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch queue");
      const json = await res.json();
      return json.data as QueueItem[];
    },
  });

  const queue = queueData || [];
  const selectedItem = queue.find((item) => item.lineItem.id === selectedLineItemId);

  // Fetch files for selected line item
  const { data: filesData } = useQuery({
    queryKey: ["/api/prepress/line-item", selectedLineItemId, "files"],
    queryFn: async () => {
      if (!selectedLineItemId) return null;
      const res = await fetch(`/api/prepress/line-item/${selectedLineItemId}/files`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch files");
      const json = await res.json();
      return json.data as { originals: LineItemFile[]; finals: LineItemFile[]; references: LineItemFile[] };
    },
    enabled: !!selectedLineItemId,
  });

  // Start session mutation
  const startSession = useMutation({
    mutationFn: async (lineItemId: string) => {
      const res = await fetch("/api/prepress/session/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineItemId }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to start session");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prepress/queue"] });
      toast({ title: "Session started" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Complete session mutation
  const completeSession = useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await fetch(`/api/prepress/session/${sessionId}/complete`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Failed to complete session");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prepress/queue"] });
      setSelectedLineItemId(null);
      toast({ title: "Prepress complete" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Save notes mutation
  const saveNotes = useMutation({
    mutationFn: async () => {
      if (!selectedItem?.session) throw new Error("No active session");
      const res = await fetch(`/api/prepress/session/${selectedItem.session.id}/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notesText: notes, issueFlag, issueType: issueFlag ? issueType : null }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to save notes");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Notes saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // File upload handler
  const handleFileUpload = useCallback(
    async (files: FileList | null, role: "original" | "final" | "reference") => {
      if (!files || !selectedLineItemId) return;
      
      for (const file of Array.from(files)) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("lineItemId", selectedLineItemId);
        formData.append("role", role);
        if (selectedItem?.session) {
          formData.append("sessionId", selectedItem.session.id);
        }

        try {
          const res = await fetch("/api/prepress/files/upload", {
            method: "POST",
            body: formData,
            credentials: "include",
          });
          if (!res.ok) throw new Error("Upload failed");
          toast({ title: `Uploaded ${file.name}` });
        } catch (error) {
          toast({ title: "Upload failed", description: String(error), variant: "destructive" });
        }
      }

      queryClient.invalidateQueries({ queryKey: ["/api/prepress/line-item", selectedLineItemId, "files"] });
      queryClient.invalidateQueries({ queryKey: ["/api/prepress/queue"] });
    },
    [selectedLineItemId, selectedItem, queryClient, toast]
  );

  const handleSelectLineItem = (item: QueueItem) => {
    setSelectedLineItemId(item.lineItem.id);
    setNotes(item.session?.notesText || "");
    setIssueFlag(item.session?.issueFlag || false);
    setIssueType(item.session?.issueType || "");
  };

  const handleStartPrepress = () => {
    if (!selectedLineItemId) return;
    startSession.mutate(selectedLineItemId);
  };

  const handleCompletePrepress = () => {
    if (!selectedItem?.session) return;
    completeSession.mutate(selectedItem.session.id);
  };

  const handleDownloadOriginals = () => {
    if (!selectedLineItemId) return;
    window.open(`/api/prepress/line-item/${selectedLineItemId}/download-originals-zip`, "_blank");
  };

  const handleDownloadFile = (fileId: string) => {
    window.open(`/api/prepress/files/${fileId}/download`, "_blank");
  };

  const isLocked = selectedItem?.session && selectedItem.session.status === "active";
  const canComplete = isLocked && (filesData?.finals.length || 0) > 0;

  return (
    <div className="flex h-screen">
      {/* Left sidebar - Queue */}
      <div className="w-96 border-r flex flex-col">
        <div className="p-4 border-b space-y-2">
          <h2 className="text-lg font-semibold">Prepress Queue</h2>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ready_for_prepress,in_prepress">Ready & In Progress</SelectItem>
              <SelectItem value="ready_for_prepress">Ready for Prepress</SelectItem>
              <SelectItem value="in_prepress">In Prepress</SelectItem>
              <SelectItem value="ready_for_production">Ready for Production</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 overflow-y-auto">
          {queue.map((item) => (
            <div
              key={item.lineItem.id}
              onClick={() => handleSelectLineItem(item)}
              className={`p-4 border-b cursor-pointer hover:bg-accent ${
                selectedLineItemId === item.lineItem.id ? "bg-accent" : ""
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">{item.order.orderNumber}</span>
                <Badge variant={(item.lineItem.workflowState || item.lineItem.status) === "in_prepress" ? "default" : "secondary"}>
                  {String(item.lineItem.workflowState || item.lineItem.status || "ready_for_prepress").replace(/_/g, " ")}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground line-clamp-2">{item.lineItem.description}</p>
              <div className="flex gap-2 mt-2 text-xs text-muted-foreground">
                <span>O: {item.fileCounts.originals}</span>
                <span>F: {item.fileCounts.finals}</span>
                {item.session?.issueFlag && <AlertTriangle className="h-4 w-4 text-destructive" />}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel - Workspace */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {!selectedItem ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            Select a line item from the queue
          </div>
        ) : (
          <>
            {/* Job Info */}
            <Card>
              <CardHeader>
                <CardTitle>Job Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="font-medium">Order:</span> {selectedItem.order.orderNumber}
                  </div>
                  <div>
                    <span className="font-medium">Status:</span>{" "}
                    <Badge>{selectedItem.lineItem.status.replace(/_/g, " ")}</Badge>
                  </div>
                  <div className="col-span-2">
                    <span className="font-medium">Description:</span> {selectedItem.lineItem.description}
                  </div>
                  {selectedItem.session && (
                    <div className="col-span-2 flex items-center gap-2">
                      <Lock className="h-4 w-4" />
                      <span className="text-muted-foreground">
                        Session active since {new Date(selectedItem.session.startedAt).toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Originals */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Original Files ({filesData?.originals.length || 0})</CardTitle>
                  <div className="flex gap-2">
                    <Button onClick={handleDownloadOriginals} size="sm" variant="outline">
                      <Download className="h-4 w-4 mr-2" />
                      Download All
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <label>
                        <Upload className="h-4 w-4 mr-2" />
                        Upload
                        <input
                          type="file"
                          multiple
                          className="hidden"
                          onChange={(e) => handleFileUpload(e.target.files, "original")}
                        />
                      </label>
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {!filesData || filesData.originals.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No original files</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Filename</TableHead>
                        <TableHead>Size</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filesData.originals.map((file) => (
                        <TableRow key={file.id}>
                          <TableCell>{file.originalFilename}</TableCell>
                          <TableCell>{(file.sizeBytes / 1024 / 1024).toFixed(2)} MB</TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDownloadFile(file.id)}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Finals */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Final Files ({filesData?.finals.length || 0})</CardTitle>
                  {isLocked && (
                    <Button asChild size="sm" variant="outline">
                      <label>
                        <Upload className="h-4 w-4 mr-2" />
                        Upload Final
                        <input
                          type="file"
                          multiple
                          className="hidden"
                          onChange={(e) => handleFileUpload(e.target.files, "final")}
                        />
                      </label>
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {!filesData || filesData.finals.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No final files uploaded yet</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Filename</TableHead>
                        <TableHead>Tag</TableHead>
                        <TableHead>Size</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filesData.finals.map((file) => (
                        <TableRow key={file.id}>
                          <TableCell>{file.originalFilename}</TableCell>
                          <TableCell>{file.tag || "-"}</TableCell>
                          <TableCell>{(file.sizeBytes / 1024 / 1024).toFixed(2)} MB</TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDownloadFile(file.id)}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Notes */}
            <Card>
              <CardHeader>
                <CardTitle>Session Notes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Notes</Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Add prepress notes..."
                    disabled={!isLocked}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={issueFlag}
                    onCheckedChange={(checked) => setIssueFlag(checked as boolean)}
                    disabled={!isLocked}
                  />
                  <Label>Flag Issue</Label>
                </div>
                {issueFlag && (
                  <div>
                    <Label>Issue Type</Label>
                    <Input
                      value={issueType}
                      onChange={(e) => setIssueType(e.target.value)}
                      placeholder="e.g., Low resolution, missing fonts"
                      disabled={!isLocked}
                    />
                  </div>
                )}
                {isLocked && (
                  <Button onClick={() => saveNotes.mutate()} disabled={saveNotes.isPending}>
                    Save Notes
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Controls */}
            <Card>
              <CardHeader>
                <CardTitle>Prepress Controls</CardTitle>
              </CardHeader>
              <CardContent className="flex gap-2">
                {!isLocked && (selectedItem.lineItem.workflowState || selectedItem.lineItem.status) === "ready_for_prepress" && (
                  <Button onClick={handleStartPrepress} disabled={startSession.isPending}>
                    Start Prepress
                  </Button>
                )}
                {isLocked && (
                  <Button
                    onClick={handleCompletePrepress}
                    disabled={!canComplete || completeSession.isPending}
                  >
                    <Check className="h-4 w-4 mr-2" />
                    Mark Prepress Complete
                  </Button>
                )}
                {!canComplete && isLocked && (
                  <p className="text-sm text-muted-foreground">Upload at least one final file to complete</p>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

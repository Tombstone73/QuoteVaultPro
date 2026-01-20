import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useCreatePrepressJob, usePrepressJob, usePrepressReport, usePrepressFindings, usePrepressFixLogs, usePrepressJobList, downloadPrepressOutput } from "@/hooks/usePrepress";
import { FileUp, Download, CheckCircle2, XCircle, Clock, AlertTriangle, FileText, Search, Wrench, ArrowLeft, Eye } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/**
 * Prepress Page
 * 
 * Standalone PDF preflight tool interface.
 * Upload PDFs, run checks, and download results.
 */

export default function PrepressPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'check' | 'check_and_fix'>('check');
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  
  const createJob = useCreatePrepressJob();
  const { data: jobsList, isLoading: jobsListLoading } = usePrepressJobList();
  const { data: job, isError: jobError } = usePrepressJob(currentJobId);
  const { data: report } = usePrepressReport(job?.status === 'succeeded' ? currentJobId : null);
  const { data: findings } = usePrepressFindings(currentJobId);
  const { data: fixLogs } = usePrepressFixLogs(currentJobId);
  
  // Handle stale job selection (job not found or access denied)
  if (currentJobId && jobError) {
    setCurrentJobId(null);
  }
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };
  
  const handleSubmit = async () => {
    if (!selectedFile) return;
    
    try {
      const result = await createJob.mutateAsync({ file: selectedFile, mode });
      setCurrentJobId(result.data.jobId);
    } catch (error) {
      console.error('Failed to create job:', error);
    }
  };
  
  const handleReset = () => {
    setSelectedFile(null);
    setCurrentJobId(null);
    createJob.reset();
  };
  
  const handleViewJob = (jobId: string) => {
    setCurrentJobId(jobId);
    setSelectedFile(null);
  };
  
  const handleBackToList = () => {
    setCurrentJobId(null);
    setSelectedFile(null);
  };
  
  const getStatusBadge = () => {
    if (!job) return null;
    
    const statusConfig = {
      queued: { label: 'Queued', variant: 'secondary' as const, icon: Clock },
      running: { label: 'Processing...', variant: 'default' as const, icon: Clock },
      succeeded: { label: 'Completed', variant: 'default' as const, icon: CheckCircle2 },
      failed: { label: 'Failed', variant: 'destructive' as const, icon: XCircle },
      cancelled: { label: 'Cancelled', variant: 'secondary' as const, icon: XCircle },
    };
    
    const config = statusConfig[job.status];
    const Icon = config.icon;
    
    return (
      <Badge variant={config.variant} className="flex items-center gap-1">
        <Icon className="w-3 h-3" />
        {config.label}
      </Badge>
    );
  };
  
  const getScoreColor = (score: number) => {
    if (score >= 90) return 'text-green-600';
    if (score >= 70) return 'text-yellow-600';
    return 'text-red-600';
  };
  
  // Show job list when no job selected, or job detail when selected
  const showJobList = !currentJobId;
  const showJobDetail = currentJobId && job;
  
  return (
    <div className="container mx-auto p-6 max-w-7xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Print File Preflight Tool</h1>
        <p className="text-muted-foreground">
          Check print files (PDF, JPG, PNG, TIF, AI, PSD) for print readiness and common issues
        </p>
      </div>
      
      {/* Upload Section - Always Visible */}
      {showJobList && (
        <Card>
          <CardHeader>
            <CardTitle>Upload Print File</CardTitle>
            <CardDescription>
              Select a file to analyze (max 250MB). Supports PDF, JPG, PNG, TIF, AI, and PSD formats.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="file">Print File (PDF, JPG, PNG, TIF, AI, PSD)</Label>
              <Input
                id="file"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff,.ai,.psd,application/pdf,image/jpeg,image/png,image/tiff,application/postscript,image/vnd.adobe.photoshop"
                onChange={handleFileChange}
                className="cursor-pointer"
              />
              {selectedFile && (
                <p className="text-sm text-muted-foreground mt-2">
                  Selected: {selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
                </p>
              )}
            </div>
            
            <div>
              <Label>Processing Mode</Label>
              <RadioGroup value={mode} onValueChange={(v) => setMode(v as any)} className="mt-2">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="check" id="mode-check" />
                  <Label htmlFor="mode-check" className="font-normal cursor-pointer">
                    Check Only - Analyze and report issues
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="check_and_fix" id="mode-fix" />
                  <Label htmlFor="mode-fix" className="font-normal cursor-pointer">
                    Check + Safe Fix - Analyze and attempt automatic fixes
                  </Label>
                </div>
              </RadioGroup>
            </div>
            
            <Button
              onClick={handleSubmit}
              disabled={!selectedFile || createJob.isPending}
              className="w-full"
            >
              <FileUp className="w-4 h-4 mr-2" />
              {createJob.isPending ? 'Uploading...' : 'Run Preflight'}
            </Button>
            
            {createJob.isError && (
              <Alert variant="destructive">
                <AlertDescription>
                  {createJob.error?.message || 'Failed to upload file'}
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
      
      {/* Job List Section */}
      {showJobList && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Preflight Jobs</CardTitle>
            <CardDescription>
              View and manage your preflight job history
            </CardDescription>
          </CardHeader>
          <CardContent>
            {jobsListLoading ? (
              <div className="text-center text-muted-foreground py-8">
                Loading jobs...
              </div>
            ) : !jobsList || jobsList.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                No preflight jobs yet. Upload a file to get started.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Filename</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobsList.map((jobItem) => (
                    <TableRow key={jobItem.id}>
                      <TableCell className="font-medium">
                        {jobItem.originalFilename}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            jobItem.status === 'succeeded' ? 'default' :
                            jobItem.status === 'failed' ? 'destructive' :
                            'secondary'
                          }
                        >
                          {jobItem.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {jobItem.reportSummary?.score !== undefined ? (
                          <span className={getScoreColor(jobItem.reportSummary.score)}>
                            {jobItem.reportSummary.score}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(jobItem.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleViewJob(jobItem.id)}
                        >
                          <Eye className="w-4 h-4 mr-1" />
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
      
      {/* Job Detail Section */}
      {showJobDetail && (
        <div className="space-y-4">
          <Button variant="ghost" onClick={handleBackToList} className="mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Jobs
          </Button>
          
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Job Status</CardTitle>
                  <CardDescription className="mt-1">
                    {job.originalFilename} • {(job.sizeBytes / 1024 / 1024).toFixed(2)} MB
                  </CardDescription>
                </div>
                {getStatusBadge()}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {job.progressMessage && (
                <p className="text-sm text-muted-foreground">{job.progressMessage}</p>
              )}
              
              {job.error && (
                <Alert variant="destructive">
                  <AlertDescription>
                    <strong>Error:</strong> {job.error.message}
                  </AlertDescription>
                </Alert>
              )}
              
              {job.status !== 'succeeded' && job.status !== 'failed' && (
                <div className="text-sm text-muted-foreground">
                  Processing your file... This may take a few moments.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
      
      {/* Results Section */}
      {showJobDetail && job?.status === 'succeeded' && job.reportSummary && (
        <Card>
          <CardHeader>
            <CardTitle>Preflight Results</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Score */}
            <div className="text-center p-6 bg-muted rounded-lg">
              <div className={`text-6xl font-bold ${getScoreColor(job.reportSummary.score)}`}>
                {job.reportSummary.score}
              </div>
              <div className="text-sm text-muted-foreground mt-2">
                Print Readiness Score (0-100)
              </div>
            </div>
            
            {/* Issue Counts */}
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-4 bg-red-50 rounded-lg">
                <div className="text-2xl font-bold text-red-600">
                  {job.reportSummary.counts.BLOCKER}
                </div>
                <div className="text-sm text-muted-foreground">Blockers</div>
              </div>
              <div className="text-center p-4 bg-yellow-50 rounded-lg">
                <div className="text-2xl font-bold text-yellow-600">
                  {job.reportSummary.counts.WARNING}
                </div>
                <div className="text-sm text-muted-foreground">Warnings</div>
              </div>
              <div className="text-center p-4 bg-blue-50 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">
                  {job.reportSummary.counts.INFO}
                </div>
                <div className="text-sm text-muted-foreground">Info</div>
              </div>
            </div>
            
            {/* Page Count */}
            <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
              <span className="text-sm font-medium">Pages</span>
              <span className="text-sm">{job.reportSummary.pageCount}</span>
            </div>
            
            {/* Normalization Info */}
            {report && report.normalization && (
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
                <h3 className="font-semibold text-sm text-blue-900">File Normalization</h3>
                <div className="text-sm text-blue-800 space-y-1">
                  <div>
                    <strong>Original Format:</strong> {report.normalization.originalFormat.toUpperCase()}
                  </div>
                  {report.normalization.normalizedFormat && (
                    <div>
                      <strong>Normalized To:</strong> {report.normalization.normalizedFormat.toUpperCase()}
                    </div>
                  )}
                  {report.normalization.metadata && (
                    <div className="mt-2 space-y-1">
                      {report.normalization.metadata.width && report.normalization.metadata.height && (
                        <div>
                          <strong>Dimensions:</strong> {report.normalization.metadata.width} × {report.normalization.metadata.height}px
                        </div>
                      )}
                      {report.normalization.metadata.dpi && (
                        <div>
                          <strong>DPI:</strong> {report.normalization.metadata.dpi}
                        </div>
                      )}
                      {report.normalization.metadata.colorSpace && (
                        <div>
                          <strong>Color Space:</strong> {report.normalization.metadata.colorSpace}
                        </div>
                      )}
                    </div>
                  )}
                  {report.normalization.notes && report.normalization.notes.length > 0 && (
                    <div className="mt-2">
                      <strong>Notes:</strong>
                      <ul className="list-disc list-inside mt-1">
                        {report.normalization.notes.map((note: string, idx: number) => (
                          <li key={idx} className="text-xs">{note}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {/* Issues List */}
            {report && report.issues && report.issues.length > 0 && (
              <div>
                <h3 className="font-semibold mb-3">Issues Found</h3>
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {report.issues.map((issue: any, idx: number) => (
                    <div
                      key={idx}
                      className={`p-3 rounded border ${
                        issue.severity === 'BLOCKER' ? 'border-red-200 bg-red-50' :
                        issue.severity === 'WARNING' ? 'border-yellow-200 bg-yellow-50' :
                        'border-blue-200 bg-blue-50'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <Badge variant={issue.severity === 'BLOCKER' ? 'destructive' : 'secondary'} className="text-xs">
                          {issue.severity}
                        </Badge>
                        <div className="flex-1 text-sm">
                          <div className="font-medium">{issue.code}</div>
                          <div className="text-muted-foreground">{issue.message}</div>
                          {issue.page && (
                            <div className="text-xs mt-1">Page {issue.page}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Preflight Findings Section */}
            {findings && findings.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Search className="w-4 h-4" />
                  <h3 className="font-semibold">Preflight Findings</h3>
                </div>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {findings.map((finding: any) => (
                    <div
                      key={finding.id}
                      className={`p-3 rounded border text-sm ${
                        finding.severity === 'blocker' ? 'border-red-200 bg-red-50' :
                        finding.severity === 'warning' ? 'border-yellow-200 bg-yellow-50' :
                        'border-blue-200 bg-blue-50'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <Badge variant={finding.severity === 'blocker' ? 'destructive' : 'secondary'} className="text-xs">
                          {finding.findingType.replace(/_/g, ' ').toUpperCase()}
                        </Badge>
                        <div className="flex-1">
                          <div className="font-medium">{finding.message}</div>
                          {finding.spotColorName && (
                            <div className="text-xs text-muted-foreground mt-1">
                              Color: {finding.spotColorName} ({finding.colorModel})
                            </div>
                          )}
                          {finding.detectedDpi && (
                            <div className="text-xs text-muted-foreground mt-1">
                              DPI: {finding.detectedDpi} / {finding.requiredDpi} required
                            </div>
                          )}
                          {finding.pageNumber && (
                            <div className="text-xs text-muted-foreground mt-1">
                              Page {finding.pageNumber}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Fix History Section */}
            {fixLogs && fixLogs.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Wrench className="w-4 h-4" />
                  <h3 className="font-semibold">Fix History</h3>
                </div>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {fixLogs.map((fix: any) => (
                    <div
                      key={fix.id}
                      className="p-3 rounded border border-green-200 bg-green-50 text-sm"
                    >
                      <div className="flex items-start gap-2">
                        <Badge variant="outline" className="text-xs bg-green-100">
                          {fix.fixType.replace(/_/g, ' ').toUpperCase()}
                        </Badge>
                        <div className="flex-1">
                          <div className="font-medium">{fix.description}</div>
                          {fix.fixedByUserId ? (
                            <div className="text-xs text-muted-foreground mt-1">
                              Fixed by: User {fix.fixedByUserId}
                            </div>
                          ) : (
                            <div className="text-xs text-muted-foreground mt-1">
                              Automated fix
                            </div>
                          )}
                          <div className="text-xs text-muted-foreground">
                            {new Date(fix.createdAt).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Download Buttons */}
            <div className="space-y-2">
              <h3 className="font-semibold">Download Results</h3>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  onClick={() => downloadPrepressOutput(currentJobId, 'report_json')}
                  className="w-full"
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Report (JSON)
                </Button>
                
                {job.outputManifest?.proof_png && (
                  <Button
                    variant="outline"
                    onClick={() => downloadPrepressOutput(currentJobId, 'proof_png')}
                    className="w-full"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Proof Image
                  </Button>
                )}
                
                {job.outputManifest?.fixed_pdf && (
                  <Button
                    variant="outline"
                    onClick={() => downloadPrepressOutput(currentJobId, 'fixed_pdf')}
                    className="w-full"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Fixed PDF
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

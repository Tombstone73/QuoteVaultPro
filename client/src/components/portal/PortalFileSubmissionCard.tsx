import * as React from "react";
import { Loader2, Upload } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  portalDashboardKeys,
  portalOrderKeys,
  portalQuoteKeys,
  PORTAL_FILE_SUBMISSION_ACCEPT_ATTRIBUTE,
  PORTAL_FILE_SUBMISSION_GUIDANCE,
  usePortalFileSubmission,
} from "@/hooks/usePortal";

export default function PortalFileSubmissionCard({
  entity,
  entityId,
}: {
  entity: "orders" | "quotes";
  entityId: string;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [note, setNote] = React.useState("");
  const [success, setSuccess] = React.useState<string | null>(null);
  const submission = usePortalFileSubmission(entity, entityId);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) {
      toast({ title: "Choose a file", description: "Select a file before submitting.", variant: "destructive" });
      return;
    }

    setSuccess(null);
    try {
      const result = await submission.mutateAsync({ file, note });
      setSuccess(result.message);
      setFile(null);
      setNote("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: portalDashboardKeys.all }),
        queryClient.invalidateQueries({ queryKey: entity === "orders" ? portalOrderKeys.files(entityId) : portalQuoteKeys.files(entityId) }),
      ]);
    } catch (error) {
      toast({
        title: "File was not submitted",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-4 w-4" />
          Send artwork or a file
        </CardTitle>
        <CardDescription>
          {PORTAL_FILE_SUBMISSION_GUIDANCE} Your account team will review it before it is used for production.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor={`${entity}-file-submission`}>File</Label>
            <Input
              ref={fileInputRef}
              id={`${entity}-file-submission`}
              type="file"
              accept={PORTAL_FILE_SUBMISSION_ACCEPT_ATTRIBUTE}
              disabled={submission.isPending}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            {file ? <p className="text-sm text-muted-foreground">Selected: {file.name}</p> : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${entity}-file-submission-note`}>Note (optional)</Label>
            <Textarea
              id={`${entity}-file-submission-note`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={1000}
              placeholder="Tell your account team how this file should be used."
              disabled={submission.isPending}
            />
          </div>
          {success ? <p className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm" role="status">{success}</p> : null}
          <Button type="submit" disabled={!file || submission.isPending}>
            {submission.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            Submit for Review
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

import { Link } from "react-router-dom";
import { AlertCircle, ArrowRight, FileCheck, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePortalProofs, type PortalProofDto } from "@/hooks/usePortal";

function formatDate(value: string | null) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function proofVariant(proof: PortalProofDto): "default" | "secondary" | "destructive" | "outline" {
  if (proof.status === "approved") return "default";
  if (proof.status === "rejected") return "secondary";
  if (proof.status === "revision_requested" || proof.status === "superseded") return "secondary";
  if (proof.status === "cancelled") return "secondary";
  if (proof.status === "unavailable") return "destructive";
  if (proof.customerActionRequired) return "outline";
  return "secondary";
}

function ProofRow({ proof }: { proof: PortalProofDto }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/portal/proofs/${proof.id}`} className="font-medium hover:underline">
            Proof v{proof.versionNumber} / Order {proof.orderSummary.displayNumber || proof.orderSummary.orderNumber}
          </Link>
          <Badge variant={proofVariant(proof)}>{proof.displayStatus}</Badge>
          {proof.customerActionRequired ? (
            <Badge variant="secondary">
              <AlertCircle className="mr-1 h-3 w-3" />
              Action needed
            </Badge>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {proof.lineItemSummary.name} / Created {formatDate(proof.createdAt)}
        </p>
      </div>
      <Button asChild variant="outline" size="sm">
        <Link to={`/portal/proofs/${proof.id}`}>
          Open
          <ArrowRight className="ml-2 h-4 w-4" />
        </Link>
      </Button>
    </div>
  );
}

export default function PortalProofsPage() {
  const { data, isLoading, error } = usePortalProofs();
  const proofs = data ?? [];

  if (isLoading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-normal">Proofs</h1>
        <p className="mt-1 text-sm text-muted-foreground">Review proofs connected to your orders.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCheck className="h-4 w-4" />
            Proof Reviews
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {error ? (
            <p className="rounded-md border border-destructive/30 p-4 text-sm text-destructive">
              {(error as Error).message || "Could not load proofs."}
            </p>
          ) : proofs.length ? (
            proofs.map((proof) => <ProofRow key={proof.id} proof={proof} />)
          ) : (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No proofs are available right now.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

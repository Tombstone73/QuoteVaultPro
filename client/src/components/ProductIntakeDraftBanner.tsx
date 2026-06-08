import { Link } from "react-router-dom";
import { ExternalLink, PackageCheck } from "lucide-react";
import type { ProductIntakeDraftLink } from "@shared/productIntakeWizardSchemas";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function ProductIntakeDraftBanner({ link }: { link: ProductIntakeDraftLink }) {
  const hasDraftTree = Boolean(link.pbv2TreeVersionId);
  return (
    <Alert className="mb-4">
      <PackageCheck className="h-4 w-4" />
      <AlertTitle>Created from Product Intake</AlertTitle>
      <AlertDescription>
        <div className="space-y-3">
          <p>
            This product was created from Product Intake and is {link.productIsActive ? "active" : "inactive"}.
            {hasDraftTree
              ? " Options are in a PBV2 draft until published."
              : " No PBV2 draft tree is linked yet."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge variant={link.productIsActive ? "secondary" : "outline"}>{link.productIsActive ? "Product active" : "Product inactive"}</Badge>
            <Badge variant={link.pbv2Status === "ACTIVE" ? "secondary" : "outline"}>PBV2 {link.pbv2Status ?? "missing"}</Badge>
            <Badge variant={link.pbv2ActiveTreeVersionId === link.pbv2TreeVersionId && link.pbv2TreeVersionId ? "secondary" : "outline"}>
              {link.pbv2ActiveTreeVersionId === link.pbv2TreeVersionId && link.pbv2TreeVersionId ? "Active tree assigned" : "Publish required"}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline" className="gap-2">
              <Link to={`/admin/product-intake/sessions/${link.sessionId}/review`}>
                <ExternalLink className="h-4 w-4" />
                Open Intake Review
              </Link>
            </Button>
            {hasDraftTree ? (
              <Button asChild size="sm" variant="outline" className="gap-2">
                <Link to={`/products/${link.productId}/builder-v2`}>
                  <ExternalLink className="h-4 w-4" />
                  Open PBV2 Draft
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
      </AlertDescription>
    </Alert>
  );
}

import { Link } from "react-router-dom";
import { ExternalLink, PackageCheck } from "lucide-react";
import type { ProductIntakeDraftLink } from "@shared/productIntakeWizardSchemas";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function ProductIntakeDraftBanner({ link }: { link: ProductIntakeDraftLink }) {
  const hasDraftTree = Boolean(link.pbv2TreeVersionId) && link.pbv2Status === "DRAFT";
  const hasPublishedTree = link.pbv2Status === "ACTIVE" && link.pbv2ActiveTreeVersionId === link.pbv2TreeVersionId;
  const draftTreeQuery = link.pbv2TreeVersionId ? `?draftTreeVersionId=${encodeURIComponent(link.pbv2TreeVersionId)}` : "";
  return (
    <Alert className="mb-4">
      <PackageCheck className="h-4 w-4" />
      <AlertTitle>Created from Product Intake</AlertTitle>
      <AlertDescription>
        <div className="space-y-3">
          <p>
            This product was created from Product Intake and is {link.productIsActive ? "active" : "inactive"}.
            {hasDraftTree ? " Review and publish the PBV2 draft before activating this product."
              : hasPublishedTree ? " The PBV2 configuration is published. Activate the product in Intake Review."
              : " Open Intake Review to check the linked PBV2 configuration."}
          </p>
          {link.materialAssociationRequired ? (
            <p className="font-medium text-amber-700 dark:text-amber-300">
              {(link.intakeWarnings ?? []).find((warning) => /material association required/i.test(warning)) ?? "Material association required."}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Badge variant={link.productIsActive ? "secondary" : "outline"}>{link.productIsActive ? "Product active" : "Product inactive"}</Badge>
            <Badge variant={link.pbv2Status === "ACTIVE" ? "secondary" : "outline"}>PBV2 {link.pbv2Status ?? "missing"}</Badge>
            <Badge variant={link.pbv2ActiveTreeVersionId === link.pbv2TreeVersionId && link.pbv2TreeVersionId ? "secondary" : "outline"}>
              {hasPublishedTree ? "Active tree assigned" : "Publish required"}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline" className="gap-2">
              <Link to={`/admin/product-intake/sessions/${link.sessionId}/review`}>
                <ExternalLink className="h-4 w-4" />
                {hasDraftTree ? "Review and Publish PBV2" : "Open Intake Review"}
              </Link>
            </Button>
            {hasDraftTree ? (
              <Button asChild size="sm" variant="outline" className="gap-2">
                <Link to={`/products/${link.productId}/builder-v2${draftTreeQuery}`}>
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

import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ContentLayout, DataCard, Page, PageHeader } from "@/components/titan";

type PlaceholderStatus = "coming_soon" | "planned" | "later";

export interface PlaceholderPageItem {
  title: string;
  description?: string;
  status?: PlaceholderStatus;
}

export interface PlaceholderPageAction {
  label: string;
  to: string;
}

interface PlaceholderPageProps {
  title: string;
  description?: string;
  items?: PlaceholderPageItem[];
  primaryAction?: PlaceholderPageAction;
  secondaryAction?: PlaceholderPageAction;
}

function statusLabel(status: PlaceholderStatus | undefined): string {
  if (status === "planned") return "Planned";
  if (status === "later") return "Later";
  return "Coming soon";
}

function statusVariant(status: PlaceholderStatus | undefined): "default" | "secondary" | "outline" {
  if (status === "later") return "outline";
  if (status === "planned") return "secondary";
  return "default";
}

export default function PlaceholderPage({
  title,
  description,
  items,
  primaryAction,
  secondaryAction,
}: PlaceholderPageProps) {
  return (
    <Page maxWidth="full">
      <PageHeader title={title} subtitle={description} />

      <ContentLayout>
        {!!items?.length && (
          <DataCard>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {items.slice(0, 6).map((item) => (
                <Card key={item.title}>
                  <CardHeader className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <CardTitle className="text-base">{item.title}</CardTitle>
                      <Badge variant={statusVariant(item.status)}>{statusLabel(item.status)}</Badge>
                    </div>
                    {item.description ? (
                      <CardDescription>{item.description}</CardDescription>
                    ) : (
                      <CardDescription>Coming soon.</CardDescription>
                    )}
                  </CardHeader>
                </Card>
              ))}
            </div>
          </DataCard>
        )}

        {(primaryAction || secondaryAction) && (
          <DataCard>
            <div className="flex flex-wrap items-center gap-3">
              {primaryAction && (
                <Button asChild>
                  <Link to={primaryAction.to}>
                    {primaryAction.label}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              )}
              {secondaryAction && (
                <Button variant="outline" asChild>
                  <Link to={secondaryAction.to}>{secondaryAction.label}</Link>
                </Button>
              )}
            </div>
          </DataCard>
        )}
      </ContentLayout>
    </Page>
  );
}

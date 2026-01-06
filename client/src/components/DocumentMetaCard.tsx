import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type DocumentMetaCardProps = {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
};

export function DocumentMetaCard({ children, className, contentClassName }: DocumentMetaCardProps) {
  return (
    <Card className={cn("rounded-lg border border-border/40 bg-card/50", className)}>
      <CardContent className={cn("space-y-3 px-4 pt-4 pb-4", contentClassName)}>
        {children}
      </CardContent>
    </Card>
  );
}

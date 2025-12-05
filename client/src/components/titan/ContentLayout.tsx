import * as React from "react";
import { cn } from "@/lib/utils";

interface ContentLayoutProps {
  children: React.ReactNode;
  className?: string;
}

export function ContentLayout({ children, className }: ContentLayoutProps) {
  return <div className={cn("space-y-6", className)}>{children}</div>;
}

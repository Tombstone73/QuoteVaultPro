import * as React from "react";
import { cn } from "@/lib/utils";

interface PageProps {
  children: React.ReactNode;
  maxWidth?: "default" | "full";
}

export function Page({ children, maxWidth = "default" }: PageProps) {
  return (
    <div
      className={cn(
        "w-full mx-auto min-w-0 px-4 py-6 sm:px-6 lg:px-8",
        maxWidth === "default" && "max-w-[1800px]",
        maxWidth === "full" && "max-w-none"
      )}
    >
      {children}
    </div>
  );
}

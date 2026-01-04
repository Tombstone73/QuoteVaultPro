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
        "w-full px-4 py-6",
        maxWidth === "default" && "max-w-7xl"
      )}
    >
      {children}
    </div>
  );
}

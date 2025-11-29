import * as React from "react";

interface ContentLayoutProps {
  children: React.ReactNode;
}

export function ContentLayout({ children }: ContentLayoutProps) {
  return <div className="space-y-6">{children}</div>;
}

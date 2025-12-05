import * as React from "react";
import { cn } from "@/lib/utils";

// ============================================================
// TABLE CONTAINER
// ============================================================

interface TitanTableContainerProps {
  children: React.ReactNode;
  className?: string;
}

export function TitanTableContainer({ children, className }: TitanTableContainerProps) {
  return (
    <div
      className={cn(
        "bg-titan-bg-card border border-titan-border-subtle rounded-titan-xl overflow-hidden shadow-titan-card",
        className
      )}
    >
      {children}
    </div>
  );
}

// ============================================================
// TABLE
// ============================================================

interface TitanTableProps extends React.TableHTMLAttributes<HTMLTableElement> {}

export function TitanTable({ children, className, ...props }: TitanTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full", className)} {...props}>
        {children}
      </table>
    </div>
  );
}

// ============================================================
// TABLE HEADER
// ============================================================

interface TitanTableHeaderProps extends React.HTMLAttributes<HTMLTableSectionElement> {}

export function TitanTableHeader({ children, className, ...props }: TitanTableHeaderProps) {
  return (
    <thead
      className={cn(
        "bg-titan-bg-card-elevated border-b border-titan-border-subtle",
        className
      )}
      {...props}
    >
      {children}
    </thead>
  );
}

// ============================================================
// TABLE HEAD CELL
// ============================================================

interface TitanTableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  sortable?: boolean;
}

export function TitanTableHead({ children, className, sortable, ...props }: TitanTableHeadProps) {
  return (
    <th
      className={cn(
        "px-4 py-3 text-left text-titan-xs font-semibold text-titan-text-muted uppercase tracking-wide",
        sortable && "cursor-pointer hover:text-titan-text-primary select-none",
        className
      )}
      {...props}
    >
      {children}
    </th>
  );
}

// ============================================================
// TABLE BODY
// ============================================================

interface TitanTableBodyProps extends React.HTMLAttributes<HTMLTableSectionElement> {}

export function TitanTableBody({ children, className, ...props }: TitanTableBodyProps) {
  return (
    <tbody className={cn("divide-y divide-titan-border-subtle", className)} {...props}>
      {children}
    </tbody>
  );
}

// ============================================================
// TABLE ROW
// ============================================================

interface TitanTableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  clickable?: boolean;
}

export function TitanTableRow({ children, className, clickable, ...props }: TitanTableRowProps) {
  return (
    <tr
      className={cn(
        "border-b border-titan-border-subtle hover:bg-titan-bg-table-row transition-colors",
        clickable && "cursor-pointer",
        className
      )}
      {...props}
    >
      {children}
    </tr>
  );
}

// ============================================================
// TABLE CELL
// ============================================================

interface TitanTableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {}

export function TitanTableCell({ children, className, ...props }: TitanTableCellProps) {
  return (
    <td
      className={cn("px-4 py-3 text-titan-sm text-titan-text-primary", className)}
      {...props}
    >
      {children}
    </td>
  );
}

// ============================================================
// TABLE EMPTY STATE
// ============================================================

interface TitanTableEmptyProps {
  icon?: React.ReactNode;
  message?: string;
  action?: React.ReactNode;
  colSpan: number;
}

export function TitanTableEmpty({ icon, message = "No data found", action, colSpan }: TitanTableEmptyProps) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-12 text-center">
        <div className="flex flex-col items-center gap-3">
          {icon && <div className="text-titan-text-muted">{icon}</div>}
          <p className="text-titan-sm text-titan-text-muted">{message}</p>
          {action}
        </div>
      </td>
    </tr>
  );
}

// ============================================================
// TABLE LOADING STATE
// ============================================================

interface TitanTableLoadingProps {
  message?: string;
  colSpan: number;
}

export function TitanTableLoading({ message = "Loading...", colSpan }: TitanTableLoadingProps) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-8 text-center">
        <div className="flex items-center justify-center gap-2">
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-titan-accent border-t-transparent" />
          <span className="text-titan-sm text-titan-text-muted">{message}</span>
        </div>
      </td>
    </tr>
  );
}

export default TitanTable;

import { Component, type ErrorInfo, type ReactNode } from "react";

/** Keep a malformed station payload diagnosable instead of leaving a blank route. */
export class ProductionStationErrorBoundary extends Component<{
  station: string;
  workIds: string[];
  children: ReactNode;
}, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[production-station] render failed", {
      station: this.props.station, workIds: this.props.workIds, error, componentStack: info.componentStack,
    });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div role="alert" className="rounded-md border border-destructive p-4 text-sm">
      <p>Unable to display this production station. A work record needs attention; the queue is not confirmed empty.</p>
      <p>Station: {this.props.station}. Contact an administrator if retrying does not resolve this.</p>
      <button type="button" className="mt-2 underline" onClick={() => this.setState({ failed: false })}>Retry station display</button>
    </div>;
  }
}

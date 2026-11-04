import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { AssistantComposer } from "@/features/assistant/AssistantWorkspace";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { assistantTurnRequestBody } from "@/hooks/useAssistantApi";
import { buildSafeAssistantContext } from "@/features/assistant/assistantWorkspaceCore";
import { ASSISTANT_MESSAGE_MAX_CONTENT_CHARS } from "@shared/assistantContracts";
import "@/index.css";

function Fixture() {
  const [value, setValue] = useState(""), [result, setResult] = useState("");
  async function send() {
    const body = assistantTurnRequestBody(value, buildSafeAssistantContext("/orders", "Orders"), "synthetic-request", ["synthetic-attachment"]);
    const response = await fetch("/fixture-assistant-input", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    // This fixture intentionally exercises failure retention, not real persistence.
    setResult(response.ok ? "Fixture accepted" : "Fixture failure; full draft and attachment retained");
  }
  return <main className="min-h-screen bg-background p-6 text-foreground"><div className="mx-auto max-w-3xl space-y-3">
    <h1>Assistant long-input fixture</h1><p>No business records. HTTP persistence is mocked.</p>
    <button onClick={() => document.documentElement.classList.toggle("dark")}>Toggle theme</button>
    <p>Attached: synthetic-attachment</p>
    <form onSubmit={event => { event.preventDefault(); if (value.length <= ASSISTANT_MESSAGE_MAX_CONTENT_CHARS) void send(); }}>
      <AssistantComposer value={value} onChange={setValue} onRequestSend={() => { void send(); }} disabled={false} placeholder="Enter synthetic Order" />
    </form>
    <p role="status">{result}</p>
  </div></main>;
}
createRoot(document.getElementById("root")!).render(<QueryClientProvider client={new QueryClient()}><Fixture /></QueryClientProvider>);

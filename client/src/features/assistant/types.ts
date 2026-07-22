import type {
  AssistantCapability,
  AssistantContextEnvelope,
  AssistantConversationDetail,
  AssistantConversationSummary,
  AssistantMessage,
  AssistantPresentationMode,
  AssistantReportResolutionSelectionResponse,
} from "@shared/assistantContracts";

export type AssistantPresentation = AssistantPresentationMode;
export type AssistantCapabilities = AssistantCapability;
export type {
  AssistantContextEnvelope,
  AssistantConversationDetail,
  AssistantConversationSummary,
  AssistantMessage,
  AssistantReportResolutionSelectionResponse,
};

export interface AssistantLayoutPreferences {
  presentation: Exclude<AssistantPresentation, "minimized" | "fullscreen">;
  floatingBounds: { x: number; y: number; width: number; height: number };
  dockSize: number;
}

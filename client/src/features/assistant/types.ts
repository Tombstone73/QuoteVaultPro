import type {
  AssistantCapability,
  AssistantContextEnvelope,
  AssistantConversationDetail,
  AssistantConversationSummary,
  AssistantMessage,
  AssistantPresentationMode,
} from "@shared/assistantContracts";

export type AssistantPresentation = AssistantPresentationMode;
export type AssistantCapabilities = AssistantCapability;
export type {
  AssistantContextEnvelope,
  AssistantConversationDetail,
  AssistantConversationSummary,
  AssistantMessage,
};

export interface AssistantLayoutPreferences {
  presentation: Exclude<AssistantPresentation, "minimized" | "fullscreen">;
  floatingBounds: { x: number; y: number; width: number; height: number };
  dockSize: number;
}

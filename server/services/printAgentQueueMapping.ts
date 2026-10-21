import { supportsMultiQueueAgent } from "../lib/directPrintAgentCapabilities";

export type PrintAgentQueueIdentity = {
  agentVersion: string | null;
  configuredTravelerPrinterName: string | null;
  knownWindowsQueues: string[] | null;
};

/** Only a paired agent's authenticated inventory can authorize another queue. */
export function canAgentServeQueue(agent: PrintAgentQueueIdentity | null | undefined, queueName: string | null | undefined): boolean {
  if (!agent || !queueName) return false;
  if (agent.configuredTravelerPrinterName === queueName) return true;
  return supportsMultiQueueAgent(agent.agentVersion)
    && Array.isArray(agent.knownWindowsQueues)
    && agent.knownWindowsQueues.includes(queueName);
}

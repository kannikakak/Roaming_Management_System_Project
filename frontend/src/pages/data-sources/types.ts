export type ProjectRow = {
  id: number;
  name: string;
};

export type SourceRow = {
  id: number;
  name: string;
  type: string;
  connectionConfig: any;
  filePattern: string | null;
  templateRule: string | null;
  pollIntervalMinutes: number;
  enabled: boolean;
  projectId: number;
  agentKeyHint: string | null;
  hasAgentKey: boolean;
  lastAgentSeenAt: string | null;
  lastScanAt: string | null;
  lastError: string | null;
};

export type CreateForm = {
  name: string;
  type: "folder_sync" | "local";
  projectId: string;
  filePattern: string;
  templateRule: string;
  pollIntervalMinutes: string;
  localPath: string;
  enabled: boolean;
};

export type SourceCreateResponse = {
  id: number;
  agentApiKey?: string;
  agentApiKeyHint?: string;
};

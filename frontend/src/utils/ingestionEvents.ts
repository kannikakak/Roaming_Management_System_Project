export const INGESTION_UPDATE_EVENT = "rms:ingestion-updated";

export type IngestionUpdateDetail = {
  id: string;
  sourceId: number | null;
  importedFileId: number | null;
  projectId: number | null;
  fileName: string;
  status: string;
  createdAt: string | null;
};

export const dispatchIngestionUpdate = (detail: IngestionUpdateDetail) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<IngestionUpdateDetail>(INGESTION_UPDATE_EVENT, { detail }));
};

export const subscribeToIngestionUpdates = (
  handler: (detail: IngestionUpdateDetail) => void
) => {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const listener = (event: Event) => {
    const customEvent = event as CustomEvent<IngestionUpdateDetail>;
    if (customEvent.detail) {
      handler(customEvent.detail);
    }
  };

  window.addEventListener(INGESTION_UPDATE_EVENT, listener as EventListener);
  return () => window.removeEventListener(INGESTION_UPDATE_EVENT, listener as EventListener);
};

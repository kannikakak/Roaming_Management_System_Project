import React, { useEffect, useRef, useState } from 'react';
import Sidebar from './Sidebar/Sidebar';
import HeaderBar from './HeaderBar';
import { apiFetch } from '../utils/api';
import { dispatchIngestionUpdate, IngestionUpdateDetail } from '../utils/ingestionEvents';

type HistoryWatchItem = {
  id: string;
  sourceId: number | null;
  importedFileId: number | null;
  projectId: number | null;
  projectName?: string | null;
  fileName: string;
  status: string;
  createdAt: string | null;
};

const MainLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const seenIdsRef = useRef<Set<string>>(new Set());
  const seededRef = useRef(false);
  const stopPollingRef = useRef(false);
  const toastTimerRef = useRef<number | null>(null);
  const [toast, setToast] = useState<{ title: string; message: string; tone: "success" | "error" } | null>(null);

  useEffect(() => {
    const pollHistory = async () => {
      if (stopPollingRef.current) return;
      try {
        const response = await apiFetch("/api/ingest/history?limit=20");
        if (response.status === 403 || response.status === 401) {
          stopPollingRef.current = true;
          return;
        }
        if (!response.ok) return;

        const payload = await response.json().catch(() => null);
        const items = Array.isArray(payload?.items) ? (payload.items as HistoryWatchItem[]) : [];
        if (!seededRef.current) {
          seenIdsRef.current = new Set(items.map((item) => String(item.id)));
          seededRef.current = true;
          return;
        }

        const newItems = items.filter((item) => !seenIdsRef.current.has(String(item.id)));
        if (newItems.length === 0) return;

        for (const item of items) {
          seenIdsRef.current.add(String(item.id));
        }

        const newestFirst = [...newItems].sort((left, right) => {
          const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
          const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
          return leftTime - rightTime;
        });

        for (const item of newestFirst) {
          const detail: IngestionUpdateDetail = {
            id: String(item.id),
            sourceId: item.sourceId ?? null,
            importedFileId: item.importedFileId ?? null,
            projectId: item.projectId ?? null,
            fileName: item.fileName || "Unknown file",
            status: String(item.status || "PENDING").toUpperCase(),
            createdAt: item.createdAt ?? null,
          };
          dispatchIngestionUpdate(detail);
        }

        const latestVisible = [...newestFirst]
          .reverse()
          .find((item) => {
            const status = String(item.status || "").toUpperCase();
            return status === "SUCCESS" || status === "FAILED";
          });

        if (!latestVisible) return;

        if (toastTimerRef.current) {
          window.clearTimeout(toastTimerRef.current);
        }

        const latestStatus = String(latestVisible.status || "").toUpperCase();
        setToast({
          title: latestStatus === "SUCCESS" ? "Upload successful" : "Upload failed",
          message:
            latestStatus === "SUCCESS"
              ? `${latestVisible.fileName} was uploaded into the system successfully.`
              : `${latestVisible.fileName} could not be imported.`,
          tone: latestStatus === "SUCCESS" ? "success" : "error",
        });
        toastTimerRef.current = window.setTimeout(() => setToast(null), 4000);
      } catch {
        // Keep polling quiet; this watcher should not break page rendering.
      }
    };

    void pollHistory();
    const timer = window.setInterval(() => {
      void pollHistory();
    }, 2000);

    return () => {
      window.clearInterval(timer);
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  return (
    <div className="flex min-h-screen bg-gray-100 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <Sidebar />
      <main className="flex-1 bg-gray-50 dark:bg-gray-950">
        <HeaderBar />
        {children}
      </main>
      {toast ? (
        <div className="pointer-events-none fixed right-6 top-24 z-[70]">
          <div
            className={`min-w-[280px] max-w-sm rounded-2xl border px-4 py-3 shadow-xl backdrop-blur ${
              toast.tone === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-red-200 bg-red-50 text-red-900"
            }`}
          >
            <div className="text-sm font-semibold">{toast.title}</div>
            <div className="mt-1 text-xs">{toast.message}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default MainLayout;

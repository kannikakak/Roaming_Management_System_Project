import React, { useEffect, useMemo, useState } from "react";
import { ShieldCheck, Lock, Globe, Gauge, Database, FileWarning } from "lucide-react";
import { apiFetch } from "../utils/api";

type SecurityCheckResponse = {
  ok: boolean;
  message?: string;
  summary?: {
    encryptionRequired: boolean;
    hasEncryptionKey: boolean;
    httpsEnforced: boolean;
    retentionEnabled: boolean;
  };
  encryption?: { required: boolean; hasKey: boolean };
  https?: { enforced: boolean };
  rateLimit?: {
    auth: { windowMs: number; max: number };
    upload: { windowMs: number; max: number };
  };
  upload?: {
    limits: {
      maxFileSizeMb: number;
      maxFiles: number;
      maxRows: number;
      maxColumns: number;
      rowBatchSize: number;
    };
    malwareScan: {
      enabled: boolean;
      command: string;
      allowMissing: boolean;
    };
  };
  retention?: {
    enabled: boolean;
    days: number;
    mode: "delete" | "archive";
    deleteFiles: boolean;
    intervalHours: number;
  };
  timestamp?: string;
};

const formatWindow = (windowMs: number) => {
  const minutes = Math.round(windowMs / 60000);
  return `${minutes}m window`;
};

const StatusPill: React.FC<{ ok: boolean; label: string }> = ({ ok, label }) => (
  <span
    className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${
      ok
        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
        : "bg-rose-50 text-rose-700 border-rose-200"
    }`}
  >
    {label}
  </span>
);

const SystemSecurityPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<SecurityCheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await apiFetch("/api/system/security-check");
        const json = (await res.json()) as SecurityCheckResponse;
        if (!res.ok) {
          throw new Error(json?.message || "Failed to load security check");
        }
        if (mounted) setData(json);
      } catch (err: any) {
        if (mounted) setError(err?.message || "Failed to load security check");
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const summaryCards = useMemo(() => {
    const summary = data?.summary;
    if (!summary) return [];
    return [
      {
        label: "Encryption Key",
        ok: summary.hasEncryptionKey,
        hint: summary.encryptionRequired ? "Required in production" : "Optional in dev",
        icon: Lock,
      },
      {
        label: "HTTPS Enforcement",
        ok: summary.httpsEnforced,
        hint: "FORCE_HTTPS flag",
        icon: Globe,
      },
      {
        label: "Rate Limiting",
        ok: Boolean(data?.rateLimit),
        hint: "Auth + upload protected",
        icon: Gauge,
      },
      {
        label: "Retention Policy",
        ok: summary.retentionEnabled,
        hint: "Archive/delete automation",
        icon: Database,
      },
    ];
  }, [data]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 p-4 md:p-5">
      <div className="max-w-7xl mx-auto space-y-5">
        <section className="bg-white border border-amber-100 rounded-3xl p-5 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center">
                <ShieldCheck className="w-6 h-6 text-amber-700" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Security Center</h2>
                <p className="text-sm text-gray-600">
                  Live security and compliance posture for this system.
                </p>
              </div>
            </div>
            <div className="text-xs text-gray-500">
              {data?.timestamp ? `Last check: ${new Date(data.timestamp).toLocaleString()}` : null}
            </div>
          </div>
        </section>

        {loading ? (
          <div className="bg-white border border-amber-100 rounded-2xl p-6 shadow-sm text-sm text-gray-600">
            Loading security checks...
          </div>
        ) : error ? (
          <div className="bg-white border border-rose-200 rounded-2xl p-6 shadow-sm text-sm text-rose-700">
            {error}
          </div>
        ) : (
          <>
            <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {summaryCards.map((card) => (
                <div
                  key={card.label}
                  className="bg-white rounded-2xl border border-amber-100 p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        {card.label}
                      </p>
                      <div className="mt-2">
                        <StatusPill ok={card.ok} label={card.ok ? "OK" : "Action Needed"} />
                      </div>
                      <p className="text-xs text-gray-500 mt-3">{card.hint}</p>
                    </div>
                    <div className="w-10 h-10 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center">
                      <card.icon className="w-5 h-5 text-amber-700" />
                    </div>
                  </div>
                </div>
              ))}
            </section>

            <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <div className="xl:col-span-2 bg-white rounded-2xl border border-amber-100 p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <FileWarning className="w-5 h-5 text-amber-700" />
                  <h3 className="text-lg font-semibold text-gray-900">Rate Limits</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-3">
                    <div className="text-xs text-gray-500">Authentication</div>
                    <div className="text-xl font-bold text-gray-900 mt-1">
                      {data?.rateLimit?.auth?.max ?? "-"}
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      {data?.rateLimit?.auth ? formatWindow(data.rateLimit.auth.windowMs) : "-"}
                    </div>
                  </div>
                  <div className="rounded-xl border border-amber-100 bg-white p-3">
                    <div className="text-xs text-gray-500">File Uploads</div>
                    <div className="text-xl font-bold text-gray-900 mt-1">
                      {data?.rateLimit?.upload?.max ?? "-"}
                    </div>
                    <div className="text-xs text-gray-600 mt-1">
                      {data?.rateLimit?.upload ? formatWindow(data.rateLimit.upload.windowMs) : "-"}
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-amber-100 p-5 shadow-sm">
                <div className="flex items-center gap-2 mb-4">
                  <Database className="w-5 h-5 text-amber-700" />
                  <h3 className="text-lg font-semibold text-gray-900">Retention</h3>
                </div>
                <div className="space-y-2 text-sm text-gray-700">
                  <div className="flex items-center justify-between">
                    <span>Enabled</span>
                    <StatusPill ok={Boolean(data?.retention?.enabled)} label={data?.retention?.enabled ? "On" : "Off"} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Days</span>
                    <span className="font-semibold">{data?.retention?.days ?? "-"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Mode</span>
                    <span className="font-semibold uppercase">{data?.retention?.mode ?? "-"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Interval</span>
                    <span className="font-semibold">{data?.retention?.intervalHours ?? "-"}h</span>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default SystemSecurityPage;

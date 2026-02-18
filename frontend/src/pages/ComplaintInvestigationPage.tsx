import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Search } from "lucide-react";
import { apiFetch } from "../utils/api";

type Project = {
  id: number;
  name: string;
};

type ComplaintResponse = {
  filters: {
    q: string | null;
    partner: string | null;
    country: string | null;
    days: number;
    limit: number;
  };
  summary: {
    candidatePairs: number;
    uniquePartners: number;
    uniqueCountries: number;
    openAlerts: number;
    recentUploads: number;
  };
  candidates: Array<{
    partner: string;
    country: string;
    rows: number;
    usage: number;
    revenue: number;
    expected: number;
    actual: number;
    leakage: number;
    leakagePct: number | null;
    openAlerts: number;
    riskScore: number;
    lastSeen: string | null;
  }>;
  countryProfiles: Array<{
    country: string;
    partners: number;
    rows: number;
    totalLeakage: number;
    openAlerts: number;
    highestRiskPartner: string | null;
  }>;
  alerts: Array<{
    id: number;
    severity: string;
    status: string;
    title: string;
    message: string;
    partner: string | null;
    projectId: number | null;
    projectName: string | null;
    lastDetectedAt: string;
  }>;
  recentUploads: Array<{
    fileId: number;
    fileName: string;
    projectId: number;
    projectName: string;
    uploadedAt: string;
    totalRows: number;
    partnerCount: number;
    netRevenue: number;
    usage: number;
  }>;
  recommendations: string[];
};

const DAY_OPTIONS = [7, 14, 30, 60, 90];
const LIMIT_OPTIONS = [10, 12, 20, 30];

const numberText = (value: number | null | undefined, digits = 2) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
};

const ComplaintInvestigationPage: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | "all">("all");
  const [q, setQ] = useState("");
  const [partner, setPartner] = useState("");
  const [country, setCountry] = useState("");
  const [days, setDays] = useState(14);
  const [limit, setLimit] = useState(12);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ComplaintResponse | null>(null);

  useEffect(() => {
    const storedUser = localStorage.getItem("authUser");
    const userId = storedUser ? JSON.parse(storedUser)?.id : 1;
    apiFetch(`/api/projects?user_id=${userId}`)
      .then((res) => res.json())
      .then((json) => {
        setProjects(Array.isArray(json) ? (json as Project[]) : []);
      })
      .catch(() => {
        setProjects([]);
      });
  }, []);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (projectId !== "all") params.set("projectId", String(projectId));
    if (q.trim()) params.set("q", q.trim());
    if (partner.trim()) params.set("partner", partner.trim());
    if (country.trim()) params.set("country", country.trim());
    params.set("days", String(days));
    params.set("limit", String(limit));
    return params.toString();
  }, [country, days, limit, partner, projectId, q]);

  const runInvestigation = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await apiFetch(`/api/operations/complaint-investigation?${queryString}`);
      if (!res.ok) {
        let message = "Failed to run complaint investigation.";
        try {
          const json = await res.json();
          if (json?.message) {
            message = String(json.message);
          }
        } catch {
          const text = await res.text();
          if (text) message = text;
        }
        throw new Error(message);
      }
      const json = (await res.json()) as ComplaintResponse;
      setData(json);
    } catch (err: any) {
      setError(err?.message || "Failed to run complaint investigation.");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    runInvestigation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen p-6 bg-gradient-to-br from-amber-50 via-white to-orange-50 dark:from-gray-950 dark:via-gray-950 dark:to-gray-900">
      <div className="max-w-7xl mx-auto space-y-6">
        <section className="rounded-2xl border border-amber-100 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-amber-600 font-semibold dark:text-amber-300">
                Complaint Desk
              </p>
              <h2 className="text-3xl font-bold text-gray-900 mt-2 dark:text-gray-100">
                Fast partner and country complaint triage
              </h2>
              <p className="text-sm text-gray-500 mt-1.5 dark:text-gray-400">
                Search by partner, country, or keyword to identify likely problem corridors, open alerts, and recent upload context.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3">
              <label className="md:col-span-2 xl:col-span-2 relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 dark:text-gray-500" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Complaint keyword..."
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-amber-100 bg-white text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
                />
              </label>

              <input
                value={partner}
                onChange={(e) => setPartner(e.target.value)}
                placeholder="Partner"
                className="w-full px-3 py-2.5 rounded-xl border border-amber-100 bg-white text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
              />

              <input
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="Country"
                className="w-full px-3 py-2.5 rounded-xl border border-amber-100 bg-white text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
              />

              <select
                value={projectId}
                onChange={(e) => {
                  const next = e.target.value;
                  setProjectId(next === "all" ? "all" : Number(next));
                }}
                className="w-full px-3 py-2.5 rounded-xl border border-amber-100 bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
              >
                <option value="all">All Projects</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>

              <div className="grid grid-cols-2 gap-2 xl:col-span-1">
                <select
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                  className="w-full px-2 py-2.5 rounded-xl border border-amber-100 bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
                >
                  {DAY_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {value}d
                    </option>
                  ))}
                </select>
                <select
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                  className="w-full px-2 py-2.5 rounded-xl border border-amber-100 bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
                >
                  {LIMIT_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      Top {value}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={runInvestigation}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600"
              >
                <Search className="w-4 h-4" />
                Run Investigation
              </button>
            </div>
          </div>
        </section>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <Loader2 className="w-4 h-4 animate-spin" />
            Checking complaint data...
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </div>
        )}

        {data && (
          <>
            <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                { label: "Partner-Country Pairs", value: data.summary.candidatePairs },
                { label: "Partners", value: data.summary.uniquePartners },
                { label: "Countries", value: data.summary.uniqueCountries },
                { label: "Open Alerts", value: data.summary.openAlerts },
                { label: "Recent Uploads", value: data.summary.recentUploads },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl border border-amber-100 bg-white p-4 dark:border-white/10 dark:bg-white/5"
                >
                  <div className="text-xs text-gray-500 dark:text-gray-400">{item.label}</div>
                  <div className="mt-1 text-xl font-bold text-amber-700 dark:text-amber-300">
                    {numberText(item.value, 0)}
                  </div>
                </div>
              ))}
            </section>

            <section className="rounded-2xl border border-amber-100 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-300" />
                <h3 className="font-semibold text-gray-900 dark:text-gray-100">High-risk partner/country candidates</h3>
              </div>
              {data.candidates.length === 0 ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">No candidate issues found for current filters.</div>
              ) : (
                <div className="overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500 dark:text-gray-400">
                        <th className="py-2 pr-3">Partner</th>
                        <th className="py-2 pr-3">Country</th>
                        <th className="py-2 pr-3">Risk</th>
                        <th className="py-2 pr-3">Leakage</th>
                        <th className="py-2 pr-3">Leakage %</th>
                        <th className="py-2 pr-3">Rows</th>
                        <th className="py-2 pr-3">Open Alerts</th>
                        <th className="py-2 pr-3">Last Seen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.candidates.map((row, index) => (
                        <tr key={`${row.partner}-${row.country}-${index}`} className="border-t border-amber-100/70 dark:border-white/10">
                          <td className="py-2 pr-3 font-medium text-gray-900 dark:text-gray-100">{row.partner}</td>
                          <td className="py-2 pr-3">{row.country}</td>
                          <td className="py-2 pr-3 text-amber-700 dark:text-amber-300">{numberText(row.riskScore, 1)}</td>
                          <td className="py-2 pr-3">{numberText(row.leakage)}</td>
                          <td className="py-2 pr-3">{row.leakagePct === null ? "-" : `${numberText(row.leakagePct, 2)}%`}</td>
                          <td className="py-2 pr-3">{numberText(row.rows, 0)}</td>
                          <td className="py-2 pr-3">{numberText(row.openAlerts, 0)}</td>
                          <td className="py-2 pr-3">{row.lastSeen || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              <div className="rounded-2xl border border-amber-100 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">Country Profiles</h3>
                {data.countryProfiles.length === 0 ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">No country profile data.</div>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {data.countryProfiles.map((item) => (
                      <li key={item.country} className="rounded-xl p-3 bg-amber-50/70 dark:bg-white/5">
                        <div className="font-medium text-gray-900 dark:text-gray-100">{item.country}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          Partners {item.partners} | Leakage {numberText(item.totalLeakage)} | Alerts {item.openAlerts}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          Highest risk partner: {item.highestRiskPartner || "-"}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-2xl border border-amber-100 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">Open Alerts</h3>
                {data.alerts.length === 0 ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">No open alerts in this filter window.</div>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {data.alerts.map((alert) => (
                      <li key={alert.id} className="rounded-xl p-3 bg-amber-50/70 dark:bg-white/5">
                        <div className="font-medium text-gray-900 dark:text-gray-100">{alert.title}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {alert.severity.toUpperCase()} | {alert.partner || "Unknown Partner"} | {new Date(alert.lastDetectedAt).toLocaleString()}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-2xl border border-amber-100 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">Recent Uploads</h3>
                {data.recentUploads.length === 0 ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">No recent uploads for selected scope.</div>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {data.recentUploads.map((file) => (
                      <li key={file.fileId} className="rounded-xl p-3 bg-amber-50/70 dark:bg-white/5">
                        <div className="font-medium text-gray-900 dark:text-gray-100">{file.fileName}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {file.projectName} | {new Date(file.uploadedAt).toLocaleString()}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          Rows {numberText(file.totalRows, 0)} | Partners {numberText(file.partnerCount, 0)}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-amber-100 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
              <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">Recommended Actions</h3>
              {data.recommendations.length === 0 ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">No recommendation generated.</div>
              ) : (
                <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700 dark:text-gray-200">
                  {data.recommendations.map((item, index) => (
                    <li key={`${index}-${item}`}>{item}</li>
                  ))}
                </ol>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
};

export default ComplaintInvestigationPage;

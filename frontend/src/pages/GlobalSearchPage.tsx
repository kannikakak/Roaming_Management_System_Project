import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Loader2, Search } from "lucide-react";
import { apiFetch } from "../utils/api";

type SearchRow = {
  rowId: number;
  fileId: number;
  fileName: string;
  uploadedAt: string;
  projectId: number;
  projectName: string;
  partner: string | null;
  country: string | null;
  date: string | null;
  preview: Record<string, any>;
};

type SearchResponse = {
  query: {
    q: string | null;
    partner: string | null;
    country: string | null;
    startDate: string | null;
    endDate: string | null;
    limit: number;
  };
  counts: {
    files: number;
    reports: number;
    dashboards: number;
    rows: number;
  };
  results: {
    files: Array<{
      id: number;
      name: string;
      fileType: string;
      uploadedAt: string;
      projectId: number;
      projectName: string;
    }>;
    reports: Array<{ id: number; name: string; status: string; createdAt: string; updatedAt: string }>;
    dashboards: Array<{
      id: number;
      userId: number;
      title: string;
      description: string | null;
      createdAt: string;
      updatedAt: string;
    }>;
    rows: SearchRow[];
  };
};

const useQueryParams = () => {
  const location = useLocation();
  return useMemo(() => new URLSearchParams(location.search), [location.search]);
};

const GlobalSearchPage: React.FC = () => {
  const params = useQueryParams();
  const navigate = useNavigate();

  const [q, setQ] = useState("");
  const [partner, setPartner] = useState("");
  const [country, setCountry] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SearchResponse | null>(null);

  useEffect(() => {
    setQ(params.get("q") || "");
    setPartner(params.get("partner") || "");
    setCountry(params.get("country") || "");
    setStartDate(params.get("startDate") || "");
    setEndDate(params.get("endDate") || "");
  }, [params]);

  useEffect(() => {
    const hasAnyParam = ["q", "partner", "country", "startDate", "endDate"].some((key) =>
      Boolean(params.get(key))
    );
    if (!hasAnyParam) {
      setData(null);
      setError(null);
      return;
    }

    let mounted = true;
    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await apiFetch(`/api/search/global?${params.toString()}`);
        if (!res.ok) {
          const message = await res.text();
          throw new Error(message || "Search failed");
        }
        const json = (await res.json()) as SearchResponse;
        if (mounted) setData(json);
      } catch (err: any) {
        if (mounted) setError(err.message || "Global search failed.");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    run();
    return () => {
      mounted = false;
    };
  }, [params]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = new URLSearchParams();
    if (q.trim()) next.set("q", q.trim());
    if (partner.trim()) next.set("partner", partner.trim());
    if (country.trim()) next.set("country", country.trim());
    if (startDate) next.set("startDate", startDate);
    if (endDate) next.set("endDate", endDate);
    navigate(`/search?${next.toString()}`);
  };

  const openInDataExplorer = (row: SearchRow) => {
    navigate("/data-explorer", {
      state: {
        projectId: row.projectId,
        fileId: row.fileId,
      },
    });
  };

  const counts = data?.counts;

  return (
    <div className="min-h-screen p-6 bg-gradient-to-br from-amber-50 via-white to-orange-50 dark:from-gray-950 dark:via-gray-950 dark:to-gray-900">
      <div className="max-w-7xl mx-auto space-y-6">
        <section className="rounded-3xl p-6 border border-amber-100 bg-white/95 shadow-sm dark:border-white/10 dark:bg-white/5">
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-amber-600 font-semibold dark:text-amber-300">
                Global Search
              </p>
              <h2 className="text-3xl font-bold text-gray-900 mt-2 dark:text-gray-100">
                Search across roaming data
              </h2>
              <p className="text-sm text-gray-500 mt-1.5 dark:text-gray-400">
                Query uploaded files, reports, dashboards, and row-level roaming records by partner, country, and date range.
              </p>
            </div>

            <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <label className="md:col-span-2 relative">
                <Search className="w-4 h-4 text-gray-400 dark:text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Partner, country, or keyword..."
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-amber-100 bg-white text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-100 dark:placeholder:text-gray-500"
                />
              </label>
              <input
                value={partner}
                onChange={(e) => setPartner(e.target.value)}
                placeholder="Partner filter"
                className="w-full px-3 py-2.5 rounded-xl border border-amber-100 bg-white text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
              />
              <input
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="Country filter"
                className="w-full px-3 py-2.5 rounded-xl border border-amber-100 bg-white text-sm text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
              />
              <div className="grid grid-cols-2 gap-2 md:col-span-1">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-amber-100 bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
                />
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-amber-100 bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-300 dark:border-white/10 dark:bg-white/5 dark:text-gray-100"
                />
              </div>
              <button
                type="submit"
                className="md:col-span-5 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-amber-500 text-white font-semibold hover:bg-amber-600"
              >
                Run Search
              </button>
            </form>

            {counts && (
              <div className="flex flex-wrap gap-2 text-xs">
                {[
                  { label: "Files", value: counts.files },
                  { label: "Reports", value: counts.reports },
                  { label: "Dashboards", value: counts.dashboards },
                  { label: "Rows", value: counts.rows },
                ].map((c) => (
                  <div
                    key={c.label}
                    className="px-3 py-1.5 rounded-full border border-amber-200 bg-amber-50 text-amber-800 font-semibold dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-300"
                  >
                    {c.label}: {c.value}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            <Loader2 className="w-4 h-4 animate-spin" /> Searching...
          </div>
        )}
        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 dark:bg-red-500/10 dark:border-red-500/20 dark:text-red-300">
            {error}
          </div>
        )}

        {data && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <section className="xl:col-span-1 space-y-6">
              <div className="rounded-2xl border border-amber-100 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">Files</h3>
                {data.results.files.length === 0 ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">No matching files</div>
                ) : (
                  <ul className="space-y-3 text-sm">
                    {data.results.files.map((f) => (
                      <li key={f.id} className="rounded-xl border border-transparent p-3 bg-amber-50/60 dark:bg-white/5">
                        <div className="font-semibold text-gray-900 dark:text-gray-100">{f.name}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {f.projectName} â€¢ {new Date(f.uploadedAt).toLocaleDateString()}
                        </div>
                        <button
                          onClick={() =>
                            navigate("/data-explorer", {
                              state: { projectId: f.projectId, fileId: f.id },
                            })
                          }
                          className="mt-2 text-xs font-semibold text-amber-700 hover:text-amber-800 dark:text-amber-300"
                        >
                          Open in Data Explorer
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-2xl border border-amber-100 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">Reports</h3>
                {data.results.reports.length === 0 ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">No matching reports</div>
                ) : (
                  <ul className="space-y-3 text-sm">
                    {data.results.reports.map((r) => (
                      <li key={r.id} className="rounded-xl border border-transparent p-3 bg-amber-50/60 dark:bg-white/5">
                        <div className="font-semibold text-gray-900 dark:text-gray-100">{r.name}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {r.status} â€¢ {new Date(r.updatedAt).toLocaleString()}
                        </div>
                        <button
                          onClick={() => navigate("/reports-library")}
                          className="mt-2 text-xs font-semibold text-amber-700 hover:text-amber-800 dark:text-amber-300"
                        >
                          View in Reports Library
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-2xl border border-amber-100 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
                <h3 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">Dashboards</h3>
                {data.results.dashboards.length === 0 ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">No matching dashboards</div>
                ) : (
                  <ul className="space-y-3 text-sm">
                    {data.results.dashboards.map((d) => (
                      <li key={d.id} className="rounded-xl border border-transparent p-3 bg-amber-50/60 dark:bg-white/5">
                        <div className="font-semibold text-gray-900 dark:text-gray-100">{d.title}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          Updated {new Date(d.updatedAt).toLocaleString()}
                        </div>
                        <button
                          onClick={() => navigate("/dashboard")}
                          className="mt-2 text-xs font-semibold text-amber-700 hover:text-amber-800 dark:text-amber-300"
                        >
                          Open Dashboard
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section className="xl:col-span-2 rounded-2xl border border-amber-100 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-gray-100">Roaming Rows</h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Row-level matches for roaming partner, country, and date filters.
                  </p>
                </div>
              </div>

              {data.results.rows.length === 0 ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">No matching rows</div>
              ) : (
                <div className="space-y-3">
                  {data.results.rows.map((row) => (
                    <div
                      key={`${row.rowId}-${row.fileId}`}
                      className="rounded-xl border border-amber-100 bg-amber-50/50 p-4 dark:border-white/10 dark:bg-white/5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                          {row.partner || "Unknown Partner"} â€¢ {row.country || "Unknown Country"}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {row.date ? row.date : new Date(row.uploadedAt).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                        {row.projectName} / {row.fileName}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {Object.entries(row.preview).map(([key, value]) => (
                          <div
                            key={key}
                            className="text-[11px] px-2 py-1 rounded-lg border border-amber-200 bg-white text-gray-700 dark:border-white/10 dark:bg-white/5 dark:text-gray-200"
                            title={String(value)}
                          >
                            <span className="font-semibold">{key}:</span> {String(value)}
                          </div>
                        ))}
                      </div>

                      <div className="mt-3">
                        <button
                          onClick={() => openInDataExplorer(row)}
                          className="text-xs font-semibold text-amber-700 hover:text-amber-800 dark:text-amber-300"
                        >
                          Drill down in Data Explorer
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
};

export default GlobalSearchPage;

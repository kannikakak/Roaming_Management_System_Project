import React, { useEffect, useState } from "react";
import { apiFetch } from "../utils/api";

type Template = {
  id: number;
  name: string;
  layout: any;
  created_at: string;
};

const TemplateManagerPage: React.FC = () => {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [name, setName] = useState("");
  const [layout, setLayout] = useState("{\"sections\":[]}");

  const load = async () => {
    const res = await apiFetch("/api/templates");
    const data = await res.json();
    setTemplates(Array.isArray(data) ? data : []);
  };

  useEffect(() => {
    load();
  }, []);

  const createTemplate = async () => {
    try {
      const parsed = JSON.parse(layout);
      const storedUser = localStorage.getItem("authUser");
      const userId = storedUser ? JSON.parse(storedUser).id : null;
      const res = await apiFetch("/api/templates", {
        method: "POST",
        body: JSON.stringify({ name, layout: parsed, created_by: userId }),
      });
      if (!res.ok) throw new Error(await res.text());
      setName("");
      setLayout("{\"sections\":[]}");
      load();
    } catch (err: any) {
      alert(err.message || "Invalid JSON");
    }
  };

  const deleteTemplate = async (id: number) => {
    if (!window.confirm("Delete this template?")) return;
    await apiFetch(`/api/templates/${id}`, { method: "DELETE" });
    load();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 p-6">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl font-bold text-amber-800 mb-6">Template Manager</h2>
        <div className="bg-white border rounded-2xl p-5 mb-6">
          <h3 className="font-semibold mb-3">Create Template</h3>
          <input
            className="w-full border rounded px-3 py-2 mb-3"
            placeholder="Template name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <textarea
            className="w-full border rounded px-3 py-2 mb-3 text-xs font-mono h-28"
            value={layout}
            onChange={(e) => setLayout(e.target.value)}
          />
          <button
            onClick={createTemplate}
            className="px-4 py-2 rounded bg-amber-500 text-white font-semibold"
          >
            Save Template
          </button>
        </div>

        <div className="bg-white border rounded-2xl p-5">
          <h3 className="font-semibold mb-3">Saved Templates</h3>
          {templates.length === 0 ? (
            <div className="text-sm text-gray-500">No templates yet.</div>
          ) : (
            <ul className="space-y-2 text-sm">
              {templates.map((t) => (
                <li key={t.id} className="flex items-center justify-between border rounded p-3">
                  <div>
                    <div className="font-semibold">{t.name}</div>
                    <div className="text-xs text-gray-500">
                      {new Date(t.created_at).toLocaleString()}
                    </div>
                  </div>
                  <button className="text-red-600" onClick={() => deleteTemplate(t.id)}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default TemplateManagerPage;

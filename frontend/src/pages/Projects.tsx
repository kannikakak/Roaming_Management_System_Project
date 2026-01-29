import React, { useEffect, useMemo, useState } from "react";
import { Plus, Edit2, Trash2, MoreVertical, LayoutDashboard, Clock, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../utils/api";
import Surface from "../components/Surface";

type ProjectType = {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

const ACCENT = "#EACE5F";
const ACCENT_LIGHT = "#FFF9E2";

// Read response safely (JSON or useful error)
async function readJsonSafe(res: Response) {
  const text = await res.text();

  // Empty response is valid sometimes, but your API should return JSON.
  if (!text) {
    return { ok: res.ok, status: res.status, data: null, raw: "" };
  }

  // Try parse JSON; if fails, it's likely HTML (proxy/mount problem)
  try {
    const data = JSON.parse(text);
    return { ok: res.ok, status: res.status, data, raw: text };
  } catch {
    return { ok: res.ok, status: res.status, data: null, raw: text };
  }
}

const Projects: React.FC = () => {
  const navigate = useNavigate();

  const storedUser = localStorage.getItem("authUser");
  const userId = storedUser ? JSON.parse(storedUser).id : 1;

  const [projects, setProjects] = useState<ProjectType[]>([]);
  const [form, setForm] = useState({ name: "", description: "" });

  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const [loading, setLoading] = useState(true);

  const modalTitle = useMemo(
    () => (editingId ? "Edit Project" : "Create New Project"),
    [editingId]
  );

  // Fetch projects
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);

        const res = await apiFetch(`/api/projects?user_id=${userId}`);
        const parsed = await readJsonSafe(res);

        if (!parsed.ok) {
          const msg =
            parsed.data?.error ||
            `Request failed (${parsed.status}). Raw response: ${parsed.raw?.slice(0, 200)}`;
          throw new Error(msg);
        }

        // If not JSON, show the raw response (proxy issue)
        if (!parsed.data) {
          throw new Error(
            `Server did not return JSON. Raw response: ${parsed.raw?.slice(0, 200)}`
          );
        }

        if (!cancelled) setProjects(parsed.data as ProjectType[]);
      } catch (err: any) {
        console.error("Error fetching projects:", err);
        alert("Error fetching projects: " + err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ name: "", description: "" });
    setShowModal(true);
  };

  const openEdit = (p: ProjectType) => {
    setEditingId(p.id);
    setForm({ name: p.name ?? "", description: p.description ?? "" });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingId(null);
    setForm({ name: "", description: "" });
  };

  const handleCreate = async () => {
    if (!form.name.trim()) {
      alert("Project name is required");
      return;
    }

    try {
      const res = await apiFetch("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description?.trim() || null,
          user_id: userId,
        }),
      });

      const parsed = await readJsonSafe(res);

      if (!parsed.ok) {
        const msg =
          parsed.data?.error ||
          `Create failed (${parsed.status}). Raw response: ${parsed.raw?.slice(0, 200)}`;
        throw new Error(msg);
      }

      if (!parsed.data) {
        throw new Error(
          `Server did not return JSON. Raw response: ${parsed.raw?.slice(0, 200)}`
        );
      }

      const newProject = parsed.data as ProjectType;
      setProjects((prev) => [...prev, newProject]);
      closeModal();
    } catch (err: any) {
      alert("Error creating project: " + err.message);
    }
  };

  const handleEdit = async (id: number) => {
    if (!form.name.trim()) {
      alert("Project name is required");
      return;
    }

    try {
      const res = await apiFetch(`/api/projects/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description?.trim() || null,
        }),
      });

      const parsed = await readJsonSafe(res);

      if (!parsed.ok) {
        const msg =
          parsed.data?.error ||
          `Update failed (${parsed.status}). Raw response: ${parsed.raw?.slice(0, 200)}`;
        throw new Error(msg);
      }

      if (!parsed.data) {
        throw new Error(
          `Server did not return JSON. Raw response: ${parsed.raw?.slice(0, 200)}`
        );
      }

      const updated = parsed.data as ProjectType;
      setProjects((prev) => prev.map((p) => (p.id === id ? updated : p)));
      closeModal();
    } catch (err: any) {
      alert("Error updating project: " + err.message);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      const res = await apiFetch(`/api/projects/${id}`, { method: "DELETE" });
      const parsed = await readJsonSafe(res);

      if (!parsed.ok) {
        const msg =
          parsed.data?.error ||
          `Delete failed (${parsed.status}). Raw response: ${parsed.raw?.slice(0, 200)}`;
        throw new Error(msg);
      }

      setProjects((prev) => prev.filter((p) => p.id !== id));
      setDeleteId(null);
    } catch (err: any) {
      alert("Error deleting project: " + err.message);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-amber-50 to-white dark:from-gray-950 dark:via-gray-900 dark:to-gray-900">
      {/* Header */}
      <div className="max-w-7xl mx-auto mb-10 px-6 pt-10">
        <h1 className="text-4xl font-extrabold mb-2 text-gray-900 tracking-tight dark:text-white">Projects</h1>
        <p className="text-lg text-gray-600 dark:text-gray-300">Manage your projects and track progress</p>
      </div>

      {/* Projects Section */}
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Recent Projects</h2>
          <button
            style={{ background: ACCENT, color: "#fff" }}
            className="hover:brightness-110 px-6 py-3 rounded-full font-semibold shadow-lg transition-all flex items-center gap-2"
            onClick={openCreate}
          >
            <Plus className="w-5 h-5" />
            Create New
          </button>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
          {/* Create new project card */}
          <Surface
            className="group flex flex-col items-center justify-center border-dashed h-64 cursor-pointer hover:scale-105 transition-all shadow-md dark:shadow-none"
            borderColor={ACCENT}
            style={{ borderWidth: 2 }}
            onClick={openCreate}
          >
            <div
              className="flex items-center justify-center w-20 h-20 rounded-full mb-4 transition-all"
              style={{ background: ACCENT_LIGHT }}
            >
              <Plus className="w-10 h-10" style={{ color: ACCENT }} />
            </div>
            <span className="text-xl text-gray-700 dark:text-gray-100 font-semibold">
              Create new project
            </span>
          </Surface>

        {/* Existing projects */}
        {projects.map((p) => (
          <Surface
            key={p.id}
            className="relative h-64 shadow-md hover:shadow-xl hover:scale-105 transition-all p-7 flex flex-col cursor-pointer group"
            borderColor={ACCENT}
            style={{ borderWidth: 2 }}
            onClick={() => navigate(`/card/${p.id}`)}
            title="View project details"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="w-14 h-14 rounded-xl flex items-center justify-center shadow-lg" style={{ background: ACCENT }}>
                <LayoutDashboard className="w-7 h-7 text-white" />
              </div>
              <MoreVertical className="w-6 h-6 text-gray-400 dark:text-gray-300" />
            </div>

            <h3 className="text-xl font-bold text-gray-900 mb-2 truncate dark:text-white">
              {p.name || "Untitled Project"}
            </h3>
            <p className="text-base text-gray-600 mb-3 line-clamp-2 flex-grow dark:text-gray-300">
              {p.description || "No description available"}
            </p>

            <div className="flex items-center justify-between mt-auto pt-4 border-t border-gray-200 dark:border-white/10">
              <span className="text-xs text-gray-500 flex items-center gap-1 dark:text-gray-400">
                <Clock className="w-4 h-4" style={{ color: ACCENT }} />
                {p.created_at
                  ? new Date(p.created_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : "—"}
              </span>
              <div className="flex gap-2">
                <button
                  className="p-2 border rounded-lg hover:bg-yellow-50 transition-all dark:bg-gray-900/50 dark:hover:bg-gray-800"
                  style={{ color: ACCENT, borderColor: ACCENT, borderWidth: 1 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    openEdit(p);
                  }}
                  title="Edit"
                >
                  <Edit2 className="w-5 h-5" />
                </button>

                <button
                  className="p-2 border rounded-lg hover:bg-red-50 transition-all dark:bg-gray-900/50 dark:border-white/10 dark:hover:bg-red-500/10"
                  style={{ borderColor: "rgba(209, 213, 219, 0.5)", borderWidth: 1 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteId(p.id);
                  }}
                  title="Delete"
                >
                  <Trash2 className="w-5 h-5 text-red-500" />
                </button>
              </div>
            </div>

            {/* Delete Confirmation Modal */}
            {deleteId === p.id && (
              <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 backdrop-blur-sm">
                <Surface
                  as="div"
                  className="p-8 max-w-sm mx-4"
                  borderColor={ACCENT}
                  style={{ borderWidth: 1, borderColor: ACCENT }}
                >
                  <div className="text-center mb-6">
                    <div
                      className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                      style={{ background: ACCENT_LIGHT }}
                    >
                      <Trash2 className="w-8 h-8" style={{ color: ACCENT }} />
                    </div>
                    <h3 className="text-xl font-bold text-gray-800 mb-2 dark:text-white">Delete Project?</h3>
                    <p className="text-gray-600 dark:text-gray-300">
                      This action cannot be undone. Are you sure you want to delete this project?
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      className="flex-1 text-white px-4 py-2.5 rounded-xl font-semibold transition-all"
                      style={{ background: ACCENT }}
                      onClick={() => handleDelete(p.id)}
                    >
                      Delete
                    </button>
                    <button
                      className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2.5 rounded-xl font-semibold transition-all dark:bg-gray-900/60 dark:text-gray-100 dark:hover:bg-gray-800"
                      onClick={() => setDeleteId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </Surface>
              </div>
            )}
          </Surface>
        ))}
        </div>

        {/* Loading / Empty State */}
        {loading && (
          <div className="text-center py-16 text-gray-500">Loading projects...</div>
        )}

        {!loading && projects.length === 0 && (
          <div className="text-center py-16">
            <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: ACCENT_LIGHT }}>
              <LayoutDashboard className="w-10 h-10" style={{ color: ACCENT }} />
            </div>
            <p className="text-gray-500 text-lg">No projects yet</p>
            <p className="text-gray-400 text-sm mt-1">Create your first project to get started</p>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-lg">
            <h2 className="text-2xl font-bold mb-6 text-gray-800">{modalTitle}</h2>

            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Project Name</label>
                <input
                  className="border border-gray-300 rounded-xl p-3 w-full focus:outline-none focus:ring-2"
                  style={{ outlineColor: ACCENT }}
                  placeholder="Enter project name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                <textarea
                  className="border border-gray-300 rounded-xl p-3 w-full focus:outline-none focus:ring-2"
                  style={{ outlineColor: ACCENT }}
                  placeholder="Add a description (optional)"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={4}
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button
                className="flex-1 font-semibold px-6 py-3 rounded-xl shadow-sm hover:shadow-md transition-all text-white"
                style={{ background: ACCENT }}
                onClick={() => (editingId ? handleEdit(editingId) : handleCreate())}
              >
                {editingId ? "Update Project" : "Create Project"}
              </button>

              <button
                className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold px-6 py-3 rounded-xl transition-all"
                onClick={closeModal}
              >
                Cancel
              </button>
            </div>

            {/* Helpful debug hint */}
            <p className="text-xs text-gray-400 mt-4">
              If create fails with â€œnon-JSON responseâ€, check your proxy or route mount: backend must serve <b>/api/projects</b>.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Projects;



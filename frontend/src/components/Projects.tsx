import React, { useEffect, useState } from 'react';
import { Plus, Edit2, Trash2, MoreVertical, LayoutDashboard, Clock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// Type for a project
type ProjectType = {
  id: number;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
};

const ACCENT = "#EACE5F";
const ACCENT_LIGHT = "#FFF9E2";

const Projects: React.FC = () => {
  const [projects, setProjects] = useState<ProjectType[]>([]);
  const [form, setForm] = useState({ name: '', description: '' });
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const userId = 1;
  const navigate = useNavigate();

  useEffect(() => {
    fetch(`/api/projects?user_id=${userId}`)
      .then(res => res.json())
      .then(data => setProjects(data))
      .catch(err => console.error('Error fetching projects:', err));
  }, []);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, user_id: userId }),
    });
    const newProject = await res.json();
    setProjects([...projects, newProject]);
    setForm({ name: '', description: '' });
    setShowCreate(false);
  };

  const handleEdit = async (id: number) => {
    if (!form.name.trim()) return;
    const res = await fetch(`/api/projects/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const updated = await res.json();
    setProjects(projects.map(p => p.id === id ? updated : p));
    setEditingId(null);
    setForm({ name: '', description: '' });
    setShowCreate(false);
  };

  const handleDelete = async (id: number) => {
    await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    setProjects(projects.filter(p => p.id !== id));
    setDeleteId(null);
  };

  return (
    <div className="min-h-screen" style={{ background: `linear-gradient(135deg, #fff, ${ACCENT_LIGHT})` }}>
      {/* Header */}
      <div className="max-w-7xl mx-auto mb-10 px-6 pt-10">
        <h1 className="text-4xl font-extrabold mb-2 text-gray-900 tracking-tight">Projects</h1>
        <p className="text-lg text-gray-600">Manage your projects and track progress</p>
      </div>

      {/* Projects Section */}
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-gray-800">Recent Projects</h2>
          <button
            style={{ background: ACCENT, color: "#fff" }}
            className="hover:brightness-110 px-6 py-3 rounded-full font-semibold shadow-lg transition-all flex items-center gap-2"
            onClick={() => {
              setShowCreate(true);
              setEditingId(null);
              setForm({ name: '', description: '' });
            }}
          >
            <Plus className="w-5 h-5" />
            Create New
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
          {/* Create new project card */}
          <div
            className="group flex flex-col items-center justify-center border-2 border-dashed rounded-2xl h-64 cursor-pointer bg-white hover:bg-yellow-50 transition-all shadow-md hover:scale-105"
            style={{ borderColor: ACCENT }}
            onClick={() => {
              setShowCreate(true);
              setEditingId(null);
              setForm({ name: '', description: '' });
            }}
          >
            <div className="flex items-center justify-center w-20 h-20 rounded-full mb-4 transition-all"
              style={{ background: ACCENT_LIGHT }}>
              <Plus className="w-10 h-10" style={{ color: ACCENT }} />
            </div>
            <span className="text-xl text-gray-700 font-semibold">Create new project</span>
          </div>

          {/* Existing projects */}
          {projects.map((p) => (
            <div
              key={p.id}
              className="relative rounded-2xl h-64 shadow-md hover:shadow-xl hover:scale-105 transition-all p-7 flex flex-col border group bg-white cursor-pointer"
              style={{ borderColor: ACCENT, borderWidth: 2 }}
              onClick={() => navigate(`/card/${p.id}`)}
              title="View project details"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-14 h-14 rounded-xl flex items-center justify-center shadow-lg"
                  style={{ background: ACCENT }}>
                  <LayoutDashboard className="w-7 h-7 text-white" />
                </div>
                <MoreVertical className="w-6 h-6 text-gray-400" />
              </div>

              <h3 className="text-xl font-bold text-gray-900 mb-2 truncate">
                {p.name || "Untitled Project"}
              </h3>
              <p className="text-base text-gray-600 mb-3 line-clamp-2 flex-grow">
                {p.description || "No description available"}
              </p>

              <div className="flex items-center justify-between mt-auto pt-4 border-t border-gray-200">
                <span className="text-xs text-gray-500 flex items-center gap-1">
                  <Clock className="w-4 h-4" style={{ color: ACCENT }} />
                  {new Date(p.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
                <div className="flex gap-2">
                  <button
                    className="p-2 bg-white border rounded-lg hover:bg-yellow-50 transition-all"
                    style={{ color: ACCENT, borderColor: ACCENT, borderWidth: 1 }}
                    onClick={e => {
                      e.stopPropagation();
                      setEditingId(p.id);
                      setForm({ name: p.name, description: p.description });
                      setShowCreate(true);
                    }}
                    title="Edit"
                  >
                    <Edit2 className="w-5 h-5" />
                  </button>
                  <button
                    className="p-2 bg-white border border-gray-200 rounded-lg hover:bg-red-50 transition-all"
                    onClick={e => {
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
                  <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm mx-4 animate-in">
                    <div className="text-center mb-6">
                      <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                        style={{ background: ACCENT_LIGHT }}>
                        <Trash2 className="w-8 h-8" style={{ color: ACCENT }} />
                      </div>
                      <h3 className="text-xl font-bold text-gray-800 mb-2">Delete Project?</h3>
                      <p className="text-gray-600">This action cannot be undone. Are you sure you want to delete this project?</p>
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
                        className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2.5 rounded-xl font-semibold transition-all"
                        onClick={() => setDeleteId(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {projects.length === 0 && (
          <div className="text-center py-16">
            <div className="w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4"
              style={{ background: ACCENT_LIGHT }}>
              <LayoutDashboard className="w-10 h-10" style={{ color: ACCENT }} />
            </div>
            <p className="text-gray-500 text-lg">No projects yet</p>
            <p className="text-gray-400 text-sm mt-1">Create your first project to get started</p>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-lg animate-in">
            <h2 className="text-2xl font-bold mb-6 text-gray-800">
              {editingId ? 'Edit Project' : 'Create New Project'}
            </h2>
            <div className="space-y-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Project Name</label>
                <input
                  className="border border-gray-300 rounded-xl p-3 w-full focus:outline-none focus:ring-2"
                  style={{ outlineColor: ACCENT }}
                  placeholder="Enter project name"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                <textarea
                  className="border border-gray-300 rounded-xl p-3 w-full focus:outline-none focus:ring-2"
                  style={{ outlineColor: ACCENT }}
                  placeholder="Add a description (optional)"
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  rows={4}
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                className="flex-1 font-semibold px-6 py-3 rounded-xl shadow-sm hover:shadow-md transition-all text-white"
                style={{ background: ACCENT }}
                onClick={() => editingId ? handleEdit(editingId) : handleCreate()}
              >
                {editingId ? 'Update Project' : 'Create Project'}
              </button>
              <button
                className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold px-6 py-3 rounded-xl transition-all"
                onClick={() => {
                  setShowCreate(false);
                  setEditingId(null);
                  setForm({ name: '', description: '' });
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Projects;
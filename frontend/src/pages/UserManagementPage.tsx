import React, { useEffect, useState } from "react";
import { apiFetch } from "../utils/api";

type UserRow = {
  id: number;
  name: string;
  email: string;
  roles?: string;
  role?: string;
  isActive: number;
};

const UserManagementPage: React.FC = () => {
  const [users, setUsers] = useState<UserRow[]>([]);

  const load = async () => {
    const res = await apiFetch("/api/admin/users");
    const data = await res.json();
    setUsers(Array.isArray(data) ? data : []);
  };

  useEffect(() => {
    load();
  }, []);

  const updateRole = async (userId: number, role: string) => {
    await apiFetch(`/api/admin/users/${userId}/role`, {
      method: "PUT",
      body: JSON.stringify({ role }),
    });
    load();
  };

  const toggleActive = async (userId: number, isActive: number) => {
    await apiFetch(`/api/admin/users/${userId}/status`, {
      method: "PUT",
      body: JSON.stringify({ isActive: !isActive }),
    });
    load();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 p-6">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl font-bold text-amber-800 mb-6">User Management</h2>
        <div className="bg-white border rounded-2xl p-5">
          {users.length === 0 ? (
            <div className="text-sm text-gray-500">No users.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-600">
                  <th className="py-2">Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t">
                    <td className="py-2 font-semibold">{u.name}</td>
                    <td>{u.email}</td>
                    <td>
                      <select
                        className="border rounded px-2 py-1"
                        value={(u.roles || u.role || "viewer").split(",")[0]}
                        onChange={(e) => updateRole(u.id, e.target.value)}
                      >
                        <option value="admin">admin</option>
                        <option value="analyst">analyst</option>
                        <option value="viewer">viewer</option>
                      </select>
                    </td>
                    <td>
                      <button
                        className={`text-xs px-2 py-1 rounded ${
                          u.isActive ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600"
                        }`}
                        onClick={() => toggleActive(u.id, u.isActive)}
                      >
                        {u.isActive ? "Active" : "Disabled"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default UserManagementPage;

import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import { ROLE_LABELS, PAGES, ASSIGNABLE_ROLES } from "../types";
import type { AppUser } from "../types";

export default function UsersPage() {
  const { isSuperAdmin } = useAuth();
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "MAINTAINER",
    restrictedPages: [] as string[],
  });
  const [error, setError] = useState("");

  const load = () =>
    api.getUsers().then(({ users: u }) => {
      setUsers(u);
      setLoading(false);
    });

  useEffect(() => {
    if (isSuperAdmin()) load();
    else setLoading(false);
  }, [isSuperAdmin]);

  if (!isSuperAdmin()) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 p-10 text-center">
        <div className="text-lg font-semibold">Super admin access required</div>
      </div>
    );
  }

  const resetForm = () => {
    setForm({
      name: "",
      email: "",
      password: "",
      role: "MAINTAINER",
      restrictedPages: [],
    });
    setEditing(null);
    setShowForm(false);
    setError("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      if (editing) {
        const payload: Record<string, unknown> = {
          name: form.name,
          email: form.email,
          role: form.role,
          restrictedPages: form.restrictedPages,
        };
        if (form.password) payload.password = form.password;
        await api.updateUser(editing.id, payload);
      } else {
        await api.createUser(form);
      }
      resetForm();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save user");
    }
  };

  const startEdit = (u: AppUser) => {
    setEditing(u);
    setForm({
      name: u.name,
      email: u.email,
      password: "",
      role: u.role,
      restrictedPages: u.restrictedPages,
    });
    setShowForm(true);
  };

  const togglePage = (page: string) => {
    setForm((f) => ({
      ...f,
      restrictedPages: f.restrictedPages.includes(page)
        ? f.restrictedPages.filter((p) => p !== page)
        : [...f.restrictedPages, page],
    }));
  };

  if (loading) return <div className="text-slate-500">Loading users…</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">User management</h2>
          <p className="text-sm text-slate-500">Add users, assign roles, and restrict page access.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
          className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-md hover:bg-indigo-700"
        >
          + Add user
        </button>
      </div>

      {showForm && (
        <form onSubmit={submit} className="bg-white rounded-lg border border-slate-200 p-6 space-y-4">
          <div className="font-semibold">{editing ? "Edit user" : "New user"}</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-slate-500">Name</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">Email</label>
              <input
                required
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">
                Password {editing && "(leave blank to keep current)"}
              </label>
              <input
                type="password"
                required={!editing}
                minLength={8}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">Role</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm"
              >
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-2">Restrict from pages (additional)</label>
            <div className="flex flex-wrap gap-2">
              {PAGES.filter((p) => p !== "users").map((page) => (
                <label
                  key={page}
                  className={`text-xs px-2 py-1 rounded-md border cursor-pointer ${
                    form.restrictedPages.includes(page)
                      ? "bg-red-50 border-red-200 text-red-700"
                      : "bg-slate-50 border-slate-200"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mr-1"
                    checked={form.restrictedPages.includes(page)}
                    onChange={() => togglePage(page)}
                  />
                  {page}
                </label>
              ))}
            </div>
          </div>
          {error && <div className="text-sm text-red-600">{error}</div>}
          <div className="flex gap-2">
            <button type="button" onClick={resetForm} className="px-3 py-2 text-sm border border-slate-300 rounded-md">
              Cancel
            </button>
            <button type="submit" className="px-3 py-2 text-sm bg-indigo-600 text-white rounded-md">
              {editing ? "Save changes" : "Create user"}
            </button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="tbl w-full">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Restricted pages</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td className="font-medium">{u.name}</td>
                <td>{u.email}</td>
                <td>{ROLE_LABELS[u.role] || u.role}</td>
                <td className="text-xs">{u.restrictedPages.join(", ") || "—"}</td>
                <td>{u.isActive ? "Active" : "Disabled"}</td>
                <td className="text-right space-x-2">
                  <button type="button" onClick={() => startEdit(u)} className="text-indigo-600 text-sm">
                    Edit
                  </button>
                  {u.isActive && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (confirm("Disable this user?")) {
                          await api.deleteUser(u.id);
                          load();
                        }
                      }}
                      className="text-red-600 text-sm"
                    >
                      Disable
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

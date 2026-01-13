import React, { useEffect, useState } from "react";
import { apiFetch } from "../utils/api";

type Schedule = {
  id: number;
  name: string;
  target_type: string;
  target_id: number;
  frequency: string;
  time_of_day: string;
  day_of_week: number | null;
  day_of_month: number | null;
  recipients_email: string | null;
  recipients_telegram: string | null;
  file_format: string;
  attachment_name?: string | null;
  is_active: number;
  next_run_at: string;
  last_run_at: string | null;
};

const toList = (value: string) =>
  value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

const SchedulesPage: React.FC = () => {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState("");
  const [targetType, setTargetType] = useState("report");
  const [targetId, setTargetId] = useState<number>(1);
  const [frequency, setFrequency] = useState("daily");
  const [timeOfDay, setTimeOfDay] = useState("09:00");
  const [dayOfWeek, setDayOfWeek] = useState<number>(1);
  const [dayOfMonth, setDayOfMonth] = useState<number>(1);
  const [fileFormat, setFileFormat] = useState("pptx");
  const [recipientsEmail, setRecipientsEmail] = useState("");
  const [recipientsTelegram, setRecipientsTelegram] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [attachment, setAttachment] = useState<File | null>(null);

  const loadSchedules = async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/schedules");
      const data = await res.json();
      setSchedules(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load schedules:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSchedules();
  }, []);

  const createSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        name,
        targetType,
        targetId,
        frequency,
        timeOfDay,
        dayOfWeek: frequency === "weekly" ? dayOfWeek : null,
        dayOfMonth: frequency === "monthly" ? dayOfMonth : null,
        recipientsEmail: toList(recipientsEmail),
        recipientsTelegram: toList(recipientsTelegram),
        fileFormat,
        isActive,
      };

      const formData = new FormData();
      Object.entries(payload).forEach(([key, value]) => {
        if (value === null || value === undefined) return;
        if (Array.isArray(value)) {
          formData.append(key, JSON.stringify(value));
        } else {
          formData.append(key, String(value));
        }
      });
      if (attachment) formData.append("file", attachment);

      const res = await apiFetch("/api/schedules/with-file", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error(await res.text());
      setName("");
      setRecipientsEmail("");
      setRecipientsTelegram("");
      setAttachment(null);
      await loadSchedules();
    } catch (err: any) {
      alert(err?.message || "Failed to create schedule");
    }
  };

  const deleteSchedule = async (id: number) => {
    if (!window.confirm("Delete this schedule?")) return;
    await apiFetch(`/api/schedules/${id}`, { method: "DELETE" });
    loadSchedules();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-3xl font-bold text-amber-800">Scheduling</h2>
            <p className="text-sm text-amber-700/80">
              Automate report delivery to email or Telegram on a fixed cadence.
            </p>
          </div>
          <button
            onClick={loadSchedules}
            className="text-sm px-3 py-2 rounded-lg border border-amber-200 bg-white hover:bg-amber-50"
          >
            Refresh
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-amber-100 p-5">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Create Schedule</h3>
            <form
              onSubmit={createSchedule}
              className="grid grid-cols-1 md:grid-cols-2 gap-4"
            >
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Name</label>
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Weekly Roaming Report"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Target</label>
                <div className="flex gap-2">
                  <select
                    className="border rounded-lg px-3 py-2"
                    value={targetType}
                    onChange={(e) => setTargetType(e.target.value)}
                  >
                    <option value="report">Report</option>
                    <option value="dashboard">Dashboard</option>
                  </select>
                  <input
                    type="number"
                    className="flex-1 border rounded-lg px-3 py-2"
                    value={targetId}
                    onChange={(e) => setTargetId(Number(e.target.value))}
                    min={1}
                  />
                </div>
                <div className="text-[11px] text-gray-400 mt-1">
                  Use the ID from your saved report or dashboard.
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Frequency</label>
                <select
                  className="w-full border rounded-lg px-3 py-2"
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value)}
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Time</label>
                <input
                  type="time"
                  className="w-full border rounded-lg px-3 py-2"
                  value={timeOfDay}
                  onChange={(e) => setTimeOfDay(e.target.value)}
                />
              </div>
              {frequency === "weekly" && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                    Day of Week
                  </label>
                  <select
                    className="w-full border rounded-lg px-3 py-2"
                    value={dayOfWeek}
                    onChange={(e) => setDayOfWeek(Number(e.target.value))}
                  >
                    <option value={0}>Sunday</option>
                    <option value={1}>Monday</option>
                    <option value={2}>Tuesday</option>
                    <option value={3}>Wednesday</option>
                    <option value={4}>Thursday</option>
                    <option value={5}>Friday</option>
                    <option value={6}>Saturday</option>
                  </select>
                </div>
              )}
              {frequency === "monthly" && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1">
                    Day of Month
                  </label>
                  <input
                    type="number"
                    className="w-full border rounded-lg px-3 py-2"
                    value={dayOfMonth}
                    onChange={(e) => setDayOfMonth(Number(e.target.value))}
                    min={1}
                    max={31}
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">File Format</label>
                <select
                  className="w-full border rounded-lg px-3 py-2"
                  value={fileFormat}
                  onChange={(e) => setFileFormat(e.target.value)}
                >
                  <option value="pptx">PPTX</option>
                  <option value="pdf">PDF</option>
                  <option value="png">PNG</option>
                  <option value="csv">CSV</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Email Recipients
                </label>
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="a@b.com, c@d.com"
                  value={recipientsEmail}
                  onChange={(e) => setRecipientsEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Telegram Recipients
                </label>
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="@user1, @user2"
                  value={recipientsTelegram}
                  onChange={(e) => setRecipientsTelegram(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Attachment</label>
                <input
                  type="file"
                  className="w-full border rounded-lg px-3 py-2 bg-white"
                  onChange={(e) => setAttachment(e.target.files?.[0] || null)}
                />
                {attachment && (
                  <div className="text-xs text-gray-500 mt-1">
                    {attachment.name} • {Math.round(attachment.size / 1024)} KB
                  </div>
                )}
              </div>
              <label className="flex items-center gap-2 text-xs font-semibold text-gray-600">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                Active schedule
              </label>
              <div className="md:col-span-2">
                <button className="px-4 py-2 rounded-lg bg-amber-500 text-white font-semibold hover:bg-amber-600">
                  Create Schedule
                </button>
                <div className="text-[11px] text-gray-500 mt-2">
                  Attachments are sent with email/Telegram (and noted in Teams) when delivery
                  credentials are configured on the server.
                </div>
              </div>
            </form>
          </div>

          <div className="bg-white rounded-2xl border border-amber-100 shadow-sm p-5">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Overview</h3>
            <div className="space-y-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Active schedules</span>
                <span className="font-semibold text-gray-900">
                  {schedules.filter((s) => s.is_active).length}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Total schedules</span>
                <span className="font-semibold text-gray-900">{schedules.length}</span>
              </div>
              <div className="text-xs text-gray-500">
                Schedules are executed by the server every minute and create delivery notifications.
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-800">Existing Schedules</h3>
          </div>
          {loading ? (
            <div className="text-sm text-gray-500">Loading...</div>
          ) : schedules.length === 0 ? (
            <div className="text-sm text-gray-500">No schedules yet.</div>
          ) : (
            <div className="space-y-3">
              {schedules.map((s) => (
                <div
                  key={s.id}
                  className="border rounded-xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3"
                >
                  <div>
                    <div className="font-semibold text-gray-900">{s.name}</div>
                    <div className="text-xs text-gray-500">
                      {s.frequency} • {s.file_format.toUpperCase()} • Target {s.target_type} #{s.target_id}
                    </div>
                    {s.attachment_name && (
                      <div className="text-xs text-amber-700">
                        Attachment: {s.attachment_name}
                      </div>
                    )}
                    <div className="text-xs text-gray-500">
                      Next run: {s.next_run_at ? new Date(s.next_run_at).toLocaleString() : "-"}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-xs px-2 py-1 rounded-full ${
                        s.is_active ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {s.is_active ? "Active" : "Paused"}
                    </span>
                    <button
                      className="text-xs text-red-600 hover:text-red-700"
                      onClick={() => deleteSchedule(s.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SchedulesPage;

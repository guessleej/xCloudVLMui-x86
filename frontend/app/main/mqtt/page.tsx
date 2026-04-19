"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Circle,
  Cpu,
  Gauge,
  Plus,
  Radio,
  RefreshCw,
  Send,
  Thermometer,
  Trash2,
  Wifi,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import toast from "react-hot-toast";
import { mqttApi } from "@/lib/api";
import type { MqttBrokerStatus, MqttDevice, MqttLatestReading } from "@/types";

// ── Sensor icon & color mapping ───────────────────────────────────────
const SENSOR_META: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  temperature: { icon: Thermometer, color: "text-orange-300",  label: "溫度" },
  vibration:   { icon: Activity,    color: "text-purple-300",  label: "振動" },
  pressure:    { icon: Gauge,       color: "text-blue-300",    label: "壓力" },
  rpm:         { icon: RefreshCw,   color: "text-cyan-300",    label: "轉速" },
  humidity:    { icon: Circle,      color: "text-teal-300",    label: "濕度" },
  voltage:     { icon: Zap,         color: "text-yellow-300",  label: "電壓" },
  current:     { icon: Zap,         color: "text-amber-300",   label: "電流" },
  power:       { icon: Cpu,         color: "text-red-300",     label: "功率" },
};

function getSensorMeta(type: string) {
  return SENSOR_META[type] ?? { icon: Radio, color: "text-slate-300", label: type };
}

// ── Device type options ───────────────────────────────────────────────
const DEVICE_TYPES = ["sensor", "compressor", "motor", "pump", "conveyor", "cooler", "panel", "plc"];

// ── Value quality color ───────────────────────────────────────────────
function qualityPill(quality: string) {
  if (quality === "good")  return "status-pill-ok";
  if (quality === "error") return "status-pill-danger";
  return "status-pill-warn";
}

// ── Format relative time ──────────────────────────────────────────────
function relativeTime(isoStr: string): string {
  const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (diff < 60)  return `${diff}s 前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m 前`;
  return `${Math.floor(diff / 3600)}h 前`;
}

export default function MqttPage() {
  const [brokerStatus, setBrokerStatus] = useState<MqttBrokerStatus | null>(null);
  const [devices, setDevices]           = useState<MqttDevice[]>([]);
  const [latest, setLatest]             = useState<MqttLatestReading[]>([]);
  const [loading, setLoading]           = useState(false);
  const [autoRefresh, setAutoRefresh]   = useState(true);

  // Add device modal
  const [showAddDevice, setShowAddDevice] = useState(false);
  const [addForm, setAddForm] = useState({
    device_id: "", name: "", device_type: "sensor",
    location: "", topic_prefix: "", description: "",
  });
  const [addLoading, setAddLoading] = useState(false);

  // Test publish panel
  const [showPublish, setShowPublish] = useState(false);
  const [pubTopic, setPubTopic]       = useState("xcloud/test_device/temperature");
  const [pubPayload, setPubPayload]   = useState('{"value": 72.5, "unit": "°C", "quality": "good"}');
  const [pubLoading, setPubLoading]   = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, devicesRes, latestRes] = await Promise.all([
        mqttApi.status(),
        mqttApi.listDevices(),
        mqttApi.getLatestReadings(),
      ]);
      setBrokerStatus(statusRes.data);
      setDevices(devicesRes.data);
      setLatest(latestRes.data);
    } catch (err: any) {
      toast.error("資料載入失敗：" + (err?.response?.data?.detail ?? err.message));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchAll, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchAll]);

  const handleAddDevice = async () => {
    if (!addForm.device_id || !addForm.name || !addForm.topic_prefix) {
      toast.error("請填寫設備 ID、名稱與 Topic 前綴");
      return;
    }
    setAddLoading(true);
    try {
      await mqttApi.createDevice(addForm);
      toast.success(`設備「${addForm.name}」已新增`);
      setShowAddDevice(false);
      setAddForm({ device_id: "", name: "", device_type: "sensor", location: "", topic_prefix: "", description: "" });
      fetchAll();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? "新增失敗");
    } finally {
      setAddLoading(false);
    }
  };

  const handleDeleteDevice = async (device: MqttDevice) => {
    if (!confirm(`確定要刪除設備「${device.name}」？相關所有讀值也將一併刪除。`)) return;
    try {
      await mqttApi.deleteDevice(device.device_id);
      toast.success(`已刪除設備「${device.name}」`);
      fetchAll();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? "刪除失敗");
    }
  };

  const handlePublish = async () => {
    if (!pubTopic || !pubPayload) { toast.error("請填寫 Topic 與 Payload"); return; }
    setPubLoading(true);
    try {
      await mqttApi.publish(pubTopic, pubPayload);
      toast.success("訊息已發佈 ✓");
      setTimeout(fetchAll, 1500); // 等待 broker → backend 處理
    } catch (err: any) {
      toast.error(err?.response?.data?.detail ?? "發佈失敗");
    } finally {
      setPubLoading(false);
    }
  };

  // Group latest readings by device
  const readingsByDevice: Record<string, MqttLatestReading[]> = {};
  for (const r of latest) {
    if (!readingsByDevice[r.device_id]) readingsByDevice[r.device_id] = [];
    readingsByDevice[r.device_id].push(r);
  }

  const connected = brokerStatus?.connected ?? false;

  return (
    <div className="space-y-5">

      {/* ── Broker 狀態列 ─────────────────────────────────────── */}
      <section className="panel-grid overflow-hidden rounded-[28px] px-5 py-4 sm:px-6">
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border ${
              connected ? "border-emerald-400/30 bg-emerald-500/15" : "border-red-400/30 bg-red-500/15"
            }`}>
              {connected ? <Wifi className="h-5 w-5 text-emerald-300" /> : <WifiOff className="h-5 w-5 text-red-300" />}
            </div>
            <div>
              <div className="section-kicker">IoT Sensor Hub</div>
              <h1 className="display-title mt-0.5 text-xl sm:text-2xl">MQTT 感測器監控</h1>
            </div>

            {brokerStatus && (
              <div className="hidden items-center gap-2 xl:flex">
                <span className={`status-pill ${connected ? "status-pill-ok" : "status-pill-danger"}`}>
                  {connected ? "Broker 連線中" : "Broker 離線"}
                </span>
                <span className="signal-chip">
                  <Radio className="h-3.5 w-3.5 text-slate-300" />
                  {brokerStatus.broker_host}:{brokerStatus.broker_port}
                </span>
                <span className="signal-chip">
                  <Activity className="h-3.5 w-3.5 text-accent-300" />
                  {brokerStatus.message_count.toLocaleString()} 則訊息
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setAutoRefresh((v) => !v)}
              className={`secondary-button ${autoRefresh ? "border-brand-500/50 bg-brand-500/15 text-brand-200" : ""}`}
            >
              <RefreshCw className={`h-4 w-4 ${autoRefresh ? "animate-spin" : ""}`} />
              {autoRefresh ? "自動刷新中" : "手動模式"}
            </button>
            <button onClick={fetchAll} disabled={loading} className="secondary-button">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              刷新
            </button>
            <button onClick={() => setShowPublish((v) => !v)}
              className={`secondary-button ${showPublish ? "border-brand-500/50 bg-brand-500/15 text-brand-200" : ""}`}>
              <Send className="h-4 w-4" />
              測試發佈
            </button>
            <button onClick={() => setShowAddDevice(true)} className="primary-button">
              <Plus className="h-4 w-4" />
              新增設備
            </button>
          </div>
        </div>

        {/* Broker 詳情 */}
        {brokerStatus && (
          <div className="relative z-10 mt-4 grid grid-cols-2 gap-3 border-t border-white/8 pt-4 sm:grid-cols-4">
            <StatTile label="訂閱 Topics" value={brokerStatus.subscriptions[0] ?? "—"} sub="主題過濾器" />
            <StatTile label="累計訊息數" value={brokerStatus.message_count.toLocaleString()} sub="自服務啟動以來" />
            <StatTile label="服務運行時間" value={`${Math.floor(brokerStatus.uptime_seconds / 60)}m`} sub={`${Math.round(brokerStatus.uptime_seconds)}s`} />
            <StatTile label="已登錄設備" value={String(devices.length)} sub={`${devices.filter(d => d.online).length} 台在線`} />
          </div>
        )}
      </section>

      {/* ── 測試發佈面板 ─────────────────────────────────────── */}
      {showPublish && (
        <section className="panel-soft rounded-[28px] p-5">
          <div className="flex items-center justify-between gap-3 border-b border-white/8 pb-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Test Publish</p>
              <h2 className="mt-1 text-base font-semibold text-white">發佈測試訊息</h2>
            </div>
            <button onClick={() => setShowPublish(false)} className="ghost-button h-8 w-8 rounded-xl px-0 text-slate-500">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <div>
              <label className="mb-1.5 block text-xs text-slate-500">Topic</label>
              <input value={pubTopic} onChange={e => setPubTopic(e.target.value)}
                className="w-full rounded-[14px] border border-white/10 bg-slate-950/50 px-3.5 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:border-brand-500/50"
                placeholder="xcloud/device_id/sensor_type" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-slate-500">Payload（JSON 或純數字）</label>
              <input value={pubPayload} onChange={e => setPubPayload(e.target.value)}
                className="w-full rounded-[14px] border border-white/10 bg-slate-950/50 px-3.5 py-2.5 text-sm text-white placeholder-slate-600 outline-none focus:border-brand-500/50"
                placeholder='{"value": 72.5, "unit": "°C"}' />
            </div>
            <div className="flex items-end">
              <button onClick={handlePublish} disabled={pubLoading} className="primary-button whitespace-nowrap">
                {pubLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                發佈
              </button>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Topic 格式：<code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-slate-300">xcloud/&#123;device_id&#125;/&#123;sensor_type&#125;</code>
            &nbsp;— 感測器類型例：temperature、vibration、pressure、rpm、humidity、voltage
          </p>
        </section>
      )}

      {/* ── 設備即時讀值 ─────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-center justify-between px-1">
          <h2 className="text-sm font-semibold text-white">
            設備即時讀值
            <span className="ml-2 text-xs font-normal text-slate-500">
              ({devices.length} 台設備 · 每 5 秒刷新)
            </span>
          </h2>
        </div>

        {devices.length === 0 ? (
          <EmptyState onAdd={() => setShowAddDevice(true)} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {devices.map((device) => (
              <DeviceCard
                key={device.id}
                device={device}
                readings={readingsByDevice[device.device_id] ?? []}
                onDelete={() => handleDeleteDevice(device)}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── 新增設備 Modal ───────────────────────────────────── */}
      {showAddDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="panel-soft w-full max-w-lg rounded-[32px] p-6">
            <div className="flex items-center justify-between gap-3 border-b border-white/8 pb-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Register Device</p>
                <h2 className="mt-1 text-lg font-semibold text-white">新增 MQTT 設備</h2>
              </div>
              <button onClick={() => setShowAddDevice(false)} className="ghost-button h-8 w-8 rounded-xl px-0 text-slate-500">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <FormField label="設備 ID *" hint="MQTT Topic 中的唯一識別碼">
                <input value={addForm.device_id} onChange={e => setAddForm(p => ({...p, device_id: e.target.value}))}
                  className="form-input" placeholder="例：compressor_01" />
              </FormField>
              <FormField label="顯示名稱 *" hint="">
                <input value={addForm.name} onChange={e => setAddForm(p => ({...p, name: e.target.value}))}
                  className="form-input" placeholder="例：壓縮機 #1" />
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="設備類型" hint="">
                  <select value={addForm.device_type} onChange={e => setAddForm(p => ({...p, device_type: e.target.value}))}
                    className="form-input">
                    {DEVICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </FormField>
                <FormField label="安裝位置" hint="">
                  <input value={addForm.location} onChange={e => setAddForm(p => ({...p, location: e.target.value}))}
                    className="form-input" placeholder="廠房 A / 區域 1" />
                </FormField>
              </div>
              <FormField label="Topic 前綴 *" hint="設備發佈的 MQTT 主題前綴">
                <input value={addForm.topic_prefix} onChange={e => setAddForm(p => ({...p, topic_prefix: e.target.value}))}
                  className="form-input" placeholder="例：xcloud/compressor_01" />
              </FormField>
              <FormField label="備註" hint="">
                <input value={addForm.description} onChange={e => setAddForm(p => ({...p, description: e.target.value}))}
                  className="form-input" placeholder="選填說明" />
              </FormField>
            </div>

            <div className="mt-6 flex gap-3">
              <button onClick={() => setShowAddDevice(false)} className="secondary-button flex-1">取消</button>
              <button onClick={handleAddDevice} disabled={addLoading} className="primary-button flex-1">
                {addLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {addLoading ? "新增中..." : "確認新增"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────

function DeviceCard({ device, readings, onDelete }: {
  device: MqttDevice;
  readings: MqttLatestReading[];
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className={`panel-soft rounded-[28px] overflow-hidden border ${
      device.online ? "border-emerald-400/15" : "border-white/8"
    }`}>
      {/* Card header */}
      <div className="flex items-center gap-3 border-b border-white/8 px-4 py-3.5">
        <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border ${
          device.online ? "border-emerald-400/20 bg-emerald-400/10" : "border-white/10 bg-white/[0.04]"
        }`}>
          <Radio className={`h-4 w-4 ${device.online ? "text-emerald-300" : "text-slate-500"}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-white">{device.name}</p>
            <span className={`status-pill ${device.online ? "status-pill-ok" : "status-pill-warn"} flex-shrink-0`}>
              {device.online ? "Online" : "Offline"}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500 truncate">
            {device.device_id} · {device.location ?? "未設定位置"}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setExpanded(v => !v)}
            className="ghost-button h-7 w-7 rounded-lg px-0 text-slate-500">
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          <button onClick={onDelete} className="ghost-button h-7 w-7 rounded-lg px-0 text-slate-600 hover:text-red-400">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Sensor readings */}
      {expanded && (
        <div className="p-4">
          {readings.length === 0 ? (
            <div className="rounded-[16px] border border-white/8 bg-slate-950/30 px-4 py-6 text-center">
              <Radio className="mx-auto h-6 w-6 text-slate-600" />
              <p className="mt-2 text-xs text-slate-500">尚未收到任何感測資料</p>
              <p className="mt-1 text-[10px] text-slate-600">
                Topic: <code className="text-slate-500">{device.topic_prefix}/&#123;sensor_type&#125;</code>
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {readings.map((r) => {
                const meta = getSensorMeta(r.sensor_type);
                const Icon = meta.icon;
                return (
                  <div key={r.topic}
                    className="rounded-[18px] border border-white/8 bg-slate-950/40 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <Icon className={`h-3.5 w-3.5 ${meta.color}`} />
                        <span className="text-[10px] text-slate-400">{meta.label}</span>
                      </div>
                      <span className={`status-pill ${qualityPill(r.quality)} !py-0 !text-[9px]`}>
                        {r.quality}
                      </span>
                    </div>
                    <p className="mt-2 font-display text-2xl font-semibold text-white">
                      {r.value !== undefined && r.value !== null
                        ? Number(r.value).toLocaleString(undefined, { maximumFractionDigits: 2 })
                        : "—"}
                      {r.unit && <span className="ml-1 text-sm font-normal text-slate-400">{r.unit}</span>}
                    </p>
                    <p className="mt-1 text-[10px] text-slate-600">{relativeTime(r.timestamp)}</p>
                  </div>
                );
              })}
            </div>
          )}

          {device.last_seen && (
            <p className="mt-3 text-center text-[10px] text-slate-600">
              最後回傳：{relativeTime(device.last_seen)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4">
      <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className="mt-2 font-display text-xl font-semibold text-white break-all">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{sub}</p>
    </div>
  );
}

function FormField({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-slate-400">
        {label}
        {hint && <span className="ml-1.5 font-normal text-slate-600">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="panel-soft flex flex-col items-center rounded-[28px] py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-3xl border border-white/10 bg-white/[0.04]">
        <Radio className="h-7 w-7 text-slate-500" />
      </div>
      <p className="mt-4 text-base font-semibold text-white">尚未登錄任何 MQTT 設備</p>
      <p className="mt-2 max-w-sm text-sm text-slate-500">
        新增設備後，感測器透過 MQTT Broker 發佈資料即會自動出現在這裡。
      </p>
      <p className="mt-3 text-xs text-slate-600">
        Topic 格式：<code className="rounded bg-white/[0.06] px-1.5 py-0.5 text-slate-400">xcloud/&#123;device_id&#125;/&#123;sensor_type&#125;</code>
      </p>
      <button onClick={onAdd} className="primary-button mt-6">
        <Plus className="h-4 w-4" />
        新增第一台設備
      </button>
    </div>
  );
}

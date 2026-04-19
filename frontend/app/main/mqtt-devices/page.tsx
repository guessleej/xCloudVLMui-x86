"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Edit2,
  Gauge,
  Info,
  Loader2,
  MapPin,
  Plus,
  Radio,
  RefreshCw,
  Save,
  SlidersHorizontal,
  Thermometer,
  Trash2,
  TrendingUp,
  Wifi,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import toast from "react-hot-toast";
import { mqttApi, mqttDeviceApi } from "@/lib/api";
import type {
  MqttChartPoint,
  MqttDevice,
  MqttDeviceDetail,
  MqttThreshold,
} from "@/types";

// ── Constants ─────────────────────────────────────────────────────────
const DEVICE_TYPES = [
  "sensor", "compressor", "motor", "pump",
  "conveyor", "cooler", "panel", "plc", "other",
];

const SENSOR_TYPES = [
  "temperature", "vibration", "pressure", "rpm",
  "humidity", "voltage", "current", "power", "flow", "level",
];

const SENSOR_META: Record<string, { label: string; icon: React.ElementType; color: string; gradientId: string; stroke: string }> = {
  temperature: { label: "溫度",  icon: Thermometer, color: "text-orange-300", gradientId: "grad-temp",  stroke: "#fb923c" },
  vibration:   { label: "振動",  icon: Activity,    color: "text-purple-300", gradientId: "grad-vib",   stroke: "#c084fc" },
  pressure:    { label: "壓力",  icon: Gauge,        color: "text-blue-300",  gradientId: "grad-pres",  stroke: "#60a5fa" },
  rpm:         { label: "轉速",  icon: RefreshCw,   color: "text-cyan-300",  gradientId: "grad-rpm",   stroke: "#22d3ee" },
  humidity:    { label: "濕度",  icon: Activity,    color: "text-teal-300",  gradientId: "grad-hum",   stroke: "#2dd4bf" },
  voltage:     { label: "電壓",  icon: Zap,         color: "text-yellow-300",gradientId: "grad-volt",  stroke: "#facc15" },
  current:     { label: "電流",  icon: Zap,         color: "text-amber-300", gradientId: "grad-cur",   stroke: "#fbbf24" },
  power:       { label: "功率",  icon: Zap,         color: "text-red-300",   gradientId: "grad-pow",   stroke: "#f87171" },
  flow:        { label: "流量",  icon: Activity,    color: "text-sky-300",   gradientId: "grad-flow",  stroke: "#38bdf8" },
  level:       { label: "液位",  icon: Activity,    color: "text-indigo-300",gradientId: "grad-level", stroke: "#818cf8" },
};

function getSensorMeta(type: string) {
  return SENSOR_META[type] ?? { label: type, icon: Radio, color: "text-slate-300", gradientId: "grad-default", stroke: "#94a3b8" };
}

function relativeTime(isoStr?: string | null): string {
  if (!isoStr) return "—";
  const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (diff < 60)   return `${diff}s 前`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m 前`;
  if (diff < 86400)return `${Math.floor(diff / 3600)}h 前`;
  return `${Math.floor(diff / 86400)}d 前`;
}

// ── Main Page ─────────────────────────────────────────────────────────
export default function MqttDevicesPage() {
  const [devices, setDevices]         = useState<MqttDevice[]>([]);
  const [selected, setSelected]       = useState<MqttDeviceDetail | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Add device
  const [showAdd, setShowAdd]     = useState(false);
  const [addForm, setAddForm]     = useState({ device_id: "", name: "", device_type: "sensor", location: "", topic_prefix: "", description: "" });
  const [addLoading, setAddLoading] = useState(false);

  // Edit device
  const [showEdit, setShowEdit]       = useState(false);
  const [editForm, setEditForm]       = useState({ name: "", device_type: "sensor", location: "", topic_prefix: "", description: "" });
  const [editLoading, setEditLoading] = useState(false);

  // Chart
  const [chartSensor, setChartSensor] = useState<string>("");
  const [chartData, setChartData]     = useState<MqttChartPoint[]>([]);
  const [loadingChart, setLoadingChart] = useState(false);

  // Threshold
  const [showAddThreshold, setShowAddThreshold] = useState(false);
  const [threshForm, setThreshForm] = useState({ sensor_type: "", min_value: "", max_value: "", warn_min: "", warn_max: "", unit: "", enabled: true });
  const [threshLoading, setThreshLoading] = useState(false);

  // ── Data fetching ────────────────────────────────────────────────────
  const fetchDevices = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await mqttApi.listDevices();
      setDevices(res.data);
    } catch {
      toast.error("設備清單載入失敗");
    } finally {
      setLoadingList(false);
    }
  }, []);

  const fetchChart = useCallback(async (deviceId: string, sensorType: string) => {
    setLoadingChart(true);
    try {
      const res = await mqttDeviceApi.getChart(deviceId, sensorType, 80);
      setChartData(res.data);
    } catch {
      setChartData([]);
    } finally {
      setLoadingChart(false);
    }
  }, []);

  const fetchDetail = useCallback(async (deviceId: string) => {
    setLoadingDetail(true);
    try {
      const res = await mqttDeviceApi.getDetail(deviceId);
      setSelected(res.data);
      if (res.data.sensor_types?.length > 0) {
        const first = res.data.sensor_types[0];
        setChartSensor(first);
        fetchChart(deviceId, first);
      } else {
        setChartData([]);
        setChartSensor("");
      }
    } catch {
      toast.error("設備詳情載入失敗");
    } finally {
      setLoadingDetail(false);
    }
  }, [fetchChart]);

  useEffect(() => { fetchDevices(); }, [fetchDevices]);

  // ── Handlers ──────────────────────────────────────────────────────
  const handleSelectDevice = (device: MqttDevice) => {
    fetchDetail(device.device_id);
  };

  const handleAddDevice = async () => {
    if (!addForm.device_id || !addForm.name || !addForm.topic_prefix) {
      toast.error("請填寫設備 ID、名稱與 Topic 前綴");
      return;
    }
    setAddLoading(true);
    try {
      await mqttApi.createDevice(addForm);
      toast.success(`設備「${addForm.name}」已新增`);
      setShowAdd(false);
      setAddForm({ device_id: "", name: "", device_type: "sensor", location: "", topic_prefix: "", description: "" });
      fetchDevices();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      toast.error(e?.response?.data?.detail ?? "新增失敗");
    } finally {
      setAddLoading(false);
    }
  };

  const handleOpenEdit = () => {
    if (!selected) return;
    setEditForm({
      name:         selected.name,
      device_type:  selected.device_type,
      location:     selected.location ?? "",
      topic_prefix: selected.topic_prefix,
      description:  selected.description ?? "",
    });
    setShowEdit(true);
  };

  const handleEditDevice = async () => {
    if (!selected) return;
    setEditLoading(true);
    try {
      await mqttApi.updateDevice(selected.device_id, editForm);
      toast.success("設備資訊已更新");
      setShowEdit(false);
      fetchDetail(selected.device_id);
      fetchDevices();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      toast.error(e?.response?.data?.detail ?? "更新失敗");
    } finally {
      setEditLoading(false);
    }
  };

  const handleDeleteDevice = async (device: MqttDevice) => {
    if (!confirm(`確定刪除「${device.name}」？所有感測資料將一併移除。`)) return;
    try {
      await mqttApi.deleteDevice(device.device_id);
      toast.success(`已刪除「${device.name}」`);
      if (selected?.device_id === device.device_id) setSelected(null);
      fetchDevices();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      toast.error(e?.response?.data?.detail ?? "刪除失敗");
    }
  };

  const handleChartSensorChange = (sensorType: string) => {
    setChartSensor(sensorType);
    if (selected) fetchChart(selected.device_id, sensorType);
  };

  const handleAddThreshold = async () => {
    if (!selected || !threshForm.sensor_type) {
      toast.error("請選擇感測器類型");
      return;
    }
    setThreshLoading(true);
    try {
      await mqttDeviceApi.createThreshold(selected.device_id, {
        sensor_type: threshForm.sensor_type,
        min_value:   threshForm.min_value   ? Number(threshForm.min_value)  : undefined,
        max_value:   threshForm.max_value   ? Number(threshForm.max_value)  : undefined,
        warn_min:    threshForm.warn_min    ? Number(threshForm.warn_min)   : undefined,
        warn_max:    threshForm.warn_max    ? Number(threshForm.warn_max)   : undefined,
        unit:        threshForm.unit        || undefined,
        enabled:     threshForm.enabled,
      });
      toast.success("閾值設定已儲存");
      setShowAddThreshold(false);
      setThreshForm({ sensor_type: "", min_value: "", max_value: "", warn_min: "", warn_max: "", unit: "", enabled: true });
      fetchDetail(selected.device_id);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      toast.error(e?.response?.data?.detail ?? "閾值設定失敗");
    } finally {
      setThreshLoading(false);
    }
  };

  const handleDeleteThreshold = async (t: MqttThreshold) => {
    if (!selected) return;
    try {
      await mqttDeviceApi.deleteThreshold(selected.device_id, t.id);
      toast.success("閾值已移除");
      fetchDetail(selected.device_id);
    } catch {
      toast.error("刪除失敗");
    }
  };

  // ── Stats ─────────────────────────────────────────────────────────
  const onlineCount  = devices.filter(d => d.online).length;
  const offlineCount = devices.length - onlineCount;

  return (
    <div className="space-y-5">

      {/* ── 頁頭 ─────────────────────────────────────────────── */}
      <section className="panel-grid overflow-hidden rounded-[28px] px-5 py-4 sm:px-6">
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border border-accent-400/30 bg-accent-500/15">
              <SlidersHorizontal className="h-5 w-5 text-accent-300" />
            </div>
            <div>
              <div className="section-kicker">Device Management</div>
              <h1 className="display-title mt-0.5 text-xl sm:text-2xl">感測器設備管理</h1>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={fetchDevices} disabled={loadingList} className="secondary-button">
              <RefreshCw className={`h-4 w-4 ${loadingList ? "animate-spin" : ""}`} />
              刷新
            </button>
            <button onClick={() => setShowAdd(true)} className="primary-button">
              <Plus className="h-4 w-4" />
              新增設備
            </button>
          </div>
        </div>

        {/* 統計列 */}
        <div className="relative z-10 mt-4 grid grid-cols-2 gap-3 border-t border-white/8 pt-4 sm:grid-cols-4">
          <MiniStat label="已登錄設備" value={String(devices.length)} icon={Radio} />
          <MiniStat label="Online" value={String(onlineCount)} icon={Wifi} valueClass="text-emerald-300" />
          <MiniStat label="Offline" value={String(offlineCount)} icon={WifiOff} valueClass={offlineCount > 0 ? "text-red-300" : "text-slate-300"} />
          <MiniStat label="閾值設定" value={String(devices.length > 0 ? "就緒" : "—")} icon={AlertTriangle} />
        </div>
      </section>

      {/* ── Master-Detail 主版面 ─────────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-[380px_1fr]">

        {/* LEFT: 設備清單 */}
        <div className="panel-soft rounded-[28px] p-4">
          <div className="mb-3 flex items-center justify-between px-1">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
              設備清單 <span className="ml-1 normal-case text-slate-600">({devices.length})</span>
            </p>
          </div>

          {loadingList && devices.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
            </div>
          ) : devices.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <Radio className="h-8 w-8 text-slate-600" />
              <p className="mt-3 text-sm text-slate-500">尚未登錄任何設備</p>
              <button onClick={() => setShowAdd(true)} className="primary-button mt-4">
                <Plus className="h-4 w-4" /> 新增第一台
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {devices.map(device => (
                <DeviceRow
                  key={device.id}
                  device={device}
                  isSelected={selected?.device_id === device.device_id}
                  onSelect={() => handleSelectDevice(device)}
                  onDelete={() => handleDeleteDevice(device)}
                />
              ))}
            </div>
          )}
        </div>

        {/* RIGHT: 設備詳情 */}
        <div>
          {loadingDetail ? (
            <div className="panel-soft flex items-center justify-center rounded-[28px] py-32">
              <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
            </div>
          ) : !selected ? (
            <EmptyDetail />
          ) : (
            <DeviceDetailPanel
              detail={selected}
              chartSensor={chartSensor}
              chartData={chartData}
              loadingChart={loadingChart}
              showAddThreshold={showAddThreshold}
              threshForm={threshForm}
              threshLoading={threshLoading}
              onEdit={handleOpenEdit}
              onRefresh={() => fetchDetail(selected.device_id)}
              onChartSensorChange={handleChartSensorChange}
              onShowAddThreshold={() => setShowAddThreshold(true)}
              onHideAddThreshold={() => { setShowAddThreshold(false); setThreshForm({ sensor_type: "", min_value: "", max_value: "", warn_min: "", warn_max: "", unit: "", enabled: true }); }}
              onThreshFormChange={setThreshForm}
              onAddThreshold={handleAddThreshold}
              onDeleteThreshold={handleDeleteThreshold}
            />
          )}
        </div>
      </div>

      {/* ── 新增設備 Modal ──────────────────────────────────── */}
      {showAdd && (
        <Modal title="新增 MQTT 設備" kicker="Register Device" onClose={() => setShowAdd(false)}>
          <DeviceForm
            form={addForm}
            onChange={(k, v) => setAddForm(p => ({ ...p, [k]: v }))}
            showDeviceId
          />
          <div className="mt-6 flex gap-3">
            <button onClick={() => setShowAdd(false)} className="secondary-button flex-1">取消</button>
            <button onClick={handleAddDevice} disabled={addLoading} className="primary-button flex-1">
              {addLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {addLoading ? "新增中..." : "確認新增"}
            </button>
          </div>
        </Modal>
      )}

      {/* ── 編輯設備 Modal ──────────────────────────────────── */}
      {showEdit && selected && (
        <Modal title={`編輯：${selected.name}`} kicker="Edit Device" onClose={() => setShowEdit(false)}>
          <DeviceForm
            form={editForm}
            onChange={(k, v) => setEditForm(p => ({ ...p, [k]: v }))}
            showDeviceId={false}
          />
          <div className="mt-6 flex gap-3">
            <button onClick={() => setShowEdit(false)} className="secondary-button flex-1">取消</button>
            <button onClick={handleEditDevice} disabled={editLoading} className="primary-button flex-1">
              {editLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {editLoading ? "儲存中..." : "儲存變更"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Device Row ─────────────────────────────────────────────────────
function DeviceRow({ device, isSelected, onSelect, onDelete }: {
  device: MqttDevice;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={`group flex cursor-pointer items-center gap-3 rounded-[20px] border px-4 py-3.5 transition-all ${
        isSelected
          ? "border-brand-500/40 bg-brand-500/10"
          : "border-white/8 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.05]"
      }`}
    >
      <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border ${
        device.online ? "border-emerald-400/25 bg-emerald-400/10" : "border-white/10 bg-white/[0.04]"
      }`}>
        <Radio className={`h-4 w-4 ${device.online ? "text-emerald-300" : "text-slate-500"}`} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-white">{device.name}</p>
          <span className={`status-pill flex-shrink-0 ${device.online ? "status-pill-ok" : "status-pill-warn"}`}>
            {device.online ? "Online" : "Offline"}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
          <span className="truncate">{device.device_id}</span>
          {device.location && (
            <>
              <span>·</span>
              <MapPin className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{device.location}</span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          className="ghost-button h-7 w-7 rounded-lg px-0 text-slate-600 hover:text-red-400"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <ChevronRight className="h-4 w-4 text-slate-600" />
      </div>
    </div>
  );
}

// ── Device Detail Panel ───────────────────────────────────────────
function DeviceDetailPanel({
  detail, chartSensor, chartData, loadingChart,
  showAddThreshold, threshForm, threshLoading,
  onEdit, onRefresh, onChartSensorChange,
  onShowAddThreshold, onHideAddThreshold,
  onThreshFormChange, onAddThreshold, onDeleteThreshold,
}: {
  detail: MqttDeviceDetail;
  chartSensor: string;
  chartData: MqttChartPoint[];
  loadingChart: boolean;
  showAddThreshold: boolean;
  threshForm: { sensor_type: string; min_value: string; max_value: string; warn_min: string; warn_max: string; unit: string; enabled: boolean };
  threshLoading: boolean;
  onEdit: () => void;
  onRefresh: () => void;
  onChartSensorChange: (s: string) => void;
  onShowAddThreshold: () => void;
  onHideAddThreshold: () => void;
  onThreshFormChange: React.Dispatch<React.SetStateAction<{ sensor_type: string; min_value: string; max_value: string; warn_min: string; warn_max: string; unit: string; enabled: boolean }>>;
  onAddThreshold: () => void;
  onDeleteThreshold: (t: MqttThreshold) => void;
}) {
  const meta = chartSensor ? getSensorMeta(chartSensor) : null;

  return (
    <div className="space-y-4">
      {/* 設備基本資訊 */}
      <div className="panel-soft rounded-[28px] p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl border ${
              detail.online ? "border-emerald-400/25 bg-emerald-400/10" : "border-white/10 bg-white/[0.05]"
            }`}>
              <Radio className={`h-5 w-5 ${detail.online ? "text-emerald-300" : "text-slate-500"}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-semibold text-white">{detail.name}</h2>
                <span className={`status-pill ${detail.online ? "status-pill-ok" : "status-pill-warn"}`}>
                  {detail.online ? "Online" : "Offline"}
                </span>
              </div>
              <p className="mt-0.5 text-sm text-slate-500">{detail.device_id}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={onRefresh} className="ghost-button h-8 w-8 rounded-xl px-0 text-slate-500">
              <RefreshCw className="h-4 w-4" />
            </button>
            <button onClick={onEdit} className="secondary-button">
              <Edit2 className="h-4 w-4" />
              編輯
            </button>
          </div>
        </div>

        {/* 屬性 Grid */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <InfoTile icon={Info}      label="設備類型" value={detail.device_type} />
          <InfoTile icon={MapPin}    label="安裝位置" value={detail.location ?? "未設定"} />
          <InfoTile icon={TrendingUp} label="累計讀值" value={`${detail.reading_count.toLocaleString()} 筆`} />
          <InfoTile icon={Activity}  label="最後回傳" value={relativeTime(detail.last_seen)} />
        </div>

        {/* Topic + 感測器類型 */}
        <div className="mt-4 space-y-2.5 rounded-[20px] border border-white/8 bg-slate-950/30 p-4">
          <div className="flex items-start gap-2">
            <p className="w-20 flex-shrink-0 text-xs text-slate-500">Topic 前綴</p>
            <code className="rounded-md bg-white/[0.06] px-2 py-0.5 text-xs text-slate-200">{detail.topic_prefix}</code>
          </div>
          {detail.sensor_types.length > 0 && (
            <div className="flex items-start gap-2">
              <p className="w-20 flex-shrink-0 text-xs text-slate-500">感測器</p>
              <div className="flex flex-wrap gap-1.5">
                {detail.sensor_types.map(t => {
                  const m = getSensorMeta(t);
                  const Icon = m.icon;
                  return (
                    <span key={t} className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[11px] text-slate-300">
                      <Icon className={`h-3 w-3 ${m.color}`} />
                      {m.label}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
          {detail.description && (
            <div className="flex items-start gap-2">
              <p className="w-20 flex-shrink-0 text-xs text-slate-500">備註</p>
              <p className="text-xs text-slate-400">{detail.description}</p>
            </div>
          )}
        </div>
      </div>

      {/* 歷史圖表 */}
      <div className="panel-soft rounded-[28px] p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Sensor Trend</p>
            <h3 className="mt-1 text-base font-semibold text-white">歷史讀值趨勢</h3>
          </div>
          {detail.sensor_types.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {detail.sensor_types.map(t => {
                const m = getSensorMeta(t);
                const Icon = m.icon;
                return (
                  <button
                    key={t}
                    onClick={() => onChartSensorChange(t)}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-all ${
                      chartSensor === t
                        ? "border-brand-500/50 bg-brand-500/15 text-brand-200"
                        : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/20"
                    }`}
                  >
                    <Icon className={`h-3 w-3 ${m.color}`} />
                    {m.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-5 h-[240px]">
          {detail.sensor_types.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center rounded-[20px] border border-white/8 bg-slate-950/30">
              <TrendingUp className="h-8 w-8 text-slate-600" />
              <p className="mt-2 text-sm text-slate-500">尚無感測資料</p>
            </div>
          ) : loadingChart ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
            </div>
          ) : chartData.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center rounded-[20px] border border-white/8 bg-slate-950/30">
              <TrendingUp className="h-8 w-8 text-slate-600" />
              <p className="mt-2 text-sm text-slate-500">此感測器尚無歷史資料</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id={meta?.gradientId ?? "grad-default"} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={meta?.stroke ?? "#94a3b8"} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={meta?.stroke ?? "#94a3b8"} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="timestamp" tick={{ fill: "#64748b", fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: "#64748b", fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="rounded-[16px] border border-white/10 bg-slate-950/95 px-3 py-2.5 shadow-panel">
                        <p className="text-[10px] text-slate-500">{label}</p>
                        <p className="mt-1 font-display text-lg font-semibold text-white">
                          {Number(payload[0].value).toFixed(2)}
                          {chartData[0]?.quality && <span className="ml-1 text-xs text-slate-400"></span>}
                        </p>
                      </div>
                    );
                  }}
                />
                {/* 閾值參考線 */}
                {detail.thresholds
                  .filter(t => t.sensor_type === chartSensor && t.enabled)
                  .map(t => [
                    t.warn_max != null && <ReferenceLine key={`wmax-${t.id}`} y={t.warn_max} stroke="#fbbf24" strokeDasharray="4 4" label={{ value: "警告上限", fill: "#fbbf24", fontSize: 10 }} />,
                    t.warn_min != null && <ReferenceLine key={`wmin-${t.id}`} y={t.warn_min} stroke="#fbbf24" strokeDasharray="4 4" label={{ value: "警告下限", fill: "#fbbf24", fontSize: 10 }} />,
                    t.max_value != null && <ReferenceLine key={`max-${t.id}`}  y={t.max_value}  stroke="#f87171" strokeDasharray="4 4" label={{ value: "危急上限", fill: "#f87171", fontSize: 10 }} />,
                    t.min_value != null && <ReferenceLine key={`min-${t.id}`}  y={t.min_value}  stroke="#f87171" strokeDasharray="4 4" label={{ value: "危急下限", fill: "#f87171", fontSize: 10 }} />,
                  ])}
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={meta?.stroke ?? "#94a3b8"}
                  strokeWidth={2.5}
                  fill={`url(#${meta?.gradientId ?? "grad-default"})`}
                  dot={false}
                  activeDot={{ r: 4, fill: "#ff7616", stroke: "#ffffff", strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* 警報閾值設定 */}
      <div className="panel-soft rounded-[28px] p-5">
        <div className="flex items-center justify-between gap-3 border-b border-white/8 pb-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Alert Thresholds</p>
            <h3 className="mt-1 text-base font-semibold text-white">警報閾值設定</h3>
          </div>
          <button onClick={onShowAddThreshold} className="secondary-button">
            <Plus className="h-4 w-4" />
            新增閾值
          </button>
        </div>

        {/* 新增閾值表單 */}
        {showAddThreshold && (
          <div className="mt-4 rounded-[20px] border border-brand-500/20 bg-brand-500/8 p-4">
            <p className="mb-3 text-xs font-semibold text-brand-300">新增警報閾值</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-[11px] text-slate-500">感測器類型 *</label>
                <select value={threshForm.sensor_type as string}
                  onChange={e => onThreshFormChange({ ...threshForm, sensor_type: e.target.value })}
                  className="form-input">
                  <option value="">選擇類型…</option>
                  {SENSOR_TYPES.map(t => <option key={t} value={t}>{getSensorMeta(t).label} ({t})</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-slate-500">單位</label>
                <input value={threshForm.unit as string} onChange={e => onThreshFormChange({ ...threshForm, unit: e.target.value })}
                  className="form-input" placeholder="°C / bar / mm/s" />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-slate-500">啟用</label>
                <select value={(threshForm.enabled as boolean) ? "true" : "false"}
                  onChange={e => onThreshFormChange({ ...threshForm, enabled: e.target.value === "true" })}
                  className="form-input">
                  <option value="true">啟用</option>
                  <option value="false">停用</option>
                </select>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <NumberInput label="危急下限" value={threshForm.min_value as string} onChange={v => onThreshFormChange({ ...threshForm, min_value: v })} color="text-red-400" />
              <NumberInput label="警告下限" value={threshForm.warn_min as string}  onChange={v => onThreshFormChange({ ...threshForm, warn_min: v })}  color="text-amber-400" />
              <NumberInput label="警告上限" value={threshForm.warn_max as string}  onChange={v => onThreshFormChange({ ...threshForm, warn_max: v })}  color="text-amber-400" />
              <NumberInput label="危急上限" value={threshForm.max_value as string} onChange={v => onThreshFormChange({ ...threshForm, max_value: v })} color="text-red-400" />
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={onHideAddThreshold} className="secondary-button flex-1 text-sm">取消</button>
              <button onClick={onAddThreshold} disabled={threshLoading} className="primary-button flex-1 text-sm">
                {threshLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                儲存閾值
              </button>
            </div>
          </div>
        )}

        {/* 閾值列表 */}
        <div className="mt-4 space-y-2.5">
          {detail.thresholds.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <AlertTriangle className="h-6 w-6 text-slate-600" />
              <p className="mt-2 text-sm text-slate-500">尚未設定任何警報閾值</p>
              <p className="mt-1 text-xs text-slate-600">設定後，閾值線將顯示在歷史趨勢圖上</p>
            </div>
          ) : (
            detail.thresholds.map(t => (
              <ThresholdRow key={t.id} threshold={t} onDelete={() => onDeleteThreshold(t)} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ── Threshold Row ─────────────────────────────────────────────────
function ThresholdRow({ threshold: t, onDelete }: { threshold: MqttThreshold; onDelete: () => void }) {
  const meta = getSensorMeta(t.sensor_type);
  const Icon = meta.icon;
  return (
    <div className="flex items-center gap-3 rounded-[18px] border border-white/8 bg-white/[0.02] px-4 py-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]">
        <Icon className={`h-4 w-4 ${meta.color}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-white">{meta.label}</p>
          <span className={`status-pill ${t.enabled ? "status-pill-ok" : "status-pill-warn"}`}>
            {t.enabled ? "啟用" : "停用"}
          </span>
          {t.unit && <span className="table-chip">{t.unit}</span>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
          {t.min_value  != null && <span className="text-red-400">危急下限 {t.min_value}</span>}
          {t.warn_min   != null && <span className="text-amber-400">警告下限 {t.warn_min}</span>}
          {t.warn_max   != null && <span className="text-amber-400">警告上限 {t.warn_max}</span>}
          {t.max_value  != null && <span className="text-red-400">危急上限 {t.max_value}</span>}
        </div>
      </div>
      <button onClick={onDelete} className="ghost-button h-7 w-7 rounded-lg px-0 text-slate-600 hover:text-red-400 flex-shrink-0">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── Helper Components ─────────────────────────────────────────────
function MiniStat({ label, value, icon: Icon, valueClass = "text-white" }: {
  label: string; value: string; icon: React.ElementType; valueClass?: string;
}) {
  return (
    <div className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{label}</p>
        <Icon className="h-4 w-4 text-slate-600" />
      </div>
      <p className={`mt-2 font-display text-2xl font-semibold ${valueClass}`}>{value}</p>
    </div>
  );
}

function InfoTile({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="rounded-[16px] border border-white/8 bg-slate-950/30 p-3">
      <div className="flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-slate-500" />
        <p className="text-[10px] text-slate-500">{label}</p>
      </div>
      <p className="mt-1.5 text-sm font-medium text-white">{value}</p>
    </div>
  );
}

function NumberInput({ label, value, onChange, color }: {
  label: string; value: string; onChange: (v: string) => void; color: string;
}) {
  return (
    <div>
      <label className={`mb-1 block text-[11px] ${color}`}>{label}</label>
      <input type="number" value={value} onChange={e => onChange(e.target.value)}
        className="form-input" placeholder="不設定留空" />
    </div>
  );
}

function EmptyDetail() {
  return (
    <div className="panel-soft flex flex-col items-center justify-center rounded-[28px] py-24 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-3xl border border-white/10 bg-white/[0.04]">
        <SlidersHorizontal className="h-7 w-7 text-slate-500" />
      </div>
      <p className="mt-4 text-base font-semibold text-white">選擇一台設備</p>
      <p className="mt-2 max-w-xs text-sm text-slate-500">
        從左側清單點選設備，查看詳情、歷史趨勢圖與警報閾值設定。
      </p>
    </div>
  );
}

function Modal({ title, kicker, onClose, children }: {
  title: string; kicker: string; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="panel-soft w-full max-w-lg rounded-[32px] p-6">
        <div className="flex items-center justify-between gap-3 border-b border-white/8 pb-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">{kicker}</p>
            <h2 className="mt-1 text-lg font-semibold text-white">{title}</h2>
          </div>
          <button onClick={onClose} className="ghost-button h-8 w-8 rounded-xl px-0 text-slate-500">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

function DeviceForm({ form, onChange, showDeviceId }: {
  form: Record<string, string>; onChange: (key: string, value: string) => void; showDeviceId: boolean;
}) {
  return (
    <div className="space-y-3.5">
      {showDeviceId && (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-400">
            設備 ID <span className="text-slate-600">（唯一識別碼，不可重複）</span>
          </label>
          <input value={form.device_id} onChange={e => onChange("device_id", e.target.value)}
            className="form-input" placeholder="例：compressor_01" />
        </div>
      )}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-slate-400">顯示名稱 *</label>
        <input value={form.name} onChange={e => onChange("name", e.target.value)}
          className="form-input" placeholder="例：壓縮機 #1" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-400">設備類型</label>
          <select value={form.device_type} onChange={e => onChange("device_type", e.target.value)}
            className="form-input">
            {DEVICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-400">安裝位置</label>
          <input value={form.location} onChange={e => onChange("location", e.target.value)}
            className="form-input" placeholder="廠房 A / 區域 1" />
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-slate-400">
          Topic 前綴 * <span className="text-slate-600 font-normal">（如：xcloud/compressor_01）</span>
        </label>
        <input value={form.topic_prefix} onChange={e => onChange("topic_prefix", e.target.value)}
          className="form-input" placeholder="xcloud/compressor_01" />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium text-slate-400">備註說明</label>
        <input value={form.description} onChange={e => onChange("description", e.target.value)}
          className="form-input" placeholder="選填" />
      </div>
    </div>
  );
}

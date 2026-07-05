/**
 * /overlays — Overlay Studio
 * Editor visual completo com preview ao vivo em canvas vertical (9:16) ou horizontal (16:9).
 * Modo demo dispara eventos falsos para você ver o overlay funcionando sem estar em live.
 */
import { useState, useMemo, useCallback } from "react";
import { useAuth } from "@/context/auth-context";
import {
  Monitor, Copy, CheckCircle2, ExternalLink,
  Trophy, Zap, BarChart2, Target, Gamepad2,
  Eye, Info, Star, MessageSquare, Ticket,
  Smartphone, Tv, Play, Pause, RotateCcw, Sparkles,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

type OverlayId =
  | "alerts" | "combo" | "topGifters" | "stats" | "goal"
  | "subscribe" | "chat" | "ticker" | "basic";

interface OverlayDef {
  id: OverlayId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  path: string; // /overlay/alerts, /overlay/combo, etc.
  desc: string;
}

const OVERLAYS: OverlayDef[] = [
  { id: "alerts",     label: "Alertas",       icon: Zap,           color: "from-orange-500 to-red-600",   path: "alerts",      desc: "Gifts, follows, tap-tap, subs animados." },
  { id: "combo",      label: "Combos",        icon: Gamepad2,      color: "from-pink-500 to-purple-600",  path: "combo",       desc: "2x, 3x, LUVA! na tela cheia." },
  { id: "topGifters", label: "Top Gifters",   icon: Trophy,        color: "from-yellow-500 to-amber-600", path: "top-gifters", desc: "Placar dos maiores doadores." },
  { id: "stats",      label: "Stats Bar",     icon: BarChart2,     color: "from-cyan-500 to-blue-600",    path: "stats",       desc: "Viewers, likes, followers, diamonds." },
  { id: "goal",       label: "Meta",          icon: Target,        color: "from-emerald-500 to-teal-600", path: "goal",        desc: "Barra de progresso animada." },
  { id: "subscribe",  label: "Membros",       icon: Star,          color: "from-violet-500 to-indigo-600",path: "subscribe",   desc: "Alerta de novos membros / subs." },
  { id: "chat",       label: "Chat Wall",     icon: MessageSquare, color: "from-blue-500 to-cyan-600",    path: "chat",        desc: "Feed limpo só com chat." },
  { id: "ticker",     label: "Gift Ticker",   icon: Ticket,        color: "from-amber-500 to-orange-600", path: "ticker",      desc: "Faixa rolante de gifts." },
  { id: "basic",      label: "Chat+Eventos",  icon: Monitor,       color: "from-violet-500 to-fuchsia-600", path: "",         desc: "Overlay clássico completo." },
];

// Per-overlay setting state shape
type Settings = Record<string, string | number | boolean>;

const DEFAULT_SETTINGS: Record<OverlayId, Settings> = {
  alerts:     { gifts: true, follows: true, likes: false, subs: true, joins: false, pos: "top-center", min: 0 },
  combo:      { min: 2, tap: 30 },
  topGifters: { max: 5, diamonds: true, compact: false, title: "Top Gifters" },
  stats:      { layout: "horizontal", viewers: true, likes: true, followers: true, diamonds: true, badge: true },
  goal:       { goal: 1000, mode: "diamonds", label: "", color: "#06b6d4" },
  subscribe:  { pos: "top-right" },
  chat:       { max: 8, pos: "bottom-left", bg: 50, size: "md" },
  ticker:     { pos: "bottom", min: 0, speed: 40 },
  basic:      { chat: true, gifts: true, follows: true, stats: true, bg: 0, size: "md" },
};

function buildQueryString(settings: Settings, defaults: Settings, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(settings)) {
    if (v === defaults[k]) continue;
    if (typeof v === "boolean") p.set(k, v ? "1" : "0");
    else p.set(k, String(v));
  }
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  const qs = p.toString();
  return qs ? `?${qs}` : "";
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  return (
    <Button
      variant="outline" size="sm"
      className="gap-1.5 shrink-0"
      onClick={() => {
        void navigator.clipboard.writeText(value);
        setCopied(true);
        toast({ title: "Copiado!", description: "URL copiada." });
        setTimeout(() => setCopied(false), 2000);
      }}
      data-testid="copy-url-btn"
    >
      {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? "Copiado!" : "Copiar URL"}
    </Button>
  );
}

// ─────────────────────────────────────────────────────────────────
// Setting Controls (per overlay)
// ─────────────────────────────────────────────────────────────────

function SettingLabel({ children }: { children: React.ReactNode }) {
  return <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</Label>;
}

function ToggleField({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/40 border border-border">
      <Label className="text-sm cursor-pointer">{label}</Label>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );
}

function SliderField({ label, unit, value, onChange, min = 0, max = 100, step = 1 }: {
  label: string; unit?: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between">
        <Label className="text-sm">{label}</Label>
        <span className="text-xs font-mono text-primary">{value}{unit ?? ""}</span>
      </div>
      <Slider value={[value]} onValueChange={([v]) => onChange(v)} min={min} max={max} step={step} />
    </div>
  );
}

function OverlaySettings({ id, settings, update }: {
  id: OverlayId;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
}) {
  const posOptions = ["top-center", "top-left", "top-right", "bottom-left", "bottom-right", "bottom-center"];

  if (id === "alerts") {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <SettingLabel>Eventos</SettingLabel>
          <div className="space-y-2">
            <ToggleField label="🎁 Gifts" value={settings.gifts as boolean} onChange={(v) => update({ gifts: v })} />
            <ToggleField label="💙 Follows / Shares" value={settings.follows as boolean} onChange={(v) => update({ follows: v })} />
            <ToggleField label="❤️ Tap Tap (likes burst)" value={settings.likes as boolean} onChange={(v) => update({ likes: v })} />
            <ToggleField label="⭐ Membros / Subscribe" value={settings.subs as boolean} onChange={(v) => update({ subs: v })} />
            <ToggleField label="👋 Entradas na live" value={settings.joins as boolean} onChange={(v) => update({ joins: v })} />
          </div>
        </div>
        <div className="space-y-2">
          <SettingLabel>Posição</SettingLabel>
          <Select value={settings.pos as string} onValueChange={(v) => update({ pos: v })}>
            <SelectTrigger data-testid="alerts-pos-select"><SelectValue /></SelectTrigger>
            <SelectContent>
              {posOptions.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <SliderField label="Mínimo de diamonds" unit="💎" value={settings.min as number} onChange={(v) => update({ min: v })} min={0} max={500} step={10} />
      </div>
    );
  }

  if (id === "combo") {
    return (
      <div className="space-y-4">
        <SliderField label="Mínimo de combos" unit="x" value={settings.min as number} onChange={(v) => update({ min: v })} min={2} max={20} />
        <SliderField label="Likes p/ Tap-Tap" value={settings.tap as number} onChange={(v) => update({ tap: v })} min={5} max={100} step={5} />
        <div className="rounded-lg bg-muted/30 border border-border p-3 text-xs text-muted-foreground space-y-1">
          <p className="font-semibold text-foreground">Gifts com animação especial:</p>
          <p>🥊 Luva · 🦁 Lion · 🌌 Galaxy · 🪐 Universe · 🏰 Castle · 🌹 Rose · 🎭 Drama · 🎵 TikTok</p>
        </div>
      </div>
    );
  }

  if (id === "topGifters") {
    return (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-sm">Título</Label>
          <Input value={settings.title as string} onChange={(e) => update({ title: e.target.value })} placeholder="Top Gifters" />
        </div>
        <SliderField label="Nº de entradas" unit="" value={settings.max as number} onChange={(v) => update({ max: v })} min={3} max={10} />
        <ToggleField label="💎 Mostrar diamonds" value={settings.diamonds as boolean} onChange={(v) => update({ diamonds: v })} />
        <ToggleField label="📦 Modo compacto" value={settings.compact as boolean} onChange={(v) => update({ compact: v })} />
      </div>
    );
  }

  if (id === "stats") {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <SettingLabel>Layout</SettingLabel>
          <Select value={settings.layout as string} onValueChange={(v) => update({ layout: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="horizontal">Horizontal</SelectItem>
              <SelectItem value="vertical">Vertical</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <SettingLabel>Métricas</SettingLabel>
          <ToggleField label="👁 Viewers" value={settings.viewers as boolean} onChange={(v) => update({ viewers: v })} />
          <ToggleField label="❤️ Likes" value={settings.likes as boolean} onChange={(v) => update({ likes: v })} />
          <ToggleField label="👤 Seguidores" value={settings.followers as boolean} onChange={(v) => update({ followers: v })} />
          <ToggleField label="💎 Diamonds" value={settings.diamonds as boolean} onChange={(v) => update({ diamonds: v })} />
          <ToggleField label="🔴 Badge LIVE" value={settings.badge as boolean} onChange={(v) => update({ badge: v })} />
        </div>
      </div>
    );
  }

  if (id === "goal") {
    return (
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-sm">Tipo de meta</Label>
          <Select value={settings.mode as string} onValueChange={(v) => update({ mode: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="diamonds">💎 Diamonds</SelectItem>
              <SelectItem value="viewers">👁 Viewers</SelectItem>
              <SelectItem value="likes">❤️ Likes</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm">Valor</Label>
          <Input type="number" min={1} value={settings.goal as number} onChange={(e) => update({ goal: Number(e.target.value) })} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm">Label (opcional)</Label>
          <Input value={settings.label as string} onChange={(e) => update({ label: e.target.value })} placeholder="ex: Meta de Gifts" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm">Cor</Label>
          <div className="flex items-center gap-2">
            <input type="color" value={settings.color as string} onChange={(e) => update({ color: e.target.value })}
              className="w-10 h-10 rounded-lg cursor-pointer border-0 bg-transparent" />
            <code className="text-xs font-mono text-muted-foreground">{settings.color as string}</code>
          </div>
        </div>
      </div>
    );
  }

  if (id === "subscribe") {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <SettingLabel>Posição</SettingLabel>
          <Select value={settings.pos as string} onValueChange={(v) => update({ pos: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {posOptions.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="rounded-lg bg-muted/30 border border-border p-3 text-xs text-muted-foreground space-y-1.5">
          <p className="font-semibold text-foreground">Variações automáticas:</p>
          <p>🎉 Novo (1º mês) · ⭐ Veterano (3+m) · 💎 Fiel (12+m)</p>
        </div>
      </div>
    );
  }

  if (id === "chat") {
    return (
      <div className="space-y-4">
        <SliderField label="Máximo mensagens" value={settings.max as number} onChange={(v) => update({ max: v })} min={3} max={20} />
        <div className="space-y-2">
          <SettingLabel>Posição</SettingLabel>
          <Select value={settings.pos as string} onValueChange={(v) => update({ pos: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {posOptions.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <SliderField label="Opacidade do fundo" unit="%" value={settings.bg as number} onChange={(v) => update({ bg: v })} min={0} max={90} step={5} />
        <div className="space-y-2">
          <SettingLabel>Tamanho do texto</SettingLabel>
          <Select value={settings.size as string} onValueChange={(v) => update({ size: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="sm">Pequeno</SelectItem>
              <SelectItem value="md">Médio</SelectItem>
              <SelectItem value="lg">Grande</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }

  if (id === "ticker") {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <SettingLabel>Posição</SettingLabel>
          <Select value={settings.pos as string} onValueChange={(v) => update({ pos: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="bottom">Inferior</SelectItem>
              <SelectItem value="top">Superior</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <SliderField label="Mínimo diamonds" unit="💎" value={settings.min as number} onChange={(v) => update({ min: v })} min={0} max={500} step={10} />
        <SliderField label="Velocidade" unit=" px/s" value={settings.speed as number} onChange={(v) => update({ speed: v })} min={10} max={120} step={10} />
      </div>
    );
  }

  // basic
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <SettingLabel>Conteúdo</SettingLabel>
        <ToggleField label="💬 Chat" value={settings.chat as boolean} onChange={(v) => update({ chat: v })} />
        <ToggleField label="🎁 Gifts" value={settings.gifts as boolean} onChange={(v) => update({ gifts: v })} />
        <ToggleField label="💙 Follows / Shares" value={settings.follows as boolean} onChange={(v) => update({ follows: v })} />
        <ToggleField label="👁 Barra de stats" value={settings.stats as boolean} onChange={(v) => update({ stats: v })} />
      </div>
      <SliderField label="Opacidade fundo" unit="%" value={settings.bg as number} onChange={(v) => update({ bg: v })} min={0} max={80} step={5} />
      <div className="space-y-2">
        <SettingLabel>Tamanho texto</SettingLabel>
        <Select value={settings.size as string} onValueChange={(v) => update({ size: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="sm">Pequeno</SelectItem>
            <SelectItem value="md">Médio</SelectItem>
            <SelectItem value="lg">Grande</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Main Studio Page
// ─────────────────────────────────────────────────────────────────

export default function Overlays() {
  const { user } = useAuth();
  const defaultUser = user?.tiktokUsername ?? "";

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const [inputUser, setInputUser] = useState(defaultUser);
  const [username, setUsername] = useState(defaultUser);

  const [activeId, setActiveId] = useState<OverlayId>("alerts");
  const [allSettings, setAllSettings] = useState<Record<OverlayId, Settings>>(() =>
    JSON.parse(JSON.stringify(DEFAULT_SETTINGS))
  );

  const [orientation, setOrientation] = useState<"vertical" | "horizontal">("vertical");
  const [demoOn, setDemoOn] = useState(true);
  const [iframeKey, setIframeKey] = useState(0);

  const activeDef = OVERLAYS.find((o) => o.id === activeId)!;

  const applyUsername = useCallback(() => {
    setUsername(inputUser.trim().replace(/^@/, ""));
  }, [inputUser]);

  const updateSetting = useCallback((patch: Partial<Settings>) => {
    setAllSettings((prev) => ({ ...prev, [activeId]: { ...prev[activeId], ...patch } }));
  }, [activeId]);

  const resetActive = useCallback(() => {
    setAllSettings((prev) => ({ ...prev, [activeId]: { ...DEFAULT_SETTINGS[activeId] } }));
  }, [activeId]);

  const effectiveUsername = username || "SEU_USUARIO";

  const previewUrl = useMemo(() => {
    const settings = allSettings[activeId];
    const defaults = DEFAULT_SETTINGS[activeId];
    const qs = buildQueryString(settings, defaults, demoOn ? { demo: "1" } : {});
    const path = activeDef.path ? `/overlay/${activeDef.path}/${effectiveUsername}` : `/overlay/${effectiveUsername}`;
    return `${origin}${path}${qs}`;
  }, [allSettings, activeId, demoOn, effectiveUsername, activeDef.path, origin]);

  const exportUrl = useMemo(() => {
    const settings = allSettings[activeId];
    const defaults = DEFAULT_SETTINGS[activeId];
    // Export URL is the same as preview but WITHOUT demo flag
    const qs = buildQueryString(settings, defaults);
    const path = activeDef.path ? `/overlay/${activeDef.path}/${effectiveUsername}` : `/overlay/${effectiveUsername}`;
    return `${origin}${path}${qs}`;
  }, [allSettings, activeId, effectiveUsername, activeDef.path, origin]);

  const canvasStyle = orientation === "vertical"
    ? { aspectRatio: "9 / 16", maxHeight: "80vh" }
    : { aspectRatio: "16 / 9", maxHeight: "80vh" };

  return (
    <div className="space-y-6" data-testid="overlay-studio-page">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-white/10 p-6"
        style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.15), rgba(6,182,212,0.08), rgba(236,72,153,0.12))" }}>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(139,92,246,0.20),transparent_60%)] pointer-events-none" />
        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center shrink-0 shadow-lg shadow-violet-500/30">
              <Monitor className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Overlay Studio</h1>
              <p className="text-muted-foreground text-sm mt-1 max-w-xl">
                Preview vertical (TikTok mobile) ou horizontal em tempo real. Ajuste, veja o resultado, copie a URL para OBS/TikTok LIVE Studio.
              </p>
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                {["OBS Studio", "TikTok LIVE Studio", "Streamlabs", "XSplit"].map((s) => (
                  <Badge key={s} variant="outline" className="text-xs border-white/15 text-white/60">{s}</Badge>
                ))}
              </div>
            </div>
          </div>

          {/* Username input */}
          <Card className="min-w-[260px] shrink-0">
            <CardContent className="p-3 space-y-2">
              <Label className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Username TikTok</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">@</span>
                  <Input
                    placeholder="seu_usuario"
                    className="pl-6 h-8 font-mono text-sm"
                    value={inputUser}
                    onChange={(e) => setInputUser(e.target.value.replace(/^@/, ""))}
                    onKeyDown={(e) => e.key === "Enter" && applyUsername()}
                    data-testid="username-input"
                  />
                </div>
                <Button size="sm" onClick={applyUsername} disabled={!inputUser.trim()} className="h-8" data-testid="apply-username-btn">
                  Aplicar
                </Button>
              </div>
              {username && (
                <Badge className="bg-green-500/15 text-green-400 border-green-500/20 text-[10px]">
                  ✓ @{username}
                </Badge>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Overlay tabs */}
      <div className="flex gap-2 flex-wrap">
        {OVERLAYS.map((o) => {
          const Icon = o.icon;
          const isActive = activeId === o.id;
          return (
            <button
              key={o.id}
              onClick={() => setActiveId(o.id)}
              data-testid={`overlay-tab-${o.id}`}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium transition-all border ${
                isActive
                  ? "bg-white/10 border-white/25 text-white shadow-lg"
                  : "bg-transparent border-white/8 text-muted-foreground hover:bg-white/5 hover:text-white"
              }`}
            >
              <span className={`w-6 h-6 rounded-md bg-gradient-to-br ${o.color} flex items-center justify-center shrink-0`}>
                <Icon className="w-3.5 h-3.5 text-white" />
              </span>
              {o.label}
            </button>
          );
        })}
      </div>

      {/* Main grid: controls + canvas */}
      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-5">
        {/* Left: Controls */}
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className={`w-9 h-9 rounded-lg bg-gradient-to-br ${activeDef.color} flex items-center justify-center shrink-0 shadow-lg`}>
                    <activeDef.icon className="w-4.5 h-4.5 text-white" />
                  </div>
                  <div>
                    <p className="font-bold text-sm">{activeDef.label}</p>
                    <p className="text-[11px] text-muted-foreground">{activeDef.desc}</p>
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={resetActive} title="Resetar">
                  <RotateCcw className="w-3.5 h-3.5" />
                </Button>
              </div>

              <div className="border-t border-border pt-4">
                <OverlaySettings id={activeId} settings={allSettings[activeId]} update={updateSetting} />
              </div>
            </CardContent>
          </Card>

          {/* Instructions */}
          <Card className="border-dashed">
            <CardContent className="p-3.5 space-y-2 text-xs">
              <div className="flex items-center gap-1.5 text-primary font-semibold">
                <Info className="w-3.5 h-3.5" />
                Como usar no OBS / TikTok Studio
              </div>
              <ol className="space-y-1 text-muted-foreground list-decimal list-inside pl-1">
                <li>Copie a URL do overlay abaixo</li>
                <li>OBS/TikTok Studio: Sources → (+) → Browser Source</li>
                <li>Cole a URL, defina 1080×1920 (vertical) ou 1920×1080 (horizontal)</li>
                <li>Marque "Shutdown source when not visible"</li>
                <li>Fundo é 100% transparente por padrão</li>
              </ol>
            </CardContent>
          </Card>
        </div>

        {/* Right: Canvas + toolbar */}
        <div className="space-y-3">
          {/* Toolbar */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 rounded-lg border border-white/10 p-1 bg-card">
              <button
                onClick={() => setOrientation("vertical")}
                data-testid="orientation-vertical-btn"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  orientation === "vertical" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-white"
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                Vertical <span className="text-[10px] opacity-60">9:16</span>
              </button>
              <button
                onClick={() => setOrientation("horizontal")}
                data-testid="orientation-horizontal-btn"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  orientation === "horizontal" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-white"
                }`}
              >
                <Tv className="w-3.5 h-3.5" />
                Horizontal <span className="text-[10px] opacity-60">16:9</span>
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setDemoOn((v) => !v)}
                data-testid="demo-toggle-btn"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                  demoOn
                    ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                    : "bg-transparent text-muted-foreground border-white/10 hover:text-white"
                }`}
              >
                {demoOn ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                Demo {demoOn ? "ON" : "OFF"}
                {demoOn && <Sparkles className="w-3 h-3" />}
              </button>
              <Button variant="outline" size="sm" onClick={() => setIframeKey((k) => k + 1)} className="gap-1.5 h-8" data-testid="reload-preview-btn">
                <RotateCcw className="w-3.5 h-3.5" />
                Recarregar
              </Button>
            </div>
          </div>

          {/* Canvas */}
          <div className="rounded-2xl overflow-hidden border border-white/10 shadow-2xl relative"
            style={{
              background:
                "repeating-conic-gradient(#1f1f24 0% 25%, #17171b 0% 50%) 50% / 24px 24px",
              padding: "20px",
            }}
            data-testid="canvas-container"
          >
            <div className="mx-auto rounded-xl overflow-hidden shadow-lg relative bg-black" style={canvasStyle} data-testid="preview-canvas">
              {/* Simulated live background — subtle gradient */}
              <div className="absolute inset-0" style={{
                background: "linear-gradient(180deg, rgba(139,92,246,0.10), rgba(0,0,0,0) 50%, rgba(236,72,153,0.10))",
              }} />
              <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-black/60 text-white text-[10px] backdrop-blur-sm border border-white/10 z-0">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                LIVE PREVIEW
              </div>
              <iframe
                key={`${previewUrl}-${iframeKey}`}
                src={previewUrl}
                title="Overlay preview"
                className="absolute inset-0 w-full h-full border-0 z-10"
                style={{ background: "transparent" }}
                data-testid="preview-iframe"
              />
            </div>
          </div>

          {/* URL box */}
          <Card>
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                URL para OBS / TikTok Studio
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs font-mono text-primary/80 break-all leading-relaxed px-3 py-2 rounded-lg bg-muted/40 border border-border" data-testid="export-url-box">
                  {exportUrl}
                </code>
                <div className="flex flex-col gap-1.5">
                  <CopyButton value={exportUrl} />
                  <Button variant="ghost" size="sm" asChild className="gap-1.5 px-2" data-testid="open-preview-btn">
                    <a href={exportUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-3.5 h-3.5" />
                      Abrir
                    </a>
                  </Button>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                A URL não inclui <code className="text-primary/70">?demo=1</code> — é a URL real que envia dados da @{effectiveUsername} para o overlay.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

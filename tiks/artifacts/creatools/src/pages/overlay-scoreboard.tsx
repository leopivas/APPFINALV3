/**
 * Public scoreboard overlay page — read-only WebSocket connection.
 * Loaded in OBS as browser source. Uses the same JWT flow but only READS events.
 * Layout adapts to `?layout=vertical|horizontal` and `?theme=neon|gold|dark|minimal`.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useSearch } from "wouter";

interface Score { uniqueId: string; nickname: string; points: number; diamonds: number; }

const THEMES: Record<string, { bg: string; card: string; text: string; accent: string; }> = {
  neon:    { bg: "linear-gradient(135deg,#0f0524,#1a0538)", card: "rgba(124,58,237,0.15)", text: "#fff",       accent: "#a78bfa" },
  gold:    { bg: "linear-gradient(135deg,#1a0e00,#3a2400)", card: "rgba(245,158,11,0.18)", text: "#fef3c7",    accent: "#fbbf24" },
  dark:    { bg: "#0a0a0a",                                  card: "rgba(255,255,255,0.05)", text: "#f5f5f5",  accent: "#22d3ee" },
  minimal: { bg: "transparent",                              card: "rgba(0,0,0,0.6)",       text: "#fff",      accent: "#ec4899" },
};

const MEDAL = ["🥇","🥈","🥉"];

export default function OverlayScoreboard() {
  const params = useParams<{ username: string }>();
  const search = useSearch();
  const q = new URLSearchParams(search);
  const layout = (q.get("layout") ?? "vertical") as "vertical" | "horizontal";
  const themeKey = (q.get("theme") ?? "neon") as keyof typeof THEMES;
  const theme = THEMES[themeKey] ?? THEMES.neon;
  const topN = Math.max(3, Math.min(20, Number(q.get("top") ?? 10)));
  const title = q.get("title") ?? "🏆 Top Fãs";

  const [scores, setScores] = useState<Map<string, Score>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);

  const bump = useCallback((uid: string, nick: string, dPoints: number, dDiamonds: number) => {
    setScores(prev => {
      const n = new Map(prev);
      const e = n.get(uid) ?? { uniqueId: uid, nickname: nick, points: 0, diamonds: 0 };
      n.set(uid, { ...e, nickname: nick || e.nickname, points: e.points + dPoints, diamonds: e.diamonds + dDiamonds });
      return n;
    });
  }, []);

  useEffect(() => {
    const user = params?.username; if (!user) return;
    (async () => {
      try {
        const jRes = await fetch(`/api/tiktok/jwt?uniqueId=${encodeURIComponent(user)}`);
        if (!jRes.ok) return;
        const { jwtKey } = await jRes.json() as { jwtKey: string };
        const ws = new WebSocket(`wss://api.tik.tools?uniqueId=${encodeURIComponent(user)}&jwtKey=${jwtKey}`);
        wsRef.current = ws;
        ws.onmessage = (ev) => {
          try {
            const d = JSON.parse(ev.data as string) as Record<string, unknown>;
            const uid = String(d.uniqueId ?? d.userId ?? "");
            const nick = String(d.nickname ?? d.displayName ?? uid);
            if (!uid) return;
            const t = d.type as string;
            if (t === "gift") { const dm = Number(d.diamondCount ?? 0) * Number(d.repeatCount ?? 1); bump(uid, nick, dm, dm); }
            else if (t === "like") bump(uid, nick, Number(d.likeCount ?? 1) * 0.1, 0);
            else if (t === "follow" || t === "member") bump(uid, nick, 5, 0);
            else if (t === "share") bump(uid, nick, 3, 0);
            else if (t === "chat") bump(uid, nick, 0.5, 0);
          } catch { /* ignore */ }
        };
      } catch { /* ignore */ }
    })();
    return () => { wsRef.current?.close(); };
  }, [params?.username, bump]);

  const sorted = Array.from(scores.values()).sort((a,b) => b.points - a.points).slice(0, topN);
  const isVertical = layout === "vertical";

  return (
    <div
      data-testid="overlay-scoreboard"
      style={{
        background: theme.bg, color: theme.text, minHeight: "100vh",
        display: "flex", flexDirection: "column", padding: "20px", fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ fontSize: isVertical ? 28 : 34, fontWeight: 900, marginBottom: 12, letterSpacing: -0.5 }}>
        {title}
      </div>

      <div style={{
        display: "flex", flexDirection: isVertical ? "column" : "row", gap: 8,
        flexWrap: isVertical ? "nowrap" : "wrap",
      }}>
        {sorted.length === 0 ? (
          <div style={{ opacity: 0.4, fontSize: 16 }}>Aguardando gifts…</div>
        ) : sorted.map((e, i) => (
          <div key={e.uniqueId}
            style={{
              background: theme.card, border: `1px solid ${theme.accent}30`, borderRadius: 12,
              padding: "10px 14px", display: "flex", alignItems: "center", gap: 12,
              minWidth: isVertical ? "auto" : 220, transition: "all 0.4s",
              transform: i === 0 ? "scale(1.02)" : "scale(1)",
              boxShadow: i === 0 ? `0 0 24px ${theme.accent}40` : "none",
            }}
          >
            <span style={{ fontSize: 22, minWidth: 32, textAlign: "center" }}>
              {i < 3 ? MEDAL[i] : `#${i + 1}`}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {e.nickname}
              </div>
              <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>💎 {e.diamonds.toLocaleString()}</div>
            </div>
            <div style={{
              fontWeight: 900, fontSize: 20, color: theme.accent, fontVariantNumeric: "tabular-nums",
            }}>
              {Math.round(e.points).toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

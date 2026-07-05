/**
 * Overlay Demo Mode
 * Gera eventos falsos para preview/desenvolvimento dos overlays sem estar em live.
 * Todo overlay que aceite `?demo=1` deve chamar `runOverlayDemo(onMessage)`.
 */
import { useEffect } from "react";

const DEMO_NICKS = [
  "AlexS", "MariaC", "JoaoP", "AnaLuiza", "PedroM", "Luiza_XY", "Carlos",
  "BeatrizS", "RafaelG", "SofiaR", "GabrielD", "IsabelaF", "MateusN", "LauraV",
];
const DEMO_GIFTS = [
  { name: "Rose",       diamonds: 1,    weight: 30 },
  { name: "TikTok",     diamonds: 1,    weight: 25 },
  { name: "Finger Heart", diamonds: 5,  weight: 15 },
  { name: "Perfume",    diamonds: 20,   weight: 10 },
  { name: "Sunglasses", diamonds: 199,  weight: 6 },
  { name: "Lion",       diamonds: 29999, weight: 3 },
  { name: "Galaxy",     diamonds: 1000, weight: 5 },
  { name: "Universe",   diamonds: 44999, weight: 2 },
  { name: "Castle",     diamonds: 20000, weight: 2 },
  { name: "Drama Queen", diamonds: 5000, weight: 2 },
];
const DEMO_COMMENTS = [
  "Adorei a live! 🔥", "Manda mais gift gente!", "Boaaa!", "Salve galera",
  "Que top essa live", "Vamos fazer barulho 👏", "Segueeee", "TAP TAP",
  "Mano incrível 🚀", "Melhor streamer 💜", "Bora bater a meta",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickWeighted<T extends { weight: number }>(arr: T[]): T {
  const total = arr.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total;
  for (const item of arr) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return arr[0];
}

function toId(nick: string): string {
  return nick.toLowerCase().replace(/[^a-z0-9]/g, "");
}

interface DemoOptions {
  /** Frequência de eventos aleatórios em ms (default 1200) */
  interval?: number;
  /** Emite mensagens de `chat` (default true) */
  chat?: boolean;
  /** Emite `roomUser` (viewers/likes/followers) periodicamente (default true) */
  roomStats?: boolean;
}

/**
 * Hook — dispara eventos falsos como se fossem mensagens do WebSocket do tik.tools.
 * Ative com `?demo=1` no URL.
 */
export function useOverlayDemo(
  demoOn: boolean,
  onMessage: (data: Record<string, unknown>) => void,
  opts: DemoOptions = {},
): void {
  useEffect(() => {
    if (!demoOn) return;
    const { interval = 1200, chat = true, roomStats = true } = opts;

    let viewers = 240 + Math.floor(Math.random() * 400);
    let likes = 1200 + Math.floor(Math.random() * 2500);
    let followers = 4200 + Math.floor(Math.random() * 4000);

    // Emit initial roomUser
    onMessage({
      type: "roomUser",
      viewerCount: viewers,
      likeCount: likes,
      totalFollowers: followers,
    });

    const statsTimer = roomStats
      ? setInterval(() => {
          viewers = Math.max(50, viewers + Math.floor(Math.random() * 20 - 6));
          likes += Math.floor(Math.random() * 45);
          if (Math.random() > 0.85) followers += 1;
          onMessage({
            type: "roomUser",
            viewerCount: viewers,
            likeCount: likes,
            totalFollowers: followers,
          });
        }, 1800)
      : null;

    const eventTimer = setInterval(() => {
      const roll = Math.random();
      const nick = pick(DEMO_NICKS);
      const uid = toId(nick);

      if (roll < 0.35) {
        // like event
        onMessage({
          type: "like",
          uniqueId: uid,
          nickname: nick,
          likeCount: 1 + Math.floor(Math.random() * 3),
        });
      } else if (roll < 0.68) {
        // gift
        const g = pickWeighted(DEMO_GIFTS);
        const rep = Math.random() < 0.25 ? Math.floor(Math.random() * 15) + 2 : 1;
        const isStreak = rep > 1 && Math.random() < 0.4;
        onMessage({
          type: "gift",
          uniqueId: uid,
          nickname: nick,
          giftName: g.name,
          diamondCount: g.diamonds,
          repeatCount: rep,
          giftType: isStreak ? 1 : 0,
          profilePictureUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${uid}`,
        });
      } else if (roll < 0.82 && chat) {
        // chat
        onMessage({
          type: "chat",
          uniqueId: uid,
          nickname: nick,
          comment: pick(DEMO_COMMENTS),
          isModerator: Math.random() < 0.15,
          isSubscriber: Math.random() < 0.25,
        });
      } else if (roll < 0.9) {
        // follow
        onMessage({
          type: "social",
          event: "follow",
          uniqueId: uid,
          nickname: nick,
        });
      } else if (roll < 0.96) {
        // share
        onMessage({
          type: "social",
          event: "share",
          uniqueId: uid,
          nickname: nick,
        });
      } else {
        // subscribe
        onMessage({
          type: "subscribe",
          uniqueId: uid,
          nickname: nick,
          subMonth: 1 + Math.floor(Math.random() * 14),
          oldSubscribeStatus: Math.random() < 0.5 ? 0 : 1,
        });
      }
    }, interval);

    return () => {
      if (statsTimer) clearInterval(statsTimer);
      clearInterval(eventTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoOn]);
}

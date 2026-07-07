import { Router, type Request, type Response as ExpressResponse } from "express";
import fs from "fs";
import path from "path";
import { requireAuth } from "./auth";
import { getUserByTiktokUsername, updateUser, getUserById } from "../lib/users-store";

const router = Router();

const TIKTOOLS_API = "https://api.tik.tools";
const configFile = path.join(process.cwd(), "data", "config.json");

function getApiKey(): string | undefined {
  const key = process.env.TIKTOOLS_API_KEY;
  if (key) return key;
  try {
    const cfg = JSON.parse(fs.readFileSync(configFile, "utf-8")) as { apiKey?: string };
    return cfg.apiKey || undefined;
  } catch {
    return undefined;
  }
}

export interface SocialLinks {
  instagram?: string;
  youtube?: string;
  whatsapp?: string;
  discord?: string;
  custom?: Array<{ label: string; url: string }>;
}

export interface ProfileSections {
  showStats: boolean;
  showLiveStatus: boolean;
  showTopGifts: boolean;
  showTopGifters: boolean;
  showSocialLinks: boolean;
}

export interface TopGifter {
  username: string;
  displayName: string;
  avatar: string | null;
  diamondCount: number;
}

export interface TopGift {
  giftName: string;
  count: number;
  diamondValue: number;
}

const SECTION_DEFAULTS: ProfileSections = {
  showStats: true,
  showLiveStatus: true,
  showTopGifts: true,
  showTopGifters: true,
  showSocialLinks: true,
};

function parseSocialLinks(raw: string | null | undefined): SocialLinks {
  if (!raw) return {};
  try { return JSON.parse(raw) as SocialLinks; } catch { return {}; }
}

function parseProfileSections(raw: string | null | undefined): ProfileSections {
  if (!raw) return { ...SECTION_DEFAULTS };
  try { return { ...SECTION_DEFAULTS, ...JSON.parse(raw) as Partial<ProfileSections> }; } catch { return { ...SECTION_DEFAULTS }; }
}

function publicProfileData(user: Awaited<ReturnType<typeof getUserById>>) {
  if (!user) return null;
  return {
    publicProfileEnabled: user.publicProfileEnabled ?? false,
    profileBio: user.profileBio ?? null,
    profileBanner: user.profileBanner ?? null,
    socialLinks: parseSocialLinks(user.socialLinks),
    profileSections: parseProfileSections(user.profileSections),
  };
}

async function fetchWithTimeout(url: string, opts?: RequestInit, ms = 5000): Promise<globalThis.Response> {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
}

// GET /profile — current user's public profile settings (auth required)
router.get("/profile", requireAuth, async (req: Request, res: ExpressResponse): Promise<void> => {
  const userId = (req as Request & { userId: string }).userId;
  const user = await getUserById(userId);
  if (!user) { res.status(404).json({ error: "Usuário não encontrado" }); return; }
  res.json(publicProfileData(user));
});

// PATCH /profile — update public profile settings (auth required)
router.patch("/profile", requireAuth, async (req: Request, res: ExpressResponse): Promise<void> => {
  const userId = (req as Request & { userId: string }).userId;
  const { publicProfileEnabled, profileBio, profileBanner, socialLinks, profileSections } = req.body as {
    publicProfileEnabled?: boolean;
    profileBio?: string;
    profileBanner?: string;
    socialLinks?: SocialLinks;
    profileSections?: Partial<ProfileSections>;
  };

  const updates: Record<string, unknown> = {};
  if (typeof publicProfileEnabled === "boolean") updates.publicProfileEnabled = publicProfileEnabled;
  if (typeof profileBio === "string") updates.profileBio = profileBio.trim().slice(0, 300) || null;
  if (typeof profileBanner === "string") updates.profileBanner = profileBanner.trim() || null;
  if (socialLinks !== undefined) updates.socialLinks = JSON.stringify(socialLinks);
  if (profileSections !== undefined) {
    const current = parseProfileSections(undefined);
    updates.profileSections = JSON.stringify({ ...current, ...profileSections });
  }

  const updated = await updateUser(userId, updates);
  if (!updated) { res.status(404).json({ error: "Usuário não encontrado" }); return; }

  res.json(publicProfileData(updated));
});

// GET /profile/public/:username — public, no auth required
router.get("/profile/public/:username", async (req: Request, res: ExpressResponse): Promise<void> => {
  const username = String(req.params.username);

  let user: Awaited<ReturnType<typeof getUserByTiktokUsername>>;
  try { user = await getUserByTiktokUsername(username); } catch { user = null; }

  if (!user || !user.publicProfileEnabled) {
    res.status(404).json({ error: "Perfil não encontrado ou não está público." });
    return;
  }

  const apiKey = getApiKey();
  const sections = parseProfileSections(user.profileSections);

  // Parallel: live_status + top gifters (best-effort)
  let isLive = false;
  let roomId: string | null = null;
  let viewerCount: number | null = null;
  let likeCount: number | null = null;
  const topGifters: TopGifter[] = [];
  const topGifts: TopGift[] = [];

  // ⚠️ tik.tools chamadas AGGRESSIVE-DISABLED to preserve quota.
  // Auto-fetch of live status / top gifters / top gifts REMOVED from public profile page.
  // The user can trigger a refresh via a dedicated endpoint if needed.
  // Keep apiKey/sections referenced to avoid unused-var lint noise.
  void apiKey; void sections;

  res.json({
    username: user.tiktokUsername,
    displayName: user.tiktokDisplayName ?? user.tiktokUsername ?? username,
    avatar: user.tiktokProfilePicture ?? null,
    followerCount: sections.showStats ? (user.tiktokFollowerCount ?? null) : null,
    totalLiveSessions: sections.showStats ? (user.totalLiveSessions ?? 0) : null,
    verified: user.tiktokVerified ?? false,
    bio: user.profileBio ?? null,
    banner: user.profileBanner ?? null,
    socialLinks: sections.showSocialLinks ? parseSocialLinks(user.socialLinks) : {},
    isLive: sections.showLiveStatus ? isLive : false,
    viewerCount: sections.showLiveStatus ? viewerCount : null,
    likeCount: sections.showLiveStatus ? likeCount : null,
    topGifters: sections.showTopGifters ? topGifters : [],
    topGifts: sections.showTopGifts ? topGifts : [],
    profileSections: sections,
  });
});

export default router;

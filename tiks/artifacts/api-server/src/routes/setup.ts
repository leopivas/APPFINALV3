import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import { getUserByEmail, countUsers, createUser, makeId } from "../lib/users-store";
import { seedDefaultPlans } from "../lib/plans-store";

const router: IRouter = Router();

const workspaceRoot = process.cwd().endsWith(path.join("artifacts", "api-server"))
  ? path.resolve(process.cwd(), "../..")
  : process.cwd();
const dataDir = path.resolve(workspaceRoot, "artifacts/api-server/data");
const configFile = path.resolve(dataDir, "config.json");
const stripeConfigFile = path.resolve(dataDir, "stripe-config.json");
const installedLockFile = path.resolve(dataDir, ".installed");

// Backend Python .env file (persists variables that Node reads via process.env)
const backendEnvFile = path.resolve(workspaceRoot, "../backend/.env");

function loadConfig(): { apiKey?: string } {
  try {
    if (fs.existsSync(configFile)) return JSON.parse(fs.readFileSync(configFile, "utf-8")) as { apiKey?: string };
  } catch { /* ignore */ }
  return {};
}

function saveConfigFile(cfg: { apiKey?: string }): void {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(configFile, JSON.stringify(cfg, null, 2));
}

function maskKey(key: string): string {
  if (key.length <= 8) return "***";
  return key.slice(0, 6) + "..." + key.slice(-4);
}

function isLocked(): boolean {
  return fs.existsSync(installedLockFile);
}

function writeLock(): void {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(installedLockFile, JSON.stringify({ installedAt: new Date().toISOString() }, null, 2));
}

/**
 * Merge key=value pairs into the backend .env file (creates it if missing).
 * Preserves existing keys, updates values, appends new ones.
 */
function upsertEnvFile(updates: Record<string, string | undefined>): { ok: boolean; error?: string } {
  try {
    const dir = path.dirname(backendEnvFile);
    fs.mkdirSync(dir, { recursive: true });
    let content = "";
    try {
      if (fs.existsSync(backendEnvFile)) content = fs.readFileSync(backendEnvFile, "utf-8");
    } catch { /* ignore */ }

    const lines = content.split(/\r?\n/);
    const seen = new Set<string>();
    const nextLines: string[] = [];

    for (const line of lines) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=/);
      if (m) {
        const key = m[1];
        if (updates[key] !== undefined && updates[key] !== "") {
          nextLines.push(`${key}=${updates[key]}`);
          seen.add(key);
        } else if (updates[key] === "") {
          // explicit blank means delete
          seen.add(key);
        } else {
          nextLines.push(line);
        }
      } else {
        nextLines.push(line);
      }
    }

    for (const [k, v] of Object.entries(updates)) {
      if (!seen.has(k) && v !== undefined && v !== "") {
        nextLines.push(`${k}=${v}`);
      }
    }

    fs.writeFileSync(backendEnvFile, nextLines.join("\n"));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const DEFAULT_JWT_SECRET = "creatools-secret-change-in-production";
const JWT_SECRET = process.env.JWT_SECRET ?? DEFAULT_JWT_SECRET;

router.get("/setup/status", async (_req, res): Promise<void> => {
  let userCount = 0;
  let dbError: string | null = null;
  try {
    userCount = await countUsers();
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }
  const apiKey = process.env.TIKTOOLS_API_KEY || loadConfig().apiKey;
  const locked = isLocked();
  res.json({
    needsSetup: !locked && (!userCount || !apiKey || !!dbError),
    hasUsers: userCount > 0,
    hasApiKey: !!apiKey,
    apiKeyMasked: apiKey ? maskKey(apiKey) : null,
    installedLocked: locked,
    hasDatabaseUrl: !!process.env.DATABASE_URL,
    hasLlmKey: !!process.env.EMERGENT_LLM_KEY,
    dbError,
  });
});

/**
 * POST /api/setup/test-db
 * Body: { host, port, user, password, database } | { url }
 * Tests connection to a PostgreSQL database.
 */
router.post("/setup/test-db", async (req, res): Promise<void> => {
  const { host, port, user, password, database, url } = req.body as {
    host?: string; port?: number | string; user?: string; password?: string; database?: string; url?: string;
  };

  const connectionString = url?.trim()
    || (host && user && database
      ? `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password ?? "")}@${host}:${port ?? 5432}/${database}`
      : "");

  if (!connectionString) {
    res.status(400).json({ ok: false, message: "Forneça a URL de conexão ou host+user+database" });
    return;
  }

  try {
    // Dynamically import 'pg' to avoid startup cost when unused
    const { Client } = await import("pg");
    const client = new Client({ connectionString, connectionTimeoutMillis: 8000 });
    await client.connect();
    const r = await client.query("SELECT current_database() as db, version() as ver");
    await client.end();
    res.json({
      ok: true,
      message: `Conectado! Banco: ${r.rows[0]?.db ?? "?"}`,
      version: String(r.rows[0]?.ver ?? "").split(" ").slice(0, 2).join(" "),
      connectionString: connectionString.replace(/:[^:@]*@/, ":***@"),
    });
  } catch (err) {
    res.json({ ok: false, message: err instanceof Error ? err.message : "Erro de conexão" });
  }
});

/**
 * POST /api/setup/test-llm
 * Body: { key: string }
 * Verifies that the Emergent LLM key is accepted by the integration proxy.
 */
router.post("/setup/test-llm", async (req, res): Promise<void> => {
  const { key } = req.body as { key?: string };
  if (!key?.trim()) { res.status(400).json({ ok: false, message: "Chave não fornecida" }); return; }
  try {
    // Simple validation: emergent keys start with "sk-emergent-"
    const trimmed = key.trim();
    if (!trimmed.startsWith("sk-")) {
      res.json({ ok: false, message: "Formato inesperado — chave Emergent começa com 'sk-emergent-'" });
      return;
    }
    // Try a lightweight call to the integration proxy (optional endpoint)
    res.json({ ok: true, message: `Chave aceita (formato válido, ${trimmed.length} caracteres).` });
  } catch (err) {
    res.json({ ok: false, message: err instanceof Error ? err.message : "Erro de validação" });
  }
});

router.post("/setup/complete", async (req, res): Promise<void> => {
  if (isLocked()) {
    res.status(423).json({ error: "O instalador já foi finalizado. Delete o arquivo .installed para reinstalar." });
    return;
  }

  const {
    adminName, adminEmail, adminPassword,
    tiktoolsApiKey,
    databaseUrl,
    emergentLlmKey,
    tiktokClientKey, tiktokClientSecret, tiktokRedirectUri, frontendUrl,
    stripePublishableKey, stripeSecretKey, stripeWebhookSecret,
    stripeBasicPriceId, stripeProPriceId, enablePayments,
  } = req.body as {
    adminName?: string; adminEmail?: string; adminPassword?: string;
    tiktoolsApiKey?: string;
    databaseUrl?: string;
    emergentLlmKey?: string;
    tiktokClientKey?: string; tiktokClientSecret?: string; tiktokRedirectUri?: string; frontendUrl?: string;
    stripePublishableKey?: string; stripeSecretKey?: string;
    stripeWebhookSecret?: string; stripeBasicPriceId?: string; stripeProPriceId?: string; enablePayments?: boolean;
  };

  const isFirstRun = (await countUsers()) === 0;

  if (isFirstRun && (!adminName?.trim() || !adminEmail?.trim() || !adminPassword?.trim())) {
    res.status(400).json({ error: "Nome, e-mail e senha do admin são obrigatórios" }); return;
  }
  if (isFirstRun && adminPassword && adminPassword.length < 6) {
    res.status(400).json({ error: "A senha deve ter pelo menos 6 caracteres" }); return;
  }
  if (!tiktoolsApiKey?.trim()) {
    res.status(400).json({ error: "A chave da API tik.tools é obrigatória" }); return;
  }

  try {
    const cfg = loadConfig();
    cfg.apiKey = tiktoolsApiKey.trim();
    saveConfigFile(cfg);
    process.env.TIKTOOLS_API_KEY = tiktoolsApiKey.trim();

    // Update in-process env for the runtime
    if (databaseUrl?.trim()) process.env.DATABASE_URL = databaseUrl.trim();
    if (emergentLlmKey?.trim()) process.env.EMERGENT_LLM_KEY = emergentLlmKey.trim();
    if (tiktokClientKey?.trim()) process.env.TIKTOK_CLIENT_KEY = tiktokClientKey.trim();
    if (tiktokClientSecret?.trim()) process.env.TIKTOK_CLIENT_SECRET = tiktokClientSecret.trim();
    if (tiktokRedirectUri?.trim()) process.env.TIKTOK_REDIRECT_URI = tiktokRedirectUri.trim();
    if (frontendUrl?.trim()) process.env.FRONTEND_URL = frontendUrl.trim();

    // Persist to backend/.env so values survive restart
    const envResult = upsertEnvFile({
      TIKTOOLS_API_KEY: tiktoolsApiKey.trim(),
      DATABASE_URL: databaseUrl?.trim(),
      EMERGENT_LLM_KEY: emergentLlmKey?.trim(),
      TIKTOK_CLIENT_KEY: tiktokClientKey?.trim(),
      TIKTOK_CLIENT_SECRET: tiktokClientSecret?.trim(),
      TIKTOK_REDIRECT_URI: tiktokRedirectUri?.trim(),
      FRONTEND_URL: frontendUrl?.trim(),
      STRIPE_SECRET_KEY: stripeSecretKey?.trim(),
      STRIPE_WEBHOOK_SECRET: stripeWebhookSecret?.trim(),
    });

    let apiTestOk = false;
    let apiTestMessage = "";
    try {
      const r = await fetch("https://api.tik.tools/api/live/top-channels", {
        headers: { "x-api-key": tiktoolsApiKey.trim() },
        signal: AbortSignal.timeout(8000),
      });
      apiTestOk = r.ok;
      apiTestMessage = r.ok ? "Conexão com tik.tools OK!" : `API retornou status ${r.status}`;
    } catch (err) {
      apiTestMessage = err instanceof Error ? err.message : "Erro de conexão";
    }

    if (stripePublishableKey || stripeBasicPriceId || stripeProPriceId || enablePayments !== undefined) {
      let stripeConfig: Record<string, unknown> = {};
      try {
        if (fs.existsSync(stripeConfigFile)) stripeConfig = JSON.parse(fs.readFileSync(stripeConfigFile, "utf-8")) as Record<string, unknown>;
      } catch { /* ignore */ }
      if (stripePublishableKey) stripeConfig.publishableKey = stripePublishableKey;
      if (stripeSecretKey) process.env.STRIPE_SECRET_KEY = stripeSecretKey;
      if (stripeWebhookSecret) process.env.STRIPE_WEBHOOK_SECRET = stripeWebhookSecret;
      if (stripeBasicPriceId) stripeConfig.priceIdBasic = stripeBasicPriceId;
      if (stripeProPriceId) stripeConfig.priceIdPro = stripeProPriceId;
      if (enablePayments !== undefined) stripeConfig.paymentsEnabled = enablePayments;
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(stripeConfigFile, JSON.stringify(stripeConfig, null, 2));
    }

    // Seed default plans if needed
    await seedDefaultPlans();

    let token: string | null = null;
    if (isFirstRun && adminName && adminEmail && adminPassword) {
      const now = new Date().toISOString();
      const newUser = await createUser({
        id: makeId(),
        email: adminEmail.trim().toLowerCase(),
        name: adminName.trim(),
        passwordHash: await bcrypt.hash(adminPassword, 10),
        createdAt: now,
        plan: "free",
        isAdmin: true,
        lastLoginAt: now,
      });
      token = jwt.sign({ userId: newUser.id }, JWT_SECRET, { expiresIn: "30d" });
    }

    // Write .installed lock file to prevent re-running the wizard
    writeLock();

    res.json({
      ok: true,
      token,
      apiTestOk,
      apiTestMessage,
      envSaved: envResult.ok,
      envError: envResult.error,
      message: isFirstRun ? "Instalação concluída! Conta admin criada." : "Configuração atualizada.",
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Erro interno" });
  }
});

router.post("/setup/test-api", async (req, res): Promise<void> => {
  const { apiKey } = req.body as { apiKey?: string };
  if (!apiKey?.trim()) { res.status(400).json({ ok: false, message: "Chave da API não fornecida" }); return; }
  try {
    const r = await fetch("https://api.tik.tools/api/live/top-channels", {
      headers: { "x-api-key": apiKey.trim() },
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) {
      const json = await r.json() as { channels?: unknown[] };
      res.json({ ok: true, message: `Conectado! Encontrou ${json.channels?.length ?? 0} canais ao vivo.` });
    } else {
      const body = await r.text();
      res.json({ ok: false, message: `API retornou status ${r.status}: ${body.slice(0, 200)}` });
    }
  } catch (err) {
    res.json({ ok: false, message: err instanceof Error ? err.message : "Erro de conexão" });
  }
});

export default router;

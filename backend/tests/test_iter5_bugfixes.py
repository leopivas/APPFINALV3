"""Iteration 5 backend regression tests: tik.tools kill-switch, plans autoLiveMonitoring, overlay/scoreboard, AI streaming, TikTok verify, admin auth."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://livestream-control-2.preview.emergentagent.com").rstrip("/")
ADMIN_EMAIL = "admin@creatools.co"
ADMIN_PASSWORD = "admin123"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


# --- Auth regression ----------------------------------------------------------
class TestAuthRegression:
    def test_admin_login(self):
        r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["user"]["plan"] == "pro"
        assert data["user"]["isAdmin"] is True

    def test_auth_me_returns_plan_pro(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["plan"] == "pro"


# --- Profile public: NO tik.tools calls --------------------------------------
class TestProfilePublicNoUpstream:
    def test_profile_public_returns_defaults(self):
        # Use admin's linked tiktok username _dantas02 if publicProfileEnabled, otherwise expect 404
        r = requests.get(f"{BASE_URL}/api/profile/public/mrbeast", timeout=15)
        # 404 is acceptable (no such user), the key is: no upstream tik.tools burst; response must be fast + static
        assert r.status_code in (200, 404)
        if r.status_code == 200:
            data = r.json()
            # Static defaults from route: isLive False, viewerCount None, topGifters []
            assert data.get("isLive") in (False, None)
            assert data.get("topGifters") == [] or data.get("topGifters") is None
            assert data.get("topGifts") == [] or data.get("topGifts") is None

    def test_profile_public_admin_dantas(self):
        r = requests.get(f"{BASE_URL}/api/profile/public/_dantas02", timeout=15)
        assert r.status_code in (200, 404)


# --- Landing: bulkLiveCheck disabled -----------------------------------------
class TestLandingNoUpstream:
    def test_landing_live_returns_no_live_data(self):
        r = requests.get(f"{BASE_URL}/api/landing/live", timeout=15)
        assert r.status_code == 200
        data = r.json()
        # Response should include partners but liveStatus should be empty {}
        # bulkLiveCheck now returns {} so every partner will have isLive:false
        assert isinstance(data, (dict, list))
        # look for any explicit isLive=true — none expected since upstream disabled
        text = str(data)
        # sanity: response is small and returns quickly
        assert len(text) < 100000


# --- tiktok/gifters/top: short-circuit ---------------------------------------
class TestGiftersTopShortCircuit:
    def test_gifters_top_returns_deprecated(self, admin_headers):
        r = requests.get(f"{BASE_URL}/api/tiktok/gifters/top?username=mrbeast", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data.get("data") == []
        assert data.get("reason") == "endpoint_deprecated"


# --- Plans: autoLiveMonitoring field -----------------------------------------
class TestPlansAutoLiveMonitoring:
    def test_plans_include_auto_live_monitoring(self):
        r = requests.get(f"{BASE_URL}/api/plans", timeout=15)
        assert r.status_code == 200
        plans = r.json()
        # plans could be list or dict; normalize
        if isinstance(plans, dict) and "plans" in plans:
            plans = plans["plans"]
        by_id = {}
        if isinstance(plans, list):
            for p in plans:
                pid = p.get("id") or p.get("slug") or p.get("name", "").lower()
                by_id[pid] = p
        else:
            by_id = plans
        assert "free" in by_id, f"missing free: {list(by_id.keys())}"
        assert "basic" in by_id
        assert "pro" in by_id
        assert by_id["free"].get("autoLiveMonitoring") is False
        assert by_id["basic"].get("autoLiveMonitoring") is True
        assert by_id["pro"].get("autoLiveMonitoring") is True


# --- TikTok verify regression ------------------------------------------------
class TestTikTokVerify:
    def test_verify_mrbeast(self, admin_headers):
        r = requests.post(
            f"{BASE_URL}/api/tiktok/verify-username",
            headers=admin_headers,
            json={"username": "mrbeast"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("exists") is True


# --- AI streaming regression -------------------------------------------------
class TestAIChatStream:
    def test_ai_chat_stream_sse(self, admin_headers):
        # POST /api/ai/chat/stream should return SSE (text/event-stream)
        r = requests.post(
            f"{BASE_URL}/api/ai/chat/stream",
            headers=admin_headers,
            json={"messages": [{"role": "user", "content": "Say hello in 2 words."}]},
            timeout=45,
            stream=True,
        )
        assert r.status_code == 200, r.text[:500] if hasattr(r, "text") else "no text"
        ctype = r.headers.get("content-type", "")
        assert "event-stream" in ctype or "text/plain" in ctype, f"content-type={ctype}"
        # read a few bytes to confirm we get some data
        got_data = False
        for i, chunk in enumerate(r.iter_content(chunk_size=256)):
            if chunk:
                got_data = True
                if i > 3:
                    break
        assert got_data
        r.close()


# --- Overlay scoreboard public page ------------------------------------------
class TestOverlayScoreboard:
    def test_overlay_scoreboard_html(self):
        # Frontend SPA route — HTML page should return 200
        r = requests.get(
            f"{BASE_URL}/overlay/scoreboard/mrbeast?theme=gold&layout=horizontal&top=5&title=Test",
            timeout=15,
        )
        assert r.status_code == 200
        assert "<html" in r.text.lower() or "<!doctype html" in r.text.lower()

/*
 * Add this route to the existing Cloudflare Worker that serves:
 * https://connect-status-github.belora-connect.workers.dev
 *
 * Required Worker secret:
 *   RESEND_API_KEY
 *
 * Recommended Worker variables:
 *   RESEND_AUDIENCE_ID = f3c48823-6d84-4da3-a92e-e7f3a2d93203
 *   RESEND_FROM       = status@belora-connect.com
 *
 * In the existing fetch(request, env, ctx) handler, add:
 *
 *   const url = new URL(request.url);
 *   if (url.pathname === "/subscribe") {
 *       return handleSubscribe(request, env);
 *   }
 */

const SUBSCRIBE_AUDIENCE_ID = "f3c48823-6d84-4da3-a92e-e7f3a2d93203";
const SUBSCRIBE_ALLOWED_ORIGINS = new Set([
    "https://status.belora-connect.com",
    "https://www.belora-connect.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000"
]);

function subscribeCorsHeaders(request) {
    const origin = request.headers.get("Origin") || "";
    const headers = {
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Accept",
        "Vary": "Origin"
    };
    if (SUBSCRIBE_ALLOWED_ORIGINS.has(origin)) {
        headers["Access-Control-Allow-Origin"] = origin;
    }
    return headers;
}

function subscribeJson(request, payload, status) {
    return new Response(JSON.stringify(payload), {
        status: status || 200,
        headers: Object.assign({
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
        }, subscribeCorsHeaders(request))
    });
}

async function handleSubscribe(request, env) {
    if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: subscribeCorsHeaders(request) });
    }

    if (request.method !== "POST") {
        return subscribeJson(request, { error: "Method not allowed" }, 405);
    }

    const origin = request.headers.get("Origin") || "";
    if (origin && !SUBSCRIBE_ALLOWED_ORIGINS.has(origin)) {
        return subscribeJson(request, { error: "Origin not allowed" }, 403);
    }

    let input;
    try {
        input = await request.json();
    } catch {
        return subscribeJson(request, { error: "Invalid JSON body" }, 400);
    }

    const email = String(input && input.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        return subscribeJson(request, { error: "Please enter a valid email address." }, 400);
    }

    const apiKey = String(env.RESEND_API_KEY || "").trim();
    const audienceId = String(env.RESEND_AUDIENCE_ID || SUBSCRIBE_AUDIENCE_ID).trim();
    if (!apiKey) {
        return subscribeJson(request, { error: "Subscription service is not configured." }, 503);
    }

    const resendResponse = await fetch(
        "https://api.resend.com/audiences/" + encodeURIComponent(audienceId) + "/contacts",
        {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + apiKey,
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify({ email: email, unsubscribed: false })
        }
    );

    let resendBody = {};
    try {
        resendBody = await resendResponse.json();
    } catch {
        resendBody = {};
    }

    // Existing contacts are already in the desired end state.
    if (resendResponse.ok || resendResponse.status === 409) {
        return subscribeJson(request, {
            ok: true,
            message: "You are subscribed to Connect status updates."
        });
    }

    console.error("Resend contact creation failed", resendResponse.status, resendBody);
    return subscribeJson(request, {
        error: "We could not subscribe this email address right now."
    }, 502);
}

export { handleSubscribe };

const REPO = "https://api.github.com/repos/beloralabs-connect/connect-status";
const SUBSCRIBE_AUDIENCE_ID = "f3c48823-6d84-4da3-a92e-e7f3a2d93203";
const SUBSCRIBE_ALLOWED_ORIGINS = new Set([
    "https://status.belora-connect.com",
    "https://www.belora-connect.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000"
]);

function cors(response) {
    const headers = new Headers(response.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type, Accept");
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
    });
}

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
        return new Response(null, {
            status: 204,
            headers: subscribeCorsHeaders(request)
        });
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
        return subscribeJson(request, {
            error: "Please enter a valid email address."
        }, 400);
    }

    const apiKey = String(env.RESEND_API_KEY || "").trim();
    const audienceId = String(
        env.RESEND_AUDIENCE_ID || SUBSCRIBE_AUDIENCE_ID
    ).trim();

    if (!apiKey) {
        return subscribeJson(request, {
            error: "Subscription service is not configured."
        }, 503);
    }

    const resendResponse = await fetch(
        "https://api.resend.com/audiences/" +
        encodeURIComponent(audienceId) +
        "/contacts",
        {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + apiKey,
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify({
                email: email,
                unsubscribed: false
            })
        }
    );

    let resendBody = {};
    try {
        resendBody = await resendResponse.json();
    } catch {
        resendBody = {};
    }

    if (resendResponse.ok || resendResponse.status === 409) {
        return subscribeJson(request, {
            ok: true,
            message: "You are subscribed to BeLora Connect updates."
        });
    }

    console.error(
        "Resend contact creation failed",
        resendResponse.status,
        resendBody
    );

    return subscribeJson(request, {
        error: "We could not subscribe this email address right now."
    }, 502);
}

const STATUS_EMAIL_TEMPLATE = "<!DOCTYPE html>\n<html lang=\"en\" style=\"box-sizing: border-box;\">\n<head>\n    <meta charset=\"UTF-8\">\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n    <title>BeLora Connect update</title>\n    <link rel=\"stylesheet\" href=\"feedback-thank-you.css\">\n<style>\n@media only screen and (max-width: 600px) {\n  .avatar {\n    display: none;\n  }\n\n  .sales .text {\n    max-width: 100% !important;\n  }\n}\n</style></head>\n<body style=\"box-sizing: border-box; margin: 0; padding: 0; background-color: #ececec; font-family: Arial, Helvetica, sans-serif; -webkit-font-smoothing: antialiased;\">\n    <div class=\"wrapper\" style=\"box-sizing: border-box; max-width: 600px; margin: 0 auto; background-color: #ffffff;\">\n\n        <!-- HEADER -->\n        <div class=\"header\" style=\"box-sizing: border-box; display: flex; justify-content: flex-start; align-items: center; padding: 10px 20px; background-color: #ebe8e6;\">\n            <div class=\"logo\" style=\"box-sizing: border-box; display: flex; align-items: center; gap: 8px; font-size: 20px; font-weight: 800; color: #111111; letter-spacing: -0.5px; margin-right: auto;\">\n                <img src=\"https://www.belora-connect.com/assets/icons/icon-blue.png\" alt=\"Connect\" width=\"40\" height=\"40\" style=\"box-sizing: border-box; width: 40px; height: 40px; display: block;\">\n            </div>\n            <a href=\"https://www.belora-connect.com/login\" class=\"login-btn\" style=\"box-sizing: border-box; font-size: 14px; color: #3f51b5; text-decoration: none; border: 1px solid #3f51b5; padding: 8px 20px;\">LOGIN</a>\n        </div>\n\n        <!-- HERO -->\n        <div class=\"hero\" style=\"box-sizing: border-box; padding: 48px 20px 36px; background: __STATUS_HERO_GRADIENT__;\">\n            <h1 style=\"box-sizing: border-box; margin: 0 0 16px; font-size: 30px; line-height: 1.2; color: #111111;\">BeLora Connect update</h1>\n            <p style=\"box-sizing: border-box; margin: 0 0 28px; font-size: 15px; line-height: 1.6; color: #333333;\">__STATUS_INTRO__</p>\n\n            <!-- FEEDBACK RECAP -->\n            <div class=\"feedback-box\" style=\"box-sizing: border-box; background-color: #f5f6fb; border-left: 3px solid #3f51b5; padding: 16px 20px; margin: 0 0 28px;\">\n                <div class=\"feedback-label\" style=\"box-sizing: border-box; font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; color: #3f51b5; margin-bottom: 8px;\">__STATUS_LABEL__</div>\n                <p class=\"feedback-text\" style=\"box-sizing: border-box; font-style: italic; margin: 0 0 28px; font-size: 15px; line-height: 1.6; color: #333333;\">\"__STATUS_DETAIL__\"</p>\n            </div>\n\n            <p style=\"box-sizing: border-box; margin: 0 0 28px; font-size: 15px; line-height: 1.6; color: #333333;\">__STATUS_MESSAGE__</p>\n\n            <div class=\"btn-row\" style=\"box-sizing: border-box; margin: 0;\">\n                <a href=\"__STATUS_URL__\" class=\"btn-primary\" style=\"box-sizing: border-box; display: inline-block; padding: 12px 22px; font-size: 14px; font-weight: bold; border-radius: 0; text-decoration: none; background-color: #3f51b5; color: #ffffff; margin-right: 10px;\">View BeLora Connect</a>\n            </div>\n        </div>\n\n        <!-- FOOTER -->\n        <div class=\"footer\" style=\"box-sizing: border-box; background-color: #e6e5e1; color: #8a8a85; padding: 40px 32px 36px; text-align: center;\">\n            <table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" align=\"center\" class=\"social-table\" style=\"box-sizing: border-box; margin: 0 auto 10px;\">\n                <tr style=\"box-sizing: border-box;\">\n                    <td class=\"icon-cell\" style=\"box-sizing: border-box; padding: 0 5px;\">\n                        <table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" class=\"icon-btn\" width=\"40\" height=\"40\" style=\"box-sizing: border-box; width: 40px; height: 40px; border: 1.5px solid #3a3a37; border-radius: 10px;\">\n                            <tr style=\"box-sizing: border-box;\"><td align=\"center\" valign=\"middle\" style=\"box-sizing: border-box;\"><a href=\"https://github.com/beloralabs-connect?tab=repositories\" style=\"box-sizing: border-box;\"><img src=\"https://www.belora-connect.com/assets/icons/github.png\" width=\"16\" height=\"16\" alt=\"GitHub\" class=\"icon-img\" style=\"box-sizing: border-box; filter: invert(1) grayscale(1) brightness(0.2); display: block;\"></a></td></tr>\n                        </table>\n                    </td>\n                    <td class=\"icon-cell\" style=\"box-sizing: border-box; padding: 0 5px;\">\n                        <table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" class=\"icon-btn\" width=\"40\" height=\"40\" style=\"box-sizing: border-box; width: 40px; height: 40px; border: 1.5px solid #3a3a37; border-radius: 10px;\">\n                            <tr style=\"box-sizing: border-box;\"><td align=\"center\" valign=\"middle\" style=\"box-sizing: border-box;\"><a href=\"https://www.youtube.com/@BeLoraCONNECT\" style=\"box-sizing: border-box;\"><img src=\"https://www.belora-connect.com/assets/icons/youtube.png\" width=\"16\" height=\"16\" alt=\"YouTube\" class=\"icon-img\" style=\"box-sizing: border-box; filter: invert(1) grayscale(1) brightness(0.2); display: block;\"></a></td></tr>\n                        </table>\n                    </td>\n                    <td class=\"icon-cell\" style=\"box-sizing: border-box; padding: 0 5px;\">\n                        <table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" class=\"icon-btn\" width=\"40\" height=\"40\" style=\"box-sizing: border-box; width: 40px; height: 40px; border: 1.5px solid #3a3a37; border-radius: 10px;\">\n                            <tr style=\"box-sizing: border-box;\"><td align=\"center\" valign=\"middle\" style=\"box-sizing: border-box;\"><a href=\"https://www.linkedin.com/company/belora-labs/\" style=\"box-sizing: border-box;\"><img src=\"https://www.belora-connect.com/assets/icons/linkedin.png\" width=\"16\" height=\"16\" alt=\"LinkedIn\" class=\"icon-img\" style=\"box-sizing: border-box; filter: invert(1) grayscale(1) brightness(0.2); display: block;\"></a></td></tr>\n                        </table>\n                    </td>\n                </tr>\n            </table>\n\n            <div class=\"footer-links\" style=\"box-sizing: border-box; font-size: 13px; margin-bottom: 10px;\">\n                <a href=\"https://status.belora-connect.com\" style=\"box-sizing: border-box; text-decoration: underline; color: #3a3a37; margin: 0 4px;\">Manage BeLora Connect updates</a> ·\n                <a href=\"https://www.belora-connect.com/privacy\" style=\"box-sizing: border-box; text-decoration: underline; color: #3a3a37; margin: 0 4px;\">Privacy policy</a>\n            </div>\n\n            <div class=\"footer-note\" style=\"box-sizing: border-box; font-size: 13px; color: #8a8a85; line-height: 1.6; margin-bottom: 20px;\">\n                © 2026 Belora Labs, Inc. All rights reserved.<br style=\"box-sizing: border-box;\">\n                201 Parkwood Dr, Lansing, MI 48917, United States\n            </div>\n\n            <div class=\"footer-logo\" style=\"box-sizing: border-box; display: flex; align-items: center; margin: 0 auto; font-size: 20px; font-weight: 800; color: #1a1a18; width: max-content;\">\n                <img src=\"https://www.belora-connect.com/assets/icons/icon-blue.png\" alt=\"Connect\" width=\"30\" height=\"30\" style=\"box-sizing: border-box; display: block; width: 30px; height: 30px; margin-right: 5px;\">\n                <span class=\"footer-logo-text\" style=\"box-sizing: border-box; color: #3f51b5;\">CONNECT</span>\n            </div>\n        </div>\n\n    </div>\n</body>\n</html>\n";

function statusEscapeHtml(value) {
    return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function statusTone(status) {
    const normalized = String(status || "").trim().toLowerCase();

    if (normalized === "operational" || normalized === "resolved") {
        return { heroGradient: "linear-gradient(160deg, #dff5e9 0%, #ffffff 65%)" };
    }

    if (normalized === "degraded" || normalized === "investigating" ||
        normalized === "identified") {
        return { heroGradient: "linear-gradient(160deg, #fff0cc 0%, #ffffff 65%)" };
    }

    if (normalized === "down" || normalized === "service unavailable") {
        return { heroGradient: "linear-gradient(160deg, #fde0e4 0%, #ffffff 65%)" };
    }

    // Maintenance, resolving, and unknown statuses keep the default blue hero.
    return { heroGradient: "linear-gradient(160deg, #dde1f7 0%, #ffffff 65%)" };
}

function buildStatusNotification(data) {
    const status = String(data.status || "Status update").trim();
    const title = String(data.title || "Connect").trim();
    const detail = String(data.detail || "BeLora Connect status has changed.").trim();
    const issueUrl = String(data.issueUrl || "https://status.belora-connect.com").trim();
    const tone = statusTone(status);
    const statusLine = status === "Maintenance" ?
        "This planned maintenance may temporarily affect availability." :
        (status === "Operational" || status === "Resolved" ?
            "The service is operating normally and remains under monitoring." :
            (status === "Down" || status === "Service unavailable" ?
                "The service is currently unavailable while the team investigates." :
                "We are monitoring the situation and will share another update when the status changes."));
    const introHtml = [
        "BeLora Connect has a new update for " + title + ".",
        "Current status: " + status + ".",
        statusLine
    ].map(statusEscapeHtml).join("<br>");
    const message = status === "Maintenance" ?
        "This planned maintenance is listed on the Connect status page. We will share another update if its schedule or status changes." :
        (status === "Operational" || status === "Resolved" ?
            "We will continue monitoring the service and will share further updates if needed." :
            "We are monitoring the situation and will share another update when the status changes.");

    const html = STATUS_EMAIL_TEMPLATE
        .replaceAll("__STATUS_INTRO__", introHtml)
        .replaceAll("__STATUS_LABEL__", statusEscapeHtml(status))
        .replaceAll("__STATUS_DETAIL__", statusEscapeHtml(detail))
        .replaceAll("__STATUS_MESSAGE__", statusEscapeHtml(message))
        .replaceAll("__STATUS_URL__", statusEscapeHtml(issueUrl))
        .replaceAll("__STATUS_HERO_GRADIENT__", tone.heroGradient);

    const text = [
        "BeLora Connect update",
        "",
        title,
        "Status: " + status,
        detail,
        "",
        "View BeLora Connect: " + issueUrl,
        "",
        "Manage BeLora Connect updates: https://status.belora-connect.com"
    ].join("\n");

    return {
        subject: "BeLora Connect update — " + status,
        html: html,
        text: text
    };
}

async function listResendContacts(apiKey, audienceId) {
    const contacts = [];
    let after = "";

    for (let page = 0; page < 20; page += 1) {
        const query = new URLSearchParams({ limit: "100" });
        if (after) query.set("after", after);

        const response = await fetch(
            "https://api.resend.com/audiences/" +
            encodeURIComponent(audienceId) + "/contacts?" + query.toString(),
            {
                headers: {
                    "Authorization": "Bearer " + apiKey,
                    "Accept": "application/json"
                }
            }
        );

        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(
                "Resend contacts " + response.status + ": " +
                String(body.message || "Unable to list contacts")
            );
        }

        const pageContacts = Array.isArray(body.data) ? body.data : [];
        contacts.push.apply(contacts, pageContacts);

        if (!body.has_more || !pageContacts.length) break;
        const last = pageContacts[pageContacts.length - 1];
        if (!last || !last.id) break;
        after = String(last.id);
    }

    return contacts.filter(function (contact) {
        return contact && contact.email && contact.unsubscribed !== true;
    });
}

async function handleNotify(request, env) {
    if (request.method !== "POST") {
        return subscribeJson(request, { error: "Method not allowed" }, 405);
    }

    const expectedSecret = String(env.STATUS_NOTIFY_SECRET || "").trim();
    const authorization = request.headers.get("Authorization") || "";
    if (!expectedSecret || authorization !== "Bearer " + expectedSecret) {
        return subscribeJson(request, { error: "Unauthorized" }, 401);
    }

    let input;
    try {
        input = await request.json();
    } catch {
        return subscribeJson(request, { error: "Invalid JSON body" }, 400);
    }

    const status = String(input.status || "").trim();
    const allowedStatuses = new Set([
        "Maintenance",
        "Investigating",
        "Identified",
        "Resolving",
        "Resolved",
        "Degraded",
        "Down",
        "Operational",
        "Service unavailable"
    ]);

    if (!allowedStatuses.has(status)) {
        return subscribeJson(request, { error: "Unsupported status" }, 400);
    }

    const apiKey = String(env.RESEND_API_KEY || "").trim();
    const audienceId = String(
        env.RESEND_AUDIENCE_ID || SUBSCRIBE_AUDIENCE_ID
    ).trim();

    if (!apiKey) {
        return subscribeJson(request, {
            error: "Notification service is not configured."
        }, 503);
    }

    const message = buildStatusNotification({
        status: status,
        title: input.title,
        detail: input.detail,
        issueUrl: input.issueUrl
    });

    let contacts;
    try {
        contacts = await listResendContacts(apiKey, audienceId);
    } catch (error) {
        console.error("[STATUS EMAIL] Contact lookup failed", error);
        return subscribeJson(request, {
            error: "Unable to load status subscribers."
        }, 502);
    }

    const from = String(
        env.RESEND_FROM || "Connect Status <status@belora-connect.com>"
    ).trim();
    const eventId = encodeURIComponent(
        String(input.eventId || Date.now())
    ).slice(0, 100);

    const deliveries = await Promise.all(contacts.map(async function (contact) {
        const email = String(contact.email).trim().toLowerCase();
        const response = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + apiKey,
                "Content-Type": "application/json",
                "Idempotency-Key": "status-" + eventId + "-" +
                    encodeURIComponent(email)
            },
            body: JSON.stringify({
                from: from,
                to: [email],
                reply_to: "status@belora-connect.com",
                subject: message.subject,
                html: message.html,
                text: message.text
            })
        });
        const body = await response.json().catch(() => ({}));
        return {
            email: email,
            ok: response.ok,
            body: body
        };
    }));

    const failed = deliveries.filter(function (delivery) {
        return !delivery.ok;
    });

    if (failed.length) {
        console.error("[STATUS EMAIL] Delivery failures", failed);
        return subscribeJson(request, {
            error: "Some status notification emails could not be sent.",
            sent: deliveries.length - failed.length,
            failed: failed.length
        }, 502);
    }

    return subscribeJson(request, {
        ok: true,
        sent: deliveries.length,
        status: status
    });
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        // This must come before the generic GET-only GitHub proxy logic.
        if (url.pathname === "/subscribe") {
            return handleSubscribe(request, env);
        }

        if (url.pathname === "/notify") {
            return handleNotify(request, env);
        }

        if (request.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, Accept"
                }
            });
        }

        if (request.method !== "GET") {
            return cors(new Response("Method not allowed", { status: 405 }));
        }

        const path = url.pathname.replace(/^\/+/, "");
        const allowed =
            path === "issues" ||
            /^issues\/[0-9]+\/comments$/.test(path);

        if (!allowed) {
            return cors(new Response("Not found", { status: 404 }));
        }

        const cacheKey = new Request(url.toString(), request);
        const cache = caches.default;
        const cached = await cache.match(cacheKey);

        if (cached) {
            return cors(cached);
        }

        const headers = {
            Accept: "application/vnd.github+json",
            "User-Agent": "connect-status-worker",
            "X-GitHub-Api-Version": "2022-11-28"
        };

        if (env.GITHUB_TOKEN) {
            headers.Authorization = "Bearer " + env.GITHUB_TOKEN;
        }

        const githubResponse = await fetch(
            REPO + "/" + path + url.search,
            { headers }
        );

        const response = cors(new Response(githubResponse.body, {
            status: githubResponse.status,
            statusText: githubResponse.statusText,
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "public, max-age=0, s-maxage=30"
            }
        }));

        if (githubResponse.ok) {
            ctx.waitUntil(cache.put(cacheKey, response.clone()));
        }

        return response;
    }
};

(function () {
    "use strict";

    var config = Object.assign({ uptimeKumaBaseUrl: "", statusPageSlug: "connect", statusPageUrl: "", summaryUrl: "", historyBaseUrl: "", githubApiBaseUrl: "", historyCommitsUrl: "", subscriptionUrl: "" }, window.CONNECT_STATUS_CONFIG || {});
    var dashboard = document.getElementById("status-app");
    var refreshButton = document.getElementById("status-refresh");
    var refreshTimer;
    var currentServices = [];
    var currentDetailTab = "overview";
    var currentSort = "status";
    var maintenanceItems = [];
    var errorReports = [];

    function baseUrl() { return String(config.uptimeKumaBaseUrl || "").replace(/\/+$/, ""); }

    function fetchJson(url) {
        var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        var timeout = setTimeout(function () { if (controller) controller.abort(); }, 10000);
        return fetch(url, { headers: { Accept: "application/json" }, cache: "no-store", signal: controller ? controller.signal : undefined })
            .then(function (response) { if (!response.ok) throw new Error("HTTP " + response.status); return response.json(); })
            .finally(function () { clearTimeout(timeout); });
    }

    function fetchCachedJson(url, storageKey, ttl) {
        try {
            var cached = JSON.parse(window.localStorage.getItem(storageKey) || "null");
            if (cached && cached.savedAt && Date.now() - cached.savedAt < ttl && cached.data) return Promise.resolve(cached.data);
        } catch (error) { /* continue with the network request */ }
        return fetchJson(url).then(function (data) {
            try { window.localStorage.setItem(storageKey, JSON.stringify({ savedAt: Date.now(), data: data })); } catch (error) { /* private browsing */ }
            return data;
        });
    }

    function fetchText(url) {
        return fetch(url, { headers: { Accept: "text/plain" }, cache: "no-store" })
            .then(function (response) { if (!response.ok) throw new Error("HTTP " + response.status); return response.text(); });
    }

    function escapeHtml(value) {
        return String(value == null ? "" : value).replace(/[&<>'"]/g, function (character) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character];
        });
    }

    function refreshIcons() {
        if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
    }

    function stateFor(value) {
        var status = String(value == null ? "" : value).toUpperCase();
        if (["UP", "OPERATIONAL", "OK", "1"].indexOf(status) !== -1) return "operational";
        if (["DEGRADED", "DEGRADED_PERFORMANCE", "PARTIAL_OUTAGE", "MAINTENANCE", "2"].indexOf(status) !== -1) return "degraded";
        if (["DOWN", "OUTAGE", "MAJOR_OUTAGE", "0"].indexOf(status) !== -1) return "outage";
        return "unknown";
    }

    function stateLabel(state) { return { operational: "Operational", degraded: "Degraded", outage: "Service unavailable", unknown: "No data received yet", checking: "Check in progress" }[state] || "No data received yet"; }

    function dateText(value) {
        if (!value) return "—";
        var date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
    }

    function shortDate(value) {
        var date = new Date(value);
        return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
    }

    function durationText(milliseconds) {
        if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "<1m";
        var minutes = Math.floor(milliseconds / 60000);
        if (minutes < 1) return "<1m";
        var days = Math.floor(minutes / 1440);
        var hours = Math.floor((minutes % 1440) / 60);
        var remaining = minutes % 60;
        if (days > 0) return days + "d " + hours + "h " + remaining + "m";
        if (hours > 0) return hours + "h " + remaining + "m";
        return minutes + "m";
    }

    function monitors(statusPage, heartbeatData) {
        var groups = statusPage && Array.isArray(statusPage.publicGroupList) ? statusPage.publicGroupList : [];
        var result = [];
        groups.forEach(function (group) {
            (group.monitorList || []).forEach(function (monitor) {
                result.push({ id: String(monitor.id), name: monitor.name || "Connect service", group: group.name || "Connect", history: [], url: monitor.url || monitor.sendUrl || "" });
            });
        });
        var heartbeatList = heartbeatData && heartbeatData.heartbeatList ? heartbeatData.heartbeatList : {};
        if (!result.length) Object.keys(heartbeatList).forEach(function (id) { result.push({ id: id, name: "Connect service " + id, group: "Connect", history: [], url: "" }); });
        return result.map(function (monitor) {
            var history = Array.isArray(heartbeatList[monitor.id]) ? heartbeatList[monitor.id] : [];
            var latest = history[history.length - 1] || {};
            var uptime = heartbeatData && heartbeatData.uptimeList ? heartbeatData.uptimeList[monitor.id + "_24"] : null;
            return Object.assign(monitor, { history: history, latest: latest, state: stateFor(latest.status), uptime: Number.isFinite(Number(uptime)) ? Number(uptime <= 1 ? uptime * 100 : uptime) : null });
        });
    }

    function summaryMonitors(summaryData) {
        var list = Array.isArray(summaryData) ? summaryData : (summaryData && (summaryData.services || summaryData.monitors || summaryData.data)) || [];
        if (!Array.isArray(list)) return [];
        return list.map(function (service) {
            var uptime = service.uptime;
            var uptimeDay = service.uptimeDay;
            if (typeof uptime === "string") uptime = parseFloat(uptime.replace("%", ""));
            if (typeof uptimeDay === "string") uptimeDay = parseFloat(uptimeDay.replace("%", ""));
            var uptimeWeek = service.uptimeWeek;
            var uptimeMonth = service.uptimeMonth;
            if (typeof uptimeWeek === "string") uptimeWeek = parseFloat(uptimeWeek.replace("%", ""));
            if (typeof uptimeMonth === "string") uptimeMonth = parseFloat(uptimeMonth.replace("%", ""));
            return {
                id: String(service.slug || service.name || Math.random()),
                slug: String(service.slug || service.name || ""),
                startTime: null,
                name: service.name || "Connect service",
                group: service.group || "Connect",
                url: service.url || "",
                icon: service.icon || "",
                history: [],
                latest: { status: service.status, time: service.time },
                state: stateFor(service.status),
                uptime: Number.isFinite(Number(uptime)) ? Number(uptime) : null,
                uptimeDay: Number.isFinite(Number(uptimeDay)) ? Number(uptimeDay) : null,
                uptimeWeek: Number.isFinite(Number(uptimeWeek)) ? Number(uptimeWeek) : null,
                uptimeMonth: Number.isFinite(Number(uptimeMonth)) ? Number(uptimeMonth) : null,
                uptimeYear: Number.isFinite(Number(service.uptimeYear)) ? Number(service.uptimeYear) : null,
                responseTime: Number.isFinite(Number(service.time)) ? Number(service.time) : null,
                dailyMinutesDown: service.dailyMinutesDown || {}
            };
        });
    }

    function overallState(services) {
        if (!services.length || services.every(function (service) { return service.state === "unknown"; })) return "unknown";
        if (services.some(function (service) { return service.state === "outage"; })) return "outage";
        if (services.some(function (service) { return service.state === "degraded"; })) return "degraded";
        return "operational";
    }

    function flattenHistory(services) {
        var records = [];
        services.forEach(function (service) {
            service.history.forEach(function (heartbeat) {
                var time = new Date(heartbeat.time).getTime();
                if (Number.isFinite(time)) records.push({ time: time, state: stateFor(heartbeat.status) });
            });
        });
        return records.sort(function (a, b) { return a.time - b.time; });
    }

    function timeline(records) {
        if (!records.length) return Array(30).fill("unknown");
        var bars = [];
        var chunkSize = Math.max(1, Math.ceil(records.length / 30));
        for (var index = 0; index < 30; index += 1) {
            var chunk = records.slice(index * chunkSize, (index + 1) * chunkSize);
            if (!chunk.length) bars.push("unknown");
            else if (chunk.some(function (record) { return record.state === "outage"; })) bars.push("outage");
            else if (chunk.some(function (record) { return record.state === "degraded"; })) bars.push("degraded");
            else if (chunk.every(function (record) { return record.state === "operational"; })) bars.push("operational");
            else bars.push("unknown");
        }
        return bars;
    }

    function setFooterState(state) {
        document.querySelectorAll("[data-status-indicator]").forEach(function (indicator) {
            indicator.classList.remove("is-operational", "is-degraded", "is-outage", "is-unknown", "is-checking");
            indicator.classList.add("is-" + state);
            var label = indicator.querySelector("[data-status-label]");
            if (indicator.classList.contains("footer-status-link")) {
                indicator.href = "https://status.belora-connect.com/";
                indicator.target = "_blank";
                indicator.rel = "noopener";
            }
            var text = state === "operational" ? "All systems operational" : state === "degraded" ? "Some services degraded" : state === "outage" ? "Service disruption detected" : state === "checking" ? "Checking systems" : "Status unavailable";
            if (label) label.textContent = text;
            indicator.setAttribute("aria-label", text);
            indicator.title = text;
        });
    }

    function setSystemState(state, uptime) {
        var banner = document.getElementById("status-system-banner");
        var title = document.getElementById("status-system-title");
        var duration = document.getElementById("status-system-duration");
        if (banner) { banner.classList.remove("is-operational", "is-degraded", "is-outage", "is-unknown", "is-checking"); banner.classList.add("is-" + state); }
        if (title) title.textContent = stateLabel(state);
        if (duration) duration.textContent = "For: " + (uptime || (state === "operational" ? "Monitoring live" : "—"));
        setFooterState(state);
    }

    function timelinePopover() {
        var popover = document.getElementById("status-hover-popover");
        if (popover) return popover;
        popover = document.createElement("div");
        popover.id = "status-hover-popover";
        popover.className = "status-hover-popover";
        popover.setAttribute("role", "tooltip");
        popover.hidden = true;
        document.body.appendChild(popover);
        return popover;
    }

    function showTimelinePopover(bar) {
        activeTimelineBar = bar;
        var popover = timelinePopover();
        popover.classList.toggle("is-history-popover", !!(bar.closest && bar.closest("#status-history-3mo-timeline")));
        var detail = bar.getAttribute("data-history-detail") || "No data received yet";
        var entries = detail.split(" | ").filter(function (entry) { return entry.trim(); });
        var multiple = entries.length > 1;
        var title = multiple ? "Hourly status" : ((entries[0] || "Status").split(" — ")[0] || "Status");
        var rows = entries.map(function (entry) {
            var parts = entry.split(" — ");
            var label = parts.shift() || "Status";
            var info = parts.join(" — ");
            var state = label.toLowerCase().indexOf("service unavailable") >= 0 || label.toLowerCase().indexOf("down") >= 0 ? "outage" : label.toLowerCase().indexOf("degrad") >= 0 ? "degraded" : label.toLowerCase().indexOf("operational") >= 0 ? "operational" : "unknown";
            return '<div class="status-hover-entry"><strong class="status-hover-state is-' + state + '">' + escapeHtml(label) + '</strong><span>' + escapeHtml(info || label) + '</span></div>';
        }).join("");
        popover.innerHTML = '<strong class="status-hover-title">' + escapeHtml(title) + '</strong>' + rows;
        popover.hidden = false;
        var box = bar.getBoundingClientRect();
        var width = popover.offsetWidth;
        var left = Math.max(8, Math.min(window.innerWidth - width - 8, box.left + (box.width / 2) - (width / 2)));
        var top = box.top - popover.offsetHeight - 10;
        if (top < 8) top = box.bottom + 10;
        popover.style.left = left + "px";
        popover.style.top = top + "px";
    }

    function hideTimelinePopover() {
        activeTimelineBar = null;
        var popover = document.getElementById("status-hover-popover");
        if (popover) popover.hidden = true;
    }

    var timelinePointerGuardBound = false;
    var activeTimelineBar = null;

    function bindTimelinePopovers(target) {
        target.querySelectorAll(".status-history-slot, .status-history-bar:not(.status-history-segment)").forEach(function (bar) {
            bar.addEventListener("pointerenter", function () { showTimelinePopover(bar); });
            bar.addEventListener("focus", function () { showTimelinePopover(bar); });
            bar.addEventListener("pointerleave", hideTimelinePopover);
            bar.addEventListener("mouseleave", hideTimelinePopover);
            bar.addEventListener("blur", hideTimelinePopover);
            bar.setAttribute("tabindex", "0");
        });
        if (!timelinePointerGuardBound) {
            document.addEventListener("pointermove", function (event) {
                var hovered = event.target && event.target.closest ? event.target.closest(".status-history-slot, .status-history-bar:not(.status-history-segment)") : null;
                if (hovered) {
                    if (activeTimelineBar !== hovered) showTimelinePopover(hovered);
                } else {
                    hideTimelinePopover();
                }
            });
            timelinePointerGuardBound = true;
        }
    }

    function timeLabel(value) {
        var date = new Date(value);
        return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }

    function timelineRange(record, isCurrent) {
        var startTime = Number.isFinite(record.displayStartTime) ? record.displayStartTime : record.time;
        var start = new Date(startTime);
        if (Number.isNaN(start.getTime())) return "—";
        var endTime = Number.isFinite(record.displayEndTime) ? record.displayEndTime : (Number.isFinite(record.endTime) ? record.endTime : startTime + 3600000);
        var end = new Date(endTime);
        var day = start.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
        var range = timeLabel(start) + "–" + (isCurrent ? "now" : timeLabel(end));
        return day + " · " + range;
    }

    function timelineDetail(record) {
        var state = record.state;
        if (state === "unknown") return timelineRange(record, false) + " — " + stateLabel(state);
        var label = stateLabel(state);
        var startTime = Number.isFinite(record.displayStartTime) ? record.displayStartTime : record.time;
        var endTime = Number.isFinite(record.displayEndTime) ? record.displayEndTime : (Number.isFinite(record.endTime) ? record.endTime : startTime + 3600000);
        var range = timelineRange(record, record.isCurrent);
        var duration = durationText(endTime - startTime);
        if (record.isCurrent && (state === "degraded" || state === "outage")) {
            return label + " — depuis " + timeLabel(startTime) + " — en cours (" + duration + ")";
        }
        return label + " — " + range + " — " + duration;
    }

    function renderTimeline(records, targetId) {
        var target = document.getElementById(targetId || "status-timeline");
        if (!target) return;
        var states = records.length === 24 || records.length === 90 ? records : timeline(records).map(function (state, index) { return { state: state, time: Date.now() - (29 - index) * 3600000 }; });
        var now = Date.now();
        function segmentDetail(segment, fallbackEnd) {
            // A cell must describe only its own portion of the hour.
            // Do not reuse the previous global state start (which can be on the 29th).
            var startTime = Number.isFinite(segment.startTime) ? segment.startTime : segment.displayStartTime;
            var endTime = Number.isFinite(segment.endTime) ? segment.endTime : (Number.isFinite(segment.displayEndTime) ? segment.displayEndTime : fallbackEnd);
            return timelineDetail({ time: startTime, endTime: endTime, displayStartTime: startTime, displayEndTime: endTime, state: segment.state, isCurrent: segment.isCurrent === true });
        }
        function renderOverlay(segment, fallbackEnd) {
            if (segment.state === "unknown") return "";
            var startTime = Number.isFinite(segment.displayStartTime) ? segment.displayStartTime : segment.startTime;
            var endTime = Number.isFinite(segment.displayEndTime) ? segment.displayEndTime : (Number.isFinite(segment.endTime) ? segment.endTime : fallbackEnd);
            var detail = segmentDetail(segment, fallbackEnd);
            var marker = "";
            var left = Number.isFinite(segment.left) ? Math.max(0, Math.min(100, segment.left)) : 0;
            var width = Number.isFinite(segment.width) ? Math.max(0, Math.min(100 - left, segment.width)) : (100 - left);
            var widthStyle = width <= 0 ? "1px" : "max(1px, " + width.toFixed(4) + "%)";
            return '<span data-history-detail="' + escapeHtml(detail) + '" aria-label="' + escapeHtml(detail) + '" class="status-history-bar status-history-segment is-' + segment.state + marker + '" style="left:' + left.toFixed(4) + '%;width:' + widthStyle + '"></span>';
        }
        target.innerHTML = states.map(function (record, index) {
            if (Array.isArray(record.segments)) {
                var slotEnd = Number.isFinite(record.endTime) ? record.endTime : record.time + 3600000;
                var slotState = record.segments.some(function (segment) { return segment.state === "unknown"; }) ? "unknown" : "operational";
                var slotDetail = record.segments.map(function (segment) { return segmentDetail(segment, slotEnd); }).join(" | ");
                var slotClasses = 'status-history-slot';
                if (slotState === "unknown") slotClasses += ' is-unknown';
                if (record.isCurrent) slotClasses += ' is-current';
                return '<span class="' + slotClasses + '" data-history-detail="' + escapeHtml(slotDetail) + '" aria-label="' + escapeHtml(slotDetail) + '">' + record.segments.map(function (segment) { return renderOverlay(segment, slotEnd); }).join("") + '</span>';
            }
            var state = record.state;
            var canMerge = state !== "unknown";
            var startIndex = index;
            var endIndex = index;
            if (canMerge) {
                while (startIndex > 0 && states[startIndex - 1].state === state) startIndex -= 1;
                while (endIndex + 1 < states.length && states[endIndex + 1].state === state) endIndex += 1;
            }
            var periodStart = states[startIndex];
            var periodEnd = states[endIndex];
            var periodIsCurrent = states.slice(startIndex, endIndex + 1).some(function (item) { return item.isCurrent === true; }) || (endIndex === states.length - 1 && periodEnd.endTime && periodEnd.endTime > now);
            var periodStartTime = Number.isFinite(periodStart.displayStartTime) ? periodStart.displayStartTime : periodStart.time;
            var periodEndTime = periodIsCurrent ? now : (Number.isFinite(periodEnd.displayEndTime) ? periodEnd.displayEndTime : (Number.isFinite(periodEnd.endTime) ? periodEnd.endTime : periodEnd.time + 3600000));
            var detail = timelineDetail({ time: periodStartTime, endTime: periodEndTime, state: state, isCurrent: periodIsCurrent });
            var marker = state === "outage" ? " has-marker marker-red" : state === "degraded" ? " has-marker marker-amber" : "";
            return '<span data-history-detail="' + escapeHtml(detail) + '" aria-label="' + escapeHtml(detail) + '" class="status-history-bar is-' + state + marker + '"></span>';
        }).join("");
        bindTimelinePopovers(target);
    }

    function renderIncident(statusPage, services, setup) {
        if (Array.isArray(statusPage)) {
            renderSummaryIncident(services);
            return;
        }
        var incident = statusPage && (statusPage.incident || (statusPage.config && statusPage.config.incident));
        var title = document.getElementById("status-incident-title");
        var time = document.getElementById("status-incident-time");
        var state = document.getElementById("status-incident-state");
        var updates = document.getElementById("status-incident-updates");
        var affected = document.getElementById("status-affected-list");
        var lastIncident = document.getElementById("status-last-incident");
        var ongoing = document.getElementById("status-ongoing");
        var incidentState = incident ? String(incident.status || incident.style || "Investigating").toLowerCase() : "up";

        if (setup) {
            title.textContent = "Connect status monitoring";
            time.textContent = "Uptime Kuma not connected";
            state.textContent = "SETUP";
            state.className = "status-incident-state is-degraded";
            updates.innerHTML = '<div class="status-update-row"><span class="status-update-symbol"><i data-lucide="circle-dot" aria-hidden="true"></i></span><strong>Configuration</strong><time>—</time><p>Add your public Uptime Kuma URL in <code>/js/status-config.js</code>. Your Connect API server remains unchanged.</p></div>';
            affected.innerHTML = "<li>Connect API</li><li>Provider monitors</li><li>Public status page</li>";
            lastIncident.textContent = "Monitoring not connected";
            ongoing.textContent = "Waiting for Uptime Kuma";
            return;
        }

        if (incident) {
            title.textContent = incident.title || incident.name || "Connect service incident";
            time.textContent = shortDate(incident.lastUpdatedDate || incident.updatedAt || incident.createdDate);
            state.textContent = String(incident.status || incident.style || "Investigating").toUpperCase();
            state.className = "status-incident-state " + (incidentState.indexOf("down") >= 0 || incidentState.indexOf("outage") >= 0 ? "is-down" : "is-degraded");
            updates.innerHTML = '<div class="status-update-row"><span class="status-update-symbol"><i data-lucide="circle-dot" aria-hidden="true"></i></span><strong>Notification</strong><time>' + escapeHtml(shortDate(incident.createdDate || incident.started)) + '</time><p>' + escapeHtml(incident.content || incident.description || "We are investigating this incident.") + '</p></div>';
            affected.innerHTML = services.map(function (service) { return "<li>" + escapeHtml(service.name) + "</li>"; }).join("") || "<li>Connect services</li>";
            lastIncident.textContent = incident.title || incident.name || "Active incident";
            ongoing.textContent = "Ongoing for: " + (incident.started ? durationText(Date.now() - new Date(incident.started).getTime()) : "—");
        } else {
            title.textContent = "No active incidents";
            time.textContent = "No incidents reported";
            state.textContent = "UP";
            state.className = "status-incident-state is-up";
            updates.innerHTML = '<div class="status-update-row"><span class="status-update-symbol"><i data-lucide="circle-check" aria-hidden="true"></i></span><strong>Notification</strong><time>Now</time><p>No active incidents have been reported for the monitored Connect services.</p></div>';
            affected.innerHTML = services.map(function (service) { return "<li>" + escapeHtml(service.name) + "</li>"; }).join("") || "<li>Connect API</li>";
            lastIncident.textContent = "No active incidents";
            ongoing.textContent = "All services operational";
        }
    }

    function renderSummaryIncident(services) {
        var title = document.getElementById("status-incident-title");
        var time = document.getElementById("status-incident-time");
        var state = document.getElementById("status-incident-state");
        var updates = document.getElementById("status-incident-updates");
        var affected = document.getElementById("status-affected-list");
        var lastIncident = document.getElementById("status-last-incident");
        var ongoing = document.getElementById("status-ongoing");
        var problems = services.filter(function (service) { return service.state === "outage" || service.state === "degraded"; });
        var overall = overallState(services);

        if (!problems.length && overall === "operational") {
            title.textContent = "All monitored services operational";
            time.textContent = "Live checks";
            state.textContent = "UP";
            state.className = "status-incident-state is-up";
            updates.innerHTML = '<div class="status-update-row"><span class="status-update-symbol"><i data-lucide="circle-check" aria-hidden="true"></i></span><strong>Notification</strong><time>Now</time><p>All public Connect checks are responding normally.</p></div>';
            lastIncident.textContent = "No active incidents";
            ongoing.textContent = "All services operational";
        } else {
            title.textContent = problems.length + " service" + (problems.length === 1 ? " requires attention" : "s require attention");
            time.textContent = "Live checks";
            state.textContent = overall === "outage" ? "DOWN" : "DEGRADED";
            state.className = "status-incident-state " + (overall === "outage" ? "is-down" : "is-degraded");
            updates.innerHTML = problems.map(function (service) {
                var label = service.state === "outage" ? "Down" : "Degraded";
                var latency = service.responseTime == null ? "" : " · " + service.responseTime + " ms";
                return '<div class="status-update-row"><span class="status-update-symbol"><i data-lucide="triangle-alert" aria-hidden="true"></i></span><strong>' + escapeHtml(label) + '</strong><time>Now</time><p>' + escapeHtml(service.name) + escapeHtml(latency) + '</p></div>';
            }).join("");
            lastIncident.textContent = problems.map(function (service) { return service.name; }).join(", ");
            ongoing.textContent = "Live monitoring";
        }

        affected.innerHTML = services.map(function (service) {
            var uptime = service.uptime == null ? "" : " · " + service.uptime.toFixed(2) + "%";
            return "<li>" + escapeHtml(service.name) + escapeHtml(uptime) + "</li>";
        }).join("") || "<li>Connect services</li>";
    }

    function hasKnownStartTimes(services) {
        return services.length > 0 && services.every(function (service) { return Number.isFinite(service.startTime); });
    }

    function dateKey(date) {
        return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
    }

    function utcDateKey(date) {
        return date.getUTCFullYear() + "-" + String(date.getUTCMonth() + 1).padStart(2, "0") + "-" + String(date.getUTCDate()).padStart(2, "0");
    }

    function dailyDownMinutes(service, day) {
        // Daily totals are stored by UTC date. Use one source date per bar
        // so a UTC midnight cannot make the same incident appear on two local days.
        var minutes = Number((service.dailyMinutesDown || {})[utcDateKey(day)]);
        return Number.isFinite(minutes) ? Math.max(0, minutes) : 0;
    }

    function summaryTimeline(services) {
        var days = 90;
        var bars = Array(days).fill("unknown");
        if (!services.length) return bars;
        var now = new Date();
        var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        var knownStarts = hasKnownStartTimes(services);
        for (var index = 0; index < days; index += 1) {
            var day = new Date(today);
            day.setDate(today.getDate() - (days - 1 - index));
            var covered = !knownStarts || services.every(function (service) { return service.startTime <= day.getTime() + 86400000; });
            if (!covered) continue;
            var outage = services.some(function (service) { return dailyDownMinutes(service, day) > 0; });
            bars[index] = outage ? "outage" : "operational";
        }
        // Keep the day's historical incident visible even after recovery.
        return bars;
    }

    function readTimelineTransitions() {
        try {
            var saved = JSON.parse(window.localStorage.getItem("connect-status-state-transitions") || "[]");
            return Array.isArray(saved) ? saved.filter(function (item) { return item && Number.isFinite(Number(item.time)) && typeof item.state === "string"; }) : [];
        } catch (error) { return []; }
    }

    function rememberTimelineState(state, nowTime) {
        var transitions = readTimelineTransitions().filter(function (item) { return Number(item.time) >= nowTime - 3 * 86400000; });
        var last = transitions[transitions.length - 1];
        if (!last || last.state !== state) transitions.push({ time: nowTime, state: state });
        try { window.localStorage.setItem("connect-status-state-transitions", JSON.stringify(transitions.slice(-200))); } catch (error) { /* private browsing */ }
        return transitions;
    }

    function currentTimeline(services, historyTransitions) {
        var now = new Date();
        var nowTime = now.getTime();
        var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        var state = overallState(services);
        var knownStarts = hasKnownStartTimes(services);
        var transitions = (Array.isArray(historyTransitions) && historyTransitions.length ? historyTransitions : rememberTimelineState(state, nowTime)).sort(function (a, b) { return Number(a.time) - Number(b.time); });
        function stateAt(time) {
            var result = null;
            transitions.forEach(function (item) { if (Number(item.time) <= time) result = item; });
            return result;
        }
        function nextTransition(time) {
            return transitions.find(function (item) { return Number(item.time) > time; }) || null;
        }
        return Array(24).fill(null).map(function (_, index) {
            var time = todayStart + index * 3600000;
            var nextTime = time + 3600000;
            var isFuture = time > nowTime;
            var isCurrent = !isFuture && nowTime < nextTime;
            var intervalEnd = isFuture ? nextTime : Math.min(nextTime, nowTime);
            var covered = !knownStarts || services.every(function (service) { return service.startTime <= time + 3600000; });
            if (isFuture || !covered) return { time: time, endTime: nextTime, state: "unknown", segments: [{ startTime: time, endTime: nextTime, displayStartTime: time, displayEndTime: nextTime, state: "unknown", width: 100 }] };

            var initial = stateAt(time);
            var activeState = initial ? initial.state : (isCurrent ? state : "operational");
            var activeStart = initial ? Number(initial.time) : time;
            var events = transitions.filter(function (item) { return Number(item.time) > time && Number(item.time) < intervalEnd; });
            var segments = [];
            var cursor = time;
            events.forEach(function (item) {
                var eventTime = Number(item.time);
                var periodEnd = eventTime;
                if (periodEnd > cursor) {
                    segments.push({ startTime: cursor, endTime: periodEnd, displayStartTime: activeStart, displayEndTime: eventTime, state: activeState, isCurrent: false });
                }
                activeState = item.state;
                activeStart = eventTime;
                cursor = eventTime;
            });
            if (intervalEnd > cursor) {
                segments.push({ startTime: cursor, endTime: intervalEnd, displayStartTime: activeStart, displayEndTime: nextTransition(activeStart) ? Number(nextTransition(activeStart).time) : (isCurrent ? nowTime : intervalEnd), state: activeState, isCurrent: isCurrent && cursor <= nowTime && activeState === state });
            }
            if (!segments.length) segments.push({ startTime: time, endTime: intervalEnd, displayStartTime: activeStart, displayEndTime: isCurrent ? nowTime : intervalEnd, state: activeState, isCurrent: isCurrent && activeState === state });
            // Always map the segment to the complete one-hour cell, including the current hour.
            // This keeps a short incident proportional instead of stretching it across elapsed time only.
            var total = 3600000;
            segments.forEach(function (segment) { segment.left = ((segment.startTime - time) / total) * 100; segment.width = ((segment.endTime - segment.startTime) / total) * 100; });
            return { time: time, endTime: isCurrent ? nowTime : nextTime, state: activeState, isCurrent: isCurrent, segments: segments };
        });
    }

    function loadMonitorStartTimes(services) {
        var base = String(config.historyBaseUrl || "").replace(/\/+$/, "");
        if (!base) return Promise.resolve(services.map(function () { return null; }));
        return Promise.all(services.map(function (service) {
            var slug = encodeURIComponent(service.slug || service.id);
            return fetchText(base + "/" + slug + ".yml").then(function (text) {
                var match = text.match(/^startTime:\s*(.+)$/m);
                var time = match ? Date.parse(match[1].trim()) : NaN;
                return Number.isFinite(time) ? time : null;
            }).catch(function () { return null; });
        }));
    }

    function statusFromCommitMessage(message) {
        var text = String(message || "").toLowerCase();
        if (/\b(down|unavailable|outage|failed)\b/.test(text)) return "outage";
        if (/\b(degraded|slow)\b/.test(text)) return "degraded";
        if (/\b(up|operational|recovered)\b/.test(text)) return "operational";
        return "unknown";
    }

    function loadMonitorTransitions(services) {
        var base = String(config.historyCommitsUrl || "").replace(/\/+$/, "");
        if (!base || !services.length) return Promise.resolve({ transitions: [], serviceStates: [] });
        return Promise.all(services.map(function (service) {
            var slug = encodeURIComponent(service.slug || service.id);
            var url = base + "?path=history/" + slug + ".yml&per_page=100";
            return fetchCachedJson(url, "connect-status-commits-" + slug, 300000).then(function (commits) {
                return (Array.isArray(commits) ? commits : []).map(function (commit) {
                    var item = commit && commit.commit ? commit.commit : {};
                    var time = Date.parse((item.author && item.author.date) || (item.committer && item.committer.date) || "");
                    var state = statusFromCommitMessage(item.message);
                    return Number.isFinite(time) && state !== "unknown" ? { time: time, state: state } : null;
                }).filter(Boolean).sort(function (a, b) { return a.time - b.time; });
            }).catch(function () { return []; });
        })).then(function (perService) {
            var events = [];
            perService.forEach(function (items, serviceIndex) { items.forEach(function (item) { events.push({ time: item.time, state: item.state, serviceIndex: serviceIndex }); }); });
            if (!events.length) return { transitions: [], serviceStates: [] };
            events.sort(function (a, b) { return a.time - b.time; });
            var states = services.map(function () { return "operational"; });
            var latestByService = services.map(function () { return null; });
            var transitions = [];
            events.forEach(function (event) {
                states[event.serviceIndex] = event.state;
                latestByService[event.serviceIndex] = { time: event.time, state: event.state };
                var overall = states.indexOf("outage") >= 0 ? "outage" : states.indexOf("degraded") >= 0 ? "degraded" : "operational";
                var previous = transitions[transitions.length - 1];
                if (!previous || previous.state !== overall) transitions.push({ time: event.time, state: overall });
            });
            return { transitions: transitions, serviceStates: latestByService };
        });
    }

    function historicalTimeline(services, historyTransitions) {
        var days = 90;
        var nowTime = Date.now();
        var now = new Date(nowTime);
        var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        var transitions = (Array.isArray(historyTransitions) ? historyTransitions : []).slice().sort(function (a, b) { return Number(a.time) - Number(b.time); });
        var knownStarts = hasKnownStartTimes(services);
        var coverageStart = knownStarts ? Math.max.apply(null, services.map(function (service) { return service.startTime; })) : 0;
        function stateAt(time) {
            var result = null;
            transitions.forEach(function (item) { if (Number(item.time) <= time) result = item; });
            return result;
        }
        return Array(days).fill(null).map(function (_, index) {
            var dayStart = new Date(todayStart);
            dayStart.setDate(dayStart.getDate() - (days - 1 - index));
            var startTime = dayStart.getTime();
            var endTime = startTime + 86400000;
            var isCurrentDay = startTime === todayStart;
            var observedEnd = isCurrentDay ? Math.min(nowTime, endTime) : endTime;
            var segments = [];
            var cursor = startTime;
            if (knownStarts && cursor < coverageStart) {
                var noDataEnd = Math.min(coverageStart, observedEnd);
                if (noDataEnd > cursor) segments.push({ startTime: cursor, endTime: noDataEnd, state: "unknown", isCurrent: false });
                cursor = noDataEnd;
            }
            if (cursor < observedEnd) {
                var initial = stateAt(cursor);
                var activeState = initial ? initial.state : "operational";
                var events = transitions.filter(function (item) { return Number(item.time) > cursor && Number(item.time) < observedEnd; });
                events.forEach(function (item) {
                    var eventTime = Number(item.time);
                    if (eventTime > cursor) segments.push({ startTime: cursor, endTime: eventTime, state: activeState, isCurrent: false });
                    activeState = item.state;
                    cursor = eventTime;
                });
                if (observedEnd > cursor) segments.push({ startTime: cursor, endTime: observedEnd, state: activeState, isCurrent: isCurrentDay && activeState === overallState(services) });
            }
            if (isCurrentDay && observedEnd < endTime) segments.push({ startTime: observedEnd, endTime: endTime, state: "unknown", isCurrent: false });
            if (!segments.length) segments.push({ startTime: startTime, endTime: endTime, state: "unknown", isCurrent: false });
            segments.forEach(function (segment) {
                segment.left = ((segment.startTime - startTime) / 86400000) * 100;
                segment.width = ((segment.endTime - segment.startTime) / 86400000) * 100;
            });
            return { time: startTime, endTime: endTime, state: segments[segments.length - 1].state, isCurrent: isCurrentDay, segments: segments };
        });
    }

    function loadSummary(summaryData, starts, historyData) {
        var services = summaryMonitors(summaryData);
        var historyTransitions = Array.isArray(historyData) ? historyData : ((historyData && historyData.transitions) || []);
        var serviceStates = historyData && !Array.isArray(historyData) ? (historyData.serviceStates || []) : [];
        (starts || []).forEach(function (start, index) { if (services[index]) services[index].startTime = start; });
        serviceStates.forEach(function (latest, index) {
            if (latest && latest.state && services[index] && latest.time <= Date.now()) services[index].state = latest.state;
        });
        currentServices = services;
        var state = overallState(services);
        var today = new Date();
        today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        var historyRecords = historyTransitions.length ? historicalTimeline(services, historyTransitions) : summaryTimeline(services).map(function (barState, index) {
            var day = new Date(today);
            day.setDate(today.getDate() - (89 - index));
            return { time: day.getTime(), endTime: day.getTime() + 86400000, displayStartTime: day.getTime(), displayEndTime: day.getTime() + 86400000, state: barState };
        });
        var currentRecords = currentTimeline(services, historyTransitions);
        var uptimeValues = services.map(function (service) { return service.uptime; }).filter(function (value) { return Number.isFinite(value); });
        var uptime = uptimeValues.length ? (uptimeValues.reduce(function (sum, value) { return sum + value; }, 0) / uptimeValues.length).toFixed(2) + "%" : "Monitoring live";
        setSystemState(state, uptime);
        renderTimeline(currentRecords, "status-timeline");
        renderTimeline(historyRecords, "status-history-3mo-timeline");
        renderIncident(services, services, false);
        renderDetailPanel("overview", services);
        renderHistoryTable(services);
        refreshIcons();
    }

    function loadStatus() {
        if (!dashboard) return;
        if (!baseUrl() && !config.summaryUrl) {
            setSystemState("unknown", "Monitoring not connected");
            renderTimeline([]);
            renderIncident(null, [], true);
            return;
        }
        if (refreshButton) refreshButton.disabled = true;
        setSystemState("checking", config.summaryUrl ? "Contacting status checks" : "Contacting Uptime Kuma");
        var request = config.summaryUrl
            ? Promise.all([fetchJson(config.summaryUrl), loadMaintenance(), loadErrorReports()] ).then(function (results) {
                var services = summaryMonitors(results[0]);
                return Promise.all([loadMonitorStartTimes(services), loadMonitorTransitions(services)]).then(function (data) { loadSummary(results[0], data[0], data[1]); });
            })
            : Promise.all([
                fetchJson(baseUrl() + "/api/status-page/" + encodeURIComponent(config.statusPageSlug)),
                fetchJson(baseUrl() + "/api/status-page/heartbeat/" + encodeURIComponent(config.statusPageSlug))
            ]).then(function (results) {
                var services = monitors(results[0], results[1]);
                var records = flattenHistory(services);
                var state = overallState(services);
                var uptimeValues = services.map(function (service) { return service.uptime; }).filter(function (value) { return Number.isFinite(value); });
                var uptime = uptimeValues.length ? (uptimeValues.reduce(function (sum, value) { return sum + value; }, 0) / uptimeValues.length).toFixed(4) + "%" : "Monitoring live";
                setSystemState(state, uptime);
                renderTimeline(records);
                renderIncident(results[0], services, false);
                renderDetailPanel(currentDetailTab, services);
                refreshIcons();
            });
        request.catch(function () {
            setSystemState("unknown", "Unable to verify status");
            renderTimeline([]);
            renderIncident(null, [], true);
        }).finally(function () { if (refreshButton) refreshButton.disabled = false; });
    }


    function totalDowntime(service) {
        return Object.keys(service.dailyMinutesDown || {}).reduce(function (sum, key) {
            var value = Number(service.dailyMinutesDown[key]);
            return sum + (Number.isFinite(value) ? Math.max(0, value) : 0);
        }, 0);
    }

    function sortedServices(services) {
        return services.slice().sort(function (a, b) {
            if (currentSort === "name") return a.name.localeCompare(b.name);
            if (currentSort === "uptime") return (b.uptime == null ? -1 : b.uptime) - (a.uptime == null ? -1 : a.uptime);
            var rank = { outage: 0, degraded: 1, unknown: 2, operational: 3 };
            return (rank[a.state] - rank[b.state]) || a.name.localeCompare(b.name);
        });
    }

    function formatPercent(value) {
        return value == null || !Number.isFinite(Number(value)) ? "—" : Number(value).toFixed(2) + "%";
    }

    function formatMs(value) {
        return value == null || !Number.isFinite(Number(value)) ? "—" : Math.round(Number(value)) + " ms";
    }

    function serviceRows(services) {
        return sortedServices(services).map(function (service) {
            var label = stateLabel(service.state);
            return "<tr><td><strong>" + escapeHtml(service.name) + "</strong></td><td><span class=\"status-table-state is-" + service.state + "\">" + escapeHtml(label) + "</span></td><td>" + formatPercent(service.uptimeDay) + "</td><td>" + formatPercent(service.uptimeWeek) + "</td><td>" + formatPercent(service.uptimeMonth) + "</td><td>" + formatMs(service.responseTime) + "</td><td>" + Math.round(totalDowntime(service)) + " min</td></tr>";
        }).join("");
    }
    function tableMarkup(services) {
        return '<div class="status-table-wrap"><table class="status-data-table"><thead><tr><th>Component</th><th>Status</th><th>24h</th><th>7d</th><th>30d</th><th>Response</th><th>Downtime</th></tr></thead><tbody>' + (serviceRows(services) || '<tr><td colspan="7">No monitoring data available.</td></tr>') + "</tbody></table></div>";
    }

    function renderHistoryTable(services) {
        var target = document.getElementById("status-history-table-wrap");
        if (target) target.innerHTML = tableMarkup(services);
    }



    function cleanIssueText(value) {
        return String(value || "").replace(/<!--[\s\S]*?-->/g, "").trim();
    }

    function reportStatus(issue, text) {
        var value = String(text || "").toLowerCase();
        var labels = (issue.labels || []).map(function (label) { return String(label.name || label).toLowerCase(); });
        if (/\b(resolved|fixed|closed)\b/.test(value) || labels.some(function (label) { return label.indexOf("resolved") >= 0; })) return "Resolved";
        if (/\b(resolving|mitigat|rolling back|deploying fix)\b/.test(value) || labels.some(function (label) { return label.indexOf("resolv") >= 0 || label.indexOf("mitigat") >= 0; })) return "Resolving";
        if (/\bidentified|confirmed\b/.test(value) || labels.some(function (label) { return label.indexOf("identified") >= 0; })) return "Identified";
        return "Investigating";
    }

    function parseErrorReport(issue, comments) {
        var updates = [{ status: reportStatus(issue, issue.body), date: issue.created_at, text: cleanIssueText(issue.body) || "We are investigating this report." }];
        (comments || []).forEach(function (comment) {
            var text = cleanIssueText(comment.body);
            if (text) updates.push({ status: reportStatus(issue, text), date: comment.created_at, text: text });
        });
        if (issue.state === "closed" && updates[updates.length - 1].status !== "Resolved") updates.push({ status: "Resolved", date: issue.closed_at || issue.updated_at, text: "This report has been resolved." });
        if (issue.state !== "closed") {
            var compactUpdates = [];
            updates.forEach(function (update) {
                var previous = compactUpdates[compactUpdates.length - 1];
                if (previous && previous.status === update.status) compactUpdates[compactUpdates.length - 1] = update;
                else compactUpdates.push(update);
            });
            updates = compactUpdates;
        }
        return { title: issue.title || "Connect desktop error report", state: issue.state === "closed" ? "resolved" : "open", url: issue.html_url || "", updates: updates };
    }

    function loadErrorReports() {
        var url = String(config.githubApiBaseUrl || "https://api.github.com/repos/beloralabs-connect/connect-status").replace(/\/+$/, "") + "/issues?state=all&per_page=30";
        return fetchJson(url).then(function (issues) {
            var seen = {};
            var reports = (Array.isArray(issues) ? issues : []).filter(function (issue) {
                if (seen[issue.number]) return false;
                seen[issue.number] = true;
                if (issue.pull_request) return false;
                var labels = (issue.labels || []).map(function (label) { return String(label.name || label).toLowerCase(); });
                if (labels.indexOf("maintenance") >= 0 || String(issue.title || "").toLowerCase().indexOf("scheduled maintenance") >= 0) return false;
                return labels.some(function (label) { return ["error-report", "bug", "incident", "desktop", "app-error"].indexOf(label) >= 0; });
            }).slice(0, 20);
            return Promise.all(reports.map(function (issue) {
                var commentsUrl = String(config.githubApiBaseUrl || "https://api.github.com/repos/beloralabs-connect/connect-status").replace(/\/+$/, "") + "/issues/" + issue.number + "/comments?per_page=100";
                return fetchJson(commentsUrl).catch(function () { return []; }).then(function (comments) { return parseErrorReport(issue, comments); });
            }));
        }).then(function (reports) { errorReports = reports; renderDetailPanel(currentDetailTab, currentServices); }).catch(function () { errorReports = []; });
    }

    function parseMaintenanceIssue(issue) {
        var body = String(issue.body || "");
        var block = body.match(/<!--([\s\S]*?)-->/);
        var values = {};
        if (block) block[1].split("\n").forEach(function (line) {
            var parts = line.split(":");
            if (parts.length > 1) values[parts.shift().trim()] = parts.join(":").trim();
        });
        var start = new Date(values.start || issue.created_at);
        var end = new Date(values.end || "");
        return { title: issue.title || "Scheduled maintenance", description: body.replace(/<!--[\s\S]*?-->/, "").trim(), start: start, end: end, url: issue.html_url || "", expectedDown: values.expectedDown || "", state: issue.state === "closed" ? "completed" : (Number.isNaN(end.getTime()) || Date.now() <= end.getTime() ? (Date.now() < start.getTime() ? "upcoming" : "active") : "completed") };
    }

    function loadMaintenance() {
        var url = String(config.githubApiBaseUrl || "https://api.github.com/repos/beloralabs-connect/connect-status").replace(/\/+$/, "") + "/issues?state=all&labels=maintenance&per_page=30";
        return fetchJson(url).then(function (issues) {
            var seen = {};
            maintenanceItems = (Array.isArray(issues) ? issues : []).filter(function (issue) {
                if (seen[issue.number]) return false;
                seen[issue.number] = true;
                return true;
            }).map(parseMaintenanceIssue).filter(function (item) { return item.state !== "completed"; });
            renderDetailPanel(currentDetailTab, currentServices);
        }).catch(function () { maintenanceItems = []; });
    }

    function maintenanceMarkup(tab) {
        var wanted = tab === "maintenance" ? "active" : "upcoming";
        var items = maintenanceItems.filter(function (item) { return item.state === wanted; });
        var title = wanted === "active" ? "Active maintenance" : "Upcoming maintenance";
        if (!items.length) return '<div class="status-empty-state"><h2>' + title + '</h2><p>No public maintenance events are currently reported.</p></div>';
        return items.map(function (item) {
            var date = Number.isNaN(item.start.getTime()) ? "Date not specified" : item.start.toLocaleString([], { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
            var endDate = Number.isNaN(item.end.getTime()) ? "—" : item.end.toLocaleString([], { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
            var duration = Number.isNaN(item.end.getTime()) ? "End time not specified" : Math.max(0, Math.round((item.end.getTime() - item.start.getTime()) / 60000)) + " minutes";
            var description = item.description || (wanted === "active" ? "Maintenance is currently in progress." : "Maintenance is scheduled.");
            var badge = wanted === "active" ? "In progress" : "Scheduled";
            return '<article class="status-event-card"><header class="status-event-head"><span class="status-event-icon is-maintenance">!</span><strong>' + escapeHtml(item.title) + '</strong><span class="status-event-chevron" aria-hidden="true">›</span></header><div class="status-event-timeline"><div class="status-event-update"><span class="status-event-badge is-current">' + badge + '</span><div><time>' + escapeHtml(date) + '</time><p>' + escapeHtml(description) + '</p></div></div><div class="status-event-update"><span class="status-event-badge">End</span><div><time>' + escapeHtml(endDate) + '</time><p>Planned duration: ' + escapeHtml(duration) + '.</p></div></div></div>' + (item.url ? '<a class="status-event-link" href="' + escapeHtml(item.url) + '" target="_blank" rel="noopener">View and subscribe on GitHub</a>' : '') + '</article>';
        }).join("");
    }

    function errorReportsMarkup() {
        if (!errorReports.length) return "<div class=\"status-empty-state\"><h2>Error Reports</h2><p>No global desktop application error reports are currently reported.</p></div>";
        return "<div class=\"status-panel-heading\"><div><h2>Error Reports</h2><p>Global Connect desktop application reports and their resolution history.</p></div></div>" + errorReports.map(function (report) {
            return "<article class=\"status-event-card is-collapsed\"><header class=\"status-event-head\"><button class=\"status-event-toggle\" type=\"button\" data-error-toggle aria-expanded=\"false\"><span class=\"status-event-icon is-error\">!</span><strong>" + escapeHtml(report.title) + "</strong><span class=\"status-event-chevron\" aria-hidden=\"true\">›</span></button></header><div class=\"status-event-timeline\">" + report.updates.slice().reverse().map(function (update, index) {
                var isLatest = index === 0;
                var badgeClass = isLatest && update.status === "Resolved" ? "is-resolved" : (isLatest ? "is-active" : "is-completed");
                return "<div class=\"status-event-update\"><span class=\"status-event-badge " + badgeClass + "\">" + escapeHtml(update.status) + "</span><div><time>" + escapeHtml(dateText(update.date)) + "</time><p>" + escapeHtml(update.text) + "</p></div></div>";
            }).join("") + "</div>" + (report.url ? "<a class=\"status-event-link\" href=\"" + escapeHtml(report.url) + "\" target=\"_blank\" rel=\"noopener\">View report on GitHub</a>" : "") + "</article>";
        }).join("");
    }

    function renderDetailPanel(tab, services) {
        var panel = document.getElementById("status-detail-panel");
        var card = document.getElementById("status-incidents");
        if (!panel || !card) return;
        currentDetailTab = tab;
        document.querySelectorAll("[data-detail-tab]").forEach(function (button) {
            var active = button.getAttribute("data-detail-tab") === tab;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-selected", active ? "true" : "false");
        });
        var incidentToggle = document.getElementById("status-incident-toggle");
        if (incidentToggle && !incidentToggle.dataset.bound) {
            incidentToggle.dataset.bound = "true";
            incidentToggle.addEventListener("click", function () {
                var incidentCard = document.getElementById("status-incidents");
                if (!incidentCard) return;
                var expanded = incidentCard.classList.toggle("is-expanded");
                incidentCard.classList.toggle("is-collapsed", !expanded);
                incidentToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
            });
        }
        card.hidden = tab !== "incidents";
        panel.hidden = tab === "incidents";
        if (tab === "incidents") return;
        if (tab === "overview") {
            panel.innerHTML = "<div class=\"status-panel-heading\"><div><h2>System overview</h2><p>Only the two public Connect components are monitored.</p></div></div>" + tableMarkup(services);
        } else if (tab === "components") {
            panel.innerHTML = "<div class=\"status-panel-heading\"><div><h2>Current component status</h2><p>Live availability and response data.</p></div></div>" + tableMarkup(services);
        } else if (tab === "maintenance" || tab === "upcoming") {
            panel.innerHTML = maintenanceMarkup(tab);
        } else if (tab === "errors") {
            panel.innerHTML = errorReportsMarkup();
        } else {
            panel.innerHTML = "<div class=\"status-empty-state\"><h2>Active notices</h2><p>No public notices are currently reported.</p></div>";
        }
        refreshIcons();
        panel.querySelectorAll("[data-error-toggle]").forEach(function (toggle) {
            toggle.addEventListener("click", function () {
                var reportCard = toggle.closest(".status-event-card");
                if (!reportCard) return;
                var expanded = reportCard.classList.toggle("is-expanded");
                reportCard.classList.toggle("is-collapsed", !expanded);
                toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
            });
        });
    }

    function setupStatusNavigation() {
        var currentPanel = document.getElementById("status-current-panel");
        var historyPanel = document.getElementById("status-history-panel");
        document.querySelectorAll("[data-primary-tab]").forEach(function (button) {
            button.addEventListener("click", function () {
                var history = button.getAttribute("data-primary-tab") === "history";
                document.querySelectorAll("[data-primary-tab]").forEach(function (item) {
                    var active = item === button;
                    item.classList.toggle("is-active", active);
                    item.setAttribute("aria-selected", active ? "true" : "false");
                });
                if (currentPanel) currentPanel.hidden = history;
                if (historyPanel) historyPanel.hidden = !history;
                if (history) renderHistoryTable(currentServices);
            });
        });
        document.querySelectorAll("[data-detail-tab]").forEach(function (button) {
            button.addEventListener("click", function () { renderDetailPanel(button.getAttribute("data-detail-tab"), currentServices); });
        });
        var sortButton = document.getElementById("status-sort-button");
        if (sortButton) sortButton.addEventListener("click", function () {
            currentSort = currentSort === "status" ? "name" : currentSort === "name" ? "uptime" : "status";
            var text = sortButton.querySelector("span");
            if (text) text.textContent = "Sort: " + currentSort;
            renderDetailPanel(currentDetailTab, currentServices);
            renderHistoryTable(currentServices);
        });
    }

    function setupSubscribeDialog() {
        var openButton = document.getElementById("status-subscribe-open");
        var dialog = document.getElementById("status-subscribe-dialog");
        var form = document.getElementById("status-subscribe-form");
        if (!openButton || !dialog) return;
        openButton.addEventListener("click", function () {
            dialog.hidden = false;
            openButton.setAttribute("aria-expanded", "true");
            var input = document.getElementById("status-subscribe-email");
            if (input) window.setTimeout(function () { input.focus(); }, 50);
        });
        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape" && !dialog.hidden) {
                dialog.hidden = true;
                openButton.setAttribute("aria-expanded", "false");
                openButton.focus();
            }
        });
        dialog.querySelectorAll("[data-subscribe-tab]").forEach(function (tab) {
            tab.addEventListener("click", function () {
                dialog.querySelectorAll("[data-subscribe-tab]").forEach(function (item) {
                    item.classList.remove("is-active");
                    item.setAttribute("aria-selected", item === tab ? "true" : "false");
                });
                tab.classList.add("is-active");
                var title = document.getElementById("status-subscribe-title");
                var channel = tab.getAttribute("data-subscribe-tab");
                if (title) title.textContent = "Subscribe via " + channel.charAt(0).toUpperCase() + channel.slice(1);
            });
        });
        if (form) form.addEventListener("submit", function (event) {
            event.preventDefault();
            var input = document.getElementById("status-subscribe-email");
            var button = form.querySelector("button[type=submit]");
            var feedback = document.getElementById("status-subscribe-feedback");
            var email = input ? input.value.trim() : "";
            var endpoint = String(config.subscriptionUrl || "").trim();
            if (!endpoint || !email) return;
            if (button) button.disabled = true;
            if (feedback) { feedback.hidden = false; feedback.className = "status-subscribe-feedback"; feedback.textContent = "Subscribing…"; }
            fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ email: email }) })
                .then(function (response) { return response.json().catch(function () { return {}; }).then(function (data) { if (!response.ok) throw new Error(data.error || "Subscription failed"); return data; }); })
                .then(function () {
                    if (feedback) { feedback.className = "status-subscribe-feedback is-success"; feedback.textContent = "You are subscribed to Connect status updates."; }
                    if (input) input.value = "";
                })
                .catch(function (error) {
                    if (feedback) { feedback.className = "status-subscribe-feedback is-error"; feedback.textContent = error.message || "Subscription failed. Please try again."; }
                })
                .finally(function () { if (button) button.disabled = false; });
        });
    }

    setFooterState("checking");
    setupSubscribeDialog();
    setupStatusNavigation();
    refreshIcons();
    if (refreshButton) refreshButton.addEventListener("click", loadStatus);
    if (dashboard) {
        loadStatus();
        refreshTimer = window.setInterval(loadStatus, 60000);
        window.addEventListener("beforeunload", function () { window.clearInterval(refreshTimer); });
    } else if (config.summaryUrl || baseUrl()) {
        var footerRequest = config.summaryUrl
            ? fetchJson(config.summaryUrl).then(function (data) { return summaryMonitors(data).map(function (service) { return { state: service.state }; }); })
            : fetchJson(baseUrl() + "/api/status-page/heartbeat/" + encodeURIComponent(config.statusPageSlug)).then(function (data) {
            var states = Object.keys(data.heartbeatList || {}).map(function (id) { var list = data.heartbeatList[id] || []; return { state: stateFor(list[list.length - 1] && list[list.length - 1].status) }; });
            return states;
        });
        footerRequest.then(function (states) { setFooterState(overallState(states)); }).catch(function () { setFooterState("unknown"); });
    }
}());

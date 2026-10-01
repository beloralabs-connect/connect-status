/*
 * Public status configuration.
 *
 * Set uptimeKumaBaseUrl to the public origin of your Uptime Kuma instance,
 * for example: https://status.example.com
 * The status page must be published and its slug must match statusPageSlug.
 */
window.CONNECT_STATUS_CONFIG = {
    uptimeKumaBaseUrl: "",
    statusPageSlug: "connect",
    statusPageUrl: "",
    summaryUrl: "https://raw.githubusercontent.com/beloralabs-connect/connect-status/master/history/summary.json",
    historyBaseUrl: "https://raw.githubusercontent.com/beloralabs-connect/connect-status/master/history",
    githubApiBaseUrl: "https://connect-status-github.belora-connect.workers.dev",
    subscriptionUrl: "https://connect-status-github.belora-connect.workers.dev/subscribe",
    historyCommitsUrl: "https://api.github.com/repos/beloralabs-connect/connect-status/commits"
};

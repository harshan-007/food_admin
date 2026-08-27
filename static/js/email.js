document.addEventListener("DOMContentLoaded", () => {
    const body = document.getElementById("rosterBody");
    const search = document.getElementById("rosterSearch");
    const empty = document.getElementById("emptyState");
    const statusBanner = document.getElementById("mailStatus");
    const sendAllBtn = document.getElementById("sendAllButton");
    const refreshBtn = document.getElementById("refreshButton");
    const progressCard = document.getElementById("batchProgressCard");
    const progressTitle = document.getElementById("batchProgressTitle");
    const progressCounter = document.getElementById("batchProgressCounter");
    const progressFill = document.getElementById("progressBarFill");
    const filterButtons = [...document.querySelectorAll(".filter-button")];

    let participants = [];
    let activeFilter = "all";
    let isProcessingBatch = false;

    // Retrieve CSRF token from cookie or hidden input
    function getCsrfToken() {
        const input = document.querySelector('input[name="csrfmiddlewaretoken"]');
        if (input && input.value) return input.value;
        const cookie = document.cookie.split("; ").find(item => item.startsWith("csrftoken="));
        return cookie ? cookie.split("=")[1] : "";
    }

    function showStatus(message, type = "info", autoHide = true) {
        if (!statusBanner) return;
        statusBanner.textContent = message;
        statusBanner.className = `status-banner status-${type}`;
        statusBanner.hidden = false;
        if (autoHide) {
            clearTimeout(statusBanner._timeout);
            statusBanner._timeout = setTimeout(() => {
                statusBanner.hidden = true;
            }, 6000);
        }
    }

    async function loadParticipants() {
        try {
            body.innerHTML = `<tr><td colspan="5" class="table-loading">Refreshing delegates list...</td></tr>`;
            const response = await fetch("/api/mail/participants/", { credentials: "same-origin" });
            if (!response.ok) throw new Error("Could not fetch participants from server.");
            participants = await response.json();
            render();
        } catch (err) {
            showStatus(err.message, "danger", false);
            body.innerHTML = `<tr><td colspan="5" class="table-loading text-danger">Error: ${escapeHtml(err.message)}</td></tr>`;
        }
    }

    async function sendMail(participant, resend = false) {
        const action = resend ? "resend" : "send";
        const csrfToken = getCsrfToken();
        const response = await fetch(`/api/mail/participants/${participant.id}/${action}/`, {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Content-Type": "application/json",
                "X-CSRFToken": decodeURIComponent(csrfToken)
            }
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
            throw new Error(result.error || "Email could not be delivered.");
        }
        const updated = result.participant;
        participants = participants.map(item => item.id === updated.id ? { ...item, ...updated } : item);
        return updated;
    }

    function updateCounts() {
        const total = participants.length;
        const sent = participants.filter(item => item.mail_sent || item.mail_delivered).length;
        const delivered = participants.filter(item => item.mail_delivered).length;
        const notSent = participants.filter(item => !item.mail_sent && !item.mail_delivered).length;

        document.getElementById("totalCount").textContent = total;
        document.getElementById("sentCount").textContent = sent;
        document.getElementById("deliveredCount").textContent = delivered;
        document.getElementById("notSentCount").textContent = notSent;

        const countAll = document.getElementById("filterCountAll");
        const countSent = document.getElementById("filterCountSent");
        const countNotSent = document.getElementById("filterCountNotSent");
        if (countAll) countAll.textContent = total;
        if (countSent) countSent.textContent = sent;
        if (countNotSent) countNotSent.textContent = notSent;

        // Update send-all button label depending on state
        if (sendAllBtn && !isProcessingBatch) {
            if (notSent > 0) {
                sendAllBtn.innerHTML = `✉️ Send Mail to ${notSent} Pending`;
            } else {
                sendAllBtn.innerHTML = `🔄 Resend Mail to All (${total})`;
            }
        }
    }

    function render() {
        updateCounts();
        const query = (search.value || "").trim().toLowerCase();

        const visible = participants.filter(item => {
            const isSent = item.mail_sent || item.mail_delivered;
            let matchesFilter = true;
            if (activeFilter === "sent") matchesFilter = isSent;
            if (activeFilter === "not-sent") matchesFilter = !isSent;

            const manualCode = (item.manual_code || item.participant_id || "").toLowerCase();
            const name = (item.name || "").toLowerCase();
            const email = (item.email || "").toLowerCase();
            const matchesQuery = !query || name.includes(query) || email.includes(query) || manualCode.includes(query);

            return matchesFilter && matchesQuery;
        });

        if (visible.length === 0) {
            body.innerHTML = "";
            empty.hidden = false;
            return;
        }

        empty.hidden = true;
        body.innerHTML = visible.map(item => {
            const manualCode = item.manual_code || item.participant_id || item.id.substring(0, 8).toUpperCase();
            const isDelivered = item.mail_delivered;
            const isSent = item.mail_sent || isDelivered;

            let statusBadge = "";
            if (item._error) {
                statusBadge = `<span class="status-badge status-failed" title="${escapeHtml(item._error)}">⚠️ Failed</span>`;
            } else if (isDelivered) {
                statusBadge = `<span class="status-badge status-delivered">✅ Delivered</span>`;
            } else if (isSent) {
                statusBadge = `<span class="status-badge status-sent">✉️ Sent</span>`;
            } else {
                statusBadge = `<span class="status-badge status-pending">⏳ Pending</span>`;
            }

            const buttonLabel = isSent ? "🔄 Resend" : "✉️ Send Pass";
            const buttonClass = isSent ? "action-button btn-resend" : "action-button btn-send";

            return `
                <tr id="row-${escapeHtml(item.id)}">
                    <td>
                        <span class="manual-id-pill font-monospace">${escapeHtml(manualCode)}</span>
                    </td>
                    <td>
                        <strong class="delegate-name">${escapeHtml(item.name || "Delegate")}</strong>
                    </td>
                    <td class="email-cell font-monospace">
                        ${escapeHtml(item.email || "—")}
                    </td>
                    <td>
                        ${statusBadge}
                    </td>
                    <td class="text-right">
                        <button class="${buttonClass}" data-id="${escapeHtml(item.id)}" ${isProcessingBatch ? "disabled" : ""}>
                            ${buttonLabel}
                        </button>
                    </td>
                </tr>
            `;
        }).join("");

        // Attach event listeners to individual action buttons
        body.querySelectorAll("button[data-id]").forEach(button => {
            button.addEventListener("click", async () => {
                const participant = participants.find(p => p.id === button.dataset.id);
                if (!participant) return;

                const isResend = participant.mail_sent || participant.mail_delivered;
                button.disabled = true;
                const originalHtml = button.innerHTML;
                button.innerHTML = `<span class="spinner-inline"></span> Sending...`;
                showStatus(`Sending email to ${participant.name}...`, "info", false);

                try {
                    delete participant._error;
                    await sendMail(participant, isResend);
                    showStatus(`✅ Mail successfully sent to ${participant.name} (${participant.email})!`, "success");
                    render();
                } catch (error) {
                    participant._error = error.message;
                    showStatus(`❌ Failed to send mail to ${participant.name}: ${error.message}`, "danger", false);
                    render();
                }
            });
        });
    }

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            "\"": "&quot;",
            "'": "&#039;"
        }[char]));
    }

    // Search event
    search.addEventListener("input", render);

    // Filters
    filterButtons.forEach(button => {
        button.addEventListener("click", () => {
            filterButtons.forEach(btn => btn.classList.remove("active"));
            button.classList.add("active");
            activeFilter = button.dataset.filter;
            render();
        });
    });

    // Refresh button
    if (refreshBtn) {
        refreshBtn.addEventListener("click", () => {
            loadParticipants();
            showStatus("Roster refreshed from database.", "info");
        });
    }

    // Send Mail to All / Resend All
    if (sendAllBtn) {
        sendAllBtn.addEventListener("click", async () => {
            if (isProcessingBatch) return;

            const unsent = participants.filter(p => !p.mail_sent && !p.mail_delivered);
            let targetList = [];
            let isResendBatch = false;

            if (unsent.length > 0) {
                targetList = unsent;
            } else {
                const confirmResend = confirm(`All ${participants.length} delegates already received emails. Do you want to resend food passes to ALL ${participants.length} delegates?`);
                if (!confirmResend) return;
                targetList = participants;
                isResendBatch = true;
            }

            if (targetList.length === 0) {
                showStatus("No delegates found to send mail.", "warning");
                return;
            }

            isProcessingBatch = true;
            sendAllBtn.disabled = true;
            if (refreshBtn) refreshBtn.disabled = true;
            progressCard.hidden = false;

            let successCount = 0;
            let failureCount = 0;
            const total = targetList.length;

            for (let i = 0; i < total; i++) {
                const p = targetList[i];
                const currentNum = i + 1;
                const percent = Math.round((currentNum / total) * 100);

                progressTitle.textContent = `Dispatching pass (${currentNum}/${total}): ${p.name || p.email}...`;
                progressCounter.textContent = `${currentNum} / ${total} (${percent}%)`;
                progressFill.style.width = `${percent}%`;

                // Update row status
                const row = document.getElementById(`row-${p.id}`);
                const rowBtn = row ? row.querySelector("button") : null;
                if (rowBtn) {
                    rowBtn.disabled = true;
                    rowBtn.innerHTML = `<span class="spinner-inline"></span>`;
                }

                try {
                    delete p._error;
                    await sendMail(p, isResendBatch || p.mail_sent);
                    successCount++;
                } catch (err) {
                    p._error = err.message;
                    failureCount++;
                }

                // Incremental re-render
                render();
            }

            progressTitle.textContent = `Batch dispatch completed!`;
            progressFill.style.width = "100%";
            setTimeout(() => {
                progressCard.hidden = true;
            }, 3000);

            isProcessingBatch = false;
            sendAllBtn.disabled = false;
            if (refreshBtn) refreshBtn.disabled = false;

            if (failureCount === 0) {
                showStatus(`🎉 All ${successCount} emails were dispatched successfully!`, "success", false);
            } else {
                showStatus(`⚠️ Finished batch: ${successCount} sent successfully, ${failureCount} failed. Click 'Resend' on failed delegates.`, "warning", false);
            }

            render();
        });
    }

    // Initial load
    loadParticipants();
});

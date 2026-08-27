document.addEventListener("DOMContentLoaded", () => {
    const body = document.getElementById("rosterBody");
    const search = document.getElementById("rosterSearch");
    const empty = document.getElementById("emptyState");
    const status = document.getElementById("mailStatus");
    const sendAll = document.getElementById("sendAllButton");
    const filters = [...document.querySelectorAll(".filter-button")];
    let participants = [];
    let filter = "all";

    const csrfToken = document.cookie.split("; ").find(item => item.startsWith("csrftoken="))?.split("=")[1] || "";

    async function loadParticipants() {
        const response = await fetch("/api/mail/participants/", { credentials: "same-origin" });
        if (!response.ok) throw new Error("Could not load participants.");
        participants = await response.json();
        render();
    }

    async function sendMail(participant, resend = false) {
        const action = resend ? "resend" : "send";
        const response = await fetch(`/api/mail/participants/${participant.id}/${action}/`, {
            method: "POST",
            credentials: "same-origin",
            headers: { "X-CSRFToken": decodeURIComponent(csrfToken) }
        });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || "Email could not be sent.");
        const updated = result.participant;
        participants = participants.map(item => item.id === updated.id ? updated : item);
    }

    function render() {
        document.getElementById("totalCount").textContent = participants.length;
        document.getElementById("sentCount").textContent = participants.filter(item => item.mail_delivered).length;
        document.getElementById("notSentCount").textContent = participants.filter(item => !item.mail_delivered).length;
        const query = search.value.trim().toLowerCase();
        const visible = participants.filter(item => {
            const matchesFilter = filter === "all" || (filter === "sent" ? item.mail_delivered : !item.mail_delivered);
            return matchesFilter && `${item.name} ${item.email}`.toLowerCase().includes(query);
        });
        body.innerHTML = visible.map(item => `<tr><td><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.id)}</small></td><td class="email-cell">${escapeHtml(item.email)}</td><td><span class="status ${item.mail_delivered ? "sent" : "not-sent"}">${item.mail_delivered ? "Received" : (item.mail_sent ? "Sent, awaiting delivery" : "Not sent")}</span></td><td><button class="action-button" data-id="${escapeHtml(item.id)}">${item.mail_sent ? "Resend" : "Send mail"}</button></td></tr>`).join("");
        empty.hidden = visible.length !== 0;
        body.querySelectorAll("button[data-id]").forEach(button => button.addEventListener("click", async () => {
            const participant = participants.find(item => item.id === button.dataset.id);
            button.disabled = true;
            status.textContent = "Sending...";
            try { await sendMail(participant, participant.mail_sent); status.textContent = "Mail sent successfully."; render(); }
            catch (error) { status.textContent = error.message; button.disabled = false; }
        }));
    }

    function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[char])); }
    search.addEventListener("input", render);
    filters.forEach(button => button.addEventListener("click", () => { filters.forEach(item => item.classList.remove("active")); button.classList.add("active"); filter = button.dataset.filter; render(); }));
    sendAll.addEventListener("click", async () => { sendAll.disabled = true; const pending = participants.filter(item => !item.mail_sent); for (const participant of pending) { try { await sendMail(participant); } catch (error) { status.textContent = error.message; break; } } status.textContent = status.textContent || `Mail requests sent for ${pending.length} participant(s).`; render(); sendAll.disabled = false; });
    loadParticipants().catch(error => { status.textContent = error.message; });
});

document.addEventListener("DOMContentLoaded", function () {

    /* =====================================================
       CSRF & UTILITY HELPERS
    ===================================================== */

    function getCookie(name) {
        let cookieValue = null;
        if (document.cookie && document.cookie !== "") {
            const cookies = document.cookie.split(";");
            for (let i = 0; i < cookies.length; i++) {
                const cookie = cookies[i].trim();
                if (cookie.substring(0, name.length + 1) === (name + "=")) {
                    cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                    break;
                }
            }
        }
        return cookieValue || "";
    }

    function escapeHtml(str) {
        if (!str) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    /* =====================================================
       AUDIO & HAPTIC FEEDBACK
    ===================================================== */

    function playFeedback(type = "beep") {
        try {
            if ("vibrate" in navigator) {
                navigator.vibrate(type === "success" ? [100, 50, 100] : 80);
            }
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
                const ctx = new AudioCtx();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();

                osc.type = "sine";
                if (type === "success") {
                    osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
                    osc.frequency.exponentialRampToValueAtTime(783.99, ctx.currentTime + 0.15); // G5
                } else if (type === "error") {
                    osc.frequency.setValueAtTime(300, ctx.currentTime);
                    osc.frequency.exponentialRampToValueAtTime(150, ctx.currentTime + 0.2);
                } else {
                    osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 beep
                }

                gain.gain.setValueAtTime(0.12, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);

                osc.connect(gain);
                gain.connect(ctx.destination);

                osc.start();
                osc.stop(ctx.currentTime + 0.2);
            }
        } catch (e) {
            // Audio context restriction before user gesture
        }
    }


    /* =====================================================
       DASHBOARD LIVE ROSTER (SEARCH, FILTER, QUICK CLAIM)
    ===================================================== */

    const tableSearchInput = document.getElementById("tableSearchInput");
    const filterButtons = document.querySelectorAll(".filter-btn");
    const participantRows = document.querySelectorAll(".participant-row");
    const totalParticipantsCount = document.getElementById("totalParticipantsCount");
    const foodClaimedCount = document.getElementById("foodClaimedCount");
    const pendingFoodCount = document.getElementById("pendingFoodCount");

    if (tableSearchInput || filterButtons.length > 0) {
        let currentFilter = "all";
        let searchQuery = "";

        function refreshStatsCounters() {
            if (!totalParticipantsCount || !foodClaimedCount || !pendingFoodCount) return;

            const claimedCount = document.querySelectorAll('.participant-row[data-status="claimed"]').length;
            const totalCount = participantRows.length;
            totalParticipantsCount.textContent = totalCount;
            foodClaimedCount.textContent = claimedCount;
            pendingFoodCount.textContent = totalCount - claimedCount;
        }

        function applyTableFilters() {
            let visibleCount = 0;
            participantRows.forEach(row => {
                const rowStatus = row.getAttribute("data-status");
                const rowText = row.textContent.toLowerCase();

                const matchesStatus = (currentFilter === "all") || (rowStatus === currentFilter);
                const matchesSearch = searchQuery === "" || rowText.includes(searchQuery);

                if (matchesStatus && matchesSearch) {
                    row.style.display = "";
                    visibleCount++;
                } else {
                    row.style.display = "none";
                }
            });

            const emptyRow = document.getElementById("emptyTableRow");
            if (emptyRow && participantRows.length > 0) {
                emptyRow.style.display = (visibleCount === 0) ? "" : "none";
            }
        }

        if (tableSearchInput) {
            tableSearchInput.addEventListener("input", function (e) {
                searchQuery = e.target.value.trim().toLowerCase();
                applyTableFilters();
            });
        }

        filterButtons.forEach(btn => {
            btn.addEventListener("click", function () {
                filterButtons.forEach(b => b.classList.remove("active"));
                this.classList.add("active");
                currentFilter = this.getAttribute("data-filter");
                applyTableFilters();
            });
        });

        // Quick Claim button on dashboard table rows
        document.querySelectorAll(".btn-quick-claim").forEach(btn => {
            btn.addEventListener("click", async function () {
                const token = this.getAttribute("data-token");
                const name = this.getAttribute("data-name");

                if (!confirm(`Confirm meal distribution for ${name}?`)) {
                    return;
                }

                btn.disabled = true;
                btn.textContent = "Processing...";

                try {
                    const response = await fetch("/api/claim/", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "X-CSRFToken": getCookie("csrftoken")
                        },
                        body: JSON.stringify({ token: token })
                    });
                    const result = await response.json();

                    if (response.ok && result.success) {
                        playFeedback("success");
                        const row = btn.closest("tr");
                        if (row) {
                            row.setAttribute("data-status", "claimed");
                            const statusTd = row.children[4];
                            const timeTd = row.children[5];
                            const actionTd = row.children[6];

                            if (statusTd) statusTd.innerHTML = '<span class="badge badge-claimed">Claimed</span>';
                            if (timeTd) timeTd.textContent = result.participant.claimed_at || "Just now";
                            if (actionTd) actionTd.innerHTML = '<span class="text-success small fw-semibold">✓ Served</span>';
                        }
                        // Refresh stats in dashboard cards
                        refreshStatsCounters();
                    } else {
                        playFeedback("error");
                        alert(result.message || result.error || "Failed to claim food.");
                        btn.disabled = false;
                        btn.textContent = "Distribute";
                    }
                } catch (err) {
                    console.error("Quick claim error:", err);
                    alert("Network error. Could not connect to server.");
                    btn.disabled = false;
                    btn.textContent = "Distribute";
                }
            });
        });
    }

    /* =====================================================
       QR SCANNER STATION LOGIC
    ===================================================== */

    const qrInput = document.getElementById("qrCode");
    const verifyButton = document.getElementById("verifyQR");
    const participantCard = document.getElementById("participantCard");
    const qrReader = document.getElementById("qr-reader");
    const scannerStatus = document.getElementById("scannerStatus");
    const btnSwitchCamera = document.getElementById("btnSwitchCamera");
    const btnRestartCamera = document.getElementById("btnRestartCamera");

    // Only run scanner engine on scanner page
    if (!qrReader && !participantCard) {
        return;
    }

    function renderEmptyState() {
        if (!participantCard) return;
        participantCard.innerHTML = `
            <div class="participant-empty text-center py-5">
                <div class="empty-icon mb-3">👤</div>
                <h4 class="text-white fw-bold">Awaiting QR Scan</h4>
                <p class="text-secondary mb-0">
                    Scan a QR badge using the camera or enter the participant ID manually to verify eligibility.
                </p>
            </div>
        `;
    }

    function renderParticipantDetails(participant, isValid, message) {
        if (!participantCard) return;

        const isClaimed = participant.food_claimed;
        const food = participant.food || "Veg";
        const isVeg = food.toLowerCase() === "veg";
        const badgeClass = isVeg ? "badge-veg" : "badge-nonveg";
        const foodIcon = isVeg ? "🥗" : "🍗";

        participantCard.innerHTML = `
            <div class="participant-details-box w-100">
                <div class="d-flex justify-content-between align-items-start gap-2 mb-3 pb-3 border-bottom border-secondary-subtle">
                    <div>
                        <span class="text-secondary small font-monospace d-block mb-1">${escapeHtml(participant.id)}</span>
                        <h2 class="participant-name mb-0">${escapeHtml(participant.name)}</h2>
                    </div>
                    <span class="badge ${badgeClass} fs-6 px-3 py-2">
                        ${foodIcon} ${escapeHtml(food)}
                    </span>
                </div>

                <div class="details-grid mb-4">
                    <div class="detail-item">
                        <span class="detail-label">College / Institution</span>
                        <span class="detail-val">${escapeHtml(participant.college || "Symposium Delegate")}</span>
                    </div>

                    ${participant.email ? `
                        <div class="detail-item">
                            <span class="detail-label">Email</span>
                            <span class="detail-val text-truncate">${escapeHtml(participant.email)}</span>
                        </div>
                    ` : ''}

                    <div class="detail-item">
                        <span class="detail-label">Meal Preference</span>
                        <span class="detail-val fw-bold ${isVeg ? 'text-success' : 'text-warning'}">${escapeHtml(food)}</span>
                    </div>

                    <div class="detail-item">
                        <span class="detail-label">Status</span>
                        <span class="detail-val">
                            ${isClaimed ?
                                '<span class="text-danger fw-bold">❌ Already Claimed</span>' :
                                '<span class="text-success fw-bold">🟢 Eligible for Meal</span>'}
                        </span>
                    </div>
                </div>

                ${isClaimed ? `
                    <div class="status-banner banner-danger mb-4 text-center">
                        <div class="banner-title">⚠️ Meal Already Distributed!</div>
                        <div class="banner-sub">Claimed on: <strong>${escapeHtml(participant.claimed_at || "Earlier")}</strong></div>
                    </div>

                    <button class="btn btn-secondary-custom w-100 py-3" disabled>
                        ❌ Meal Already Distributed
                    </button>

                    <button class="btn btn-outline-light w-100 mt-3" id="btnScanNext">
                        📷 Scan Next Participant
                    </button>
                ` : `
                    <div class="status-banner banner-success mb-4 text-center">
                        <div class="banner-title">✅ Verified Delegate</div>
                        <div class="banner-sub">Eligible for <strong>${escapeHtml(food)}</strong> Meal Pack</div>
                    </div>

                    <button class="btn btn-claim-action w-100 py-3 mb-2" id="btnClaimFood">
                        🍽️ Distribute Food & Mark Claimed
                    </button>

                    <button class="btn btn-outline-secondary w-100" id="btnCancelScan">
                        Cancel / Scan Next
                    </button>
                `}
            </div>
        `;

        // Wire event handlers
        const claimBtn = document.getElementById("btnClaimFood");
        if (claimBtn) {
            claimBtn.addEventListener("click", function () {
                claimFood(participant.qr_token || participant.id);
            });
        }

        const scanNextBtn = document.getElementById("btnScanNext");
        if (scanNextBtn) {
            scanNextBtn.addEventListener("click", resetAndScanNext);
        }

        const cancelScanBtn = document.getElementById("btnCancelScan");
        if (cancelScanBtn) {
            cancelScanBtn.addEventListener("click", resetAndScanNext);
        }
    }

    function renderClaimSuccess(participant) {
        if (!participantCard) return;

        playFeedback("success");

        const food = participant.food || "Meal";
        const isVeg = food.toLowerCase() === "veg";

        participantCard.innerHTML = `
            <div class="claim-success-card text-center w-100 py-4">
                <div class="success-animation-icon mb-3">✓</div>
                <h3 class="text-white fw-bold mb-1">Food Claimed Successfully!</h3>
                <p class="text-secondary mb-4">Meal packet has been handed over to delegate.</p>

                <div class="success-summary-box mb-4">
                    <div class="d-flex justify-content-between py-2 border-bottom border-secondary-subtle">
                        <span class="text-secondary">Delegate:</span>
                        <span class="text-white fw-bold">${escapeHtml(participant.name)} (${escapeHtml(participant.id)})</span>
                    </div>
                    <div class="d-flex justify-content-between py-2 border-bottom border-secondary-subtle">
                        <span class="text-secondary">Meal Type:</span>
                        <span class="fw-bold ${isVeg ? 'text-success' : 'text-warning'}">${isVeg ? '🥗 Veg' : '🍗 Non-Veg'}</span>
                    </div>
                    <div class="d-flex justify-content-between py-2">
                        <span class="text-secondary">Claimed At:</span>
                        <span class="text-white">${escapeHtml(participant.claimed_at || "Just now")}</span>
                    </div>
                </div>

                <button class="btn btn-primary-custom w-100 py-3" id="btnScanNext">
                    📷 Scan Next Participant
                </button>
            </div>
        `;

        const scanNextBtn = document.getElementById("btnScanNext");
        if (scanNextBtn) {
            scanNextBtn.addEventListener("click", resetAndScanNext);
        }
    }


    /* =====================================================
       API CALLS: VERIFY & CLAIM
    ===================================================== */

    async function verifyQRCode(rawCode) {
        const token = rawCode ? rawCode.trim() : (qrInput ? qrInput.value.trim() : "");

        if (!token) {
            alert("Please scan or enter a valid QR code.");
            return;
        }

        if (qrInput) {
            qrInput.value = token;
        }

        updateScannerStatus("🔎 Verifying participant ID...", "scanning");

        try {
            const response = await fetch("/api/verify/", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRFToken": getCookie("csrftoken")
                },
                body: JSON.stringify({ token: token })
            });

            const result = await response.json();

            if (!response.ok) {
                playFeedback("error");
                updateScannerStatus(result.error || "Participant not found", "error");
                renderErrorState(result.error || "Invalid QR Code or Participant Not Found.");
                return;
            }

            if (result.valid) {
                playFeedback("beep");
                updateScannerStatus("✅ Verified! Ready to serve food.", "active");
                renderParticipantDetails(result.participant, result.valid, result.message);
                return;
            } else {
                playFeedback("error");
                updateScannerStatus("⚠️ Food already claimed for this participant", "error");
            }

            renderParticipantDetails(result.participant, result.valid, result.message);

        } catch (err) {
            console.error("Verification error:", err);
            playFeedback("error");
            updateScannerStatus("Connection error with server", "error");
            alert("Could not connect to server to verify participant.");
        }
    }

    async function claimFood(token) {
        if (!token) {
            alert("Token is missing for this claim request.");
            return;
        }

        const claimBtn = document.getElementById("btnClaimFood");
        if (claimBtn) {
            claimBtn.disabled = true;
            claimBtn.textContent = "Recording Meal Distribution...";
        }

        try {
            const response = await fetch("/api/claim/", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRFToken": getCookie("csrftoken")
                },
                body: JSON.stringify({ token: token })
            });

            const result = await response.json();

            if (response.ok && result.success) {
                renderClaimSuccess(result.participant);
                updateScannerStatus("🎉 Meal distributed successfully!", "active");
            } else {
                playFeedback("error");
                alert(result.message || result.error || "Could not complete food claim.");
                if (claimBtn) {
                    claimBtn.disabled = false;
                    claimBtn.textContent = "🍽️ Distribute Food & Mark Claimed";
                }
            }
        } catch (err) {
            console.error("Claim error:", err);
            alert("Network error while claiming food.");
            if (claimBtn) {
                claimBtn.disabled = false;
                claimBtn.textContent = "🍽️ Distribute Food & Mark Claimed";
            }
        }
    }

    function renderErrorState(errorMessage) {
        if (!participantCard) return;
        participantCard.innerHTML = `
            <div class="participant-empty text-center py-5">
                <div class="empty-icon mb-3">❌</div>
                <h4 class="text-danger fw-bold">Verification Failed</h4>
                <p class="text-secondary mb-4">${escapeHtml(errorMessage)}</p>
                <button class="btn btn-outline-light btn-sm" id="btnScanNext">
                    Try Another Code
                </button>
            </div>
        `;
        const scanNextBtn = document.getElementById("btnScanNext");
        if (scanNextBtn) {
            scanNextBtn.addEventListener("click", resetAndScanNext);
        }
    }


    /* =====================================================
       CAMERA SCANNER ENGINE (HTML5-QRCODE)
    ===================================================== */

    let html5QrCode = null;
    let isScanning = false;
    let isProcessing = false;
    let currentFacingMode = "environment";
    let availableCameras = [];
    let currentCameraIndex = 0;

    function updateScannerStatus(message, state = "scanning") {
        if (!scannerStatus) return;
        scannerStatus.innerHTML = `<span class="scanner-status-badge ${state}">${message}</span>`;
    }

    function initScanner() {
        if (!qrReader || typeof Html5Qrcode === "undefined") {
            updateScannerStatus("❌ Camera scanner library unavailable. Use manual input.", "error");
            return;
        }

        if (!html5QrCode) {
            html5QrCode = new Html5Qrcode("qr-reader");
        }

        startCamera();
    }

    function startCamera() {
        if (isScanning || !html5QrCode) return;

        updateScannerStatus("📷 Starting camera viewfinder...", "scanning");
        isProcessing = false;

        const scannerConfig = {
            fps: 15,
            qrbox: function (w, h) {
                const minEdge = Math.min(w, h);
                const size = Math.floor(minEdge * 0.72);
                return { width: Math.max(size, 220), height: Math.max(size, 220) };
            },
            aspectRatio: 1.0
        };

        const cameraConfig = (availableCameras.length > 0 && availableCameras[currentCameraIndex])
            ? availableCameras[currentCameraIndex].id
            : { facingMode: currentFacingMode };

        html5QrCode.start(
            cameraConfig,
            scannerConfig,
            onScanSuccess,
            function () {} // silent frame scanning failures
        ).then(function () {
            isScanning = true;
            qrReader.classList.add("scan-pulse");
            updateScannerStatus("📷 Camera Active — Point at Delegate QR Code", "active");

            // Cache camera list for flip toggle
            if (availableCameras.length === 0) {
                Html5Qrcode.getCameras().then(devices => {
                    if (devices && devices.length > 0) availableCameras = devices;
                }).catch(() => {});
            }
        }).catch(function (err) {
            console.warn("Camera start failed, attempting fallback:", err);
            Html5Qrcode.getCameras().then(devices => {
                if (!devices || devices.length === 0) {
                    updateScannerStatus("❌ No camera detected. Enter ID manually below.", "error");
                    return;
                }
                availableCameras = devices;
                html5QrCode.start(
                    devices[0].id,
                    scannerConfig,
                    onScanSuccess,
                    function () {}
                ).then(() => {
                    isScanning = true;
                    qrReader.classList.add("scan-pulse");
                    updateScannerStatus("📷 Camera Active — Point at Delegate QR Code", "active");
                }).catch(finalErr => {
                    updateScannerStatus("❌ Camera permission denied. Please allow access or use manual input.", "error");
                });
            }).catch(() => {
                updateScannerStatus("❌ Camera access blocked. Use manual QR input below.", "error");
            });
        });
    }

    function stopCamera() {
        if (html5QrCode && isScanning) {
            qrReader.classList.remove("scan-pulse");
            return html5QrCode.stop().then(() => {
                isScanning = false;
            }).catch(err => {
                console.warn("Stop camera error:", err);
                isScanning = false;
            });
        }
        return Promise.resolve();
    }

    function onScanSuccess(decodedText) {
        if (isProcessing) return;
        isProcessing = true;

        playFeedback("beep");

        if (qrInput) {
            qrInput.value = decodedText;
        }

        updateScannerStatus("⚡ QR Detected! Validating...", "active");

        stopCamera().then(() => {
            verifyQRCode(decodedText);
        });
    }

    function switchCamera() {
        if (availableCameras.length > 1) {
            currentCameraIndex = (currentCameraIndex + 1) % availableCameras.length;
        } else {
            currentFacingMode = currentFacingMode === "environment" ? "user" : "environment";
        }

        stopCamera().then(() => {
            setTimeout(startCamera, 250);
        });
    }

    function resetAndScanNext() {
        renderEmptyState();
        if (qrInput) {
            qrInput.value = "";
            qrInput.focus();
        }
        isProcessing = false;
        stopCamera().then(() => {
            startCamera();
        });
    }

    // Camera control buttons
    if (btnSwitchCamera) {
        btnSwitchCamera.addEventListener("click", switchCamera);
    }

    if (btnRestartCamera) {
        btnRestartCamera.addEventListener("click", function () {
            stopCamera().then(() => {
                startCamera();
            });
        });
    }

    if (verifyButton) {
        verifyButton.addEventListener("click", function () {
            stopCamera().then(() => {
                verifyQRCode();
            });
        });
    }

    if (qrInput) {
        qrInput.addEventListener("keydown", function (e) {
            if (e.key === "Enter") {
                e.preventDefault();
                stopCamera().then(() => {
                    verifyQRCode();
                });
            }
        });
    }

    // Auto initialize scanner on page load
    initScanner();

});
document.addEventListener("DOMContentLoaded", function () {

    /* =====================================================
       LOGIN HANDLER
    ===================================================== */

    const loginForm = document.getElementById("loginForm");

    if (loginForm) {
        // If form has no action attribute or method POST, handle via JS navigation
        if (!loginForm.getAttribute("action")) {
            loginForm.addEventListener("submit", function (event) {
                event.preventDefault();

                const username = document.getElementById("username").value.trim();
                const password = document.getElementById("password").value.trim();

                if (username === "" || password === "") {
                    alert("Please enter your username and password.");
                    return;
                }

                window.location.href = "/dashboard/";
            });
        }
    }


    /* =====================================================
       PARTICIPANT DATABASE & LOCALSTORAGE PERSISTENCE
    ===================================================== */

    const STORAGE_KEY = "symposium_food_participants";

    const defaultParticipants = [
        {
            id: "SYM-2024-001",
            name: "Rahul Sharma",
            college: "Dept of Computer Science, CEG",
            food: "Veg",
            status: "Not Claimed",
            claimedAt: null
        },
        {
            id: "SYM-2024-002",
            name: "Ananya Iyer",
            college: "School of Architecture, Anna Univ",
            food: "Non-Veg",
            status: "Not Claimed",
            claimedAt: null
        },
        {
            id: "SYM-2024-003",
            name: "Karthik Raja",
            college: "Dept of Information Tech, MIT",
            food: "Veg",
            status: "Claimed",
            claimedAt: "12:45 PM"
        },
        {
            id: "SYM-2024-004",
            name: "Sneha Patel",
            college: "Dept of EEE, PSG Tech",
            food: "Non-Veg",
            status: "Not Claimed",
            claimedAt: null
        },
        {
            id: "SYM-2024-005",
            name: "Vikas Kumar",
            college: "Dept of Mechanical, SSN",
            food: "Veg",
            status: "Not Claimed",
            claimedAt: null
        }
    ];

    function getParticipants() {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            if (data) {
                return JSON.parse(data);
            }
        } catch (e) {
            console.error("Error reading localStorage:", e);
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultParticipants));
        return defaultParticipants;
    }

    function saveParticipants(participants) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(participants));
        } catch (e) {
            console.error("Error saving to localStorage:", e);
        }
    }

    function findOrGenerateParticipant(rawCode) {
        const trimmed = rawCode.trim();
        const participants = getParticipants();

        // 1. Try parsing JSON in QR code if applicable
        try {
            if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
                const parsed = JSON.parse(trimmed);
                const id = parsed.id || parsed.participantId || "SYM-" + Math.floor(1000 + Math.random() * 9000);
                const existing = participants.find(p => p.id.toUpperCase() === id.toUpperCase());
                if (existing) {
                    return existing;
                }
                const newParticipant = {
                    id: id,
                    name: parsed.name || "Participant " + id,
                    college: parsed.college || parsed.institution || "Registered Delegate",
                    food: parsed.food || "Veg",
                    status: parsed.status || "Not Claimed",
                    claimedAt: parsed.claimedAt || null
                };
                participants.push(newParticipant);
                saveParticipants(participants);
                return newParticipant;
            }
        } catch (err) {
            console.log("Not JSON format, resolving as ID:", trimmed);
        }

        // 2. Lookup existing participant by ID or Name
        const found = participants.find(
            p => p.id.toUpperCase() === trimmed.toUpperCase() ||
                 p.name.toUpperCase() === trimmed.toUpperCase()
        );

        if (found) {
            return found;
        }

        // 3. Dynamic Fallback for any scanned QR code / Custom ID
        const cleanId = trimmed.toUpperCase().startsWith("SYM-") ? trimmed.toUpperCase() : `SYM-${trimmed.toUpperCase()}`;
        const newRecord = {
            id: cleanId,
            name: `Participant (${trimmed})`,
            college: "Symposium Delegate",
            food: "Veg",
            status: "Not Claimed",
            claimedAt: null
        };
        participants.push(newRecord);
        saveParticipants(participants);
        return newRecord;
    }


    /* =====================================================
       AUDIO & HAPTIC FEEDBACK
    ===================================================== */

    function playFeedback(type = "beep") {
        try {
            if ("vibrate" in navigator) {
                navigator.vibrate(type === "success" ? [100, 50, 100] : 120);
            }
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
                const ctx = new AudioCtx();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();

                osc.type = "sine";
                if (type === "success") {
                    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
                    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5
                } else {
                    osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
                }

                gain.gain.setValueAtTime(0.15, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);

                osc.connect(gain);
                gain.connect(ctx.destination);

                osc.start();
                osc.stop(ctx.currentTime + 0.2);
            }
        } catch (e) {
            // Audio context not allowed before interaction
        }
    }


    /* =====================================================
       QR SCANNER DOM ELEMENTS
    ===================================================== */

    const qrInput = document.getElementById("qrCode");
    const verifyButton = document.getElementById("verifyQR");
    const participantCard = document.getElementById("participantCard");
    const qrReader = document.getElementById("qr-reader");
    const scannerStatus = document.getElementById("scannerStatus");
    const btnSwitchCamera = document.getElementById("btnSwitchCamera");
    const btnRestartCamera = document.getElementById("btnRestartCamera");

    // Only proceed with scanner logic if scanner elements exist on this page
    if (!qrReader && !participantCard) {
        return;
    }


    /* =====================================================
       RENDER VIEWS
    ===================================================== */

    function renderEmptyState() {
        if (!participantCard) return;
        participantCard.innerHTML = `
            <div class="participant-empty text-center">
                <div class="empty-icon">👤</div>
                <h4>No Participant Selected</h4>
                <p>Scan or enter a QR code to view participant details.</p>
            </div>
        `;
    }

    function renderParticipantDetails(participant) {
        if (!participantCard) return;

        const isClaimed = participant.food_claimed || participant.status === "Claimed";
        const food = participant.food || "Meal";
        const foodBadgeClass = food.toLowerCase().includes("non") ? "bg-warning text-dark" : "bg-success";

        participantCard.innerHTML = `
            <div class="participant-details w-100">
                <div class="d-flex justify-content-between align-items-center mb-3">
                    <h3 class="mb-0 fw-bold">${escapeHtml(participant.name)}</h3>
                    <span class="badge ${foodBadgeClass} px-3 py-2 fs-6">${escapeHtml(food)}</span>
                </div>

                <div class="detail-row">
                    <span>Participant ID:</span>
                    <strong>${escapeHtml(participant.id)}</strong>
                </div>

                <div class="detail-row">
                    <span>College / Institution:</span>
                        <strong>${escapeHtml(participant.email || "Registered participant")}</strong>
                </div>

                <div class="detail-row">
                    <span>Food Preference:</span>
                    <strong>${escapeHtml(food)}</strong>
                </div>

                ${isClaimed ? `
                    <div class="detail-row">
                        <span>Distribution Time:</span>
                        <strong>${escapeHtml(participant.claimed_at || participant.claimedAt || "Earlier")}</strong>
                    </div>

                    <div class="food-status already-claimed text-center my-4">
                        ⚠️ Food Already Claimed!
                    </div>

                    <button class="btn btn-already-claimed w-100" disabled>
                        ❌ Meal Already Distributed
                    </button>

                    <button class="btn btn-outline-light w-100 mt-3" id="btnScanNext">
                        📷 Scan Next Participant
                    </button>
                ` : `
                    <div class="food-status not-claimed text-center my-4">
                        🟢 Food Not Claimed (Eligible for Meal)
                    </div>

                    <button class="btn btn-claim w-100" id="btnClaimFood" data-id="${escapeHtml(participant.id)}">
                        🍽️ Claim Food
                    </button>

                    <button class="btn btn-outline-secondary w-100 mt-2" id="btnCancelScan">
                        Scan Next
                    </button>
                `}
            </div>
        `;

        // Attach action handlers
        const claimBtn = document.getElementById("btnClaimFood");
        if (claimBtn) {
            claimBtn.addEventListener("click", function () {
                claimFood(participant.qr_token);
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

        participantCard.innerHTML = `
            <div class="claim-success text-center w-100 py-3">
                <div class="success-icon">✓</div>
                <h3 class="mb-2">Food Claimed Successfully!</h3>
                <p>
                    Meal distributed to <strong>${escapeHtml(participant.name)}</strong> (${escapeHtml(participant.id)})
                </p>
                <div class="text-secondary small mb-4">
                    Meal Type: <strong class="text-white">${escapeHtml(participant.food)}</strong> | Time: <strong class="text-white">${escapeHtml(participant.claimedAt)}</strong>
                </div>

                <button class="btn btn-scan w-100" id="btnScanNext">
                    📷 Scan Next Participant
                </button>
            </div>
        `;

        const scanNextBtn = document.getElementById("btnScanNext");
        if (scanNextBtn) {
            scanNextBtn.addEventListener("click", resetAndScanNext);
        }
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
       FOOD CLAIMING LOGIC
    ===================================================== */

    function getCookie(name) {
        const cookie = document.cookie.split("; ").find(item => item.startsWith(`${name}=`));
        return cookie ? decodeURIComponent(cookie.split("=")[1]) : "";
    }

    async function claimFood(qrToken) {
        if (!qrToken) {
            alert("QR token is missing from this participant.");
            return;
        }

        try {
            const response = await fetch("/api/claim/", {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-CSRFToken": getCookie("csrftoken") },
                body: JSON.stringify({ token: qrToken })
            });
            const result = await response.json();
            if (!response.ok || !result.success) {
                alert(result.message || result.error || "Unable to claim food.");
                return;
            }
            renderClaimSuccess({
                name: result.participant.name,
                id: result.participant.id,
                food: "Meal",
                claimed_at: result.participant.claimed_at
            });
        } catch (error) {
            console.error("Claim request failed:", error);
            alert("Could not connect to the server.");
        }
    }


    /* =====================================================
       VERIFY QR CODE (SCAN OR MANUAL INPUT)
    ===================================================== */

    function verifyQRCode(code) {
        const qrValue = code ? code.trim() : (qrInput ? qrInput.value.trim() : "");

        if (qrValue === "") {
            alert("Please scan or enter a QR code.");
            return;
        }

        if (qrInput) {
            qrInput.value = qrValue;
        }

        updateScannerStatus("Processing QR code...", "scanning");

        fetch("/api/verify/", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-CSRFToken": getCookie("csrftoken") },
            body: JSON.stringify({ token: qrValue })
        })
            .then(response => response.json().then(result => ({ response, result })))
            .then(({ response, result }) => {
                if (!response.ok && response.status !== 200) {
                    throw new Error(result.message || result.error || "Invalid QR code");
                }
                const participant = {
                    ...result.participant,
                    qr_token: qrValue,
                    food_claimed: !result.valid,
                    claimed_at: result.claimed_at
                };
                renderParticipantDetails(participant);
                updateScannerStatus(
                    result.valid ? "✓ QR verified — Ready to claim food" : "⚠️ Food already claimed for this participant",
                    result.valid ? "active" : "error"
                );
            })
            .catch(error => {
                console.error("Verification request failed:", error);
                updateScannerStatus(error.message, "error");
                alert(error.message);
            });
    }

    if (verifyButton) {
        verifyButton.addEventListener("click", function () {
            verifyQRCode();
        });
    }

    if (qrInput) {
        qrInput.addEventListener("keydown", function (event) {
            if (event.key === "Enter") {
                event.preventDefault();
                verifyQRCode();
            }
        });
    }


    /* =====================================================
       CAMERA SCANNER ENGINE (HTML5-QRCODE)
    ===================================================== */

    let html5QrCode = null;
    let isScanning = false;
    let isProcessingScan = false;
    let currentFacingMode = "environment"; // Prefer rear camera on mobile
    let availableCameras = [];
    let currentCameraIndex = 0;

    function updateScannerStatus(message, state = "scanning") {
        if (!scannerStatus) return;
        scannerStatus.innerHTML = `<span class="scanner-status-badge ${state}">${message}</span>`;
    }

    function initScanner() {
        if (!qrReader || typeof Html5Qrcode === "undefined") {
            console.error("Html5Qrcode library not loaded or qr-reader element missing.");
            updateScannerStatus("❌ QR Scanner library unavailable.", "error");
            return;
        }

        if (!html5QrCode) {
            html5QrCode = new Html5Qrcode("qr-reader");
        }

        startCamera();
    }

    function startCamera() {
        if (isScanning || !html5QrCode) return;

        updateScannerStatus("📷 Starting camera...", "scanning");
        isProcessingScan = false;

        const scannerConfig = {
            fps: 10,
            qrbox: function (viewfinderWidth, viewfinderHeight) {
                const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
                const size = Math.floor(minEdge * 0.75);
                return { width: Math.max(size, 200), height: Math.max(size, 200) };
            },
            aspectRatio: 1.0
        };

        // Try starting with facingMode first (best for mobile rear camera)
        const cameraConfig = availableCameras.length > 0 && availableCameras[currentCameraIndex]
            ? availableCameras[currentCameraIndex].id
            : { facingMode: currentFacingMode };

        html5QrCode.start(
            cameraConfig,
            scannerConfig,
            onScanSuccess,
            onScanFailure
        ).then(function () {
            isScanning = true;
            qrReader.classList.add("scan-pulse");
            updateScannerStatus("📷 Scanner active — Point at a QR code", "active");

            // Cache available camera list for switching
            if (availableCameras.length === 0) {
                Html5Qrcode.getCameras().then(function (devices) {
                    if (devices && devices.length > 0) {
                        availableCameras = devices;
                    }
                }).catch(function () {});
            }
        }).catch(function (error) {
            console.warn("First camera start attempt failed, trying fallback:", error);
            // Fallback to getCameras enumeration
            Html5Qrcode.getCameras().then(function (devices) {
                if (!devices || devices.length === 0) {
                    updateScannerStatus("❌ No camera found. Use manual input.", "error");
                    return;
                }
                availableCameras = devices;
                const fallbackId = devices[0].id;
                html5QrCode.start(
                    fallbackId,
                    scannerConfig,
                    onScanSuccess,
                    onScanFailure
                ).then(function () {
                    isScanning = true;
                    qrReader.classList.add("scan-pulse");
                    updateScannerStatus("📷 Scanner active — Point at a QR code", "active");
                }).catch(function (finalErr) {
                    console.error("Camera access failed:", finalErr);
                    updateScannerStatus("❌ Camera permission denied. Please allow access or use manual input.", "error");
                });
            }).catch(function (err) {
                console.error("Camera list lookup failed:", err);
                updateScannerStatus("❌ Camera access blocked. Use manual QR input below.", "error");
            });
        });
    }

    function stopCamera() {
        if (html5QrCode && isScanning) {
            qrReader.classList.remove("scan-pulse");
            return html5QrCode.stop().then(function () {
                isScanning = false;
            }).catch(function (err) {
                console.warn("Error stopping scanner:", err);
                isScanning = false;
            });
        }
        return Promise.resolve();
    }

    function onScanSuccess(decodedText) {
        if (isProcessingScan) return;
        isProcessingScan = true;

        playFeedback("beep");

        if (qrInput) {
            qrInput.value = decodedText;
        }

        updateScannerStatus("✓ QR Code Detected! Verifying...", "active");

        stopCamera().then(function () {
            verifyQRCode(decodedText);
        });
    }

    function onScanFailure(error) {
        // Continuous search frame error - no action needed
    }

    function switchCamera() {
        if (availableCameras.length > 1) {
            currentCameraIndex = (currentCameraIndex + 1) % availableCameras.length;
        } else {
            currentFacingMode = currentFacingMode === "environment" ? "user" : "environment";
        }

        stopCamera().then(function () {
            setTimeout(startCamera, 200);
        });
    }

    function resetAndScanNext() {
        renderEmptyState();
        if (qrInput) {
            qrInput.value = "";
            qrInput.focus();
        }
        isProcessingScan = false;
        stopCamera().then(function () {
            startCamera();
        });
    }

    // Attach camera control buttons
    if (btnSwitchCamera) {
        btnSwitchCamera.addEventListener("click", switchCamera);
    }

    if (btnRestartCamera) {
        btnRestartCamera.addEventListener("click", function () {
            stopCamera().then(function () {
                startCamera();
            });
        });
    }

    // Start scanner automatically on page load
    initScanner();

});
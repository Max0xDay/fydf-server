const CHUNK_SIZE = 5 * 1024 * 1024;
const MAX_CONCURRENT_UPLOADS = 3;
const MAX_CONCURRENT_CHUNKS_PER_FILE = 4;
const LATENCY_CHECK_INTERVAL = 10000;
const STATS_UPDATE_INTERVAL = 1000;

const fileInput = document.getElementById('fileInput');
const uploadArea = document.getElementById('uploadArea');
const filesList = document.getElementById('filesList');
const currentUserSpan = document.getElementById('currentUser');
const logoutBtn = document.getElementById('logoutBtn');
const uploadProgress = document.getElementById('uploadProgress');

const _currentUser = null;
const uploadQueue = [];
let activeUploads = 0;
const activeUploadSessions = new Map();
const uploadTasks = [];
const networkStats = {
    latency: 0,
    bandwidth: 0,
    uploadSpeed: 0,
    dataSent: 0,
    dataReceived: 0,
    connectionQuality: 'unknown'
};
const transferMetrics = new Map();

const uploadSpeedStats = {
    averageSpeed: 0,
    speedHistory: [],
    activeSessions: 0
};

let speedChart = null;

document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    setupEventListeners();
    checkForIncompleteUploads();
    initializeNetworkMonitoring();
    initializeUploadSpeedMonitoring();
    
    globalThis.promptForResumeFile = promptForResumeFile;
    globalThis.discardIncompleteUpload = discardIncompleteUpload;
    globalThis.downloadFile = downloadFile;
    globalThis.deleteFile = deleteFile;
});

function initializeNetworkMonitoring() {
    startLatencyMonitoring();
    startBandwidthTesting();
    startStatsUpdates();
    updateNetworkDisplay();
}

async function measureBandwidth() {
    try {
        const testSize = 1024 * 1024;
        const testData = new Uint8Array(testSize);
        
        const measurements = [];
        for (let i = 0; i < 3; i++) {
            const startTime = performance.now();
            const response = await fetch('/api/ping', {
                method: 'POST',
                body: testData,
                cache: 'no-cache'
            });
            
            if (response.ok) {
                const endTime = performance.now();
                const duration = (endTime - startTime) / 1000;
                const speedBps = testSize / duration;
                const speedMbps = (speedBps * 8) / (1024 * 1024);
                measurements.push(speedMbps);
            }
            
            if (i < 2) await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        if (measurements.length > 0) {
            networkStats.bandwidth = Math.max(...measurements);
            networkStats.dataReceived += testSize * measurements.length;
            networkStats.dataSent += testSize * measurements.length;
        }
    } catch {
        networkStats.bandwidth = 1000;
    }
}

function startBandwidthTesting() {
    measureBandwidth();
    setInterval(measureBandwidth, 30000);
}

async function measureLatency() {
    const startTime = performance.now();
    try {
        await fetch('/api/ping', { 
            method: 'HEAD',
            cache: 'no-cache'
        });
        const latency = performance.now() - startTime;
        networkStats.latency = Math.round(latency);
        return latency;
    } catch {
        networkStats.latency = 0;
        return 0;
    }
}

function startLatencyMonitoring() {
    measureLatency();
    setInterval(measureLatency, LATENCY_CHECK_INTERVAL);
}

function startStatsUpdates() {
    setInterval(updateNetworkDisplay, STATS_UPDATE_INTERVAL);
}

function updateNetworkDisplay() {
    document.getElementById('connectionQuality').textContent = getConnectionQuality();
    document.getElementById('latency').textContent = `${networkStats.latency} ms`;
    
    const theoreticalMaxMBps = networkStats.bandwidth > 0 ? 
        (networkStats.bandwidth * 1024 * 1024) / (8 * 1024 * 1024) : 0;
    document.getElementById('bandwidthTest').textContent = 
        `${networkStats.bandwidth.toFixed(1)} Mbps (max ${theoreticalMaxMBps.toFixed(0)} MB/s)`;
    
    document.getElementById('uploadSpeed').textContent = `${networkStats.uploadSpeed.toFixed(1)} MB/s`;
    document.getElementById('dataSent').textContent = formatFileSize(networkStats.dataSent);
    document.getElementById('dataReceived').textContent = formatFileSize(networkStats.dataReceived);
    
    const statusElement = document.getElementById('connectionStatus');
    const indicator = statusElement.querySelector('.status-indicator');
    const statusText = statusElement.querySelector('span');
    
    let status = 'poor';
    let statusMessage = 'Poor Connection';
    
    if (networkStats.latency > 0 && networkStats.latency < 50 && networkStats.bandwidth > 10) {
        status = 'excellent';
        statusMessage = 'Excellent Connection';
    } else if (networkStats.latency < 150 && networkStats.bandwidth > 1) {
        status = 'good';
        statusMessage = 'Good Connection';
    }
    
    indicator.className = `status-indicator ${status}`;
    statusText.textContent = statusMessage;
}

function getConnectionQuality() {
    if (networkStats.latency === 0) return 'Testing...';
    
    const latencyScore = networkStats.latency < 50 ? 3 : networkStats.latency < 150 ? 2 : 1;
    const bandwidthScore = networkStats.bandwidth > 10 ? 3 : networkStats.bandwidth > 1 ? 2 : 1;
    const totalScore = (latencyScore + bandwidthScore) / 2;
    
    if (totalScore >= 2.5) return 'Excellent';
    if (totalScore >= 2) return 'Good';
    if (totalScore >= 1.5) return 'Fair';
    return 'Poor';
}

function calculateTransferSpeed(filename, bytesTransferred, _timeElapsed) {
    if (!transferMetrics.has(filename)) {
        transferMetrics.set(filename, {
            startTime: Date.now(),
            lastUpdate: Date.now(),
            totalBytes: 0,
            measurements: [],
            lastMeasurementTime: Date.now()
        });
    }
    
    const metrics = transferMetrics.get(filename);
    const now = Date.now();
    const totalElapsedTime = (now - metrics.startTime) / 1000;
    
    const overallSpeedBps = totalElapsedTime > 0 ? bytesTransferred / totalElapsedTime : 0;
    
    const deltaTime = now - metrics.lastMeasurementTime;
    const deltaBytes = bytesTransferred - metrics.totalBytes;
    
    if (deltaTime >= 500 && deltaBytes > 0) {
        const instantSpeedBps = (deltaBytes / deltaTime) * 1000;
        metrics.measurements.push({
            time: now,
            speed: instantSpeedBps
        });
        
        metrics.lastMeasurementTime = now;
        metrics.totalBytes = bytesTransferred;
    }
    
    metrics.measurements = metrics.measurements.filter(m => now - m.time < 10000);
    
    let recentAvgSpeed = 0;
    if (metrics.measurements.length > 0) {
        recentAvgSpeed = metrics.measurements.reduce((sum, m) => sum + m.speed, 0) / metrics.measurements.length;
    }
    
    const weightedSpeed = (overallSpeedBps * 0.7) + (recentAvgSpeed * 0.3);
    
    networkStats.uploadSpeed = weightedSpeed / (1024 * 1024);
    
    addUploadSpeedPoint(weightedSpeed);
    
    return weightedSpeed;
}

function initializeUploadSpeedMonitoring() {
    initializeSpeedChart();
    setInterval(updateUploadSpeedStats, STATS_UPDATE_INTERVAL);
    setInterval(cleanupOldSpeedData, 30000);
    
    globalThis.addEventListener('resize', () => {
        if (speedChart) {
            setTimeout(() => {
                initializeSpeedChart();
            }, 100);
        }
    });
}

function initializeSpeedChart() {
    const canvas = document.getElementById('speedChart');
    const ctx = canvas.getContext('2d');
    
    canvas.width = canvas.offsetWidth;
    canvas.height = 200;
    
    speedChart = {
        canvas: canvas,
        ctx: ctx,
        maxDataPoints: 60
    };
    
    drawChart();
}

function addUploadSpeedPoint(speed) {
    if (!speedChart) return;
    
    const now = Date.now();
    uploadSpeedStats.speedHistory.push({
        time: now,
        speed: speed
    });
    
    uploadSpeedStats.speedHistory = uploadSpeedStats.speedHistory.filter(
        point => now - point.time < 60000
    );
    
    calculateAverageUploadSpeed();
    drawChart();
}

function drawChart() {
    if (!speedChart || !uploadSpeedStats.speedHistory.length) {
        const { ctx, canvas } = speedChart;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#f8f9fa';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#dadce0';
        ctx.lineWidth = 1;
        ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);
        
        ctx.fillStyle = '#5f6368';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Upload Speed Graph (No data yet)', canvas.width / 2, canvas.height / 2);
        return;
    }
    
    const { ctx, canvas } = speedChart;
    const padding = 40;
    const chartWidth = canvas.width - (padding * 2);
    const chartHeight = canvas.height - (padding * 2);
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.strokeStyle = '#dadce0';
    ctx.lineWidth = 1;
    ctx.strokeRect(padding, padding, chartWidth, chartHeight);
    
    const maxSpeed = Math.max(...uploadSpeedStats.speedHistory.map(p => p.speed)) || 1;
    const timeRange = 60000;
    const now = Date.now();
    
    ctx.strokeStyle = '#1a73e8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    uploadSpeedStats.speedHistory.forEach((point, index) => {
        const x = padding + ((now - point.time) / timeRange) * chartWidth;
        const y = padding + chartHeight - ((point.speed / maxSpeed) * chartHeight);
        
        if (index === 0) {
            ctx.moveTo(canvas.width - x + padding, y);
        } else {
            ctx.lineTo(canvas.width - x + padding, y);
        }
    });
    
    ctx.stroke();
    
    ctx.fillStyle = '#5f6368';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${(maxSpeed / (1024 * 1024)).toFixed(1)} MB/s`, canvas.width - 5, padding + 15);
    ctx.fillText('0 MB/s', canvas.width - 5, canvas.height - padding + 15);
    
    ctx.textAlign = 'center';
    ctx.fillText('Upload Speed Over Time (60s)', canvas.width / 2, 20);
}

function updateUploadSpeedStats() {
    document.getElementById('avgUploadSpeed').textContent = `${uploadSpeedStats.averageSpeed.toFixed(1)} MB/s`;
}

function calculateAverageUploadSpeed() {
    if (uploadSpeedStats.speedHistory.length === 0) {
        uploadSpeedStats.averageSpeed = 0;
        return;
    }
    
    const totalSpeed = uploadSpeedStats.speedHistory.reduce((sum, point) => sum + point.speed, 0);
    uploadSpeedStats.averageSpeed = (totalSpeed / uploadSpeedStats.speedHistory.length) / (1024 * 1024);
}

function cleanupOldSpeedData() {
    const now = Date.now();
    uploadSpeedStats.speedHistory = uploadSpeedStats.speedHistory.filter(
        point => now - point.time < 300000
    );
}

async function checkForIncompleteUploads() {
    const savedSessions = JSON.parse(localStorage.getItem('uploadSessions') || '{}');
    const incompleteUploads = [];
    
    for (const [filename, sessionData] of Object.entries(savedSessions)) {
        try {
            const statusResponse = await fetch(`/api/upload-status?sessionId=${sessionData.sessionId}`);
            if (statusResponse.ok) {
                const status = await statusResponse.json();
                if (status.progress < 100) {
                    incompleteUploads.push({
                        filename: filename,
                        progress: Math.round(status.progress),
                        sessionData: sessionData
                    });
                } else {
                    delete savedSessions[filename];
                }
            } else {
                delete savedSessions[filename];
            }
        } catch (error) {
            console.error('Error checking upload status:', error);
            delete savedSessions[filename];
        }
    }
    
    localStorage.setItem('uploadSessions', JSON.stringify(savedSessions));
    
    displayIncompleteUploads(incompleteUploads);
}

function displayIncompleteUploads(incompleteUploads) {
    const resumeSection = document.getElementById('resumeSection');
    const incompleteUploadsContainer = document.getElementById('incompleteUploads');
    
    if (incompleteUploads.length === 0) {
        resumeSection.style.display = 'none';
        return;
    }
    
    resumeSection.style.display = 'block';
    incompleteUploadsContainer.innerHTML = '';
    
    incompleteUploads.forEach(upload => {
        const item = document.createElement('div');
        item.className = 'incomplete-upload-item';
        item.innerHTML = `
            <div class="incomplete-upload-info">
                <div class="incomplete-upload-name">${upload.filename}</div>
                <div class="incomplete-upload-progress">${upload.progress}% complete</div>
            </div>
            <div>
                <button class="resume-upload-btn" onclick="promptForResumeFile('${upload.filename}', ${JSON.stringify(upload.sessionData).replace(/"/g, '&quot;')})">
                    Resume Upload
                </button>
                <button class="discard-upload-btn" onclick="discardIncompleteUpload('${upload.filename}')">
                    Discard
                </button>
            </div>
        `;
        incompleteUploadsContainer.appendChild(item);
    });
}

function promptForResumeFile(filename, sessionData) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '*/*';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (file && file.name === filename) {
            resumeUploadWithFile(filename, sessionData, file);
        } else if (file) {
            alert(`Please select the same file: ${filename}\nYou selected: ${file.name}`);
        } else {
            console.log('No file selected');
        }
    };
    input.click();
}

async function resumeUploadWithFile(filename, sessionData, file) {
    try {
        activeUploads++;
        
        const resumeSection = document.getElementById('resumeSection');
        const items = resumeSection.querySelectorAll('.incomplete-upload-item');
        items.forEach(item => {
            const nameEl = item.querySelector('.incomplete-upload-name');
            if (nameEl && nameEl.textContent === filename) {
                item.style.display = 'none';
            }
        });
        
        activeUploadSessions.set(filename, { ...sessionData, file });
        
        transferMetrics.set(filename, {
            startTime: Date.now(),
            lastUpdate: Date.now(),
            totalBytes: 0,
            measurements: [],
            lastTransferred: 0
        });
        
        const statusResponse = await fetch(`/api/upload-status?sessionId=${sessionData.sessionId}`);
        if (!statusResponse.ok) throw new Error('Failed to get upload status');

        const status = await statusResponse.json();
        const uploadedChunks = new Set(status.uploadedChunks);
        
        const progressItem = createProgressItem(filename, file.size);
        uploadProgress.style.display = 'block';
        const initialBytes = Math.round((status.progress / 100) * file.size);
        updateProgress(progressItem, status.progress, initialBytes, file.size);

        const uploadTask = {
            file,
            sessionId: sessionData.sessionId,
            totalChunks: sessionData.totalChunks,
            completedChunks: uploadedChunks,
            activeChunks: new Set(),
            nextChunkIndex: 0,
            progressItem,
            finished: false
        };
        
        for (let i = 0; i < uploadTask.totalChunks; i++) {
            if (!uploadedChunks.has(i)) {
                uploadTask.nextChunkIndex = i;
                break;
            }
        }
        
        uploadTasks.push(uploadTask);
        
        for (let i = 0; i < Math.min(MAX_CONCURRENT_CHUNKS_PER_FILE, uploadTask.totalChunks - uploadTask.completedChunks.size); i++) {
            uploadNextChunk(uploadTask);
        }
        
        while (!uploadTask.finished) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        activeUploadSessions.delete(filename);
        
        const savedSessions = JSON.parse(localStorage.getItem('uploadSessions') || '{}');
        delete savedSessions[filename];
        localStorage.setItem('uploadSessions', JSON.stringify(savedSessions));
        
        const taskIndex = uploadTasks.indexOf(uploadTask);
        if (taskIndex > -1) {
            uploadTasks.splice(taskIndex, 1);
        }
        
        setTimeout(() => {
            progressItem.remove();
            transferMetrics.delete(filename);
            if (uploadProgress.children.length === 0) {
                uploadProgress.style.display = 'none';
            }
        }, 1000);

        loadFiles();
        checkForIncompleteUploads();
    } catch (error) {
        console.error('Resume upload failed:', error);
        alert(`Failed to resume upload: ${error.message}`);
        activeUploadSessions.delete(filename);
        transferMetrics.delete(filename);
        
        const taskIndex = uploadTasks.findIndex(task => task.file.name === filename);
        if (taskIndex > -1) {
            uploadTasks.splice(taskIndex, 1);
        }
    } finally {
        activeUploads--;
        processUploadQueue();
    }
}

function discardIncompleteUpload(filename) {
    if (confirm(`Are you sure you want to discard the incomplete upload for ${filename}?`)) {
        const savedSessions = JSON.parse(localStorage.getItem('uploadSessions') || '{}');
        delete savedSessions[filename];
        localStorage.setItem('uploadSessions', JSON.stringify(savedSessions));
        
        checkForIncompleteUploads();
    }
}

function setupEventListeners() {
    logoutBtn.addEventListener('click', handleLogout);
    
    uploadArea.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);
    
    uploadArea.addEventListener('dragover', handleDragOver);
    uploadArea.addEventListener('dragleave', handleDragLeave);
    uploadArea.addEventListener('drop', handleDrop);
}

async function checkAuth() {
    try {
        const response = await fetch('/api/files');
        if (response.ok) {
            loadFiles();
            currentUserSpan.textContent = 'User';
        } else {
            globalThis.location.href = '/login';
        }
    } catch (_error) {
        globalThis.location.href = '/login';
    }
}

async function handleLogout() {
    try {
        const response = await fetch('/api/logout', { method: 'POST' });
        const data = await response.json();
        
        globalThis.location.href = data.redirect || '/login';
    } catch (error) {
        console.error('Logout error:', error);
        globalThis.location.href = '/login';
    }
}

function handleFileSelect(e) {
    const files = Array.from(e.target.files);
    files.forEach(file => addToUploadQueue(file));
    processUploadQueue();
}

function handleDragOver(e) {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
}

function handleDragLeave(e) {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
}

function handleDrop(e) {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    
    const files = Array.from(e.dataTransfer.files);
    files.forEach(file => addToUploadQueue(file));
    processUploadQueue();
}

function addToUploadQueue(file) {
    uploadQueue.push(file);
}

async function processUploadQueue() {
    while (uploadQueue.length > 0 && activeUploads < MAX_CONCURRENT_UPLOADS) {
        const file = uploadQueue.shift();
        activeUploads++;
        
        try {
            if (file.size > CHUNK_SIZE) {
                await uploadFileChunked(file);
            } else {
                await uploadFileSimple(file);
            }
        } catch (error) {
            console.error('Upload error:', error);
            alert(`Failed to upload ${file.name}`);
        } finally {
            activeUploads--;
            processUploadQueue();
        }
    }
}

async function uploadFileSimple(file) {
    const formData = new FormData();
    formData.append('file', file);
    
    const progressItem = createProgressItem(file.name, file.size);
    uploadProgress.style.display = 'block';
    
    transferMetrics.set(file.name, {
        startTime: Date.now(),
        lastUpdate: Date.now(),
        totalBytes: 0,
        measurements: [],
        lastTransferred: 0
    });
    
    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) throw new Error('Upload failed');
        
        updateProgress(progressItem, 100, file.size, file.size);
        setTimeout(() => {
            progressItem.remove();
            transferMetrics.delete(file.name);
            if (uploadProgress.children.length === 0) {
                uploadProgress.style.display = 'none';
            }
        }, 1000);
        
        loadFiles();
    } catch (error) {
        progressItem.remove();
        transferMetrics.delete(file.name);
        throw error;
    }
}

async function uploadFileChunked(file) {
    const progressItem = createProgressItem(file.name, file.size);
    uploadProgress.style.display = 'block';
    
    transferMetrics.set(file.name, {
        startTime: Date.now(),
        lastUpdate: Date.now(),
        totalBytes: 0,
        measurements: [],
        lastTransferred: 0
    });
    
    try {
        const sessionResponse = await fetch('/api/upload-init', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filename: file.name,
                totalSize: file.size,
                chunkSize: CHUNK_SIZE
            })
        });

        if (!sessionResponse.ok) throw new Error('Failed to initialize upload');
        
        const { sessionId, totalChunks } = await sessionResponse.json();
        const sessionData = { sessionId, totalChunks, file };
        activeUploadSessions.set(file.name, sessionData);
        
        const savedSessions = JSON.parse(localStorage.getItem('uploadSessions') || '{}');
        savedSessions[file.name] = { sessionId, totalChunks };
        localStorage.setItem('uploadSessions', JSON.stringify(savedSessions));

        const uploadTask = {
            file,
            sessionId,
            totalChunks,
            completedChunks: new Set(),
            activeChunks: new Set(),
            nextChunkIndex: 0,
            progressItem,
            finished: false
        };
        
        uploadTasks.push(uploadTask);
        
        for (let i = 0; i < Math.min(MAX_CONCURRENT_CHUNKS_PER_FILE, totalChunks); i++) {
            uploadNextChunk(uploadTask);
        }
        
        while (!uploadTask.finished) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        activeUploadSessions.delete(file.name);
        
        const completedSessions = JSON.parse(localStorage.getItem('uploadSessions') || '{}');
        delete completedSessions[file.name];
        localStorage.setItem('uploadSessions', JSON.stringify(completedSessions));
        
        const taskIndex = uploadTasks.indexOf(uploadTask);
        if (taskIndex > -1) {
            uploadTasks.splice(taskIndex, 1);
        }
        
        setTimeout(() => {
            progressItem.remove();
            transferMetrics.delete(file.name);
            if (uploadProgress.children.length === 0) {
                uploadProgress.style.display = 'none';
            }
        }, 1000);

        loadFiles();
    } catch (error) {
        progressItem.remove();
        transferMetrics.delete(file.name);
        activeUploadSessions.delete(file.name);
        
        const taskIndex = uploadTasks.findIndex(task => task.file.name === file.name);
        if (taskIndex > -1) {
            uploadTasks.splice(taskIndex, 1);
        }
        
        throw error;
    }
}

async function uploadNextChunk(uploadTask) {
    if (uploadTask.finished) {
        return;
    }
    
    let chunkIndex = -1;
    for (let i = uploadTask.nextChunkIndex; i < uploadTask.totalChunks; i++) {
        if (!uploadTask.completedChunks.has(i) && !uploadTask.activeChunks.has(i)) {
            chunkIndex = i;
            uploadTask.nextChunkIndex = i + 1;
            break;
        }
    }
    
    if (chunkIndex === -1) {
        return;
    }
    
    uploadTask.activeChunks.add(chunkIndex);
    
    try {
        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, uploadTask.file.size);
        const chunk = uploadTask.file.slice(start, end);
        
        const response = await fetch(`/api/upload-resumable?sessionId=${uploadTask.sessionId}&chunkIndex=${chunkIndex}`, {
            method: 'POST',
            body: chunk
        });
        
        if (!response.ok) throw new Error(`Chunk ${chunkIndex} upload failed`);
        
        const result = await response.json();
        uploadTask.completedChunks.add(chunkIndex);
        uploadTask.activeChunks.delete(chunkIndex);
        
        const bytesTransferred = Math.round((result.progress / 100) * uploadTask.file.size);
        updateProgress(uploadTask.progressItem, result.progress, bytesTransferred, uploadTask.file.size);
        
        if (result.complete || uploadTask.completedChunks.size === uploadTask.totalChunks) {
            uploadTask.finished = true;
            return;
        }
        
        uploadNextChunk(uploadTask);
        
    } catch (error) {
        uploadTask.activeChunks.delete(chunkIndex);
        console.error(`Failed to upload chunk ${chunkIndex}:`, error);
        
        setTimeout(() => {
            if (!uploadTask.finished) {
                uploadNextChunk(uploadTask);
            }
        }, 1000);
    }
}

function createProgressItem(filename, totalSize = 0) {
    const item = document.createElement('div');
    item.className = 'progress-item';
    item.dataset.filename = filename;
    item.innerHTML = `
        <div class="progress-header">
            <span class="filename">${filename}</span>
            <span class="transfer-stats">
                <span class="transfer-speed">0 MB/s</span>
                <span class="eta">ETA: --</span>
            </span>
        </div>
        <div class="progress-bar">
            <div class="progress-fill"></div>
        </div>
        <div class="progress-footer">
            <span class="progress-text">0%</span>
            <span class="transfer-details">
                <span class="transferred">0 B</span> / <span class="total-size">${formatFileSize(totalSize)}</span>
            </span>
        </div>
    `;
    uploadProgress.appendChild(item);
    return item;
}

function updateProgress(progressItem, percent, bytesTransferred = 0, totalSize = 0) {
    const fill = progressItem.querySelector('.progress-fill');
    const text = progressItem.querySelector('.progress-text');
    const transferredSpan = progressItem.querySelector('.transferred');
    const totalSizeSpan = progressItem.querySelector('.total-size');
    const speedSpan = progressItem.querySelector('.transfer-speed');
    const etaSpan = progressItem.querySelector('.eta');
    
    fill.style.width = `${percent}%`;
    text.textContent = `${Math.round(percent)}%`;
    
    if (transferredSpan && totalSize > 0) {
        transferredSpan.textContent = formatFileSize(bytesTransferred);
        if (totalSizeSpan && totalSizeSpan.textContent === '0 B') {
            totalSizeSpan.textContent = formatFileSize(totalSize);
        }
    }
    
    const filename = progressItem.dataset.filename;
    if (filename && transferMetrics.has(filename)) {
        const metrics = transferMetrics.get(filename);
        const now = Date.now();
        const timeElapsed = (now - metrics.startTime) / 1000;
        
        if (timeElapsed > 0 && bytesTransferred > 0) {
            const currentSpeed = calculateTransferSpeed(filename, bytesTransferred, timeElapsed);
            const speedMBps = (currentSpeed / (1024 * 1024));
            
            const theoreticalMaxMBps = networkStats.bandwidth > 0 ? 
                (networkStats.bandwidth * 1024 * 1024) / (8 * 1024 * 1024) : 
                125;
            
            if (speedSpan) {
                const efficiencyPercent = theoreticalMaxMBps > 0 ? 
                    Math.min(100, (speedMBps / theoreticalMaxMBps) * 100) : 0;
                
                speedSpan.textContent = `${speedMBps.toFixed(1)} MB/s (${efficiencyPercent.toFixed(0)}% of ${theoreticalMaxMBps.toFixed(0)} MB/s max)`;
            }
            
            if (etaSpan && currentSpeed > 0 && totalSize > bytesTransferred) {
                const remainingBytes = totalSize - bytesTransferred;
                const etaSeconds = remainingBytes / currentSpeed;
                etaSpan.textContent = `ETA: ${formatTime(etaSeconds)}`;
            } else if (etaSpan && percent >= 100) {
                etaSpan.textContent = 'Complete';
            }
            
            networkStats.dataSent += bytesTransferred - (metrics.lastTransferred || 0);
            metrics.lastTransferred = bytesTransferred;
        }
    }
}

function formatTime(seconds) {
    if (seconds < 60) {
        return `${Math.round(seconds)}s`;
    } else if (seconds < 3600) {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.round(seconds % 60);
        return `${minutes}m ${remainingSeconds}s`;
    } else {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return `${hours}h ${minutes}m`;
    }
}

async function loadFiles() {
    try {
        const response = await fetch('/api/files');
        if (!response.ok) {
            if (response.status === 401) {
                globalThis.location.href = '/login';
                return;
            }
            throw new Error('Failed to load files');
        }
        const files = await response.json();
        renderFiles(files);
    } catch (error) {
        console.error('Failed to load files:', error);
    }
}

function renderFiles(files) {
    if (files.length === 0) {
        filesList.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                    <polyline points="13 2 13 9 20 9"></polyline>
                </svg>
                <p>No files uploaded yet</p>
            </div>
        `;
        return;
    }
    
    filesList.innerHTML = files.map(file => `
        <div class="file-item" data-filename="${file.name}">
            <div class="file-info">
                <div class="file-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                        <polyline points="13 2 13 9 20 9"></polyline>
                    </svg>
                </div>
                <div class="file-details">
                    <div class="file-name">${file.name}</div>
                    <div class="file-meta">${formatFileSize(file.size)} • ${formatDate(file.modified)}</div>
                </div>
            </div>
            <div class="file-actions">
                <button class="download-btn" onclick="downloadFile('${file.name}')">Download</button>
                <button class="delete-btn" onclick="deleteFile('${file.name}')">Delete</button>
            </div>
        </div>
    `).join('');
}

async function downloadFile(filename) {
    try {
        const response = await fetch(`/api/download?filename=${encodeURIComponent(filename)}`);
        if (!response.ok) throw new Error('Download failed');
        
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    } catch (_error) {
        alert('Download failed');
    }
}

async function deleteFile(filename) {
    if (!confirm(`Delete ${filename}?`)) return;
    
    try {
        const response = await fetch(`/api/delete?filename=${encodeURIComponent(filename)}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) throw new Error('Delete failed');
        loadFiles();
    } catch (_error) {
        alert('Delete failed');
    }
}

function formatFileSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
}

function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} days ago`;
    
    return date.toLocaleDateString();
}

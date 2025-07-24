const CHUNK_SIZE = 5 * 1024 * 1024;
const MAX_CONCURRENT_UPLOADS = 3;
const SPEED_CALCULATION_WINDOW = 5000;
const LATENCY_CHECK_INTERVAL = 10000;
const STATS_UPDATE_INTERVAL = 1000;

const fileInput = document.getElementById('fileInput');
const uploadArea = document.getElementById('uploadArea');
const filesList = document.getElementById('filesList');
const currentUserSpan = document.getElementById('currentUser');
const logoutBtn = document.getElementById('logoutBtn');
const uploadProgress = document.getElementById('uploadProgress');

let currentUser = null;
let uploadQueue = [];
let activeUploads = 0;
let activeUploadSessions = new Map();
const networkStats = {
    latency: 0,
    bandwidth: 0,
    uploadSpeed: 0,
    dataSent: 0,
    dataReceived: 0,
    connectionQuality: 'unknown'
};
let transferMetrics = new Map();

document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    setupEventListeners();
    checkForIncompleteUploads();
    initializeNetworkMonitoring();
    
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
        const testSize = 100 * 1024;
        const testData = new Uint8Array(testSize);
        
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
            
            networkStats.bandwidth = speedMbps;
            networkStats.dataReceived += testSize;
            networkStats.dataSent += testSize;
        }
    } catch {
        networkStats.bandwidth = 0;
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
    document.getElementById('bandwidthTest').textContent = `${networkStats.bandwidth.toFixed(1)} Mbps`;
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
            measurements: []
        });
    }
    
    const metrics = transferMetrics.get(filename);
    const now = Date.now();
    const deltaTime = now - metrics.lastUpdate;
    const deltaBytes = bytesTransferred - metrics.totalBytes;
    
    if (deltaTime > 0) {
        const speedBps = (deltaBytes / deltaTime) * 1000;
        metrics.measurements.push({
            time: now,
            speed: speedBps
        });
        
        metrics.measurements = metrics.measurements.filter(m => now - m.time < SPEED_CALCULATION_WINDOW);
        
        const avgSpeed = metrics.measurements.reduce((sum, m) => sum + m.speed, 0) / metrics.measurements.length;
        
        metrics.lastUpdate = now;
        metrics.totalBytes = bytesTransferred;
        
        networkStats.uploadSpeed = avgSpeed / (1024 * 1024);
        
        return avgSpeed;
    }
    
    return 0;
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

        for (let i = 0; i < sessionData.totalChunks; i++) {
            if (uploadedChunks.has(i)) continue;

            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, file.size);
            const chunk = file.slice(start, end);
            
            const response = await fetch(`/api/upload-resumable?sessionId=${sessionData.sessionId}&chunkIndex=${i}`, {
                method: 'POST',
                body: chunk
            });
            
            if (!response.ok) throw new Error(`Chunk ${i} upload failed`);
            
            const result = await response.json();
            const bytesTransferred = Math.round((result.progress / 100) * file.size);
            updateProgress(progressItem, result.progress, bytesTransferred, file.size);
            
            if (result.complete) break;
        }

        activeUploadSessions.delete(filename);
        
        const savedSessions = JSON.parse(localStorage.getItem('uploadSessions') || '{}');
        delete savedSessions[filename];
        localStorage.setItem('uploadSessions', JSON.stringify(savedSessions));
        
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
            window.location.href = '/login';
        }
    } catch (error) {
        window.location.href = '/login';
    }
}

async function handleLogout() {
    try {
        const response = await fetch('/api/logout', { method: 'POST' });
        const data = await response.json();
        
        window.location.href = data.redirect || '/login';
    } catch (error) {
        console.error('Logout error:', error);
        window.location.href = '/login';
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

        for (let i = 0; i < totalChunks; i++) {
            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, file.size);
            const chunk = file.slice(start, end);
            
            const response = await fetch(`/api/upload-resumable?sessionId=${sessionId}&chunkIndex=${i}`, {
                method: 'POST',
                body: chunk
            });
            
            if (!response.ok) throw new Error(`Chunk ${i} upload failed`);
            
            const result = await response.json();
            const bytesTransferred = Math.round((result.progress / 100) * file.size);
            updateProgress(progressItem, result.progress, bytesTransferred, file.size);
            
            if (result.complete) break;
        }

        activeUploadSessions.delete(file.name);
        
        const completedSessions = JSON.parse(localStorage.getItem('uploadSessions') || '{}');
        delete completedSessions[file.name];
        localStorage.setItem('uploadSessions', JSON.stringify(completedSessions));
        
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
        throw error;
    }
}

async function resumeUpload(filename) {
    const session = activeUploadSessions.get(filename);
    if (!session) return false;

    try {
        const statusResponse = await fetch(`/api/upload-status?sessionId=${session.sessionId}`);
        if (!statusResponse.ok) return false;

        const status = await statusResponse.json();
        const uploadedChunks = new Set(status.uploadedChunks);
        
        const progressItem = createProgressItem(filename);
        uploadProgress.style.display = 'block';
        updateProgress(progressItem, status.progress);

        for (let i = 0; i < session.totalChunks; i++) {
            if (uploadedChunks.has(i)) continue;

            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, session.file.size);
            const chunk = session.file.slice(start, end);
            
            const response = await fetch(`/api/upload-resumable?sessionId=${session.sessionId}&chunkIndex=${i}`, {
                method: 'POST',
                body: chunk
            });
            
            if (!response.ok) throw new Error(`Chunk ${i} upload failed`);
            
            const result = await response.json();
            updateProgress(progressItem, result.progress);
            
            if (result.complete) break;
        }

        activeUploadSessions.delete(filename);
        
        setTimeout(() => {
            progressItem.remove();
            if (uploadProgress.children.length === 0) {
                uploadProgress.style.display = 'none';
            }
        }, 1000);

        loadFiles();
        return true;
    } catch (error) {
        console.error('Resume upload failed:', error);
        activeUploadSessions.delete(filename);
        return false;
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
            
            if (speedSpan) {
                speedSpan.textContent = `${speedMBps.toFixed(1)} MB/s`;
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
                window.location.href = '/login';
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
    } catch (error) {
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
    } catch (error) {
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

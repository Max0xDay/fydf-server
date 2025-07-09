const CHUNK_SIZE = 5 * 1024 * 1024;
const MAX_CONCURRENT_UPLOADS = 3;

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

document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    setupEventListeners();
    checkForIncompleteUploads();
    
    window.promptForResumeFile = promptForResumeFile;
    window.discardIncompleteUpload = discardIncompleteUpload;
    window.downloadFile = downloadFile;
    window.deleteFile = deleteFile;
});

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
        
        const statusResponse = await fetch(`/api/upload-status?sessionId=${sessionData.sessionId}`);
        if (!statusResponse.ok) throw new Error('Failed to get upload status');

        const status = await statusResponse.json();
        const uploadedChunks = new Set(status.uploadedChunks);
        
        const progressItem = createProgressItem(filename);
        uploadProgress.style.display = 'block';
        updateProgress(progressItem, status.progress);

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
            updateProgress(progressItem, result.progress);
            
            if (result.complete) break;
        }

        activeUploadSessions.delete(filename);
        
        const savedSessions = JSON.parse(localStorage.getItem('uploadSessions') || '{}');
        delete savedSessions[filename];
        localStorage.setItem('uploadSessions', JSON.stringify(savedSessions));
        
        setTimeout(() => {
            progressItem.remove();
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
    
    const progressItem = createProgressItem(file.name);
    uploadProgress.style.display = 'block';
    
    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) throw new Error('Upload failed');
        
        updateProgress(progressItem, 100);
        setTimeout(() => {
            progressItem.remove();
            if (uploadProgress.children.length === 0) {
                uploadProgress.style.display = 'none';
            }
        }, 1000);
        
        loadFiles();
    } catch (error) {
        progressItem.remove();
        throw error;
    }
}

async function uploadFileChunked(file) {
    const progressItem = createProgressItem(file.name);
    uploadProgress.style.display = 'block';
    
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
            updateProgress(progressItem, result.progress);
            
            if (result.complete) break;
        }

        activeUploadSessions.delete(file.name);
        
        const completedSessions = JSON.parse(localStorage.getItem('uploadSessions') || '{}');
        delete completedSessions[file.name];
        localStorage.setItem('uploadSessions', JSON.stringify(completedSessions));
        
        setTimeout(() => {
            progressItem.remove();
            if (uploadProgress.children.length === 0) {
                uploadProgress.style.display = 'none';
            }
        }, 1000);

        loadFiles();
    } catch (error) {
        progressItem.remove();
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

function createProgressItem(filename) {
    const item = document.createElement('div');
    item.className = 'progress-item';
    item.innerHTML = `
        <span class="filename">${filename}</span>
        <div class="progress-bar">
            <div class="progress-fill"></div>
        </div>
        <span class="progress-text">0%</span>
    `;
    uploadProgress.appendChild(item);
    return item;
}

function updateProgress(progressItem, percent) {
    const fill = progressItem.querySelector('.progress-fill');
    const text = progressItem.querySelector('.progress-text');
    fill.style.width = `${percent}%`;
    text.textContent = `${Math.round(percent)}%`;
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

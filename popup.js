document.addEventListener('DOMContentLoaded', init);

async function init() {
    const listContainer = document.getElementById('tab-list');
    const totalTabsEl = document.getElementById('total-tabs');
    const totalMemEl = document.getElementById('total-memory');

    try {
        // 1. Get all tabs
        const tabs = await chrome.tabs.query({});
        totalTabsEl.textContent = tabs.length;

        // Check if chrome.processes API is available
        if (!chrome.processes) {
            renderApiWarning(listContainer, "The 'chrome.processes' API is not available in your browser (requires Dev channel or flags). Memory usage per tab cannot be retrieved.");

            // Fallback: Show tabs without memory info
            const simpleData = tabs.map(tab => ({
                tab,
                memory: 0,
                shared: false,
                domain: getDomain(tab.url),
                error: true
            }));

            // Still try to get system memory if available
            if (chrome.system && chrome.system.memory) {
                const memInfo = await new Promise(r => chrome.system.memory.getInfo(r));
                // Available capacity is usually total - available
                const used = memInfo.capacity - memInfo.availableCapacity;
                const usedMB = (used / 1024 / 1024).toFixed(0);
                const totalMB = (memInfo.capacity / 1024 / 1024).toFixed(0);
                totalMemEl.textContent = `System Memory: ${usedMB} MB / ${totalMB} MB`;
            } else {
                totalMemEl.textContent = "Memory API Unavailable";
            }

            renderTabs(simpleData, listContainer);
            return;
        }

        // API IS AVAILABLE - Proceed with original logic
        const tabData = [];

        const promises = tabs.map(async (tab) => {
            try {
                const processId = await chrome.processes.getProcessIdForTab(tab.id);
                return { tab, processId };
            } catch (e) {
                console.warn(`Could not get process for tab ${tab.id}:`, e);
                return { tab, processId: null };
            }
        });

        const tabsWithPids = await Promise.all(promises);
        const uniquePids = [...new Set(tabsWithPids.map(t => t.processId).filter(p => p !== null))];

        let processesMap = {};
        if (uniquePids.length > 0) {
            processesMap = await new Promise((resolve) => {
                chrome.processes.getProcessInfo(uniquePids, true, resolve);
            });
        }

        const finalData = tabsWithPids.map(item => {
            const { tab, processId } = item;
            let memory = 0;
            let shared = false;

            if (processId && processesMap[processId]) {
                const proc = processesMap[processId];
                memory = proc.privateMemory || 0;

                const siblingTabs = tabsWithPids.filter(t => t.processId === processId);
                if (siblingTabs.length > 1) {
                    shared = true;
                }
            }

            return {
                ...item,
                memory,
                shared,
                domain: getDomain(tab.url)
            };
        });

        finalData.sort((a, b) => b.memory - a.memory);
        renderTabs(finalData, listContainer);

        let totalMemoryBytes = 0;
        uniquePids.forEach(pid => {
            if (processesMap[pid]) {
                totalMemoryBytes += (processesMap[pid].privateMemory || 0);
            }
        });
        totalMemEl.textContent = `Chrome Details Est. Memory: ${(totalMemoryBytes / 1024 / 1024).toFixed(0)} MB`;

    } catch (error) {
        console.error("Error analyzing tabs:", error);
        listContainer.innerHTML = `<div class="loading-state" style="color:var(--danger-color)">Error: ${error.message}</div>`;
    }
}

function getDomain(url) {
    try {
        const u = new URL(url);
        return u.hostname;
    } catch (e) {
        return 'System/Other';
    }
}

function renderApiWarning(container, message) {
    const div = document.createElement('div');
    div.style.padding = '12px';
    div.style.backgroundColor = '#fff3cd';
    div.style.color = '#856404';
    div.style.fontSize = '12px';
    div.style.borderBottom = '1px solid #ffeeba';
    div.textContent = message;
    // Insert before the list or prepend
    // Since we clear container in renderTabs, let's just use renderTabs to append logic, 
    // or passing a flag. Actually, let's just make renderTabs smart enough or prepend it to the main container.
    // Simpler: Just render the tabs, and user sees "N/A". 
    // But we want to show this message.
    // Let's modify renderTabs or just prepend to container after clearing.
    container.innerHTML = '';
    container.appendChild(div);
}

function renderTabs(data, container) {
    // Only clear if we didn't just add a warning (hacky check). 
    // Better: renderApiWarning cleared it. If we call this, we append.
    if (container.children.length === 0) container.innerHTML = '';

    if (data.length === 0) {
        container.innerHTML += '<div class="loading-state">No tabs found.</div>';
        return;
    }

    data.forEach(item => {
        const memoryMB = item.error ? 'N/A' : (item.memory / 1024 / 1024).toFixed(1) + ' MB';
        const div = document.createElement('div');
        div.className = 'tab-item';

        div.innerHTML = `
      <div class="tab-info">
        <div class="tab-title" title="${item.tab.title || 'Untitled'}">${item.tab.title || 'Untitled'}</div>
        <div class="tab-domain">${item.domain}${item.shared ? ' (Shared Process)' : ''}</div>
      </div>
      <div class="tab-pid">${item.processId || '-'}</div>
      <div class="tab-mem" style="${item.error ? 'color:var(--text-secondary);font-size:10px;' : ''}">${memoryMB}</div>
      <div class="tab-close">
        <button class="btn-close" title="Close Tab">✕</button>
      </div>
    `;

        const closeBtn = div.querySelector('.btn-close');
        closeBtn.addEventListener('click', () => {
            closeTab(item.tab.id, div);
        });

        container.appendChild(div);
    });
}

function closeTab(tabId, rowElement) {
    chrome.tabs.remove(tabId, () => {
        if (chrome.runtime.lastError) {
            console.error(chrome.runtime.lastError);
            return;
        }
        rowElement.style.opacity = '0.5';
        setTimeout(() => rowElement.remove(), 300);

        const countEl = document.getElementById('total-tabs');
        if (countEl) {
            const current = parseInt(countEl.textContent);
            if (!isNaN(current) && current > 0) countEl.textContent = current - 1;
        }
    });
}

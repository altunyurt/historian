const searchInput = document.getElementById("search-input");
const dateStart = document.getElementById("date-start");
const dateEnd = document.getElementById("date-end");
const clearBtn = document.getElementById("clear-filters");
const selectAll = document.getElementById("select-all");
const historyList = document.getElementById("history-list");
const deleteBtn = document.getElementById("delete-btn");
const overlay = document.getElementById("loading-overlay");
const cancelBtn = document.getElementById("cancel-delete-btn");
const statusText = document.getElementById("status-text");

let isCancelling = false;
let isDeleting = false;
let currentItems = [];
let refreshId = 0; // Abort stale searches

async function refreshHistory() {
  if (isDeleting) return; // Don't clobber during delete

  const query = searchInput.value;
  const start = dateStart.value ? new Date(dateStart.value).getTime() : 0;
  const end = dateEnd.value ? new Date(dateEnd.value).setHours(23, 59, 59, 999) : Date.now();

  const thisId = ++refreshId;
  let items;
  try {
    items = await browser.history.search({
      text: query,
      startTime: start,
      endTime: end,
      maxResults: 1000,
    });
  } catch (err) {
    console.error("history.search failed", err);
    return;
  }

  if (thisId !== refreshId) return; // Stale request

  currentItems = items;

  const fragment = document.createDocumentFragment();
  historyList.innerHTML = "";
  selectAll.checked = false;

  currentItems.forEach((item, index) => {
    const li = document.createElement("li");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "item-check";
    checkbox.dataset.index = index;

    const textDiv = document.createElement("div");
    textDiv.className = "text-content";

    const titleSpan = document.createElement("span");
    titleSpan.className = "title";
    titleSpan.textContent = item.title || "No Title";

    const urlSpan = document.createElement("span");
    urlSpan.className = "url";
    urlSpan.textContent = item.url;

    textDiv.appendChild(titleSpan);
    textDiv.appendChild(urlSpan);
    li.appendChild(checkbox);
    li.appendChild(textDiv);
    fragment.appendChild(li);
  });

  historyList.appendChild(fragment);
}

async function deleteSelected() {
  const checks = document.querySelectorAll(".item-check:checked");
  if (!checks.length) return;

  // Map checkboxes to full items via currentItems index
  const selected = Array.from(checks)
    .map((c) => currentItems[parseInt(c.dataset.index)])
    .filter(Boolean);
  if (!selected.length) return;

  if (!confirm(`Delete ${selected.length} items?`)) return;

  isCancelling = false;
  isDeleting = true;
  overlay.classList.add("active");

  try {
    // Sort selection by time ascending → define time range
    selected.sort((a, b) => a.lastVisitTime - b.lastVisitTime);
    const selectedUrls = new Set(selected.map((x) => x.url));
    const total = selected.length;
    const rangeStart = selected[0].lastVisitTime;
    const rangeEnd = selected[selected.length - 1].lastVisitTime;

    // Fetch everything in that time range with same text filter as the view
    const query = searchInput.value;
    statusText.textContent = "Fetching...";
    const dbItems = await browser.history.search({
      text: query,
      startTime: rangeStart,
      endTime: rangeEnd,
      maxResults: 100000,
    });

    if (dbItems.length >= 100000) {
      console.warn("DB fetch truncated at maxResults", rangeStart, rangeEnd);
    }

    // Sort DB result by time ascending for linear scan
    dbItems.sort((a, b) => a.lastVisitTime - b.lastVisitTime);

    if (dbItems.length === total) {
      // Exact match: selection covers every item in time range → nuke it all
      console.info("deleting full range (exact match)", {
        startTime: rangeStart,
        endTime: rangeEnd,
        count: total,
      });

      if (total === 1) {
        statusText.textContent = "Deleting...";
        try {
          await browser.history.deleteUrl({ url: dbItems[0].url });
          console.info("deleteUrl succeeded for", dbItems[0].url);
        } catch (err) {
          console.error("deleteUrl failed", dbItems[0].url, err, "→ trying deleteRange");
          try {
            await browser.history.deleteRange({ startTime: rangeStart - 1, endTime: rangeEnd + 1 });
          } catch (err2) {
            console.error("deleteRange also failed", err2);
          }
        }
      } else {
        statusText.textContent = `Deleting all ${total}...`;
        try {
          await browser.history.deleteRange({ startTime: rangeStart - 1, endTime: rangeEnd + 1 });
        } catch (err) {
          console.error("deleteRange failed", err);
        }
      }
    } else {
      // Partial match: dbItems has interlopers → find contiguous URL-matching blocks
      const blocks = [];
      let blockStart = -1;
      for (let k = 0; k < dbItems.length; k++) {
        if (selectedUrls.has(dbItems[k].url)) {
          if (blockStart === -1) blockStart = k;
        } else {
          if (blockStart !== -1) {
            blocks.push({ start: blockStart, end: k - 1 });
            blockStart = -1;
          }
        }
      }
      if (blockStart !== -1) {
        blocks.push({ start: blockStart, end: dbItems.length - 1 });
      }

      // Delete each contiguous block
      let done = 0;
      statusText.textContent = `Deleting... 0/${total}`;

      for (let b = 0; b < blocks.length; b++) {
        if (isCancelling) break;

        const { start: si, end: ei } = blocks[b];
        const count = ei - si + 1;
        const pct = Math.round((done / total) * 100);

        if (count === 1) {
          statusText.textContent = `Deleting... ${pct}%`;
          try {
            await browser.history.deleteUrl({ url: dbItems[si].url });
          } catch (err) {
            console.error("deleteUrl failed", dbItems[si].url, err);
          }
        } else {
          const t0 = dbItems[si].lastVisitTime;
          const t1 = dbItems[ei].lastVisitTime;
          console.info("deleting block", { startTime: t0, endTime: t1, count });
          statusText.textContent = `Deleting block of ${count}... ${pct}%`;
          try {
            await browser.history.deleteRange({ startTime: t0 - 1, endTime: t1 + 1 });
          } catch (err) {
            console.error("deleteRange failed", err);
          }
        }

        done += count;
        statusText.textContent = `Deleting... ${Math.round((done / total) * 100)}%`;
      }
    }

    if (!isCancelling) {
      statusText.textContent = `Deleted ${total} items.`;
    }
  } finally {
    overlay.classList.remove("active");
    isDeleting = false;
  }

  await refreshHistory();
}

// Event Listeners
cancelBtn.addEventListener("click", () => {
  isCancelling = true;
  statusText.textContent = "Cancelling...";
});

deleteBtn.addEventListener("click", deleteSelected);

let debounceTimer;
[searchInput, dateStart, dateEnd].forEach((el) => {
  el.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(refreshHistory, 150);
  });
});

clearBtn.addEventListener("click", () => {
  searchInput.value = "";
  dateStart.value = "";
  dateEnd.value = "";
  refreshHistory();
});

selectAll.addEventListener("change", (e) => {
  document.querySelectorAll(".item-check").forEach((c) => (c.checked = e.target.checked));
});

refreshHistory();

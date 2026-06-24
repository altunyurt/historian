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

  const selectedUrls = new Set(
    Array.from(checks).map((c) => currentItems[parseInt(c.dataset.index)]?.url).filter(Boolean)
  );
  if (!selectedUrls.size) return;

  if (!confirm(`Delete ${selectedUrls.size} items?`)) return;

  isCancelling = false;
  isDeleting = true;
  overlay.classList.add("active");

  try {
    // Sort full visible set by time ascending — single in-memory pass, zero API calls
    const sorted = [...currentItems].sort((a, b) => a.lastVisitTime - b.lastVisitTime);

    // Build contiguous selected blocks
    const blocks = [];
    let blockStart = -1;
    for (let k = 0; k < sorted.length; k++) {
      if (selectedUrls.has(sorted[k].url)) {
        if (blockStart === -1) blockStart = k;
      } else {
        if (blockStart !== -1) {
          blocks.push({ start: blockStart, end: k - 1 });
          blockStart = -1;
        }
      }
    }
    if (blockStart !== -1) {
      blocks.push({ start: blockStart, end: sorted.length - 1 });
    }

    // Delete each block
    let done = 0;
    for (let b = 0; b < blocks.length; b++) {
      if (isCancelling) break;

      const { start: si, end: ei } = blocks[b];
      const count = ei - si + 1;

      if (count === 1) {
        try {
          await browser.history.deleteUrl({ url: sorted[si].url });
        } catch (err) {
          console.error("deleteUrl failed", sorted[si].url, err);
        }
      } else {
        const t0 = sorted[si].lastVisitTime;
        const t1 = sorted[ei].lastVisitTime;
        console.info("deleting range", { startTime: t0, endTime: t1, count });
        try {
          await browser.history.deleteRange({ startTime: t0 - 1, endTime: t1 + 1 });
        } catch (err) {
          console.error("deleteRange failed", err, { startTime: t0, endTime: t1 });
        }
      }

      done += count;
      statusText.textContent = `Processing... ${Math.round((done / selectedUrls.size) * 100)}%`;
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

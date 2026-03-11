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

// Concurrency-limited Promise.all — fires `limit` deletions at a time
async function deleteWithConcurrency(urls, limit, onProgress) {
  let completed = 0;
  let index = 0;

  async function next() {
    while (index < urls.length) {
      if (isCancelling) return;
      const url = urls[index++];
      await browser.history.deleteUrl({ url });
      completed++;
      onProgress(completed, urls.length);
    }
  }

  // Spawn `limit` parallel workers
  const workers = Array.from({ length: Math.min(limit, urls.length) }, next);
  await Promise.all(workers);
}

async function deleteSelected() {
  const checks = document.querySelectorAll(".item-check:checked");
  const urls = Array.from(checks).map((c) => c.value);

  if (!urls.length) return;
  if (!confirm(`Delete ${urls.length} items?`)) return;

  isCancelling = false;
  cancelBtn.disabled = false;
  overlay.classList.add("active");
  statusText.textContent = "Deleting... 0%";

  await deleteWithConcurrency(urls, 100, (done, total) => {
    const pct = Math.round((done / total) * 100);
    statusText.textContent = `Deleting... ${pct}%`;
  });

  if (isCancelling) {
    statusText.textContent = "Cancelled.";
  }

  overlay.classList.remove("active");
  cancelBtn.disabled = false; // reset for next run
  refreshHistory();
}

cancelBtn.addEventListener("click", () => {
  isCancelling = true;
  statusText.textContent = "Cancelling...";
  cancelBtn.disabled = true;
});

deleteBtn.addEventListener("click", deleteSelected);

async function refreshHistory() {
  // Fix: append T00:00:00 to force local time parsing, not UTC
  const start = dateStart.value ? new Date(dateStart.value + "T00:00:00").getTime() : 0;
  const end = dateEnd.value ? new Date(dateEnd.value + "T23:59:59").getTime() : Date.now();

  const items = await browser.history.search({
    text: searchInput.value,
    startTime: start,
    endTime: end,
    maxResults: 1000,
  });

  const fragment = document.createDocumentFragment();
  historyList.innerHTML = "";
  selectAll.checked = false;

  items.forEach((item) => {
    const li = document.createElement("li");

    // Fix: no innerHTML with user data — XSS safe
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "item-check";
    checkbox.value = item.url;

    const textDiv = document.createElement("div");
    textDiv.className = "text-content";

    const titleSpan = document.createElement("span");
    titleSpan.className = "title";
    titleSpan.title = item.title || "";
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

let debounceTimer;
const handleInput = () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(refreshHistory, 150);
};

[searchInput, dateStart, dateEnd].forEach((el) => el.addEventListener("input", handleInput));

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

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
let currentItems = []; // Absolute truth: stores full objects from latest search

async function refreshHistory() {
  const query = searchInput.value;
  const start = dateStart.value ? new Date(dateStart.value).getTime() : 0;
  const end = dateEnd.value ? new Date(dateEnd.value).setHours(23, 59, 59, 999) : Date.now();

  // Fetch items and store them globally for reference during deletion
  currentItems = await browser.history.search({
    text: query,
    startTime: start,
    endTime: end,
    maxResults: 1000,
  });

  const fragment = document.createDocumentFragment();
  historyList.innerHTML = "";
  selectAll.checked = false;

  currentItems.forEach((item, index) => {
    const li = document.createElement("li");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "item-check";
    checkbox.dataset.index = index; // Link UI to the currentItems array index

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

  // Map checkboxes back to full HistoryItem objects
  const selectedItems = Array.from(checks)
    .map((c) => currentItems[parseInt(c.dataset.index)])
    .sort((a, b) => a.lastVisitTime - b.lastVisitTime); // Sort Ascending for range logic

  if (!confirm(`Delete ${selectedItems.length} items?`)) return;

  isCancelling = false;
  overlay.classList.add("active");

  let i = 0;
  while (i < selectedItems.length) {
    if (isCancelling) break;

    let j = i;
    // Attempt to expand range
    while (j + 1 < selectedItems.length) {
      const startT = selectedItems[j].lastVisitTime;
      const endT = selectedItems[j + 1].lastVisitTime;

      // Verification Step: Check the DB for unselected items in this gap
      const gapCheck = await browser.history.search({
        text: "",
        startTime: startT,
        endTime: endT,
        maxResults: 10, // Small buffer to find interlopers
      });

      // Filter out items already in our selection to see if anything "alien" remains
      const selectedUrls = new Set(selectedItems.map((item) => item.url));
      const interlopers = gapCheck.filter((item) => !selectedUrls.has(item.url));

      if (interlopers.length === 0) {
        j++; // No unselected items in gap, expand range
      } else {
        break; // Unselected item found, stop range expansion
      }
    }

    if (j > i) {
      // Range is verified safe: delete the block
      console.info("deleting range", {
        startTime: selectedItems[i].lastVisitTime - 1, // Buffers ensure inclusive deletion
        endTime: selectedItems[j].lastVisitTime + 1,
        num_items: j - i,
      });
      await browser.history.deleteRange({
        startTime: selectedItems[i].lastVisitTime - 1, // Buffers ensure inclusive deletion
        endTime: selectedItems[j].lastVisitTime + 1,
      });
      i = j + 1;
    } else {
      // No safe range: delete individual URL
      // console.info("deleting single", { url: selectedItems[i].url });
      await browser.history.deleteUrl({ url: selectedItems[i].url });
      i++;
    }

    statusText.textContent = `Processing... ${Math.round((i / selectedItems.length) * 100)}%`;
  }

  overlay.classList.remove("active");
  refreshHistory();
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

const searchInput = document.getElementById("search-input");
const dateStart = document.getElementById("date-start");
const dateEnd = document.getElementById("date-end");
const clearBtn = document.getElementById("clear-filters");
const selectAll = document.getElementById("select-all");
const iMeanIt = document.getElementById("i-mean-it");
const historyList = document.getElementById("history-list");
const deleteBtn = document.getElementById("delete-btn");
const deleteAllBtn = document.getElementById("delete-all-btn");
const matchInfo = document.getElementById("match-info");
const overlay = document.getElementById("loading-overlay");
const cancelBtn = document.getElementById("cancel-delete-btn");
const statusText = document.getElementById("status-text");
const planOutput = document.getElementById("plan-output");
const contextMenu = document.getElementById("context-menu");
const menuOpen = document.getElementById("menu-open");
const menuCopy = document.getElementById("menu-copy");

let isCancelling = false;
let isDeleting = false;
let currentItems = [];
let refreshId = 0; // Abort stale searches
let menuUrl = "";
let truncated = false;
let renderedCount = 0;
let sentinel = null;
let sentinelObserver = null;

const HARD_CAP = 100000; // shortcut: sidebar memory guard (~30-50MB); upgrade = stream deletes beyond it
const RENDER_BATCH = 500;
const PLAN_ROWS = 50;

// Date inputs are "YYYY-MM-DD" and must be read as local time;
// new Date("...") alone would parse them as UTC and shift the range.
const dayStart = (value) => {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
};
const dayEnd = (value) => {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d + 1).getTime() - 1;
};

function makeRow(item, index) {
  const li = document.createElement("li");
  li.dataset.url = item.url;
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
  return li;
}

function renderNextBatch() {
  if (!sentinel) return;
  const end = Math.min(renderedCount + RENDER_BATCH, currentItems.length);
  const fragment = document.createDocumentFragment();
  for (let i = renderedCount; i < end; i++) fragment.appendChild(makeRow(currentItems[i], i));
  historyList.insertBefore(fragment, sentinel);
  renderedCount = end;
  if (renderedCount >= currentItems.length) {
    sentinelObserver.disconnect();
    sentinel.remove();
    sentinel = null;
  }
}

function updateMatchInfo() {
  const n = currentItems.length;
  if (!n) {
    matchInfo.textContent = "No matches.";
    return;
  }
  matchInfo.textContent = truncated
    ? "100,000 of 100,000+ matches — narrow the search or date range to get the rest."
    : `${n.toLocaleString()} match${n === 1 ? "" : "es"}.`;
}

function updateDeleteAllBtn() {
  const n = currentItems.length;
  deleteAllBtn.disabled = n === 0;
  deleteAllBtn.textContent = `Delete All ${n.toLocaleString()}`;
}

async function refreshHistory() {
  if (isDeleting) return; // Don't clobber during delete

  const query = searchInput.value;
  const start = dateStart.value ? dayStart(dateStart.value) : 0;
  const end = dateEnd.value ? dayEnd(dateEnd.value) : Date.now();

  const thisId = ++refreshId;
  let items;
  try {
    items = await browser.history.search({
      text: query,
      startTime: start,
      endTime: end,
      maxResults: HARD_CAP + 1, // one extra row reveals whether the cap was hit
    });
  } catch (err) {
    console.error("history.search failed", err);
    return;
  }

  if (thisId !== refreshId) return; // Stale request

  truncated = items.length > HARD_CAP;
  if (truncated) items = items.slice(0, HARD_CAP);
  currentItems = items;

  historyList.innerHTML = "";
  selectAll.checked = false;
  selectAll.indeterminate = false;
  renderedCount = 0;

  if (sentinelObserver) sentinelObserver.disconnect();
  sentinel = document.createElement("li");
  sentinel.id = "sentinel";
  historyList.appendChild(sentinel);
  sentinelObserver = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) renderNextBatch();
  });
  sentinelObserver.observe(sentinel);
  renderNextBatch();

  updateMatchInfo();
  updateDeleteAllBtn();
}

function formatPlan(groups, singles, cleanup) {
  const date = (t) => new Date(t).toLocaleString();
  const row = (item) =>
    `${date(item.lastVisitTime)}  ${item.id || "?"}  ${item.url}`;

  const lines = [`Singles (${singles.length})`];
  singles.slice(0, PLAN_ROWS).forEach((item) => lines.push(`  ${row(item)}`));
  if (singles.length > PLAN_ROWS) lines.push(`  … ${singles.length - PLAN_ROWS} more`);

  lines.push("", `Groups (${groups.length})`);
  groups.slice(0, PLAN_ROWS).forEach((group) => {
    lines.push(`  [${group.length} items] ${date(group[0].lastVisitTime)} → ${date(group[group.length - 1].lastVisitTime)}`);
    group
      .slice(0, PLAN_ROWS)
      .forEach((item) =>
        lines.push(`    ${row(item)}${cleanup.has(item.url) ? "  (also in Singles)" : ""}`)
      );
    if (group.length > PLAN_ROWS) lines.push(`    … ${group.length - PLAN_ROWS} more`);
  });
  if (groups.length > PLAN_ROWS) lines.push(`  … ${groups.length - PLAN_ROWS} more groups`);

  return lines.join("\n");
}

async function deleteSelected() {
  const checks = document.querySelectorAll(".item-check:checked");
  const selected = Array.from(checks)
    .map((c) => currentItems[parseInt(c.dataset.index)])
    .filter(Boolean);
  await runDelete(selected);
}

async function deleteAllMatches() {
  if (!currentItems.length) return;
  let msg = `Delete ${currentItems.length.toLocaleString()} items?`;
  if (truncated) msg += " More matches exist beyond the 100,000 limit — narrow the search to delete them too.";
  await runDelete(currentItems, msg);
}

async function runDelete(selected, confirmMessage) {
  if (!selected.length) return;

  const dryRun = !iMeanIt.checked;
  if (!dryRun && !confirm(confirmMessage || `Delete ${selected.length} ${selected.length === 1 ? "item" : "items"}?`)) return;

  isCancelling = false;
  isDeleting = true;
  cancelBtn.disabled = false;
  cancelBtn.textContent = "Cancel";
  planOutput.textContent = "";
  overlay.classList.add("active");
  statusText.textContent = "Fetching...";

  const total = selected.length;
  let done = 0;
  const failed = [];
  try {
    const selectedUrls = new Set(selected.map((item) => item.url));
    const times = selected.map((item) => item.lastVisitTime);
    // reduce, not spread: 100k args to Math.min can overflow the call stack
    const rangeStart = times.reduce((a, b) => Math.min(a, b));
    const rangeEnd = times.reduce((a, b) => Math.max(a, b));

    // Ground truth: the same span WITHOUT the text filter. A range delete is
    // only safe where this list proves the window holds the selected rows and
    // nothing else. Widening by 1ms keeps boundary rows inside search().
    const allUrls = await browser.history.search({
      text: "",
      startTime: rangeStart - 1,
      endTime: rangeEnd + 1,
      maxResults: HARD_CAP + 1,
    });
    allUrls.sort((a, b) => a.lastVisitTime - b.lastVisitTime);

    const allUrlsTruncated = allUrls.length > HARD_CAP;
    if (allUrlsTruncated) console.warn("allUrls truncated, falling back to per-URL deletes");

    // Maximal runs of consecutive selected rows in the unfiltered list.
    // A run is only range-safe if no unselected row sits on its ±1ms boundary.
    const groups = [];
    let run = [];
    let prev = null;
    const closeRun = (next) => {
      if (run.length >= 2) {
        const first = run[0].lastVisitTime;
        const last = run[run.length - 1].lastVisitTime;
        const safe =
          (!prev || prev.lastVisitTime < first - 1) &&
          (!next || next.lastVisitTime > last + 1);
        if (safe) groups.push(run);
      }
      run = [];
    };
    if (!allUrlsTruncated) {
      for (const row of allUrls) {
        if (selectedUrls.has(row.url)) {
          run.push(row);
        } else {
          closeRun(row);
          prev = row;
        }
      }
      closeRun(null);
    }

    // history.search returns one row per URL and the row's lastVisitTime is the
    // page's global last visit, so it says nothing about the page's other
    // visits, while deleteRange removes visits only. Check the real visits of
    // every grouped URL: any visit outside the run window means the page
    // survives the range delete and also needs an individual deleteUrl.
    // visit_count cannot be used as a shortcut: it excludes reload/embed visits.
    const cleanup = new Set();
    const checks = [];
    for (const group of groups) {
      const start = group[0].lastVisitTime - 1;
      const end = group[group.length - 1].lastVisitTime + 1;
      for (const row of group) checks.push({ url: row.url, start, end });
    }
    for (let i = 0; i < checks.length; i += 50) {
      await Promise.all(
        checks.slice(i, i + 50).map(async ({ url, start, end }) => {
          try {
            const visits = await browser.history.getVisits({ url });
            if (visits.some((v) => v.visitTime < start || v.visitTime > end)) cleanup.add(url);
          } catch (err) {
            console.error("getVisits failed", url, err);
            cleanup.add(url);
          }
        })
      );
    }

    const grouped = new Set(groups.flat().map((row) => row.url));
    const singles = selected.filter((item) => !grouped.has(item.url) || cleanup.has(item.url));

    if (dryRun) {
      statusText.textContent = `Dry run — ${total} items would be deleted, nothing changed.`;
      cancelBtn.textContent = "Close";
      planOutput.textContent = formatPlan(groups, singles, cleanup);
      return;
    }

    statusText.textContent = `Deleting... 0/${total}`;

    for (const group of groups) {
      if (isCancelling) break;
      try {
        await browser.history.deleteRange({
          startTime: group[0].lastVisitTime - 1,
          endTime: group[group.length - 1].lastVisitTime + 1,
        });
        done += group.filter((row) => !cleanup.has(row.url)).length;
      } catch (err) {
        console.error("deleteRange failed", group[0].url, err);
        for (const row of group) failed.push(row.url);
      }
      statusText.textContent = `Deleting... ${done}/${total}`;
    }

    for (let i = 0; i < singles.length; i += 50) {
      if (isCancelling) break;
      await Promise.all(
        singles.slice(i, i + 50).map(async (item) => {
          try {
            await browser.history.deleteUrl({ url: item.url });
            done++;
          } catch (err) {
            console.error("deleteUrl failed", item.url, err);
            failed.push(item.url);
          }
        })
      );
      statusText.textContent = `Deleting... ${done}/${total}`;
    }
  } catch (err) {
    console.error("delete failed", err);
    failed.push("unexpected");
    if (dryRun) statusText.textContent = "Dry run failed — check console.";
  } finally {
    isDeleting = false;

    if (dryRun) {
      cancelBtn.disabled = false; // doubles as Close; overlay stays open
    } else {
      cancelBtn.disabled = true;
      if (failed.length) {
        statusText.textContent = `Deleted ${done}/${total}. ${failed.length} failed — check console.`;
      } else if (isCancelling) {
        statusText.textContent = `Cancelled — deleted ${done}/${total}.`;
      } else {
        statusText.textContent = `Deleted ${done} ${done === 1 ? "item" : "items"}.`;
      }

      await refreshHistory();
      // Leave the result on screen long enough to read it.
      setTimeout(() => {
        if (!isDeleting) overlay.classList.remove("active");
      }, 1500);
    }
  }
}

// Event Listeners
cancelBtn.addEventListener("click", () => {
  isCancelling = true;
  if (isDeleting) statusText.textContent = "Cancelling...";
  else overlay.classList.remove("active");
});

// Esc closes the context menu and the dry-run plan; a running deletion keeps
// going (cancel is a button).
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  hideMenu();
  if (!isDeleting) overlay.classList.remove("active");
});

deleteBtn.addEventListener("click", deleteSelected);
deleteAllBtn.addEventListener("click", deleteAllMatches);

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

function syncSelectAll() {
  const boxes = Array.from(document.querySelectorAll(".item-check"));
  const checked = boxes.filter((c) => c.checked).length;
  selectAll.checked = boxes.length > 0 && checked === boxes.length;
  selectAll.indeterminate = checked > 0 && checked < boxes.length;
}

selectAll.addEventListener("change", (e) => {
  document.querySelectorAll(".item-check").forEach((c) => (c.checked = e.target.checked));
});

historyList.addEventListener("change", syncSelectAll);

// Left click anywhere on a row toggles it; the checkbox keeps its own behavior.
historyList.addEventListener("click", (e) => {
  if (e.target.closest("input")) return;
  const li = e.target.closest("li[data-url]");
  if (!li) return;
  const box = li.querySelector(".item-check");
  box.checked = !box.checked;
  syncSelectAll();
});

function hideMenu() {
  contextMenu.classList.remove("active");
  menuUrl = "";
}

historyList.addEventListener("contextmenu", (e) => {
  const li = e.target.closest("li[data-url]");
  if (!li) return;
  e.preventDefault();
  menuUrl = li.dataset.url;
  contextMenu.classList.add("active");
  const left = Math.min(e.clientX, window.innerWidth - contextMenu.offsetWidth - 4);
  const top = Math.min(e.clientY, window.innerHeight - contextMenu.offsetHeight - 4);
  contextMenu.style.left = `${Math.max(4, left)}px`;
  contextMenu.style.top = `${Math.max(4, top)}px`;
});

// Right click anywhere else closes this menu (and leaves the browser's own).
document.addEventListener("contextmenu", (e) => {
  if (!e.target.closest("li[data-url]")) hideMenu();
});

document.addEventListener("click", (e) => {
  if (!contextMenu.contains(e.target)) hideMenu();
});

document.addEventListener("scroll", hideMenu, true);

menuOpen.addEventListener("click", () => {
  if (menuUrl) {
    browser.tabs.create({ url: menuUrl }).catch((err) => console.error("tabs.create failed", err));
  }
  hideMenu();
});

menuCopy.addEventListener("click", async () => {
  const url = menuUrl;
  hideMenu();
  try {
    await navigator.clipboard.writeText(url);
  } catch (err) {
    console.error("clipboard write failed", err);
  }
});

// Other windows or "Clear recent history" should update this list too.
browser.history.onVisitRemoved.addListener(() => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(refreshHistory, 150);
});

refreshHistory();

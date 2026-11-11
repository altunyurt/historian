# Release notes

## Unreleased

- Result cap raised 1000 → 100,000; the list renders in 500-row batches as you scroll.
- **Select All** covers every match, including rows not yet rendered; Delete Selected then removes them all.
- Rows unchecked after Select All are kept; the header checkbox shows the partial state.
- Select All + Delete Selected warns when more matches exist beyond the cap.
- Single-URL deletes run in parallel batches of 50, so large deletes finish in minutes instead of tens of minutes.
- **I mean it** is replaced by a **Dry Run** checkbox: checked = plan only, nothing deleted; unchecked = real delete after a confirm.
- The search field has an ✕ button that clears the text.

## 1.2

### Deleting

- Delete Selected is a dry run by default. It lists what would be removed and changes nothing until **I mean it** is checked.
- The report shows two sections: single URLs, and consecutive groups of rows. Every entry carries its visit date and page id.
- A group is removed with one time-range delete. Singles are removed one URL at a time.
- A range delete runs only when the unfiltered database window contains exactly the selected rows, boundary rows included.
- Grouped pages that hold visits outside the chosen range get an individual delete as well.
- Cancel stops a running delete between items.

### Selection and menu

- Clicking a history row toggles its checkbox.
- Right-click a row for **Open in New Tab** and **Copy URL**.
- Select All Visible reflects partial selections.
- Esc closes the context menu and the dry-run report.

### Filters and list

- Date inputs cover the local day from 00:00:00.000 to 23:59:59.999.
- A notice appears when the list hits the 1000-result cap.
- The list refreshes when history changes in other windows.

# Changelog

## [2025-03-14] - Dashboard & Map UX Improvements

### Added
- **Gate search filter**: Search input now filters passengers by gate. Type a gate name (e.g., E21, B3, G13) to show only passengers boarding at that gate. Applies to both Dashboard table and Map view.
- **Pax button**: Top bar "Pax: N" chip is now clickable. Click to reset view and show all passengers on the map.
- **Urgent button**: Top bar "Urgent: N" chip is now clickable. Click to filter map to show only urgent/priority passengers.

### Changed
- **Open button (Pax Simulator)**: Clicking "Open" next to a passenger (e.g., Siyao Fu) now opens the chat panel on the right side of the current interface instead of navigating to a new page. Requires Map tab and wide screen (≥1180px) for docked chat.
- **Map filter on passenger selection**: When clicking a passenger in Priority List or Dashboard, the map now filters to show only that passenger. Other passengers are hidden.
- **Map marker selection**: Clicking a passenger marker on the map also filters to single-passenger view. Clicking the same marker again resets to show all passengers.

### Fixed
- Gate search was previously non-functional; it now correctly filters the passenger list by gate ID/name.

Here's a comprehensive technical specification for your Facility Doctor Scheduling App.

---

## Technical Specification: Facility Doctor Scheduling Planner

### 1. Domain Model

**Facility**
```
{
  id: string (UUID),
  name: string,
  roomCount: number,
  openingHours: DaySchedule[],       // 7 entries, one per weekday
  specialRequirements: SpecialRequirement[],
  hourQuotas: HourQuota[]
}
```

**DaySchedule** — models opening hours *with breaks* (multiple time blocks per day):
```
{
  day: 0–6 (Mon–Sun),
  enabled: boolean,
  blocks: TimeBlock[]    // e.g. [{start:"08:00", end:"12:00"}, {start:"13:00", end:"17:00"}]
}
```

**TimeBlock**
```
{ start: string "HH:MM", end: string "HH:MM" }
```

**SpecialRequirement** — "a doctor of specialty X must be on-site during period Y on days Z":
```
{
  id: string,
  specialty: string,
  days: number[],             // subset of 0–6
  timeBlock: TimeBlock,       // when during those days
  startDate?: string,         // optional bounding dates
  endDate?: string
}
```

**HourQuota** — "specialty X must have at least N total hours per week at this facility":
```
{
  id: string,
  specialty: string,
  minHoursPerWeek: number
}
```

**Doctor**
```
{
  id: string,
  name: string,
  specialty: string,
  availability: DoctorDayAvailability[]   // 7 entries
}
```

**DoctorDayAvailability**
```
{
  day: 0–6,
  blocks: TimeBlock[]    // when the doctor is available that day
}
```

### 2. Core Constraint Logic (The Solver)

The allocation algorithm runs client-side in JS. It doesn't assign rooms (per your spec), so it's a **coverage and quota feasibility problem**, not a room-packing problem. The solver should proceed in phases:

**Phase 1 — Clamp & Flag.** For each doctor, intersect their availability blocks with the facility's opening blocks for the same day. The result is the doctor's *effective schedule* — the hours they'll actually work. If any of the doctor's original availability falls outside facility hours, flag that doctor for the red-highlight UI warning. Store both the raw and clamped availability.

**Phase 2 — Mandatory Coverage Check.** For every facility opening block on every day, verify that at least one doctor's effective schedule fully covers it. Use an interval-union approach: merge all doctors' effective blocks for that day, then confirm the union is a superset of the facility's opening block. If not, fail with: `"No doctor coverage on {Day} from {gap_start} to {gap_end}"`.

**Phase 3 — Special Requirement Check.** For each `SpecialRequirement`, filter doctors by matching specialty, then for each required day, check that at least one matching doctor's effective schedule covers the requirement's `timeBlock`. Fail with: `"Specialty {X} not covered on {Day} {start}–{end}"`.

**Phase 4 — Hour Quota Check.** For each `HourQuota`, sum up the total effective weekly hours across all doctors with that specialty. Compare against `minHoursPerWeek`. Fail with: `"Specialty {X} has {Y}h allocated but requires {Z}h minimum"`.

**Phase 5 — Build the Plan.** If all checks pass, the plan is simply every doctor assigned to their effective (clamped) schedule. Compute `totalWeeklyHours` per doctor by summing block durations across all days.

The key data structure for interval operations:

```
function mergeIntervals(blocks: TimeBlock[]): TimeBlock[]
function intersectIntervals(a: TimeBlock[], b: TimeBlock[]): TimeBlock[]
function coversInterval(union: TimeBlock[], target: TimeBlock): boolean
function totalMinutes(blocks: TimeBlock[]): number
```

All time math should convert `"HH:MM"` to minutes-since-midnight integers internally and convert back for display.

### 3. UI Architecture (Single HTML File)

The app is a single `index.html` using vanilla JS (or optionally React via CDN). State lives in a single JS object. The layout has four main sections, shown as tabs or a vertical stepper:

**Tab 1 — Facility Setup**
- Text input for name, number input for rooms.
- A 7-row table (Mon–Sun). Each row has an enabled toggle and a list of `TimeBlock` inputs (start/end time pickers) with add/remove buttons for breaks. This models the "opening hours with breaks" requirement naturally.
- A sub-section for Special Requirements: a repeatable form group with fields for specialty (dropdown or free text), day checkboxes, start/end time, optional date range. Add/remove buttons.
- A sub-section for Hour Quotas: repeatable rows of specialty + minimum hours.

**Tab 2 — Doctors**
- A card list or table of doctors. Each card shows name, specialty, and a compact weekly availability grid.
- "Add Doctor" button opens an inline form: name, specialty, and a 7-row availability editor identical in structure to the facility hours editor (day + multiple time blocks).
- **Red highlight logic**: On each doctor card, for each day, compare the doctor's raw availability blocks against the facility's opening blocks. Any portion of the doctor's time that doesn't intersect facility hours gets rendered with a red background and a tooltip: "Outside facility hours — will be clamped."
- Edit and delete buttons per doctor.

**Tab 3 — Generate Plan**
- A single "Generate Plan" button.
- On click, run the solver. If it fails, show a modal dialog with the specific failure reason(s) from the solver (which phase failed, which constraint, which day/time/specialty).
- On success, render the plan view.

**Plan View (rendered on Tab 3 after generation):**
- **Facility header**: Name, opening hours summary.
- **Doctor table**: Columns — Doctor Name, Specialty, Mon through Sun (each cell showing their effective working blocks as formatted time ranges), Total Hours/Week. This is a single printable/scrollable table.
- Style the total hours column prominently. Optionally color-code by specialty.

### 4. State Shape & Persistence

All app state lives in one serializable object:

```
{
  version: 1,
  facility: { ...Facility },
  doctors: [ ...Doctor[] ],
  generatedPlan: null | Plan     // not saved — regenerated on demand
}
```

**Save**: Serialize the state (excluding `generatedPlan`) to JSON, trigger a `Blob` download as `.json` file via a dynamically created `<a>` element with `URL.createObjectURL`.

**Load**: A file input accepts `.json`, parses it, validates the schema version and basic structure, then hydrates the app state and re-renders all tabs.

Put Save/Load buttons in a persistent header/toolbar. On load, run a lightweight schema validator that checks for required fields and correct types — if validation fails, show an error toast rather than crashing.

### 5. Interval Math Utilities (Critical Path)

These are the most error-prone parts to implement. Spec them precisely:

`toMinutes("HH:MM") → number` — e.g. "13:30" → 810.

`toTimeString(minutes) → "HH:MM"` — inverse.

`mergeIntervals(blocks[]) → blocks[]` — sort by start, merge overlapping/adjacent. Standard sweep-line.

`intersectIntervals(a[], b[]) → blocks[]` — two-pointer merge of sorted interval lists, emitting overlaps.

`subtractIntervals(a[], b[]) → blocks[]` — useful for computing "doctor time outside facility hours" for the red highlight.

`coversInterval(union[], target) → boolean` — after merging union, check that target.start ≥ some block.start and target.end ≤ that block.end (or spans consecutive blocks with no gap).

`sumMinutes(blocks[]) → number` — total duration.

### 6. Edge Cases to Handle

- A doctor whose availability has zero intersection with facility hours — allow adding them, but show a warning that they contribute zero effective hours.
- Facility closed on a day but a doctor is marked available — just clamp to zero, no error.
- Overlapping time blocks in user input (e.g., doctor available 08:00–12:00 and 11:00–15:00) — merge them silently on save.
- Special requirement referencing a specialty that no doctor has — solver should fail with a clear message.
- Empty doctor list — solver fails with "No doctors assigned."
- Hour quota of 0 — trivially satisfied, ignore.

### 7. Suggested Implementation Order

1. **Interval math utilities** with unit tests (console-based). This is the foundation everything depends on.
2. **State management** — the central state object, render loop (or reactive framework).
3. **Facility Setup tab** — opening hours editor with the multi-block-per-day UI.
4. **Doctor tab** — CRUD for doctors, availability editor, red-highlight logic.
5. **Solver** — implement the four-phase algorithm.
6. **Plan display** — the results table.
7. **Persistence** — save/load JSON.
8. **Modal for errors** — constraint failure display.
9. **Polish** — validation, edge cases, responsive layout.

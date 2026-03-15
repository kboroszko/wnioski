// ─── CONSTANTS ─────────────────────────────────
export const DAYS = ['Pon','Wt','Śr','Czw','Pt','Sob','Ndz'];

// ─── INTERVAL MATH ─────────────────────────────────
export function toMinutes(hhmm) {
  if (!hhmm) return 0;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function toTimeString(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
}

export function mergeIntervals(blocks) {
  if (!blocks || blocks.length === 0) return [];
  const sorted = blocks.map(b => ({ s: toMinutes(b.start), e: toMinutes(b.end) }))
    .filter(b => b.e > b.s).sort((a,b) => a.s - b.s);
  if (sorted.length === 0) return [];
  const merged = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].s <= last.e) {
      last.e = Math.max(last.e, sorted[i].e);
    } else {
      merged.push(sorted[i]);
    }
  }
  return merged.map(b => ({ start: toTimeString(b.s), end: toTimeString(b.e) }));
}

export function intersectIntervals(a, b) {
  if (!a || !b || a.length === 0 || b.length === 0) return [];
  const sa = a.map(x => ({ s: toMinutes(x.start), e: toMinutes(x.end) })).sort((x,y) => x.s - y.s);
  const sb = b.map(x => ({ s: toMinutes(x.start), e: toMinutes(x.end) })).sort((x,y) => x.s - y.s);
  const result = [];
  let i = 0, j = 0;
  while (i < sa.length && j < sb.length) {
    const lo = Math.max(sa[i].s, sb[j].s);
    const hi = Math.min(sa[i].e, sb[j].e);
    if (lo < hi) result.push({ start: toTimeString(lo), end: toTimeString(hi) });
    if (sa[i].e < sb[j].e) i++; else j++;
  }
  return result;
}

export function subtractIntervals(a, b) {
  if (!a || a.length === 0) return [];
  if (!b || b.length === 0) return [...a];
  let result = a.map(x => ({ s: toMinutes(x.start), e: toMinutes(x.end) }));
  const cuts = b.map(x => ({ s: toMinutes(x.start), e: toMinutes(x.end) })).sort((x,y) => x.s - y.s);
  for (const cut of cuts) {
    const next = [];
    for (const seg of result) {
      if (seg.e <= cut.s || seg.s >= cut.e) { next.push(seg); continue; }
      if (seg.s < cut.s) next.push({ s: seg.s, e: cut.s });
      if (seg.e > cut.e) next.push({ s: cut.e, e: seg.e });
    }
    result = next;
  }
  return result.filter(b => b.e > b.s).map(b => ({ start: toTimeString(b.s), end: toTimeString(b.e) }));
}

export function coversInterval(union, target) {
  const merged = mergeIntervals(union);
  const ts = toMinutes(target.start), te = toMinutes(target.end);
  for (const b of merged) {
    if (toMinutes(b.start) <= ts && toMinutes(b.end) >= te) return true;
  }
  return false;
}

export function sumMinutes(blocks) {
  if (!blocks) return 0;
  return blocks.reduce((s, b) => s + (toMinutes(b.end) - toMinutes(b.start)), 0);
}

// ─── SPECIALTY LEVEL MATCHING ─────────────────────
export function matchesSpecialtyLevel(doctor, specReq) {
  if (doctor.specialty !== specReq.specialty) return false;
  if (specReq.level != null && specReq.level !== doctor.level) return false;
  return true;
}

// ─── SOLVER ────────────────────────────────────────
export function runSolver(facility, doctors) {
  const errors = [];
  if (!doctors || doctors.length === 0) {
    return { success: false, errors: ['Brak przypisanych lekarzy.'] };
  }

  // Phase 1: Clamp
  const effectiveSchedules = doctors.map(doc => {
    const effective = [];
    let hasClamp = false;
    for (let day = 0; day < 7; day++) {
      const facDay = facility.openingHours[day];
      const docDay = doc.availability[day];
      if (!facDay.enabled || !docDay.blocks || docDay.blocks.length === 0) {
        effective.push({ day, blocks: [] });
        if (docDay.blocks && docDay.blocks.length > 0 && !facDay.enabled) {
          // doctor available on closed day
        }
        continue;
      }
      const facBlocks = mergeIntervals(facDay.blocks);
      const docBlocks = mergeIntervals(docDay.blocks);
      const clamped = intersectIntervals(docBlocks, facBlocks);
      const outside = subtractIntervals(docBlocks, facBlocks);
      if (outside.length > 0) hasClamp = true;
      effective.push({ day, blocks: clamped, outside });
    }
    return { doctor: doc, effective, hasClamp };
  });

  // Phase 2: Mandatory Coverage
  for (let day = 0; day < 7; day++) {
    const facDay = facility.openingHours[day];
    if (!facDay.enabled) continue;
    const facBlocks = mergeIntervals(facDay.blocks);
    const allDocBlocks = [];
    effectiveSchedules.forEach(es => {
      es.effective[day].blocks.forEach(b => allDocBlocks.push(b));
    });
    const union = mergeIntervals(allDocBlocks);
    for (const fb of facBlocks) {
      const gaps = subtractIntervals([fb], union);
      for (const gap of gaps) {
        errors.push(`Brak pokrycia lekarskiego w ${DAYS[day]} od ${gap.start} do ${gap.end}`);
      }
    }
  }

  // Phase 2.5: Room Capacity
  for (let day = 0; day < 7; day++) {
    const facDay = facility.openingHours[day];
    if (!facDay.enabled) continue;
    const events = [];
    effectiveSchedules.forEach(es => {
      es.effective[day].blocks.forEach(b => {
        events.push({ t: toMinutes(b.start), type: 1 });
        events.push({ t: toMinutes(b.end), type: -1 });
      });
    });
    events.sort((a, b) => a.t - b.t || a.type - b.type);
    let concurrent = 0;
    let overStart = null;
    let peakConcurrent = 0;
    for (const ev of events) {
      concurrent += ev.type;
      if (concurrent > facility.roomCount) {
        if (overStart === null) {
          overStart = ev.t;
          peakConcurrent = concurrent;
        } else {
          peakConcurrent = Math.max(peakConcurrent, concurrent);
        }
      } else if (concurrent <= facility.roomCount && overStart !== null) {
        errors.push(`Zbyt wielu lekarzy w ${DAYS[day]} od ${toTimeString(overStart)} do ${toTimeString(ev.t)} — ${peakConcurrent} lekarzy, ${facility.roomCount} gabinetów`);
        overStart = null;
        peakConcurrent = 0;
      }
    }
    if (overStart !== null) {
      errors.push(`Zbyt wielu lekarzy w ${DAYS[day]} od ${toTimeString(overStart)} — przekroczono limit ${facility.roomCount} gabinetów`);
    }
  }

  // Phase 3: Special Requirements
  for (const req of (facility.specialRequirements || [])) {
    for (const day of req.days) {
      const facDay = facility.openingHours[day];
      if (!facDay.enabled) continue;
      const matching = effectiveSchedules.filter(es => matchesSpecialtyLevel(es.doctor, req));
      const levelLabel = req.level != null ? ` (poziom: ${req.level})` : '';
      if (matching.length === 0) {
        errors.push(`Specjalizacja „${req.specialty}"${levelLabel} nie pokryta w ${DAYS[day]} ${req.timeBlock.start}–${req.timeBlock.end} — brak lekarzy z tą specjalizacją`);
        continue;
      }
      const matchBlocks = [];
      matching.forEach(es => { es.effective[day].blocks.forEach(b => matchBlocks.push(b)); });
      if (!coversInterval(mergeIntervals(matchBlocks), req.timeBlock)) {
        errors.push(`Specjalizacja „${req.specialty}"${levelLabel} nie pokryta w ${DAYS[day]} ${req.timeBlock.start}–${req.timeBlock.end}`);
      }
    }
  }

  // Phase 4: Hour Quotas
  for (const quota of (facility.hourQuotas || [])) {
    if (quota.minHoursPerWeek <= 0) continue;
    let totalMins = 0;
    effectiveSchedules.forEach(es => {
      if (matchesSpecialtyLevel(es.doctor, quota)) {
        es.effective.forEach(d => { totalMins += sumMinutes(d.blocks); });
      }
    });
    const totalHrs = totalMins / 60;
    if (totalHrs < quota.minHoursPerWeek) {
      errors.push(`Specjalizacja „${quota.specialty}" ma przydzielone ${totalHrs.toFixed(1)}h, wymagane minimum ${quota.minHoursPerWeek}h`);
    }
  }

  if (errors.length > 0) return { success: false, errors };

  // Phase 5: Build plan
  const plan = effectiveSchedules.map(es => {
    let totalMins = 0;
    const weekSchedule = es.effective.map(d => {
      totalMins += sumMinutes(d.blocks);
      return d.blocks;
    });
    return {
      doctorId: es.doctor.id,
      doctorName: es.doctor.name,
      specialty: es.doctor.specialty,
      level: es.doctor.level || null,
      weekSchedule,
      totalWeeklyHours: totalMins / 60,
      hasClamp: es.hasClamp,
    };
  });

  return { success: true, plan };
}

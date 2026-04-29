import { DAYS, toMinutes, toTimeString, mergeIntervals, intersectIntervals, subtractIntervals, coversInterval, sumMinutes, matchesSpecialtyLevel, runSolver, normalizeName, checkCrossFacilityConflicts } from './solver.js';

// ─── HELPERS ───────────────────────────────────────

function makeFacility(overrides = {}) {
  return {
    id: 'fac-1',
    name: 'Test Facility',
    roomCount: 1,
    openingHours: Array.from({ length: 7 }, (_, i) => ({
      day: i,
      enabled: i < 5,
      blocks: i < 5 ? [{ start: '08:00', end: '17:00' }] : [],
    })),
    specialRequirements: [],
    hourQuotas: [],
    ...overrides,
  };
}

function makeDoctor(name, specialty, availability, level = null) {
  return {
    id: `doc-${name.toLowerCase().replace(/\s+/g, '-')}`,
    name,
    specialty,
    level,
    availability: Array.from({ length: 7 }, (_, i) => ({
      day: i,
      blocks: availability[i] || [],
    })),
  };
}

// ─── TESTS ─────────────────────────────────────────

describe('runSolver', () => {
  // 1. Empty/null doctors
  test('returns failure with "Brak przypisanego personelu." when doctors array is empty', () => {
    const facility = makeFacility();
    const result = runSolver(facility, []);
    expect(result.success).toBe(false);
    expect(result.errors).toContain('Brak przypisanego personelu.');
  });

  test('returns failure with "Brak przypisanego personelu." when doctors is null', () => {
    const facility = makeFacility();
    const result = runSolver(facility, null);
    expect(result.success).toBe(false);
    expect(result.errors).toContain('Brak przypisanego personelu.');
  });

  // 2. Phase 1 clamping — doctor outside facility hours gets clamped
  test('Phase 1: clamps doctor hours to facility hours, hasClamp = true', () => {
    const facility = makeFacility();
    // Doctor available 06:00–20:00 Mon-Fri (wider than facility 08:00–17:00)
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '06:00', end: '20:00' }];
    const doctor = makeDoctor('Dr. Wide', 'General', weekBlocks);
    const result = runSolver(facility, [doctor]);
    expect(result.success).toBe(true);
    const plan = result.plan[0];
    expect(plan.hasClamp).toBe(true);
    // Mon schedule should be clamped to 08:00–17:00
    expect(plan.weekSchedule[0]).toEqual([{ start: '08:00', end: '17:00' }]);
  });

  // 3. Phase 1 no clamp — doctor within facility hours
  test('Phase 1: doctor within facility hours, hasClamp = false', () => {
    const facility = makeFacility({ roomCount: 2 });
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '09:00', end: '16:00' }];
    const doctor = makeDoctor('Dr. Narrow', 'General', weekBlocks);
    // Need full coverage for Phase 2 to pass — add another doctor
    const weekBlocksFull = {};
    for (let i = 0; i < 5; i++) weekBlocksFull[i] = [{ start: '08:00', end: '17:00' }];
    const doctor2 = makeDoctor('Dr. Full', 'General', weekBlocksFull);
    const result = runSolver(facility, [doctor, doctor2]);
    expect(result.success).toBe(true);
    const narrowPlan = result.plan.find(p => p.doctorName === 'Dr. Narrow');
    expect(narrowPlan.hasClamp).toBe(false);
  });

  // 4. Phase 1 closed day — doctor available on closed day gets empty blocks
  test('Phase 1: doctor available on closed day gets empty blocks', () => {
    const facility = makeFacility();
    // Doctor available all 7 days
    const weekBlocks = {};
    for (let i = 0; i < 7; i++) weekBlocks[i] = [{ start: '08:00', end: '17:00' }];
    const doctor = makeDoctor('Dr. Everyday', 'General', weekBlocks);
    const result = runSolver(facility, [doctor]);
    expect(result.success).toBe(true);
    // Saturday (5) and Sunday (6) should have empty blocks
    expect(result.plan[0].weekSchedule[5]).toEqual([]);
    expect(result.plan[0].weekSchedule[6]).toEqual([]);
  });

  // 5. Phase 2 full coverage — single doctor covers full facility hours
  test('Phase 2: single doctor covers full facility hours → success', () => {
    const facility = makeFacility();
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '08:00', end: '17:00' }];
    const doctor = makeDoctor('Dr. Full', 'General', weekBlocks);
    const result = runSolver(facility, [doctor]);
    expect(result.success).toBe(true);
  });

  // 6. Phase 2 gap — doctor only covers partial hours
  test('Phase 2: gap in coverage → error naming the gaps', () => {
    const facility = makeFacility();
    // Doctor only covers 08:00–12:00 Mon-Fri
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '08:00', end: '12:00' }];
    const doctor = makeDoctor('Dr. Morning', 'General', weekBlocks);
    const result = runSolver(facility, [doctor]);
    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.includes('Brak pokrycia personelu w Pon od 12:00 do 17:00'))).toBe(true);
  });

  // 7. Phase 2 two doctors cover — combined coverage fills all hours
  test('Phase 2: two doctors combined fill all hours → success', () => {
    const facility = makeFacility({ roomCount: 2 });
    const morningBlocks = {};
    const afternoonBlocks = {};
    for (let i = 0; i < 5; i++) {
      morningBlocks[i] = [{ start: '08:00', end: '13:00' }];
      afternoonBlocks[i] = [{ start: '12:00', end: '17:00' }];
    }
    const doc1 = makeDoctor('Dr. AM', 'General', morningBlocks);
    const doc2 = makeDoctor('Dr. PM', 'General', afternoonBlocks);
    const result = runSolver(facility, [doc1, doc2]);
    expect(result.success).toBe(true);
  });

  // 8. Phase 3 specialty met — matching specialty doctor present
  test('Phase 3: specialty requirement met → success', () => {
    const facility = makeFacility({
      specialRequirements: [{
        id: 'req-1',
        specialty: 'Cardiology',
        days: [0, 1, 2, 3, 4],
        timeBlock: { start: '09:00', end: '12:00' },
      }],
    });
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '08:00', end: '17:00' }];
    const doctor = makeDoctor('Dr. Heart', 'Cardiology', weekBlocks);
    const result = runSolver(facility, [doctor]);
    expect(result.success).toBe(true);
  });

  // 9. Phase 3 no specialty — no doctor with required specialty
  test('Phase 3: no doctor with required specialty → error', () => {
    const facility = makeFacility({
      specialRequirements: [{
        id: 'req-1',
        specialty: 'Cardiology',
        days: [0],
        timeBlock: { start: '09:00', end: '12:00' },
      }],
    });
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '08:00', end: '17:00' }];
    const doctor = makeDoctor('Dr. General', 'General', weekBlocks);
    const result = runSolver(facility, [doctor]);
    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.includes('Cardiology') && e.includes('brak pracowników z tą specjalizacją'))).toBe(true);
  });

  // 10. Phase 3 partial specialty — specialty doctor doesn't cover full required block
  test('Phase 3: specialty doctor does not cover full required block → error', () => {
    const facility = makeFacility({
      roomCount: 2,
      specialRequirements: [{
        id: 'req-1',
        specialty: 'Cardiology',
        days: [0],
        timeBlock: { start: '09:00', end: '15:00' },
      }],
    });
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '08:00', end: '17:00' }];
    // Cardiologist only available 09:00–12:00
    const cardioBlocks = {};
    for (let i = 0; i < 5; i++) cardioBlocks[i] = [{ start: '09:00', end: '12:00' }];
    const doc1 = makeDoctor('Dr. General', 'General', weekBlocks);
    const doc2 = makeDoctor('Dr. Heart', 'Cardiology', cardioBlocks);
    const result = runSolver(facility, [doc1, doc2]);
    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.includes('Cardiology') && e.includes('Pon'))).toBe(true);
  });

  // 11. Phase 4 quota met — enough hours for specialty
  test('Phase 4: quota met → success', () => {
    const facility = makeFacility({
      hourQuotas: [{ id: 'q-1', specialties: [{ name: 'General', level: null }], minHoursPerWeek: 10 }],
    });
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '08:00', end: '17:00' }];
    const doctor = makeDoctor('Dr. Full', 'General', weekBlocks);
    const result = runSolver(facility, [doctor]);
    expect(result.success).toBe(true);
  });

  // 12. Phase 4 quota unmet — insufficient hours
  test('Phase 4: quota unmet → error with actual vs required', () => {
    const facility = makeFacility({
      hourQuotas: [{ id: 'q-1', specialties: [{ name: 'Radiology', level: null }], minHoursPerWeek: 20 }],
    });
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '08:00', end: '17:00' }];
    // Only a General doctor, no Radiology
    const doctor = makeDoctor('Dr. Full', 'General', weekBlocks);
    const result = runSolver(facility, [doctor]);
    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.includes('Radiology') && e.includes('0.0h') && e.includes('20h'))).toBe(true);
  });

  // 13. Phase 4 zero quota — minHoursPerWeek: 0 skipped silently
  test('Phase 4: zero quota is skipped silently', () => {
    const facility = makeFacility({
      hourQuotas: [{ id: 'q-1', specialties: [{ name: 'Radiology', level: null }], minHoursPerWeek: 0 }],
    });
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '08:00', end: '17:00' }];
    const doctor = makeDoctor('Dr. Full', 'General', weekBlocks);
    const result = runSolver(facility, [doctor]);
    expect(result.success).toBe(true);
  });

  // 14. Phase 5 plan shape — verify output has correct fields and types
  test('Phase 5: plan entries have correct fields and types', () => {
    const facility = makeFacility();
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '08:00', end: '17:00' }];
    const doctor = makeDoctor('Dr. Full', 'General', weekBlocks);
    const result = runSolver(facility, [doctor]);
    expect(result.success).toBe(true);
    const p = result.plan[0];
    expect(typeof p.doctorId).toBe('string');
    expect(typeof p.doctorName).toBe('string');
    expect(typeof p.specialty).toBe('string');
    expect(Array.isArray(p.weekSchedule)).toBe(true);
    expect(p.weekSchedule).toHaveLength(7);
    expect(typeof p.totalWeeklyHours).toBe('number');
    expect(typeof p.hasClamp).toBe('boolean');
  });

  // 15. Phase 5 hours calculation — verify totalWeeklyHours arithmetic
  test('Phase 5: totalWeeklyHours is calculated correctly', () => {
    const facility = makeFacility();
    // Doctor works 08:00–17:00 Mon-Fri = 9h * 5 = 45h
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '08:00', end: '17:00' }];
    const doctor = makeDoctor('Dr. Full', 'General', weekBlocks);
    const result = runSolver(facility, [doctor]);
    expect(result.success).toBe(true);
    expect(result.plan[0].totalWeeklyHours).toBe(45);
  });

  // 16. Integration — full realistic scenario with requirements + quotas
  test('Integration: realistic scenario with specialty requirements and quotas → success', () => {
    const facility = makeFacility({
      roomCount: 2,
      specialRequirements: [{
        id: 'req-1',
        specialty: 'Cardiology',
        days: [0, 2, 4], // Mon, Wed, Fri
        timeBlock: { start: '09:00', end: '12:00' },
      }],
      hourQuotas: [
        { id: 'q-1', specialties: [{ name: 'General', level: null }], minHoursPerWeek: 20 },
        { id: 'q-2', specialties: [{ name: 'Cardiology', level: null }], minHoursPerWeek: 15 },
      ],
    });

    const generalBlocks = {};
    const cardioBlocks = {};
    for (let i = 0; i < 5; i++) {
      generalBlocks[i] = [{ start: '08:00', end: '17:00' }];
      cardioBlocks[i] = [{ start: '08:00', end: '17:00' }];
    }
    const doc1 = makeDoctor('Dr. General', 'General', generalBlocks);
    const doc2 = makeDoctor('Dr. Heart', 'Cardiology', cardioBlocks);

    const result = runSolver(facility, [doc1, doc2]);
    expect(result.success).toBe(true);
    expect(result.plan).toHaveLength(2);

    const generalPlan = result.plan.find(p => p.specialty === 'General');
    const cardioPlan = result.plan.find(p => p.specialty === 'Cardiology');
    expect(generalPlan.totalWeeklyHours).toBeGreaterThanOrEqual(20);
    expect(cardioPlan.totalWeeklyHours).toBeGreaterThanOrEqual(15);
  });

  // ─── LEVEL-AWARE TESTS ─────────────────────────────

  // 17. Phase 3 level=null requirement matches any doctor level
  test('Phase 3 level: requirement with level=null matches any doctor level', () => {
    const facility = makeFacility({
      specialRequirements: [{
        id: 'req-1',
        specialty: 'Cardiology',
        level: null,
        days: [0, 1, 2, 3, 4],
        timeBlock: { start: '09:00', end: '12:00' },
      }],
    });
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '08:00', end: '17:00' }];
    const doctor = makeDoctor('Dr. Heart', 'Cardiology', weekBlocks, 'senior');
    const result = runSolver(facility, [doctor]);
    expect(result.success).toBe(true);
  });

  // 18. Phase 3 specific level matches correct doctor level
  test('Phase 3 level: specific level requirement matches correct doctor level', () => {
    const facility = makeFacility({
      specialRequirements: [{
        id: 'req-1',
        specialty: 'Cardiology',
        level: 'senior',
        days: [0, 1, 2, 3, 4],
        timeBlock: { start: '09:00', end: '12:00' },
      }],
    });
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '08:00', end: '17:00' }];
    const doctor = makeDoctor('Dr. Heart', 'Cardiology', weekBlocks, 'senior');
    const result = runSolver(facility, [doctor]);
    expect(result.success).toBe(true);
  });

  // 19. Phase 3 specific level, wrong doctor level → error
  test('Phase 3 level: specific level requirement, wrong doctor level → error', () => {
    const facility = makeFacility({
      specialRequirements: [{
        id: 'req-1',
        specialty: 'Cardiology',
        level: 'senior',
        days: [0],
        timeBlock: { start: '09:00', end: '12:00' },
      }],
    });
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '08:00', end: '17:00' }];
    const doctor = makeDoctor('Dr. Heart', 'Cardiology', weekBlocks, 'novice');
    const result = runSolver(facility, [doctor]);
    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.includes('Cardiology') && e.includes('senior'))).toBe(true);
  });

  // 20. Phase 4 level=null quota aggregates all levels
  test('Phase 4 level: quota with level=null aggregates all doctor levels', () => {
    const facility = makeFacility({
      roomCount: 3,
      hourQuotas: [{ id: 'q-1', specialties: [{ name: 'Cardiology', level: null }], minHoursPerWeek: 20 }],
    });
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '08:00', end: '12:00' }];
    const doc1 = makeDoctor('Dr. Senior', 'Cardiology', weekBlocks, 'senior');
    const doc2 = makeDoctor('Dr. Novice', 'Cardiology', weekBlocks, 'novice');
    // Need full coverage
    const fullBlocks = {};
    for (let i = 0; i < 5; i++) fullBlocks[i] = [{ start: '08:00', end: '17:00' }];
    const doc3 = makeDoctor('Dr. Full', 'General', fullBlocks);
    const result = runSolver(facility, [doc1, doc2, doc3]);
    expect(result.success).toBe(true);
  });

  // 21. Phase 4 specific level quota met
  test('Phase 4 level: specific level quota met', () => {
    const facility = makeFacility({
      hourQuotas: [{ id: 'q-1', specialties: [{ name: 'Cardiology', level: 'senior' }], minHoursPerWeek: 10 }],
    });
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '08:00', end: '17:00' }];
    const doctor = makeDoctor('Dr. Heart', 'Cardiology', weekBlocks, 'senior');
    const result = runSolver(facility, [doctor]);
    expect(result.success).toBe(true);
  });

  // 22. Phase 4 specific level quota unmet — wrong level doesn't count
  test('Phase 4 level: specific level quota unmet when only wrong level present', () => {
    const facility = makeFacility({
      hourQuotas: [{ id: 'q-1', specialties: [{ name: 'Cardiology', level: 'senior' }], minHoursPerWeek: 10 }],
    });
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '08:00', end: '17:00' }];
    const doctor = makeDoctor('Dr. Heart', 'Cardiology', weekBlocks, 'novice');
    const result = runSolver(facility, [doctor]);
    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.includes('Cardiology') && e.includes('0.0h') && e.includes('10h'))).toBe(true);
  });

  // ─── ROOM CAPACITY TESTS ──────────────────────────

  // 23. Phase 2.5: 2 doctors, 1 room, overlapping hours → error
  test('Phase 2.5: 2 doctors overlapping with 1 room → error mentioning day and time', () => {
    const facility = makeFacility({ roomCount: 1 });
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '08:00', end: '17:00' }];
    const doc1 = makeDoctor('Dr. A', 'General', weekBlocks);
    const doc2 = makeDoctor('Dr. B', 'General', weekBlocks);
    const result = runSolver(facility, [doc1, doc2]);
    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.includes('Zbyt wielu pracowników') && e.includes('Pon') && e.includes('2 pracowników') && e.includes('1 gabinetów'))).toBe(true);
  });

  // 24. Phase 2.5: 2 doctors, 2 rooms, overlapping hours → success
  test('Phase 2.5: 2 doctors overlapping with 2 rooms → success', () => {
    const facility = makeFacility({ roomCount: 2 });
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '08:00', end: '17:00' }];
    const doc1 = makeDoctor('Dr. A', 'General', weekBlocks);
    const doc2 = makeDoctor('Dr. B', 'General', weekBlocks);
    const result = runSolver(facility, [doc1, doc2]);
    expect(result.success).toBe(true);
  });

  // 25. Phase 2.5: 2 doctors, 1 room, non-overlapping hours → success
  test('Phase 2.5: 2 doctors non-overlapping with 1 room → success', () => {
    const facility = makeFacility({ roomCount: 1 });
    const morningBlocks = {};
    const afternoonBlocks = {};
    for (let i = 0; i < 5; i++) {
      morningBlocks[i] = [{ start: '08:00', end: '12:00' }];
      afternoonBlocks[i] = [{ start: '12:00', end: '17:00' }];
    }
    const doc1 = makeDoctor('Dr. AM', 'General', morningBlocks);
    const doc2 = makeDoctor('Dr. PM', 'General', afternoonBlocks);
    const result = runSolver(facility, [doc1, doc2]);
    expect(result.success).toBe(true);
  });

  // 26. Phase 2.5: 3 doctors, 2 rooms, all overlap → error
  test('Phase 2.5: 3 doctors overlapping with 2 rooms → error', () => {
    const facility = makeFacility({ roomCount: 2 });
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '08:00', end: '17:00' }];
    const doc1 = makeDoctor('Dr. A', 'General', weekBlocks);
    const doc2 = makeDoctor('Dr. B', 'General', weekBlocks);
    const doc3 = makeDoctor('Dr. C', 'General', weekBlocks);
    const result = runSolver(facility, [doc1, doc2, doc3]);
    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.includes('Zbyt wielu pracowników') && e.includes('3 pracowników') && e.includes('2 gabinetów'))).toBe(true);
  });

  // ─── FIELD WORK TESTS ──────────────────────────────

  // 27. Field worker does NOT count toward room capacity
  test('Phase 2.5: 2 doctors overlapping, 1 room, 1 field worker → success', () => {
    const facility = makeFacility({ roomCount: 1 });
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '08:00', end: '17:00' }];
    const doc1 = makeDoctor('Dr. A', 'General', weekBlocks);
    const doc2 = { ...makeDoctor('Dr. B', 'General', weekBlocks), fieldWork: true };
    const result = runSolver(facility, [doc1, doc2]);
    expect(result.success).toBe(true);
  });

  // 28. Field worker still counts for coverage and hour quotas
  test('Field worker still contributes to coverage and hour quotas', () => {
    const facility = makeFacility({ roomCount: 1 });
    facility.hourQuotas = [{ id: 'q1', specialties: [{ name: 'General', level: null }], minHoursPerWeek: 80 }];
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '08:00', end: '17:00' }];
    const doc1 = makeDoctor('Dr. A', 'General', weekBlocks);
    const doc2 = { ...makeDoctor('Dr. B', 'General', weekBlocks), fieldWork: true };
    const result = runSolver(facility, [doc1, doc2]);
    // 2 doctors × 45h = 90h ≥ 80h quota → should pass
    expect(result.success).toBe(true);
  });

  // 29. Without fieldWork flag, same setup fails room capacity
  test('Phase 2.5: 2 doctors overlapping, 1 room, no field worker → error', () => {
    const facility = makeFacility({ roomCount: 1 });
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '08:00', end: '17:00' }];
    const doc1 = makeDoctor('Dr. A', 'General', weekBlocks);
    const doc2 = makeDoctor('Dr. B', 'General', weekBlocks);
    const result = runSolver(facility, [doc1, doc2]);
    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.includes('Zbyt wielu pracowników'))).toBe(true);
  });

  // 30. Phase 4 max quota: under limit → success
  test('Phase 4: max quota met (under limit) → success', () => {
    const facility = makeFacility({
      hourQuotas: [{ id: 'q-1', specialties: [{ name: 'General', level: null }], minHoursPerWeek: 0, maxHoursPerWeek: 50 }],
    });
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '08:00', end: '17:00' }];
    const doctor = makeDoctor('Dr. Full', 'General', weekBlocks);
    const result = runSolver(facility, [doctor]);
    expect(result.success).toBe(true);
  });

  // 31. Phase 4 max quota exceeded → error
  test('Phase 4: max quota exceeded → error', () => {
    const facility = makeFacility({
      hourQuotas: [{ id: 'q-1', specialties: [{ name: 'General', level: null }], minHoursPerWeek: 0, maxHoursPerWeek: 10 }],
    });
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '08:00', end: '17:00' }];
    const doctor = makeDoctor('Dr. Full', 'General', weekBlocks);
    const result = runSolver(facility, [doctor]);
    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.includes('General') && e.includes('maksimum') && e.includes('10h'))).toBe(true);
  });

  // 32. Both min=0 and max=0 → skipped
  test('Phase 4: both min and max zero → skipped', () => {
    const facility = makeFacility({
      hourQuotas: [{ id: 'q-1', specialties: [{ name: 'Radiology', level: null }], minHoursPerWeek: 0, maxHoursPerWeek: 0 }],
    });
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '08:00', end: '17:00' }];
    const doctor = makeDoctor('Dr. Full', 'General', weekBlocks);
    const result = runSolver(facility, [doctor]);
    expect(result.success).toBe(true);
  });

  // 33. Both min and max set, value within range → success
  test('Phase 4: both min and max, within range → success', () => {
    const facility = makeFacility({
      hourQuotas: [{ id: 'q-1', specialties: [{ name: 'General', level: null }], minHoursPerWeek: 10, maxHoursPerWeek: 50 }],
    });
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '08:00', end: '17:00' }];
    const doctor = makeDoctor('Dr. Full', 'General', weekBlocks);
    const result = runSolver(facility, [doctor]);
    expect(result.success).toBe(true);
  });

  // 34. Both min and max set, below min → min error only
  test('Phase 4: both min and max, below min → min error', () => {
    const facility = makeFacility({
      hourQuotas: [{ id: 'q-1', specialties: [{ name: 'Radiology', level: null }], minHoursPerWeek: 10, maxHoursPerWeek: 50 }],
    });
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '08:00', end: '17:00' }];
    const doctor = makeDoctor('Dr. Full', 'General', weekBlocks);
    const result = runSolver(facility, [doctor]);
    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.includes('Radiology') && e.includes('minimum'))).toBe(true);
  });

  // 35. Both min and max set, above max → max error only
  test('Phase 4: both min and max, above max → max error', () => {
    const facility = makeFacility({
      hourQuotas: [{ id: 'q-1', specialties: [{ name: 'General', level: null }], minHoursPerWeek: 10, maxHoursPerWeek: 20 }],
    });
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '08:00', end: '17:00' }];
    const doctor = makeDoctor('Dr. Full', 'General', weekBlocks);
    const result = runSolver(facility, [doctor]);
    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.includes('General') && e.includes('maksimum') && e.includes('20h'))).toBe(true);
  });

  // 36. Max-only quota (min=0, max=20) enforced
  test('Phase 4: max-only quota enforced when min is 0', () => {
    const facility = makeFacility({
      hourQuotas: [{ id: 'q-1', specialties: [{ name: 'General', level: null }], minHoursPerWeek: 0, maxHoursPerWeek: 20 }],
    });
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '08:00', end: '17:00' }];
    const doctor = makeDoctor('Dr. Full', 'General', weekBlocks);
    const result = runSolver(facility, [doctor]);
    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.includes('maksimum'))).toBe(true);
  });

  // 37. Level-aware max quota
  test('Phase 4 level: max quota with specific level exceeded', () => {
    const facility = makeFacility({
      hourQuotas: [{ id: 'q-1', specialties: [{ name: 'Cardiology', level: 'senior' }], minHoursPerWeek: 0, maxHoursPerWeek: 5 }],
    });
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '08:00', end: '17:00' }];
    const doctor = { ...makeDoctor('Dr. Heart', 'Cardiology', weekBlocks), level: 'senior' };
    const result = runSolver(facility, [doctor]);
    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.includes('Cardiology') && e.includes('maksimum'))).toBe(true);
  });

  // 38. Plan output includes fieldWork flag
  test('Plan output includes fieldWork flag for field workers', () => {
    const facility = makeFacility({ roomCount: 2 });
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '08:00', end: '17:00' }];
    const doc1 = makeDoctor('Dr. A', 'General', weekBlocks);
    const doc2 = { ...makeDoctor('Dr. B', 'General', weekBlocks), fieldWork: true };
    const result = runSolver(facility, [doc1, doc2]);
    expect(result.success).toBe(true);
    expect(result.plan.find(p => p.doctorName === 'Dr. B').fieldWork).toBe(true);
    expect(result.plan.find(p => p.doctorName === 'Dr. A').fieldWork).toBe(false);
  });
});

// ─── normalizeName ────────────────────────────────
describe('normalizeName', () => {
  test('lowercases and removes spaces', () => {
    expect(normalizeName('Jan Kowalski')).toBe('jankowalski');
  });

  test('handles empty/null input', () => {
    expect(normalizeName('')).toBe('');
    expect(normalizeName(null)).toBe('');
    expect(normalizeName(undefined)).toBe('');
  });

  test('removes Polish diacritics: ą', () => {
    expect(normalizeName('Ząb')).toBe('zab');
    expect(normalizeName('ąść')).toBe('asc');
  });

  test('removes Polish diacritics: ć', () => {
    expect(normalizeName('Ćma')).toBe('cma');
    expect(normalizeName('świeć')).toBe('swiec');
  });

  test('removes Polish diacritics: ę', () => {
    expect(normalizeName('Węgiel')).toBe('wegiel');
    expect(normalizeName('Częstochowa')).toBe('czestochowa');
  });

  test('removes Polish diacritics: ł', () => {
    expect(normalizeName('Łódź')).toBe('lodz');
    expect(normalizeName('Małgorzata')).toBe('malgorzata');
  });

  test('removes Polish diacritics: ń', () => {
    expect(normalizeName('Gdańsk')).toBe('gdansk');
    expect(normalizeName('Koń')).toBe('kon');
  });

  test('removes Polish diacritics: ó', () => {
    expect(normalizeName('Góra')).toBe('gora');
    expect(normalizeName('Łódź')).toBe('lodz');
  });

  test('removes Polish diacritics: ś', () => {
    expect(normalizeName('Śląsk')).toBe('slask');
    expect(normalizeName('Jaś')).toBe('jas');
  });

  test('removes Polish diacritics: ź', () => {
    expect(normalizeName('Źródło')).toBe('zrodlo');
    expect(normalizeName('Łaź')).toBe('laz');
  });

  test('removes Polish diacritics: ż', () => {
    expect(normalizeName('Żółw')).toBe('zolw');
    expect(normalizeName('Jeż')).toBe('jez');
  });

  test('handles full Polish names with multiple diacritics', () => {
    expect(normalizeName('Stanisław Żółkiewski')).toBe('stanislawzolkiewski');
    expect(normalizeName('Małgorzata Ćwiklińska')).toBe('malgorzatacwiklinska');
    expect(normalizeName('Józef Piłsudski')).toBe('jozefpilsudski');
    expect(normalizeName('Łukasz Wróbel')).toBe('lukaszwrobel');
    expect(normalizeName('Agnieszka Więckowska')).toBe('agnieszkawieckowska');
  });

  test('handles mixed case', () => {
    expect(normalizeName('ŁUKASZ WRÓBEL')).toBe('lukaszwrobel');
    expect(normalizeName('łukasz wróbel')).toBe('lukaszwrobel');
  });

  test('handles multiple spaces and whitespace', () => {
    expect(normalizeName('  Jan   Kowalski  ')).toBe('jankowalski');
    expect(normalizeName('Jan\tKowalski')).toBe('jankowalski');
  });

  test('handles names with hyphens and other chars', () => {
    expect(normalizeName('Anna Nowak-Kowalska')).toBe('annanowak-kowalska');
  });

  test('handles Dr. prefix', () => {
    expect(normalizeName('Dr. Łukasz Żak')).toBe('dr.lukaszzak');
  });

  test('two names with same base match after normalization', () => {
    expect(normalizeName('Józef Wójcik')).toBe(normalizeName('józef wójcik'));
    expect(normalizeName('JÓZEF WÓJCIK')).toBe(normalizeName('Józef Wójcik'));
  });
});

// ─── checkCrossFacilityConflicts ──────────────────
describe('checkCrossFacilityConflicts', () => {
  function makeFacilityState(id, facilityOverrides, doctors) {
    return {
      id,
      specialties: [],
      facility: makeFacility(facilityOverrides),
      doctors: doctors,
    };
  }

  test('returns no errors when no other facilities exist', () => {
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '08:00', end: '12:00' }];
    const doc = makeDoctor('Jan Kowalski', 'General', weekBlocks);
    const fs = makeFacilityState('fs1', {}, [doc]);
    const errors = checkCrossFacilityConflicts(fs, [fs]);
    expect(errors).toEqual([]);
  });

  test('returns no errors when doctor names do not match across facilities', () => {
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '08:00', end: '12:00' }];
    const doc1 = makeDoctor('Jan Kowalski', 'General', weekBlocks);
    const doc2 = makeDoctor('Anna Nowak', 'General', weekBlocks);
    const fs1 = makeFacilityState('fs1', {}, [doc1]);
    const fs2 = makeFacilityState('fs2', {}, [doc2]);
    const errors = checkCrossFacilityConflicts(fs1, [fs1, fs2]);
    expect(errors).toEqual([]);
  });

  test('detects conflict when same doctor overlaps across facilities', () => {
    const blocks1 = {};
    for (let i = 0; i < 5; i++) blocks1[i] = [{ start: '08:00', end: '12:00' }];
    const blocks2 = {};
    for (let i = 0; i < 5; i++) blocks2[i] = [{ start: '11:00', end: '15:00' }];

    const doc1 = makeDoctor('Józef Wójcik', 'General', blocks1);
    const doc2 = makeDoctor('Józef Wójcik', 'General', blocks2);
    const fs1 = makeFacilityState('fs1', {}, [doc1]);
    const fs2 = makeFacilityState('fs2', {}, [doc2]);
    const errors = checkCrossFacilityConflicts(fs1, [fs1, fs2]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('Konflikt');
    expect(errors[0]).toContain('Józef Wójcik');
  });

  test('detects conflict with 30 min margin — adjacent blocks within margin', () => {
    // Facility A: doctor works 08:00-12:00
    // Facility B: doctor works 12:15-16:00
    // Gap is only 15 min, less than 30 min margin → conflict
    const blocksA = {};
    for (let i = 0; i < 5; i++) blocksA[i] = [{ start: '08:00', end: '12:00' }];
    const blocksB = {};
    for (let i = 0; i < 5; i++) blocksB[i] = [{ start: '12:15', end: '16:00' }];

    const doc1 = makeDoctor('Jan Kowalski', 'General', blocksA);
    const doc2 = makeDoctor('Jan Kowalski', 'General', blocksB);
    const fs1 = makeFacilityState('fs1', {}, [doc1]);
    const fs2 = makeFacilityState('fs2', {}, [doc2]);
    const errors = checkCrossFacilityConflicts(fs1, [fs1, fs2]);
    expect(errors.length).toBeGreaterThan(0);
  });

  test('no conflict when gap is exactly 30 min', () => {
    // Facility A: doctor works 08:00-12:00
    // Facility B: doctor works 12:30-16:00
    // Gap is exactly 30 min → no conflict
    const blocksA = {};
    for (let i = 0; i < 5; i++) blocksA[i] = [{ start: '08:00', end: '12:00' }];
    const blocksB = {};
    for (let i = 0; i < 5; i++) blocksB[i] = [{ start: '12:30', end: '16:00' }];

    const doc1 = makeDoctor('Jan Kowalski', 'General', blocksA);
    const doc2 = makeDoctor('Jan Kowalski', 'General', blocksB);
    const fs1 = makeFacilityState('fs1', {}, [doc1]);
    const fs2 = makeFacilityState('fs2', {}, [doc2]);
    const errors = checkCrossFacilityConflicts(fs1, [fs1, fs2]);
    expect(errors).toEqual([]);
  });

  test('no conflict when gap is more than 30 min', () => {
    const blocksA = {};
    for (let i = 0; i < 5; i++) blocksA[i] = [{ start: '08:00', end: '12:00' }];
    const blocksB = {};
    for (let i = 0; i < 5; i++) blocksB[i] = [{ start: '13:00', end: '17:00' }];

    const doc1 = makeDoctor('Jan Kowalski', 'General', blocksA);
    const doc2 = makeDoctor('Jan Kowalski', 'General', blocksB);
    const fs1 = makeFacilityState('fs1', {}, [doc1]);
    const fs2 = makeFacilityState('fs2', {}, [doc2]);
    const errors = checkCrossFacilityConflicts(fs1, [fs1, fs2]);
    expect(errors).toEqual([]);
  });

  test('matches doctors with different diacritics via normalization', () => {
    const blocksA = {};
    for (let i = 0; i < 5; i++) blocksA[i] = [{ start: '08:00', end: '12:00' }];
    const blocksB = {};
    for (let i = 0; i < 5; i++) blocksB[i] = [{ start: '10:00', end: '14:00' }];

    const doc1 = makeDoctor('Łukasz Wróbel', 'General', blocksA);
    const doc2 = makeDoctor('ŁUKASZ WRÓBEL', 'General', blocksB);
    const fs1 = makeFacilityState('fs1', {}, [doc1]);
    const fs2 = makeFacilityState('fs2', {}, [doc2]);
    const errors = checkCrossFacilityConflicts(fs1, [fs1, fs2]);
    expect(errors.length).toBeGreaterThan(0);
  });

  test('clamps doctor availability to facility hours before checking', () => {
    // Facility A opens 08:00-12:00, doctor available 08:00-17:00
    // Facility B opens 14:00-18:00, doctor available 08:00-17:00
    // Effective: A=08:00-12:00, B=14:00-17:00 — gap is 2h → no conflict
    const facA = {
      openingHours: Array.from({ length: 7 }, (_, i) => ({
        day: i, enabled: i < 5,
        blocks: i < 5 ? [{ start: '08:00', end: '12:00' }] : [],
      })),
    };
    const facB = {
      openingHours: Array.from({ length: 7 }, (_, i) => ({
        day: i, enabled: i < 5,
        blocks: i < 5 ? [{ start: '14:00', end: '18:00' }] : [],
      })),
    };
    const allDay = {};
    for (let i = 0; i < 5; i++) allDay[i] = [{ start: '08:00', end: '17:00' }];

    const doc1 = makeDoctor('Jan Kowalski', 'General', allDay);
    const doc2 = makeDoctor('Jan Kowalski', 'General', allDay);
    const fs1 = makeFacilityState('fs1', facA, [doc1]);
    const fs2 = makeFacilityState('fs2', facB, [doc2]);
    const errors = checkCrossFacilityConflicts(fs1, [fs1, fs2]);
    expect(errors).toEqual([]);
  });

  test('detects conflict even on a single day', () => {
    // Only Monday has overlap
    const blocksA = { 0: [{ start: '08:00', end: '12:00' }] };
    const blocksB = { 0: [{ start: '11:00', end: '15:00' }] };

    const doc1 = makeDoctor('Jan Kowalski', 'General', blocksA);
    const doc2 = makeDoctor('Jan Kowalski', 'General', blocksB);
    const fs1 = makeFacilityState('fs1', {}, [doc1]);
    const fs2 = makeFacilityState('fs2', {}, [doc2]);
    const errors = checkCrossFacilityConflicts(fs1, [fs1, fs2]);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('Pon');
  });

  test('detects conflict when names differ by one deletion (typo)', () => {
    const blocksA = {};
    for (let i = 0; i < 5; i++) blocksA[i] = [{ start: '08:00', end: '12:00' }];
    const blocksB = {};
    for (let i = 0; i < 5; i++) blocksB[i] = [{ start: '10:00', end: '14:00' }];

    const doc1 = makeDoctor('Jan Kowalski', 'General', blocksA);
    const doc2 = makeDoctor('Jan Kowalsi', 'General', blocksB); // missing 'k'
    const fs1 = makeFacilityState('fs1', {}, [doc1]);
    const fs2 = makeFacilityState('fs2', {}, [doc2]);
    const errors = checkCrossFacilityConflicts(fs1, [fs1, fs2]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('Konflikt');
  });

  test('detects conflict when names differ by one substitution (typo)', () => {
    const blocksA = {};
    for (let i = 0; i < 5; i++) blocksA[i] = [{ start: '08:00', end: '12:00' }];
    const blocksB = {};
    for (let i = 0; i < 5; i++) blocksB[i] = [{ start: '10:00', end: '14:00' }];

    const doc1 = makeDoctor('Jan Kowalski', 'General', blocksA);
    const doc2 = makeDoctor('Jan Kowakski', 'General', blocksB); // l→k substitution
    const fs1 = makeFacilityState('fs1', {}, [doc1]);
    const fs2 = makeFacilityState('fs2', {}, [doc2]);
    const errors = checkCrossFacilityConflicts(fs1, [fs1, fs2]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('Konflikt');
  });

  test('no conflict when names differ by more than one letter', () => {
    const blocksA = {};
    for (let i = 0; i < 5; i++) blocksA[i] = [{ start: '08:00', end: '12:00' }];
    const blocksB = {};
    for (let i = 0; i < 5; i++) blocksB[i] = [{ start: '10:00', end: '14:00' }];

    // 'jankowalski' (11) vs 'jankowski' (9) — length diff 2, distance > 1
    const doc1 = makeDoctor('Jan Kowalski', 'General', blocksA);
    const doc2 = makeDoctor('Jan Kowski', 'General', blocksB);
    const fs1 = makeFacilityState('fs1', {}, [doc1]);
    const fs2 = makeFacilityState('fs2', {}, [doc2]);
    const errors = checkCrossFacilityConflicts(fs1, [fs1, fs2]);
    expect(errors).toEqual([]);
  });
});

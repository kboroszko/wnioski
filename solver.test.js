import { DAYS, toMinutes, toTimeString, mergeIntervals, intersectIntervals, subtractIntervals, coversInterval, sumMinutes, matchesSpecialtyLevel, runSolver } from './solver.js';

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
  test('returns failure with "No doctors assigned." when doctors array is empty', () => {
    const facility = makeFacility();
    const result = runSolver(facility, []);
    expect(result.success).toBe(false);
    expect(result.errors).toContain('No doctors assigned.');
  });

  test('returns failure with "No doctors assigned." when doctors is null', () => {
    const facility = makeFacility();
    const result = runSolver(facility, null);
    expect(result.success).toBe(false);
    expect(result.errors).toContain('No doctors assigned.');
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
    const facility = makeFacility();
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
    expect(result.errors.some(e => e.includes('No doctor coverage on Mon from 12:00 to 17:00'))).toBe(true);
  });

  // 7. Phase 2 two doctors cover — combined coverage fills all hours
  test('Phase 2: two doctors combined fill all hours → success', () => {
    const facility = makeFacility();
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
    expect(result.errors.some(e => e.includes('Cardiology') && e.includes('no doctors with this specialty'))).toBe(true);
  });

  // 10. Phase 3 partial specialty — specialty doctor doesn't cover full required block
  test('Phase 3: specialty doctor does not cover full required block → error', () => {
    const facility = makeFacility({
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
    expect(result.errors.some(e => e.includes('Cardiology') && e.includes('Mon'))).toBe(true);
  });

  // 11. Phase 4 quota met — enough hours for specialty
  test('Phase 4: quota met → success', () => {
    const facility = makeFacility({
      hourQuotas: [{ id: 'q-1', specialty: 'General', minHoursPerWeek: 10 }],
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
      hourQuotas: [{ id: 'q-1', specialty: 'Radiology', minHoursPerWeek: 20 }],
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
      hourQuotas: [{ id: 'q-1', specialty: 'Radiology', minHoursPerWeek: 0 }],
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
      specialRequirements: [{
        id: 'req-1',
        specialty: 'Cardiology',
        days: [0, 2, 4], // Mon, Wed, Fri
        timeBlock: { start: '09:00', end: '12:00' },
      }],
      hourQuotas: [
        { id: 'q-1', specialty: 'General', minHoursPerWeek: 20 },
        { id: 'q-2', specialty: 'Cardiology', minHoursPerWeek: 15 },
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
      hourQuotas: [{ id: 'q-1', specialty: 'Cardiology', level: null, minHoursPerWeek: 20 }],
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
      hourQuotas: [{ id: 'q-1', specialty: 'Cardiology', level: 'senior', minHoursPerWeek: 10 }],
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
      hourQuotas: [{ id: 'q-1', specialty: 'Cardiology', level: 'senior', minHoursPerWeek: 10 }],
    });
    const weekBlocks = {};
    for (let i = 0; i < 5; i++) weekBlocks[i] = [{ start: '08:00', end: '17:00' }];
    const doctor = makeDoctor('Dr. Heart', 'Cardiology', weekBlocks, 'novice');
    const result = runSolver(facility, [doctor]);
    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.includes('Cardiology') && e.includes('0.0h') && e.includes('10h'))).toBe(true);
  });
});

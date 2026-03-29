import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { DAYS, toMinutes, toTimeString, mergeIntervals, intersectIntervals, subtractIntervals, coversInterval, sumMinutes, runSolver } from './solver.js';
const SPECIALTY_COLORS = [
  { bg: 'rgba(59,90,214,0.1)', color: '#3b5ad6', border: 'rgba(59,90,214,0.25)' },
  { bg: 'rgba(124,99,221,0.1)', color: '#7c63dd', border: 'rgba(124,99,221,0.25)' },
  { bg: 'rgba(22,163,74,0.1)', color: '#16a34a', border: 'rgba(22,163,74,0.25)' },
  { bg: 'rgba(217,119,6,0.1)', color: '#d97706', border: 'rgba(217,119,6,0.25)' },
  { bg: 'rgba(220,38,38,0.1)', color: '#dc2626', border: 'rgba(220,38,38,0.25)' },
  { bg: 'rgba(14,116,144,0.1)', color: '#0e7490', border: 'rgba(14,116,144,0.25)' },
  { bg: 'rgba(161,98,7,0.1)', color: '#a16207', border: 'rgba(161,98,7,0.25)' },
  { bg: 'rgba(190,24,93,0.1)', color: '#be185d', border: 'rgba(190,24,93,0.25)' },
];

function formatBlocks(blocks) {
  if (!blocks || blocks.length === 0) return '—';
  return blocks.map(b => `${b.start}–${b.end}`).join(', ');
}

function uuid() {
  return 'xxxx-xxxx'.replace(/x/g, () => ((Math.random()*16)|0).toString(16));
}

// ─── DEFAULT STATE ─────────────────────────────────
function makeDefaultFacility() {
  return {
    id: uuid(),
    name: '',
    roomCount: 1,
    openingHours: Array.from({length:7}, (_,i) => ({
      day: i,
      enabled: i < 5,
      blocks: i < 5 ? [{ start: '08:00', end: '17:00' }] : [],
    })),
    specialRequirements: [],
    hourQuotas: [],
  };
}

function makeDefaultState() {
  return { version: 2, specialties: [], facility: makeDefaultFacility(), doctors: [], generatedPlan: null };
}

// ─── SPECIALTY COLOR HELPER ────────────────────────
function getSpecialtyColorMap(doctors, requirements, quotas) {
  const specs = new Set();
  doctors.forEach(d => specs.add(d.specialty));
  requirements.forEach(r => specs.add(r.specialty));
  quotas.forEach(q => specs.add(q.specialty));
  const map = {};
  let i = 0;
  specs.forEach(s => { if (s) { map[s] = SPECIALTY_COLORS[i % SPECIALTY_COLORS.length]; i++; } });
  return map;
}

// ─── COMPONENTS ────────────────────────────────────

function TimeInput({ value, onChange, className, style }) {
  const handleChange = (e) => {
    let v = e.target.value.replace(/[^\d:]/g, '');
    // Auto-insert colon after 2 digits
    if (v.length === 2 && !v.includes(':') && value.length < v.length) {
      v = v + ':';
    }
    if (v.length > 5) v = v.slice(0, 5);
    onChange(v);
  };

  const handleBlur = () => {
    // Normalize on blur: pad and clamp
    const parts = value.split(':');
    let h = parseInt(parts[0], 10) || 0;
    let m = parseInt(parts[1], 10) || 0;
    h = Math.min(23, Math.max(0, h));
    m = Math.min(59, Math.max(0, m));
    onChange(String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'));
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder="HH:MM"
      maxLength={5}
      value={value}
      onChange={handleChange}
      onBlur={handleBlur}
      className={className}
      style={{ width: 70, textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '0.85rem', ...style }}
    />
  );
}

function TimeBlockEditor({ blocks, onChange, disabled }) {
  const [adding, setAdding] = useState(false);
  const [newStart, setNewStart] = useState('08:00');
  const [newEnd, setNewEnd] = useState('17:00');
  const [editIdx, setEditIdx] = useState(null);
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');

  const addBlock = () => {
    if (newStart && newEnd && toMinutes(newEnd) > toMinutes(newStart)) {
      const merged = mergeIntervals([...blocks, { start: newStart, end: newEnd }]);
      onChange(merged);
      setAdding(false);
    }
  };

  const removeBlock = (idx) => {
    onChange(blocks.filter((_,i) => i !== idx));
    if (editIdx === idx) setEditIdx(null);
  };

  const startEdit = (idx) => {
    setEditIdx(idx);
    setEditStart(blocks[idx].start);
    setEditEnd(blocks[idx].end);
    setAdding(false);
  };

  const confirmEdit = () => {
    if (editStart && editEnd && toMinutes(editEnd) > toMinutes(editStart)) {
      const next = blocks.map((b, i) => i === editIdx ? { start: editStart, end: editEnd } : b);
      onChange(mergeIntervals(next));
    }
    setEditIdx(null);
  };

  const cancelEdit = () => setEditIdx(null);

  return (
    <div className="time-blocks">
      {blocks.map((b, i) => (
        editIdx === i && !disabled ? (
          <span key={i} className="add-block-inline">
            <TimeInput value={editStart} onChange={setEditStart} />
            <span style={{color:'var(--text-muted)'}}>→</span>
            <TimeInput value={editEnd} onChange={setEditEnd} />
            <button className="btn btn-sm btn-primary" onClick={confirmEdit}>OK</button>
            <button className="btn btn-sm btn-ghost" onClick={cancelEdit}>✕</button>
          </span>
        ) : (
          <span key={i} className="time-block-chip" onClick={!disabled ? () => startEdit(i) : undefined}
            style={!disabled ? {cursor:'pointer'} : undefined}>
            {b.start}–{b.end}
            {!disabled && <span className="remove" onClick={(e) => { e.stopPropagation(); removeBlock(i); }}>✕</span>}
          </span>
        )
      ))}
      {!disabled && !adding && editIdx === null && (
        <button className="btn btn-sm btn-ghost" onClick={() => setAdding(true)}>+ Blok</button>
      )}
      {!disabled && adding && (
        <span className="add-block-inline">
          <TimeInput value={newStart} onChange={setNewStart} />
          <span style={{color:'var(--text-muted)'}}>→</span>
          <TimeInput value={newEnd} onChange={setNewEnd} />
          <button className="btn btn-sm btn-primary" onClick={addBlock}>Dodaj</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setAdding(false)}>✕</button>
        </span>
      )}
      {blocks.length === 0 && !adding && <span style={{color:'var(--text-muted)', fontSize:'0.8rem'}}>Brak bloków</span>}
    </div>
  );
}

function DayScheduleEditor({ schedule, onChange }) {
  return (
    <div>
      {schedule.map((ds, i) => (
        <div key={i} className={`day-row ${!ds.enabled ? 'disabled' : ''}`}>
          <span className="day-lbl" style={{width:40,flexShrink:0,fontWeight:600,fontSize:'0.85rem',color:'var(--text-dim)',paddingTop:4}}>{DAYS[i]}</span>
          <div className="toggle-row" style={{flexShrink:0}}>
            <div className={`toggle ${ds.enabled ? 'on' : ''}`}
              onClick={() => {
                const next = [...schedule];
                next[i] = { ...next[i], enabled: !next[i].enabled };
                onChange(next);
              }} />
          </div>
          {ds.enabled && (
            <TimeBlockEditor
              blocks={ds.blocks}
              onChange={(blocks) => {
                const next = [...schedule];
                next[i] = { ...next[i], blocks };
                onChange(next);
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function SpecialRequirementEditor({ requirements, onChange, specialties }) {
  const addReq = () => {
    onChange([...requirements, {
      id: uuid(), specialty: '', level: null, days: [], timeBlock: { start: '08:00', end: '17:00' },
    }]);
  };
  const updateReq = (idx, patch) => {
    const next = [...requirements];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };
  const removeReq = (idx) => onChange(requirements.filter((_,i) => i !== idx));
  const toggleDay = (idx, day) => {
    const cur = requirements[idx].days;
    updateReq(idx, { days: cur.includes(day) ? cur.filter(d => d !== day) : [...cur, day].sort() });
  };

  const getSpecLevels = (specName) => {
    const spec = specialties.find(s => s.name === specName);
    return spec ? spec.levels : [];
  };

  return (
    <div>
      {requirements.map((req, idx) => {
        const levels = getSpecLevels(req.specialty);
        return (
        <div key={req.id} className="req-card">
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}>
            <span style={{fontWeight:600,fontSize:'0.85rem'}}>Wymaganie #{idx+1}</span>
            <button className="btn btn-sm btn-danger btn-ghost" onClick={() => removeReq(idx)}>Usuń</button>
          </div>
          <div className="form-row" style={{marginBottom:10}}>
            <div className="form-group" style={{marginBottom:0}}>
              <label className="form-label">Specjalizacja</label>
              <select value={req.specialty} onChange={e => updateReq(idx, { specialty: e.target.value, level: null })}>
                <option value="">— Wybierz —</option>
                {specialties.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>
            {levels.length > 0 && (
              <div className="form-group" style={{marginBottom:0}}>
                <label className="form-label">Poziom</label>
                <select value={req.level || ''} onChange={e => updateReq(idx, { level: e.target.value || null })}>
                  <option value="">Dowolny poziom</option>
                  {levels.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            )}
            <div className="form-group" style={{marginBottom:0}}>
              <label className="form-label">Czas</label>
              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                <TimeInput value={req.timeBlock.start}
                  onChange={v => updateReq(idx, { timeBlock: { ...req.timeBlock, start: v }})} />
                <span style={{color:'var(--text-muted)'}}>→</span>
                <TimeInput value={req.timeBlock.end}
                  onChange={v => updateReq(idx, { timeBlock: { ...req.timeBlock, end: v }})} />
              </div>
            </div>
          </div>
          <div className="form-group" style={{marginBottom:0}}>
            <label className="form-label">Dni</label>
            <div className="checkbox-group">
              {DAYS.map((d, di) => (
                <span key={di}
                  className={`checkbox-pill ${req.days.includes(di) ? 'checked' : ''}`}
                  onClick={() => toggleDay(idx, di)}>{d}</span>
              ))}
            </div>
          </div>
        </div>
        );
      })}
      <button className="btn btn-sm" onClick={addReq}>+ Dodaj wymaganie</button>
    </div>
  );
}

function HourQuotaEditor({ quotas, onChange, specialties }) {
  const addQuota = () => {
    onChange([...quotas, { id: uuid(), specialty: '', level: null, minHoursPerWeek: 0 }]);
  };
  const updateQuota = (idx, patch) => {
    const next = [...quotas];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };
  const removeQuota = (idx) => onChange(quotas.filter((_,i) => i !== idx));

  const getSpecLevels = (specName) => {
    const spec = specialties.find(s => s.name === specName);
    return spec ? spec.levels : [];
  };

  return (
    <div>
      {quotas.map((q, idx) => {
        const levels = getSpecLevels(q.specialty);
        return (
        <div key={q.id} className="quota-card">
          <div style={{display:'flex',gap:10,alignItems:'flex-end'}}>
            <div style={{flex:1}}>
              <label className="form-label">Specjalizacja</label>
              <select value={q.specialty} onChange={e => updateQuota(idx, { specialty: e.target.value, level: null })}>
                <option value="">— Wybierz —</option>
                {specialties.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            </div>
            {levels.length > 0 && (
              <div style={{flex:1}}>
                <label className="form-label">Poziom</label>
                <select value={q.level || ''} onChange={e => updateQuota(idx, { level: e.target.value || null })}>
                  <option value="">Dowolny poziom</option>
                  {levels.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            )}
            <div style={{width:140}}>
              <label className="form-label">Min godz./tydzień</label>
              <input type="number" step="0.5" value={q.minHoursPerWeek}
                onChange={e => updateQuota(idx, { minHoursPerWeek: e.target.value === '' ? '' : parseFloat(e.target.value) || '' })}
                onBlur={e => { if (e.target.value === '' || isNaN(parseFloat(e.target.value)) || parseFloat(e.target.value) < 0) updateQuota(idx, { minHoursPerWeek: 0 }); }} />
            </div>
            <button className="btn btn-sm btn-danger btn-ghost" style={{marginBottom:1}} onClick={() => removeQuota(idx)}>✕</button>
          </div>
        </div>
        );
      })}
      <button className="btn btn-sm" onClick={addQuota}>+ Dodaj limit</button>
    </div>
  );
}

// ─── TAB: SPECIALTIES ─────────────────────────────
function SpecialtiesTab({ specialties, onChange, doctors, facility }) {
  const addSpecialty = () => {
    onChange([...specialties, { id: uuid(), name: '', levels: ['bez specjalizacji'] }]);
  };
  const updateSpec = (idx, patch) => {
    const next = [...specialties];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };
  const removeSpec = (idx) => {
    onChange(specialties.filter((_,i) => i !== idx));
  };
  const addLevel = (idx, level) => {
    if (!level.trim()) return;
    const spec = specialties[idx];
    if (spec.levels.includes(level.trim())) return;
    updateSpec(idx, { levels: [...spec.levels, level.trim()] });
  };
  const removeLevel = (idx, levelIdx) => {
    const spec = specialties[idx];
    updateSpec(idx, { levels: spec.levels.filter((_,i) => i !== levelIdx) });
  };

  const usageCount = (specName) => {
    const dCount = doctors.filter(d => d.specialty === specName).length;
    const rCount = (facility.specialRequirements || []).filter(r => r.specialty === specName).length;
    const qCount = (facility.hourQuotas || []).filter(q => q.specialty === specName).length;
    return { dCount, rCount, qCount };
  };

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
        <div style={{color:'var(--text-dim)',fontSize:'0.88rem'}}>
          Zdefiniowano {specialties.length} specjalizacj{specialties.length === 1 ? 'ę' : specialties.length >= 2 && specialties.length <= 4 ? 'e' : 'i'}
        </div>
        <button className="btn btn-primary" onClick={addSpecialty}>+ Dodaj specjalizację</button>
      </div>
      {specialties.length === 0 && (
        <div className="empty-state">
          <div className="icon">🏷️</div>
          <p>Nie zdefiniowano jeszcze specjalizacji. Dodaj specjalizacje, aby przypisać je do pracowników i wymagań.</p>
        </div>
      )}
      {specialties.map((spec, idx) => {
        const usage = usageCount(spec.name);
        const totalUsage = usage.dCount + usage.rCount + usage.qCount;
        return (
          <div key={spec.id} className="req-card">
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}>
              <span style={{fontWeight:600,fontSize:'0.85rem'}}>Specjalizacja #{idx+1}</span>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                {spec.name && totalUsage > 0 && (
                  <span style={{fontSize:'0.78rem',color:'var(--text-muted)'}}>
                    {usage.dCount} pracownik{usage.dCount !== 1 ? 'ów' : ''}, {usage.rCount} wymag.{''}, {usage.qCount} limit{usage.qCount !== 1 ? 'y' : ''}
                  </span>
                )}
                <button className="btn btn-sm btn-danger btn-ghost" onClick={() => removeSpec(idx)}>Usuń</button>
              </div>
            </div>
            <div className="form-group" style={{marginBottom:10}}>
              <label className="form-label">Nazwa</label>
              <input type="text" value={spec.name} onChange={e => updateSpec(idx, { name: e.target.value })}
                placeholder="np. Psycholog" />
            </div>
            <div className="form-group" style={{marginBottom:0}}>
              <label className="form-label">Poziomy</label>
              <div className="time-blocks">
                {spec.levels.map((level, li) => (
                  <span key={li} className="time-block-chip">
                    {level}
                    <span className="remove" onClick={() => removeLevel(idx, li)}>✕</span>
                  </span>
                ))}
                <LevelAdder onAdd={(level) => addLevel(idx, level)} />
              </div>
              {spec.levels.length === 0 && (
                <div style={{fontSize:'0.78rem',color:'var(--text-muted)',marginTop:4}}>
                  Brak poziomów — pracownicy nie będą potrzebować poziomu dla tej specjalizacji.
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LevelAdder({ onAdd }) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState('');
  const submit = () => {
    if (value.trim()) {
      onAdd(value.trim());
      setValue('');
      setAdding(false);
    }
  };
  if (!adding) {
    return <button className="btn btn-sm btn-ghost" onClick={() => setAdding(true)}>+ Poziom</button>;
  }
  return (
    <span className="add-block-inline">
      <input type="text" value={value} onChange={e => setValue(e.target.value)}
        placeholder="np. starszy specjalista" style={{width:150,fontSize:'0.85rem'}}
        onKeyDown={e => { if (e.key === 'Enter') submit(); }} autoFocus />
      <button className="btn btn-sm btn-primary" onClick={submit}>Dodaj</button>
      <button className="btn btn-sm btn-ghost" onClick={() => { setAdding(false); setValue(''); }}>✕</button>
    </span>
  );
}

// ─── TAB: FACILITY SETUP ──────────────────────────
function FacilityTab({ facility, onChange, specialties }) {
  return (
    <div>
      <div className="card">
        <div className="card-title"><span className="icon">🏥</span> Dane podstawowe</div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Nazwa placówki</label>
            <input type="text" value={facility.name}
              onChange={e => onChange({ ...facility, name: e.target.value })}
              placeholder="Centrum Medyczne" />
          </div>
          <div className="form-group" style={{maxWidth:160}}>
            <label className="form-label">Gabinety</label>
            <input type="number" value={facility.roomCount}
              onChange={e => onChange({ ...facility, roomCount: e.target.value === '' ? '' : parseInt(e.target.value) || '' })}
              onBlur={e => { if (e.target.value === '' || isNaN(parseInt(e.target.value)) || parseInt(e.target.value) < 1) onChange({ ...facility, roomCount: 1 }); }} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title"><span className="icon">🕐</span> Godziny otwarcia</div>
        <DayScheduleEditor schedule={facility.openingHours}
          onChange={openingHours => onChange({ ...facility, openingHours })} />
      </div>

      <div className="card">
        <div className="card-title"><span className="icon">⚕️</span> Wymagania specjalne</div>
        <p style={{fontSize:'0.82rem',color:'var(--text-muted)',marginBottom:14}}>
          Zdefiniuj obowiązkowe pokrycie specjalizacji w określonych blokach czasowych i dniach.
        </p>
        <SpecialRequirementEditor requirements={facility.specialRequirements}
          onChange={specialRequirements => onChange({ ...facility, specialRequirements })}
          specialties={specialties} />
      </div>

      <div className="card">
        <div className="card-title"><span className="icon">📊</span> Tygodniowe limity godzin</div>
        <p style={{fontSize:'0.82rem',color:'var(--text-muted)',marginBottom:14}}>
          Minimalna łączna liczba godzin tygodniowo wymagana dla każdej specjalizacji.
        </p>
        <HourQuotaEditor quotas={facility.hourQuotas}
          onChange={hourQuotas => onChange({ ...facility, hourQuotas })}
          specialties={specialties} />
      </div>
    </div>
  );
}

// ─── TAB: DOCTORS ─────────────────────────────────
function DoctorForm({ doctor, onSave, onCancel, facility, specialties }) {
  const [form, setForm] = useState(doctor || {
    id: uuid(), name: '', specialty: '', level: null,
    availability: Array.from({length:7}, (_,i) => ({ day: i, blocks: [] })),
  });

  const update = (patch) => setForm(f => ({ ...f, ...patch }));

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">
          {doctor ? '✏️ Edytuj pracownika' : '➕ Dodaj pracownika'}
        </div>
        <div className="form-row" style={{marginBottom:16}}>
          <div className="form-group">
            <label className="form-label">Imię i nazwisko</label>
            <input type="text" value={form.name} onChange={e => update({ name: e.target.value })}
              placeholder="Dr Kowalski" />
          </div>
          <div className="form-group">
            <label className="form-label">Specjalizacja</label>
            <select value={form.specialty} onChange={e => update({ specialty: e.target.value, level: null })}>
              <option value="">— Wybierz —</option>
              {specialties.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </div>
          {(() => {
            const spec = specialties.find(s => s.name === form.specialty);
            const levels = spec ? spec.levels : [];
            return levels.length > 0 ? (
              <div className="form-group">
                <label className="form-label">Poziom</label>
                <select value={form.level || ''} onChange={e => update({ level: e.target.value || null })}>
                  <option value="">— Wybierz —</option>
                  {levels.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            ) : null;
          })()}
        </div>
        <div style={{marginBottom:20}}>
          <label className="form-label" style={{marginBottom:10}}>Dostępność tygodniowa</label>
          {form.availability.map((da, i) => {
            const facBlocks = facility.openingHours[i].enabled ? facility.openingHours[i].blocks : [];
            const outside = subtractIntervals(mergeIntervals(da.blocks), mergeIntervals(facBlocks));
            return (
              <div key={i} className="day-row">
                <span className="day-lbl" style={{width:40,flexShrink:0,fontWeight:600,fontSize:'0.85rem',color:'var(--text-dim)',paddingTop:4}}>{DAYS[i]}</span>
                <div style={{flex:1}}>
                  <TimeBlockEditor
                    blocks={da.blocks}
                    onChange={(blocks) => {
                      const next = [...form.availability];
                      next[i] = { ...next[i], blocks: mergeIntervals(blocks) };
                      update({ availability: next });
                    }}
                  />
                  {outside.length > 0 && (
                    <div style={{marginTop:4}}>
                      {outside.map((b,j) => (
                        <span key={j} className="time-block-chip warning" title="Poza godzinami placówki — zostanie przycięte">
                          ⚠ {b.start}–{b.end}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button className="btn" onClick={onCancel}>Anuluj</button>
          <button className="btn btn-primary"
            disabled={!form.name.trim() || !form.specialty}
            onClick={() => onSave(form)}>
            {doctor ? 'Zapisz zmiany' : 'Dodaj pracownika'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DoctorCard({ doctor, facility, onEdit, onDelete, colorMap }) {
  const sc = colorMap[doctor.specialty] || SPECIALTY_COLORS[0];
  const warnings = [];
  doctor.availability.forEach((da, i) => {
    const facBlocks = facility.openingHours[i].enabled ? facility.openingHours[i].blocks : [];
    const outside = subtractIntervals(mergeIntervals(da.blocks), mergeIntervals(facBlocks));
    if (outside.length > 0) warnings.push(i);
  });

  // Compute total effective hours
  let totalEffMins = 0;
  doctor.availability.forEach((da, i) => {
    const facBlocks = facility.openingHours[i].enabled ? facility.openingHours[i].blocks : [];
    const effective = intersectIntervals(mergeIntervals(da.blocks), mergeIntervals(facBlocks));
    totalEffMins += sumMinutes(effective);
  });

  return (
    <div className="doctor-card">
      <div className="doctor-header">
        <div>
          <div className="doctor-name">{doctor.name}</div>
          <span className="specialty-tag" style={{background:sc.bg, color:sc.color, border:`1px solid ${sc.border}`, marginTop:4}}>
            {doctor.specialty}{doctor.level ? ` · ${doctor.level}` : ''}
          </span>
        </div>
        <div style={{display:'flex',gap:6,alignItems:'center'}}>
          <span style={{fontFamily:'var(--mono)',fontSize:'0.85rem',color:'var(--accent)',fontWeight:600}}>
            {(totalEffMins/60).toFixed(1)}h/tydz.
          </span>
          <button className="btn btn-sm btn-ghost" onClick={onEdit}>Edytuj</button>
          <button className="btn btn-sm btn-danger btn-ghost" onClick={onDelete}>✕</button>
        </div>
      </div>
      <div className="mini-schedule" style={{display:'grid',gridTemplateColumns:'40px 1fr',gap:'2px 10px'}}>
        {doctor.availability.map((da, i) => {
          const facBlocks = facility.openingHours[i].enabled ? facility.openingHours[i].blocks : [];
          const effective = intersectIntervals(mergeIntervals(da.blocks), mergeIntervals(facBlocks));
          const outside = subtractIntervals(mergeIntervals(da.blocks), mergeIntervals(facBlocks));
          return (
            <React.Fragment key={i}>
              <span className="mini-schedule day-lbl">{DAYS[i]}</span>
              <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                {effective.map((b,j) => (
                  <span key={`e${j}`} className="time-block-chip">{b.start}–{b.end}</span>
                ))}
                {outside.map((b,j) => (
                  <span key={`w${j}`} className="time-block-chip warning" title="Poza godzinami placówki — zostanie przycięte">
                    ⚠ {b.start}–{b.end}
                  </span>
                ))}
                {effective.length === 0 && outside.length === 0 && (
                  <span style={{color:'var(--text-muted)',fontSize:'0.78rem'}}>—</span>
                )}
              </div>
            </React.Fragment>
          );
        })}
      </div>
      {totalEffMins === 0 && (
        <div style={{marginTop:10,padding:'6px 10px',background:'var(--orange-bg)',borderRadius:'var(--radius-sm)',color:'var(--orange)',fontSize:'0.8rem'}}>
          ⚠ Zero efektywnych godzin — dostępność nie pokrywa się z godzinami placówki.
        </div>
      )}
    </div>
  );
}

function DoctorsTab({ doctors, facility, onUpdate, specialties }) {
  const [editing, setEditing] = useState(null); // null | 'new' | doctor
  const colorMap = useMemo(() =>
    getSpecialtyColorMap(doctors, facility.specialRequirements, facility.hourQuotas),
    [doctors, facility.specialRequirements, facility.hourQuotas]
  );

  const saveDoctor = (doc) => {
    if (editing === 'new') {
      onUpdate([...doctors, doc]);
    } else {
      onUpdate(doctors.map(d => d.id === doc.id ? doc : d));
    }
    setEditing(null);
  };

  const deleteDoctor = (id) => {
    onUpdate(doctors.filter(d => d.id !== id));
  };

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
        <div style={{color:'var(--text-dim)',fontSize:'0.88rem'}}>
          Skonfigurowano {doctors.length} pracownik{doctors.length === 1 ? 'a' : 'ów'}
        </div>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Dodaj pracownika</button>
      </div>
      {doctors.length === 0 && (
        <div className="empty-state">
          <div className="icon">👨‍⚕️</div>
          <p>Nie dodano jeszcze pracowników. Dodaj pierwszego pracownika, aby rozpocząć planowanie.</p>
        </div>
      )}
      {doctors.map(d => (
        <DoctorCard key={d.id} doctor={d} facility={facility}
          onEdit={() => setEditing(d)} onDelete={() => deleteDoctor(d.id)}
          colorMap={colorMap} />
      ))}
      {editing && (
        <DoctorForm
          doctor={editing === 'new' ? null : editing}
          facility={facility}
          specialties={specialties}
          onSave={saveDoctor}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// ─── TAB: PLAN ────────────────────────────────────
function PlanTab({ facility, doctors }) {
  const [result, setResult] = useState(null);
  const colorMap = useMemo(() =>
    getSpecialtyColorMap(doctors, facility.specialRequirements, facility.hourQuotas),
    [doctors, facility.specialRequirements, facility.hourQuotas]
  );

  const generate = () => {
    setResult(runSolver(facility, doctors));
  };

  return (
    <div>
      <div style={{textAlign:'center',marginBottom:24}}>
        <button className="btn btn-primary" style={{padding:'12px 32px',fontSize:'1rem'}} onClick={generate}>
          ⚡ Generuj plan
        </button>
      </div>

      {result && !result.success && (
        <div className="card">
          <div className="card-title" style={{color:'var(--red)'}}>
            <span className="icon">❌</span> Generowanie planu nie powiodło się
          </div>
          {result.errors.map((err, i) => (
            <div key={i} className="error-item">{err}</div>
          ))}
        </div>
      )}

      {result && result.success && (
        <div>
          <div className="success-banner">
            <span>✅</span> Plan wygenerowany pomyślnie — zaplanowano {result.plan.length} pracownik{result.plan.length === 1 ? 'a' : 'ów'}
          </div>
          <div className="card" style={{padding:0,overflow:'hidden'}}>
            <div style={{padding:'16px 20px',borderBottom:'1px solid var(--border)'}}>
              <div style={{fontWeight:700,fontSize:'1.05rem'}}>{facility.name || 'Placówka'}</div>
              <div style={{fontSize:'0.82rem',color:'var(--text-dim)',marginTop:2}}>
                {facility.openingHours.filter(d => d.enabled).map((d,i) => DAYS[d.day]).join(', ')}
                {' · '}
                {facility.roomCount} gabinet{facility.roomCount === 1 ? '' : facility.roomCount >= 2 && facility.roomCount <= 4 ? 'y' : 'ów'}
              </div>
            </div>
            <div className="plan-table-wrap">
              <table className="plan-table">
                <thead>
                  <tr>
                    <th>Pracownik</th>
                    <th>Specjalizacja</th>
                    {DAYS.map(d => <th key={d}>{d}</th>)}
                    <th>Godz./tydz.</th>
                  </tr>
                </thead>
                <tbody>
                  {result.plan.map((p, i) => {
                    const sc = colorMap[p.specialty] || SPECIALTY_COLORS[0];
                    return (
                      <tr key={i}>
                        <td style={{fontWeight:600,whiteSpace:'nowrap'}}>{p.doctorName}</td>
                        <td>
                          <span className="specialty-tag" style={{background:sc.bg, color:sc.color, border:`1px solid ${sc.border}`}}>
                            {p.specialty}{p.level ? ` · ${p.level}` : ''}
                          </span>
                        </td>
                        {p.weekSchedule.map((blocks, d) => (
                          <td key={d} className="time-cell">
                            {blocks.length === 0 ? <span style={{color:'var(--text-muted)'}}>—</span> :
                              blocks.map((b,j) => <span key={j}>{b.start}–{b.end}</span>)}
                          </td>
                        ))}
                        <td className="hours-cell">{p.totalWeeklyHours.toFixed(1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2} style={{fontWeight:600}}>Razem</td>
                    {DAYS.map((d, di) => {
                      const dayMins = result.plan.reduce((s,p) => s + sumMinutes(p.weekSchedule[di]), 0);
                      return <td key={di} className="time-cell" style={{fontWeight:500}}>{dayMins > 0 ? `${(dayMins/60).toFixed(1)}h` : '—'}</td>;
                    })}
                    <td className="hours-cell" style={{fontSize:'1rem'}}>
                      {result.plan.reduce((s,p) => s + p.totalWeeklyHours, 0).toFixed(1)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {!result && (
        <div className="empty-state">
          <div className="icon">📋</div>
          <p>Skonfiguruj placówkę i personel, a następnie wygeneruj plan.</p>
        </div>
      )}
    </div>
  );
}

// ─── TOAST ─────────────────────────────────────────
function Toast({ message, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, []);
  return <div className={`toast ${type}`}>{message}</div>;
}

// ─── APP ───────────────────────────────────────────
function App() {
  const [state, setState] = useState(makeDefaultState);
  const [tab, setTab] = useState(0);
  const [toast, setToast] = useState(null);
  const fileInputRef = useRef(null);

  const showToast = (message, type='success') => setToast({ message, type });

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = 'Czy nie zapomniałeś zapisać zmian?';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const handleSave = () => {
    const data = { version: state.version, specialties: state.specialties, facility: state.facility, doctors: state.doctors };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `schedule-${state.facility.name || 'facility'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Grafik zapisany do pliku');
  };

  const handleLoad = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.version || !data.facility || !Array.isArray(data.doctors)) {
          throw new Error('Nieprawidłowy schemat');
        }
        if (!data.facility.openingHours || !Array.isArray(data.facility.openingHours)) {
          throw new Error('Brak godzin otwarcia placówki');
        }
        // Ensure all arrays exist
        data.facility.specialRequirements = data.facility.specialRequirements || [];
        data.facility.hourQuotas = data.facility.hourQuotas || [];
        // Migrate v1 → v2
        if (!data.specialties) {
          const specNames = new Set();
          data.doctors.forEach(d => { if (d.specialty) specNames.add(d.specialty); });
          data.facility.specialRequirements.forEach(r => { if (r.specialty) specNames.add(r.specialty); });
          data.facility.hourQuotas.forEach(q => { if (q.specialty) specNames.add(q.specialty); });
          data.specialties = [...specNames].map(name => ({ id: uuid(), name, levels: [] }));
          data.doctors = data.doctors.map(d => ({ ...d, level: d.level || null }));
          data.facility.specialRequirements = data.facility.specialRequirements.map(r => ({ ...r, level: r.level != null ? r.level : null }));
          data.facility.hourQuotas = data.facility.hourQuotas.map(q => ({ ...q, level: q.level != null ? q.level : null }));
          data.version = 2;
        }
        setState({ ...data, generatedPlan: null });
        setTab(0);
        showToast('Grafik wczytany pomyślnie');
      } catch (err) {
        showToast('Błąd wczytywania: ' + err.message, 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div>
      <header className="app-header">
        <div className="app-logo">
          <div className="app-logo-icon">📅</div>
          <span>Planowanie grafiku</span>
        </div>
        <div className="header-actions">
          <button className="btn btn-sm" onClick={handleSave}>💾 Zapisz</button>
          <button className="btn btn-sm" onClick={() => fileInputRef.current?.click()}>📂 Wczytaj</button>
          <input ref={fileInputRef} type="file" accept=".json" style={{display:'none'}}
            onChange={handleLoad} />
        </div>
      </header>

      <div className="tabs-bar">
        <button className={`tab-btn ${tab===0?'active':''}`} onClick={()=>setTab(0)}>
          Konfiguracja placówki
        </button>
        <button className={`tab-btn ${tab===1?'active':''}`} onClick={()=>setTab(1)}>
          Specjalizacje
          <span className="tab-badge">{state.specialties.length}</span>
        </button>
        <button className={`tab-btn ${tab===2?'active':''}`} onClick={()=>setTab(2)}>
          Personel
          <span className="tab-badge">{state.doctors.length}</span>
        </button>
        <button className={`tab-btn ${tab===3?'active':''}`} onClick={()=>setTab(3)}>
          Generuj plan
        </button>
      </div>

      <div className="main-content">
        {tab === 0 && (
          <FacilityTab facility={state.facility}
            onChange={facility => setState(s => ({...s, facility, generatedPlan: null }))}
            specialties={state.specialties} />
        )}
        {tab === 1 && (
          <SpecialtiesTab specialties={state.specialties}
            onChange={specialties => setState(s => ({...s, specialties, generatedPlan: null }))}
            doctors={state.doctors} facility={state.facility} />
        )}
        {tab === 2 && (
          <DoctorsTab doctors={state.doctors} facility={state.facility}
            onUpdate={doctors => setState(s => ({...s, doctors, generatedPlan: null }))}
            specialties={state.specialties} />
        )}
        {tab === 3 && (
          <PlanTab facility={state.facility} doctors={state.doctors} />
        )}
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);

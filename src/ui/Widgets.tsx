import { ReactNode } from 'react';
import { RESOURCES, ResCount, Resource } from '../engine/types';
import { RES_LABEL, TERRAIN_COLORS } from './theme';

export function ResChip({ r, n }: { r: Resource; n?: number }) {
  return (
    <span className="chip" style={{ background: TERRAIN_COLORS[r] }}>
      {RES_LABEL[r]}
      {n !== undefined && <b>{n}</b>}
    </span>
  );
}

export function CostChips({ cost }: { cost: ResCount }) {
  return (
    <span className="cost">
      {RESOURCES.filter((r) => cost[r]).map((r) => (
        <span key={r} className="dot" style={{ background: TERRAIN_COLORS[r] }} title={RES_LABEL[r]}>
          {cost[r] > 1 ? cost[r] : ''}
        </span>
      ))}
    </span>
  );
}

export function ResEditor({ value, onChange, max }: { value: ResCount; onChange: (v: ResCount) => void; max?: ResCount }) {
  return (
    <div className="res-editor">
      {RESOURCES.map((r) => (
        <div key={r} className="res-edit">
          <ResChip r={r} n={value[r]} />
          <div>
            <button disabled={value[r] <= 0} onClick={() => onChange({ ...value, [r]: value[r] - 1 })}>−</button>
            <button disabled={max ? value[r] >= max[r] : false} onClick={() => onChange({ ...value, [r]: value[r] + 1 })}>+</button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ResSelect({ value, onChange }: { value: Resource; onChange: (r: Resource) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as Resource)}>
      {RESOURCES.map((r) => (
        <option key={r} value={r}>{RES_LABEL[r]}</option>
      ))}
    </select>
  );
}

export function Modal({ children }: { children: ReactNode }) {
  return (
    <div className="overlay">
      <div className="modal">{children}</div>
    </div>
  );
}

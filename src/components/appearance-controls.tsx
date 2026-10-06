'use client';
import { useEffect, useRef, useState } from 'react';
import {
  edgeAppearance,
  markers,
  type EdgeAppearance,
  type EdgeOverride,
  type NodeOverride,
} from '@/lib/appearance';
export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);
  return (
    <label>
      {label}
      <input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={draft}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(e) => {
          const text = e.target.value;
          setDraft(text);
          const n = Number(text);
          if (text !== '' && Number.isFinite(n) && n >= min && n <= max) onChange(n);
        }}
        onBlur={() => {
          focused.current = false;
          const n = draft === '' ? value : Number(draft);
          const safe = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : value;
          setDraft(String(safe));
          if (safe !== value) onChange(safe);
        }}
      />
    </label>
  );
}
export function TextAppearanceControls({
  value,
  onChange,
}: {
  value: NodeOverride;
  onChange: (patch: NodeOverride) => void;
}) {
  return (
    <>
      <div className="appearance-grid">
        <NumberField
          label="Размер текста, px"
          value={value.fontSize ?? 12}
          min={8}
          max={72}
          onChange={(fontSize) => onChange({ fontSize })}
        />
        <NumberField
          label="Поворот текста, °"
          value={value.textRotation ?? 0}
          min={-180}
          max={180}
          onChange={(textRotation) => onChange({ textRotation })}
        />
      </div>
      <label>
        Выравнивание текста
        <select
          aria-label="Выравнивание текста"
          value={value.textAlign ?? 'center'}
          onChange={(e) => onChange({ textAlign: e.target.value as NodeOverride['textAlign'] })}
        >
          <option value="left">Слева</option>
          <option value="center">По центру</option>
          <option value="right">Справа</option>
        </select>
      </label>
      <label className="inline-check">
        <input
          type="checkbox"
          checked={value.showAttributes !== false}
          onChange={(e) => onChange({ showAttributes: e.target.checked })}
        />
        Показывать атрибуты на объекте
      </label>
    </>
  );
}
const markerNames: Record<(typeof markers)[number], string> = {
  none: 'Без стрелки',
  arrow: 'Обычная стрелка',
  'thin-arrow': 'Тонкая открытая',
  'thick-arrow': 'Толстая стрелка',
  triangle: 'Закрашенный треугольник',
  'hollow-triangle': 'Пустой треугольник',
  diamond: 'Закрашенный ромб',
  'hollow-diamond': 'Пустой ромб',
  circle: 'Круг',
};
function DashField({ value, onChange }: { value: number[]; onChange: (value: number[]) => void }) {
  const [draft, setDraft] = useState(value.join(' '));
  return (
    <label>
      Штрихи и промежутки
      <input
        aria-label="Штрихи и промежутки"
        value={draft}
        placeholder="8 4 2 4"
        onChange={(e) => {
          setDraft(e.target.value);
          if (!/^[\d.,\s]+$/.test(e.target.value)) return;
          const numbers = e.target.value
            .trim()
            .split(/[\s,]+/)
            .map(Number);
          if (numbers.length >= 2 && numbers.length <= 8 && numbers.every((n) => n > 0 && n <= 50))
            onChange(numbers);
        }}
        onBlur={() => setDraft(value.join(' '))}
      />
      <small className="muted">От 2 до 8 чисел: длина штриха, промежуток…</small>
    </label>
  );
}
export function EdgeAppearanceControls({
  value,
  onChange,
}: {
  value: EdgeAppearance;
  onChange: (patch: EdgeOverride) => void;
}) {
  const a = edgeAppearance(value);
  return (
    <div className="form-stack edge-appearance-controls">
      <label>
        Линия
        <select
          aria-label="Линия"
          value={a.line}
          onChange={(e) =>
            onChange({
              line: e.target.value as EdgeAppearance['line'],
              ...(e.target.value === 'custom' ? { dashPattern: a.dashPattern ?? [8, 4] } : {}),
            })
          }
        >
          <option value="solid">Сплошная</option>
          <option value="dashed">Прерывистая</option>
          <option value="dotted">Точечная</option>
          <option value="dash-dot">Штрихпунктирная</option>
          <option value="custom">Свой рисунок штрихов</option>
        </select>
      </label>
      {a.line === 'custom' && (
        <DashField
          value={a.dashPattern ?? [8, 4]}
          onChange={(dashPattern) => onChange({ dashPattern })}
        />
      )}
      <div className="appearance-grid">
        <NumberField
          label="Толщина линии, px"
          value={a.width!}
          min={0.5}
          max={12}
          step={0.5}
          onChange={(width) => onChange({ width })}
        />
        <label>
          Цвет линии
          <input
            type="color"
            aria-label="Цвет линии"
            value={a.color}
            onChange={(e) => onChange({ color: e.target.value })}
          />
        </label>
      </div>
      {(['targetMarker', 'sourceMarker'] as const).map((key) => (
        <label key={key}>
          {key === 'targetMarker' ? 'Окончание связи' : 'Начало связи'}
          <select
            aria-label={key === 'targetMarker' ? 'Окончание связи' : 'Начало связи'}
            value={a[key] ?? 'none'}
            onChange={(e) => onChange({ [key]: e.target.value as EdgeAppearance['targetMarker'] })}
          >
            {markers.map((m) => (
              <option key={m} value={m}>
                {markerNames[m]}
              </option>
            ))}
          </select>
        </label>
      ))}
      <div className="appearance-grid">
        <NumberField
          label="Размер стрелки, px"
          value={a.markerSize!}
          min={8}
          max={40}
          onChange={(markerSize) => onChange({ markerSize })}
        />
        <NumberField
          label="Размер подписи, px"
          value={a.fontSize!}
          min={8}
          max={48}
          onChange={(fontSize) => onChange({ fontSize })}
        />
      </div>
      <label>
        Маршрут связи
        <select
          aria-label="Маршрут связи"
          value={a.routing}
          onChange={(e) => onChange({ routing: e.target.value as EdgeAppearance['routing'] })}
        >
          <option value="smoothstep">Ортогональный</option>
          <option value="straight">Прямой</option>
          <option value="bezier">Плавная кривая</option>
        </select>
      </label>
    </div>
  );
}

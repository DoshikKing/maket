'use client';
import { useRef, useState } from 'react';
import { shapePoints, shapePath, shapeSchema, clamp, type CustomShape } from '@/lib/appearance';
import { NumberField } from './appearance-controls';
export function ShapeDesigner({
  initial,
  onSave,
  onCancel,
}: {
  initial: CustomShape;
  onSave: (shape: CustomShape) => void;
  onCancel: () => void;
}) {
  const [shape, setShape] = useState(initial),
    [selected, setSelected] = useState(0),
    [error, setError] = useState('');
  const dragging = useRef<number | null>(null);
  const point = shape.points[selected];
  function movePoint(index: number, x: number, y: number) {
    setShape((current) => ({
      ...current,
      points: current.points.map((p, i) =>
        i === index
          ? { x: Math.round(clamp(x, 0, 100) * 10) / 10, y: Math.round(clamp(y, 0, 100) * 10) / 10 }
          : p,
      ),
    }));
  }
  return (
    <section className="shape-designer" aria-label="Конструктор формы">
      <h3>Конструктор формы</h3>
      <p className="muted small-text">
        Перетаскивайте контрольные точки базовой фигуры. Форма сохраняется в нотации и
        масштабируется вместе с объектом.
      </p>
      <div className="form-grid">
        <label>
          Название формы
          <input
            aria-label="Название формы"
            value={shape.name}
            maxLength={100}
            onChange={(e) => setShape({ ...shape, name: e.target.value })}
          />
        </label>
        <label>
          Базовая фигура
          <select
            aria-label="Базовая фигура"
            value={shape.baseShape}
            onChange={(e) => {
              const baseShape = e.target.value as CustomShape['baseShape'];
              setShape({
                ...shape,
                baseShape,
                points: shapePoints(baseShape),
                rounding: baseShape === 'ellipse' ? 45 : baseShape === 'rounded' ? 15 : 0,
              });
              setSelected(0);
            }}
          >
            <option value="rectangle">Прямоугольник</option>
            <option value="rounded">Скруглённый прямоугольник</option>
            <option value="diamond">Ромб</option>
            <option value="ellipse">Эллипс</option>
          </select>
        </label>
      </div>
      <div className="shape-design-grid">
        <svg
          className="shape-design-canvas"
          viewBox="-5 -5 110 110"
          role="img"
          aria-label="Контрольные точки формы"
          onPointerDown={(e) => {
            const index = (e.target as Element).getAttribute('data-point');
            if (index === null) return;
            e.preventDefault();
            dragging.current = Number(index);
            setSelected(Number(index));
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (dragging.current === null) return;
            const rect = e.currentTarget.getBoundingClientRect();
            movePoint(
              dragging.current,
              ((e.clientX - rect.left) / rect.width) * 110 - 5,
              ((e.clientY - rect.top) / rect.height) * 110 - 5,
            );
          }}
          onPointerUp={(e) => {
            dragging.current = null;
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onPointerCancel={() => {
            dragging.current = null;
          }}
        >
          <path
            d={shapePath(shape, 100, 100)}
            fill="var(--accent-soft)"
            stroke="var(--accent)"
            strokeWidth="1"
          />
          {shape.points.map((p, i) => (
            <circle
              key={i}
              data-point={i}
              cx={p.x}
              cy={p.y}
              r={selected === i ? 2.3 : 1.8}
              fill={selected === i ? 'var(--accent)' : 'var(--panel)'}
              stroke="var(--accent)"
              strokeWidth="0.8"
            />
          ))}
        </svg>
        <div className="form-stack">
          <label>
            Контрольная точка
            <select
              aria-label="Контрольная точка"
              value={selected}
              onChange={(e) => setSelected(Number(e.target.value))}
            >
              {shape.points.map((_, i) => (
                <option value={i} key={i}>
                  Точка {i + 1}
                </option>
              ))}
            </select>
          </label>
          <div className="appearance-grid">
            <NumberField
              label="Координата X, %"
              value={point.x}
              min={0}
              max={100}
              step={0.1}
              onChange={(x) => movePoint(selected, x, point.y)}
            />
            <NumberField
              label="Координата Y, %"
              value={point.y}
              min={0}
              max={100}
              step={0.1}
              onChange={(y) => movePoint(selected, point.x, y)}
            />
          </div>
          <NumberField
            label="Скругление углов, %"
            value={shape.rounding}
            min={0}
            max={45}
            onChange={(rounding) => setShape({ ...shape, rounding })}
          />
          <button
            type="button"
            className="secondary small"
            disabled={shape.points.length >= 32}
            onClick={() => {
              const next = shape.points[(selected + 1) % shape.points.length];
              setShape({
                ...shape,
                points: [
                  ...shape.points.slice(0, selected + 1),
                  { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 },
                  ...shape.points.slice(selected + 1),
                ],
              });
              setSelected(selected + 1);
            }}
          >
            Добавить точку после выбранной
          </button>
          <button
            type="button"
            className="secondary small danger"
            disabled={shape.points.length <= 3}
            onClick={() => {
              setShape({ ...shape, points: shape.points.filter((_, i) => i !== selected) });
              setSelected(0);
            }}
          >
            Удалить точку
          </button>
        </div>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <div className="button-row">
        <button
          type="button"
          className="primary"
          onClick={() => {
            const result = shapeSchema.safeParse(shape);
            if (!result.success) {
              setError(result.error.issues.map((i) => i.message).join('; '));
              return;
            }
            onSave(result.data);
          }}
        >
          Сохранить форму
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Отмена формы
        </button>
      </div>
    </section>
  );
}

'use client';
import {
  commands,
  commandBinding,
  eventBinding,
  shortcutLabel,
  bindingConflict,
  type CommandId,
  type Shortcuts,
} from '@/lib/shortcuts';

export function ShortcutSettings({
  value,
  onChange,
}: {
  value: Shortcuts;
  onChange: (value: Shortcuts) => void;
}) {
  const conflict = bindingConflict(value);
  return (
    <section className="settings-panel">
      <h2>Сочетания клавиш</h2>
      <p className="muted">
        Выберите поле и нажмите новое сочетание. На macOS вместо Ctrl используется ⌘. Esc отменяет
        ввод. Команды действуют в активном канвасе или строке дерева и не мешают вводу текста.
        Некоторые сочетания могут быть зарезервированы системой.
      </p>
      {conflict && (
        <p role="alert" className="error">
          {conflict}
        </p>
      )}
      <div className="shortcut-settings">
        {(Object.keys(commands) as CommandId[]).map((id) => (
          <label className="shortcut-row" key={id}>
            <span>{commands[id].label}</span>
            <input
              aria-label={`Сочетание: ${commands[id].label}`}
              readOnly
              value={shortcutLabel(commandBinding(id, value)) || 'Не назначено'}
              placeholder="Нажмите сочетание"
              onKeyDown={(event) => {
                if (event.key === 'Tab' || event.key === 'Escape') return;
                event.preventDefault();
                event.stopPropagation();
                if (event.nativeEvent.isComposing) return;
                const key = eventBinding(event.nativeEvent);
                if (!key) return;
                onChange({ ...value, [id]: key });
              }}
            />
            <button
              type="button"
              className="secondary small"
              aria-label={`Снять сочетание: ${commands[id].label}`}
              onClick={() => {
                onChange({ ...value, [id]: '' });
              }}
            >
              Снять
            </button>
          </label>
        ))}
      </div>
      <button
        type="button"
        className="secondary small"
        onClick={() => {
          onChange({});
        }}
      >
        Восстановить стандартные сочетания
      </button>
    </section>
  );
}
